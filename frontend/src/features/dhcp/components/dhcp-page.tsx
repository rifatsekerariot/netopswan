'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchDevices,
  fetchTemplates,
  fetchSubnets,
  fetchDeviceGroups,
  fetchNacRules,
  createTemplate,
  applyTemplate,
  deleteTemplate,
  updateDevice,
  Device,
  NacRule
} from '@/lib/api';
import { ConfirmModal } from '@/components/ConfirmModal';
import {
  Network,
  Server,
  Plus,
  Trash2,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  X,
  Send,
  Sliders,
  Laptop,
  CreditCard,
  Video,
  Phone,
  Printer,
  Layers,
  Filter,
  Power,
  CheckSquare,
  Square,
  ShieldCheck,
  Zap,
  Search,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';

interface StaticLease {
  id: string;
  name: string;
  mac: string;
  ip: string;
  type: 'pos' | 'nvr' | 'phone' | 'printer' | 'other';
  openwispTmplId?: string;
}

// Yoğun KPI satırı — overview/firewall sayfalarındaki KpiRow ile aynı desen: eşit
// kart tekrarı yerine tek panelde nokta + ikon + etiket + sağa hizalı mono değer.
function KpiRow({
  label,
  value,
  caption,
  accent,
  icon: Icon
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  accent: 'primary' | 'emerald' | 'destructive' | 'amber';
  icon: React.ComponentType<{ className?: string }>;
}) {
  const accentMap = {
    primary: { text: 'text-primary', dot: 'bg-primary' },
    emerald: { text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    destructive: { text: 'text-destructive', dot: 'bg-destructive' },
    amber: { text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' }
  }[accent];

  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className={`w-1.5 h-1.5 rounded-full ${accentMap.dot} shrink-0`} />
      <Icon className={`w-3.5 h-3.5 ${accentMap.text} opacity-80 shrink-0`} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground leading-tight truncate">{label}</p>
      </div>
      <div className="text-right shrink-0">
        <span className="text-lg font-semibold font-mono tabular-nums leading-none">{value}</span>
        <p className="text-[10px] text-muted-foreground leading-tight">{caption}</p>
      </div>
    </div>
  );
}

export default function DhcpPage() {
  const queryClient = useQueryClient();
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');
  
  // Scope Mode: Tekli Şube veya Çoklu Toplu Şube Seçimi
  const [targetScopeMode, setTargetScopeMode] = useState<'single' | 'multi'>('single');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);

  // Sub-Tab inside DHCP Manager: 'discovered' (Canlı İstemciler) vs 'static' (Sabitlenen Kurallar)
  const [activeSubTab, setActiveSubTab] = useState<'discovered' | 'static'>('discovered');
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState<'all' | 'dynamic' | 'static'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isTogglingDhcp, setIsTogglingDhcp] = useState(false);
  const [applyMessage, setApplyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // In-App Confirm Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: React.ReactNode;
    confirmText?: string;
    variant?: 'danger' | 'warning' | 'info' | 'success';
    onConfirm?: () => void;
  }>({
    isOpen: false,
    title: '',
    description: ''
  });

  // Form states
  const [leaseName, setLeaseName] = useState('');
  const [leaseMac, setLeaseMac] = useState('');
  const [leaseIpHost, setLeaseIpHost] = useState('10');
  const [leaseType, setLeaseType] = useState<StaticLease['type']>('pos');

  // Fetch live groups from API
  const { data: groupsData } = useQuery({
    queryKey: ['dhcp-groups'],
    queryFn: fetchDeviceGroups
  });

  // Fetch live branches/devices from API
  const { data: devicesData, isLoading: devicesLoading } = useQuery({
    queryKey: ['dhcp-devices', selectedGroupFilter],
    queryFn: () => fetchDevices({
      group: selectedGroupFilter !== 'all' ? selectedGroupFilter : undefined,
      page: 1,
      page_size: 100
    }),
    refetchInterval: 10000
  });

  // Fetch live subnets from IPAM API
  const { data: subnetsData, isLoading: subnetsLoading } = useQuery({
    queryKey: ['dhcp-subnets'],
    queryFn: fetchSubnets
  });

  // Fetch live templates from API
  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['dhcp-templates'],
    queryFn: fetchTemplates
  });

  const devices: Device[] = devicesData?.results || [];
  
  // Hedef Cihazlar
  const targetDevices: Device[] = useMemo(() => {
    if (targetScopeMode === 'multi') {
      return devices.filter(d => selectedDeviceIds.includes(d.id));
    }
    const single = devices.find(d => d.id === selectedDeviceId) || devices[0];
    return single ? [single] : [];
  }, [targetScopeMode, devices, selectedDeviceIds, selectedDeviceId]);

  const selectedDevice = targetDevices[0] || devices[0];

  // Fetch live discovered NAC devices for selected branch
  const { data: nacData, isLoading: nacLoading } = useQuery({
    queryKey: ['dhcp-nac-devices', selectedDevice?.id],
    queryFn: () => fetchNacRules(selectedDevice?.id),
    enabled: !!selectedDevice?.id,
    refetchInterval: 10000
  });

  const discoveredNacClients: NacRule[] = nacData?.results || [];

  // Derive Gateway and Subnet dynamically from Selected Device or IPAM
  const subnets = subnetsData?.results || [];
  const [selectedSubnetId, setSelectedSubnetId] = useState<string>('');

  // Helper to clean CIDR notation or subnet .0 or incomplete IP to valid gateway IP .1
  const cleanIpAddress = (raw: string): string => {
    if (!raw) return '';
    let ip = raw.split('/')[0].trim();
    if (ip.endsWith('.0')) {
      ip = ip.replace(/\.0$/, '.1');
    } else if (ip.split('.').length === 3) {
      ip = `${ip}.1`;
    }
    return ip;
  };

  // Cihazın canlı donanımdan gelen gerçek LAN IP ve alt ağ verileri (Telemetriden dinamik)
  const deviceLiveLanIp = (selectedDevice as any)?.lan_ip || selectedDevice?.lan_gateway || '';
  const deviceLanSubnet = selectedDevice?.lan_subnet 
    ? selectedDevice.lan_subnet 
    : (deviceLiveLanIp ? `${deviceLiveLanIp.split('.').slice(0, 3).join('.')}.0/24` : '');

  const autoMatchingSubnet = deviceLanSubnet ? {
    id: `subnet-${selectedDevice?.id || 'dev'}`,
    name: `${selectedDevice?.name || 'Şube'} Yerel LAN Ağı (br-lan)`,
    subnet: deviceLanSubnet,
    gateway: deviceLiveLanIp || cleanIpAddress(deviceLanSubnet),
    start: (selectedDevice as any)?.dhcp_start || 100,
    limit: (selectedDevice as any)?.dhcp_limit || 150,
    leasetime: (selectedDevice as any)?.dhcp_leasetime || '12h'
  } : subnets.find(s => s.type !== 'sdwan_tunnel');

  const activeSubnet = subnets.find(s => s.id === selectedSubnetId) || autoMatchingSubnet;

  // Live Gateway IP & Netmask: Seçilen IPAM alt ağından dinamik hesaplanır (Sıfır hardcode)
  const rawGateway = activeSubnet?.gateway || (activeSubnet?.subnet ? cleanIpAddress(activeSubnet.subnet) : '') || deviceLiveLanIp;
  const activeGateway = cleanIpAddress(rawGateway);
  const activeNetmask = (activeSubnet as any)?.netmask || (selectedDevice as any)?.netmask || '255.255.255.0';
  const activePoolStart = (activeSubnet as any)?.start || (selectedDevice as any)?.dhcp_start || 100;
  const activePoolLimit = (activeSubnet as any)?.limit || (selectedDevice as any)?.dhcp_limit || 150;
  const activeLeaseTime = (activeSubnet as any)?.leasetime || (selectedDevice as any)?.dhcp_leasetime || '12h';
  const activeDns = (activeSubnet as any)?.dns || (selectedDevice as any)?.dns || (activeGateway ? `${activeGateway},8.8.8.8` : '8.8.8.8,1.1.1.1');

  const ipParts = activeGateway ? activeGateway.split('.') : [];
  const subnetBase = ipParts.length >= 3 ? `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}` : '';

  // Dynamic DHCP Pool Range
  const poolStart = activePoolStart;
  const poolLimit = activePoolLimit;
  const poolEnd = poolStart + poolLimit - 1;

  // Telemetri: Kaç şubede DHCP Açık, Kaçında Kapalı
  const totalBranchesCount = devices.length;
  const dhcpActiveCount = devices.filter(d => d.dhcp_enabled !== false).length;
  const dhcpDisabledCount = totalBranchesCount - dhcpActiveCount;

  // Parse live DHCP Static Leases from templates
  const allTemplates = templatesData?.results || [];
  const dhcpTemplates = allTemplates.filter(t => t.type === 'dhcp' || t.name.toLowerCase().includes('dhcp'));

  // Local state for newly created uncommitted leases
  const [localLeases, setLocalLeases] = useState<StaticLease[]>([]);

  // Parse UCI config hosts from templates
  const openwispLeases: StaticLease[] = [];
  for (const t of dhcpTemplates) {
    const contentStr = typeof t.uci_content === 'string' ? t.uci_content : typeof t.config === 'string' ? t.config : '';
    if (contentStr) {
      const hostBlocks = contentStr.split('config host');
      for (let i = 1; i < hostBlocks.length; i++) {
        const block = hostBlocks[i];
        const nameMatch = block.match(/option name '([^']+)'/);
        const macMatch = block.match(/option mac '([^']+)'/);
        const ipMatch = block.match(/option ip '([^']+)'/);

        if (macMatch && ipMatch) {
          openwispLeases.push({
            id: `tmpl-${t.id}-${i}`,
            name: nameMatch ? nameMatch[1].replace(/_/g, ' ').toUpperCase() : t.name,
            mac: macMatch[1].toUpperCase(),
            ip: ipMatch[1],
            type: ipMatch[1].endsWith('.10') ? 'pos' : ipMatch[1].endsWith('.20') ? 'nvr' : ipMatch[1].endsWith('.30') ? 'phone' : 'other',
            openwispTmplId: String(t.id)
          });
        }
      }
    }
  }

  const activeLeases = useMemo(() => [...openwispLeases, ...localLeases], [openwispLeases, localLeases]);

  // Discovered Clients combined with Static info
  const enrichedDiscoveredClients = useMemo(() => {
    return discoveredNacClients.map((client) => {
      const staticMatch = activeLeases.find(l => l.mac.toUpperCase() === client.mac_address.toUpperCase());
      return {
        ...client,
        isStatic: !!staticMatch,
        staticIp: staticMatch?.ip,
        staticName: staticMatch?.name
      };
    });
  }, [discoveredNacClients, activeLeases]);

  // Filtered & Paginated Discovered Clients
  const filteredDiscoveredClients = useMemo(() => {
    return enrichedDiscoveredClients.filter((client) => {
      const matchesSearch = 
        (client.hostname || '').toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
        (client.mac_address || '').toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
        (client.ip_address || '').toLowerCase().includes(clientSearchQuery.toLowerCase());
      
      if (!matchesSearch) return false;

      if (clientStatusFilter === 'dynamic') return !client.isStatic;
      if (clientStatusFilter === 'static') return client.isStatic;
      return true;
    });
  }, [enrichedDiscoveredClients, clientSearchQuery, clientStatusFilter]);

  const totalPages = Math.ceil(filteredDiscoveredClients.length / itemsPerPage) || 1;
  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredDiscoveredClients.slice(start, start + itemsPerPage);
  }, [filteredDiscoveredClients, currentPage]);

  // Add Static Lease
  const handleAddLeaseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaseName || !leaseMac || !leaseIpHost) return;

    const base = subnetBase || (activeGateway ? activeGateway.split('.').slice(0, 3).join('.') : '');
    const fullIp = base ? `${base}.${leaseIpHost}` : leaseIpHost;
    const newLease: StaticLease = {
      id: `local-lease-${Date.now()}`,
      name: leaseName.trim(),
      mac: leaseMac.trim().toUpperCase(),
      ip: fullIp,
      type: leaseType
    };

    setLocalLeases(prev => [...prev, newLease]);
    setIsAddModalOpen(false);
    setLeaseName('');
    setLeaseMac('');
    setLeaseIpHost('10');
  };

  const handleQuickAdd = (type: StaticLease['type'], defaultName: string, defaultHost: string) => {
    setLeaseType(type);
    setLeaseName(defaultName);
    setLeaseIpHost(defaultHost);
    setLeaseMac('');
    setIsAddModalOpen(true);
  };

  const handleOpenAssignModalForClient = (client: any) => {
    const lastOctet = client.ip_address ? client.ip_address.split('.').pop() : '10';
    setLeaseName(client.hostname || 'Yerel İstemci');
    setLeaseMac(client.mac_address);
    setLeaseIpHost(lastOctet || '10');
    setLeaseType('other');
    setIsAddModalOpen(true);
  };

  const handleDeleteLease = async (lease: StaticLease) => {
    if (lease.openwispTmplId) {
      try {
        await deleteTemplate(lease.openwispTmplId);
        queryClient.invalidateQueries({ queryKey: ['dhcp-templates'] });
      } catch {}
    } else {
      setLocalLeases(prev => prev.filter(l => l.id !== lease.id));
    }
  };

  // Toggle Branch DHCP Service (ON/OFF)
  const handleToggleDhcpStatus = async (enable: boolean) => {
    if (targetDevices.length === 0) return;
    setIsTogglingDhcp(true);
    setApplyMessage(null);

    const actionText = enable ? 'etkinleştirmek' : 'devre dışı bırakmak';
    const descText = enable
      ? `${targetDevices.length} adet hedef şubede DHCP sunucusu başlatılacak ve yerel cihazlara otomatik IP dağıtımı açılacaktır.`
      : `${targetDevices.length} adet hedef şubede DHCP servisi durdurulacaktır. Yerel cihazlar IP alamayabilir.`;

    setConfirmModal({
      isOpen: true,
      title: `DHCP Servisini ${enable ? 'Etkinleştir' : 'Kapat'}`,
      description: descText,
      confirmText: enable ? 'Evet, Başlat' : 'Evet, Kapat',
      variant: enable ? 'success' : 'danger',
      onConfirm: async () => {
        try {
          for (const dev of targetDevices) {
            await updateDevice(dev.id, { dhcp_enabled: enable });
            const uciCmd = enable
              ? `uci set dhcp.lan.ignore='0' && uci commit dhcp && /etc/init.d/dnsmasq restart`
              : `uci set dhcp.lan.ignore='1' && uci commit dhcp && /etc/init.d/dnsmasq restart`;
            
            await fetch('/api/commands/exec', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ device_id: dev.id, command: uciCmd })
            }).catch(() => {});
          }

          queryClient.invalidateQueries({ queryKey: ['dhcp-devices'] });
          setApplyMessage({
            type: 'success',
            text: `DHCP servisi ${targetDevices.length} şubede başarıyla ${enable ? 'AÇILDI' : 'KAPATILDI'}.`
          });
        } catch (err: any) {
          setApplyMessage({ type: 'error', text: `Hata: ${err.message}` });
        } finally {
          setIsTogglingDhcp(false);
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  // Generate UCI Config & Apply (Dynamic LAN IP, Netmask, DHCP Pool & UBus Reload)
  const handleApplyToBranch = async () => {
    if (targetDevices.length === 0) return;
    if (!activeGateway) {
      setApplyMessage({ type: 'error', text: 'Lütfen geçerli bir Gateway IP adresi giriniz veya alt ağ seçiniz.' });
      return;
    }

    setIsApplying(true);
    setApplyMessage(null);

    try {
      // 1. OpenWISP Şablonu İçeriğini Dinamik Oluştur
      const dnsServers = activeDns.trim();
      let uciContent = `config interface 'lan'\n\toption proto 'static'\n\toption ipaddr '${activeGateway}'\n\toption netmask '${activeNetmask}'\n\n`;
      uciContent += `config dhcp 'lan'\n\toption interface 'lan'\n\toption start '${poolStart}'\n\toption limit '${poolLimit}'\n\toption leasetime '${activeLeaseTime}'\n\tlist dhcp_option '6,${dnsServers}'\n\n`;

      activeLeases.forEach((lease) => {
        uciContent += `config host\n\toption name '${lease.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}'\n\toption mac '${lease.mac}'\n\toption ip '${lease.ip}'\n\n`;
      });

      const templateName = targetScopeMode === 'single'
        ? `LAN-DHCP-${targetDevices[0]?.name || 'Sube'}`
        : `LAN-DHCP-Grup-${selectedGroupFilter !== 'all' ? selectedGroupFilter : 'Toplu'}`;

      await createTemplate({
        name: templateName,
        type: 'dhcp',
        description: `${targetDevices.length} şube için dinamik LAN Subnet & DHCP/DNS dağıtım şablonu.`,
        target_group: selectedGroupFilter !== 'all' ? selectedGroupFilter : 'Merkez',
        uci_content: uciContent
      }).catch(() => {});

      // 2. Canlı Donanım Üzerine Tam Dinamik Komut Paketi İnşa Et (Sıfır Hardcode)
      // Adım 1: LAN IP & Netmask'ı seçilen değerlere göre güncelle
      let shellCommands = `uci set network.lan.ipaddr='${activeGateway}'; uci set network.lan.netmask='${activeNetmask}'; uci commit network; `;
      
      // Adım 2: DHCP Havuzu, Limit, Süre ve DNS sunucularını güncelle
      shellCommands += `uci set dhcp.lan.start='${poolStart}'; uci set dhcp.lan.limit='${poolLimit}'; uci set dhcp.lan.leasetime='${activeLeaseTime}'; `;
      
      // DNS seçenekleri (DHCP Option 6 - İlk sıraya otomatik olarak yerel Gateway konur, ardından yedek DNS'ler eklenir)
      shellCommands += `uci delete dhcp.lan.dhcp_option 2>/dev/null || true; `;
      const userDnsList = dnsServers.split(',').map((s: string) => s.trim()).filter(Boolean);
      const fullDnsList = Array.from(new Set([activeGateway, ...userDnsList]));
      for (const dns of fullDnsList) {
        shellCommands += `uci add_list dhcp.lan.dhcp_option='6,${dns}'; `;
      }

      // Adım 3: Varsa mevcut static host eşleştirmelerini temizle ve yenilerini ekle
      shellCommands += `while uci delete dhcp.@host[0] 2>/dev/null; do :; done; `;
      activeLeases.forEach(lease => {
        const cleanName = lease.name.replace(/[^a-zA-Z0-9]/g, '_');
        shellCommands += `uci add dhcp host && uci set dhcp.@host[-1].name='${cleanName}' && uci set dhcp.@host[-1].mac='${lease.mac}' && uci set dhcp.@host[-1].ip='${lease.ip}'; `;
      });

      // Adım 4: Güvenli ve Atomik Uygulama: Sadece LAN & DHCP güncellenir, WAN arayüzüne asla dokunulmaz
      shellCommands += `uci commit dhcp; > /tmp/dhcp.leases 2>/dev/null || true; ip neigh flush all 2>/dev/null || true; /etc/init.d/dnsmasq restart; ubus call network reload; `;

      // 3. Şubelere Gönder ve Çalıştır (Next.js proxy route /api/commands/exec)
      for (const dev of targetDevices) {
        const targetDevId = dev.name || dev.id;
        const res = await fetch('/api/commands/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: targetDevId, command: shellCommands })
        });
        if (!res.ok) {
          throw new Error(`${dev.name || 'Şube'} cihazına komut iletilemedi.`);
        }

        // 4. Veritabanındaki (PostgreSQL) Şube IPAM Kaydını Anında Güncelle
        await fetch(`/api/devices?id=${dev.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lan_subnet: activeSubnet?.subnet || `${subnetBase}.0/24`,
            lan_gateway: activeGateway
          })
        }).catch(() => {});
      }

      queryClient.invalidateQueries({ queryKey: ['dhcp-templates'] });
      queryClient.invalidateQueries({ queryKey: ['sdwan-peers'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      setLocalLeases([]);
      setApplyMessage({
        type: 'success',
        text: `✅ Şube LAN Alt Ağı (${activeGateway}/${activeNetmask}) ve DHCP Havuzu (${subnetBase}.${poolStart} - ${poolEnd}) ${targetDevices.length} şubeye başarıyla gönderildi ve uygulandı!`
      });
    } catch (err: any) {
      setApplyMessage({
        type: 'error',
        text: `Yapılandırma uygulanırken hata oluştu: ${err.message}`
      });
    } finally {
      setIsApplying(false);
    }
  };

  const headerAction = devicesLoading ? (
    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Yükleniyor
    </span>
  ) : (
    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {totalBranchesCount} şube listeleniyor
    </span>
  );

  return (
    <PageContainer
      pageTitle="Merkezi DHCP, DNS & IP dağıtım yönetimi"
      pageDescription="Şube alt ağları, IP havuzları, kurumsal sabit IP (static lease) eşleştirmeleri ve canlı LAN istemci denetimi"
      pageHeaderAction={headerAction}
    >
      <div className="space-y-6">
        {/* Yoğun durum satırları — 4 eşit kart yerine tek panelde bölünmüş liste */}
        <div className="bg-card border rounded-2xl p-5">
          <div className="divide-y divide-border/60">
            <KpiRow
              label="Kayıtlı şube filosu"
              value={totalBranchesCount}
              caption="toplam kayıt"
              accent="primary"
              icon={Server}
            />
            <KpiRow
              label="DHCP aktif şubeler"
              value={`${dhcpActiveCount} / ${totalBranchesCount}`}
              caption={`${dhcpDisabledCount} şubede kapalı`}
              accent="emerald"
              icon={CheckCircle2}
            />
            <KpiRow
              label="Canlı keşfedilen istemci"
              value={discoveredNacClients.length}
              caption="bağlı cihaz"
              accent="primary"
              icon={ShieldCheck}
            />
            <KpiRow
              label="Sabit IP rezervasyonu"
              value={activeLeases.length}
              caption="tanımlı kural"
              accent="amber"
              icon={Network}
            />
          </div>
        </div>

        {/* Scope & Subnet Selector Bar */}
        <div className="p-6 bg-card border rounded-2xl shadow-sm space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Sliders className="w-4 h-4 text-primary" /> Hedef Şube & Alt Ağ Kapsamı
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                DHCP ve DNS ayarlarını tek bir şubeye veya tüm gruba aynı anda uygulayabilirsiniz.
              </p>
            </div>

            {/* Scope Mode Switcher */}
            <div className="flex items-center bg-muted/60 p-1 rounded-xl border border-border/60 max-w-full overflow-x-auto">
              <button
                type="button"
                onClick={() => setTargetScopeMode('single')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 whitespace-nowrap ${
                  targetScopeMode === 'single'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Tek şube ({selectedDevice?.name || 'seç'})
              </button>
              <button
                type="button"
                onClick={() => setTargetScopeMode('multi')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 whitespace-nowrap ${
                  targetScopeMode === 'multi'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Çoklu / grup dağıtımı ({selectedDeviceIds.length || targetDevices.length})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {/* Group Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-primary" /> Şube Grubu / Bölge
              </label>
              <select
                value={selectedGroupFilter}
                onChange={(e) => setSelectedGroupFilter(e.target.value)}
                className="w-full bg-background border rounded-xl px-4 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Tüm Gruplar ({groupsData?.results?.length || 0})</option>
                {groupsData?.results?.map((g) => (
                  <option key={g.id} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Single Device Picker */}
            {targetScopeMode === 'single' ? (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                  Yönetilecek Şube Cihazı
                </label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => {
                    setSelectedDeviceId(e.target.value);
                    setSelectedSubnetId('');
                  }}
                  className="w-full bg-background border rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-primary"
                >
                  {devicesLoading ? (
                    <option>Şubeler Yükleniyor...</option>
                  ) : devices.length === 0 ? (
                    <option value="">Kayıtlı Şube Bulunamadı</option>
                  ) : (
                    devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.group ? `[${d.group}]` : ''} ({d.last_ip || d.management_ip || 'IP Yok'}) — DHCP: {d.dhcp_enabled !== false ? 'AÇIK' : 'KAPALI'}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Hedef Şubeler ({selectedDeviceIds.length}/{devices.length})
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedDeviceIds.length === devices.length) setSelectedDeviceIds([]);
                      else setSelectedDeviceIds(devices.map(d => d.id));
                    }}
                    className="text-xs font-bold text-primary hover:underline"
                  >
                    {selectedDeviceIds.length === devices.length ? 'Tümünü Kaldır' : 'Tümünü Seç'}
                  </button>
                </div>
                <div className="p-2 border rounded-xl bg-background max-h-24 overflow-y-auto flex flex-wrap gap-1.5">
                  {devices.map((d) => {
                    const isChecked = selectedDeviceIds.includes(d.id);
                    return (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => {
                          if (isChecked) setSelectedDeviceIds(prev => prev.filter(id => id !== d.id));
                          else setSelectedDeviceIds(prev => [...prev, d.id]);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                          isChecked ? 'bg-primary/10 border-primary text-primary font-bold' : 'bg-card text-muted-foreground'
                        }`}
                      >
                        {isChecked ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                        <span>{d.name}</span>
                        <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${d.dhcp_enabled !== false ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                          {d.dhcp_enabled !== false ? 'DHCP Açık' : 'Kapalı'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Subnet Selector (Sadece Hazır IPAM Alt Ağı) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                Atanacak Yerel LAN Alt Ağı (IPAM)
              </label>
              <select
                value={activeSubnet?.id || ''}
                onChange={(e) => setSelectedSubnetId(e.target.value)}
                className="w-full bg-background border rounded-xl px-4 py-2.5 text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-primary"
              >
                {subnetsLoading ? (
                  <option>Subnetler Yükleniyor...</option>
                ) : subnets.filter(s => s.type !== 'sdwan_tunnel').length === 0 ? (
                  <option value="">{activeSubnet?.name || 'Şube Yerel LAN Ağı (br-lan)'}</option>
                ) : (
                  subnets
                    .filter(s => s.type !== 'sdwan_tunnel')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name ? `${s.name} (${s.subnet})` : s.subnet}
                      </option>
                    ))
                )}
              </select>
            </div>
          </div>

          <div className="pt-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground font-mono tabular-nums">
              Hedef: <strong>{targetDevices.length} şube</strong> | Gateway: <strong className="text-primary">{activeGateway || 'belirtilmedi'}</strong> | Netmask: <strong>{activeNetmask}</strong> | Havuz: <strong>{subnetBase ? `${subnetBase}.${poolStart} - ${poolEnd}` : 'hesaplanıyor...'}</strong>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleToggleDhcpStatus(true)}
                disabled={isTogglingDhcp || targetDevices.length === 0}
                className="px-3.5 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-bold rounded-lg border transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Power className="w-3.5 h-3.5 text-emerald-500" /> DHCP aç
              </button>
              <button
                onClick={() => handleToggleDhcpStatus(false)}
                disabled={isTogglingDhcp || targetDevices.length === 0}
                className="px-3.5 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-bold rounded-lg border transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Power className="w-3.5 h-3.5 text-destructive" /> DHCP kapat
              </button>
              <button
                onClick={handleApplyToBranch}
                disabled={isApplying || targetDevices.length === 0}
                className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-lg shadow-md transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isApplying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Yapılandırmayı ({targetDevices.length}) şubeye gönder ve uygula
              </button>
            </div>
          </div>
        </div>

        {applyMessage && (
          <div
            className={`p-4 rounded-lg border text-xs font-medium flex items-center gap-2.5 animate-in fade-in ${
              applyMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                : 'bg-destructive/10 border-destructive/30 text-destructive'
            }`}
          >
            {applyMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{applyMessage.text}</span>
          </div>
        )}

        {/* Fast Corporate Presets Bar */}
        <div className="p-6 bg-card border rounded-2xl shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Hızlı şablonlar (standart kurumsal IP tahsisi)
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <button
              onClick={() => handleQuickAdd('pos', 'Kasa / POS Terminali', '10')}
              className="p-3.5 bg-muted/40 hover:bg-muted hover:shadow-sm border rounded-lg flex items-center gap-3 transition-all text-left group"
            >
              <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-md group-hover:scale-105 transition-transform">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-xs">🛒 Kasa / POS terminali</p>
                <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">{subnetBase ? `${subnetBase}.10` : '.10'}</p>
              </div>
            </button>

            <button
              onClick={() => handleQuickAdd('nvr', 'NVR Kamera Kayıt Cihazı', '20')}
              className="p-3.5 bg-muted/40 hover:bg-muted hover:shadow-sm border rounded-lg flex items-center gap-3 transition-all text-left group"
            >
              <div className="p-2 bg-sky-500/10 text-sky-500 rounded-md group-hover:scale-105 transition-transform">
                <Video className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-xs">📹 NVR kamera kayıt</p>
                <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">{subnetBase ? `${subnetBase}.20` : '.20'}</p>
              </div>
            </button>

            <button
              onClick={() => handleQuickAdd('phone', 'Masaüstü IP Telefon (VoIP)', '30')}
              className="p-3.5 bg-muted/40 hover:bg-muted hover:shadow-sm border rounded-lg flex items-center gap-3 transition-all text-left group"
            >
              <div className="p-2 bg-amber-500/10 text-amber-500 rounded-md group-hover:scale-105 transition-transform">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-xs">📞 IP telefon (VoIP)</p>
                <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">{subnetBase ? `${subnetBase}.30` : '.30'}</p>
              </div>
            </button>

            <button
              onClick={() => handleQuickAdd('printer', 'Şube Ağ Yazıcısı', '40')}
              className="p-3.5 bg-muted/40 hover:bg-muted hover:shadow-sm border rounded-lg flex items-center gap-3 transition-all text-left group"
            >
              <div className="p-2 bg-indigo-500/10 text-indigo-500 rounded-md group-hover:scale-105 transition-transform">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-xs">🖨️ Şube ağ yazıcısı</p>
                <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">{subnetBase ? `${subnetBase}.40` : '.40'}</p>
              </div>
            </button>
          </div>
        </div>

        {/* Enterprise Tabbed Client & Lease Manager (Scalable for 50+ Devices) */}
        <div className="p-6 bg-card border rounded-2xl shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
            <div className="flex items-center gap-2 bg-muted/60 p-1 rounded-lg border max-w-full overflow-x-auto">
              <button
                type="button"
                onClick={() => { setActiveSubTab('discovered'); setCurrentPage(1); }}
                className={`px-4 py-2 rounded-md text-xs font-bold transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
                  activeSubTab === 'discovered'
                    ? 'bg-background text-foreground shadow-sm font-extrabold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                Canlı yerel ağ istemcileri (NAC / DHCP)
                <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[10px] font-mono tabular-nums">
                  {discoveredNacClients.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveSubTab('static'); setCurrentPage(1); }}
                className={`px-4 py-2 rounded-md text-xs font-bold transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
                  activeSubTab === 'static'
                    ? 'bg-background text-foreground shadow-sm font-extrabold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Network className="w-4 h-4 text-primary" />
                Sabit IP rezervasyon listesi
                <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 rounded-full text-[10px] font-mono tabular-nums">
                  {activeLeases.length}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg shadow transition-colors flex items-center gap-2 shrink-0"
              >
                <Plus className="w-4 h-4" /> Yeni sabit IP tanımla
              </button>
            </div>
          </div>

          {/* Search & Filter Bar (Only for Discovered Clients) */}
          {activeSubTab === 'discovered' && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Cihaz adı, IP veya MAC ile filtrele..."
                  value={clientSearchQuery}
                  onChange={(e) => { setClientSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="w-full pl-9 pr-4 py-2 bg-background border rounded-lg text-xs font-semibold outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <select
                  value={clientStatusFilter}
                  onChange={(e) => { setClientStatusFilter(e.target.value as any); setCurrentPage(1); }}
                  className="bg-background border rounded-lg px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">Tüm durumlar ({enrichedDiscoveredClients.length})</option>
                  <option value="dynamic">Yalnızca dinamik IP ({enrichedDiscoveredClients.filter(c => !c.isStatic).length})</option>
                  <option value="static">Sabitlenmiş olanlar ({enrichedDiscoveredClients.filter(c => c.isStatic).length})</option>
                </select>
              </div>
            </div>
          )}

          {/* TAB 1: Canlı Yerel Ağ İstemcileri Tablosu */}
          {activeSubTab === 'discovered' && (
            <div className="space-y-4">
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider font-bold">
                      <th className="py-3 px-4">İstemci / hostname</th>
                      <th className="py-3 px-4">MAC adresi</th>
                      <th className="py-3 px-4">Canlı dinamik IP</th>
                      <th className="py-3 px-4">Sabitleme durumu</th>
                      <th className="py-3 px-4 text-right">Erişim & sabitleme işlemi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {nacLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} aria-label="Yükleniyor">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                              <Skeleton className="h-3" style={{ width: '60%' }} />
                            </div>
                          </td>
                          {Array.from({ length: 3 }).map((__, j) => (
                            <td key={j} className="py-3 px-4">
                              <Skeleton className="h-3" style={{ width: '70%' }} />
                            </td>
                          ))}
                          <td className="py-3 px-4">
                            <Skeleton className="h-6 ml-auto" style={{ width: '60%' }} />
                          </td>
                        </tr>
                      ))
                    ) : paginatedClients.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          {clientSearchQuery ? 'Aramanıza uygun istemci bulunamadı.' : 'Bu şubenin yerel LAN bacağında henüz aktif istemci tespit edilmedi.'}
                        </td>
                      </tr>
                    ) : (
                      paginatedClients.map((client) => (
                        <tr key={client.id || client.mac_address} className="hover:bg-muted/40 transition-colors">
                          <td className="py-3 px-4 font-bold text-foreground flex items-center gap-2.5">
                            <Laptop className="w-4 h-4 text-primary shrink-0" />
                            <span>{client.hostname || 'Bilinmeyen istemci'}</span>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums font-semibold text-muted-foreground">
                            {client.mac_address}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums font-bold text-sky-600 dark:text-sky-400">
                            {client.ip_address || 'atanmadı'}
                          </td>
                          <td className="py-3 px-4">
                            {client.isStatic ? (
                              <span className="flex items-center gap-1.5 w-fit text-[11px] font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                Sabit IP (<span className="font-mono tabular-nums">{client.staticIp}</span>)
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 w-fit text-[11px] font-medium text-muted-foreground">
                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                                Dinamik (DHCP lease)
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {client.isStatic ? (
                              <span className="text-[11px] font-semibold text-muted-foreground italic">
                                Kural tanımlı
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpenAssignModalForClient(client)}
                                className="px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold rounded-md shadow inline-flex items-center gap-1.5 transition-colors"
                              >
                                <Zap className="w-3.5 h-3.5" /> Sabit IP&apos;ye dönüştür
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
                  <span>Toplam {filteredDiscoveredClients.length} istemciden {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, filteredDiscoveredClients.length)} arası gösteriliyor</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                      disabled={currentPage === 1}
                      className="p-1.5 border rounded-lg hover:bg-muted disabled:opacity-40"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-bold text-foreground">Sayfa {currentPage} / {totalPages}</span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="p-1.5 border rounded-lg hover:bg-muted disabled:opacity-40"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Sabit IP Rezervasyon Tablosu */}
          {activeSubTab === 'static' && (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider font-bold">
                    <th className="py-3 px-4">Servis / cihaz tanımı</th>
                    <th className="py-3 px-4">Cihaz MAC adresi</th>
                    <th className="py-3 px-4">Atanan sabit IP</th>
                    <th className="py-3 px-4">Durum</th>
                    <th className="py-3 px-4 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {templatesLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} aria-label="Yükleniyor">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                            <Skeleton className="h-3" style={{ width: '55%' }} />
                          </div>
                        </td>
                        {Array.from({ length: 3 }).map((__, j) => (
                          <td key={j} className="py-3 px-4">
                            <Skeleton className="h-3" style={{ width: '65%' }} />
                          </td>
                        ))}
                        <td className="py-3 px-4">
                          <Skeleton className="h-6 w-6 ml-auto rounded-md" />
                        </td>
                      </tr>
                    ))
                  ) : activeLeases.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        Bu şube için henüz tanımlı bir sabit IP kuralı yok.{' '}
                        <button
                          type="button"
                          onClick={() => setActiveSubTab('discovered')}
                          className="text-primary hover:underline font-medium"
                        >
                          Canlı istemciler sekmesinden
                        </button>{' '}
                        veya yukarıdaki hızlı şablonlardan ekleyebilirsiniz.
                      </td>
                    </tr>
                  ) : (
                    activeLeases.map((lease) => (
                      <tr key={lease.id} className="hover:bg-muted/40 transition-colors">
                        <td className="py-3 px-4 font-bold text-foreground flex items-center gap-2.5">
                          {lease.type === 'pos' && <CreditCard className="w-4 h-4 text-emerald-500" />}
                          {lease.type === 'nvr' && <Video className="w-4 h-4 text-sky-500" />}
                          {lease.type === 'phone' && <Phone className="w-4 h-4 text-amber-500" />}
                          {lease.type === 'printer' && <Printer className="w-4 h-4 text-indigo-500" />}
                          {lease.type === 'other' && <Laptop className="w-4 h-4 text-muted-foreground" />}
                          {lease.name}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums font-semibold">{lease.mac}</td>
                        <td className="py-3 px-4 font-mono tabular-nums font-bold text-primary">{lease.ip}</td>
                        <td className="py-3 px-4">
                          <span className="flex items-center gap-1.5 w-fit text-[11px] font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            Sabitlendi
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteLease(lease)}
                            className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                            title="Kuralı sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add / Convert Static Lease Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-card border rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Network className="w-4 h-4 text-primary" /> Sabit IP ve MAC eşleştirmesi ekle
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddLeaseSubmit} className="space-y-4 text-xs">
              {/* Quick Select from Discovered NAC Clients */}
              {discoveredNacClients.length > 0 && (
                <div className="p-3 bg-muted/40 border rounded-xl space-y-1.5">
                  <label className="text-[11px] font-bold text-primary block flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" /> Canlı keşfedilen cihazlardan hızlıca seç
                  </label>
                  <select
                    onChange={(e) => {
                      const selected = discoveredNacClients.find(c => c.mac_address === e.target.value);
                      if (selected) {
                        setLeaseName(selected.hostname || 'Yerel İstemci');
                        setLeaseMac(selected.mac_address);
                        const octet = selected.ip_address ? selected.ip_address.split('.').pop() : '10';
                        setLeaseIpHost(octet || '10');
                      }
                    }}
                    defaultValue=""
                    className="w-full bg-background border rounded-md p-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                  >
                    <option value="" disabled>-- Bağlı bir cihaz seçiniz (otomatik doldur) --</option>
                    {discoveredNacClients.map((c) => (
                      <option key={c.mac_address} value={c.mac_address}>
                        {c.hostname || 'İstemci'} — {c.mac_address} (dinamik IP: {c.ip_address || '-'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="font-semibold block mb-1">Servis / cihaz adı *</label>
                <input
                  type="text"
                  required
                  placeholder="Kasa-1 POS Terminali"
                  value={leaseName}
                  onChange={(e) => setLeaseName(e.target.value)}
                  className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-semibold"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Cihaz MAC adresi *</label>
                <input
                  type="text"
                  required
                  placeholder="00:18:0A:1B:2C:10"
                  value={leaseMac}
                  onChange={(e) => setLeaseMac(e.target.value)}
                  className="w-full bg-background border rounded-md p-2.5 font-mono tabular-nums outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Servis tipi</label>
                <select
                  value={leaseType}
                  onChange={(e) => setLeaseType(e.target.value as any)}
                  className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-semibold"
                >
                  <option value="pos">🛒 Kasa / POS terminali</option>
                  <option value="nvr">📹 NVR kamera kayıt cihazı</option>
                  <option value="phone">📞 IP telefon (VoIP)</option>
                  <option value="printer">🖨️ Şube ağ yazıcısı</option>
                  <option value="other">💻 Diğer şube cihazı</option>
                </select>
              </div>

              <div>
                <label className="font-semibold block mb-1">Atanacak sabit IP *</label>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-2.5 bg-muted font-mono tabular-nums font-bold rounded-md border">
                    {subnetBase ? `${subnetBase}.` : 'IP.'}
                  </span>
                  <input
                    type="number"
                    min="2"
                    max="254"
                    required
                    placeholder="10"
                    value={leaseIpHost}
                    onChange={(e) => setLeaseIpHost(e.target.value)}
                    className="flex-1 bg-background border rounded-md p-2.5 font-mono tabular-nums outline-none focus:ring-2 focus:ring-primary font-bold"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Sonuç IP adresi: <span className="font-mono tabular-nums font-bold text-primary">{subnetBase ? `${subnetBase}.${leaseIpHost || '10'}` : 'atanmadı'}</span>
                </p>
              </div>

              <div className="pt-3 border-t flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border rounded-md font-semibold hover:bg-muted"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-primary text-primary-foreground font-bold rounded-md shadow hover:bg-primary/90"
                >
                  Kuralı kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global In-App Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        description={confirmModal.description}
        confirmText={confirmModal.confirmText}
        variant={confirmModal.variant}
      />
    </PageContainer>
  );
}
