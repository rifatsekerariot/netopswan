use serde::{Deserialize, Serialize};
use x25519_dalek::{PublicKey, StaticSecret};

use rand_core::OsRng;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// Cihaz Kimlik ve El Sıkışma Paketi (Handshake / Peer Registration)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerRegistrationRequest {
    pub device_id: String,
    pub serial_number: String,
    pub model: String,
    pub mac_address: String,
    pub management_ip: String,
    pub public_key: String,
    pub local_ip_ranges: Vec<String>, // Örn: ["192.168.10.0/24"]
    pub tunnel_listen_port: u16,
    pub agent_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerRegistrationResponse {
    pub assigned_virtual_ip: String, // Örn: "10.8.0.42/24"
    pub tunnel_subnet: String,       // Hub IPAM Havuz Bloğu (Örn: "10.8.0.0/16" veya dinamik yapılandırılan havuz)
    #[serde(default)]
    pub hub_virtual_ip: String,      // Hub'ın tünel içi sanal IP'si (Örn: "10.8.0.1")
    pub hub_public_key: String,
    pub hub_endpoint: String,         // Örn: "sdwan.ariot.com.tr:51820"
    pub keepalive_interval_secs: u16,
    pub status: String,
    #[serde(default)]
    pub ota_update: Option<OtaUpdateInfo>,
    // Kamera/NVR Trafik Yönetimi (Bölüm 3) - fleet-çapında bir bant genişliği tavanı
    // (SAYISAL bir politika değeri, IP/kimlik bilgisi DEĞİL). Agent, RTSP (tcp/554)
    // trafiğini port imzasından kendi başına otomatik tanır ve HER ZAMAN bu tavanı
    // uygular - hiçbir NVR/kamera IP'si hiçbir yere girilmez.
    #[serde(default)]
    pub camera_bandwidth_ceil_kbps: u32,
}

/// Otomatik Güvenli OTA Güncelleme Bilgisi
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtaUpdateInfo {
    pub target_version: String,
    pub download_url: String,
    pub sha256: String,
    #[serde(default)]
    pub force_upgrade: bool,
    #[serde(default)]
    pub scheduled_delay_secs: u64,
    #[serde(default)]
    pub cohort_group: String,
    // Ed25519 imzası (hex-encoded, 64 byte). Boşsa (eski Hub sürümü) agent OTA'yı
    // REDDEDER - sha256'nın aksine bu alan agent tarafında ZORUNLUDUR, çünkü
    // imzalamanın tüm amacı "Hub ele geçirilse bile sahte binary kabul edilmesin"
    // garantisidir; opsiyonel bırakmak bu garantiyi anlamsızlaştırır.
    #[serde(default)]
    pub signature: String,
}


/// Canlı Telemetri Yanıtı (Hub -> Meraki)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TelemetryResponse {
    pub status: String,
    #[serde(default)]
    pub ota_update: Option<OtaUpdateInfo>,
}

/// Yerel Ağda (LAN) Keşfedilen Aktif İstemci Cihaz (DHCP Lease / ARP)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanClient {
    pub mac_address: String,
    pub ip_address: String,
    pub hostname: String,
}

/// Güvenlik ve Ağ Log Olayı (Şube Router -> Hub)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityEvent {
    pub timestamp: u64,
    pub event_type: String, // "DNS_QUERY", "BLOCKED_PORT", "CONN_ANOMALY", "DHCP_LEASE", "AUTH_FAIL"
    pub src_ip: String,
    pub src_mac: String,
    pub dst_ip: String,
    pub dst_port: u16,
    pub protocol: String,   // "UDP", "TCP", "DNS", "ICMP"
    pub domain_query: String,
    pub action_taken: String, // "PASS", "LOG", "BLOCKED"
    pub severity: String,     // "INFO", "WARN", "CRITICAL"
}

/// Akıllı Tehdit ve Anomali Alarmı (Merkezi DuckDB Motoru -> UI)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreatAlert {
    pub alert_id: String,
    pub timestamp: u64,
    pub device_id: String,
    pub branch_name: String,
    pub threat_type: String,  // "C2_DOMAIN", "RANSOMWARE_BEHAVIOR", "PORT_SCAN", "SMB_ANOMALY", "DATA_EXFIL"
    pub client_ip: String,
    pub client_mac: String,
    pub client_hostname: String,
    pub confidence_score: f32, // 0.0 - 1.0
    pub baseline_diff_pct: f32, // Normal ortalamadan sapma yüzdesi (örn: +350%)
    pub description: String,
    pub recommended_action: String, // "ISOLATE_CLIENT", "BLOCK_DOMAIN", "REVIEW"
    pub status: String, // "PENDING_REVIEW", "QUARANTINED", "DISMISSED"
}

/// Canlı Telemetri Paketi (Meraki -> Hub)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryReport {
    pub device_id: String,
    pub serial_number: String,
    pub model: String,
    pub mac_address: String,
    pub management_ip: String,
    #[serde(default)]
    pub lan_ip: String,
    #[serde(default)]
    pub lan_clients: Vec<LanClient>,
    #[serde(default)]
    pub security_events: Vec<SecurityEvent>,
    pub timestamp: u64,
    pub cpu_usage_pct: f32,
    pub ram_used_mb: u32,
    pub ram_total_mb: u32,
    pub active_wan_interface: String,
    pub rtt_ms: f32,
    pub jitter_ms: f32,
    pub packet_loss_pct: f32,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    #[serde(default)]
    pub firewall_mode: String, // "DROP_ALL", "WHITELIST", "OPEN"
    #[serde(default)]
    pub agent_version: String,
    #[serde(default)]
    pub uptime_seconds: u64,
    #[serde(default)]
    pub tunnel_ip: String, // Cihazda fiilen yapılandırılmış overlay tünel arayüzünün IP'si (Örn: "10.8.0.3/16")
    // Kamera/NVR gözlemlenebilirliği (Bölüm 3) - agent, sdwan0 üzerinden geçen RTSP
    // (tcp/554) conntrack girişlerini sayar. Sıfır yapılandırma: hiçbir NVR/kamera IP'si
    // bilinmez, sadece "şu an bu şubede kaç aktif RTSP oturumu var" raporlanır.
    #[serde(default)]
    pub active_camera_sessions: u32,
}


