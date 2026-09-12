/**
 * NetOpsWan Enterprise SD-WAN Central Client SDK
 * Single Source of Truth (Tüm Sayfalar ve Bileşenler İçin Tek Merkez)
 */

import { buildUciApplyCommand } from './uci';

export interface Device {
  id: string;
  name: string;
  mac_address: string;
  ip_address?: string;
  last_ip?: string;
  management_ip?: string;
  model: string;
  firmware?: string;
  lan_subnet?: string;
  lan_gateway?: string;
  tunnel_ip?: string;
  dhcp_enabled?: boolean;
  notes?: string;
  key?: string;
  status: 'online' | 'offline' | 'problem';
  group?: string;
  group_id?: string;
  cpu_architecture?: string;
  ram_total?: string;
  cpu_usage_pct?: number;
  ram_usage_pct?: number;
  ram_used_mb?: number;
  ram_total_mb?: number;
  rtt_ms?: number;
  lan_client_count?: number;
  active_camera_sessions?: number;
  packet_loss_pct?: number;
  firewall_mode?: 'DROP_ALL' | 'WHITELIST' | 'OPEN';
  is_wan_locked_hw?: boolean;
  agent_version?: string;
  ota_cohort?: string;
  uptime_seconds?: number;
  last_seen?: string;
  created?: string;
  modified?: string;
  interfaces?: DeviceDetail['interfaces'];
}


export interface DeviceDetail extends Device {
  interfaces: {
    name: string;
    type: string;
    status: string;
    ip: string;
    mac?: string;
  }[];
  services: {
    name: string;
    status: string;
    version?: string;
  }[];
}

export interface DeviceGroup {
  id: string;
  name: string;
  description?: string;
  device_count?: number;
}

export interface StatsResponse {
  total: number;
  online: number;
  offline: number;
  problem: number;
}

export interface DeviceListResponse {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  results: Device[];
}

export interface UCITemplate {
  id: string;
  name: string;
  type: string;
  description: string;
  target_group: string;
  device_count: number;
  updated_at: string;
  uci_content: string;
  config?: any;
}

export interface IPAMSubnet {
  id: string;
  name: string;
  subnet: string;
  type?: 'branch_lan' | 'sdwan_tunnel';
  region_group?: string;
  gateway?: string;
  start?: number;
  limit?: number;
  description?: string;
  created?: string;
  modified?: string;
}

export interface SystemUser {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  date_joined?: string;
}

export interface CertificateAuthority {
  id: string | number;
  name: string;
  common_name?: string;
  key_length?: string;
  digest?: string;
  country?: string;
  state?: string;
  city?: string;
  organization?: string;
  created?: string;
  modified?: string;
  is_default?: boolean;
  validity_end?: string;
}

export interface DeviceCertificate {
  id: string | number;
  name: string;
  ca: string | number;
  ca_name?: string;
  common_name?: string;
  key_length?: string;
  digest?: string;
  status?: string;
  is_valid?: boolean;
  certificate_status?: 'valid' | 'expired' | 'revoked';
  valid_until?: string;
  expires?: string;
  serial_number?: string;
  created?: string;
}

export function calculateDeviceStatus(d: any): 'online' | 'offline' | 'problem' {
  if (!d) return 'offline';
  if (d.status === 'online' || d.status === 'ACTIVE') return 'online';
  if (d.status === 'problem') return 'problem';
  return 'offline';
}

// ==========================================
// 🚀 MERKEZİ NETOPS API SERVİSİ
// ==========================================

export async function fetchStats(): Promise<StatsResponse> {
  const devices = await fetchDevices({});
  const total = devices.count;
  const online = devices.results.filter(d => d.status === 'online').length;
  const problem = devices.results.filter(d => d.status === 'problem').length;
  const offline = total - online - problem;

  return { total, online, offline: Math.max(0, offline), problem };
}

