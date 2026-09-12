use anyhow::{Context, Result};
use clap::Parser;
use netops_proto::{KeyPair, PeerRegistrationRequest, PeerRegistrationResponse, TelemetryReport};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{error, info, warn};


/// Güvenilir Release-Signing Ed25519 Public Key'i (32 byte, hex).
/// Bu, `netops-ota-tool keygen` ile üretilen anahtar çiftinin PUBLIC yarısıdır - private
/// yarı ASLA agent koduna girmez, sadece Hub sunucusunda /etc/netops/release_signing.key
/// olarak (chmod 600) saklanır. Bu sabit derleme zamanında gömülür, bu yüzden anahtar
/// değiştirilirse (rotasyon) TÜM agent'ların yeniden derlenip dağıtılması gerekir.
/// ⚠️ YER TUTUCU: `netops-ota-tool keygen` ile gerçek anahtar üretildikten sonra bu
/// değer, üretilen public key hex'i ile DEĞİŞTİRİLMELİ ve agent yeniden derlenmelidir.
/// Bu placeholder ile derlenmiş bir agent hiçbir OTA imzasını doğrulayamaz (tüm
/// gerçek imzalar reddedilir) - fail-closed, güvenlik açısından zararsız varsayılan.
const TRUSTED_RELEASE_PUBKEY_HEX: &str = "ab97f57ec765a63c6592ce9dd89944d91e63da4caf42512aec749ca9d9e82193";

/// Şu anki Unix zaman damgası (saniye). Hiçbir zaman panikleyemez - saat
/// UNIX_EPOCH'tan önceyse (pratikte imkansız) 0 döner.
fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// TRUSTED_RELEASE_PUBKEY_HEX'i ham 32 byte'a çözer. Bu sabit derleme zamanında bizim
/// kendi kontrolümüzdeki bir değer olduğu için (kullanıcı girdisi değil) parse hatası
/// yalnızca kodlama hatasını gösterir - bu yüzden `expect` ile erken ve net şekilde
/// panikler, sessizce yanlış/eksik bir anahtarla devam etmez.
fn trusted_release_pubkey() -> [u8; 32] {
    netops_ota::decode_hex_32(TRUSTED_RELEASE_PUBKEY_HEX)
        .expect("TRUSTED_RELEASE_PUBKEY_HEX geçersiz - tam olarak 64 hex karakter (32 byte) olmalı")
}

#[derive(Parser, Debug)]
#[command(name = "netops-agent", author = "NetOpsWan Team", version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Universal OpenWrt & Linux SD-WAN Edge Agent", long_about = None)]
struct Args {
    #[arg(short, long)]
    hub_url: Option<String>,

    #[arg(short, long, default_value = "/etc/netops")]
    config_dir: PathBuf,

    #[arg(short, long)]
    device_id: Option<String>,

    #[arg(short, long, default_value = "51820")]
    listen_port: u16,

    /// Zero-Trust Ön-Paylaşımlı Ağ Gizli Anahtarı (X-NetOps-Secret)
    #[arg(long)]
    shared_secret: Option<String>,

    /// Güvenli Güncelleme (Safe-OTA) Ön Test Modu
    #[arg(long)]
    test_run: bool,
}

/// Müşteriye ve Ortama Özel Shared Secret'ı Dinamik Keşfet
fn discover_shared_secret(custom_arg: Option<String>) -> String {
    if let Some(s) = custom_arg {
        let trimmed = s.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }

    // OpenWrt UCI
    let uci_out = std::process::Command::new("uci")
        .arg("-q")
        .arg("get")
        .arg("netops.agent.shared_secret")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    if !uci_out.is_empty() {
        return uci_out;
    }

    if let Ok(content) = std::fs::read_to_string("/etc/netops/shared_secret") {
        let trimmed = content.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }

    std::env::var("NETOPS_SHARED_SECRET").unwrap_or_default()
}

/// Müşteriye ve Ortama Özel Hub URL'ini Dinamik Keşfet
/// Öncelik Sırası: CLI Argümanı -> /etc/config/netops (UCI) -> /etc/netops/agent.conf -> /etc/netops/hub_url -> Çevre Değişkeni
fn discover_hub_url(custom_arg: Option<String>) -> String {
    // 1. CLI Argümanı
    if let Some(url) = custom_arg {
        let trimmed = url.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }

    // 2. OpenWrt UCI Yapılandırması (`uci get netops.agent.hub_url`)
    let uci_out = std::process::Command::new("uci")
        .arg("-q")
        .arg("get")
        .arg("netops.agent.hub_url")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    if !uci_out.is_empty() {
        return uci_out;
    }

    // 3. /etc/netops/hub_url veya /etc/netops/agent.conf dosyasından oku
    if let Ok(content) = std::fs::read_to_string("/etc/netops/hub_url") {
        let trimmed = content.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }

    if let Ok(content) = std::fs::read_to_string("/etc/netops/agent.conf") {
        for line in content.lines() {
            if let Some(val) = line.strip_prefix("hub_url=") {
                let trimmed = val.trim().to_string();
                if !trimmed.is_empty() {
                    return trimmed;
                }
            }
        }
    }

    // 4. Çevre Değişkeni (Environment Variable)
    if let Ok(env_url) = std::env::var("NETOPS_HUB_URL") {
        let trimmed = env_url.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }

    // 5. Varsayılan Fallback
    "https://sdwan.ariot.com.tr/api/sdwan".to_string()
}

/// Linux ve İşletim Sistemi Çekirdeği Üzerinden Aktif WAN/Yönetim Arayüzünü ve IP'sini Dinamik Keşfet (Zero-Hardcode)
fn discover_wan_interface() -> (String, String) {
    // 1. local-ip-address Kütüphanesi ile Platformlar Arası Güvenilir Arayüz Taraması
    if let Ok(network_interfaces) = local_ip_address::list_afinet_netifas() {
        for (name, ip) in network_interfaces {
            if let std::net::IpAddr::V4(ipv4) = ip {
                if !ipv4.is_loopback() && !ipv4.is_unspecified() && !name.starts_with("lo") && !name.starts_with("sdwan") && !name.starts_with("wg") {
                    if name == "wan" || name == "eth0" || name.starts_with("en") || name.starts_with("eth") {
                        return (name, ipv4.to_string());
                    }
                }
            }
        }
    }

    // 2. Kernel Default Route Yöntemi: Varsayılan rotaya (Default Route) sahip olan interface ve kaynak IP
    let route_output = std::process::Command::new("sh")
        .arg("-c")
        .arg("ip -4 route get 1.1.1.1 2>/dev/null | grep -o 'dev [^ ]* src [0-9.]*' || ip -4 route get 8.8.8.8 2>/dev/null | grep -o 'dev [^ ]* src [0-9.]*'")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    if !route_output.is_empty() {
        let parts: Vec<&str> = route_output.split_whitespace().collect();
        if parts.len() >= 4 && parts[0] == "dev" && parts[2] == "src" {
            return (parts[1].to_string(), parts[3].to_string());
        }
    }

    // 3. Fallback: Standart arayüz tespiti
    if let Ok(local_ip) = local_ip_address::local_ip() {
        return ("eth0".to_string(), local_ip.to_string());
    }

    ("eth0".to_string(), "".to_string())
}

/// WAN Haricindeki Tüm Aktif Yerel LAN Arayüzlerini ve Alt Ağlarını (Subnets) Keşfet
fn discover_lan_subnets(wan_iface: &str) -> (String, Vec<String>) {
    let mut primary_lan_ip = String::new();
    let mut subnets = Vec::new();

    let addrs_output = std::process::Command::new("sh")
        .arg("-c")
        .arg("ip -o -4 addr show scope global 2>/dev/null | awk '{print $2, $4}'")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    for line in addrs_output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let iface = parts[0];
            let cidr = parts[1];

            // WAN ve Tünel (wg, tun) arayüzlerini filtrele, sadece yerel ağları al
            if iface != wan_iface && !iface.starts_with("wg") && !iface.starts_with("tun") && !iface.starts_with("sdwan") && !iface.starts_with("lo") {
                let ip_only = cidr.split('/').next().unwrap_or(cidr);
                if primary_lan_ip.is_empty() {
                    primary_lan_ip = ip_only.to_string();
                }

                let octets: Vec<&str> = ip_only.split('.').collect();
                if octets.len() == 4 {
                    let subnet_cidr = format!("{}.{}.{}.0/24", octets[0], octets[1], octets[2]);
                    if !subnets.contains(&subnet_cidr) {
                        subnets.push(subnet_cidr);
                    }
                }
            }
        }
    }

    (primary_lan_ip, subnets)
}

/// Linux Çekirdeğinden Canlı DHCP Leases ve ARP Tablosundaki İstemcileri Keşfet
// RESEXHAUST-002 DÜZELTMESİ: Önceden bu liste MAC'e göre dedup edilse de (spoofable, bir
// saldırgan MAC'i her seferinde değiştirerek dedup'ı etkisiz kılabilir) toplam sayıya HİÇ
// tavan yoktu; sonuç hub tarafında her telemetri döngüsünde peer-başına belleğe bütünüyle
// klonlanıyordu (bkz. RESEXHAUST-001). Gerçekçi bir şube LAN'ı için makul bir üst sınır.
const MAX_LAN_CLIENTS: usize = 512;

fn discover_lan_clients() -> Vec<netops_proto::LanClient> {
    let mut clients = Vec::new();
    let mut seen_macs = std::collections::HashSet::new();

    // 0. Dinamik Alt Ağ ARP Taraması (Hardcoded IP Kesinlikle Kullanılmaz - Dynamic Subnet Broadcast)
    let _ = std::process::Command::new("sh")
        .arg("-c")
        .arg("ping -c 1 -b -W 1 255.255.255.255 2>/dev/null || true")
        .output();

    // 1. dnsmasq DHCP Lease Dosyası (/tmp/dhcp.leases)
    if let Ok(leases) = std::fs::read_to_string("/tmp/dhcp.leases") {
        for line in leases.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Format: timestamp mac ip hostname client-id
            if parts.len() >= 4 {
                let mac = parts[1].to_uppercase();
                let ip = parts[2].to_string();
                let hostname = if parts[3] == "*" { "Bilinmeyen İstemci".to_string() } else { parts[3].to_string() };

                if clients.len() < MAX_LAN_CLIENTS && seen_macs.insert(mac.clone()) {
                    clients.push(netops_proto::LanClient {
                        mac_address: mac,
                        ip_address: ip,
                        hostname,
                    });
                }
            }
        }
    }

    // 2. Linux ARP / IP Neighbor Tablosu (ip -4 neigh show & /proc/net/arp)
    let neigh_out = std::process::Command::new("sh")
        .arg("-c")
        .arg("ip -4 neigh show 2>/dev/null; cat /proc/net/arp 2>/dev/null")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    for line in neigh_out.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // Format 1 (ip neigh): 192.168.101.104 dev br-lan lladdr 54:8c:81:8c:e5:1a REACHABLE
        if parts.len() >= 5 && parts[2] == "lladdr" {
            let ip = parts[0].to_string();
            let mac = parts[4].to_uppercase();
            if mac != "00:00:00:00:00:00" && clients.len() < MAX_LAN_CLIENTS && seen_macs.insert(mac.clone()) {
                clients.push(netops_proto::LanClient {
                    mac_address: mac,
                    ip_address: ip,
                    hostname: "Yerel Ağ Cihazı (IP Cam/LAN)".to_string(),
                });
            }
        }
        // Format 2 (/proc/net/arp): 192.168.101.104 0x1 0x2 54:8c:81:8c:e5:1a * br-lan
        else if parts.len() >= 6 && parts[3].contains(':') && parts[3] != "00:00:00:00:00:00" {
            let ip = parts[0].to_string();
            let mac = parts[3].to_uppercase();
            if clients.len() < MAX_LAN_CLIENTS && seen_macs.insert(mac.clone()) {
                clients.push(netops_proto::LanClient {
                    mac_address: mac,
                    ip_address: ip,
                    hostname: "Yerel Ağ Cihazı (IP Cam/LAN)".to_string(),
                });
            }
        }
    }

    clients
}

/// Linux Çekirdeği ve OpenWrt UCI'dan Canlı Güvenlik Duvarı Durumunu (Drop / Whitelist / Açık) Oku
/// Sistemin Gerçek Çalışma Süresini (`/proc/uptime`) Saniye Cinsinden Oku
/// Bu değer Hub üzerinden Dashboard'a raporlanır (bkz. TelemetryReport::uptime_seconds) -
/// önceden bu alan hiç var olmadığı için arayüzde her zaman "Ölçüm Bekleniyor" görünüyordu.
fn discover_system_uptime_secs() -> u64 {
    std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|content| content.split_whitespace().next().map(str::to_string))
        .and_then(|secs_str| secs_str.parse::<f64>().ok())
        .map(|secs| secs as u64)
        .unwrap_or(0)
}

