use anyhow::Result;
use netops_proto::{SecurityEvent, ThreatAlert};
use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{error, info};

/// Şu anki Unix zaman damgası (saniye). Hiçbir zaman panikleyemez.
fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Saf Rust ile Yazılmış, 1 vCPU / 1GB RAM İçin Ultra-Hafif ve Hızlı Smart Lakehouse & Anomali Motoru
#[derive(Clone)]
pub struct SmartLogEngine {
    memory_ring_buffer: Arc<RwLock<VecDeque<SecurityEventPayload>>>,
    allowlist: Arc<RwLock<std::collections::HashSet<String>>>,
    log_dir: PathBuf,
    log_sender: mpsc::Sender<SecurityEventPayload>,
    pub alert_broadcast: broadcast::Sender<ThreatAlert>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SecurityEventPayload {
    pub device_id: String,
    pub branch_name: String,
    pub event: SecurityEvent,
}

impl SmartLogEngine {
    pub fn new(db_dir: &str) -> Result<Self> {
        let path = PathBuf::from(db_dir);
        std::fs::create_dir_all(&path)?;

        // Kalıcı İzin Listesini (Allowlist) Yükle
        let mut allowlist_set = std::collections::HashSet::new();
        let allowlist_file = path.join("allowlist.json");
        if allowlist_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&allowlist_file) {
                if let Ok(list) = serde_json::from_str::<Vec<String>>(&content) {
                    for item in list {
                        allowlist_set.insert(item);
                    }
                }
            }
        }
        let allowlist = Arc::new(RwLock::new(allowlist_set));

        // Diskteki kalıcı logları (security_events.jsonl) ilk açılışta RAM ring-buffer'ına önceden yükle (Warm Loading)
        let mut initial_ring = VecDeque::with_capacity(5000);
        let log_file_path = path.join("security_events.jsonl");
        if log_file_path.exists() {
            if let Ok(file) = std::fs::File::open(&log_file_path) {
                let reader = BufReader::new(file);
                for line in reader.lines().flatten() {
                    if let Ok(payload) = serde_json::from_str::<SecurityEventPayload>(&line) {
                        if initial_ring.len() >= 5000 {
                            initial_ring.pop_front();
                        }
                        initial_ring.push_back(payload);
                    }
                }
                if !initial_ring.is_empty() {
                    info!("🧠 [SMART LAKEHOUSE]: Diskteki {} adet geçmiş güvenlik logu bellek tamponuna aktarıldı.", initial_ring.len());
                }
            }
        }
        let ring_buffer = Arc::new(RwLock::new(initial_ring));


        let (log_tx, mut log_rx) = mpsc::channel::<SecurityEventPayload>(2000);
        let (alert_tx, _) = broadcast::channel::<ThreatAlert>(100);

        let worker_ring = ring_buffer.clone();
        let worker_dir = path.clone();
        let alert_worker = alert_tx.clone();

        // 🔴 KRİTİK DAYANIKLILIK DÜZELTMESİ (2026-08-28): netops-agent'ta iki kez üretimde
        // yaşanan "sessizce ölen/askıda kalan arka plan görevi" arızasının (panik ya da
        // hang - her ikisi de JoinHandle'ı asla tamamlamayabilir) aynısı bu iki döngü için
        // de geçerli. Ingest/flush görevi ölürse TÜM filodan güvenlik olayları sessizce
        // loglanmayı bırakır; anomali motoru ölürse tehdit tespiti sessizce durur - her
        // ikisi de operatöre hiçbir işaret vermeden. Aşağıdaki nabız + watchdog, agent'ta
        // kanıtlanmış aynı desenle, görev panik olsun ya da askıda kalsın süreci
        // `exit(1)` ile yeniden başlatır (pm2/procd temiz durumdan ayağa kaldırır).
        let ingest_heartbeat = Arc::new(std::sync::atomic::AtomicU64::new(now_unix_secs()));
        let anomaly_heartbeat = Arc::new(std::sync::atomic::AtomicU64::new(now_unix_secs()));
        let ingest_heartbeat_for_loop = ingest_heartbeat.clone();
        let anomaly_heartbeat_for_loop = anomaly_heartbeat.clone();
        let ingest_heartbeat_for_watchdog = ingest_heartbeat.clone();
        let anomaly_heartbeat_for_watchdog = anomaly_heartbeat.clone();