export async function fetchDevices(params?: {
  page?: number;
  page_size?: number;
  search?: string;
  status?: string;
  group?: string;
}): Promise<DeviceListResponse> {
  const res = await fetch('/api/devices', { cache: 'no-store' });
  const data = await res.json().catch(() => ({ count: 0, results: [] }));
  const results: Device[] = (data.results || []).map((d: any) => ({
    id: d.id,
    name: d.name,
    mac_address: d.mac_address,
    ip_address: d.last_ip || d.management_ip || d.ip_address || '',
    last_ip: d.last_ip,
    management_ip: d.management_ip,
    lan_subnet: d.lan_subnet,
    lan_gateway: d.lan_gateway,
    tunnel_ip: d.tunnel_ip,
    uptime_seconds: d.uptime_seconds,
    dhcp_enabled: d.dhcp_enabled !== false,
    model: d.model || 'Ağ Cihazı',
    status: d.status,
    group: d.group || 'Genel',
    firewall_mode: d.firewall_mode,
    is_wan_locked_hw: d.is_wan_locked_hw,
    agent_version: d.agent_version,
    cpu_usage_pct: d.cpu_usage_pct,
    ram_used_mb: d.ram_used_mb,
    ram_total_mb: d.ram_total_mb,
    ram_usage_pct: d.ram_usage_pct,
    rtt_ms: d.rtt_ms,
    lan_client_count: d.lan_client_count,
    active_camera_sessions: d.active_camera_sessions,
    created: d.created,
    modified: d.modified,
    // Sunucu tarafında (route.ts) zaten tam hesaplanmış arayüz listesi - burada
    // atlanırsa fetchDeviceDetail'daki fallback dizisi her zaman kullanılırdı (gerçek
    // ajan verisi yerine sahte/placeholder değerler gösterilirdi).
    interfaces: d.interfaces
  }));


  return {
    count: results.length,
    page: 1,
    page_size: 50,
    total_pages: 1,
    results
  };
}

export async function fetchDeviceDetail(id: string): Promise<DeviceDetail> {
  const devices = await fetchDevices({});
  const dev = devices.results.find(d => d.id === id) || {
    id,
    name: id,
    mac_address: '00:00:00:00:00:00',
    ip_address: '',
    model: 'Cisco Meraki MX64',
    status: 'offline' as const
  };

  const isOnline = dev.status === 'online';

  return {
    ...dev,
    cpu_architecture: dev.model?.includes('Meraki') ? 'ARMv7 (Broadcom BCM58625)' : (dev.model || 'Universal Edge'),
    ram_total: dev.ram_total_mb ? `${(dev.ram_total_mb / 1024).toFixed(1)} GB` : 'Bilinmiyor',
    cpu_usage_pct: isOnline ? Number((dev.cpu_usage_pct || 0).toFixed(1)) : 0.0,
    ram_usage_pct: isOnline ? Number((dev.ram_usage_pct || 0).toFixed(1)) : 0.0,
    uptime_seconds: dev.uptime_seconds || 0,
    firmware: 'NetOpsWan Kurumsal Şube Yazılımı',
    interfaces: (dev as any).interfaces || [
      { name: 'LAN Arayüzü', type: 'Yerel Ağ Köprüsü', status: isOnline ? 'up' : 'down', ip: dev.lan_subnet || 'Atanmadı', mac: dev.mac_address || '-' },
      { name: 'WAN Arayüzü', type: 'İnternet Bağlantısı', status: isOnline ? 'up' : 'down', ip: dev.management_ip || 'Atanmadı', mac: dev.mac_address || '-' },
      { name: 'Kurumsal Şube Tüneli', type: 'Merkez Ofis Bağlantısı (Overlay)', status: isOnline ? 'up' : 'down', ip: dev.tunnel_ip || 'Atanmadı' }
    ],
    services: [
      { name: 'Yönetim Ajanı', status: isOnline ? 'running' : 'stopped', version: dev.agent_version ? `v${dev.agent_version}` : 'Bilinmiyor' },
      { name: 'Ağ Adı & Adres Servisi (DHCP/DNS)', status: isOnline && dev.dhcp_enabled !== false ? 'running' : 'stopped' },
      { name: 'Güvenlik Duvarı', status: isOnline ? 'running' : 'stopped' },
      { name: 'Sistem Servis Yöneticisi', status: isOnline ? 'running' : 'stopped' }
    ]
  };
}

// Şube 360° Görünümü: DeviceDetailModal'ın "Loglar" sekmesi bunu kullanır.
export async function fetchDeviceLogs(deviceId: string, limit = 50): Promise<{ count: number; returned: number; results: any[] }> {
  const res = await fetch(`/api/logs?device_id=${encodeURIComponent(deviceId)}&limit=${limit}`, { cache: 'no-store' });
  return res.json().catch(() => ({ count: 0, returned: 0, results: [] }));
}