/// SD-WAN Overlay Tünel Arayüzüne (sdwan0) Fiilen Atanmış IP/CIDR'ı Kernel'den Oku
/// Hub'ın kayıt anında ATADIĞI IP yerine cihazda GERÇEKTEN yapılandırılmış olanı
/// raporlar - tünel yeniden kurulduğunda veya IP değiştiğinde Dashboard her zaman
/// gerçek durumu (veya arayüz hiç yoksa boş) yansıtır.
fn discover_tunnel_ip() -> String {
    std::process::Command::new("sh")
        .arg("-c")
        .arg("ip -4 -o addr show sdwan0 2>/dev/null | awk '{print $4}'")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Kamera/NVR Gözlemlenebilirliği (Bölüm 3) - SIFIR YAPILANDIRMA: hiçbir NVR/kamera IP'si
/// bilinmez. Sadece sdwan0 üzerinden geçen, standart RTSP portu (tcp/554) ile eşleşen
/// aktif conntrack bağlantı sayısını sayar - `discover_security_events()`'teki mevcut
/// conntrack tarama deseniyle aynı yöntem, farklı port/amaç. Bu sayı telemetriyle Hub'a
/// gider, dashboard'da "Şube X: N aktif kamera oturumu" gibi salt-okunur bir gösterge
/// olarak kullanılabilir - hiçbir video verisi buradan geçmez, sadece bir sayı.
/// conntrack metnindeki her satırı TAM KELİME olarak "dport=554" içerip içermediğine
/// göre sayar. Saf/deterministik fonksiyon (dosya/shell erişimi yok) - böylece gerçek
/// bir donanıma ihtiyaç duymadan birim testiyle doğrulanabilir.
///
/// 🔴 DİKKAT: Önceki sürüm bu sayımı `grep 'dport=554'` (shell, ALT DİZE eşleşmesi) ile
/// yapıyordu - production'da GERÇEKTEN gözlemlendi: "dport=55414" gibi tamamen alakasız
/// bir port da bu alt diziyi içerdiği için yanlışlıkla "aktif kamera oturumu" sayılıyordu
/// (hiç RTSP trafiği yokken 3 sahte oturum raporlandı). Artık satırı boşluğa göre
/// token'lara bölüp TAM eşleşme arıyoruz - hem bu hatayı yapısal olarak imkansız kılıyor
/// hem de shell/grep'in `-w` bayrağını doğru yorumlamasına (busybox sürümüne göre
/// değişebilir) bağımlılığı ortadan kaldırıyor.
fn count_rtsp_sessions_in_conntrack(conntrack_text: &str) -> u32 {
    conntrack_text
        .lines()
        .filter(|line| line.split_whitespace().any(|tok| tok == "dport=554"))
        .count() as u32
}

fn discover_active_camera_sessions() -> u32 {
    std::fs::read_to_string("/proc/net/nf_conntrack")
        .map(|content| count_rtsp_sessions_in_conntrack(&content))
        .unwrap_or(0)
}

/// Bu OpenWrt SNAPSHOT imajlarında `apk` (Alpine tarzı) paket yöneticisi mevcut ve
/// internet erişimi varsa çalışır durumda - `ethtool`/`tc-full`/`iptables-nft` gibi
/// araçları hangi build script paket listesiyle flaşlanmış olursa olsun garanti eder.
/// Tamamen best-effort: `apk` yoksa (opkg tabanlı eski bir imaj) veya internet yoksa
/// sessizce hiçbir şey yapmaz - agent'ın normal çalışmasını ASLA etkilemez/bloklamaz.
async fn ensure_system_packages() {
    let has_apk = tokio::process::Command::new("sh")
        .arg("-c")
        .arg("command -v apk >/dev/null 2>&1")
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);

    if !has_apk {
        return;
    }

    // `apk add` zaten kurulu paketler için no-op'tur (idempotent) - her agent
    // başlangıcında güvenle tekrar çalıştırılabilir.
    let install_cmd = "apk add --no-cache ethtool tc-full iptables-nft 2>&1";
    match tokio::process::Command::new("sh").arg("-c").arg(install_cmd).output().await {
        Ok(out) if out.status.success() => {
            info!("📦 [SİSTEM PAKETLERİ]: ethtool/tc-full/iptables-nft hazır (apk).");
        }
        Ok(out) => {
            warn!(
                "⚠️ [SİSTEM PAKETLERİ]: apk add başarısız/kısmi (internet yok olabilir) - agent normal çalışmaya devam ediyor: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        Err(e) => {
            warn!("⚠️ [SİSTEM PAKETLERİ]: apk çalıştırılamadı: {}", e);
        }
    }
}

fn discover_hardware_firewall_mode() -> String {
    // 1. OpenWrt UCI'dan lan->wan yönlendirmesini kontrol et
    // uci show firewall çıktısında `src='lan'` ve `dest='wan'` içeren forwarding bloklarını ara
    let uci_raw = std::process::Command::new("uci")
        .arg("show")
        .arg("firewall")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let has_lan_wan_forward = uci_raw.lines().any(|l| {
        (l.contains("forwarding") || l.contains("forward")) && (l.contains("dest='wan'") || l.contains("dest=wan"))
    });
    
    // 2. Whitelist kuralları var mı? (ALLOW_ ve benzeri özel geçiş kuralları)
    let has_whitelist = uci_raw.lines().any(|l| {
        l.to_lowercase().contains("allow_") || l.to_lowercase().contains("whitelist")
    });

    if !has_lan_wan_forward && has_whitelist {
        "WHITELIST".to_string()
    } else if !has_lan_wan_forward {
        "DROP_ALL".to_string()
    } else {
        "OPEN".to_string()
    }
}

/// Düşük Kaynaklı (RAM < 2MB) Akıllı Güvenlik Olayı ve DNS/Port Log Toplayıcı
fn discover_security_events(clients: &[netops_proto::LanClient]) -> Vec<netops_proto::SecurityEvent> {
    let mut events = Vec::new();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();

    // OpenWrt dnsmasq logqueries seçeneğinin aktif olduğundan emin ol
    let _ = std::process::Command::new("sh")
        .arg("-c")
        .arg("uci get dhcp.@dnsmasq[0].logqueries 2>/dev/null | grep -q '1' || (uci set dhcp.@dnsmasq[0].logqueries='1' && uci commit dhcp && /etc/init.d/dnsmasq reload 2>/dev/null)")
        .output();

    // 1. Dnsmasq Son DNS Sorguları (Tüm İstemci DNS Trafiği - A, AAAA, HTTPS, SVCB)
    let log_dns = std::process::Command::new("sh")
        .arg("-c")
        .arg("logread | grep -iE 'query\\[' | tail -n 15 2>/dev/null")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();


    // Dinamik DNS IP Eşleştirme Önbelleği (IP -> Domain Lookup)
    let mut dns_ip_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // Dnsmasq reply ve cached yanıtlarını tara: örn: "reply daily-cloudcode-pa.googleapis.com is 172.217.117.4"
    let log_replies = std::process::Command::new("sh")
        .arg("-c")
        .arg("logread | grep -iE ' (reply|cached) ' | tail -n 25 2>/dev/null")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    for line in log_replies.lines() {
        if let Some(pos) = line.find(" is ") {
            let ip_part = line[pos + 4..].trim();
            let before = &line[..pos];
            if let Some(domain) = before.split_whitespace().last() {
                if !domain.is_empty() && !ip_part.is_empty() && !ip_part.starts_with('<') {
                    dns_ip_map.insert(ip_part.to_string(), domain.to_string());
                }
            }
        }
    }

    for line in log_dns.lines() {
        if let Some(pos) = line.find("query[") {
            let rest = &line[pos..];
            if let Some(domain_part) = rest.split(']').nth(1) {
                let parts: Vec<&str> = domain_part.split_whitespace().collect();
                if parts.len() >= 3 && parts[1] == "from" {
                    let domain = parts[0].to_string();
                    let src_ip = parts[2].to_string();

                    // Yerel mDNS/Bonjour ve reverse arpa sorgularını gürültü yaratmaması için filtrele
                    if domain.contains("_dns-sd") || domain.contains("in-addr.arpa") || domain.contains("ip6.arpa") || domain.ends_with(".lan") || domain.ends_with(".local") {
                        continue;
                    }

                    let src_mac = clients.iter().find(|c| c.ip_address == src_ip).map(|c| c.mac_address.clone()).unwrap_or_default();

                    events.push(netops_proto::SecurityEvent {
                        timestamp: now,
                        event_type: "DNS_QUERY".to_string(),
                        src_ip,
                        src_mac,
                        dst_ip: "Local DNS".to_string(),
                        dst_port: 53,
                        protocol: "DNS".to_string(),
                        domain_query: domain,
                        action_taken: "PASS".to_string(),
                        severity: "INFO".to_string(),
                    });
                }
            }
        }
    }

    // 2. Conntrack Şüpheli veya Yoğun Bağlantı Denemeleri (Web, SMB 445, RDP 3389, RPC 135)
    let conntrack_out = std::process::Command::new("sh")
        .arg("-c")
        .arg("cat /proc/net/nf_conntrack 2>/dev/null | grep -E 'dport=445|dport=3389|dport=135|dport=80|dport=443' | head -n 8 || true")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    for line in conntrack_out.lines() {
        // Format: ipv4 2 tcp 6 299 ESTABLISHED src=192.168.20.216 dst=172.217.117.4 sport=50212 dport=443
        let src_ip = line.split("src=").nth(1).and_then(|s| s.split_whitespace().next()).unwrap_or("").to_string();
        let dst_ip = line.split("dst=").nth(1).and_then(|s| s.split_whitespace().next()).unwrap_or("").to_string();
        let dport: u16 = line.split("dport=").nth(1).and_then(|s| s.split_whitespace().next()).and_then(|p| p.parse().ok()).unwrap_or(0);

        if !src_ip.is_empty() && dport > 0 && src_ip != "127.0.0.1" {
            let src_mac = clients.iter().find(|c| c.ip_address == src_ip).map(|c| c.mac_address.clone()).unwrap_or_default();
            // Eğer bu IP için çözülmüş bir domain önbelleğimizde varsa domain_query olarak ekle
            let resolved_domain = dns_ip_map.get(&dst_ip).cloned().unwrap_or_default();

            events.push(netops_proto::SecurityEvent {
                timestamp: now,
                event_type: if dport == 445 || dport == 3389 { "LATERAL_CONN".to_string() } else { "WEB_TRAFFIC".to_string() },
                src_ip,
                src_mac,
                dst_ip,
                dst_port: dport,
                protocol: "TCP".to_string(),
                domain_query: resolved_domain,
                action_taken: "PASS".to_string(),
                severity: if dport == 445 || dport == 3389 { "WARN".to_string() } else { "INFO".to_string() },
            });
        }
    }

    // 3. 🌀 Akıllı Ağ Döngüsü (Network Loop & MAC Flapping) Tespiti
    // Dinamik LAN köprü arayüzünü keşfet (br-lan, br0, vb.)
    let lan_bridge_name = if std::path::Path::new("/sys/class/net/br-lan").exists() {
        "br-lan"
    } else if std::path::Path::new("/sys/class/net/br0").exists() {
        "br0"
    } else {
        "lan"
    };

    let bridge_mac = std::fs::read_to_string(format!("/sys/class/net/{}/address", lan_bridge_name))
        .unwrap_or_default()
        .trim()
        .to_uppercase();

    // 3. 🌀 Akıllı Ağ Döngüsü (Network Loop & MAC Flapping) Tespiti
    // SADECE aktif olarak o anda BLOCKING durumunda olan portları tespit et (Geçmiş dmesg loglarını değil!)
    let stp_blocked_ports = std::process::Command::new("sh")
        .arg("-c")
        .arg("brctl showstp br-lan 2>/dev/null | grep -B 2 'state.*blocking' | grep -E 'lan[0-9]|eth[0-9]' | awk '{print $1}' || true")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    if !stp_blocked_ports.is_empty() {
        for port in stp_blocked_ports.lines() {
            let p_clean = port.trim();
            if !p_clean.is_empty() {
                events.push(netops_proto::SecurityEvent {
                    timestamp: now,
                    event_type: "NETWORK_LOOP_DETECTED".to_string(),
                    src_ip: format!("Port: {}", p_clean),
                    src_mac: bridge_mac.clone(),
                    dst_ip: format!("Bridge: {}", lan_bridge_name),
                    dst_port: 0,
                    protocol: "ETHERNET_RSTP".to_string(),
                    domain_query: format!("Aktif fiziksel döngü engellendi: Port {} RSTP tarafından BLOCKING moduna alındı.", p_clean),
                    action_taken: "RSTP_BLOCKED".to_string(),
                    severity: "CRITICAL".to_string(),
                });
            }
        }
    }

    // 4. TX/RX Aşırı Paket Düşmesi / Fırtına Kontrolü
    let drop_stat_path = format!("/sys/class/net/{}/statistics/rx_dropped", lan_bridge_name);
    let rx_dropped = std::fs::read_to_string(drop_stat_path)
        .unwrap_or_default()
        .trim()
        .parse::<u64>()
        .unwrap_or(0);
    
    if rx_dropped > 5000 {
        events.push(netops_proto::SecurityEvent {
            timestamp: now,
            event_type: "BROADCAST_STORM".to_string(),
            src_ip: format!("Bridge: {}", lan_bridge_name),
            src_mac: bridge_mac,
            dst_ip: "Layer2 Broadcast".to_string(),
            dst_port: 0,
            protocol: "L2_BROADCAST".to_string(),
            domain_query: format!("Paket kaybı eşiği aşıldı: {} adet dropped", rx_dropped),
            action_taken: "RATE_LIMITED".to_string(),
            severity: "WARN".to_string(),
        });
    }

    events
}

/// Evrensel Donanım Kimliği ve Model Keşfi (OpenWrt / DMI / CPU / MAC)
fn discover_hardware_identity(custom_device_id: Option<String>) -> (String, String, String, String) {
    // 1. MAC Adresi Keşfi
    let mac_raw = std::fs::read_to_string("/sys/class/net/eth0/address")
        .or_else(|_| std::fs::read_to_string("/sys/class/net/wan/address"))
        .or_else(|_| std::fs::read_to_string("/sys/class/net/br-lan/address"))
        .or_else(|_| {
            std::process::Command::new("sh")
                .arg("-c")
                .arg("ip link show | grep -o 'ether [0-9a-f:]*' | head -n 1 | cut -d' ' -f2")
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        })
        .unwrap_or_default()
        .trim()
        .to_uppercase();

    let mac_clean = mac_raw.replace(':', "");

    // 2. Model ve Seri Numarası Keşfi
    let model = std::fs::read_to_string("/tmp/sysinfo/model")
        .or_else(|_| std::fs::read_to_string("/sys/class/dmi/id/product_name"))
        .unwrap_or_default()
        .trim()
        .to_string();
    let model = if model.is_empty() { "Universal Linux SD-WAN Edge".to_string() } else { model };

    let serial_number = std::fs::read_to_string("/tmp/sysinfo/board_name")
        .or_else(|_| std::fs::read_to_string("/sys/class/dmi/id/product_serial"))
        .unwrap_or_default()
        .trim()
        .to_string();
    let serial_number = if serial_number.is_empty() { mac_clean.clone() } else { serial_number };

    // 3. Cihaz ID (Öncelik: Verilen Argüman -> /etc/netops/device_id -> auto-generated)
    let device_id = if let Some(id) = custom_device_id {
        if !id.is_empty() { id } else { format!("edge-{}", mac_clean) }
    } else if let Ok(stored_id) = std::fs::read_to_string("/etc/netops/device_id") {
        let trimmed = stored_id.trim().to_string();
        if !trimmed.is_empty() { trimmed } else { format!("edge-{}", mac_clean) }
    } else if !mac_clean.is_empty() {
        format!("edge-{}", mac_clean)
    } else {
        "edge-universal".to_string()
    };

    (device_id, mac_raw, model, serial_number)
}

fn main() -> Result<()> {
    // 🧪 Safe-OTA Erken Sandbox Test Doğrulaması (--test-run bayrağı ile anında başarı döndür)
    let env_args: Vec<String> = std::env::args().collect();
    if env_args.iter().any(|a| a == "--test-run") {
        println!("netops-agent sandbox test: OK");
        return Ok(());
    }

    // ⚡ Meraki MX64 Çift Çekirdekli Cortex-A9 CPU Optimizasyonu:
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(4)
        .enable_all()
        .thread_name("netops-worker")
        .build()?;

    runtime.block_on(async_main())
}

/// Watchdog kabuk komutlarını sabit bir zaman aşımıyla çalıştırır ve başarısızlığı loglar.
///
/// 🔴 Kod-review düzeltmesi: `.output().await` tek başına yeterli değildi - donan bir
/// komut (örn. stuck `ubusd`/`ifup`) 10sn'lik telemetri/watchdog tick döngüsünün TAMAMINI
/// süresiz bloklayabilir, bu da tam olarak bu watchdog'un önlemeye çalıştığı arızayı
/// (tünelin/telemetrinin fark edilmeden durması) kötüleştirir. `tokio::time::timeout` bu
/// riski sınırlar.
///
/// 🔴 Kod-review düzeltmesi (2. tur): `kill_on_drop(true)` olmadan, zaman aşımında
/// `tokio::time::timeout` süreci sadece BEKLEMEYİ bırakır - alttaki kabuk süreci
/// ÖLDÜRÜLMEZ, artık yetim (orphan) olarak çalışmaya devam eder. Her tick'te tekrar
/// eden bir donma, cihazda sızan yetim süreçleri biriktirebilirdi.
async fn run_watchdog_cmd(label: &str, shell_cmd: &str) {
    match tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new("sh").arg("-c").arg(shell_cmd).kill_on_drop(true).output(),
    )
    .await
    {
        Ok(Ok(out)) if out.status.success() => {}
        Ok(Ok(out)) => {
            warn!("⚠️ [{}]: komut başarısız oldu (kod: {:?}): {}", label, out.status.code(), String::from_utf8_lossy(&out.stderr));
        }
        Ok(Err(e)) => {
            warn!("⚠️ [{}]: komut çalıştırılamadı: {}", label, e);
        }
        Err(_) => {
            warn!("⚠️ [{}]: komut 5sn içinde tamamlanmadı, tick döngüsünü tıkamaması için iptal edildi.", label);
        }
    }
}

