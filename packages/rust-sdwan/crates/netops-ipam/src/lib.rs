use indexmap::IndexMap;
use ipnet::Ipv4Net;
use smallvec::SmallVec;
use std::collections::HashSet;
use std::net::Ipv4Addr;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum IpamError {
    #[error("Geçersiz CIDR formatı: {0}")]
    InvalidCidr(String),
    #[error("IPAM havuzunda boş IP adresi kalmadı: {0}")]
    PoolExhausted(String),
    #[error("Alt ağ çakışması tespit edildi: {0} ile {1}")]
    SubnetOverlap(String, String),
}

/// Düşük kaynaklı donanımlarda heap tahsisini sıfırlayan küçük rota vektörü (4 rotaya kadar stack'te tutulur)
pub type FastRouteList = SmallVec<[Ipv4Net; 4]>;

#[derive(Debug, Clone)]
pub struct IpamPool {
    pub network: Ipv4Net,
}

impl IpamPool {
    pub fn new(cidr_str: &str) -> Result<Self, IpamError> {
        let network: Ipv4Net = cidr_str
            .parse()
            .map_err(|_| IpamError::InvalidCidr(cidr_str.to_string()))?;
        Ok(Self { network })
    }

    /// Havuzdan kullanılan IP'ler hariç sıradaki boş IP'yi bitwise olarak tahsis eder
    pub fn allocate_next_ip(&self, used_ips: &HashSet<Ipv4Addr>) -> Result<String, IpamError> {
        // .0 network, .1 Hub varsayılarak spoke'lar 2. hosttan başlar
        for host in self.network.hosts().skip(1) {
            if !used_ips.contains(&host) {
                return Ok(format!("{}/{}", host, self.network.prefix_len()));
            }
        }
        Err(IpamError::PoolExhausted(self.network.to_string()))
    }

    /// İki alt ağ arasında çakışma (overlap) olup olmadığını kontrol eder
    pub fn check_overlap(net1_str: &str, net2_str: &str) -> Result<bool, IpamError> {
        let n1: Ipv4Net = net1_str.parse().map_err(|_| IpamError::InvalidCidr(net1_str.to_string()))?;
        let n2: Ipv4Net = net2_str.parse().map_err(|_| IpamError::InvalidCidr(net2_str.to_string()))?;
        Ok(n1.contains(&n2) || n2.contains(&n1) || n1.trunc() == n2.trunc())
    }
}

/// Sıralı ekleme garantili ve O(1) arama yapabilen deterministik Şube/IP Kayıt Defteri (IndexMap)
#[derive(Debug, Clone, Default)]
pub struct DeterministicFleetRegistry {
    /// device_id -> virtual_ip haritası (ekleme sırası korunur)
    peers: IndexMap<String, Ipv4Addr>,
}

impl DeterministicFleetRegistry {
    pub fn new() -> Self {
        Self {
            peers: IndexMap::new(),
        }
    }

    pub fn register(&mut self, device_id: String, ip: Ipv4Addr) {
        self.peers.insert(device_id, ip);
    }

    pub fn unregister(&mut self, device_id: &str) -> Option<Ipv4Addr> {
        self.peers.swap_remove(device_id)
    }

    pub fn get_ip(&self, device_id: &str) -> Option<&Ipv4Addr> {
        self.peers.get(device_id)
    }

    pub fn list_in_order(&self) -> Vec<(&String, &Ipv4Addr)> {
        self.peers.iter().collect()
    }

    pub fn count(&self) -> usize {
        self.peers.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ipam_allocation() {
        let pool = IpamPool::new("10.8.0.0/24").unwrap();
        let mut used = HashSet::new();
        let ip1 = pool.allocate_next_ip(&used).unwrap();
        assert_eq!(ip1, "10.8.0.2/24");

        used.insert("10.8.0.2".parse().unwrap());
        let ip2 = pool.allocate_next_ip(&used).unwrap();
        assert_eq!(ip2, "10.8.0.3/24");
    }

    #[test]
    fn test_deterministic_fleet_registry_ordering() {
        let mut registry = DeterministicFleetRegistry::new();
        registry.register("Istanbul-HQ".into(), "10.8.0.2".parse().unwrap());
        registry.register("Ankara-Branch".into(), "10.8.0.3".parse().unwrap());
        registry.register("Izmir-Branch".into(), "10.8.0.4".parse().unwrap());

        assert_eq!(registry.count(), 3);
        assert_eq!(registry.get_ip("Ankara-Branch"), Some(&"10.8.0.3".parse().unwrap()));

        // Ekleme sırasının bozulmadığı doğrulanır
        let list = registry.list_in_order();
        assert_eq!(list[0].0, "Istanbul-HQ");
        assert_eq!(list[1].0, "Ankara-Branch");
        assert_eq!(list[2].0, "Izmir-Branch");

        registry.unregister("Ankara-Branch");
        assert_eq!(registry.count(), 2);
        assert_eq!(registry.get_ip("Ankara-Branch"), None);
    }

    #[test]
    fn test_smallvec_fast_routes() {
        let mut routes: FastRouteList = SmallVec::new();
        routes.push("192.168.1.0/24".parse().unwrap());
        routes.push("192.168.2.0/24".parse().unwrap());
        assert!(!routes.spilled()); // Stack üzerinde tutulur (heap allocation yok!)
        assert_eq!(routes.len(), 2);
    }

    #[test]
    fn test_overlap() {
        assert!(IpamPool::check_overlap("192.168.1.0/24", "192.168.1.128/25").unwrap());
        assert!(!IpamPool::check_overlap("192.168.1.0/24", "192.168.2.0/24").unwrap());
    }
}