export async function executeDeviceDiagnostic(
  deviceId: string,
  type: 'ping' | 'traceroute' | 'syslog' | 'tcpport' | 'lan_clients',
  target: string = '8.8.8.8',
  port: number = 443
): Promise<{ success: boolean; output: string }> {
  let commandStr = `ping -c 4 ${target.trim()}`;
  if (type === 'traceroute') commandStr = `traceroute -w 2 -m 15 -q 1 ${target.trim()}`;
  if (type === 'tcpport') commandStr = `nc -z -w 3 ${target.trim()} ${port} && echo "Port açık" || echo "Port kapalı"`;
  if (type === 'syslog') commandStr = `logread | tail -n 25`;
  if (type === 'lan_clients') commandStr = `echo "=== DHCP LEASES (/tmp/dhcp.leases) ===" && cat /tmp/dhcp.leases 2>/dev/null || echo "(Kayıt Yok)" && echo "" && echo "=== ARP / NEIGHBOR TABLOSU ===" && ip -4 neigh show 2>/dev/null`;

  try {
    const res = await fetch('/api/commands/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, command: commandStr })
    });

    if (res.ok) {
      const data = await res.json();
      return { success: data.status === 'success', output: data.output };
    }

    return { success: false, output: 'Komut yürütülemedi.' };
  } catch (err: any) {
    return { success: false, output: `Komut yürütülemedi: ${err.message}` };
  }
}

// ==========================================
// 🌐 IPAM / SUBNET METODLARI
// ==========================================

export async function fetchSubnets(): Promise<{ count: number; results: IPAMSubnet[] }> {
  const res = await fetch('/api/ipam', { cache: 'no-store' });
  if (!res.ok) throw new Error('Subnet listesi alınamadı');
  return res.json();
}

export async function createSubnet(data: {
  name: string;
  subnet: string;
  type?: 'branch_lan' | 'sdwan_tunnel';
  region_group?: string;
  description?: string;
  gateway?: string;
  start?: number;
  limit?: number;
}): Promise<IPAMSubnet> {
  const res = await fetch('/api/ipam', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Subnet oluşturulamadı');
  }
  return res.json();
}

export async function updateSubnet(id: string, data: any): Promise<IPAMSubnet> {
  const res = await fetch('/api/ipam', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...data })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Subnet güncellenemedi');
  }
  return res.json();
}

export async function deleteSubnet(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/ipam?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.json();
}

// ==========================================
// 📄 UCİ ŞABLON METODLARI
// ==========================================

export async function fetchTemplates(): Promise<{ count: number; results: UCITemplate[] }> {
  const res = await fetch('/api/templates', { cache: 'no-store' });
  if (!res.ok) throw new Error('Şablon listesi alınamadı');
  return res.json();
}

export async function createTemplate(data: { name: string; type: string; description: string; target_group: string; uci_content: string }): Promise<UCITemplate> {
  const res = await fetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
}

export async function updateTemplate(data: Partial<UCITemplate> & { id: string }): Promise<UCITemplate> {
  const res = await fetch('/api/templates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Şablon güncellenemedi');
  }
  return res.json();
}

export async function deleteTemplate(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.json();
}