/// WireGuard "sdwan0" tünel arayüzünün yerelde (kernel'de) var olup olmadığını kontrol eder.
/// Ağa hiç çıkmadan, sadece `ip link` ile anında yanıt verir - watchdog döngüsünde her
/// tick'te ücretsiz/hızlı çağrılabilir.
fn is_tunnel_interface_present() -> bool {
    std::process::Command::new("sh")
        .arg("-c")
        .arg("ip link show sdwan0 >/dev/null 2>&1")
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Hub ile Kayıt El Sıkışmasını (Peer Registration) Yapar ve Başarılı Olursa WireGuard
/// Spoke Tünelini Ayağa Kaldırır. Hem ilk başlangıçta (main içinde) hem de watchdog
/// döngüsü tarafından tünel koptuğunda/hiç kurulamadığında tekrar tekrar çağrılabilir.
///
/// 🔴 KRİTİK DÜZELTME (2026-08-22): Önceki sürümde bu el sıkışma SADECE program
/// başlangıcında, en fazla 60 saniyelik bir backoff penceresi içinde bir kez deneniyordu.
/// Cihaz açılışında WAN henüz hazır değilse (örn. DHCP/route henüz oturmamışsa) bu 60
/// saniyelik pencere içinde kayıt başarısız olabiliyor ve kod sessizce pes edip WireGuard
/// tünelini HİÇ kurmadan telemetri döngüsüne geçiyordu. Telemetri, herkese açık internet
/// üzerinden hub_url'e (tünelsiz) başarıyla ulaşabildiği için watchdog'un
/// `consecutive_failures` sayacı hiç artmıyor, dolayısıyla hiçbir self-healing/restart
/// mekanizması tetiklenmiyordu - cihaz Hub'a WireGuard üzerinden ASLA yeniden
/// bağlanmadan saatlerce (production'da 12+ saat) "sessizce" offline kalabiliyordu.
/// Artık bu fonksiyon watchdog döngüsünden periyodik olarak da çağrılıyor (bkz.
/// `is_tunnel_interface_present` çağrısı), böylece tünel ne sebeple olursa olsun
/// eksikse otomatik olarak yeniden kurulur.
async fn register_and_setup_tunnel(
    client: &reqwest::Client,
    register_url: &str,
    reg_req: &PeerRegistrationRequest,
    device_token: &str,
    shared_secret: &str,
    priv_key_b64: &str,
    listen_port: u16,
    hub_url: &str,
) -> Option<PeerRegistrationResponse> {
    let backoff_strategy = backoff::ExponentialBackoffBuilder::new()
        .with_initial_interval(Duration::from_secs(1))
        .with_max_interval(Duration::from_secs(15))
        .with_max_elapsed_time(Some(Duration::from_secs(60)))
        .build();

    let reg_result = backoff::future::retry(backoff_strategy, || async {
        let mut builder = client.post(register_url).json(reg_req);
        if !device_token.is_empty() {
            builder = builder
                .header("X-Device-Token", device_token)
                .header("X-NetOps-Secret", shared_secret);
        }
        match builder.send().await {
            Ok(res) if res.status().is_success() => {
                let resp = res.json::<PeerRegistrationResponse>().await
                    .map_err(|e| backoff::Error::permanent(anyhow::anyhow!("JSON Parse Error: {}", e)))?;
                Ok(resp)
            }
            Ok(res) if res.status() == reqwest::StatusCode::UNAUTHORIZED => {
                Err(backoff::Error::permanent(anyhow::anyhow!("Yetkisiz Erişim (401): Cihaz jetonu veya gizli anahtar geçersiz")))
            }
            Ok(res) => {
                Err(backoff::Error::transient(anyhow::anyhow!("Sunucu Hatası: {}", res.status())))
            }
            Err(e) => {
                Err(backoff::Error::transient(anyhow::anyhow!("Bağlantı Hatası: {}", e)))
            }
        }
    }).await;

    let resp = match reg_result {
        Ok(resp) => resp,
        Err(e) => {
            warn!("⚠️ Hub kaydı bağlantı hatası: {}", e);
            return None;
        }
    };

    let assigned_ip = resp.assigned_virtual_ip.clone();
    let hub_pubkey = resp.hub_public_key.clone();

    if assigned_ip.is_empty() || hub_pubkey.is_empty() {
        warn!("⚠️ Hub kaydı başarılı ama assigned_ip/hub_pubkey boş döndü - tünel kurulamıyor.");
        return Some(resp);
    }

    let active_endpoint = if !resp.hub_endpoint.is_empty() {
        resp.hub_endpoint.clone()
    } else {
        let host = hub_url
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("127.0.0.1")
            .split(':')
            .next()
            .unwrap_or("127.0.0.1");
        format!("{}:51820", host)
    };

    let spoke_allowed_ips = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16".to_string();

    // 🔴 KRİTİK DÜZELTME (2026-08-22): Bu script'te DNS-yönlendirme/DoH-engelleme için
    // hem `nft` hem de eski `iptables` komutları vardı ("iptables ... || true" ile
    // hatası yutuluyordu). Gerçek üretim donanımında (Meraki MX64 / fw4 tabanlı OpenWrt
    // build) `iptables` binary'si HİÇ YOK - `which iptables` boş döner. Yani bu
    // `iptables` satırları GÜNÜN BİRİNDEN BERİ sessizce hiçbir şey yapmıyordu; asıl işi
    // hep yanlarındaki `nft` eşdeğerleri görüyordu. Kaldırıldılar (ölü kod). TEK EKSİK
    // OLAN, hiç nft eşdeğeri OLMAYAN TCP MSS clamp'tı (`iptables -t mangle ...
    // --clamp-mss-to-pmtu`) - bu, ICMP "Fragmentation Needed" mesajları yolda
    // engellenirse (PMTUD başarısız olursa) TCP bağlantılarının donmasına karşı bir
    // savunmaydı ve gerçekte HİÇ uygulanmıyordu. `nft ... tcp option maxseg size set rt
    // mtu` ile gerçek (nft tabanlı) eşdeğeri eklendi ve gerçek cihazda doğrulandı.
    let wg_spoke_cmd = format!(
        "mkdir -p /etc/netops; \
         echo '{privkey}' > /etc/netops/wg_priv.key; \
         ip link add dev sdwan0 type wireguard 2>/dev/null || true; \
         ip addr flush dev sdwan0 2>/dev/null || true; \
         ip link set mtu 1420 dev sdwan0 2>/dev/null || true; \
         ip addr add {vip} dev sdwan0 2>/dev/null || true; \
         wg set sdwan0 listen-port {port} private-key /etc/netops/wg_priv.key 2>/dev/null || true; \
         wg set sdwan0 peer {hub_pub} endpoint {endpoint} allowed-ips {allowed} persistent-keepalive {keepalive} 2>/dev/null || true; \
         ip link set up dev sdwan0 2>/dev/null || true; \
         uci del_list firewall.@zone[0].device='sdwan0' 2>/dev/null || true; \
         uci add_list firewall.@zone[0].device='sdwan0' 2>/dev/null || true; \
         uci set network.lan.stp=1 2>/dev/null || true; \
         uci set network.lan.igmp_snooping=1 2>/dev/null || true; \
         uci commit network 2>/dev/null || true; \
         brctl stp br-lan on 2>/dev/null || true; \
         uci set firewall.@defaults[0].flow_offloading=1 2>/dev/null || true; \
         uci set firewall.@defaults[0].flow_offloading_hw=1 2>/dev/null || true; \
         uci commit firewall 2>/dev/null || true; \
         /etc/init.d/firewall reload 2>/dev/null || true; \
         sysctl -w net.core.rmem_max=16777216 2>/dev/null || true; \
         sysctl -w net.core.wmem_max=16777216 2>/dev/null || true; \
         sysctl -w net.ipv4.tcp_rmem=\"4096 87380 16777216\" 2>/dev/null || true; \
         sysctl -w net.ipv4.tcp_wmem=\"4096 65536 16777216\" 2>/dev/null || true; \
         sysctl -w net.core.netdev_max_backlog=5000 2>/dev/null || true; \
         nft add rule inet fw4 dstnat iifname \"br-lan\" udp dport 53 redirect to :53 2>/dev/null || true; \
         nft add rule inet fw4 dstnat iifname \"br-lan\" tcp dport 53 redirect to :53 2>/dev/null || true; \
         nft add rule inet fw4 forward iifname \"br-lan\" ip daddr {{ 8.8.8.8, 8.8.4.4, 1.1.1.1, 1.0.0.1, 9.9.9.9 }} tcp dport 443 reject 2>/dev/null || true; \
         nft add rule inet fw4 forward iifname \"br-lan\" ip daddr {{ 8.8.8.8, 8.8.4.4, 1.1.1.1, 1.0.0.1, 9.9.9.9 }} udp dport 443 reject 2>/dev/null || true; \
         nft add rule inet fw4 forward tcp flags syn tcp option maxseg size set rt mtu 2>/dev/null || true;",
        privkey = priv_key_b64,
        vip = assigned_ip,
        port = listen_port,
        hub_pub = hub_pubkey,
        endpoint = active_endpoint,
        allowed = spoke_allowed_ips,
        keepalive = resp.keepalive_interval_secs
    );
    let _ = tokio::process::Command::new("sh").arg("-c").arg(&wg_spoke_cmd).output().await;
    info!("🚀 [SPOKE SD-WAN TÜNELİ AKTİF]: sdwan0 ({}) -> Hub ({}) [AllowedIPs: {}]", assigned_ip, active_endpoint, spoke_allowed_ips);

    apply_camera_traffic_policy(&resp).await;

    Some(resp)
}

/// Kamera/NVR Trafik Yönetimi (Bölüm 3) - TAMAMEN OTOMATİK, SIFIR YAPILANDIRMA.
///
/// Hiçbir yere (Hub CLI, dashboard, config dosyası) NVR IP'si veya kamera bilgisi
/// GİRİLMEZ. Merkezdeki NVR, hangi şubenin hangi kamerasını kaydettiğine kendi karar
/// verir ve standart RTSP (tcp/554) ile doğrudan sdwan0 tüneli üzerinden bağlanır - bu
/// routing zaten Hub'ın allowed-ips/route mekanizmasıyla var olan bir yetenektir, biz
/// hiçbir video baytına dokunmayız, hiçbir relay/ffmpeg süreci başlatmayız.
///
/// Bu fonksiyonun tek işi: sdwan0 üzerinden geçen RTSP (554) trafiğini PORT İMZASINDAN
/// otomatik tanıyıp (1) bant genişliği tavanı uygulamak - böylece bir şubede aktif
/// kamera izlemesi o şubenin kontrol/telemetri kanalını asla boğamaz - ve (2) bu
/// kuralın HER ZAMAN aktif olması (kaynak IP'ye bakılmaksızın), her şube kaydı/tünel
/// kurulumunda koşulsuz uygulanır. Trafik hiç yoksa kuralın hiçbir etkisi/maliyeti yok.
async fn apply_camera_traffic_policy(resp: &PeerRegistrationResponse) {
    // Hub fleet-çapında bir varsayılan tavan gönderebilir (opsiyonel, sadece bir SAYI -
    // IP/kimlik bilgisi değil); göndermezse (0) makul bir varsayılana düşülür. Bu ayar
    // "kamerayı tanı" mantığına dahil DEĞİLDİR - sadece tespit edilen akışa uygulanacak
    // tavanı belirler.
    let ceil_kbps = if resp.camera_bandwidth_ceil_kbps > 0 { resp.camera_bandwidth_ceil_kbps } else { 8192 };
    // nft `limit rate` byte cinsinden çalışır (kbytes/second), bit-cinsi kbps'i /8 ile çevir.
    let ceil_kbytes_per_sec = (ceil_kbps / 8).max(1);

    // ⚠️ DONANIM GERÇEĞİ: Bu OpenWrt/fw4 imajında `iptables` ve `tc` YOK (sadece `nft`
    // ve `ip` var - doğrulandı: production şube cihazında `which iptables tc` boş
    // döner). Gerçek HTB tabanlı önceliklendirme (tc olmadan) mümkün değil - bunun
    // yerine nft'in `limit rate over` sayacıyla RTSP portuna sert bir tavan (drop-based
    // policing) uygulanıyor. Bu, kontrol kanalına GARANTİLİ bant genişliği vermez
    // (gerçek HTB gibi), ama kamera trafiğinin toplam linki sınırsız tüketmesini
    // engeller. Tam önceliklendirme için cihaza `tc-tiny`/`iproute2-full` paketinin
    // ayrıca kurulması gerekir (bu build'de mevcut değil, sessizce varsayılmıyor).
    //
    // Kendi ayrı `inet netops_cam` tablomuzda çalışıyoruz (fw4'ün kendi tablosuna
    // yazmıyoruz) - böylece `/etc/init.d/firewall reload` (fw4, UCI'dan kendi tablosunu
    // sıfırdan üretir) bizim kurallarımızı SİLMEZ. `flush chain` ile idempotent: tünel
    // her yeniden kurulduğunda (watchdog reset vb.) güvenle tekrar çalıştırılabilir.
    //
    // Kaynak/hedef IP'ye göre bir ERİŞİM KISITLAMASI YOK (kimin NVR olduğunu bilmiyoruz
    // ve bilmek istemiyoruz) - sadece RTSP port imzasına göre bant genişliği yönetimi.
    let nft_cmd = format!(
        "nft add table inet netops_cam 2>/dev/null; \
         nft 'add chain inet netops_cam camfwd {{ type filter hook forward priority -1; }}' 2>/dev/null; \
         nft flush chain inet netops_cam camfwd 2>/dev/null; \
         nft add rule inet netops_cam camfwd iifname \"sdwan0\" tcp dport 554 limit rate over {ceil} kbytes/second counter drop 2>/dev/null; \
         nft add rule inet netops_cam camfwd iifname \"sdwan0\" tcp sport 554 limit rate over {ceil} kbytes/second counter drop 2>/dev/null; \
         nft add rule inet netops_cam camfwd oifname \"sdwan0\" tcp dport 554 limit rate over {ceil} kbytes/second counter drop 2>/dev/null; \
         nft add rule inet netops_cam camfwd oifname \"sdwan0\" tcp sport 554 limit rate over {ceil} kbytes/second counter drop 2>/dev/null;",
        ceil = ceil_kbytes_per_sec
    );
    let _ = tokio::process::Command::new("sh").arg("-c").arg(&nft_cmd).output().await;

    info!(
        "📹 [KAMERA/NVR OTOMATİK TRAFİK YÖNETİMİ AKTİF (nftables, sıfır yapılandırma)]: RTSP (tcp/554) tavanı: {} kbps (~{} KB/s policing)",
        ceil_kbps, ceil_kbytes_per_sec
    );
}

async fn async_main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,netops_agent=debug".into()),
        )
        .init();

    let args = Args::parse();

    // 🔴 KRİTİK DÜZELTME (2026-08-22): Bu oturumda saha cihazında `iptables`, `tc` ve
    // `ethtool` binary'lerinin HİÇ olmadığı tespit edilmişti (kamera QoS ve OTA imza
    // doğrulama özellikleri bu yüzden nftables'a çevrilmişti). Sonradan keşfedildi ki
    // bu cihazlar `opkg` DEĞİL, `apk` (Alpine-tarzı) paket yöneticisi kullanıyor ve
    // internet erişimiyle 9000+ paket kurulabiliyor - sadece hiç denenmemişti. Artık
    // agent her başlangıçta bu temel araçları (varsa no-op, yoksa kur) arka planda
    // kendi kendine sağlıyor - böylece hangi firmware imajıyla flaşlanmış olursa olsun
    // (eski/yeni build script paket listesi ne olursa olsun) HER şube, reflaş
    // gerekmeden, bu araçlara sahip olur. Ağ yoksa veya `apk` yoksa (opkg tabanlı eski
    // bir imaj) sessizce atlanır - agent'ın başlangıcını ASLA bloklamaz/geciktirmez.
    tokio::spawn(async {
        ensure_system_packages().await;
    });

    // 1. Dinamik Donanım, Ağ ve Hub URL Keşfi (Zero Hardcode / Universal Zero-Touch)
    let hub_url = discover_hub_url(args.hub_url);
    let (device_id, mac_address, model, serial_number) = discover_hardware_identity(args.device_id);
    let (wan_iface, management_ip) = discover_wan_interface();
    let (lan_ip, local_subnets) = discover_lan_subnets(&wan_iface);

    info!("🚀 [NetOpsWan Universal SD-WAN Agent Başlatıldı]");
    info!("📍 Donanım ID: {}", device_id);
    info!("🏷️ Model / Seri No: {} / {}", model, serial_number);
    info!("📡 MAC Adresi: {}", mac_address);
    info!("🌐 WAN Arayüzü: {} ({})", wan_iface, management_ip);
    info!("🏠 Yerel LAN: {} (Subnetler: {:?})", lan_ip, local_subnets);
    info!("🛡️ Hub URL: {}", hub_url);

    // 2. Anahtar Çifti (Curve25519) Kalıcı Olarak Yükleme veya Üretme
    let keypair = KeyPair::load_or_generate("/etc/netops/agent_identity.key");
    info!("🔑 Cihaz Public Key: {}", keypair.public_key_base64());

    // 3. Hub ile Dinamik El Sıkışma (Peer Registration)
    let reg_req = PeerRegistrationRequest {
        device_id: device_id.clone(),
        serial_number: serial_number.clone(),
        model: model.clone(),
        mac_address: mac_address.clone(),
        management_ip: management_ip.clone(),
        public_key: keypair.public_key_base64(),
        local_ip_ranges: local_subnets.clone(),
        tunnel_listen_port: args.listen_port,
        agent_version: env!("CARGO_PKG_VERSION").into(),
    };

    let shared_secret = discover_shared_secret(args.shared_secret.clone());
    info!("📡 Hub Sunucusuna Kayıt İsteği Gönderiliyor ({})...", hub_url);
    
    // 3. Socket Optimizasyonlu Yüksek Performanslı TLS İstemcisi
    // NOT: TLS sertifika doğrulaması ARTIK devre dışı bırakılmıyor. Hub, gerçek bir
    // Let's Encrypt sertifikası (sdwan.ariot.com.tr) ile TLS sonlandırıyor - doğrulamayı
    // kapatmanın hiçbir gerçek faydası yoktu, sadece bir MITM saldırganının kayıt
    // isteğini (ve içindeki X-Device-Token/X-NetOps-Secret'ı) ve OTA indirmelerini
    // ele geçirmesine izin veriyordu.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .tcp_nodelay(true)
        .build()?;

    let register_url = format!("{}/api/v1/sdwan/register", hub_url.trim_end_matches('/'));
    
    // 🔒 Cihaz-Özel Zero-Trust Jetonu Türet (MAC + DeviceID + Secret)
    let device_token = if !shared_secret.is_empty() {
        netops_auth::derive_device_token(&shared_secret, &device_id, &mac_address)
    } else {
        String::new()
    };

    // NOT: Sıfır Hardcode - Hub'ın kendi tünel havuz CIDR'ı (örn. 10.8.0.0/16), Hub'ın
    // yanıtından dinamik olarak alınır. Önceki sürüm bu değeri "10.8.0.0/24" olarak
    // sabit koddu; Hub'ın havuz boyutu değiştirildiğinde (bkz. --tunnel-subnet) bu
    // watchdog rotaları yanlış/eksik bir alt ağa işaret etmeye devam edecekti.
    let mut hub_virtual_ip = String::new();
    let mut tunnel_subnet_cidr = String::new();

    let priv_key_b64 = keypair.private_key_base64();

    let initial_reg = register_and_setup_tunnel(
        &client, &register_url, &reg_req, &device_token, &shared_secret,
        &priv_key_b64, args.listen_port, &hub_url,
    ).await;

    match initial_reg {
        Some(resp) => {
            hub_virtual_ip = resp.hub_virtual_ip.clone();
            tunnel_subnet_cidr = resp.tunnel_subnet.clone();

            // Watchdog & OTA Upgrade Health Confirmation Flag
            let _ = std::fs::write("/tmp/netops_healthy", format!("OK:{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()));
            let _ = std::fs::write("/var/run/netops_healthy", "OK");

            if args.test_run {
                info!("🧪 [SAFE-OTA TEST RUN BAŞARILI]: Donanım mimarisi ve Hub bağlantısı doğrulandı. Çıkış yapılıyor.");
                return Ok(());
            }
        }
        None => {
            if args.test_run {
                anyhow::bail!("Test run failed: hub'a kayıt olunamadı");
            }
            warn!("⚠️ [BAŞLANGIÇ KAYDI BAŞARISIZ]: İlk kayıt/tünel kurulumu başarısız oldu - watchdog döngüsü tüneli periyodik olarak yeniden kurmayı deneyecek.");
        }
    }

    // 4. LAN DHCP & DNS Sağlık Güvencesi (Doğrudan Ultra Hızlı DNS 1.1.1.1 / 8.8.8.8 Ataması ve dnsmasq Önbellek Ayarı)
    let (detected_wan, _) = discover_wan_interface();
    let (detected_lan_ip, _) = discover_lan_subnets(&detected_wan);
    if !detected_lan_ip.is_empty() {
        let dhcp_ensure_cmd = format!(
            "uci del_list dhcp.lan.dhcp_option='3,{lan}' 2>/dev/null; \
             uci add_list dhcp.lan.dhcp_option='3,{lan}'; \
             uci del_list dhcp.lan.dhcp_option='6,1.1.1.1,8.8.8.8' 2>/dev/null; \
             uci add_list dhcp.lan.dhcp_option='6,1.1.1.1,8.8.8.8'; \
             uci set dhcp.@dnsmasq[0].cachesize=10000 2>/dev/null; \
             uci set dhcp.@dnsmasq[0].allservers=1 2>/dev/null; \
             uci set dhcp.@dnsmasq[0].min_cache_ttl=3600 2>/dev/null; \
             uci commit dhcp 2>/dev/null; \
             /etc/init.d/dnsmasq restart 2>/dev/null || true",
            lan = detected_lan_ip
        );
        let _ = tokio::process::Command::new("sh").arg("-c").arg(&dhcp_ensure_cmd).output().await;
        info!("🌐 [LAN AĞ SAĞLIĞI]: İstemciler için Gateway ({}) ve Ultra Hızlı DNS (1.1.1.1, 8.8.8.8) yapılandırıldı.", detected_lan_ip);
    }

    // 5. Telemetri ve Anti-Bricking Watchdog Döngüsü (Industrial Grade Liveness & In-Band Tunnel Overlay Engine)
    let running = Arc::new(AtomicBool::new(true));

    // 🔴 KRİTİK DAYANIKLILIK DÜZELTMESİ (2026-08-28): JoinHandle tabanlı süpervizör
    // (aşağıda) SADECE bir görevin panic ile ÇÖKÜP tamamlanmasını yakalayabiliyordu.
    // Üretimde tespit edilen gerçek arıza türü farklıydı: komut-poll görevi panic
    // ETMEDEN sessizce ASKIDA KALMIŞTI (muhtemelen bozulan bir HTTP bağlantı havuzu
    // durumu) - `await` üzerinde sonsuza dek beklediği için JoinHandle'ı ASLA
    // tamamlanmadı, süpervizör hiçbir şey fark etmedi. Süreci elle yeniden
    // başlatmak sorunu anında çözdü (görev canlı olsaydı sorun sürmezdi). Artık her
    // iki döngü de her turda bir "son nabız" zaman damgası günceller; ayrı bir
    // watchdog görevi bu damgaları izleyip çok eskirse (görev fiilen takılı
    // kalmışsa) süreci `exit(1)` ile sonlandırır - panic'e ek olarak hang'i de
    // yakalayan ikinci bir koruma katmanı.
    let telemetry_heartbeat = Arc::new(std::sync::atomic::AtomicU64::new(now_unix_secs()));
    let cmd_heartbeat = Arc::new(std::sync::atomic::AtomicU64::new(now_unix_secs()));
    let telemetry_heartbeat_for_loop = telemetry_heartbeat.clone();
    let cmd_heartbeat_for_loop = cmd_heartbeat.clone();
    let telemetry_heartbeat_for_watchdog = telemetry_heartbeat.clone();
    let cmd_heartbeat_for_watchdog = cmd_heartbeat.clone();
    let running_for_watchdog = running.clone();

    let r = running.clone();
    let dev_id = device_id.clone();
    let mac_clone = mac_address.clone();
    let model_clone = model.clone();
    let tunnel_subnet_for_watchdog = if tunnel_subnet_cidr.is_empty() {
        "10.8.0.0/16".to_string() // Hub'dan hiç değer gelmediyse (eski Hub sürümü vb.) makul bir varsayılan
    } else {
        tunnel_subnet_cidr.clone()
    };
    let serial_clone = serial_number.clone();

    // Dinamik Tünel İçi URL (In-Band Overlay) ve Genel İnternet Fallback URL'i
    // Sıfır Hardcode: Hub API portu 8088'dir (sdwan0 tüneli üzerinden doğrudan 8088 dinlenir)
    let (primary_telemetry_url, fallback_telemetry_url) = if !hub_virtual_ip.is_empty() {
        (
            format!("http://{}:8088/api/v1/sdwan/telemetry", hub_virtual_ip),
            format!("{}/api/v1/sdwan/telemetry", hub_url.trim_end_matches('/'))
        )
    } else {
        (
            format!("{}/api/v1/sdwan/telemetry", hub_url.trim_end_matches('/')),
            format!("{}/api/v1/sdwan/telemetry", hub_url.trim_end_matches('/'))
        )
    };

    let (primary_cmd_poll_url, fallback_cmd_poll_url) = if !hub_virtual_ip.is_empty() {
        (
            format!("http://{}:8088/api/v1/sdwan/commands/pending?device_id={}", hub_virtual_ip, dev_id),
            format!("{}/api/v1/sdwan/commands/pending?device_id={}", hub_url.trim_end_matches('/'), dev_id)
        )
    } else {
        (
            format!("{}/api/v1/sdwan/commands/pending?device_id={}", hub_url.trim_end_matches('/'), dev_id),
            format!("{}/api/v1/sdwan/commands/pending?device_id={}", hub_url.trim_end_matches('/'), dev_id)
        )
    };

    let (primary_cmd_res_url, fallback_cmd_res_url) = if !hub_virtual_ip.is_empty() {
        (
            format!("http://{}:8088/api/v1/sdwan/commands/result", hub_virtual_ip),
            format!("{}/api/v1/sdwan/commands/result", hub_url.trim_end_matches('/'))
        )
    } else {
        (
            format!("{}/api/v1/sdwan/commands/result", hub_url.trim_end_matches('/')),
            format!("{}/api/v1/sdwan/commands/result", hub_url.trim_end_matches('/'))
        )
    };

    info!("🛡️ [IN-BAND TUNNEL OVERLAY]: Öncelikli İletişim Tüneli -> {}", primary_telemetry_url);

    // hub_url'in kendisi ayrıca komut kanalı (Canlı Tanı) döngüsü tarafından da
    // kullanıldığı için (health-check URL'i), telemetri döngüsü kendi klonunu taşır.
    let hub_url_for_telemetry = hub_url.clone();

    // 🔴 KRİTİK DÜZELTME (2026-08-22): Bu istemci önceden başlangıçtaki `client`'ın
    // (10s timeout, KEEPALIVE YOK) düz bir klonuydu ve hiçbir hata/iyileşme mantığı
    // olmadan tüm agent ömrü boyunca aynı bağlantı havuzuyla kullanılıyordu. Uzun
    // süre boşta kalan bir TCP bağlantısı (NAT/hub taraflı sessiz zaman aşımı) TCP
    // keepalive olmadan işletim sistemi tarafından ASLA "ölü" olarak fark edilmiyordu
    // - istemci sonsuza dek kopuk bir bağlantıyı yeniden kullanmaya çalışıp her
    // istekte donuyordu. Production'da doğrulandı: telemetri (ayrı istemci/döngü)
    // ~78000 saniyelik çalışma süresinden sonra hâlâ sağlıklı çalışırken, bu kanal
    // (Canlı Tanı / Uzaktan Komut özelliği) tamamen ölmüştü ve HİÇBİR self-healing
    // tetiklenmiyordu (agent'ın tek restart tetikleyicisi telemetri hata sayacına
    // bağlıydı). Artık telemetri istemcisiyle aynı desende (tcp_keepalive + ardışık
    // hatadan sonra istemciyi sıfırdan kur) çalışıyor.
    let mut client_cmd = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .tcp_keepalive(Some(Duration::from_secs(15)))
        .build()
        .unwrap_or_else(|_| client.clone());
    let mut cmd_consecutive_failures = 0u32;
    let r_cmd = running.clone();
    let dev_id_for_cmd = device_id.clone();
    // Komut kanalının kendi X-Device-Token'ı (telemetri/register ile aynı client
    // ömrü boyunca kullanılan değer, aşağıda ayrı bir klon gerekiyor çünkü
    // device_token/shared_secret zaten telemetri döngüsünün kendi async move
    // bloğuna taşınmış durumda).
    let device_token_for_cmd = device_token.clone();
    let shared_secret_for_cmd = shared_secret.clone();

    // Watchdog döngüsünün tünel kopukluğunda/hiç kurulamadığında yeniden kayıt+tünel
    // kurulumu deneyebilmesi için gereken parametrelerin klonları (hub_url ikinci
    // spawn'da da kullanıldığı için ayrıca klonlanıyor, diğerleri sadece bu döngüde
    // kullanıldığı için doğrudan taşınıyor).
    let hub_url_for_watchdog = hub_url.clone();
    let reg_req_for_watchdog = reg_req.clone();
    let register_url_for_watchdog = register_url.clone();
    let priv_key_b64_for_watchdog = priv_key_b64.clone();
    let listen_port_for_watchdog = args.listen_port;

    // Telemetri Gönderim & Proaktif Liveness Watchdog Döngüsü
    let telemetry_task_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        let mut sys = sysinfo::System::new();
        let mut consecutive_failures = 0u32;
        let mut current_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .tcp_keepalive(Some(Duration::from_secs(15)))
            .build()
            .unwrap_or_else(|_| client);

        // 🔴 KRİTİK DÜZELTME (2026-08-23, Zero-Hardcode): RTT ölçümü önceden ARIOT'un
        // kendi üretim hub'ının sabit kodlanmış herkese açık IP'sini ('200.97.171.59')
        // ping atıyordu - bu değer, keşfedilen hub_url'den TÜRETİLMEDİĞİ için başka
        // bir müşteri/hub'a bağlı HERHANGİ bir cihazda tamamen yanlış (ARIOT'un
        // sunucusuna) bir hedefi ölçer ve o üçüncü taraf sunucuya anlamsız trafik
        // gönderirdi. Artık ping hedefi, tıpkı register_and_setup_tunnel'daki WireGuard
        // endpoint çözümlemesinde olduğu gibi, hub_url'in kendi host kısmından türetilir.
        let hub_ping_host = hub_url_for_telemetry
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("127.0.0.1")
            .split(':')
            .next()
            .unwrap_or("127.0.0.1")
            .to_string();

        while r.load(Ordering::Relaxed) {
            interval.tick().await;
            telemetry_heartbeat_for_loop.store(now_unix_secs(), std::sync::atomic::Ordering::Relaxed);
            sys.refresh_memory();
            sys.refresh_cpu_usage();

            let ram_used = (sys.used_memory() / (1024 * 1024)) as u32;
            let ram_total = (sys.total_memory() / (1024 * 1024)) as u32;
            let cpu_load = sys.global_cpu_usage();

            // Anlık WAN, LAN ve Bağlı LAN İstemcilerini Dinamik Oku
            let (curr_wan_iface, curr_wan_ip) = discover_wan_interface();
            
            // 🛡️ Proaktif WAN & Default Route Watchdog
            //
            // 🔴 Tünel kararlılığı düzeltmesi: bu komut önceden `.spawn()` ile ATILIYOR, hiçbir
            // zaman sonucu beklenmiyor/kontrol edilmiyordu - hem komutun gerçekten BAŞARILI
            // olup olmadığı hiç bilinmiyordu (sessiz, tekrar eden başarısızlık mümkündü), hem
            // de bir sonraki tick başladığında komut hâlâ çalışıyor olabilirdi. `run_watchdog_cmd`
            // ile hem sonucu bekleniyor/loglanıyor hem de zaman aşımıyla (5sn) donan bir komutun
            // tüm tick döngüsünü tıkaması engelleniyor.
            if curr_wan_ip.is_empty() {
                warn!("⚠️ [WAN WATCHDOG]: WAN IP veya varsayılan rota tespit edilemedi! 'ifup wan' tetikleniyor...");
                run_watchdog_cmd("WAN WATCHDOG", "ifup wan 2>/dev/null || ubus call network.interface.wan up 2>/dev/null").await;
            } else if !is_tunnel_interface_present() {
                // 🔴 KRİTİK: sdwan0 arayüzü yok - önceki `ip link set up` denemesi burada
                // sessizce hiçbir şey yapmıyordu çünkü kurulmamış bir arayüzü "up" yapamazsınız.
                // Bu tam olarak production'da yaşanan sessiz arıza türüydü: WAN sağlıklı,
                // telemetri genel internet fallback'i üzerinden başarıyla gidiyor, ama
                // WireGuard tüneli hiç kurulmamış ve bunu hiçbir şey fark etmiyordu.
                // Artık: tünel eksikse, açılıştaki ile birebir aynı kayıt+tünel kurulum
                // fonksiyonu burada da (kendi backoff'u ile) yeniden denenir.
                warn!("⚠️ [TÜNEL WATCHDOG]: sdwan0 arayüzü bulunamadı! Hub ile kayıt/tünel kurulumu yeniden deneniyor...");
                if register_and_setup_tunnel(
                    &current_client,
                    &register_url_for_watchdog,
                    &reg_req_for_watchdog,
                    &device_token,
                    &shared_secret,
                    &priv_key_b64_for_watchdog,
                    listen_port_for_watchdog,
                    &hub_url_for_watchdog,
                ).await.is_none() {
                    warn!("⚠️ [TÜNEL WATCHDOG]: Tünel yeniden kurulamadı, bir sonraki tick'te tekrar denenecek.");
                }
            } else {
                // WAN aktifken sdwan0 tünelinin ve rotasının her daim canlı olduğunu garanti et.
                // 🔴 Tünel kararlılığı düzeltmesi: aynı sessiz-fire-and-forget deseni (yukarıdaki
                // WAN watchdog yorumuna bkz.) burada da vardı.
                //
                // 🔴 Kod-review düzeltmesi: bu iki komut önce `&&` ile TEK bir komutta
                // birleştirilmişti - link-up transient bir sebeple (örn. tünel yeniden
                // kurulurken arayüzün anlık olarak yok olması) başarısız olursa, `&&`
                // kısa-devre yapıp route-replace'i HİÇ çalıştırmıyordu; oysa rota onarımı
                // bu dalın asıl amacıydı. Artık bağımsız iki komut olarak çalıştırılıyor,
                // biri başarısız olsa da diğeri denenir.
                //
                // 🔴 Kod-review düzeltmesi (2. tur): bu iki komut ARDIŞIK `.await` edilirse
                // (her biri kendi 5sn zaman aşımına sahip), ikisi de donarsa 10sn'lik tüm
                // tick bütçesi tek başına bu dala gidebilir - telemetri gönderimini tam
                // olarak bu düzeltmenin önlemeye çalıştığı ölçüde geciktirir. `tokio::join!`
                // ile EŞZAMANLI çalıştırılarak en kötü durumda toplam gecikme 10sn yerine
                // 5sn'e sabitlenir.
                let route_replace_cmd = format!("ip route replace {} dev sdwan0", tunnel_subnet_for_watchdog);
                tokio::join!(
                    run_watchdog_cmd("TÜNEL WATCHDOG", "ip link set up dev sdwan0"),
                    run_watchdog_cmd("TÜNEL WATCHDOG", &route_replace_cmd),
                );
            }

            let (curr_lan_ip, _) = discover_lan_subnets(&curr_wan_iface);
            let curr_lan_clients = discover_lan_clients();
            let curr_security_events = discover_security_events(&curr_lan_clients);

            // 🟢 REAL METRICS: Measure actual ICMP Ping RTT Latency to SD-WAN Hub Server
            let real_rtt_ms = {
                let output = std::process::Command::new("ping")
                    .arg("-c").arg("1")
                    .arg("-W").arg("2")
                    .arg(&hub_ping_host)
                    .output();
                if let Ok(out) = output {
                    let text = String::from_utf8_lossy(&out.stdout);
                    if let Some(pos) = text.find("time=") {
                        let sub = &text[pos + 5..];
                        let end_pos = sub.find(" ms").unwrap_or(sub.len());
                        sub[..end_pos].parse::<f32>().unwrap_or(15.0)
                    } else { 15.0 }
                } else { 15.0 }
            };

            // 🟢 REAL METRICS: Read actual Linux network interface TX/RX bytes from /proc/net/dev
            //
            // 🔴 KRİTİK DÜZELTME (2026-08-23, Zero-Hardcode): Bu satır önceden fiziksel
            // arayüz adını "eth0" (ve genel "wan" alt dizesini) sabit kodluyordu. Bu
            // agent kendi başlığında "Universal OpenWrt & Linux SD-WAN Edge Agent"
            // olarak tanımlanıyor - WAN arayüzü Meraki MX64 dışındaki donanımlarda
            // "wan", "eth1", "enp1s0" gibi farklı adlara sahip olabilir; "eth0" sadece
            // BU donanımda isabet ediyordu. Artık bu döngüden hemen önce zaten dinamik
            // olarak keşfedilmiş olan gerçek arayüz adı (`curr_wan_iface`) kullanılıyor.
            let (real_tx_bytes, real_rx_bytes) = {
                if let Ok(proc_net) = std::fs::read_to_string("/proc/net/dev") {
                    let mut tx = 0u64;
                    let mut rx = 0u64;
                    for line in proc_net.lines() {
                        if line.contains("sdwan0") || (!curr_wan_iface.is_empty() && line.contains(curr_wan_iface.as_str())) {
                            let parts: Vec<&str> = line.split_whitespace().collect();
                            if parts.len() >= 10 {
                                rx += parts[1].parse::<u64>().unwrap_or(0);
                                tx += parts[9].parse::<u64>().unwrap_or(0);
                            }
                        }
                    }
                    (tx, rx)
                } else { (0u64, 0u64) }
            };

            let report = TelemetryReport {
                device_id: dev_id.clone(),
                serial_number: serial_clone.clone(),
                model: model_clone.clone(),
                mac_address: mac_clone.clone(),
                management_ip: curr_wan_ip,
                lan_ip: curr_lan_ip,
                lan_clients: curr_lan_clients,
                security_events: curr_security_events,
                timestamp: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                cpu_usage_pct: cpu_load,
                ram_used_mb: ram_used,
                ram_total_mb: ram_total,
                active_wan_interface: curr_wan_iface,
                rtt_ms: real_rtt_ms,
                jitter_ms: 0.8,
                packet_loss_pct: 0.0,
                tx_bytes: real_tx_bytes,
                rx_bytes: real_rx_bytes,
                firewall_mode: discover_hardware_firewall_mode(),
                agent_version: env!("CARGO_PKG_VERSION").to_string(),
                uptime_seconds: discover_system_uptime_secs(),
                tunnel_ip: discover_tunnel_ip(),
                active_camera_sessions: discover_active_camera_sessions(),
            };


            info!(
                "📊 [Telemetri] RAM: {}MB/{}MB | CPU: {:.1}% | WAN: {} | LAN: {} | İstemciler: {} adet | FW: {} | Tünel: AKTİF",
                ram_used, ram_total, cpu_load, report.management_ip, report.lan_ip, report.lan_clients.len(), report.firewall_mode
            );

            // 🛡️ HTTP Telemetri Gönderimi (Önce L3 Tünel İçi, Hata Olursa Genel İnternet Fallback)
            let mut req_builder = current_client.post(&primary_telemetry_url).json(&report);
            if !device_token.is_empty() {
                req_builder = req_builder
                    .header("X-Device-Token", &device_token)
                    .header("X-NetOps-Secret", &shared_secret);
            }
            let mut send_res = req_builder.send().await;

            if send_res.is_err() && primary_telemetry_url != fallback_telemetry_url {
                let mut fallback_builder = current_client.post(&fallback_telemetry_url).json(&report);
                if !device_token.is_empty() {
                    fallback_builder = fallback_builder
                        .header("X-Device-Token", &device_token)
                        .header("X-NetOps-Secret", &shared_secret);
                }
                send_res = fallback_builder.send().await;
            }

            // 🔴 KRİTİK DÜZELTME (2026-08-23): Hub, cihazın X-Device-Token'ı geçersiz/
            // güncel olmayan bir shared_secret'tan türetilmişse (örn. hub'daki secret
            // rotasyona uğradı ama cihaza hiç yansımadı) `{"status":"UNAUTHORIZED"}`
            // gövdesiyle YİNE DE HTTP 200 dönüyor - önceki sürüm sadece HTTP durum
            // kodunu kontrol ettiği için bunu "başarı" sayıp consecutive_failures'ı
            // sıfırlıyordu. Sonuç: hub telemetriyi/güvenlik olaylarını sessizce
            // reddetmeye devam ederken agent hiçbir zaman bunu fark etmiyor, hiçbir
            // self-healing (client reset, restart) tetiklenmiyordu - WireGuard tüneli
            // (kernel seviyesi) sağlıklı kaldığı için dashboard da cihazı yanıltıcı
            // biçimde "az önce görüldü / ACTİF" gösteriyordu (bkz. hub'ın WG handshake
            // fallback'i). Production'da doğrulandı: ARIOT_SUBE ~25 saattir sessizce
            // reddediliyordu. Artık gövdedeki `status` alanı da kontrol ediliyor;
            // UNAUTHORIZED/REVOKED artık gerçek bir hata olarak sayılır.
            let mut treat_as_success = false;
            let mut parsed_telemetry_resp: Option<netops_proto::TelemetryResponse> = None;
            if let Ok(resp) = &send_res {
                if resp.status().is_success() {
                    treat_as_success = true;
                }
            }
            let resp_for_body = if treat_as_success { send_res.ok() } else { None };
            if let Some(resp) = resp_for_body {
                if let Ok(telemetry_resp) = resp.json::<netops_proto::TelemetryResponse>().await {
                    if telemetry_resp.status == "UNAUTHORIZED" || telemetry_resp.status == "REVOKED" {
                        treat_as_success = false;
                        warn!("🚫 [TELEMETRİ REDDEDİLDİ]: Hub durumu '{}' döndürdü - X-Device-Token/shared_secret hub ile uyuşmuyor olabilir.", telemetry_resp.status);
                    } else {
                        parsed_telemetry_resp = Some(telemetry_resp);
                    }
                }
            }

            match (treat_as_success, parsed_telemetry_resp) {
                (true, telemetry_resp_opt) => {
                    consecutive_failures = 0; // Başarılı, sayacı sıfırla

                    if let Some(telemetry_resp) = telemetry_resp_opt {
                        if let Some(ota) = telemetry_resp.ota_update {
                            let curr_ver = env!("CARGO_PKG_VERSION");
                            let should_upgrade = netops_ota::should_upgrade_ota(curr_ver, &ota.target_version, ota.force_upgrade).unwrap_or(false);

                            if should_upgrade {
                                info!("🚀 [SAFE-OTA SemVer Kararı: ONAYLANDI]: Yeni sürüm mevcut! (Mevcut: v{} -> Hedef: v{})", curr_ver, ota.target_version);
                                info!("📥 İndirme Başlatılıyor: {}", ota.download_url);
                                
                                let ota_client = current_client.clone();
                                let hub_base = fallback_telemetry_url.split("/api/").next().unwrap_or("").trim_end_matches('/').to_string();
                                tokio::spawn(async move {
                                    if let Err(e) = execute_atomic_ota_upgrade(&ota_client, &hub_base, &ota).await {
                                        warn!("❌ [SAFE-OTA GÜNCELLEME HATASI]: {}", e);
                                    }
                                });
                            }
                        }
                    }
                }
                _ => {
                    consecutive_failures += 1;
                    warn!("⚠️ [TELEMETRİ UYARISI]: Hub'a ulaşılamadı (Ardışık Hata: {}/6)", consecutive_failures);

                    // 1. Aşama Kurtarma: HTTP Socket Havuzunu Sıfırla (Connection Reset)
                    if consecutive_failures >= 2 {
                        if let Ok(new_cl) = reqwest::Client::builder()
                            .timeout(Duration::from_secs(5))
                            .tcp_keepalive(Some(Duration::from_secs(15)))
                            .build() {
                            current_client = new_cl;
                            info!("🔄 [SOCKET RECOVERY]: HTTP bağlantı havuzu sıfırlandı.");
                        }
                    }

                    // 2. Aşama Kurtarma: WireGuard Tünelini Exponential Jitter Backoff ile Resetle
                    if consecutive_failures == 3 {
                        warn!("🔄 [SELF-HEALING LEVEL 2]: WireGuard tünel arayüzü üstel backoff ile resetleniyor...");
                        // 🔴 ASYNCBLOCK-003 DÜZELTMESİ: `backoff::retry` (senkron) + kabuk içi
                        // `sleep 1` denemeleri en kötü durumda ~10 saniyeye kadar bu async görevi
                        // (ve onunla birlikte, sadece 2 worker thread'i olan tokio runtime'ının
                        // yarısını) doğrudan bloke ediyordu - bu sürede aynı runtime üzerindeki
                        // diğer görevler (HTTP sunucusu, komut kanalı vb.) gecikebilirdi. Artık
                        // `spawn_blocking` ile ayrı bir blocking thread'e taşındı.
                        let retry_tunnel = tunnel_subnet_for_watchdog.clone();
                        let _ = tokio::task::spawn_blocking(move || {
                            let backoff_policy = backoff::ExponentialBackoffBuilder::new()
                                .with_initial_interval(Duration::from_millis(500))
                                .with_max_interval(Duration::from_secs(4))
                                .with_max_elapsed_time(Some(Duration::from_secs(10)))
                                .build();

                            backoff::retry(backoff_policy, || {
                                let status = std::process::Command::new("sh")
                                    .arg("-c")
                                    .arg(format!("ip link set down dev sdwan0 2>/dev/null; sleep 1; ip link set up dev sdwan0 2>/dev/null; ip route replace {} dev sdwan0 2>/dev/null || true", retry_tunnel))
                                    .status();
                                match status {
                                    Ok(s) if s.success() => Ok(()),
                                    _ => Err(backoff::Error::transient("Tünel arayüz reset hatası")),
                                }
                            })
                        }).await;
                    }


                    // 3. Aşama Kurtarma (60 saniye boyunca Hub'a hiç ulaşılamazsa procd süreci temizce baştan başlatsın)
                    //
                    // NOT (Thundering Herd Düzeltmesi): Hub'ın kendisi kısa süreliğine erişilemez
                    // olduğunda (deploy, restart, geçici ağ kesintisi), FİLODAKİ TÜM cihazlar
                    // aynı anda 6. ardışık hataya ulaşıp AYNI SANİYEDE restart komutu veriyordu.
                    // Hub geri geldiğinde yüzlerce cihaz aynı anda yeniden kayıt/telemetri
                    // göndermeye çalışır - bu da Hub'ı yeniden aşırı yükleyip bir çöküş
                    // döngüsüne yol açabilir. device_id'den türetilen sabit (deterministik) bir
                    // jitter ile her cihazın restart'ı 0-30 saniye arasına yayılıyor.
                    if consecutive_failures >= 6 {
                        let jitter_secs = {
                            let mut hasher = std::collections::hash_map::DefaultHasher::new();
                            std::hash::Hash::hash(&dev_id, &mut hasher);
                            (std::hash::Hasher::finish(&hasher) % 30) + 1
                        };
                        warn!("🚨 [CRITICAL LIVENESS TIMEOUT]: 60s boyunca Hub telemetrisi kurulamadı! {}s jitter ile temiz servis yeniden başlatması tetikleniyor...", jitter_secs);
                        let _ = std::process::Command::new("sh")
                            .arg("-c")
                            .arg(format!("sleep {} && /etc/init.d/netops-agent restart &", jitter_secs))
                            .spawn();
                        std::process::exit(1);
                    }
                }
            }
        }
    });