/// Donanım Hükmetme ve Zero-Trust NAC Emir Türleri
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeviceControlAction {
    /// Zero-Trust NAC: İstemciyi MAC adresi bazında engelle / karantinaya al
    BlockMac { mac_address: String },
    /// Zero-Trust NAC: İstemcinin engelini kaldır
    UnblockMac { mac_address: String },
    /// UCI Ağ Yapılandırması: Şube LAN IP ve Alt Ağını Değiştir
    SetLanSubnet { ip_address: String, netmask: String },
    /// OpenWrt UBus: Belirli bir ethernet portunun link durumunu oku
    GetPortStatus { interface: String },
    /// OpenWrt UBus: Tüm ağ alt sistemini yeniden yükle
    ReloadNetwork,
}

/// Canlı Teşhis / Komut Gönderme Paketi (Hub -> Meraki)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticCommandRequest {
    pub command_id: String,
    pub device_id: String,
    pub command: String,
    #[serde(default)]
    pub control_action: Option<DeviceControlAction>,
}

/// Canlı Teşhis Komut Yanıtı (Meraki -> Hub)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticCommandResponse {
    pub command_id: String,
    pub device_id: String,
    pub success: bool,
    pub output: String,
}

/// Kriptografik Anahtar Çifti Yönetimi (Curve25519)
#[derive(Debug, Clone)]
pub struct KeyPair {
    pub private_key: [u8; 32],
    pub public_key: [u8; 32],
}

impl KeyPair {
    pub fn generate() -> Self {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public = PublicKey::from(&secret);
        Self {
            private_key: secret.to_bytes(),
            public_key: public.to_bytes(),
        }
    }

    pub fn load_or_generate(key_path: &str) -> Self {
        if let Ok(content) = std::fs::read_to_string(key_path) {
            let lines: Vec<&str> = content.lines().collect();
            if lines.len() >= 2 {
                if let (Ok(priv_bytes), Ok(pub_bytes)) = (BASE64.decode(lines[0].trim()), BASE64.decode(lines[1].trim())) {
                    if priv_bytes.len() == 32 && pub_bytes.len() == 32 {
                        let mut priv_arr = [0u8; 32];
                        let mut pub_arr = [0u8; 32];
                        priv_arr.copy_from_slice(&priv_bytes);
                        pub_arr.copy_from_slice(&pub_bytes);
                        return Self {
                            private_key: priv_arr,
                            public_key: pub_arr,
                        };
                    }
                }
            }
        }

        let new_kp = Self::generate();
        let _ = std::fs::create_dir_all("/etc/netops");
        let content = format!("{}\n{}", new_kp.private_key_base64(), new_kp.public_key_base64());
        let _ = std::fs::write(key_path, content);
        new_kp
    }

    pub fn public_key_base64(&self) -> String {
        BASE64.encode(self.public_key)
    }

    pub fn private_key_base64(&self) -> String {
        BASE64.encode(self.private_key)
    }
}

/// Standart Dinamik IPv4 IPAM Havuz Ayrıştırıcı (Sıfır Hardcode, Saf Matematiksel Hesaplama)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ipv4Subnet {
    pub network_addr: std::net::Ipv4Addr,
    pub prefix_len: u8,
}

impl Ipv4Subnet {
    pub fn parse(cidr_str: &str) -> Option<Self> {
        let mut parts = cidr_str.split('/');
        let ip_str = parts.next()?.trim();
        let prefix_len = parts.next().unwrap_or("24").trim().parse::<u8>().ok()?;
        let ip: std::net::Ipv4Addr = ip_str.parse().ok()?;
        Some(Self {
            network_addr: ip,
            prefix_len,
        })
    }

    /// Ağdaki n'inci IP'yi hesapla (Örn: offset=1 -> Gateway IP, offset=2 -> İlk İstemci)
    pub fn nth_ip(&self, offset: u32) -> std::net::Ipv4Addr {
        let ip_u32 = u32::from(self.network_addr);
        std::net::Ipv4Addr::from(ip_u32 + offset)
    }

    pub fn nth_ip_with_cidr(&self, offset: u32) -> String {
        format!("{}/{}", self.nth_ip(offset), self.prefix_len)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keypair_generation() {
        let kp = KeyPair::generate();
        let pub_b64 = kp.public_key_base64();
        let priv_b64 = kp.private_key_base64();
        assert_eq!(pub_b64.len(), 44); // 32 bytes base64 is 44 chars
        assert_eq!(priv_b64.len(), 44);
    }

    #[test]
    fn test_ipv4_subnet_math() {
        let subnet = Ipv4Subnet::parse("172.20.0.0/16").unwrap();
        assert_eq!(subnet.nth_ip_with_cidr(1), "172.20.0.1/16");
        assert_eq!(subnet.nth_ip_with_cidr(42), "172.20.0.42/16");
    }
}