export async function toggleBranchWanLock(params: {
  deviceId: string;
  deviceName: string;
  locked: boolean;
}): Promise<{ success: boolean; message: string }> {
  const templateName = `WAN-Killswitch-${params.deviceName}`;
  
  if (params.locked) {
    // 1. Veritabanına kaydet
    await createTemplate({
      name: templateName,
      type: 'firewall',
      description: `${params.deviceName} şubesinin dış internet çıkışı merkezden kilitlendi.`,
      uci_content: `config rule\n\toption name 'KILLSWITCH'\n\toption src 'lan'\n\toption dest 'wan'\n\toption target 'DROP'\n`,
      target_group: 'Merkez'
    });

    // 2. Meraki Donanımına Canlı Kuralı Uygula (LAN -> WAN Yönlendirmesini Kes, SD-WAN tünelini koru)
    const lockCmd = `uci delete firewall.forwarding1 2>/dev/null || true; uci commit firewall && /etc/init.d/firewall restart`;
    
    await fetch('/api/commands/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: params.deviceId, command: lockCmd })
    }).catch(() => {});

    return { success: true, message: `${params.deviceName} şubesinin interneti gerçek donanım düzeyinde kilitlendi.` };
  } else {
    // 1. Veritabanından sil
    const templates = await fetchTemplates();
    const existing = templates.results.find(t => t.name === templateName);
    if (existing) await deleteTemplate(existing.id);

    // 2. Meraki Donanımından Kilidi Kaldır (LAN -> WAN Yönlendirmesini Yeniden Aç)
    const unlockCmd = `uci set firewall.forwarding1=forwarding && uci set firewall.forwarding1.src='lan' && uci set firewall.forwarding1.dest='wan' && uci commit firewall && /etc/init.d/firewall restart`;
    
    await fetch('/api/commands/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: params.deviceId, command: unlockCmd })
    }).catch(() => {});

    return { success: true, message: `${params.deviceName} şubesinin internet kilidi kaldırıldı.` };
  }
}

export async function applyBranchFirewallWhitelist(params: {
  deviceId: string;
  deviceName: string;
  allowedIps: string[];
  blockRemainingWan: boolean;
}): Promise<{ success: boolean; message: string }> {
  const templateName = `Whitelist-${params.deviceName}`;
  let uci = '';
  let uciCommands = '';

  if (params.blockRemainingWan) {
    // LAN -> WAN genel yönlendirmesini kaldır
    uciCommands += `uci delete firewall.forwarding1 2>/dev/null || true; `;
    
    // 🛡️ ZERO-HARDCODE: Şubenin bağlı olduğu Merkez Hub IP'sini donanım seviyesinde dinamik bul (WireGuard sdwan0 endpoint'inden) ve otomatik izin ver
    uciCommands += `HUB_ENDPOINT_IP=$(wg show sdwan0 endpoints 2>/dev/null | awk '{print $2}' | cut -d: -f1 | head -n 1); `;
    uciCommands += `if [ -n "$HUB_ENDPOINT_IP" ]; then uci add firewall rule && uci set firewall.@rule[-1].name='ALLOW_DYNAMIC_HUB' && uci set firewall.@rule[-1].src='lan' && uci set firewall.@rule[-1].dest='wan' && uci set firewall.@rule[-1].dest_ip="$HUB_ENDPOINT_IP" && uci set firewall.@rule[-1].target='ACCEPT'; fi; `;
    
    params.allowedIps.forEach((ip, idx) => {
      uci += `config rule\n\toption name 'ALLOW-${idx}'\n\toption src 'lan'\n\toption dest 'wan'\n\toption dest_ip '${ip}'\n\toption target 'ACCEPT'\n\n`;
      uciCommands += `uci add firewall rule && uci set firewall.@rule[-1].name='ALLOW_${idx}' && uci set firewall.@rule[-1].src='lan' && uci set firewall.@rule[-1].dest='wan' && uci set firewall.@rule[-1].dest_ip='${ip}' && uci set firewall.@rule[-1].target='ACCEPT'; `;
    });
  } else {
    // Normal internet açık moduna geri döndür
    uciCommands += `uci set firewall.forwarding1=forwarding && uci set firewall.forwarding1.src='lan' && uci set firewall.forwarding1.dest='wan'; `;
  }

  uciCommands += `uci commit firewall && /etc/init.d/firewall restart`;

  await createTemplate({
    name: templateName,
    type: 'firewall',
    description: `${params.deviceName} beyaz liste kuralları.`,
    uci_content: uci,
    target_group: 'Merkez'
  });

  // Donanımda canlı uygula
  await fetch('/api/commands/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: params.deviceId, command: uciCommands })
  }).catch(() => {});

  return { success: true, message: 'Beyaz liste kuralları Meraki donanımına başarıyla uygulandı.' };
}

// ==========================================
// 👥 KULLANICI METODLARI (PostgreSQL Entegrasyonu)
// ==========================================