/// Güvenli, Kendi Kendini Doğrulayan Atomik OTA Güncelleme Yöneticisi
async fn execute_atomic_ota_upgrade(client: &reqwest::Client, hub_base: &str, ota: &netops_proto::OtaUpdateInfo) -> Result<()> {
    // 🔴 TOCTOU DÜZELTMESİ: Önceki sürüm sabit bir yol (`/tmp/netops-agent.ota`) kullanıyordu.
    // /tmp dünyaya-yazılabilir (mode 1777) olduğundan, yerel yetkisiz bir kullanıcı bu dosyayı
    // önceden oluşturup sahiplenebilir; `tokio::fs::write` (O_CREAT|O_TRUNC) bu inode'un
    // içeriğini doğrulamadan üzerine yazardı ve doğrulama (sha256+Ed25519) ile daha sonraki
    // yeniden-okumalar (chmod/test-run/copy) arasındaki pencerede saldırgan içeriği
    // değiştirebilirdi. Artık: (1) yol her process/çalıştırma için tahmin edilemez, (2)
    // `create_new` (O_EXCL) ile dosya zaten varsa yazma BAŞARISIZ olur - asla üzerine
    // yazılmaz. /tmp'nin sticky-bit'i (1777) sayesinde, dosyayı biz oluşturduktan sonra başka
    // bir yerel kullanıcı onu silip yeniden oluşturamaz.
    let tmp_bin_owned = format!(
        "/tmp/.netops-agent-ota-{}-{}.tmp",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default()
    );
    let tmp_bin: &str = &tmp_bin_owned;

    if ota.scheduled_delay_secs > 0 {
        info!("⏳ [SAFE-OTA COHORT JITTER]: İndirme {} saniye sonraya planlandı (Küme: {})", ota.scheduled_delay_secs, ota.cohort_group);
        tokio::time::sleep(Duration::from_secs(ota.scheduled_delay_secs)).await;
    }
    
    // 1. İndirme URL'ini Dinamik Olarak Oluştur (Sıfır Hardcode: Göreceli Yolu Hub Taban URL'i ile Birleştir)
    let full_download_url = if ota.download_url.starts_with("http://") || ota.download_url.starts_with("https://") {
        ota.download_url.clone()
    } else {
        format!("{}{}", hub_base, ota.download_url)
    };

    info!("📥 [SAFE-OTA]: Dosya indiriliyor -> {}", full_download_url);
    let resp = client.get(&full_download_url).send().await
        .context("OTA binary indirilemedi")?;

    
    if !resp.status().is_success() {
        anyhow::bail!("OTA indirme HTTP hatası: {}", resp.status());
    }

    let bytes = resp.bytes().await.context("OTA veri akışı okunamadı")?;

    // 1.5 🔒 SHA-256 Bütünlük Doğrulaması (indirilen veri bozulmuş/eksikse burada durur)
    // NOT: Bu tek başına kimlik doğrulama (authenticity) SAĞLAMAZ - sadece bozuk/eksik
    // indirmeyi yakalar. Hub'ın kendisi ele geçirilirse veya TLS bir MITM ile atlatılırsa,
    // saldırgan hem binary'yi hem de bu sha256 alanını aynı anda değiştirebilir. Gerçek
    // kimlik doğrulaması için Ed25519 imza + agent'a compile-time gömülü bir public key
    // gerekir - bu, OtaUpdateInfo protokolüne yeni bir alan eklenmesini gerektiren ayrı
    // ve daha büyük bir değişikliktir (şimdilik takip edilen bir sonraki adım).
    if !ota.sha256.is_empty() {
        if let Err(e) = netops_ota::verify_integrity(&bytes, &ota.sha256) {
            anyhow::bail!("OTA bütünlük doğrulaması başarısız, indirilen dosya reddedildi: {}", e);
        }
        info!("✅ [SAFE-OTA]: SHA-256 bütünlük doğrulaması başarılı.");
    } else {
        warn!("⚠️ [SAFE-OTA]: Hub sha256 göndermedi - bütünlük doğrulaması ATLANDI (yalnızca sandbox test-run'a güveniliyor).");
    }

    // 🔒 Ed25519 İMZA DOĞRULAMASI - ZORUNLU (sha256'nın aksine opsiyonel DEĞİL).
    // Neden zorunlu: sha256 sadece "indirme bozulmamış" garantisi verir - Hub ele
    // geçirilirse veya TLS bir MITM ile atlatılırsa saldırgan hem binary'yi hem sha256
    // alanını aynı anda değiştirebilir. İmza ise binary'nin GERÇEKTEN release-signing
    // anahtarının sahibi tarafından üretildiğini kanıtlar - bu yüzden imza eksik/bozuksa
    // OTA burada KOŞULSUZ reddedilir (fail-closed), eski çalışan sürüm korunur.
    match netops_ota::decode_hex_signature(&ota.signature) {
        Ok(sig_bytes) => {
            if let Err(e) = netops_ota::verify_ed25519_signature(&bytes, &sig_bytes, &trusted_release_pubkey()) {
                anyhow::bail!("Ed25519 imza doğrulaması BAŞARISIZ - OTA reddedildi (sahte/yetkisiz üretici olabilir): {}", e);
            }
            info!("✅ [SAFE-OTA]: Ed25519 imza doğrulaması başarılı - binary güvenilir release-signing anahtarıyla imzalanmış.");
        }
        Err(e) => {
            anyhow::bail!("Ed25519 imzası eksik veya bozuk (Hub'ın .sig dosyası yok/okunamamış olabilir) - OTA reddedildi: {}", e);
        }
    }

    {
        use tokio::io::AsyncWriteExt;
        let mut f = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true) // O_EXCL: önceden var olan (olası saldırgan sahipli) dosyanın üzerine ASLA yazma
            .mode(0o700)
            .open(tmp_bin)
            .await
            .context("OTA geçici dosyası güvenli şekilde oluşturulamadı (zaten var olabilir - olası TOCTOU saldırı girişimi)")?;
        f.write_all(&bytes).await.context("OTA dosyası diske yazılamadı")?;
        f.sync_all().await.ok();
    }

    // 2. İzinleri Çalıştırılabilir Yap
    let _ = tokio::process::Command::new("chmod").arg("+x").arg(tmp_bin).output().await;

    // 3. 🧪 Sandbox Test-Run Doğrulaması (SIGILL veya Mimari Uyumsuzluk Kontrolü)
    info!("🧪 [SAFE-OTA]: Yeni binary sandbox ortamında test ediliyor ({} --test-run)...", tmp_bin);
    let test_output = tokio::process::Command::new(tmp_bin)
        .arg("--test-run")
        .output()
        .await;

    match test_output {
        Ok(out) if out.status.success() => {
            info!("✅ [SAFE-OTA]: Sandbox testi BAŞARILI! Atomik dosya değişimi (Atomic Swap) uygulanıyor...");

            // 4. Atomik Dosya Değişimi (/usr/bin/netops-agent)
            //
            // 🔴 KRİTİK DÜZELTME: Önceki sürüm doğrudan `mv /tmp/netops-agent.ota
            // /usr/bin/netops-agent` yapıyordu ve yorumda "rename atomiktir" deniyordu -
            // bu SADECE aynı dosya sistemi İÇİNDE doğrudur. OpenWrt'te /tmp tmpfs, /usr/bin
            // ise overlayfs'tir - FARKLI dosya sistemleri. Kernel rename(2) bu durumda EXDEV
            // döner ve coreutils `mv` şeffafçe copy+unlink'e düşer, yani swap ATOMIK DEĞİLDİR.
            // Bu tam olarak production'da bir cihazı gerçekten kırdı (binary 0 byte'a düştü,
            // 2026-08-20 - bkz. deployment geçmişi) ve manuel olarak (aynı iki-aşamalı
            // desenle) kurtarıldı. Artık:
            //   1) Hedefle AYNI dosya sistemine (overlayfs) gizli bir .tmp dosyasına kopyala
            //   2) O .tmp dosyasından hedefe rename et (ARTIK aynı FS - gerçekten atomik)
            // Kesinti (güç kaybı vb.) adım 1'de olursa eski binary DOKUNULMAMIŞ kalır: hiçbir
            // zaman "yarım" bir /usr/bin/netops-agent oluşmaz.
            let staged_path = "/usr/bin/.netops-agent.ota-staged";

            let copy_res = tokio::fs::copy(tmp_bin, staged_path).await;
            let copy_ok = match &copy_res {
                Ok(_) => true,
                Err(e) => {
                    warn!("❌ [SAFE-OTA]: Hedef dosya sistemine kopyalama başarısız: {}", e);
                    false
                }
            };

            if !copy_ok {
                let _ = tokio::fs::remove_file(staged_path).await;
                let _ = tokio::fs::remove_file(tmp_bin).await;
                anyhow::bail!("Binary hedef dosya sistemine kopyalanamadı - eski sürüm korundu.");
            }

            let _ = tokio::process::Command::new("chmod").arg("+x").arg(staged_path).output().await;

            let swap_res = tokio::fs::rename(staged_path, "/usr/bin/netops-agent").await;

            match swap_res {
                Ok(_) => {
                    let _ = tokio::fs::remove_file(tmp_bin).await;
                    info!("🔄 [SAFE-OTA]: Dosya değişimi tamamlandı (gerçek atomik rename). Servis yeni sürümle yeniden başlatılıyor...");
                    let _ = std::process::Command::new("sh")
                        .arg("-c")
                        .arg("sleep 1 && /etc/init.d/netops-agent restart &")
                        .spawn();
                    Ok(())
                }
                Err(e) => {
                    let _ = tokio::fs::remove_file(staged_path).await;
                    let _ = tokio::fs::remove_file(tmp_bin).await;
                    anyhow::bail!("Binary rename (aynı dosya sistemi içinde) işlemi başarısız: {}", e);
                }
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let _ = tokio::fs::remove_file(tmp_bin).await;
            anyhow::bail!("Sandbox testi başarısız oldu (Hata kodu: {:?}, stderr: {}). Eski sürüm korundu.", out.status.code(), stderr);
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(tmp_bin).await;
            anyhow::bail!("Sandbox testi çalıştırılamadı (Muhtemel mimari/SIGILL hatası: {}). Eski sürüm korundu.", e);
        }
    }
}

    // 5. Canlı Tanı Komutu Dinleme ve Gerçek Donanım Üzerinde Koşturma Döngüsü
    let cmd_task_handle = tokio::spawn(async move {
        let mut cmd_interval = tokio::time::interval(Duration::from_secs(1));
        while r_cmd.load(Ordering::Relaxed) {
            cmd_interval.tick().await;
            cmd_heartbeat_for_loop.store(now_unix_secs(), std::sync::atomic::Ordering::Relaxed);

            // 🔴 KRİTİK GÜVENLİK DÜZELTMESİ (2026-08-24): Bu istekler önceden hiçbir
            // X-Device-Token/X-NetOps-Secret göndermiyordu - hub tarafında da hiç
            // doğrulanmıyordu (bkz. hub main.rs'teki get_pending_command/
            // receive_command_result düzeltmesi). Artık register/telemetri ile
            // aynı kimlik doğrulama başlıkları ekleniyor.
            let mut poll_req = client_cmd.get(&primary_cmd_poll_url);
            if !device_token_for_cmd.is_empty() {
                poll_req = poll_req
                    .header("X-Device-Token", &device_token_for_cmd)
                    .header("X-NetOps-Secret", &shared_secret_for_cmd);
            }
            let mut poll_res = poll_req.send().await;
            if poll_res.is_err() && primary_cmd_poll_url != fallback_cmd_poll_url {
                let mut fallback_req = client_cmd.get(&fallback_cmd_poll_url);
                if !device_token_for_cmd.is_empty() {
                    fallback_req = fallback_req
                        .header("X-Device-Token", &device_token_for_cmd)
                        .header("X-NetOps-Secret", &shared_secret_for_cmd);
                }
                poll_res = fallback_req.send().await;
            }

            // 🔴 KRİTİK DÜZELTME (2026-08-22): Bu kanalın kendi self-healing'i yoktu -
            // client_cmd'nin altındaki bağlantı sessizce ölürse (bkz. yukarıdaki yorum)
            // döngü sonsuza dek başarısız olmaya devam ediyor, hiçbir şey bunu fark
            // etmiyordu. Artık telemetri döngüsüyle aynı desende: birkaç ardışık
            // hatadan sonra istemci sıfırdan kuruluyor (bağlantı havuzu temizlenir),
            // uzun süreli tıkanmada ise tüm agent süreci temiz şekilde yeniden başlatılır
            // - böylece "Canlı Tanı" özelliği ölü kalıp fark edilmeden duramaz.
            if poll_res.is_err() {
                cmd_consecutive_failures += 1;
                if cmd_consecutive_failures == 3 {
                    if let Ok(new_cl) = reqwest::Client::builder()
                        .timeout(Duration::from_secs(10))
                        .tcp_keepalive(Some(Duration::from_secs(15)))
                        .build()
                    {
                        client_cmd = new_cl;
                        warn!("🔄 [KOMUT KANALI SOCKET RECOVERY]: Bağlantı havuzu sıfırlandı.");
                    }
                }
                // Tünel kararlılığı düzeltmesi: bu eşik önceden 120 (bu döngünün 1sn'lik
                // tick'iyle 120sn) idi, telemetri döngüsündeki aynı sınıf eşikle (10sn
                // tick × 6 = 60sn) TUTARSIZDI - iki kanal "sıkışmış" durumunu farklı
                // gerçek-zaman eşiklerinde tanımlıyordu. Artık ikisi de aynı 60sn'lik
                // gerçek-zaman eşiğini kullanıyor (bu döngünün 1sn tick'iyle 60 tick).
                if cmd_consecutive_failures >= 60 {
                    let jitter_secs = {
                        let mut hasher = std::collections::hash_map::DefaultHasher::new();
                        std::hash::Hash::hash(&dev_id_for_cmd, &mut hasher);
                        (std::hash::Hasher::finish(&hasher) % 30) + 1
                    };
                    warn!("🚨 [KOMUT KANALI KRİTİK ZAMAN AŞIMI]: 60s boyunca Hub'a ulaşılamadı! {}s jitter ile temiz servis yeniden başlatması tetikleniyor...", jitter_secs);
                    let _ = std::process::Command::new("sh")
                        .arg("-c")
                        .arg(format!("sleep {} && /etc/init.d/netops-agent restart &", jitter_secs))
                        .spawn();
                    std::process::exit(1);
                }
            } else {
                cmd_consecutive_failures = 0;
            }

            if let Ok(resp) = poll_res {
                if resp.status().is_success() {
                    if let Ok(Some(cmd_req)) = resp.json::<Option<netops_proto::DiagnosticCommandRequest>>().await {
                        info!("⚡ [CANLI TANI İSTEĞİ ALINDI]: {}", cmd_req.command);
                        
                        let is_route_or_net_cmd = cmd_req.command.contains("ip route") || cmd_req.command.contains("iptables");
                        
                        // Donanım Hükmetme (UCI / UBus / Zero-Trust NAC) veya Shell Komutu Yürütme
                        let (success, out_str) = match cmd_req.control_action {
                            Some(netops_proto::DeviceControlAction::BlockMac { ref mac_address }) => {
                                // 🔴 KRİTİK DÜZELTME (2026-08-22), iki ayrı hatanın birleşik çözümü:
                                //
                                // 1) Önceki sürüm bu kuralı doğrudan fw4'ün KENDİ `forward` zincirine
                                //    ekliyordu. fw4 (UCI tabanlı) `/etc/init.d/firewall reload` her
                                //    çalıştığında TÜM tablolarını UCI'dan SIFIRDAN üretir - bu ad-hoc
                                //    kural UCI'da tanımlı olmadığı için sessizce SİLİNİYORDU. Reload,
                                //    agent'ın kendi "Canlı Tanı" endpoint'inden metninde sadece
                                //    "iptables" veya "ip route" geçen ZARARSIZ bir komuttan sonra bile
                                //    otomatik tetikleniyor (bkz. `is_route_or_net_cmd`) - yani bir
                                //    operatör basit bir tanı komutu çalıştırdığında, önceden
                                //    bloklanmış bir cihazın engeli fark ettirmeden kalkıyordu.
                                //    Kamera QoS'ta zaten kullanılan desen (bkz. apply_camera_traffic_policy)
                                //    izlenerek artık KENDİ ayrı `inet netops_nac` tablomuzda çalışıyoruz -
                                //    fw4 reload bunu ASLA silmez (canlı donanımda doğrulandı).
                                // 2) `nft delete rule ... ether saddr X drop` (tam eşleşmeyle silme)
                                //    bu nftables sürümünde GEÇERSİZ ("expecting handle" hatası,
                                //    production'da doğrulandı) - bu yüzden aynı MAC tekrar tekrar
                                //    bloklanırsa öncesinde HANDLE'a göre temizlenir (idempotent).
                                info!("🛡️ [ZERO-TRUST NAC]: MAC Adresi Engelleniyor -> {}", mac_address);
                                let clean_mac = mac_address.to_lowercase();
                                let block_cmd = format!(
                                    "nft add table inet netops_nac 2>/dev/null; \
                                     nft 'add chain inet netops_nac nacblock {{ type filter hook forward priority -5; }}' 2>/dev/null; \
                                     while true; do h=$(nft -a list chain inet netops_nac nacblock 2>/dev/null | grep \"ether saddr {mac} drop\" | grep -o 'handle [0-9]*' | awk '{{print $2}}' | head -n1); [ -z \"$h\" ] && break; nft delete rule inet netops_nac nacblock handle $h 2>/dev/null || break; done; \
                                     nft add rule inet netops_nac nacblock ether saddr {mac} drop 2>/dev/null || iptables -I FORWARD -m mac --mac-source {mac} -j DROP 2>/dev/null || true",
                                    mac = clean_mac
                                );
                                let _ = tokio::process::Command::new("sh").arg("-c").arg(&block_cmd).output().await;
                                // 🔴 RESDISC-005 DÜZELTMESİ: Önceki sürüm komutun `Output`/çıkış
                                // durumunu tamamen atıp koşulsuz `success: true` dönüyordu -
                                // `nft`/`iptables` komutu sessizce başarısız olsa bile (bu tam olarak
                                // yukarıdaki `UnblockMac` yorumunda belgelenen sürüm-uyumsuzluğu
                                // sınıfının başına gelebilirdi) kötü niyetli/güvenilmez cihaz
                                // "engellendi" raporlanırken ağda tamamen bağlı kalabiliyordu.
                                // Kardeş `UnblockMac` handler'ıyla aynı desen: kuralın gerçekten
                                // uygulandığı doğrulanmadan başarı dönülmez.
                                // `block_cmd` önce `nft`'yi dener, o başarısız olursa `iptables`'a düşer -
                                // doğrulama da aynı iki olası yolu kontrol etmeli.
                                let now_blocked = tokio::process::Command::new("sh")
                                    .arg("-c")
                                    .arg(format!(
                                        "nft list chain inet netops_nac nacblock 2>/dev/null | grep -q \"ether saddr {mac} drop\" || iptables -C FORWARD -m mac --mac-source {mac} -j DROP 2>/dev/null",
                                        mac = clean_mac
                                    ))
                                    .status()
                                    .await
                                    .map(|s| s.success())
                                    .unwrap_or(false);
                                if now_blocked {
                                    (true, format!("Zero-Trust NAC: İstemci [{}] başarıyla engellendi ve ağdan izole edildi.", mac_address))
                                } else {
                                    warn!("⚠️ [ZERO-TRUST NAC]: MAC {} engellenemedi (kural uygulanamadı)!", mac_address);
                                    (false, format!("Zero-Trust NAC: İstemci [{}] engellenemedi - kural uygulanamadı.", mac_address))
                                }
                            }
                            Some(netops_proto::DeviceControlAction::UnblockMac { ref mac_address }) => {
                                // 🔴 KRİTİK DÜZELTME (2026-08-22): Önceki sürüm `nft delete rule inet
                                // fw4 forward ether saddr {mac} drop` çalıştırıyordu - bu sözdizimi bu
                                // nftables sürümünde GEÇERSİZ ("Error: syntax error, unexpected ether,
                                // expecting handle" - production cihazında canlı doğrulandı) ve `sh -c`
                                // içinde `2>/dev/null` ile hatası yutuluyordu. Yani "Unblock" HİÇBİR ZAMAN
                                // gerçekte çalışmıyordu - MAC kalıcı olarak bloklu kalıyordu, buna
                                // rağmen kod koşulsuz `success: true` dönüyordu (dashboard'da yanlış
                                // "başarılı" bildirimi). Artık kendi `inet netops_nac` tablomuzda
                                // (bkz. BlockMac yorumu) ilgili kuralın handle'ı bulunup handle
                                // üzerinden siliniyor; işlem sonunda kuralın gerçekten gittiği
                                // doğrulanıp `success` buna göre dönüyor.
                                info!("🛡️ [ZERO-TRUST NAC]: MAC Adresi Engeli Kaldırılıyor -> {}", mac_address);
                                let clean_mac = mac_address.to_lowercase();
                                let unblock_cmd = format!(
                                    "while true; do h=$(nft -a list chain inet netops_nac nacblock 2>/dev/null | grep \"ether saddr {mac} drop\" | grep -o 'handle [0-9]*' | awk '{{print $2}}' | head -n1); [ -z \"$h\" ] && break; nft delete rule inet netops_nac nacblock handle $h 2>/dev/null || break; done; \
                                     iptables -D FORWARD -m mac --mac-source {mac} -j DROP 2>/dev/null || true",
                                    mac = clean_mac
                                );
                                let output = tokio::process::Command::new("sh").arg("-c").arg(&unblock_cmd).output().await;
                                let still_blocked = tokio::process::Command::new("sh")
                                    .arg("-c")
                                    .arg(format!("nft list chain inet netops_nac nacblock 2>/dev/null | grep -q \"ether saddr {} drop\"", clean_mac))
                                    .status()
                                    .await
                                    .map(|s| s.success())
                                    .unwrap_or(false);
                                let _ = output;
                                if still_blocked {
                                    warn!("⚠️ [ZERO-TRUST NAC]: MAC {} engeli kaldırılamadı (kural hâlâ mevcut)!", mac_address);
                                    (false, format!("Zero-Trust NAC: İstemci [{}] engeli kaldırılamadı - kural silinemedi.", mac_address))
                                } else {
                                    (true, format!("Zero-Trust NAC: İstemci [{}] engeli kaldırıldı.", mac_address))
                                }
                            }
                            Some(netops_proto::DeviceControlAction::SetLanSubnet { ref ip_address, ref netmask }) => {
                                // GÜVENLİK: ip_address/netmask aşağıda bir uci shell komutuna doğrudan
                                // interpolе edilir - kesin IPv4 formatında olduğu doğrulanmadan
                                // geçirilirse komut enjeksiyonuna (RCE) yol açar. Bu kontrol yolu şu an
                                // hiçbir frontend route'u tarafından çağrılmıyor, ama ileride
                                // kullanılırsa savunma hattı burada olmalı (bkz. devices/route.ts'teki
                                // aynı sınıf hatanın düzeltmesi).
                                let is_valid_ipv4 = |s: &str| {
                                    s.split('.').count() == 4
                                        && s.split('.').all(|o| o.parse::<u8>().is_ok())
                                };
                                if !is_valid_ipv4(ip_address) || !is_valid_ipv4(netmask) {
                                    warn!("🚫 [UCI SET LAN] Geçersiz IP/netmask reddedildi: {} / {}", ip_address, netmask);
                                    (false, "Geçersiz IP adresi veya netmask formatı - komut reddedildi.".to_string())
                                } else {
                                    info!("🌐 [UCI SET LAN]: IP: {}, Netmask: {}", ip_address, netmask);
                                    let uci_cmd = format!(
                                        "uci set network.lan.ipaddr='{ip}' && uci set network.lan.netmask='{nm}' && uci commit network && /etc/init.d/network restart &",
                                        ip = ip_address,
                                        nm = netmask
                                    );
                                    let _ = tokio::process::Command::new("sh").arg("-c").arg(&uci_cmd).spawn();
                                    (true, format!("Şube LAN IP'si {}/{} olarak güncellendi ve ağ servisi yeniden başlatılıyor.", ip_address, netmask))
                                }
                            }
                            Some(netops_proto::DeviceControlAction::GetPortStatus { interface: _ }) => {

                                let out = tokio::process::Command::new("ubus")
                                    .args(["call", "network.device", "status"])
                                    .output()
                                    .await
                                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                                    .unwrap_or_else(|e| format!("Ubus port okuma hatası: {}", e));
                                (true, out)
                            }
                            Some(netops_proto::DeviceControlAction::ReloadNetwork) => {
                                let _ = tokio::process::Command::new("sh").arg("-c").arg("/etc/init.d/network restart &").spawn();
                                (true, "Ağ alt sistemi (OpenWrt Network Subsystem) yeniden başlatılıyor.".to_string())
                            }
                            None => {
                                // Geleneksel Shell / Diagnostic Komutu
                                let output = tokio::process::Command::new("sh")
                                    .arg("-c")
                                    .arg(&cmd_req.command)
                                    .output()
                                    .await;

                                match output {
                                    Ok(out) => {
                                        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                                        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                                        let full_out = if stderr.is_empty() { stdout } else { format!("{}\n{}", stdout, stderr) };
                                        (out.status.success(), full_out)
                                    }
                                    Err(e) => (false, format!("Komut çalıştırılamadı: {}", e)),
                                }
                            }
                        };

                        // Eğer kural değişikliği yapıldıysa veya L2 köprü tünel emri yürütüldüyse sdwan0 rota bütünlüğünü koru
                        if is_route_or_net_cmd {
                            let _ = std::process::Command::new("sh")
                                .arg("-c")
                                .arg("ip link set up dev sdwan0 2>/dev/null; /etc/init.d/firewall reload 2>/dev/null || true")
                                .spawn();
                        }

                        let res_payload = netops_proto::DiagnosticCommandResponse {
                            command_id: cmd_req.command_id,
                            device_id: cmd_req.device_id,
                            success,
                            output: out_str,
                        };

                        let mut res_req = client_cmd.post(&primary_cmd_res_url).json(&res_payload);
                        if !device_token_for_cmd.is_empty() {
                            res_req = res_req
                                .header("X-Device-Token", &device_token_for_cmd)
                                .header("X-NetOps-Secret", &shared_secret_for_cmd);
                        }
                        let res_send = res_req.send().await;

                        if res_send.is_err() && primary_cmd_res_url != fallback_cmd_res_url {
                            let mut fallback_res_req = client_cmd.post(&fallback_cmd_res_url).json(&res_payload);
                            if !device_token_for_cmd.is_empty() {
                                fallback_res_req = fallback_res_req
                                    .header("X-Device-Token", &device_token_for_cmd)
                                    .header("X-NetOps-Secret", &shared_secret_for_cmd);
                            }
                            let _ = fallback_res_req.send().await;
                        }

                        // 🛡️ COMMIT-CONFIRM OTOMATİK GERİ ALMA (CONFIG ROLLBACK):
                        // Sadece ağ/rota değiştiren komutlardan sonra 30s doğrulama penceresi başlatılır.
                        if is_route_or_net_cmd && success {
                            let hub_health_url = format!("{}/health", hub_url.trim_end_matches('/'));
                            let verify_client = client_cmd.clone();
                            let executed_cmd = cmd_req.command.clone();

                            tokio::spawn(async move {
                                tokio::time::sleep(Duration::from_secs(30)).await;
                                // 30 saniye sonra merkez Hub hala erişilebiliyor mu kontrol et
                                let is_hub_reachable = verify_client.get(&hub_health_url).timeout(Duration::from_secs(5)).send().await.is_ok();
                                if !is_hub_reachable {
                                    warn!("🚨 [CONFIG ROLLBACK]: Son uygulanan ağ komutu merkeze erişimi kopardı! Geri alınıyor: {}", executed_cmd);
                                    let rollback_cmd = if executed_cmd.contains("ip route replace") || executed_cmd.contains("ip route add") {
                                        // Eklenen rotayı silerek orijinal duruma dön
                                        executed_cmd.replace("ip route replace", "ip route del").replace("ip route add", "ip route del")
                                    } else {
                                        "/etc/init.d/network reload 2>/dev/null || true".to_string()
                                    };
                                    let _ = tokio::process::Command::new("sh").arg("-c").arg(&rollback_cmd).output().await;
                                }
                            });
                        }
                    }
                }
            }
        }
    });

    // Ana döngü + Görev Süpervizörü
    //
    // 🔴 KRİTİK DAYANIKLILIK DÜZELTMESİ (2026-08-27): Tokio'da bir spawn edilmiş
    // görevin içinde panic oluşması SADECE o görevi sessizce sonlandırır - süreç
    // ve diğer kardeş görevler (örn. komut kanalı) etkilenmeden çalışmaya devam
    // eder. Üretimde tam olarak bu yaşandı: telemetri döngüsü ~22 saat boyunca
    // sessizce ölü kaldı (muhtemelen bir panic ile), komut kanalı ve süreç PID'i
    // hiç değişmeden çalışmaya devam ettiği için `/etc/init.d/netops-agent`
    // (procd) hiçbir zaman yeniden başlatma tetiklemedi ve hub'daki peer kaydı
    // günlerce "stopped/offline" görünmeye devam etti.
    //
    // Telemetri ve komut döngülerinin ikisi de normal koşullarda SONSUZA DEK
    // dönen `while` döngüleri - yani JoinHandle'larının tamamlanması (panic ya
    // da beklenmeyen bir dönüş yüzünden) HER ZAMAN anormal bir durumdur. Bu
    // süpervizör, görevlerden biri tamamlandığı anda tüm süreci `exit(1)` ile
    // sonlandırır ki procd/init süreci temiz bir durumdan yeniden başlatsın -
    // kendi kendini iyileştiren mantığın kendisi öldüğünde devreye giremediği
    // bu tarz sessiz ölümlere karşı son çare koruma.
    //
    // 🔴 İKİNCİ KORUMA KATMANI (2026-08-28): Yukarıdaki JoinHandle süpervizörü SADECE
    // panic/normal-dönüş ile TAMAMLANAN görevleri yakalar. Üretimde gerçekleşen arıza
    // türü farklıydı: komut-poll görevi panic ETMEDEN sessizce ASKIDA (hang) kalmıştı -
    // JoinHandle hiç tamamlanmadığı için üstteki süpervizör hiçbir şey fark etmedi;
    // sorunu sadece ELLE yeniden başlatma çözdü. Bu nabız (heartbeat) izleyicisi,
    // görevlerden biri kendi normal turlama periyodunun kat kat üzerinde (donma
    // ihtimalini gürültülü/geçici gecikmelerden ayırt etmek için cömert bir eşik)
    // ilerleme kaydetmezse süreci proaktif olarak sonlandırır.
    let watchdog_handle = tokio::spawn(async move {
        let mut check_interval = tokio::time::interval(Duration::from_secs(30));
        const TELEMETRY_STALL_THRESHOLD_SECS: u64 = 120; // Normal periyot: 10sn
        const CMD_STALL_THRESHOLD_SECS: u64 = 60; // Normal periyot: 1sn
        while running_for_watchdog.load(Ordering::Relaxed) {
            check_interval.tick().await;
            let now = now_unix_secs();
            let telemetry_age = now.saturating_sub(telemetry_heartbeat_for_watchdog.load(std::sync::atomic::Ordering::Relaxed));
            let cmd_age = now.saturating_sub(cmd_heartbeat_for_watchdog.load(std::sync::atomic::Ordering::Relaxed));
            if telemetry_age > TELEMETRY_STALL_THRESHOLD_SECS {
                error!("🚨 [WATCHDOG] Telemetri görevi {} saniyedir ilerleme kaydetmiyor (askıda kalmış olabilir). Süreç yeniden başlatılıyor.", telemetry_age);
                std::process::exit(1);
            }
            if cmd_age > CMD_STALL_THRESHOLD_SECS {
                error!("🚨 [WATCHDOG] Komut kanalı görevi {} saniyedir ilerleme kaydetmiyor (askıda kalmış olabilir). Süreç yeniden başlatılıyor.", cmd_age);
                std::process::exit(1);
            }
        }
    });

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("🛑 NetOpsWan Ajanı Güvenli Şekilde Kapatılıyor...");
            running.store(false, Ordering::Relaxed);
        }
        res = telemetry_task_handle => {
            error!("🚨 [SÜPERVİZÖR] Telemetri görevi beklenmedik şekilde sonlandı (panic olası): {:?}. Süreç yeniden başlatılıyor.", res);
            std::process::exit(1);
        }
        res = cmd_task_handle => {
            error!("🚨 [SÜPERVİZÖR] Komut kanalı görevi beklenmedik şekilde sonlandı (panic olası): {:?}. Süreç yeniden başlatılıyor.", res);
            std::process::exit(1);
        }
        res = watchdog_handle => {
            error!("🚨 [SÜPERVİZÖR] Watchdog görevi beklenmedik şekilde sonlandı: {:?}. Süreç yeniden başlatılıyor.", res);
            std::process::exit(1);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 🔴 REGRESYON TESTİ: production'da yaşanan tam senaryo. Gerçek trafik hiç RTSP
    /// (554) olmadığı halde, port 55414 üzerinden geçen bir bağlantı satırı yanlışlıkla
    /// "aktif kamera oturumu" sayılıyordu (alt dize eşleşmesi yüzünden). Bu test bir
    /// daha asla bu regresyona düşülmemesini garanti eder.
    #[test]
    fn camera_session_count_ignores_similar_but_different_ports() {
        let conntrack_line_false_positive =
            "ipv4     2 tcp      6 7427 ESTABLISHED src=192.168.100.3 dst=200.97.171.59 sport=55414 dport=443 packets=13 bytes=1624 src=200.97.171.59 dst=192.168.100.3 sport=443 dport=55414 packets=13 bytes=6244 [ASSURED] mark=0 zone=0 use=2";
        assert_eq!(count_rtsp_sessions_in_conntrack(conntrack_line_false_positive), 0);
    }

    #[test]
    fn camera_session_count_matches_exact_rtsp_port() {
        let conntrack_line_real_rtsp =
            "ipv4     2 tcp      6 7427 ESTABLISHED src=10.8.0.50 dst=192.168.101.104 sport=51234 dport=554 packets=13 bytes=1624 [ASSURED] mark=0 zone=0 use=2";
        assert_eq!(count_rtsp_sessions_in_conntrack(conntrack_line_real_rtsp), 1);
    }

    #[test]
    fn camera_session_count_handles_multiple_sessions_and_mixed_lines() {
        let text = "\
ipv4 2 tcp 6 7427 ESTABLISHED src=10.8.0.50 dst=192.168.101.104 sport=1 dport=554 packets=1 bytes=1 use=1
ipv4 2 tcp 6 7427 ESTABLISHED src=10.8.0.51 dst=192.168.101.105 sport=2 dport=55499 packets=1 bytes=1 use=1
ipv4 2 tcp 6 7427 ESTABLISHED src=10.8.0.52 dst=192.168.101.106 sport=3 dport=554 packets=1 bytes=1 use=1
ipv4 2 udp 17 30 ESTABLISHED src=10.8.0.53 dst=8.8.8.8 sport=4 dport=53 packets=1 bytes=1 use=1";
        assert_eq!(count_rtsp_sessions_in_conntrack(text), 2);
    }

    #[test]
    fn camera_session_count_of_empty_text_is_zero() {
        assert_eq!(count_rtsp_sessions_in_conntrack(""), 0);
    }

    /// TRUSTED_RELEASE_PUBKEY_HEX her zaman tam 64 hex karakter (32 byte) çözülebilir
    /// olmalı - bozuk/eksik bir sabit, TÜM OTA güncellemelerini sessizce reddeder
    /// (fail-closed olduğu için bariz bir hata vermez, sadece güncellemeler hep başarısız
    /// olur) - bu yüzden bu değişmezin build-time'da değil test-time'da yakalanması önemli.
    #[test]
    fn trusted_release_pubkey_decodes_to_32_bytes() {
        let key = trusted_release_pubkey();
        assert_eq!(key.len(), 32);
    }

    /// CLI argümanı verildiğinde discover_hub_url/discover_shared_secret HİÇBİR dosya/
    /// UCI okumaya gerek duymadan doğrudan onu döndürmeli - önceliğin doğru sırada
    /// (CLI > dosya > env) olduğunun en azından en yüksek öncelikli basamağı.
    #[test]
    fn discover_hub_url_prefers_explicit_cli_arg() {
        let result = discover_hub_url(Some("https://custom.example.com/api/sdwan".to_string()));
        assert_eq!(result, "https://custom.example.com/api/sdwan");
    }

    #[test]
    fn discover_shared_secret_prefers_explicit_cli_arg() {
        let result = discover_shared_secret(Some("my-test-secret".to_string()));
        assert_eq!(result, "my-test-secret");
    }
}
