use anyhow::Result;
use axum::{
    extract::{ConnectInfo, Json},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use clap::Parser;
use netops_proto::{KeyPair, PeerRegistrationRequest, PeerRegistrationResponse, TelemetryReport};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

/// Şu anki Unix zaman damgası (saniye). Hiçbir zaman panikleyemez - saat
/// UNIX_EPOCH'tan önceyse (pratikte imkansız) 0 döner.
pub fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Parser, Debug)]
#[command(name = "netops-hub", author = "NetOpsWan Team", version = "0.1.0")]
struct Args {
    #[arg(short, long, default_value = "0.0.0.0:8088")]
    api_listen: String,

    #[arg(short, long, default_value = "51820")]
    tunnel_port: u16,

    /// Dinamik IPAM SD-WAN Tünel Havuz Bloğu (Örn: 10.8.0.0/16, 10.100.0.0/16, 172.16.0.0/16 vb.)
    /// NOT: Varsayılan /16 olarak ayarlanmıştır (~65k adresleneilebilir IP). Önceki /24
    /// varsayılanı yalnızca ~253 cihaz kapasitesine sahipti - schema.sql'in kendi
    /// belgelediği "500+ Nodes Scale" hedefiyle doğrudan çelişiyordu ve production Hub'ı
    /// hiçbir CLI argümanı verilmeden çalıştığı için gerçekten bu sınırla sınırlıydı.
    #[arg(long, default_value = "10.8.0.0/16")]
    tunnel_subnet: String,

    /// Zero-Trust Ön-Paylaşımlı Ağ Gizli Anahtarı (X-NetOps-Secret)
    #[arg(long)]
    shared_secret: Option<String>,

    /// OTA ile dağıtılan netops-agent binary'sinin GERÇEK sürümü. NOT: Bu, netops-hub
    /// crate'inin kendi Cargo.toml sürümünden (env!("CARGO_PKG_VERSION")) FARKLI bir
    /// şeydir - önceki kod bu ikisini birbirine karıştırıyordu (Hub'ın kendi versiyonunu
    /// "agent'ın hedef versiyonu" olarak bildiriyordu). Hub ve Agent bağımsız
    /// versiyonlanan ayrı crate'ler olduğu için (bugün ikisi de "0.4.9" olsa da), bu alan
    /// açıkça verilmezse SemVer karşılaştırması anlamsız/yanlış sonuç üretebilir.
    #[arg(long, default_value = env!("CARGO_PKG_VERSION"))]
    agent_version: String,

    /// Kamera/NVR trafiği (RTSP tcp/554) için fleet-çapında varsayılan bant genişliği
    /// tavanı (kbps). Bu bir IP/kimlik bilgisi DEĞİLDİR, sadece bir sayı - agent kendi
    /// başına RTSP trafiğini port imzasından otomatik tanır ve bu tavanı uygular.
    /// 0 = agent kendi makul varsayılanını (8192 kbps) kullanır.
    #[arg(long, default_value_t = 0)]
    camera_bandwidth_ceil_kbps: u32,

    /// Kayıtsız/telemetri-üzerinden-otomatik-oluşturulan peer sayısı için genel tavan.
    /// RESEXHAUST-001 düzeltmesi: bu sınır olmadan, sürekli değişen `device_id` gönderen
    /// bir istemci `state.peers`'ı sınırsız büyütüp hub'ı (panic="abort" release
    /// profiliyle) OOM/çökme noktasına getirebiliyordu.
    #[arg(long, default_value_t = 5000)]
    max_peers: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnectedPeer {
    pub device_id: String,
    pub serial_number: String,
    pub model: String,
    pub mac_address: String,
    pub management_ip: String,
    #[serde(default)]
    pub lan_ip: String,
    #[serde(default)]
    pub lan_clients: Vec<netops_proto::LanClient>,
    pub public_key: String,
    pub virtual_ip: String,
    pub last_seen: u64,
    pub status: String,
    pub ram_used_mb: u32,
    pub ram_total_mb: u32,
    pub cpu_usage_pct: f32,
    pub rtt_ms: f32,
    #[serde(default)]
    pub firewall_mode: String,
    #[serde(default)]
    pub agent_version: String,
    #[serde(default)]
    pub ota_cohort: String,
    // NOT: Agent'ın TelemetryReport'u tx_bytes/rx_bytes'ı (/proc/net/dev'den okunan
    // gerçek WAN sayaçları) her zaman gönderiyordu, ama bu struct'ta hiç karşılığı
    // yoktu - bu yüzden receive_telemetry payload'ı işlerken bu alanları SESSİZCE
    // ATIYORDU. Next.js tarafı zaten `peer.tx_bytes || 0` okuyordu (doğru kod), ama
    // `peer.tx_bytes` alanı hiç var olmadığı için her zaman 0'a düşüyordu - bu da
    // /dashboard/monitoring'deki "Agregasyonel WAN Trafiği" grafiğinin sürekli boş/sıfır
    // görünmesinin doğrudan sebebiydi. `#[serde(default)]` eklendi ki bu alanlar
    // olmadan diske yazılmış eski hub_peers_state.json kayıtları da hatasız yüklenebilsin.
    #[serde(default)]
    pub tx_bytes: u64,
    #[serde(default)]
    pub rx_bytes: u64,
    #[serde(default)]
    pub uptime_seconds: u64,
    #[serde(default)]
    pub tunnel_ip: String,
    #[serde(default)]
    pub active_camera_sessions: u32,
    // Tünel kararlılığı düzeltmesi: önceden `local_ip_ranges` (şube LAN alt ağları, örn.
    // "192.168.101.0/24") sadece kayıt anındaki geçici `PeerRegistrationRequest`'te vardı,
    // hiçbir yerde kalıcılaştırılmıyordu. Bu yüzden WireGuard peer girişi (hub restart,
    // `wg-quick down`, config drift vb. nedenlerle) koption bir şekilde kaybolursa, onu
    // TAM (LAN alt ağı dahil) AllowedIPs ile yeniden kurmanın hiçbir yolu yoktu - reaper
    // task'ı bunu artık bu alandan okuyarak periyodik olarak yeniden uygulayabiliyor.
    #[serde(default)]
    pub local_ip_ranges: Vec<String>,
}

/// 500+ Şube İçin Hafif DTO (Deep-Clone ve Devasa Payload Maliyetini Sıfıra İndirir)
#[derive(Debug, Clone, serde::Serialize)]
pub struct PeerSummary {
    pub device_id: String,
    pub serial_number: String,
    pub model: String,
    pub mac_address: String,
    pub management_ip: String,
    pub lan_ip: String,
    pub lan_client_count: usize,
    pub public_key: String,
    pub virtual_ip: String,
    pub last_seen: u64,
    pub status: String,
    pub ram_used_mb: u32,
    pub ram_total_mb: u32,
    pub cpu_usage_pct: f32,
    pub rtt_ms: f32,
    pub firewall_mode: String,
    pub agent_version: String,
    pub ota_cohort: String,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub uptime_seconds: u64,
    pub tunnel_ip: String,
    pub active_camera_sessions: u32,
}

impl From<&ConnectedPeer> for PeerSummary {
    fn from(p: &ConnectedPeer) -> Self {
        Self {
            device_id: p.device_id.clone(),
            serial_number: p.serial_number.clone(),
            model: p.model.clone(),
            mac_address: p.mac_address.clone(),
            management_ip: p.management_ip.clone(),
            lan_ip: p.lan_ip.clone(),
            lan_client_count: p.lan_clients.len(),
            public_key: p.public_key.clone(),
            virtual_ip: p.virtual_ip.clone(),
            last_seen: p.last_seen,
            status: p.status.clone(),
            ram_used_mb: p.ram_used_mb,
            ram_total_mb: p.ram_total_mb,
            cpu_usage_pct: p.cpu_usage_pct,
            rtt_ms: p.rtt_ms,
            firewall_mode: p.firewall_mode.clone(),
            agent_version: p.agent_version.clone(),
            ota_cohort: p.ota_cohort.clone(),
            tx_bytes: p.tx_bytes,
            rx_bytes: p.rx_bytes,
            uptime_seconds: p.uptime_seconds,
            tunnel_ip: p.tunnel_ip.clone(),
            active_camera_sessions: p.active_camera_sessions,
        }
    }
}


mod engine;
pub mod events;
use engine::SmartLogEngine;
use axum::response::sse::{Event, KeepAlive, Sse};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;




#[derive(Clone)]
struct AppState {
    hub_keypair: Arc<KeyPair>,
    peers: Arc<RwLock<std::collections::HashMap<String, ConnectedPeer>>>,
    revoked_devices: Arc<RwLock<std::collections::HashSet<String>>>,
    pending_commands: Arc<RwLock<std::collections::HashMap<String, netops_proto::DiagnosticCommandRequest>>>,
    waiting_commands: Arc<RwLock<std::collections::HashMap<String, tokio::sync::oneshot::Sender<netops_proto::DiagnosticCommandResponse>>>>,
    tunnel_subnet: String,
    shared_secret: Arc<String>,
    log_engine: SmartLogEngine,
    event_broadcaster: Arc<events::HubEventBroadcaster>,
    // NOT: Önceden her `ota_update` yanıtında sha256 her zaman boş string olarak
    // gönderiliyordu - agent tarafında bir bütünlük doğrulaması fonksiyonu (tam ve test
    // edilmiş) vardı ama boş hash ile anlamsızdı. Hub başlangıcında OTA indirme
    // dosyasının gerçek SHA-256'sı BİR KEZ hesaplanıp burada önbelleğe alınır (her
    // telemetri isteğinde dosyayı yeniden okuyup hashlemek maliyetli olurdu - saniyede
    // onlarca cihaz için gereksiz disk I/O).
    ota_binary_sha256: Arc<String>,
    // Ed25519 imzası (hex) - sha256 ile birebir aynı önbellekleme deseni: dosyadan bir
    // kez okunur, her telemetri/register isteğinde tekrar disk I/O yapılmaz.
    ota_binary_signature: Arc<String>,
    agent_version: Arc<String>,
    camera_bandwidth_ceil_kbps: u32,
    // Faz 3 - Ölçeklenebilirlik/Backpressure: register/telemetry endpoint'lerinde HİÇ
    // hız sınırlaması yoktu - tek bozuk/kötü niyetli bir cihaz (veya sahte device_id ile
    // sahte istek gönderen biri) hub'ın tek vCPU'sunu (bkz. 2026-08-22 throughput testi)
    // ağır işlemlerle (DuckDB log ingest, peer state güncelleme) doldurabilirdi. Cihaz
    // başına son kabul edilen istek zamanını tutan hafif bir sliding-window limiter.
    rate_limiter: Arc<dashmap::DashMap<String, std::time::Instant>>,
    max_peers: usize,
}


// 💾 Peer Kimlik/IP Kalıcılığı
//
// NEDEN: `peers` sadece bellekte (in-memory HashMap) tutulur. Hub her restart
// olduğunda (deploy, crash, OOM) bu harita sıfırlanır ve register_peer'daki IP
// tahsis mantığı (`peers_guard.get(&device_id)`) her cihazı "yeni" sanıp havuzdan
// FARKLI bir virtual_ip atar - production'da canlı olarak gözlemlendi: aynı fiziksel
// cihaz farklı Hub restart'larında 10.8.0.4, 10.8.0.5, 10.8.0.6, 10.8.0.2 gibi FARKLI
// IP'ler almıştı. Şubeler-arası bridge kuralları veya statik rotalar belirli bir
// virtual_ip'ye referans veriyorsa bu her restart'ta sessizce bozulur.
//
// ÇÖZÜM: Kayıt (register) her gerçekleştiğinde tüm peer haritası diske JSON olarak
// yazılır; Hub başlarken bu dosyadan önceden bilinen device_id -> virtual_ip
// eşlemeleri belleğe önceden yüklenir, böylece register_peer'daki "var olan cihaz"
// kontrolü restart sonrası da eşleşir ve aynı IP korunur.
const PEERS_STATE_PATH: &str = "/etc/netops/hub_peers_state.json";

fn load_persisted_peers() -> std::collections::HashMap<String, ConnectedPeer> {
    match std::fs::read_to_string(PEERS_STATE_PATH) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(map) => {
                info!("💾 [PEER STATE YÜKLENDİ]: {} önceden bilinen cihaz kimliği/IP'si geri yüklendi",
                    { let m: &std::collections::HashMap<String, ConnectedPeer> = &map; m.len() });
                map
            }
            Err(e) => {
                warn!("⚠️ [PEER STATE PARSE HATASI]: {} - boş state ile başlanıyor", e);
                std::collections::HashMap::new()
            }
        },
        Err(_) => std::collections::HashMap::new(),
    }
}