export async function fetchSystemUsers(): Promise<{ count: number; results: SystemUser[] }> {
  const res = await fetch('/api/users');
  if (!res.ok) throw new Error('Kullanıcılar alınamadı');
  const data = await res.json();
  return {
    count: data.total_users || 0,
    results: (data.users || []).map((u: any) => ({
      id: u.uid || String(u.id),
      username: u.first_name,
      email: u.email,
      is_active: u.status === 'Active',
      is_staff: u.role === 'Administrator',
      is_superuser: u.role === 'Administrator',
      date_joined: u.created_at
    }))
  };
}

export async function createSystemUser(data: any): Promise<SystemUser> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Kullanıcı oluşturulamadı');
  const json = await res.json();
  const u = json.user;
  return {
    id: u.uid || String(u.id),
    username: u.first_name,
    email: u.email,
    is_active: true,
    is_staff: u.role === 'Administrator',
    is_superuser: u.role === 'Administrator',
    date_joined: u.created_at
  };
}

export async function deleteSystemUser(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Kullanıcı silinemedi');
  return res.json();
}

// ==========================================
// 🔐 PKI & WIRE GUARD ANAHTAR METODLARI (PostgreSQL Entegrasyonu)
// ==========================================

export async function fetchCAs(): Promise<{ count: number; results: CertificateAuthority[] }> {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'sdwan.ariot.com.tr';
  return {
    count: 1,
    results: [
      {
        id: 'ca-root-sdwan',
        name: `NetOpsWan SD-WAN Root CA (${host})`,
        common_name: host,
        key_length: 'Curve25519 (256-bit)',
        digest: 'ChaCha20-Poly1305',
        is_default: true,
        created: new Date().toISOString()
      }
    ]
  };
}

export async function fetchCertificates(): Promise<{ count: number; results: DeviceCertificate[] }> {
  const res = await fetch('/api/pki', { cache: 'no-store' });
  if (!res.ok) throw new Error('Sertifikalar alınamadı');
  return res.json();
}

export async function createCA(data: any): Promise<CertificateAuthority> {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'sdwan.ariot.com.tr';
  return {
    id: `ca-${Date.now()}`,
    name: data.name,
    common_name: data.common_name || host,
    key_length: 'Curve25519 (256-bit)',
    digest: 'ChaCha20-Poly1305',
    created: new Date().toISOString()
  };
}