        // 1. Tokio Async Ingest & JSON-Lines Append Worker (Disk I/O Sıfır Bloklama)
        tokio::spawn(async move {
            let mut batch = Vec::with_capacity(50);
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3));

            loop {
                tokio::select! {
                    Some(payload) = log_rx.recv() => {
                        batch.push(payload);
                        ingest_heartbeat_for_loop.store(now_unix_secs(), std::sync::atomic::Ordering::Relaxed);
                        if batch.len() >= 50 {
                            Self::flush_batch(&worker_ring, &worker_dir, &mut batch, &alert_worker).await;
                        }
                    }
                    _ = ticker.tick() => {
                        ingest_heartbeat_for_loop.store(now_unix_secs(), std::sync::atomic::Ordering::Relaxed);
                        if !batch.is_empty() {
                            Self::flush_batch(&worker_ring, &worker_dir, &mut batch, &alert_worker).await;
                        }
                    }
                }
            }
        });

        // 2. Window-Based Anomali Analiz Motoru (Her 60 saniyede bir Ring-Buffer üzerinde analiz)
        let anomaly_ring = ring_buffer.clone();
        let alert_anomaly = alert_tx.clone();
        let anomaly_allowlist = allowlist.clone();
        tokio::spawn(async move {
            let mut anomaly_ticker = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                anomaly_ticker.tick().await;
                anomaly_heartbeat_for_loop.store(now_unix_secs(), std::sync::atomic::Ordering::Relaxed);
                Self::run_anomaly_analysis(&anomaly_ring, &anomaly_allowlist, &alert_anomaly).await;
            }
        });

        // 🐕 Ingest/Anomali Watchdog: bu iki görevden biri kendi normal periyodunun kat
        // kat üzerinde (geçici gecikmelerden ayırt etmek için cömert eşikler) ilerleme
        // kaydetmezse süreci proaktif olarak sonlandırır.
        tokio::spawn(async move {
            let mut check_interval = tokio::time::interval(std::time::Duration::from_secs(15));
            const INGEST_STALL_THRESHOLD_SECS: u64 = 60; // Normal periyot: 3sn (ticker) / event bazlı
            const ANOMALY_STALL_THRESHOLD_SECS: u64 = 300; // Normal periyot: 60sn
            loop {
                check_interval.tick().await;
                let now = now_unix_secs();
                let ingest_age = now.saturating_sub(ingest_heartbeat_for_watchdog.load(std::sync::atomic::Ordering::Relaxed));
                let anomaly_age = now.saturating_sub(anomaly_heartbeat_for_watchdog.load(std::sync::atomic::Ordering::Relaxed));
                if ingest_age > INGEST_STALL_THRESHOLD_SECS {
                    error!("🚨 [WATCHDOG] Güvenlik olayı ingest/flush görevi {} saniyedir ilerleme kaydetmiyor (askıda kalmış/panik olmuş olabilir). Süreç yeniden başlatılıyor.", ingest_age);
                    std::process::exit(1);
                }
                if anomaly_age > ANOMALY_STALL_THRESHOLD_SECS {
                    error!("🚨 [WATCHDOG] Anomali analiz motoru {} saniyedir ilerleme kaydetmiyor (askıda kalmış/panik olmuş olabilir). Süreç yeniden başlatılıyor.", anomaly_age);
                    std::process::exit(1);
                }
            }
        });

        // 3. Arka Plan Otomatik Log Budama Görevi (Rotasyon: 30 gün)
        //
        // DAYANIKLILIK DÜZELTMESİ (2026-08-28, Faz 3): Düşük öncelikli - bu görev ölürse
        // sonuç sadece disk kullanımının yavaşça sınırsız büyümesi (kozmetik/kapasite
        // sorunu, veri doğruluğu ya da güvenlik etkisi yok). Yine de tutarlılık için
        // aynı nabız + watchdog deseni eklendi.
        let prune_dir = path.clone();
        let prune_heartbeat = Arc::new(std::sync::atomic::AtomicU64::new(now_unix_secs()));
        let prune_heartbeat_for_watchdog = prune_heartbeat.clone();
        tokio::spawn(async move {
            let mut prune_ticker = tokio::time::interval(std::time::Duration::from_secs(3600 * 12));
            loop {
                prune_ticker.tick().await;
                prune_heartbeat.store(now_unix_secs(), std::sync::atomic::Ordering::Relaxed);
                Self::prune_old_logs(&prune_dir, 30).await;
            }
        });

        // 🐕 Log Budama Watchdog: normal 12 saatlik periyodun kat kat üzerinde (48 saat
        // eşik) ilerleme kaydetmezse süreci proaktif olarak sonlandırır.
        tokio::spawn(async move {
            let mut check_interval = tokio::time::interval(std::time::Duration::from_secs(3600));
            const PRUNE_STALL_THRESHOLD_SECS: u64 = 3600 * 48; // Normal periyot: 12sa
            loop {
                check_interval.tick().await;
                let age = now_unix_secs().saturating_sub(prune_heartbeat_for_watchdog.load(std::sync::atomic::Ordering::Relaxed));
                if age > PRUNE_STALL_THRESHOLD_SECS {
                    error!("🚨 [WATCHDOG] Log budama görevi {} saniyedir ilerleme kaydetmiyor (askıda kalmış olabilir). Süreç yeniden başlatılıyor.", age);
                    std::process::exit(1);
                }
            }
        });

        Ok(Self {
            memory_ring_buffer: ring_buffer,

            allowlist,
            log_dir: path,
            log_sender: log_tx,
            alert_broadcast: alert_tx,
        })
    }

    /// Şubeden Gelen Güvenlik Olayını Kuyruğa Ekle (Non-blocking)
    pub async fn ingest_event(&self, device_id: String, branch_name: String, event: SecurityEvent) {
        let _ = self.log_sender.send(SecurityEventPayload { device_id, branch_name, event }).await;
    }

    /// Bir Domain veya Hedefi Kalıcı İzin Listesine (Whitelist) Ekle
    pub async fn add_to_allowlist(&self, domain_or_pattern: &str) -> Result<()> {
        let clean = domain_or_pattern.trim().to_lowercase();
        if clean.is_empty() {
            return Ok(());
        }

        let mut guard = self.allowlist.write().await;
        guard.insert(clean);

        // Diske kalıcı yaz
        let allowlist_file = self.log_dir.join("allowlist.json");
        let list: Vec<String> = guard.iter().cloned().collect();
        if let Ok(json_str) = serde_json::to_string_pretty(&list) {
            // RESDISC-002 DÜZELTMESİ: yazma hatası önceden sessizce atılıyordu - hub
            // restart olursa bu allowlist girişi diskte hiç olmayabilirdi (fail-safe yönde
            // bir kayıp: daha fazla yanlış-pozitif alarm, tespit atlaması değil - ama yine
            // de operatöre görünür olmalı).
            if let Err(e) = std::fs::write(&allowlist_file, json_str) {
                error!("🚨 [SMART ALLOWLIST]: Allowlist diske kalıcı yazılamadı ({}): {}", allowlist_file.display(), e);
            }
        }

        info!("🛡️ [SMART ALLOWLIST]: '{}' başarıyla güvenli listeye eklendi.", domain_or_pattern);
        Ok(())
    }

    /// İzin Listesini Getir
    pub async fn get_allowlist(&self) -> Vec<String> {
        let guard = self.allowlist.read().await;
        guard.iter().cloned().collect()
    }

    /// Bir domainin ("d") bir whitelist kökü ("root") ile GERÇEK bir eşleşmesi olup
    /// olmadığını kontrol eder - kök zaten "." ile başlıyorsa (".lan", ".local" gibi
    /// kasıtlı alt-domain jokerleri) doğrudan suffix olarak, aksi halde ya TAM eşleşme ya
    /// da GERÇEK bir "." + kök alt-domain suffix'i olarak. `is_whitelisted_domain`'in hem
    /// dinamik (admin tanımlı) hem de sabit (root_whitelists) listeleri için ortak, tek
    /// kaynak mantığı - STRCMP-001 düzeltmesinin sadece root_whitelists'e uygulanıp dinamik
    /// listede unutulmasının (aynı "evilgoogle.com" bypass'ı) önüne geçer.
    fn domain_matches_root(d: &str, root: &str) -> bool {
        if root.starts_with('.') {
            d.ends_with(root)
        } else {
            d == root || d.ends_with(&format!(".{}", root))
        }
    }

    /// Domain Meşru / Güvenli mi? (Root Whitelist + Dinamik Allowlist)
    fn is_whitelisted_domain(domain: &str, dynamic_list: &std::collections::HashSet<String>) -> bool {
        let d = domain.trim().to_lowercase();
        if d.is_empty() {
            return true;
        }

        // 1. Kullanıcı Tanımlı Dinamik Allowlist Kontrolü
        //
        // 🔴 Kod-review düzeltmesi: bu kontrol STRCMP-001 düzeltmesinin AYNI çıplak
        // `d.ends_with(allowed)` (nokta sınırı olmadan) desenini hâlâ kullanıyordu - bir
        // operatör "google.com"u allowlist'e eklerse, "evilgoogle.com" da suffix eşleşmesiyle
        // whitelist'e giriyordu. Artık root_whitelists ile AYNI sıkı `domain_matches_root`
        // mantığı kullanılıyor.
        if dynamic_list.iter().any(|allowed| Self::domain_matches_root(&d, allowed)) {
            return true;
        }

        // NOT: mDNS/Bonjour servis keşif sorguları (örn. "_services._dns-sd._udp.local")
        // için ayrı bir istisnaya gerek yok - gerçek mDNS trafiği her zaman ".local"
        // bölgesindedir ve aşağıdaki root_whitelists'teki ".local" girişi zaten TÜM
        // ".local" domainlerini kapsar (kod-review: önceki ayrı `contains` tabanlı
        // istisna hem gereksizdi hem de STRCMP-001'in kapattığı substring-bypass
        // sınıfını yeniden açma riski taşıyordu).

        // 2. Global Meşru İşletim Sistemi / CDN / Servis Sağlayıcıları & Yerel Ağ Servis Keşfi (Root Whitelist)
        let root_whitelists = [
            "google.com",
            "googleusercontent.com",
            "googleapis.com",
            "gstatic.com",
            "dns.google",
            "googlezip.net",
            "1e100.net",
            "microsoft.com",
            "windowsupdate.com",
            "live.com",
            "azure.com",
            "apple.com",
            "icloud.com",
            "cloudflare.com",
            "cloudflare-dns.com",
            "aws.amazon.com",
            "amazonaws.com",
            "ariot.com.tr",
            "github.com",
            "githubusercontent.com",
            "akamaized.net",
            "digicert.com",
            "letsencrypt.org",
            "in-addr.arpa",
            "ip6.arpa",
            ".lan",
            ".local",
        ];

        // 🔴 STRCMP-001 DÜZELTMESİ: Önceki kod ayrıca çıplak `d.ends_with(root)` (nokta
        // olmadan) ve `d.contains(root)` de kontrol ediyordu - bu, "evilgoogle.com" veya
        // "google.com.attacker-c2.ru" gibi trivially oluşturulmuş domainlerin whitelist'e
        // girip C2/beacon ve DNS-flooding tespitinden kaçmasına izin veriyordu.
        root_whitelists.iter().any(|&root| Self::domain_matches_root(&d, root))
    }

    /// Toplu Logları Bellek Ring-Buffer'ına ve Günlük Partition Log Dosyasına Yaz
    async fn flush_batch(
        ring: &Arc<RwLock<VecDeque<SecurityEventPayload>>>,
        log_dir: &PathBuf,
        batch: &mut Vec<SecurityEventPayload>,
        alert_tx: &broadcast::Sender<ThreatAlert>,
    ) {
        let log_file_path = log_dir.join("security_events.jsonl");
        let mut json_lines: Vec<String> = Vec::with_capacity(batch.len());

        {
            let mut ring_guard = ring.write().await;

            for item in batch.drain(..) {
                let e = &item.event;

                // Anlık Şüpheli Yanal Bağlantı Alarmı (Lateral Movement: Port 445 / 3389)
                if e.event_type == "LATERAL_CONN" {
                    let alert_id = format!("lat-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
                    let alert = ThreatAlert {
                        alert_id,
                        timestamp: e.timestamp,
                        device_id: item.device_id.clone(),
                        branch_name: item.branch_name.clone(),
                        threat_type: "LATERAL_PORT_SCAN".into(),
                        client_ip: e.src_ip.clone(),
                        client_mac: e.src_mac.clone(),
                        client_hostname: "İstemci".into(),
                        confidence_score: 0.94,
                        baseline_diff_pct: 250.0,
                        description: format!("Şube yerel ağında {} portuna şüpheli eşler arası (Lateral) bağlantı tespit edildi.", e.dst_port),
                        recommended_action: "Karantinaya Al (Kullanıcı Onayı Gerekir)".into(),
                        status: "PENDING_REVIEW".into(),
                    };
                    let _ = alert_tx.send(alert);
                }

                // Ring-Buffer'a ekle (Max 5000 adet)
                if ring_guard.len() >= 5000 {
                    ring_guard.pop_front();
                }
                ring_guard.push_back(item.clone());

                if let Ok(json_line) = serde_json::to_string(&item) {
                    json_lines.push(json_line);
                }
            }
        } // ring_guard burada bırakılır - disk I/O kilidi tutarken yapılmaz

        if json_lines.is_empty() {
            return;
        }

        // 🔴 ASYNCBLOCK-001 DÜZELTMESİ: dosya açma + `writeln!` önceden bu async fn içinde
        // SENKRON (`std::fs`) çalışıyordu - kimlik doğrulanmamış saldırgan bile
        // tetikleyebildiği /telemetry ingest yolundan sürekli çağrıldığından, paylaşılan
        // tokio worker thread'lerini disk I/O ile tıkayabilirdi. Artık gerçek dosya
        // yazımı `spawn_blocking` içinde, async runtime thread'ini bloklamadan çalışıyor.
        let log_path = log_file_path.clone();
        let write_result = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let mut file = OpenOptions::new().create(true).append(true).open(&log_path)?;
            for line in &json_lines {
                writeln!(file, "{}", line)?;
            }
            Ok(())
        })
        .await;

        // RESDISC-003 DÜZELTMESİ: yazma hatası önceden sessizce atılıyordu - denetim
        // (audit) logu kaybı, restart'a kadar yalnızca bellek ring-buffer'ıyla maskeleniyordu.
        match write_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                error!("🚨 [SMART LAKEHOUSE]: Güvenlik olay logu diske yazılamadı ({}): {}", log_file_path.display(), e);
            }
            Err(join_err) => {
                error!("🚨 [SMART LAKEHOUSE]: Log yazma görevi panic'ledi: {}", join_err);
            }
        }
    }

    /// Derinlemesine Davranışsal Rolling Window Tehdit ve Anomali Analiz Motoru
    async fn run_anomaly_analysis(
        ring: &Arc<RwLock<VecDeque<SecurityEventPayload>>>,
        allowlist: &Arc<RwLock<std::collections::HashSet<String>>>,
        alert_tx: &broadcast::Sender<ThreatAlert>,
    ) {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
        let guard = ring.read().await;
        let dynamic_allow = allowlist.read().await;

        // İstemci bazında detaylı olay ve domain/port dökümü
        struct ClientStats {
            total_count: usize,
            suspicious_dns: std::collections::HashMap<String, usize>,
            whitelisted_dns_count: usize,
            port_attempts: std::collections::HashMap<u16, usize>,
            event_types: std::collections::HashMap<String, usize>,
        }

        let mut client_map: std::collections::HashMap<(String, String, String, String), ClientStats> = std::collections::HashMap::new();

        for item in guard.iter() {
            if now.saturating_sub(item.event.timestamp) <= 3600 {
                let key = (item.device_id.clone(), item.branch_name.clone(), item.event.src_ip.clone(), item.event.src_mac.clone());
                let entry = client_map.entry(key).or_insert_with(|| ClientStats {
                    total_count: 0,
                    suspicious_dns: std::collections::HashMap::new(),
                    whitelisted_dns_count: 0,
                    port_attempts: std::collections::HashMap::new(),
                    event_types: std::collections::HashMap::new(),
                });

                entry.total_count += 1;
                *entry.event_types.entry(item.event.event_type.clone()).or_insert(0) += 1;

                if !item.event.domain_query.is_empty() {
                    if Self::is_whitelisted_domain(&item.event.domain_query, &dynamic_allow) {
                        entry.whitelisted_dns_count += 1;
                    } else {
                        *entry.suspicious_dns.entry(item.event.domain_query.clone()).or_insert(0) += 1;
                    }
                }
                if item.event.dst_port > 0 {
                    *entry.port_attempts.entry(item.event.dst_port).or_insert(0) += 1;
                }
            }
        }

        for ((dev_id, b_name, s_ip, s_mac), stats) in client_map {
            // Ağ döngüsü (Network Loop) öncelikli kontrol
            if stats.event_types.get("NETWORK_LOOP_DETECTED").copied().unwrap_or(0) > 0 {
                let alert_id = format!("loop-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
                let alert = ThreatAlert {
                    alert_id,
                    timestamp: now,
                    device_id: dev_id.clone(),
                    branch_name: b_name.clone(),
                    threat_type: "NETWORK_LOOP_DETECTED".into(),
                    client_ip: s_ip.clone(),
                    client_mac: s_mac.clone(),
                    client_hostname: "Fiziksel Switch / Köprü".into(),
                    confidence_score: 1.0,
                    baseline_diff_pct: 500.0,
                    description: format!("🚨 KRİTİK FİZİKSEL AĞ DÖNGÜSÜ: Şube switch portları ({}) arasında fiziksel döngü kablosu tespit edildi! RSTP koruması devreye alındı.", s_ip),
                    recommended_action: "Port İzolasyonu / Fiziksel Kabloyu Çıkarın".into(),
                    status: "PENDING_REVIEW".into(),
                };
                let _ = alert_tx.send(alert);
                continue;
            }

            // Yanal port hareketleri (SMB 445, RDP 3389, RPC 135)
            let smb_count = stats.port_attempts.get(&445).copied().unwrap_or(0);
            let rdp_count = stats.port_attempts.get(&3389).copied().unwrap_or(0);

            // Sadece Şüpheli Domainleri Sırala (Google, MS, Apple gibi meşrular elendi)
            let mut top_suspicious: Vec<(String, usize)> = stats.suspicious_dns.into_iter().collect();
            top_suspicious.sort_by(|a, b| b.1.cmp(&a.1));
            let suspicious_str = top_suspicious.iter().take(3).map(|(d, c)| format!("{} ({}x)", d, c)).collect::<Vec<_>>().join(", ");

            if smb_count > 0 || rdp_count > 0 {
                let alert_id = format!("anom-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
                let alert = ThreatAlert {
                    alert_id,
                    timestamp: now,
                    device_id: dev_id,
                    branch_name: b_name,
                    threat_type: "LATERAL_PORT_SCAN".into(),
                    client_ip: s_ip,
                    client_mac: s_mac,
                    client_hostname: "İstemci".into(),
                    confidence_score: 0.95,
                    baseline_diff_pct: 300.0,
                    description: format!("Yerel Ağ Port Taraması & Yanal Yayılma: SMB(445): {} deneme, RDP(3389): {} deneme. Hedef ağ segmenti taranıyor.", smb_count, rdp_count),
                    recommended_action: "Karantinaya Al (Kullanıcı Onayı Gerekir)".into(),
                    status: "PENDING_REVIEW".into(),
                };
                let _ = alert_tx.send(alert);
            } else if !top_suspicious.is_empty() && top_suspicious.iter().any(|(d, _)| d.contains("c2") || d.contains("beacon") || d.contains("malware") || d.ends_with(".ru") || d.ends_with(".xyz") || d.ends_with(".top")) {
                let alert_id = format!("anom-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
                let alert = ThreatAlert {
                    alert_id,
                    timestamp: now,
                    device_id: dev_id,
                    branch_name: b_name,
                    threat_type: "C2_BEACONING_DETECTED".into(),
                    client_ip: s_ip,
                    client_mac: s_mac,
                    client_hostname: "İstemci".into(),
                    confidence_score: 0.92,
                    baseline_diff_pct: (stats.total_count as f32) * 5.0,
                    description: format!("Zararlı C2 / Botnet İletişim Paterni: Şüpheli domainlere [{}] periyodik bağlantı denemeleri tespit edildi.", suspicious_str),
                    recommended_action: "Karantinaya Al (Kullanıcı Onayı Gerekir)".into(),
                    status: "PENDING_REVIEW".into(),
                };
                let _ = alert_tx.send(alert);
            } else if !top_suspicious.is_empty() && stats.total_count >= 60 {
                let alert_id = format!("anom-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
                let alert = ThreatAlert {
                    alert_id,
                    timestamp: now,
                    device_id: dev_id,
                    branch_name: b_name,
                    threat_type: "DNS_FLOODING_ANOMALY".into(),
                    client_ip: s_ip,
                    client_mac: s_mac,
                    client_hostname: "İstemci".into(),
                    confidence_score: 0.84,
                    baseline_diff_pct: (stats.total_count as f32) * 3.5,
                    description: format!("Yüksek Hacimli Bilinmeyen Domain Sorgu Patlaması ({} olay): [{}]", stats.total_count, suspicious_str),
                    recommended_action: "Karantinaya Al (Kullanıcı Onayı Gerekir)".into(),
                    status: "PENDING_REVIEW".into(),
                };
                let _ = alert_tx.send(alert);
            }
        }
    }

    /// Canlı Logları Bellekten ve Dosyadan Sayfalamalı Oku (Toplam Log Sayısı ve Son Olaylar)
    /// `device_id_filter` verilirse (Şube 360° görünümü), sadece o cihaza ait olaylar
    /// döner - `total_count` ise HER ZAMAN filtresiz toplam sayıyı gösterir (arayüzde
    /// "X/Y olay" gibi bir gösterge için).
    pub async fn query_logs(&self, limit: usize, device_id_filter: Option<&str>) -> Result<(usize, Vec<SecurityEvent>)> {

        let guard = self.memory_ring_buffer.read().await;
        let total_count = guard.len();
        let mut results = Vec::new();

        let iter = guard.iter().rev().filter(|item| {
            device_id_filter.is_none_or(|f| item.device_id == f)
        });
        for item in iter.take(limit) {
            results.push(item.event.clone());
        }

        Ok((total_count, results))
    }


    /// Diskte biriken log dosyalarını otomatik temizler (30 günlük rotasyon)
    async fn prune_old_logs(log_dir: &PathBuf, max_days: u64) {
        let log_file_path = log_dir.join("security_events.jsonl");

        let cutoff_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .saturating_sub(max_days * 86400);

        // 🔴 ASYNCBLOCK-002 DÜZELTMESİ: tüm dosyanın senkron `read_to_string`/`write`'ı
        // önceden bu async fn içinde doğrudan çalışıyordu (12 saatte bir, ama dosya
        // büyüdükçe süresi de büyüyen bir işlem) - artık `spawn_blocking` içinde.
        let path_for_blocking = log_file_path.clone();
        let result = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            if !path_for_blocking.exists() {
                return Ok(());
            }
            let content = std::fs::read_to_string(&path_for_blocking)?;
            let mut fresh_lines = Vec::new();
            for line in content.lines() {
                if let Ok(payload) = serde_json::from_str::<SecurityEventPayload>(line) {
                    if payload.event.timestamp >= cutoff_time {
                        fresh_lines.push(line.to_string());
                    }
                }
            }
            let new_content = fresh_lines.join("\n");
            std::fs::write(&path_for_blocking, new_content)
        })
        .await;

        // RESDISC-006 DÜZELTMESİ: yazma hatası önceden sessizce atılıyordu - başarısız bir
        // budama yazımı TÜM denetim (audit) geçmişini kaybettirebilirdi, hiç loglanmadan.
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                error!("🚨 [SMART LAKEHOUSE]: Log budama (rotasyon) sırasında dosya yazılamadı - denetim geçmişi kısmen/tamamen kaybolmuş olabilir ({}): {}", log_file_path.display(), e);
            }
            Err(join_err) => {
                error!("🚨 [SMART LAKEHOUSE]: Log budama görevi panic'ledi: {}", join_err);
            }
        }
    }
}