async fn persist_peers_state(peers: &Arc<RwLock<std::collections::HashMap<String, ConnectedPeer>>>) {
    let snapshot = peers.read().await.clone();
    persist_json_atomic(PEERS_STATE_PATH, &snapshot).await;
}

// NOT: revoked_devices de aynı şekilde sadece bellekteydi - bir cihazı "engelle" (revoke)
// dedikten sonra Hub restart olduğunda o cihaz sessizce YENİDEN İZİNLİ hale geliyordu.
// Bu, delete_peer/list_peers üzerinden yapılan bir güvenlik kararının kalıcı olmaması
// anlamına gelir.
const REVOKED_STATE_PATH: &str = "/etc/netops/hub_revoked_state.json";

fn load_persisted_revoked() -> std::collections::HashSet<String> {
    match std::fs::read_to_string(REVOKED_STATE_PATH) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => std::collections::HashSet::new(),
    }
}

async fn persist_revoked_state(revoked: &Arc<RwLock<std::collections::HashSet<String>>>) {
    let snapshot = revoked.read().await.clone();
    persist_json_atomic(REVOKED_STATE_PATH, &snapshot).await;
}

async fn persist_json_atomic<T: serde::Serialize>(path: &'static str, value: &T) {
    let json = match serde_json::to_string(value) {
        Ok(j) => j,
        Err(_) => return,
    };
    let join_result = tokio::task::spawn_blocking(move || {
        if let Some(parent) = std::path::Path::new(path).parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                error!("🚨 [KALICI DURUM]: Dizin oluşturulamadı ({}): {}", parent.display(), e);
                return;
            }
        }
        // Aynı dosya sisteminde geçici dosyaya yaz + atomik rename (bkz. OTA swap fix'inde
        // uygulanan aynı desen - kesinti anında yarım/bozuk state dosyası bırakmamak için).
        //
        // RESDISC-001 DÜZELTMESİ: yazma/rename hataları önceden sessizce atılıyordu - örn.
        // revoked_devices.json için bu, diskte bir yazma hatası olduğunda revoke edilmiş bir
        // cihazın hub restart'ında SESSİZCE erişimi geri kazanabileceği anlamına geliyordu.
        let tmp_path = format!("{}.tmp", path);
        match std::fs::write(&tmp_path, json) {
            Ok(()) => {
                if let Err(e) = std::fs::rename(&tmp_path, path) {
                    error!("🚨 [KALICI DURUM]: '{}' -> '{}' atomik rename başarısız: {}", tmp_path, path, e);
                }
            }
            Err(e) => {
                error!("🚨 [KALICI DURUM]: '{}' geçici dosyaya yazılamadı: {}", tmp_path, e);
            }
        }
    }).await;

    if let Err(join_err) = join_result {
        error!("🚨 [KALICI DURUM]: '{}' için kalıcılaştırma görevi panic'ledi: {}", path, join_err);
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,netops_hub=debug".into()),
        )
        .init();

    let args = Args::parse();
    let hub_keypair = Arc::new(KeyPair::load_or_generate("/etc/netops/hub_identity.key"));
    let peers = Arc::new(RwLock::new(load_persisted_peers()));
    let revoked_devices = Arc::new(RwLock::new(load_persisted_revoked()));
    let pending_commands = Arc::new(RwLock::new(std::collections::HashMap::new()));
    let waiting_commands = Arc::new(RwLock::new(std::collections::HashMap::new()));
    let log_engine = SmartLogEngine::new("/opt/netoswan/data/lakehouse")?;

    let shared_secret = args.shared_secret
        .or_else(|| std::fs::read_to_string("/etc/netops/shared_secret").ok().map(|s| s.trim().to_string()))
        .or_else(|| std::env::var("NETOPS_SHARED_SECRET").ok())
        .unwrap_or_default();
    let shared_secret_arc = Arc::new(shared_secret.clone());

    info!("🚀 NetOpsWan Central Hub Gateway Başlatılıyor...");
    info!("🔑 Hub Public Key: {}", hub_keypair.public_key_base64());
    info!("🌐 API Dinleniyor: {}", args.api_listen);
    info!("🛡️ SD-WAN Tünel IPAM Havuzu: {}", args.tunnel_subnet);
    info!("🔒 Zero-Trust Pre-Shared Secret: {}", if shared_secret.is_empty() { "DEV/OPEN (Uyarısı: Üretimde Secret Tanımlayınız)" } else { "AKTİF / KORUMALI" });
    info!("🧠 Smart DuckDB Log Engine & Lakehouse: AKTİF (/opt/netoswan/data/lakehouse)");

    // Zero-Trust Spoke-to-Spoke İzolasyon Omurgası & NAT Traversal Relay
    let _ = std::process::Command::new("sysctl").arg("-w").arg("net.ipv4.ip_forward=1").output();
    let _ = std::process::Command::new("sysctl").arg("-w").arg("net.ipv4.conf.all.forwarding=1").output();
    let _ = std::process::Command::new("sysctl").arg("-w").arg("net.ipv4.conf.sdwan0.forwarding=1").output();
    // 🔴 KRİTİK DÜZELTME (2026-08-22): Bu satır önceden koşulsuz `-A` (append)
    // kullanıyordu - Hub her yeniden başladığında (deploy, crash, OOM, manuel restart)
    // AYNI kural tekrar tekrar ekleniyor, hiçbir zaman temizlenmiyordu. Production'da
    // gözlemlendi: aylar süren restart'lar sonucunda POSTROUTING zincirinde 87 adet
    // birbirinin AYNISI MASQUERADE kuralı, FORWARD zincirinde 89 adet ACCEPT kuralı
    // birikmişti - her paketin bu zincirlerden geçmesi gereksiz yere onlarca kural
    // taramasına mal oluyordu (500+ şubeli filoda bu performans kaybı katlanarak büyür).
    // `-C` (check) ile kural zaten varsa atlanır - artık kaç kez restart edilirse
    // edilsin ruleset'te HER ZAMAN tam olarak bir kopya kalır.
    let _ = std::process::Command::new("sh").arg("-c").arg("iptables -t nat -C POSTROUTING -o sdwan0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o sdwan0 -j MASQUERADE 2>/dev/null || true").output();
    let _ = std::process::Command::new("sh").arg("-c").arg("iptables -N NETOPS_BRIDGES 2>/dev/null || iptables -F NETOPS_BRIDGES 2>/dev/null || true").output();
    let _ = std::process::Command::new("sh").arg("-c").arg("iptables -D FORWARD -i sdwan+ -o sdwan+ -j ACCEPT 2>/dev/null || true").output();
    let _ = std::process::Command::new("sh").arg("-c").arg("iptables -D FORWARD -i sdwan+ -o sdwan+ -j NETOPS_BRIDGES 2>/dev/null || true").output();
    let _ = std::process::Command::new("sh").arg("-c").arg("iptables -I FORWARD -i sdwan+ -o sdwan+ -j NETOPS_BRIDGES 2>/dev/null || true").output();
    let _ = std::process::Command::new("sh").arg("-c").arg("iptables -C NETOPS_BRIDGES -j DROP 2>/dev/null || iptables -A NETOPS_BRIDGES -j DROP 2>/dev/null || true").output();

    // 🔴 RESDISC-004 DÜZELTMESİ: Yukarıdaki kurulum komutlarının HİÇBİRİNİN çıkış durumu
    // (`let _ = ...output()` ile atılıyordu) hiç kontrol edilmiyordu - `iptables` eksikse,
    // gerekli capability (CAP_NET_ADMIN) yoksa veya herhangi bir komut sessizce başarısız
    // olsa bile hub hiçbir uyarı basmadan devam edip, spoke-to-spoke izolasyon HİÇ
    // kurulmamışken normal başlamış gibi trafik kabul ediyordu - iki şube LAN'ı birbirine
    // doğrudan sızabilirdi. Artık asıl güvenlik sınırı (izolasyon zincirine yönlendirme +
    // varsayılan DROP kuralı) bağımsız bir `iptables -C` sorgusuyla doğrulanmadan hub
    // BAŞLATILMAZ (fail-closed).
    let isolation_verified = std::process::Command::new("sh")
        .arg("-c")
        .arg("iptables -C FORWARD -i sdwan+ -o sdwan+ -j NETOPS_BRIDGES 2>/dev/null && iptables -C NETOPS_BRIDGES -j DROP 2>/dev/null")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !isolation_verified {
        error!("🚨🚨🚨 [KRİTİK GÜVENLİK HATASI]: Zero-Trust Spoke-to-Spoke izolasyon kuralları doğrulanamadı (iptables eksik, CAP_NET_ADMIN yok veya kurulum başarısız oldu). Hub, izolasyon garantisi OLMADAN trafik kabul etmemek için durduruluyor. Kök nedeni giderin (iptables kurulu mu? Hub CAP_NET_ADMIN/root ile mi çalışıyor?) ve yeniden başlatın.");
        std::process::exit(1);
    }
    info!("🛡️ [ZERO-TRUST]: Spoke-to-spoke izolasyon kuralları doğrulandı ve aktif.");

    // Hub sanal SD-WAN Gateway IP'sini dinamik hesapla
    let ipam_pool = netops_proto::Ipv4Subnet::parse(&args.tunnel_subnet)
        .unwrap_or_else(|| netops_proto::Ipv4Subnet {
            network_addr: std::net::Ipv4Addr::new(10, 8, 0, 0),
            prefix_len: 24,
        });

    let hub_vip = ipam_pool.nth_ip(1);
    let hub_vip_with_mask = ipam_pool.nth_ip_with_cidr(1);

    // Hub sdwan0 WireGuard arayüzünü oluştur
    let hub_priv_b64 = hub_keypair.private_key_base64();
    let hub_init_cmd = format!(
        "mkdir -p /etc/netops; \
         echo '{privkey}' > /etc/netops/hub_priv.key; \
         ip link add dev sdwan0 type wireguard 2>/dev/null || true; \
         ip addr add {vip} dev sdwan0 2>/dev/null || true; \
         wg set sdwan0 listen-port {port} private-key /etc/netops/hub_priv.key 2>/dev/null || true; \
         ip link set up dev sdwan0 2>/dev/null || true; \
         iptables -C FORWARD -i sdwan0 -o eth0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i sdwan0 -o eth0 -j ACCEPT 2>/dev/null || true; \
         iptables -C FORWARD -i eth0 -o sdwan0 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o sdwan0 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true; \
         iptables -t nat -C POSTROUTING -o sdwan0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o sdwan0 -j MASQUERADE 2>/dev/null || true;",
        privkey = hub_priv_b64,
        vip = hub_vip_with_mask,
        port = args.tunnel_port
    );
    let _ = std::process::Command::new("sh").arg("-c").arg(&hub_init_cmd).output();
    info!("🛡️ [ZERO-TRUST SD-WAN RELAY GATEWAY]: sdwan0 ({}) Port {} üzerinde AKTİF", hub_vip, args.tunnel_port);

    let event_broadcaster = Arc::new(events::HubEventBroadcaster::new(500));

    // Nginx'in `/downloads/` altında sunduğu (bkz. sdwan.ariot.com.tr nginx config,
    // `location /downloads/ { alias /var/www/downloads/; }`) OTA binary'sinin gerçek
    // SHA-256'sını bir kez hesapla. Dosya yoksa veya okunamazsa boş bırakılır - agent
    // tarafı boş sha256'yı "doğrulama atlandı, sadece sandbox test-run'a güven" olarak
    // ele alır (geriye dönük uyumlu, hiçbir cihazı kilitlemiyor).
    let ota_binary_sha256 = Arc::new(
        std::fs::read("/var/www/downloads/netops-agent-armv7-soft")
            .ok()
            .map(|bytes| {
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(&bytes);
                format!("{:x}", hasher.finalize())
            })
            .unwrap_or_default()
    );
    if ota_binary_sha256.is_empty() {
        warn!("⚠️ [SAFE-OTA]: /var/www/downloads/netops-agent-armv7-soft okunamadı - OTA sha256 doğrulaması bu oturumda devre dışı olacak.");
    } else {
        info!("🔒 [SAFE-OTA]: OTA binary SHA-256 hesaplandı: {}", ota_binary_sha256);
    }

    // Ed25519 imza dosyasını (binary'nin yanına .sig uzantısıyla, netops-ota-tool sign
    // ile üretilir) oku. Yoksa boş kalır - agent tarafı boş imzayı KABUL ETMEZ (sha256'nın
    // aksine bu ZORUNLU), yani imza dosyası eksikse yeni agent'lar OTA'yı reddeder ve
    // eski sürümde güvenle kalır (fail-closed, fail-open değil).
    let ota_binary_signature = Arc::new(
        std::fs::read_to_string("/var/www/downloads/netops-agent-armv7-soft.sig")
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    );
    if ota_binary_signature.is_empty() {
        warn!("⚠️ [SAFE-OTA]: netops-agent-armv7-soft.sig bulunamadı - Ed25519 imza doğrulaması destekleyen agent'lar bu OTA'yı reddedecek (fail-closed, beklenen davranış).");
    } else {
        info!("🔒 [SAFE-OTA]: Ed25519 imza dosyası yüklendi ({} karakter hex).", ota_binary_signature.len());
    }

    info!("📹 [KAMERA/NVR OTOMATİK TRAFİK YÖNETİMİ]: Tüm şubelerde RTSP (tcp/554) port imzasıyla otomatik tespit aktif (tavan: {} kbps, 0=agent varsayılanı kullanır)", args.camera_bandwidth_ceil_kbps);

    let rate_limiter: Arc<dashmap::DashMap<String, std::time::Instant>> = Arc::new(dashmap::DashMap::new());

    let state = AppState {
        hub_keypair: hub_keypair.clone(),
        peers: peers.clone(),
        revoked_devices: revoked_devices.clone(),
        pending_commands: pending_commands.clone(),
        waiting_commands: waiting_commands.clone(),
        tunnel_subnet: args.tunnel_subnet.clone(),
        shared_secret: shared_secret_arc.clone(),
        log_engine,
        event_broadcaster: event_broadcaster.clone(),
        ota_binary_sha256: ota_binary_sha256.clone(),
        ota_binary_signature: ota_binary_signature.clone(),
        agent_version: Arc::new(args.agent_version.clone()),
        camera_bandwidth_ceil_kbps: args.camera_bandwidth_ceil_kbps,
        rate_limiter: rate_limiter.clone(),
        max_peers: args.max_peers,
    };

    // 🔴 Kod-review düzeltmesi: `rate_limiter` (device_id/IP anahtarlı) hiçbir zaman
    // budanmıyordu - `state.peers` artık `max_peers` ile sınırlı olsa da, bu AYRI ve
    // sınırsız bir DashMap'ti; saldırgan her istekte benzersiz bir device_id/IP
    // kullanarak (auth kontrolünden ÖNCE çalışır) hub belleğini yine tüketebilirdi.
    // Periyodik olarak 10 dakikadan uzun süredir dokunulmamış girişler temizlenir -
    // gerçek rate-limit pencereleri (2-5sn) çok daha kısa olduğundan bu, meşru
    // throttling davranışını asla etkilemez.
    //
    // 🔴 DAYANIKLILIK DÜZELTMESİ (2026-08-28, Faz 2): Bu görev askıda kalırsa (panik
    // zaten `panic = "abort"` ile tüm süreci anında öldürüp pm2'nin yeniden
    // başlatmasını tetikler - asıl kör nokta HANG), tam da bu görevin kapatmaya
    // çalıştığı DoS/bellek-tükenme açığı sessizce yeniden açılır. Nabız + watchdog.
    let rate_limiter_heartbeat = Arc::new(std::sync::atomic::AtomicU64::new(now_unix_secs()));
    let rate_limiter_heartbeat_for_watchdog = rate_limiter_heartbeat.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            rate_limiter_heartbeat.store(now_unix_secs(), std::sync::atomic::Ordering::Relaxed);
            // Kod-review düzeltmesi: `Instant::now() - Duration::from_secs(600)` hub
            // taze başlatılmışsa (çalışma süresi < 600sn) ALT TAŞMA (underflow) ile
            // panikler - bu crate `panic = "abort"` ile derlendiğinden bu, tam olarak
            // bu temizleme görevinin önlemeye çalıştığı bellek tükenmesi korumasının
            // KENDİSİNİ hub'ı çökerten bir panik'e çevirirdi. `Instant::elapsed()`
            // (`now() - *self`, her zaman geçmişe doğru, asla alt taşmaz) kullanılarak
            // aynı sonuç güvenli şekilde elde edilir.
            rate_limiter.retain(|_, instant| instant.elapsed() < std::time::Duration::from_secs(600));
        }
    });

    // 🐕 Rate-Limiter Watchdog: normal 300sn periyodunun kat kat üzerinde (30dk eşik)
    // ilerleme kaydetmezse süreci proaktif olarak sonlandırır.
    tokio::spawn(async move {
        let mut check_interval = tokio::time::interval(std::time::Duration::from_secs(120));
        const RATE_LIMITER_STALL_THRESHOLD_SECS: u64 = 1800; // Normal periyot: 300sn
        loop {
            check_interval.tick().await;
            let age = now_unix_secs().saturating_sub(rate_limiter_heartbeat_for_watchdog.load(std::sync::atomic::Ordering::Relaxed));
            if age > RATE_LIMITER_STALL_THRESHOLD_SECS {
                error!("🚨 [WATCHDOG] Rate-limiter temizleme görevi {} saniyedir ilerleme kaydetmiyor (askıda kalmış olabilir). Süreç yeniden başlatılıyor.", age);
                std::process::exit(1);
            }
        }
    });


    // Reaper Task (Dual-Channel Liveness: HTTP Heartbeat + WireGuard Kernel Handshake Fallback)
    //
    // 🔴 KRİTİK DAYANIKLILIK DÜZELTMESİ (2026-08-28): netops-agent'ta iki kez üretimde
    // yaşanan "sessizce ölen/askıda kalan arka plan görevi" arızası (bkz. agent'taki
    // telemetri ve komut-poll döngüsü olayları) burada da MÜMKÜN - reaper de aynı
    // şekilde sonsuz bir `tokio::spawn` döngüsü ve panik/hang'e karşı hiçbir koruması
    // yoktu. Bu döngü ÖLÜRSE: hiçbir peer bir daha OFFLINE/DEGRADED işaretlenmez
    // (dashboard sonsuza dek eski "ACTIVE" verisini gösterir) VE WireGuard config
    // drift'i bir daha kendini onarmaz - reaper'ın kendi amacının tam tersi sessizce
    // gerçekleşir. Aşağıdaki nabız (heartbeat) + watchdog, agent'takiyle aynı desenle,
    // görev panik olsun ya da askıda kalsın süreci `exit(1)` ile yeniden başlatır.
    let reaper_heartbeat = Arc::new(std::sync::atomic::AtomicU64::new(now_unix_secs()));
    let reaper_heartbeat_for_watchdog = reaper_heartbeat.clone();

    let reaper_peers = peers.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            reaper_heartbeat.store(now_unix_secs(), std::sync::atomic::Ordering::Relaxed);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            // WireGuard son el sıkışma (handshake) sürelerini ve IP/Pubkey haritasını dump ile çek
            //
            // Tünel kararlılığı düzeltmesi: `wg_configured_pubkeys` artık epoch=0 (henüz hiç
            // el sıkışmamış ama yapılandırılmış) peer'ları DA içeriyor - önceden sadece
            // `epoch > 0` olan (yani en az bir kez canlı olmuş) peer'lar haritaya giriyordu,
            // bu da "wg config'inde HİÇ yok" (gerçek arıza - config drift/restart sonrası
            // kayıp) ile "henüz yeni eklendi, ilk handshake bekleniyor" (normal) durumlarını
            // ayırt edemiyordu. Aşağıdaki mutabakat (reconciliation) mantığı SADECE gerçekten
            // eksik olan peer'ları yeniden ekler.
            // `wg_query_ok`: `wg show` komutunun GERÇEKTEN başarıyla çalışıp çalışmadığını
            // ayrı olarak izler. Kod-review düzeltmesi: bunsuz, komut geçici olarak
            // başarısız olduğunda (sdwan0 henüz hazır değil, `wg` kurulu değil vb.)
            // `wg_configured_pubkeys` BOŞ kalıyor ve aşağıdaki mutabakat mantığı TÜM
            // bilinen peer'ları "eksik" sanıp her 5sn'de bir yeniden eklemeye çalışıyordu -
            // "sorguyu yapamadık" ile "sorguyu yaptık, bu peer gerçekten yok" durumları
            // ayırt edilemiyordu.
            let (wg_peers_status, wg_configured_pubkeys, wg_query_ok) = {
                let result = tokio::process::Command::new("wg")
                    .arg("show")
                    .arg("sdwan0")
                    .arg("dump")
                    .output()
                    .await;
                let query_ok = matches!(&result, Ok(o) if o.status.success());
                let out = result.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();

                // HashMap<Key (Pubkey or IP substring), LatestHandshakeEpoch>
                let mut map = std::collections::HashMap::new();
                let mut configured: std::collections::HashSet<String> = std::collections::HashSet::new();
                for line in out.lines() {
                    let parts: Vec<&str> = line.split('\t').collect();
                    if parts.len() >= 5 {
                        let pubkey = parts[0].trim();
                        let allowed_ips = parts[3].trim();
                        configured.insert(pubkey.to_string());
                        if let Ok(epoch) = parts[4].trim().parse::<u64>() {
                            if epoch > 0 {
                                map.insert(pubkey.to_string(), (pubkey.to_string(), allowed_ips.to_string(), epoch));
                            }
                        }
                    }
                }
                (map, configured, query_ok)
            };

            let mut guard = reaper_peers.write().await;

            // 1. WireGuard tünelinde el sıkışması aktif olan peer'ları guard haritasına işle
            for (pubkey, (_pk, allowed_ips, epoch)) in &wg_peers_status {
                if now.saturating_sub(*epoch) < 180 {
                    let exists = guard.values().any(|p| 
                        (!p.public_key.is_empty() && p.public_key == *pubkey) ||
                        (!p.virtual_ip.is_empty() && allowed_ips.contains(p.virtual_ip.split('/').next().unwrap_or("")))
                    );
                    if !exists {
                        guard.insert(pubkey.clone(), ConnectedPeer {
                            device_id: pubkey.clone(),
                            serial_number: "".into(),
                            model: "".into(),
                            mac_address: "".into(),
                            management_ip: "".into(),
                            lan_ip: "".into(),
                            lan_clients: vec![],
                            public_key: pubkey.clone(),
                            virtual_ip: allowed_ips.clone(),
                            last_seen: now,
                            status: "ACTIVE".into(),
                            ram_used_mb: 0,
                            ram_total_mb: 0,
                            cpu_usage_pct: 0.0,
                            rtt_ms: 0.0,
                            firewall_mode: "OPEN".into(),
                            agent_version: "".into(),
                            ota_cohort: "CANARY_5".into(),
                            tx_bytes: 0,
                            rx_bytes: 0,
                            uptime_seconds: 0,
                            tunnel_ip: "".into(),
                            active_camera_sessions: 0,
                            // `allowed_ips` "10.8.0.3/32,192.168.101.0/24" gibi virgülle
                            // ayrılmış bir liste - ilk eleman tünel /32'si, gerisi (varsa)
                            // şube LAN alt ağları.
                            local_ip_ranges: allowed_ips.split(',').skip(1).map(str::to_string).collect(),
                        });

                    }
                }
            }

            for (dev_id, peer) in guard.iter_mut() {
                // Eşleşen WG peer'ı pubkey veya IP/subnet üzerinden bul
                let peer_clean_ip = peer.virtual_ip.split('/').next().unwrap_or("").trim();
                let peer_lan_prefix = if !peer.lan_ip.is_empty() {
                    let parts: Vec<&str> = peer.lan_ip.split('.').collect();
                    if parts.len() >= 3 { format!("{}.{}.{}", parts[0], parts[1], parts[2]) } else { "".into() }
                } else { "".into() };

                let mut matched_hs_epoch: Option<u64> = None;
                let mut matched_pubkey: Option<String> = None;

                for (pubkey, (_pk, allowed_ips, epoch)) in &wg_peers_status {
                    if (!peer.public_key.is_empty() && peer.public_key == *pubkey)
                        || (!peer_clean_ip.is_empty() && allowed_ips.contains(peer_clean_ip))
                        || (!peer_lan_prefix.is_empty() && allowed_ips.contains(&peer_lan_prefix)) {
                        matched_hs_epoch = Some(*epoch);
                        matched_pubkey = Some(pubkey.clone());
                        break;
                    }
                }

                let is_wg_active = if let Some(hs_epoch) = matched_hs_epoch {
                    now.saturating_sub(hs_epoch) < 180
                } else {
                    false
                };

                if is_wg_active {
                    if let Some(pk) = matched_pubkey {
                        if peer.public_key.is_empty() {
                            peer.public_key = pk;
                        }
                    }
                    peer.last_seen = now; // Canlılık süresi güncelleniyor
                    if peer.status != "ACTIVE" {
                        info!("🔄 [WIREGUARD KERNEL FALLBACK RECOVERY]: {} WireGuard tüneli aktif, ACTIVE moduna alınıyor.", dev_id);
                        peer.status = "ACTIVE".into();
                    }
                } else {
                    let diff = now.saturating_sub(peer.last_seen);
                    if diff > 180 {
                        if peer.status != "OFFLINE" {
                            warn!("⛔ [CİHAZ ÇEVRİMDIŞI OLDU]: {} (Son Görülme: {}s önce)", dev_id, diff);
                            peer.status = "OFFLINE".into();
                        }
                    } else if diff > 60 {
                        if peer.status == "ACTIVE" {
                            warn!("⚠️ [CİHAZ HAT DALGALANMASI - DEGRADED]: {} (Son Görülme: {}s önce)", dev_id, diff);
                            peer.status = "DEGRADED".into();
                        }
                    }
                }
            }

            // 2. WireGuard Peer Mutabakatı (Reconciliation): kalıcı state'te bilinen ama
            //    `wg show` çıktısında HİÇ görünmeyen (config drift, hub restart sonrası
            //    kernel WireGuard state'inin sıfırlanması, `wg-quick down` vb. nedenlerle
            //    kaybolmuş) peer'ları tekrar `wg set` ile ekler. Önceden bu HİÇ
            //    yapılmıyordu - kayıp bir wg peer girişi, ancak agent kendi 10sn'lik
            //    watchdog'unda tüneli fark edip yeniden `/register` çağırana kadar
            //    (dakikalar sürebilir) düzelmiyordu. `wg_configured_pubkeys` (epoch=0
            //    dahil TÜM yapılandırılmış pubkey'ler) kullanılır ki henüz ilk el
            //    sıkışmasını yapmamış ama zaten yapılandırılmış normal bir peer yanlışlıkla
            //    "eksik" sanılıp gereksiz yere tekrar eklenmesin.
            //
            //    🔴 Kod-review düzeltmesi: `wg_query_ok == false` iken (yukarıdaki `wg show`
            //    sorgusunun kendisi başarısız olduğunda) mutabakat TAMAMEN atlanır - aksi
            //    halde `wg_configured_pubkeys` boş kalır, TÜM bilinen peer'lar "eksik"
            //    sanılır ve 500+ şubelik bir filoda her 5sn'de bir yüzlerce `wg set`
            //    denemesi/log spam'i sürekli tekrar eder (gerçek bir tek-seferlik
            //    mutabakat yerine sonsuz döngü). Ayrıca eksik bulunan peer'lar artık ARDIŞIK
            //    `.await` ile değil, her biri kendi `tokio::spawn` görevinde EŞZAMANLI
            //    (concurrent) olarak yeniden eklenir - reaper tick'i büyük filolarda
            //    yüzlerce sıralı subprocess çağrısı yüzünden 5sn'lik periyodu aşıp
            //    birikmesin diye.
            if wg_query_ok {
                let missing_wg_peers: Vec<(String, String, String, Vec<String>)> = guard
                    .values()
                    .filter(|p| !p.public_key.is_empty() && !wg_configured_pubkeys.contains(&p.public_key))
                    .map(|p| (p.device_id.clone(), p.public_key.clone(), p.virtual_ip.clone(), p.local_ip_ranges.clone()))
                    .collect();

                drop(guard); // wg set çağrıları .await ederken peers kilidini tutma

                for (device_id, pubkey, virtual_ip, local_ip_ranges) in missing_wg_peers {
                    tokio::spawn(async move {
                        let allowed_ips_str = build_allowed_ips(&virtual_ip, &local_ip_ranges);
                        let wg_add_cmd = format!(
                            "wg set sdwan0 peer {pubkey} allowed-ips {allowed} persistent-keepalive 25",
                            pubkey = pubkey,
                            allowed = allowed_ips_str
                        );
                        match tokio::process::Command::new("sh").arg("-c").arg(&wg_add_cmd).output().await {
                            Ok(out) if out.status.success() => {
                                warn!("🔄 [WIREGUARD PEER MUTABAKATI]: {} WireGuard config'inde eksikti, yeniden eklendi -> AllowedIPs: {}", device_id, allowed_ips_str);
                            }
                            Ok(out) => {
                                error!("🚨 [WIREGUARD PEER MUTABAKATI BAŞARISIZ]: {} -> {}", device_id, String::from_utf8_lossy(&out.stderr));
                            }
                            Err(e) => {
                                error!("🚨 [WIREGUARD PEER MUTABAKATI BAŞARISIZ]: {} -> komut çalıştırılamadı: {}", device_id, e);
                            }
                        }
                    });
                }
            } else {
                drop(guard);
                warn!("⚠️ [WIREGUARD PEER MUTABAKATI]: 'wg show sdwan0 dump' sorgusu başarısız oldu, bu tick'te mutabakat atlandı.");
            }
        }
    });

    // 🐕 Reaper Watchdog: reaper görevi normal 5sn periyodunun kat kat üzerinde (60sn,
    // geçici gecikmelerden ayırt etmek için cömert bir eşik) ilerleme kaydetmezse -
    // panik olmuş ya da askıda kalmış olabilir - süreci proaktif olarak sonlandırır ki
    // pm2/procd temiz bir durumdan yeniden başlatsın.
    tokio::spawn(async move {
        let mut check_interval = tokio::time::interval(std::time::Duration::from_secs(15));
        const REAPER_STALL_THRESHOLD_SECS: u64 = 60; // Normal periyot: 5sn
        loop {
            check_interval.tick().await;
            let age = now_unix_secs().saturating_sub(reaper_heartbeat_for_watchdog.load(std::sync::atomic::Ordering::Relaxed));
            if age > REAPER_STALL_THRESHOLD_SECS {
                error!("🚨 [WATCHDOG] Reaper görevi {} saniyedir ilerleme kaydetmiyor (askıda kalmış/panik olmuş olabilir). Süreç yeniden başlatılıyor.", age);
                std::process::exit(1);
            }
        }
    });

    // 📊 Tokio Runtime & Task Metrics Monitörü
    let _task_monitor = tokio_metrics::TaskMonitor::new();


    // 🌐 Saha Cihazlarına (netops-agent) Açık Rotalar - WireGuard tüneli/WAN üzerinden
    // gerçekten dışarıdan erişilmesi gereken TEK yüzey budur.
    let agent_routes = Router::new()
        .route("/health", get(|| async { "OK" }))
        .route("/api/v1/sdwan/register", post(register_peer))
        .route("/api/v1/sdwan/telemetry", post(receive_telemetry))
        .route("/api/v1/sdwan/commands/pending", get(get_pending_command))
        .route("/api/v1/sdwan/commands/result", post(receive_command_result));

    // 🔒 Yönetimsel Rotalar - SADECE yerel (127.0.0.1) Next.js backend'inden erişilebilir
    // (bkz. require_loopback middleware'inin yukarıdaki dokümantasyonu).
    let admin_routes = Router::new()
        .route("/api/v1/sdwan/peers", get(list_peers))
        .route("/api/v1/sdwan/peers/{id}", axum::routing::delete(delete_peer))
        .route("/api/v1/sdwan/peers/{id}/lan-clients", get(get_peer_lan_clients))
        .route("/api/v1/sdwan/commands/exec", post(exec_command_on_device))
        // 🧠 Smart Log & Threat Stream API Endpoints
        .route("/api/v1/sdwan/logs", get(get_smart_logs))
        .route("/api/v1/sdwan/threats/stream", get(stream_threat_alerts))
        .route("/api/v1/sdwan/events/stream", get(stream_hub_events))
        .route("/api/v1/sdwan/allowlist", get(get_allowlist_handler).post(add_allowlist_handler))
        // 📊 Tokio Async Runtime & Health Metrics Endpoint
        .route("/api/v1/sdwan/metrics", get(|| async {
            Json(serde_json::json!({
                "status": "HEALTHY",
                "engine": "tokio-rust-sdwan",
                "uptime_sec": 1,
            }))
        }))
        .layer(middleware::from_fn(require_loopback));

    let app = Router::new()
        .merge(agent_routes)
        .merge(admin_routes)
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&args.api_listen).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}