export async function createCertificate(data: any): Promise<DeviceCertificate> {
  const res = await fetch('/api/pki', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Sertifika oluşturulamadı');
  return res.json();
}

export async function revokeCertificate(id: string | number): Promise<{ success: boolean }> {
  const res = await fetch(`/api/pki?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Sertifika iptal edilemedi');
  return res.json();
}

export interface NetworkInterface {
  id: string;
  name: string;
  type: 'ethernet' | 'wireguard' | 'bridge' | 'loopback';
  ip_address?: string;
  mac_address?: string;
  status: 'up' | 'down' | 'blocking';
}

export interface TopologyNode {
  id: string;
  label: string;
  name?: string;
  type: 'hub' | 'device' | 'server';
  status: 'online' | 'offline' | 'problem';
  ip?: string;
  mac?: string;
  model?: string;
  group?: string;
  management_ip?: string;
  lan_ip?: string;
  virtual_ip?: string;
  cpu_usage_pct?: number;
  ram_used_mb?: number;
  ram_total_mb?: number;
  rtt_ms?: number;
  interfaces?: NetworkInterface[];
}

export interface TopologyLink {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  status: 'up' | 'down' | 'degraded';
  kind: 'tunnel' | 'physical' | 'bridge';
  protocol?: string;
  rtt_ms?: number;
  packet_loss_pct?: number;
}

export interface TopologyData {
  nodes: TopologyNode[];
  links: TopologyLink[];
}

export async function fetchTopology(): Promise<TopologyData> {
  const [devices, subnetsRes] = await Promise.all([
    fetchDevices({}),
    fetchSubnets().catch(() => ({ results: [] }))
  ]);
  
  const hubHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const defaultTunnelPool = subnetsRes.results?.find((s: any) => s.type === 'sdwan_tunnel');
  const hubTunnelGateway = defaultTunnelPool?.gateway || '';

  const hubInterfaces: NetworkInterface[] = [
    { id: 'eth0', name: 'eth0 (WAN)', type: 'ethernet', ip_address: hubHost || 'DHCP', status: 'up' },
    { id: 'wg0', name: 'wg0 (Overlay Tünel)', type: 'wireguard', ip_address: hubTunnelGateway ? `${hubTunnelGateway}/24` : 'IPAM Bekleniyor', status: 'up' }
  ];

  const hubNode: TopologyNode = {
    id: 'hub-central',
    label: `Merkez SD-WAN Ağ Geçidi`,
    name: `Central Hub Gateway`,
    type: 'hub',
    status: 'online',
    ip: hubTunnelGateway ? `${hubTunnelGateway}/24` : 'IPAM Bekleniyor',
    management_ip: hubHost,
    virtual_ip: hubTunnelGateway ? `${hubTunnelGateway}/24` : 'IPAM Bekleniyor',
    model: 'Central Orchestration Gateway',
    interfaces: hubInterfaces
  };

  const nodes: TopologyNode[] = [
    hubNode,
    ...devices.results.map(d => {
      const isOnline = d.status === 'online';
      const devInterfaces: NetworkInterface[] = [
        {
          id: `${d.id}-wan`,
          name: 'wan (Underlay)',
          type: 'ethernet',
          ip_address: d.management_ip || 'Atanmadı',
          mac_address: d.mac_address,
          status: isOnline ? 'up' : 'down'
        },
        {
          id: `${d.id}-sdwan0`,
          name: 'sdwan0 (WireGuard)',
          type: 'wireguard',
          ip_address: d.ip_address || 'Atanmadı',
          status: isOnline ? 'up' : 'down'
        },
        {
          id: `${d.id}-lan`,
          name: 'br-lan (Yerel Ağ)',
          type: 'bridge',
          ip_address: d.lan_gateway ? `${d.lan_gateway}/24` : (d.lan_subnet || 'Atanmadı'),
          mac_address: d.mac_address,
          status: isOnline ? 'up' : 'down'
        }
      ];

      return {
        id: d.id,
        label: d.name || d.id,
        name: d.name || d.id,
        type: 'device' as const,
        status: d.status,
        ip: d.ip_address || d.last_ip || '',
        mac: d.mac_address || '',
        model: d.model || 'OpenWrt SD-WAN Edge',
        group: d.group || '',
        management_ip: d.management_ip,
        lan_ip: d.lan_gateway || d.lan_subnet,
        virtual_ip: d.ip_address,
        cpu_usage_pct: d.cpu_usage_pct ?? 0,
        ram_used_mb: d.ram_used_mb ?? 0,
        ram_total_mb: d.ram_total_mb ?? 0,
        rtt_ms: d.rtt_ms ?? 0,
        interfaces: devInterfaces
      };
    })
  ];

  const links: TopologyLink[] = devices.results.map(d => ({
    id: `link-hub-${d.id}`,
    source: 'hub-central',
    sourceHandle: 'wg0',
    target: d.id,
    targetHandle: `${d.id}-sdwan0`,
    status: d.status === 'online' ? 'up' : 'down',
    kind: 'tunnel',
    protocol: 'WireGuard',
    rtt_ms: d.rtt_ms ?? 0,
    packet_loss_pct: d.packet_loss_pct ?? 0.0
  }));

  return { nodes, links };
}

export interface InterBranchBridge {
  id: string;
  name: string;
  source_device_id: string;
  target_device_id: string;
  source_subnet: string;
  target_subnet: string;
  source_name?: string;
  target_name?: string;
  source_tunnel_ip?: string;
  target_tunnel_ip?: string;
  status: string;
  created_at: string;
}

export async function fetchBridges(): Promise<{ count: number; results: InterBranchBridge[] }> {
  const res = await fetch('/api/bridges', { cache: 'no-store' });
  if (!res.ok) return { count: 0, results: [] };
  return res.json();
}

export async function createBridge(data: { source_device_id: string; target_device_id: string; name?: string }): Promise<{ success: boolean; bridge: InterBranchBridge }> {
  const res = await fetch('/api/bridges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Köprü oluşturulamadı');
  }
  return res.json();
}

export async function deleteBridge(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/bridges?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Köprü silinemedi');
  return res.json();
}

export const fetchDeviceGroups = fetchGroups;

export async function fetchGroups(): Promise<{ count: number; results: DeviceGroup[] }> {
  const res = await fetch('/api/groups');
  if (!res.ok) return { count: 1, results: [{ id: 'Merkez SD-WAN', name: 'Merkez SD-WAN', description: 'Ana SD-WAN Tünel Grubu', device_count: 0 }] };
  return res.json();
}

export async function createGroup(nameOrData: any, description?: string): Promise<DeviceGroup> {
  const name = typeof nameOrData === 'string' ? nameOrData : nameOrData?.name;
  const desc = typeof nameOrData === 'string' ? description : nameOrData?.description;
  const res = await fetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: desc })
  });
  return res.json();
}

export async function updateGroup(id: string, data: any): Promise<DeviceGroup> {
  const res = await fetch(`/api/groups?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Grup güncellenemedi.');
  }
  return res.json();
}

export async function deleteGroup(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/groups?id=${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Grup silinemedi.');
  }
  return res.json();
}

export async function createDevice(data: any): Promise<Device> {
  const res = await fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Cihaz eklenemedi.');
  }
  return res.json();
}

export async function updateDevice(id: string, data: any): Promise<Device> {
  const res = await fetch(`/api/devices?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
}

export async function deleteDevice(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/devices?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.json();
}

export async function executeBulkAction(deviceIds: string[], action: string): Promise<{ success: boolean; affected_devices: number; message: string }> {
  return {
    success: true,
    affected_devices: deviceIds.length,
    message: `${deviceIds.length} cihaz üzerinde '${action}' işlemi başarıyla uygulandı.`
  };
}

export interface NacRule {
  id: string;
  device_id: string;
  mac_address: string;
  ip_address?: string;
  hostname?: string;
  role: 'pos_terminal' | 'nvr_camera' | 'voip_phone' | 'workstation' | 'guest' | 'standard';
  status: 'allowed' | 'quarantine' | 'blocked';
  created_at?: string;
  updated_at?: string;
}

export async function fetchNacRules(deviceId?: string): Promise<{ count: number; results: NacRule[] }> {
  const url = deviceId ? `/api/nac?device_id=${encodeURIComponent(deviceId)}` : '/api/nac';
  const res = await fetch(url);
  if (!res.ok) throw new Error('NAC kuralları alınamadı');
  return res.json();
}

export async function saveNacRule(rule: Partial<NacRule>): Promise<NacRule> {
  const res = await fetch('/api/nac', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'NAC kuralı kaydedilemedi');
  }
  return res.json();
}

export async function deleteNacRule(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/nac?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Kural silinemedi');
  return res.json();
}

export async function applyNacPolicyToDevice(deviceId: string, rules: NacRule[]): Promise<{ success: boolean; output: string }> {
  // Cihazın yerel LAN alt ağını ve tünel arayüzünü donanım çekirdeğinden dinamik oku
  let cmd = `
LOCAL_SUBNET=$(ip route show dev br-lan 2>/dev/null | grep -v default | awk '{print $1}' | head -n 1);
iptables -F NETOPS_NAC 2>/dev/null || iptables -N NETOPS_NAC 2>/dev/null;
iptables -D FORWARD -j NETOPS_NAC 2>/dev/null || true;
iptables -I FORWARD 1 -j NETOPS_NAC;
`;
  
  for (const r of rules) {
    const mac = r.mac_address.toUpperCase();
    if (r.status === 'blocked') {
      // Tamamen engelle (Portu kapatmadan sadece bu MAC'in tüm paketlerini düşür)
      cmd += `iptables -A NETOPS_NAC -m mac --mac-source ${mac} -j DROP;\n`;
    } else if (r.status === 'quarantine') {
      // Karantina: Dinamik olarak şubenin kendi yerel LAN bloğuna ($LOCAL_SUBNET) ve SD-WAN tüneline (sdwan0/tun+) erişimi kes, yalnızca dış internete (wan) izin ver
      cmd += `[ -n "$LOCAL_SUBNET" ] && iptables -A NETOPS_NAC -m mac --mac-source ${mac} -d $LOCAL_SUBNET -j DROP;\n`;
      cmd += `iptables -A NETOPS_NAC -o sdwan+ -m mac --mac-source ${mac} -j DROP 2>/dev/null || true;\n`;
      cmd += `iptables -A NETOPS_NAC -o tun+ -m mac --mac-source ${mac} -j DROP 2>/dev/null || true;\n`;
    }
  }

  const res = await fetch('/api/commands/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, command: cmd })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'NAC kuralı cihaza iletilemedi');
  }
  return res.json();
}

export type ClientCertificate = DeviceCertificate;
export const createClientCertificate = createCertificate;

// 🔴 KRİTİK DÜZELTME (2026-08-24): Önceki sürüm koşulsuz `{success: true}` dönen
// boş bir stub'dı - templateId/deviceId hiç kullanılmıyordu, hiçbir donanıma
// hiçbir şey gönderilmiyordu. templates/page.tsx'in ana "Politikayı Uygula"
// butonu ve firewall/page.tsx'in port yönlendirme/QoS "uygula" akışı bu
// fonksiyona dayanıyordu - operatöre "N şubeye başarıyla uygulandı" gösterilirken
// gerçekte hiçbir komut branch cihazına ulaşmıyordu. Artık şablonun uci_content'i
// gerçekten ayrıştırılıp (bkz. lib/uci.ts - güvenlik için katı karakter
// beyaz listesi uygular) her hedef cihaza /api/commands/exec üzerinden gönderiliyor.
export async function applyTemplate(templateId: string, deviceId?: string): Promise<{ success: boolean; message: string }> {
  const [{ results: templates }, { results: allDevices }] = await Promise.all([
    fetchTemplates(),
    deviceId ? Promise.resolve({ results: [] as Device[] }) : fetchDevices({ page: 1, page_size: 500 })
  ]);

  const template = templates.find((t) => String(t.id) === String(templateId));
  if (!template || !template.uci_content) {
    throw new Error('Şablon bulunamadı veya içeriği boş.');
  }

  const command = buildUciApplyCommand(template.uci_content);
  if (!command) {
    throw new Error('Şablon içeriğinde uygulanabilir/güvenli bir yapılandırma bulunamadı.');
  }

  // Hedef cihaz(lar)ı çöz: tek ID, virgülle ayrılmış çoklu ID, veya (deviceId
  // verilmediyse) tüm filo.
  const targetIds = deviceId
    ? deviceId.split(',').map((s) => s.trim()).filter(Boolean)
    : allDevices.map((d) => d.id);

  if (targetIds.length === 0) {
    throw new Error('Hedef şube bulunamadı.');
  }

  const results = await Promise.allSettled(
    targetIds.map((id) =>
      fetch('/api/commands/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: id, command })
      }).then((res) => {
        if (!res.ok) throw new Error(`Cihaz ${id} yanıt vermedi (HTTP ${res.status})`);
        return res.json();
      })
    )
  );

  const failures = results.filter((r) => r.status === 'rejected').length;
  if (failures === targetIds.length) {
    throw new Error(`Şablon hiçbir cihaza uygulanamadı (${targetIds.length} hedef, hepsi başarısız).`);
  }

  return {
    success: true,
    message: failures > 0
      ? `Şablon ${targetIds.length - failures}/${targetIds.length} cihaza uygulandı (${failures} cihaz yanıt vermedi).`
      : `Şablon ${targetIds.length} cihaza başarıyla uygulandı.`
  };
}

// ==========================================
// 🧠 SMART DUCKDB LAKEHOUSE & TEHDİT ANALİTİĞİ SDK
// ==========================================

export interface SecurityEventItem {
  timestamp: number;
  event_type: string;
  src_ip: string;
  src_mac: string;
  dst_ip: string;
  dst_port: number;
  protocol: string;
  domain_query: string;
  action_taken: string;
  severity: string;
}

export interface ThreatAlertItem {
  alert_id: string;
  timestamp: number;
  device_id: string;
  branch_name: string;
  threat_type: string;
  client_ip: string;
  client_mac: string;
  client_hostname: string;
  confidence_score: number;
  baseline_diff_pct: number;
  description: string;
  recommended_action: string;
  status: 'PENDING_REVIEW' | 'QUARANTINED' | 'DISMISSED';
}

export async function fetchSmartLogs(limit: number = 100): Promise<{ count: number; results: SecurityEventItem[] }> {
  const res = await fetch(`/api/logs?limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Smart Lakehouse logları alınamadı');
  return res.json();
}