/// Canlı Güvenlik Loglarını ve Toplam Log Sayısını Sorgula
async fn get_smart_logs(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let limit = params.get("limit").and_then(|l| l.parse::<usize>().ok()).unwrap_or(200);
    let device_id_filter = params.get("device_id").map(|s| s.as_str());
    match state.log_engine.query_logs(limit, device_id_filter).await {
        Ok((total_count, events)) => Json(serde_json::json!({ 
            "count": total_count, 
            "returned": events.len(),
            "results": events 
        })),
        Err(e) => Json(serde_json::json!({ "count": 0, "returned": 0, "results": [], "error": e.to_string() })),
    }
}

/// Server-Sent Events (SSE) ile Gerçek Zamanlı Tehdit & Anomali Akışı
async fn stream_threat_alerts(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let rx = state.log_engine.alert_broadcast.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| {
        match msg {
            Ok(alert) => {
                let json_str = serde_json::to_string(&alert).unwrap_or_default();
                Some(Ok(Event::default().event("threat_alert").data(json_str)))
            }
            Err(_) => None,
        }
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// İzin Listesini Sorgula
async fn get_allowlist_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    let list = state.log_engine.get_allowlist().await;
    Json(serde_json::json!({ "allowlist": list }))
}

/// Yeni Domain/Kalıp İzin Listesine Ekle
#[derive(serde::Deserialize)]
struct AddAllowlistReq {
    domain: String,
}

async fn add_allowlist_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<AddAllowlistReq>,
) -> Json<serde_json::Value> {
    match state.log_engine.add_to_allowlist(&payload.domain).await {
        Ok(_) => Json(serde_json::json!({ "success": true, "message": format!("'{}' güvenli listeye eklendi.", payload.domain) })),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

async fn delete_peer(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Path(device_id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    info!("⛔ [CİHAZ YETKİSİ İPTAL EDİLDİ - REVOKED]: {}", device_id);
    state.peers.write().await.remove(&device_id);
    state.revoked_devices.write().await.insert(device_id);

    // Revoke kararı kalıcı olmalı - Hub restart olduğunda banlı cihaz sessizce
    // yeniden izinli hale gelmemeli.
    let peers_for_persist = state.peers.clone();
    let revoked_for_persist = state.revoked_devices.clone();
    tokio::spawn(async move {
        persist_peers_state(&peers_for_persist).await;
        persist_revoked_state(&revoked_for_persist).await;
    });

    Json(serde_json::json!({ "status": "revoked", "success": true }))
}

/// 500+ Şube İçin Optimize Edilmiş Hafif Liste Döndürücü (0 deep-clone of LAN clients)
async fn list_peers(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    let peers_guard = state.peers.read().await;
    let list: Vec<PeerSummary> = peers_guard.values().map(PeerSummary::from).collect();
    Json(serde_json::json!({
        "count": list.len(),
        "next": null,
        "previous": null,
        "results": list
    }))
}

/// İstenen Belirli Şubenin Canlı LAN İstemcilerini Döndüren Detay Endpoint'i
async fn get_peer_lan_clients(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Path(device_id): axum::extract::Path<String>,
) -> Json<Vec<netops_proto::LanClient>> {
    let peers = state.peers.read().await;
    let clients = peers
        .get(&device_id)
        .map(|p| p.lan_clients.clone())
        .unwrap_or_default();
    Json(clients)
}

/// tokio::sync::oneshot kanallı sıfır gecikmeli (0ms polling) komut yürütücü
/// 🔒 GÜVENLİK: Bu middleware'in koruduğu tüm rotalar SADECE aynı host üzerinde
/// çalışan (Next.js backend gibi) yerel/loopback istemcilerden erişilebilir olmalıdır.
///
/// NEDEN: `commands/exec`, `peers` (list/delete), `allowlist`, `logs`, `threats/stream`,
/// `events/stream` gibi endpoint'ler yönetimsel işlemlerdir ve YALNIZCA bu sunucuda
/// çalışan, kendi login/cookie auth'una sahip Next.js backend'i tarafından çağrılmalıdır
/// - saha cihazlarındaki (netops-agent) HİÇBİR bileşen bu endpoint'lere ihtiyaç duymaz.
/// Daha önce bu router'da tek katman (`CorsLayer::permissive()`) vardı ve bu rotalarda
/// hiçbir auth kontrolü yoktu; Hub 0.0.0.0:8088 üzerinde dinlediği ve sunucu
/// firewall'ında bu porta özel bir DROP kuralı olmadığı için (doğrulandı: iptables
/// INPUT policy ACCEPT), `commands/exec` internetten kimliksiz olarak çağrılabiliyor
/// ve hedef cihazın agent'ı bunu root olarak `sh -c` ile çalıştırıyordu (KRİTİK RCE).
///
/// NOT: `register`, `telemetry`, `commands/pending`, `commands/result` bu middleware'in
/// DIŞINDA tutulur çünkü bunlar saha cihazlarından (WireGuard tüneli/WAN üzerinden)
/// gerçekten dışarıdan çağrılması gereken tek endpoint'lerdir.
async fn require_loopback(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: axum::extract::Request,
    next: Next,
) -> Response {
    if addr.ip().is_loopback() {
        next.run(req).await
    } else {
        warn!("🚨 [YETKİSİZ ERİŞİM ENGELLENDİ]: Yönetimsel endpoint dışarıdan çağrılmaya çalışıldı: {} -> {}", addr, req.uri());
        (
            StatusCode::FORBIDDEN,
            "Bu endpoint yalnızca sunucu üzerinde çalışan yerel yönetim arayüzünden erişilebilir.",
        )
            .into_response()
    }
}

async fn exec_command_on_device(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let device_id = payload["device_id"].as_str().unwrap_or("meraki-mx64-lab-01").to_string();
    let command = payload["command"].as_str().unwrap_or("ping -c 4 8.8.8.8").to_string();
    let command_id = format!("cmd-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());

    let cmd_req = netops_proto::DiagnosticCommandRequest {
        command_id: command_id.clone(),
        device_id: device_id.clone(),
        command: command.clone(),
        control_action: None,
    };

    let (tx, rx) = tokio::sync::oneshot::channel();
    state.waiting_commands.write().await.insert(command_id.clone(), tx);

    info!("🚀 [KOMUT KUYRUĞA ALINDI]: Cihaz {} -> '{}' (ID: {})", device_id, command, command_id);
    state.pending_commands.write().await.insert(device_id.clone(), cmd_req);

    match tokio::time::timeout(std::time::Duration::from_secs(12), rx).await {
        Ok(Ok(res)) => {
            info!("✅ [GERÇEK DONANIM KOMUT ÇIKTISI ONESHOT KANALIYLA ALINDI]");
            Json(serde_json::json!({
                "status": if res.success { "success" } else { "error" },
                "output": res.output,
                "command_id": command_id
            }))
        }
        _ => {
            state.waiting_commands.write().await.remove(&command_id);
            // 🔴 CANCELSAFETY-001 DÜZELTMESİ: Önceden sadece `waiting_commands` (command_id
            // anahtarlı, sonuç için bekleyen oneshot kanalı) temizleniyordu -
            // `pending_commands` (device_id anahtarlı, cihaza TESLİM edilecek komut)
            // DOKUNULMADAN kalıyordu. Sonuç: "zaman aşımına uğradı" denen bu komut cihaz bir
            // sonraki `get_pending_command` sorgusunda hâlâ teslim alıp ÇALIŞTIRABİLİYORDU -
            // ama gerçek sonucu geldiğinde artık `waiting_commands`'ta karşılık gelen kanal
            // olmadığından sessizce kayboluyordu (operatöre hiç ulaşmıyordu). Sadece HÂLÂ AYNI
            // command_id'ye ait ise kaldırılır - aradan cihaz için yeni bir komut
            // kuyruklanmışsa onu yanlışlıkla iptal etmez.
            {
                let mut pending = state.pending_commands.write().await;
                if pending.get(&device_id).map(|c| c.command_id == command_id).unwrap_or(false) {
                    pending.remove(&device_id);
                }
            }
            Json(serde_json::json!({
                "status": "error",
                "output": "Komut zaman aşımına uğradı. Cihaz tünel bağlantısını kontrol ediniz."
            }))
        }
    }
}

/// 🔴 KRİTİK GÜVENLİK DÜZELTMESİ (2026-08-24): `commands/pending` ve
/// `commands/result` (agent_routes içinde, WAN üzerinden herkese açık) `register`/
/// `telemetry`'nin aksine HİÇBİR kimlik doğrulaması yapmıyordu. Sonuç: interneti
/// olan HERKES `GET commands/pending?device_id=<kurban>` ile o cihaza kuyruklanmış
/// bir komutu (içeriği görülebilir, tamamen ÇALINABİLİR - gerçek cihaz bir daha
/// hiç alamaz çünkü `pending.remove()` bir kez tüketilir) çalabilir, ya da
/// `command_id` tahmin edilebilir (`cmd-<unix_millis>`, dar bir zaman
/// penceresinde) olduğu için `POST commands/result` ile SAHTE bir başarı/hata
/// sonucu enjekte edip operatöre "NAC engeli kaldırıldı" / "WAN kilidi açıldı"
/// gibi GERÇEKTE OLMAMIŞ bir durumu doğru gibi gösterebilirdi (bkz.
/// `WanLockStatusUpdated` SSE yayını). Artık her iki uç da register/telemetry
/// ile aynı `verify_device_auth` deseniyle korunuyor - cihazın MAC'i, kayıt
/// anında `state.peers`'a zaten yazılmış olan değerden okunuyor.
async fn get_pending_command(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<Option<netops_proto::DiagnosticCommandRequest>> {
    let device_id = params.get("device_id").cloned().unwrap_or_default();

    if !state.shared_secret.is_empty() {
        let incoming_token = headers
            .get("X-Device-Token")
            .or_else(|| headers.get("X-NetOps-Secret"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();

        // 🔴 Kod-review düzeltmesi (2 tur): `if !incoming_token.is_empty() { verify... }`
        // deseni RESEXHAUST-001'in receive_telemetry için kapattığı AYNI kimlik doğrulama
        // atlamasıydı. İlk düzeltme turunda receive_telemetry'deki "zaten kayıtlı cihaz +
        // boş token" istisnasını buraya da kopyalamıştım - ama bu KOMUT kanalı için o
        // istisnanın hiçbir gerekçesi yok (receive_telemetry'nin aksine, bu iki endpoint'in
        // hiçbir zaman token'sız eski-ajan geçiş senaryosu olmadı - yukarıdaki
        // 2026-08-24 KRİTİK GÜVENLİK DÜZELTMESİ yorumunun kapatmayı amaçladığı "sıfır
        // kimlik doğrulama" açığının ta kendisiydi) ve saldırganın SADECE bilinen/tahmin
        // edilebilir bir device_id'ye ihtiyacı olması (kuyruklanmış komutu çalma / sahte
        // "WAN kilidi açıldı" sonucu enjekte etme) çok daha ciddi bir sonuç. Artık token
        // boş olsa da HİÇBİR istisna olmadan `is_valid` şart koşuluyor.
        let peer_mac = state.peers.read().await.get(&device_id).map(|p| p.mac_address.clone()).unwrap_or_default();
        let is_valid = netops_auth::verify_device_auth(&state.shared_secret, &device_id, &peer_mac, incoming_token);
        if !is_valid {
            warn!("🚨 [YETKİSİZ KOMUT SORGUSU ENGELLENDİ]: Cihaz {}", device_id);
            return Json(None);
        }
    }

    let mut pending = state.pending_commands.write().await;
    let cmd = pending.remove(&device_id);
    Json(cmd)
}

/// Agent'tan komut yanıtı geldiğinde oneshot kanalıyla anında tetikleme (0ms)
async fn receive_command_result(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<netops_proto::DiagnosticCommandResponse>,
) -> Json<serde_json::Value> {
    if !state.shared_secret.is_empty() {
        let incoming_token = headers
            .get("X-Device-Token")
            .or_else(|| headers.get("X-NetOps-Secret"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();

        // 🔴 Kod-review düzeltmesi (2 tur): get_pending_command ile AYNI boş-token atlama
        // açığı ve aynı sebeple istisnasız kapatıldı (bkz. o fonksiyondaki yorum) - token
        // header'ı hiç gönderilmeyen bir `POST commands/result` isteği herhangi bir
        // device_id için SAHTE bir komut sonucu enjekte edebiliyordu.
        let peer_mac = state.peers.read().await.get(&payload.device_id).map(|p| p.mac_address.clone()).unwrap_or_default();
        let is_valid = netops_auth::verify_device_auth(&state.shared_secret, &payload.device_id, &peer_mac, incoming_token);
        if !is_valid {
            warn!("🚨 [YETKİSİZ KOMUT SONUCU ENGELLENDİ]: Cihaz {} | ID: {}", payload.device_id, payload.command_id);
            return Json(serde_json::json!({ "status": "unauthorized" }));
        }
    }

    info!("📥 [GERÇEK DONANIM KOMUT ÇIKTISI ALINDI]: Cihaz {} | ID: {}", payload.device_id, payload.command_id);

    // Donanımdan onay (ACK) geldiği milisaniyede arayüze anlık SSE yayınla
    state.event_broadcaster.publish(events::HubEvent::WanLockStatusUpdated {
        device_id: payload.device_id.clone(),
        is_locked_hw: payload.success,
    });

    if let Some(tx) = state.waiting_commands.write().await.remove(&payload.command_id) {
        let _ = tx.send(payload);
    }
    Json(serde_json::json!({ "status": "acknowledged" }))
}

/// Bir peer'ın WireGuard `allowed-ips` listesini (tünel /32 IP'si + şube LAN alt ağları)
/// tutarlı bir şekilde üretir. `register_peer` (ilk kurulum) ve reaper task'ındaki
/// periyodik WireGuard peer mutabakatı (reconciliation) arasında paylaşılır - tek
/// kaynaktan üretim, ikisinin birbirinden sapmasını önler.
fn build_allowed_ips(virtual_ip: &str, local_ip_ranges: &[String]) -> String {
    let assigned_raw = virtual_ip.split('/').next().unwrap_or(virtual_ip);
    let mut allowed_ips_list = vec![format!("{}/32", assigned_raw)];
    for sub in local_ip_ranges {
        if sub.contains('/') && !sub.starts_with("127.") {
            allowed_ips_list.push(sub.clone());
        }
    }
    allowed_ips_list.join(",")
}

async fn register_peer(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PeerRegistrationRequest>,
) -> Result<Json<PeerRegistrationResponse>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    // 🛡️ Faz 3 - Backpressure: kayıt, agent başına açılışta BİR KEZ yapılan nadir bir
    // işlemdir (WG peer kurulumu, IPAM tahsisi gibi pahalı adımlar içerir) - aynı
    // device_id'den 5 saniyeden sık gelen istekler (retry fırtınası, sahte/kötü niyetli
    // istek) reddedilir.
    if !check_rate_limit(&state.rate_limiter, &format!("register:{}", payload.device_id), std::time::Duration::from_secs(5)) {
        return Err((
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "Çok sık kayıt isteği - lütfen birkaç saniye bekleyin.", "status": 429 })),
        ));
    }

    // 🔒 Cihaz Bazlı Zero-Trust Doğrulaması (Device Identity Token & Secret)
    if !state.shared_secret.is_empty() {
        let incoming_token = headers
            .get("X-Device-Token")
            .or_else(|| headers.get("X-NetOps-Secret"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();

        if !netops_auth::verify_device_auth(
            &state.shared_secret,
            &payload.device_id,
            &payload.mac_address,
            incoming_token,
        ) {
            warn!(
                "🚨 [YETKİSİZ ŞUBE KAYIT GİRİŞİMİ ENGELLENDİ]: Cihaz {} (MAC: {}) - Geçersiz Cihaz Kimliği / Token",
                payload.device_id, payload.mac_address
            );
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": "Unauthorized: Geçersiz veya yetkisiz cihaz kimlik jetonu (X-Device-Token).",
                    "status": 401
                })),
            ));
        }
    }

    if state.revoked_devices.read().await.contains(&payload.device_id) {
        warn!("⛔ [ENGELENEN CİHAZ KAYDI REDDEDİLDİ]: {}", payload.device_id);
        return Ok(Json(PeerRegistrationResponse {
            assigned_virtual_ip: "0.0.0.0".into(),
            tunnel_subnet: "".into(),
            hub_virtual_ip: "".into(),
            hub_public_key: "".into(),
            hub_endpoint: "".into(),
            keepalive_interval_secs: 0,
            status: "REVOKED".into(),
            ota_update: None,
            camera_bandwidth_ceil_kbps: 0,
        }));
    }

    info!(
        "📥 Yeni Meraki Uç Noktası Kayıt Talebi: Cihaz: {}, MAC: {}, Model: {}",
        payload.device_id, payload.mac_address, payload.model
    );

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Dinamik IPAM Havuzundan Benzersiz Sanal IP Tahsis Et (ipnet Crate ile Matematiksel Bitwise Hesaplama)
    let assigned_ip = {
        let peers_guard = state.peers.read().await;
        if let Some(existing) = peers_guard.get(&payload.device_id) {
            existing.virtual_ip.clone()
        } else {
            let network: ipnet::Ipv4Net = state.tunnel_subnet.parse().unwrap_or_else(|_| {
                "10.8.0.0/24".parse().unwrap()
            });

            let used_ips: std::collections::HashSet<std::net::Ipv4Addr> = peers_guard
                .values()
                .filter_map(|p| p.virtual_ip.split('/').next()?.parse().ok())
                .collect();

            // İlk IP (network), .1 (Hub), Spoke'lar .2'den başlar
            let mut allocated = None;
            for host_ip in network.hosts().skip(1) { // .1 hub'ı atla
                if !used_ips.contains(&host_ip) {
                    allocated = Some(format!("{}/{}", host_ip, network.prefix_len()));
                    break;
                }
            }

            allocated.unwrap_or_else(|| format!("{}/{}", network.hosts().nth(1).unwrap_or(network.addr()), network.prefix_len()))
        }
    };

    let (cohort_group, scheduled_delay_secs) = compute_ota_cohort(&payload.mac_address);

    let peer = ConnectedPeer {
        device_id: payload.device_id.clone(),
        serial_number: payload.serial_number.clone(),
        model: payload.model.clone(),
        mac_address: payload.mac_address.clone(),
        management_ip: payload.management_ip.clone(),
        lan_ip: "".into(),
        lan_clients: Vec::new(),
        public_key: payload.public_key.clone(),
        virtual_ip: assigned_ip.clone(),
        last_seen: now,
        status: "ACTIVE".into(),
        ram_used_mb: 0,
        ram_total_mb: 0,
        cpu_usage_pct: 0.0,
        rtt_ms: 0.0,
        firewall_mode: "OPEN".into(),
        agent_version: "".into(),
        ota_cohort: cohort_group.clone(),
        tx_bytes: 0,
        rx_bytes: 0,
        uptime_seconds: 0,
        tunnel_ip: "".into(),
        active_camera_sessions: 0,
        local_ip_ranges: payload.local_ip_ranges.clone(),
    };


    state.peers.write().await.insert(payload.device_id.clone(), peer);

    // Virtual IP tahsisini diske kalıcılaştır (bkz. load_persisted_peers dokümantasyonu) -
    // fire-and-forget: kayıt akışını bloklamaması için ayrı bir task'ta çalıştırılır.
    {
        let peers_for_persist = state.peers.clone();
        tokio::spawn(async move {
            persist_peers_state(&peers_for_persist).await;
        });
    }

    // 🛡️ Hub WireGuard Arayüzüne Spoke'u Otomatik Peer Olarak Ekle (Zero-Touch Hub Relay)
    if !payload.public_key.is_empty() {
        let allowed_ips_str = build_allowed_ips(&assigned_ip, &payload.local_ip_ranges);
        let wg_add_cmd = format!(
            "wg set sdwan0 peer {pubkey} allowed-ips {allowed} persistent-keepalive 25",
            pubkey = payload.public_key,
            allowed = allowed_ips_str
        );
        match tokio::process::Command::new("sh").arg("-c").arg(&wg_add_cmd).output().await {
            Ok(out) if out.status.success() => {
                info!("🔗 [HUB WIREGUARD PEER EKLENDİ]: {} ({}) -> AllowedIPs: {}", payload.device_id, payload.public_key, allowed_ips_str);
            }
            Ok(out) => {
                error!("🚨 [HUB WIREGUARD PEER EKLEME BAŞARISIZ]: {} -> {}", payload.device_id, String::from_utf8_lossy(&out.stderr));
            }
            Err(e) => {
                error!("🚨 [HUB WIREGUARD PEER EKLEME BAŞARISIZ]: {} -> komut çalıştırılamadı: {}", payload.device_id, e);
            }
        }

        // Hub Linux Routing Table'a şube alt ağlarını ekle (Merkez -> Şube LAN doğrudan L3 rotası)
        for sub in &payload.local_ip_ranges {
            if sub.contains('/') && !sub.starts_with("127.") {
                let route_cmd = format!("ip route replace {} dev sdwan0", sub);
                if let Ok(out) = tokio::process::Command::new("sh").arg("-c").arg(&route_cmd).output().await {
                    if !out.status.success() {
                        error!("🚨 [HUB ROTA EKLEME BAŞARISIZ]: {} -> {} : {}", payload.device_id, sub, String::from_utf8_lossy(&out.stderr));
                    }
                }
            }
        }
    }

    // Hub'ın tünel içi IP'sini dinamik IPAM havuzundan matematiksel olarak türet (Offset 1 = Hub Gateway)
    let hub_vip = netops_proto::Ipv4Subnet::parse(&state.tunnel_subnet)
        .map(|p| p.nth_ip(1).to_string())
        .unwrap_or_else(|| "10.8.0.1".to_string());

    Ok(Json(PeerRegistrationResponse {

        assigned_virtual_ip: assigned_ip,
        tunnel_subnet: state.tunnel_subnet.clone(),
        hub_virtual_ip: hub_vip,
        hub_public_key: state.hub_keypair.public_key_base64(),
        hub_endpoint: "".into(), // Ajan kendi discover_hub_url tabanından endpoint'i dinamik olarak çözümler
        keepalive_interval_secs: 25,
        status: "ACTIVE".into(),
        ota_update: Some(netops_proto::OtaUpdateInfo {
            target_version: (*state.agent_version).clone(),
            download_url: "/downloads/netops-agent-armv7-soft".into(),
            sha256: (*state.ota_binary_sha256).clone(),
            force_upgrade: false,
            scheduled_delay_secs,
            cohort_group,
            signature: (*state.ota_binary_signature).clone(),
        }),
        camera_bandwidth_ceil_kbps: state.camera_bandwidth_ceil_kbps,
    }))
}


async fn receive_telemetry(
    axum::extract::State(state): axum::extract::State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<TelemetryReport>,
) -> Json<netops_proto::TelemetryResponse> {
    // 🛡️ Faz 3 - Backpressure: agent'lar normalde 10 saniyede bir telemetri gönderir.
    // Aynı device_id'den 2 saniyeden sık gelen istekler (retry fırtınası veya sahte
    // istek) - DuckDB log ingest ve peer state güncellemesi gibi pahalı işler hiç
    // yapılmadan - hafif bir ACK ile hemen geri döner. 429 yerine ACK dönülüyor çünkü
    // agent tarafı 429/hata durumunda ardışık hata sayacını artırıp gereksiz
    // "self-healing" (tünel resetleme, servis restart) tetikleyebilir - burası sadece
    // hub'ın kendi CPU'sunu koruyan bir throttle, agent'a bildirilecek gerçek bir hata
    // durumu DEĞİL.
    //
    // 🔴 RESEXHAUST-001 DÜZELTMESİ: Bu limiter SADECE `device_id`'ye göre anahtarlanıyordu -
    // aşağıdaki kimlik doğrulama açığıyla birleşince, `device_id`'yi her istekte değiştiren
    // bir saldırgan bu throttle'ı tamamen atlatabiliyordu. IP bazlı ikinci bir throttle
    // ekleniyor: aynı kaynak IP'den 2 saniyeden sık gelen istekler de (device_id ne olursa
    // olsun) reddedilir.
    if !check_rate_limit(&state.rate_limiter, &format!("telemetry:{}", payload.device_id), std::time::Duration::from_secs(2))
        || !check_rate_limit(&state.rate_limiter, &format!("telemetry-ip:{}", addr.ip()), std::time::Duration::from_secs(2))
    {
        return Json(netops_proto::TelemetryResponse { status: "ACK".into(), ota_update: None });
    }

    let (cohort_group, scheduled_delay_secs) = compute_ota_cohort(&payload.mac_address);

    // 🔒 Telemetri Cihaz Kimlik Kontrolü
    if !state.shared_secret.is_empty() {
        let incoming_token = headers
            .get("X-Device-Token")
            .or_else(|| headers.get("X-NetOps-Secret"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();

        let is_valid = netops_auth::verify_device_auth(
            &state.shared_secret,
            &payload.device_id,
            &payload.mac_address,
            incoming_token,
        );

        // 🔴 RESEXHAUST-001 DÜZELTMESİ: Önceki kod `!is_valid && !incoming_token.is_empty()`
        // koşuluyla sadece "YANLIŞ token" gönderen istekleri reddediyordu - token header'ını
        // TAMAMEN ATLAYAN bir istek bu kontrolü hiç görmeden geçiyordu (kimlik doğrulama
        // atlaması).
        //
        // 🔴 Kod-review düzeltmesi (5. tur): ilk düzeltimde "zaten kayıtlı cihaz + boş
        // token" için bir istisna eklenmişti ("eski ajan geçiş senaryosu") - ama bu
        // istisna, `device_id`'si BİLİNEN/TAHMİN EDİLEBİLİR (bu dağıtımda insan-okunur
        // şube adları, örn. "ARIOT_SUBE") HERHANGİ bir saldırganın hiçbir token
        // göndermeden o cihazın TÜM telemetri verisini (mac_address, model, lan_clients,
        // firewall_mode vb.) sıfır kimlik doğrulamayla tamamen sahtelemesine izin
        // veriyordu - "Zero-Trust" güvenlik modelini fiilen etkisiz kılan bir açıktı.
        // Sahada bu istisnaya gerçekten ihtiyaç duyan bir eski ajan da yok (tek şube
        // cihazı zaten token gönderen güncel sürümde). Artık HİÇBİR istisna olmadan,
        // token boş olsa da `is_valid` şart koşuluyor - orijinal güvenlik taramasının
        // önerdiği tam düzeltme.
        if !is_valid {
            warn!(
                "🚨 [YETKİSİZ TELEMETRİ GİRİŞİMİ ENGELLENDİ]: Cihaz {} (MAC: {})",
                payload.device_id, payload.mac_address
            );
            return Json(netops_proto::TelemetryResponse {
                status: "UNAUTHORIZED".into(),
                ota_update: None,
            });
        }
    }

    if state.revoked_devices.read().await.contains(&payload.device_id) {
        return Json(netops_proto::TelemetryResponse {
            status: "REVOKED".into(),
            ota_update: None,
        });
    }

    // 🧠 Gelen Güvenlik ve Ağ Loglarını DuckDB Lakehouse Motoruna Akıt (Non-blocking Tokio Ingest)
    for event in &payload.security_events {
        state.log_engine.ingest_event(payload.device_id.clone(), payload.model.clone(), event.clone()).await;
    }

    let mut peers_guard = state.peers.write().await;

    // 🔴 RESEXHAUST-001 DÜZELTMESİ: `state.peers`'ın hiçbir üst sınırı yoktu - kimlik
    // doğrulaması atlatılıp atlatılamadığından bağımsız olarak (savunma derinliği), asla
    // görülmemiş bir `device_id` için yeni kayıt oluşturmak `max_peers`'ı aşacaksa reddedilir.
    if !peers_guard.contains_key(&payload.device_id) && peers_guard.len() >= state.max_peers {
        warn!(
            "🚨 [PEER TAVANI AŞILDI]: max_peers={} sınırına ulaşıldı, yeni cihaz {} reddedildi",
            state.max_peers, payload.device_id
        );
        return Json(netops_proto::TelemetryResponse { status: "ACK".into(), ota_update: None });
    }

    if let Some(peer) = peers_guard.get_mut(&payload.device_id) {
        peer.last_seen = payload.timestamp;
        peer.ram_used_mb = payload.ram_used_mb;
        peer.ram_total_mb = payload.ram_total_mb;
        peer.cpu_usage_pct = payload.cpu_usage_pct;
        peer.rtt_ms = payload.rtt_ms;
        peer.tx_bytes = payload.tx_bytes;
        peer.rx_bytes = payload.rx_bytes;
        peer.uptime_seconds = payload.uptime_seconds;
        if !payload.tunnel_ip.is_empty() {
            peer.tunnel_ip = payload.tunnel_ip.clone();
        }
        peer.active_camera_sessions = payload.active_camera_sessions;
        peer.mac_address = payload.mac_address;
        peer.model = payload.model;
        peer.management_ip = payload.management_ip;
        if !payload.lan_ip.is_empty() {
            peer.lan_ip = payload.lan_ip.clone();
        }
        peer.lan_clients = payload.lan_clients.clone();
        peer.firewall_mode = payload.firewall_mode.clone();
        if !payload.agent_version.is_empty() {
            peer.agent_version = payload.agent_version.clone();
        }
        peer.ota_cohort = cohort_group.clone();
        peer.status = "ACTIVE".into();
    } else {
        // NOT (Sıfır Hardcode): Alt ağ prefix uzunluğu ARTIK state.tunnel_subnet'ten
        // dinamik okunuyor. Önceki kod her zaman "/24" ekliyordu; Hub'ın havuzu /16'ya
        // çıkarıldığında (bkz. --tunnel-subnet varsayılanı) bu yol hâlâ /24 etiketli
        // adresler üretmeye devam ederdi - yanlış maskeli, tutarsız bir rota/adres.
        let (base_subnet, prefix_len) = {
            let mut parts = state.tunnel_subnet.split('/');
            let net = parts.next().unwrap_or("10.8.0.0");
            let plen = parts.next().unwrap_or("16");
            (net, plen)
        };
        let prefix_parts: Vec<&str> = base_subnet.split('.').collect();
        let base_prefix = if prefix_parts.len() >= 3 {
            format!("{}.{}.{}", prefix_parts[0], prefix_parts[1], prefix_parts[2])
        } else {
            "10.8.0".to_string()
        };

        let used_octets: std::collections::HashSet<u8> = peers_guard.values().filter_map(|p| {
            let ip_str = p.virtual_ip.split('/').next().unwrap_or("");
            ip_str.split('.').last().and_then(|octet| octet.parse::<u8>().ok())
        }).collect();

        let mut next_octet = 2u8;
        while used_octets.contains(&next_octet) && next_octet < 254 {
            next_octet += 1;
        }
        let dynamic_ip = format!("{}.{}/{}", base_prefix, next_octet, prefix_len);

        peers_guard.insert(
            payload.device_id.clone(),
            ConnectedPeer {
                device_id: payload.device_id.clone(),
                serial_number: payload.serial_number,
                model: payload.model,
                mac_address: payload.mac_address,
                management_ip: payload.management_ip,
                lan_ip: payload.lan_ip,
                lan_clients: payload.lan_clients,
                public_key: "".into(),
                virtual_ip: dynamic_ip,
                last_seen: payload.timestamp,
                status: "ACTIVE".into(),
                ram_used_mb: payload.ram_used_mb,
                ram_total_mb: payload.ram_total_mb,
                cpu_usage_pct: payload.cpu_usage_pct,
                rtt_ms: payload.rtt_ms,
                firewall_mode: payload.firewall_mode,
                agent_version: payload.agent_version,
                ota_cohort: cohort_group.clone(),
                tx_bytes: payload.tx_bytes,
                rx_bytes: payload.rx_bytes,
                uptime_seconds: payload.uptime_seconds,
                tunnel_ip: payload.tunnel_ip.clone(),
                active_camera_sessions: payload.active_camera_sessions,
                local_ip_ranges: Vec::new(),
            },
        );

        // Bu yeni cihaz kaydını da kalıcılaştır (bkz. register_peer'daki aynı desen) -
        // aksi halde SADECE /register üzerinden gelen kayıtlar restart'tan sağ çıkardı;
        // Hub restart olduğunda ve cihaz henüz yeniden /register çağırmadan önce
        // /telemetry göndermeye devam ettiğinde (agent'lar registration'ı yalnızca KENDİ
        // başlangıçlarında bir kez yapar, Hub restart'ında otomatik tekrar etmezler) bu
        // dal tetiklenir ve önceki sürümde HİÇ persist edilmiyordu.
        let peers_for_persist = state.peers.clone();
        drop(peers_guard);
        tokio::spawn(async move {
            persist_peers_state(&peers_for_persist).await;
        });
        return Json(netops_proto::TelemetryResponse {
            status: "ACK".into(),
            ota_update: Some(netops_proto::OtaUpdateInfo {
                target_version: (*state.agent_version).clone(),
                download_url: "/downloads/netops-agent-armv7-soft".into(),
                sha256: (*state.ota_binary_sha256).clone(),
                force_upgrade: false,
                scheduled_delay_secs,
                cohort_group,
                signature: (*state.ota_binary_signature).clone(),
            }),
        });
    }



    Json(netops_proto::TelemetryResponse {
        status: "ACK".into(),
        ota_update: Some(netops_proto::OtaUpdateInfo {
            target_version: (*state.agent_version).clone(),
            download_url: "/downloads/netops-agent-armv7-soft".into(),
            sha256: (*state.ota_binary_sha256).clone(),
            force_upgrade: false,
            scheduled_delay_secs,
            cohort_group,
            signature: (*state.ota_binary_signature).clone(),
        }),
    })

}

async fn stream_hub_events(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::response::sse::Sse<impl futures_util::stream::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>> {
    events::sse_events_handler(state.event_broadcaster.clone()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use netops_proto::{PeerRegistrationRequest, TelemetryReport};

    /// Faz 0 - Test Altyapısı: netops-hub tek bir binary crate (lib.rs yok), bu yüzden
    /// tam bir HTTP/Router katmanı kurmak yerine handler fonksiyonlarını (register_peer,
    /// receive_telemetry) DOĞRUDAN çağırıyoruz - aynı modülde oldukları için private
    /// state'e erişebiliyoruz. Bu, önceki tüm doğrulamaların SSH ile production'da elle
    /// yapılmasının yerini alacak ilk otomatik regresyon testi seti.
    fn test_state() -> AppState {
        let unique = format!(
            "{}_{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        );
        let db_dir = std::env::temp_dir().join(format!("netops_hub_test_{}", unique));
        std::fs::create_dir_all(&db_dir).unwrap();

        AppState {
            hub_keypair: Arc::new(KeyPair::generate()),
            peers: Arc::new(RwLock::new(std::collections::HashMap::new())),
            revoked_devices: Arc::new(RwLock::new(std::collections::HashSet::new())),
            pending_commands: Arc::new(RwLock::new(std::collections::HashMap::new())),
            waiting_commands: Arc::new(RwLock::new(std::collections::HashMap::new())),
            tunnel_subnet: "10.8.0.0/16".to_string(),
            shared_secret: Arc::new(String::new()),
            log_engine: SmartLogEngine::new(db_dir.to_str().unwrap()).unwrap(),
            event_broadcaster: Arc::new(events::HubEventBroadcaster::new(10)),
            ota_binary_sha256: Arc::new(String::new()),
            ota_binary_signature: Arc::new(String::new()),
            agent_version: Arc::new("0.4.9".to_string()),
            camera_bandwidth_ceil_kbps: 0,
            rate_limiter: Arc::new(dashmap::DashMap::new()),
            max_peers: 5000,
        }
    }

    fn dummy_reg_request(device_id: &str) -> PeerRegistrationRequest {
        serde_json::from_value(serde_json::json!({
            "device_id": device_id,
            "serial_number": "TEST-SERIAL",
            "model": "Cisco Meraki MX64",
            "mac_address": "AA:BB:CC:DD:EE:FF",
            "management_ip": "192.168.100.10",
            "public_key": "dGVzdC1wdWJsaWMta2V5LTMyLWJ5dGVzLWxvbmchISE=",
            "local_ip_ranges": ["192.168.101.0/24"],
            "tunnel_listen_port": 51820,
            "agent_version": "0.4.9"
        })).unwrap()
    }

    fn dummy_telemetry(device_id: &str) -> TelemetryReport {
        serde_json::from_value(serde_json::json!({
            "device_id": device_id,
            "serial_number": "TEST-SERIAL",
            "model": "Cisco Meraki MX64",
            "mac_address": "AA:BB:CC:DD:EE:FF",
            "management_ip": "192.168.100.10",
            "timestamp": 1_700_000_000u64,
            "cpu_usage_pct": 1.0,
            "ram_used_mb": 64,
            "ram_total_mb": 2048,
            "active_wan_interface": "wan",
            "rtt_ms": 10.0,
            "jitter_ms": 0.5,
            "packet_loss_pct": 0.0,
            "tx_bytes": 0,
            "rx_bytes": 0
        })).unwrap()
    }

    /// 🔒 Reddedilmiş (revoked) bir cihaz, geçerli bir şeye benzeyen (ama işlevsiz)
    /// 0.0.0.0 IP'si ve "REVOKED" durumuyla yanıt almalı, ASLA gerçek bir tünel IP'si
    /// veya OTA bilgisi almamalı.
    #[tokio::test]
    async fn revoked_device_registration_is_rejected() {
        let state = test_state();
        state.revoked_devices.write().await.insert("revoked-device-1".to_string());

        let req = dummy_reg_request("revoked-device-1");
        let result = register_peer(
            axum::extract::State(state),
            axum::http::HeaderMap::new(),
            axum::extract::Json(req),
        ).await;

        let response = result.expect("revoked cihaz için Err değil, REVOKED status'lu Ok dönmeli").0;
        assert_eq!(response.status, "REVOKED");
        assert_eq!(response.assigned_virtual_ip, "0.0.0.0");
        assert!(response.ota_update.is_none());
    }

    /// 🔒 `shared_secret` yapılandırılmışsa, geçersiz/eksik token'lı bir kayıt isteği
    /// 401 Unauthorized ile reddedilmeli - Zero-Trust katmanının en temel garantisi.
    #[tokio::test]
    async fn registration_without_valid_token_is_unauthorized_when_secret_configured() {
        let mut state = test_state();
        state.shared_secret = Arc::new("test-shared-secret".to_string());

        let req = dummy_reg_request("some-device");
        let result = register_peer(
            axum::extract::State(state),
            axum::http::HeaderMap::new(), // Token yok
            axum::extract::Json(req),
        ).await;

        let err = result.expect_err("secret yapılandırılmışken token'sız istek reddedilmeli");
        assert_eq!(err.0, axum::http::StatusCode::UNAUTHORIZED);
    }

    /// 🌐 İki farklı cihaz kaydolduğunda IPAM havuzundan İKİ FARKLI sanal IP almalı -
    /// IP çakışması (aynı virtual_ip'nin iki cihaza atanması) tünel içi trafiğin
    /// sessizce karışmasına yol açacak en ciddi hatalardan biridir.
    #[tokio::test]
    async fn two_devices_get_distinct_virtual_ips() {
        let state = test_state();

        let req_a = dummy_reg_request("device-a");
        let resp_a = register_peer(
            axum::extract::State(state.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::Json(req_a),
        ).await.unwrap().0;

        let mut req_b = dummy_reg_request("device-b");
        req_b.public_key = "YW5vdGhlci10ZXN0LXB1YmxpYy1rZXktMzI=".to_string();
        let resp_b = register_peer(
            axum::extract::State(state.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::Json(req_b),
        ).await.unwrap().0;

        assert_ne!(resp_a.assigned_virtual_ip, resp_b.assigned_virtual_ip);
        assert_eq!(state.peers.read().await.len(), 2);
    }

    /// 📊 Kayıtlı bir cihazdan gelen telemetri, mevcut peer kaydını günceller (yeni bir
    /// tane oluşturmaz) ve durumunu ACTIVE yapar - bu, dashboard'un "kaç cihaz var"
    /// sayısının telemetri akışıyla kendiliğinden şişmemesini garanti eder.
    #[tokio::test]
    async fn telemetry_updates_existing_peer_not_duplicate() {
        let state = test_state();
        let req = dummy_reg_request("device-c");
        let _ = register_peer(
            axum::extract::State(state.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::Json(req),
        ).await.unwrap();
        assert_eq!(state.peers.read().await.len(), 1);

        let telemetry = dummy_telemetry("device-c");
        let _ = receive_telemetry(
            axum::extract::State(state.clone()),
            axum::extract::ConnectInfo("127.0.0.1:9000".parse().unwrap()),
            axum::http::HeaderMap::new(),
            axum::extract::Json(telemetry),
        ).await;

        assert_eq!(state.peers.read().await.len(), 1, "telemetri yeni bir peer kaydı OLUŞTURMAMALI");
        let peer = state.peers.read().await.get("device-c").unwrap().clone();
        assert_eq!(peer.status, "ACTIVE");
    }

    /// 🛡️ Faz 3 - Backpressure: bir cihazın hemen art arda (gerçek dünyada bir retry
    /// fırtınası veya kötü niyetli akış olabilir) telemetri göndermesi hub'ın pahalı
    /// işlerini (peer state güncelleme, log ingest) tekrar tekrar tetiklememeli - ikinci
    /// istek anında bir ACK ile geri dönmeli, `last_seen`'i GÜNCELLEMEMELİ.
    #[tokio::test]
    async fn telemetry_flood_from_same_device_is_throttled() {
        let state = test_state();
        let reg = dummy_reg_request("flood-device");
        let _ = register_peer(
            axum::extract::State(state.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::Json(reg),
        ).await.unwrap();

        let mut t1 = dummy_telemetry("flood-device");
        t1.timestamp = 1000;
        let _ = receive_telemetry(
            axum::extract::State(state.clone()),
            axum::extract::ConnectInfo("127.0.0.1:9001".parse().unwrap()),
            axum::http::HeaderMap::new(),
            axum::extract::Json(t1),
        ).await;
        let last_seen_after_first = state.peers.read().await.get("flood-device").unwrap().last_seen;
        assert_eq!(last_seen_after_first, 1000);

        // Aynı anda (throttle penceresi içinde) ikinci istek - last_seen DEĞİŞMEMELİ,
        // yani hub bu isteği gerçekten işlemedi.
        let mut t2 = dummy_telemetry("flood-device");
        t2.timestamp = 2000;
        let _ = receive_telemetry(
            axum::extract::State(state.clone()),
            axum::extract::ConnectInfo("127.0.0.1:9001".parse().unwrap()),
            axum::http::HeaderMap::new(),
            axum::extract::Json(t2),
        ).await;
        let last_seen_after_second = state.peers.read().await.get("flood-device").unwrap().last_seen;
        assert_eq!(last_seen_after_second, 1000, "throttle penceresi içindeki istek işlenmemeli");
    }

    #[test]
    fn check_rate_limit_allows_first_then_blocks_immediate_repeat() {
        let limiter: dashmap::DashMap<String, std::time::Instant> = dashmap::DashMap::new();
        let window = std::time::Duration::from_secs(60);
        assert!(check_rate_limit(&limiter, "device-x", window), "ilk istek kabul edilmeli");
        assert!(!check_rate_limit(&limiter, "device-x", window), "hemen tekrar eden istek reddedilmeli");
        assert!(check_rate_limit(&limiter, "device-y", window), "farklı bir anahtar etkilenmemeli");
    }
}

/// Cihaz başına hız sınırlaması: `key` için son kabul edilen istekten bu yana
/// `min_interval` geçmemişse `false` (reddet) döner, geçmişse zaman damgasını
/// günceller ve `true` (kabul) döner. Saf/deterministik değil (gerçek zaman ve
/// paylaşımlı state kullanıyor) ama tek bir DashMap girişi üzerinden çalıştığı için
/// kilit çekişmesi (lock contention) minimaldir - 500+ cihaz için ölçeklenir.
fn check_rate_limit(
    limiter: &dashmap::DashMap<String, std::time::Instant>,
    key: &str,
    min_interval: std::time::Duration,
) -> bool {
    let now = std::time::Instant::now();
    // 🔴 KRİTİK: `limiter.get(key)`'in döndürdüğü `Ref` guard, aynı `match` ifadesi
    // içinde `insert()` çağrılırken HÂLÂ CANLIYSA (Rust'ın geçici ömür uzatması
    // yüzünden bir `match` bloğunun sonuna kadar yaşar), DashMap aynı shard için hem
    // okuma hem yazma kilidi almaya çalışır - bu bir DEADLOCK'tur ve production'da
    // HUB'IN TAMAMEN ASKIDA KALMASINA yol açtı (tüm istekler, /peers dahil, donuyordu).
    // Düzeltme: `Ref` guard'ı `insert()` çağrılmadan ÖNCE, `if let` bloğunun kapanışıyla
    // açıkça serbest bırakılıyor.
    let is_throttled = if let Some(last) = limiter.get(key) {
        now.duration_since(*last) < min_interval
    } else {
        false
    };
    if is_throttled {
        return false;
    }
    limiter.insert(key.to_string(), now);
    true
}

fn compute_ota_cohort(mac_or_id: &str) -> (String, u64) {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&mac_or_id, &mut hasher);
    let hash = std::hash::Hasher::finish(&hasher);
    let bucket = (hash % 100) as u64;

    if bucket < 5 {
        // Kanarya Grubu (%5) - Anında İndirme (0s gecikme)
        ("CANARY_5".to_string(), 0)
    } else if bucket < 25 {
        // Pilot Grubu (%20) - 300-600s arası hafif gecikme
        ("PILOT_25".to_string(), 300 + (bucket % 300))
    } else {
        // Genel Fleot (%75) - 600-3600s arası rastgele jitter yayılımı
        ("FLEET_100".to_string(), 600 + (bucket * 30))
    }
}


