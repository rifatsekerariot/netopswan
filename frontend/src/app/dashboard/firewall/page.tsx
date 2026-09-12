'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { validateIPv4 } from '@/lib/validation';
import {
  fetchDevices,
  fetchDeviceGroups,
  fetchTemplates,
  createTemplate,
  deleteTemplate,
  applyTemplate,
  toggleBranchWanLock,
  applyBranchFirewallWhitelist,
  fetchNacRules,
  saveNacRule,
  deleteNacRule,
  applyNacPolicyToDevice,
  NacRule,
  Device
} from '@/lib/api';
import {
  ShieldAlert,
  ShieldCheck,
  Plus,
  Trash2,
  Send,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Network,
  Sliders,
  Radio,
  Lock,
  Unlock,
  ArrowRight,
  Globe,
  ListFilter,
  Ban,
  Layers,
  Laptop,
  Check,
  X,
  UserCheck,
  ShieldQuestion,
  Cpu
} from 'lucide-react';

interface PortForwardingItem {
  id: string;
  name: string;
  srcPort: string;
  destIp: string;
  destPort: string;
  proto: 'tcp' | 'udp' | 'tcp udp';
}

// Yoğun KPI satırı — overview sayfasındaki KpiRow ile aynı desen: eşit kart
// tekrarı yerine tek panel içinde nokta + ikon + etiket + sağa hizalı mono değer.
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

export default function FirewallPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'nac_access' | 'dnat_qos' | 'whitelist' | 'web_filter'>('nac_access');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isApplying, setIsApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // NAC State
  const [newNacMac, setNewNacMac] = useState('');
  const [newNacName, setNewNacName] = useState('');
  const [newNacRole, setNewNacRole] = useState<'pos_terminal' | 'nvr_camera' | 'voip_phone' | 'workstation' | 'guest'>('pos_terminal');
  const [isAddNacModal, setIsAddNacModal] = useState(false);
  const [isApplyingNac, setIsApplyingNac] = useState(false);

  // Whitelist State — Kullanıcı tarafından dinamik yönetilir
  const [allowedIps, setAllowedIps] = useState<string[]>([]);
  const [newAllowedIp, setNewAllowedIp] = useState('');
  const [blockRemainingWan, setBlockRemainingWan] = useState(false);

  // Domain Filter State — Kullanıcı tarafından dinamik yönetilir
  const [blockedDomains, setBlockedDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');

  // Form states for Port Forwarding
  const [isAddPortModal, setIsAddPortModal] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [srcPort, setSrcPort] = useState('');
  const [destIpHost, setDestIpHost] = useState('');
  const [destPort, setDestPort] = useState('');
  const [proto, setProto] = useState<'tcp' | 'udp' | 'tcp udp'>('tcp');

  // QoS / SQM states
  const [sqmEnabled, setSqmEnabled] = useState(false);
  const [downloadSpeed, setDownloadSpeed] = useState('');
  const [uploadSpeed, setUploadSpeed] = useState('');
  const [sqmQdisc, setSqmQdisc] = useState<'cake' | 'fq_codel'>('cake');

  // Fetch groups
  const { data: groupsData } = useQuery({
    queryKey: ['fw-groups'],
    queryFn: fetchDeviceGroups
  });

  // Fetch devices
  const { data: devicesData, isLoading: devicesLoading } = useQuery({
    queryKey: ['fw-devices'],
    queryFn: () => fetchDevices({ page: 1, page_size: 100 }),
    refetchInterval: 10000
  });

  // Fetch templates to parse existing firewall rules
  const { data: templatesData } = useQuery({
    queryKey: ['fw-templates'],
    queryFn: fetchTemplates
  });

  const allDevices: Device[] = devicesData?.results || [];

  // Filter devices by selected group
  const devices = allDevices.filter((d) => {
    if (selectedGroup === 'all') return true;
    if (selectedGroup === 'none') return !d.group;
    return d.group === selectedGroup || d.group_id === selectedGroup;
  });

  const [targetScope, setTargetScope] = useState<'single' | 'selected' | 'group'>('single');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);

  // Calculate target devices based on scope
  const targetDevices: Device[] = React.useMemo(() => {
    if (targetScope === 'group') {
      return devices; // all devices in the current group filter
    }
    if (targetScope === 'selected') {
      return devices.filter((d) => selectedDeviceIds.includes(d.id));
    }
    // Single scope
    const single = devices.find((d) => d.id === selectedDeviceId) || devices[0];
    return single ? [single] : [];
  }, [targetScope, devices, selectedDeviceIds, selectedDeviceId]);

  const selectedDevice = targetDevices[0] || devices[0];

  // Fetch NAC rules for currently selected device
  const { data: nacData, isLoading: nacLoading } = useQuery({
    queryKey: ['nac-rules', selectedDevice?.id],
    queryFn: () => fetchNacRules(selectedDevice?.id),
    enabled: !!selectedDevice?.id,
    refetchInterval: 10000
  });

  const nacRules: NacRule[] = nacData?.results || [];

  // Handle NAC status update (Allow, Quarantine, Block)
  const handleUpdateNacStatus = async (rule: NacRule, newStatus: 'allowed' | 'quarantine' | 'blocked') => {
    try {
      await saveNacRule({ ...rule, status: newStatus });
      queryClient.invalidateQueries({ queryKey: ['nac-rules', selectedDevice?.id] });
    } catch (err: any) {
      setApplyMessage({ type: 'error', text: `Durum güncellenemedi: ${err.message}` });
    }
  };

  // Handle manual new NAC rule add
  const handleAddNacRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNacMac || !selectedDevice) return;
    try {
      await saveNacRule({
        device_id: selectedDevice.id,
        mac_address: newNacMac.trim().toUpperCase(),
        hostname: newNacName.trim() || 'Yeni Cihaz',
        role: newNacRole,
        status: 'allowed'
      });
      queryClient.invalidateQueries({ queryKey: ['nac-rules', selectedDevice.id] });
      setIsAddNacModal(false);
      setNewNacMac('');
      setNewNacName('');
      setApplyMessage({ type: 'success', text: 'Cihaz erişim kuralı başarıyla kaydedildi.' });
    } catch (err: any) {
      setApplyMessage({ type: 'error', text: `Kural eklenemedi: ${err.message}` });
    }
  };

  // Handle Delete NAC rule
  const handleDeleteNacRule = async (id: string) => {
    try {
      await deleteNacRule(id);
      queryClient.invalidateQueries({ queryKey: ['nac-rules', selectedDevice?.id] });
    } catch (err: any) {
      setApplyMessage({ type: 'error', text: `Kural silinemedi: ${err.message}` });
    }
  };

  // Apply NAC policy directly to hardware via RPC
  const handleApplyNacToHardware = async () => {
    if (!selectedDevice) return;
    setIsApplyingNac(true);
    setApplyMessage(null);
    try {
      await applyNacPolicyToDevice(selectedDevice.id, nacRules);
      setApplyMessage({
        type: 'success',
        text: `Ağ erişim ve izolasyon kuralları ${selectedDevice.name} şube donanımına başarıyla uygulandı.`
      });
    } catch (err: any) {
      setApplyMessage({
        type: 'error',
        text: `Donanıma kural uygulanırken hata: ${err.message}`
      });
    } finally {
      setIsApplyingNac(false);
    }
  };

  const branchSubnetBase = selectedDevice?.lan_gateway
    ? selectedDevice.lan_gateway.split('.').slice(0, 3).join('.')
    : (selectedDevice?.last_ip ? selectedDevice.last_ip.split('.').slice(0, 3).join('.') : '');

  // Parse Firewall Port Forwards from live OpenWISP templates
  const allTemplates = templatesData?.results || [];
  const fwTemplates = allTemplates.filter(
    t => t.name.toLowerCase().includes('firewall') || t.type === 'firewall' || t.name.includes(selectedDevice?.name || '')
  );

  const [localRules, setLocalRules] = useState<PortForwardingItem[]>([]);

  // Parse from UCI
  const openwispRules: PortForwardingItem[] = [];
  for (const t of fwTemplates) {
    const content = typeof t.uci_content === 'string' ? t.uci_content : '';
    if (content) {
      const redirects = content.split('config redirect');
      for (let i = 1; i < redirects.length; i++) {
        const block = redirects[i];
        const nameM = block.match(/option name '([^']+)'/);
        const srcPortM = block.match(/option src_dport '([^']+)'/);
        const destIpM = block.match(/option dest_ip '([^']+)'/);
        const destPortM = block.match(/option dest_port '([^']+)'/);
        const protoM = block.match(/option proto '([^']+)'/);

        if (srcPortM && destIpM && destPortM) {
          openwispRules.push({
            id: `fw-rule-${t.id}-${i}`,
            name: nameM ? nameM[1] : `Kural ${i}`,
            srcPort: srcPortM[1],
            destIp: destIpM[1],
            destPort: destPortM[1],
            proto: (protoM ? protoM[1] : 'tcp') as any
          });
        }
      }
    }
  }

  const activeRules = [...openwispRules, ...localRules];

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName || !srcPort || !destPort) return;

    // GÜVENLİK: bu alanlar donanığa uygulandığında (handleApplyToBranch) bir UCI
    // komutuna ve nihayetinde branch cihazında root olarak çalışan bir shell
    // komutuna gömülür - port numaraları ve IP formatı burada, kaydedilmeden
    // önce kesin olarak doğrulanmalıdır.
    const srcPortNum = Number(srcPort);
    const destPortNum = Number(destPort);
    const isValidPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;
    if (!isValidPort(srcPortNum) || !isValidPort(destPortNum)) {
      setApplyMessage({ type: 'error', text: 'Port numaraları 1-65535 aralığında geçerli tam sayılar olmalıdır.' });
      return;
    }

    const fullDestIp = `${branchSubnetBase}.${destIpHost}`;
    if (!validateIPv4(fullDestIp)) {
      setApplyMessage({ type: 'error', text: 'Geçersiz hedef IP adresi.' });
      return;
    }

    const newRule: PortForwardingItem = {
      id: `local-fw-${Date.now()}`,
      name: ruleName,
      srcPort,
      destIp: fullDestIp,
      destPort,
      proto
    };

    setLocalRules(prev => [...prev, newRule]);
    setIsAddPortModal(false);
    setRuleName('');
    setSrcPort('');
    setDestPort('');
  };

  const handleQuickAddService = (name: string, extPort: string, intPort: string, host: string) => {
    setRuleName(name);
    setSrcPort(extPort);
    setDestPort(intPort);
    setDestIpHost(host);
    setIsAddPortModal(true);
  };

  const handleApplyToBranch = async () => {
    if (targetDevices.length === 0) return;
    setIsApplying(true);
    setApplyMessage(null);

    try {
      for (const dev of targetDevices) {
        let uciContent = `# NetOpsWan SD-WAN - Şube Güvenlik Duvarı & QoS Politikası\n`;
        uciContent += `# Otomatik üretildi: ${new Date().toISOString()}\n\n`;

        // SQM QoS Bandwidth Limiter
        if (sqmEnabled) {
          uciContent += `config queue 'eth0'\n`;
          uciContent += `\toption enabled '1'\n`;
          uciContent += `\toption interface 'wan'\n`;
          uciContent += `\toption download '${downloadSpeed}'\n`;
          uciContent += `\toption upload '${uploadSpeed}'\n`;
          uciContent += `\toption qdisc '${sqmQdisc}'\n`;
          uciContent += `\toption script 'layer_cake.qos'\n\n`;
        }

        // Port Forwarding / NAT Redirects
        for (const r of activeRules) {
          uciContent += `config redirect\n`;
          uciContent += `\toption name '${r.name.replace(/[^a-zA-Z0-9_-]/g, '_')}'\n`;
          uciContent += `\toption src 'wan'\n`;
          uciContent += `\toption src_dport '${r.srcPort}'\n`;
          uciContent += `\toption dest 'lan'\n`;
          uciContent += `\toption dest_ip '${r.destIp}'\n`;
          uciContent += `\toption dest_port '${r.destPort}'\n`;
          uciContent += `\toption proto '${r.proto}'\n`;
          uciContent += `\toption target 'DNAT'\n\n`;
        }

        const tmpl = await createTemplate({
          name: `Firewall & QoS — ${dev.name}`,
          type: 'firewall',
          description: `${dev.name} şubesi için Port Yönlendirme ve Akıllı Bant Genişliği (SQM) politikası`,
          target_group: dev.group || '',
          uci_content: uciContent
        });

        await applyTemplate(tmpl.id, dev.id);
      }

      queryClient.invalidateQueries({ queryKey: ['fw-templates'] });
      setLocalRules([]);

      setApplyMessage({
        type: 'success',
        text: `Güvenlik duvarı ve hız limitleri başarıyla ${targetDevices.length} şube cihazına uygulandı.`
      });
    } catch (err: any) {
      setApplyMessage({
        type: 'error',
        text: `Kurallar gönderilirken hata oluştu: ${err.message}`
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
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {devices.length} şube listeleniyor
    </span>
  );

  return (
    <PageContainer
      pageTitle="Güvenlik duvarı, filtreleme & QoS"
      pageDescription="Port yönlendirme (DNAT), beyaz liste filtreleme, web engelleme ve akıllı trafik önceliklendirme"
      pageHeaderAction={headerAction}
    >
      <div className="space-y-6">
        {/* Header Group & Multi-Device Target Selector */}
        <div className="p-6 bg-card border rounded-2xl space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              {/* Group Filter */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-primary" /> Şube grubu / bölge
                </label>
                <select
                  value={selectedGroup}
                  onChange={(e) => {
                    setSelectedGroup(e.target.value);
                    setSelectedDeviceId('');
                    setSelectedDeviceIds([]);
                  }}
                  className="bg-background border rounded-lg px-4 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary min-w-[200px]"
                >
                  <option value="all">Tüm gruplar ({groupsData?.results?.length || 0})</option>
                  <option value="none">Grup yok (bağımsız şubeler)</option>
                  {groupsData?.results?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Scope Switcher */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                  Hedef dağıtım kapsamı
                </label>
                <div className="flex items-center bg-muted/60 p-1 rounded-lg border text-xs font-bold max-w-full overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setTargetScope('single')}
                    className={`px-3 py-1.5 rounded-md transition-all shrink-0 whitespace-nowrap ${
                      targetScope === 'single'
                        ? 'bg-background text-foreground shadow font-bold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Tek şube
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetScope('selected')}
                    className={`px-3 py-1.5 rounded-md transition-all shrink-0 whitespace-nowrap ${
                      targetScope === 'selected'
                        ? 'bg-background text-foreground shadow font-bold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Çoklu seçim ({selectedDeviceIds.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetScope('group')}
                    className={`px-3 py-1.5 rounded-md transition-all shrink-0 whitespace-nowrap ${
                      targetScope === 'group'
                        ? 'bg-primary text-primary-foreground shadow font-bold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Tüm gruba uygula ({devices.length})
                  </button>
                </div>
              </div>

              {/* Single Device Selector (if Single mode) */}
              {targetScope === 'single' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                    Yönetilecek şube
                  </label>
                  <select
                    value={selectedDeviceId || selectedDevice?.id || ''}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    className="bg-background border rounded-lg px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-primary min-w-[260px]"
                  >
                    {devicesLoading ? (
                      <option>Şubeler yükleniyor…</option>
                    ) : devices.length === 0 ? (
                      <option value="">Bu grupta kayıtlı şube yok</option>
                    ) : (
                      devices.map(d => {
                        const isLocked = d.is_wan_locked_hw || (templatesData?.results || []).some(t => t.name === `WAN-Killswitch-${d.name}` || t.name === `WAN-Killswitch-${d.id}`);
                        return (
                          <option key={d.id} value={d.id}>
                            {d.name} {d.group ? `[${groupsData?.results?.find(g => g.id === d.group || g.name === d.group)?.name || d.group}]` : ''} ({d.last_ip || d.management_ip || 'IP yok'}) {isLocked ? '🛡️ [WAN kilitli]' : '🌐 [internet açık]'}
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleApplyToBranch}
                disabled={isApplying || targetDevices.length === 0}
                className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-lg shadow transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isApplying ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Uygulanıyor ({targetDevices.length})...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" /> Politikasını uygula ({targetDevices.length} şube)
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Multi-Select Device Chips Bar (if Selected mode) */}
          {targetScope === 'selected' && (
            <div className="p-3 bg-muted/20 border rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted-foreground">
                  Hedef şubeleri işaretleyin ({selectedDeviceIds.length} / {devices.length} seçili):
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDeviceIds(devices.map((d) => d.id))}
                    className="text-[11px] text-primary hover:underline font-bold"
                  >
                    Tümünü seç
                  </button>
                  <span className="text-muted-foreground text-[10px]">•</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDeviceIds([])}
                    className="text-[11px] text-muted-foreground hover:underline"
                  >
                    Temizle
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {devices.map((d) => {
                  const isChecked = selectedDeviceIds.includes(d.id);
                  return (
                    <label
                      key={d.id}
                      className={`cursor-pointer px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-2 transition-all ${
                        isChecked
                          ? 'bg-primary/10 border-primary text-primary font-bold shadow-sm'
                          : 'bg-card border hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDeviceIds((prev) => [...prev, d.id]);
                          } else {
                            setSelectedDeviceIds((prev) => prev.filter((id) => id !== d.id));
                          }
                        }}
                        className="rounded text-primary focus:ring-0"
                      />
                      <span>{d.name}</span>
                      <span className="text-[10px] font-mono tabular-nums opacity-70">({d.last_ip || 'IP yok'})</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
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

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b pb-3 overflow-x-auto">
          <button
            onClick={() => setActiveTab('nac_access')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 shrink-0 ${
              activeTab === 'nac_access'
                ? 'bg-primary text-primary-foreground shadow'
                : 'bg-muted/40 hover:bg-muted text-muted-foreground'
            }`}
          >
            <UserCheck className="w-4 h-4" /> Şube erişim güvenliği & cihaz filtreleme (NAC)
          </button>
          <button
            onClick={() => setActiveTab('dnat_qos')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 shrink-0 ${
              activeTab === 'dnat_qos'
                ? 'bg-primary text-primary-foreground shadow'
                : 'bg-muted/40 hover:bg-muted text-muted-foreground'
            }`}
          >
            <Sliders className="w-4 h-4" /> Port yönlendirme & hız yönetimi
          </button>
          <button
            onClick={() => setActiveTab('whitelist')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 shrink-0 ${
              activeTab === 'whitelist'
                ? 'bg-primary text-primary-foreground shadow'
                : 'bg-muted/40 hover:bg-muted text-muted-foreground'
            }`}
          >
            <ShieldCheck className="w-4 h-4" /> Beyaz liste (whitelist) modu
          </button>
          <button
            onClick={() => setActiveTab('web_filter')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 shrink-0 ${
              activeTab === 'web_filter'
                ? 'bg-primary text-primary-foreground shadow'
                : 'bg-muted/40 hover:bg-muted text-muted-foreground'
            }`}
          >
            <Globe className="w-4 h-4" /> Web & domain filtreleme (L7/DNS)
          </button>
        </div>

        {/* TAB 0: Şube Erişim Güvenliği & Cihaz Filtreleme (NAC) */}
        {activeTab === 'nac_access' && (
          <div className="space-y-6">
            {/* NAC Header Card */}
            <div className="p-6 bg-card border rounded-2xl space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-primary/10 text-primary rounded-xl border border-primary/20">
                    <UserCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Şube ağı erişim kontrolü (NAC & cihaz filtreleme)</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Şubedeki switch veya yerel ağa bağlanan cihazları MAC seviyesinde denetler; yetkisiz erişimleri ve yanal tehditleri engeller.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsAddNacModal(true)}
                    className="px-3.5 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-bold rounded-lg border transition-colors flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5 text-primary" /> Cihaz tanımla
                  </button>
                  <button
                    onClick={handleApplyNacToHardware}
                    disabled={isApplyingNac || !selectedDevice}
                    className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold rounded-lg shadow transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isApplyingNac ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Politikayı donanıma uygula
                  </button>
                </div>
              </div>

              {/* Yoğun durum satırları — 3 eşit kart yerine tek panelde bölünmüş liste */}
              <div className="divide-y divide-border/60 pt-1">
                <KpiRow
                  label="Tanımlı cihaz sayısı"
                  value={nacRules.length}
                  caption="toplam kayıt"
                  accent="primary"
                  icon={Laptop}
                />
                <KpiRow
                  label="İzin verilen (onaylı)"
                  value={nacRules.filter(r => r.status === 'allowed').length}
                  caption="tam erişim"
                  accent="emerald"
                  icon={CheckCircle2}
                />
                <KpiRow
                  label="Karantina / izolasyon"
                  value={nacRules.filter(r => r.status === 'quarantine' || r.status === 'blocked').length}
                  caption="kısıtlı erişim"
                  accent="amber"
                  icon={ShieldAlert}
                />
              </div>
            </div>

            {/* Devices Table */}
            <div className="bg-card border rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">
                  {selectedDevice?.name || 'Şube'} — bağlı ve tanımlı cihaz listesi
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  * switch arkasındaki cihazlar bağımsız MAC düzeyinde filtrelenir.
                </span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider font-bold">
                      <th className="py-3 px-4">Cihaz / host adı</th>
                      <th className="py-3 px-4">MAC adresi</th>
                      <th className="py-3 px-4">Atanan rol</th>
                      <th className="py-3 px-4">Erişim durumu</th>
                      <th className="py-3 px-4 text-right">Erişim politikası / işlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {nacLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i} aria-label="Yükleniyor">
                          {Array.from({ length: 5 }).map((__, j) => (
                            <td key={j} className="py-3 px-4">
                              <Skeleton className="h-3" style={{ width: j === 0 ? '70%' : '50%' }} />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : nacRules.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-muted-foreground space-y-2">
                          <p>Bu şube için henüz özel erişim kuralı tanımlanmamış.</p>
                          <button
                            onClick={() => setIsAddNacModal(true)}
                            className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-md"
                          >
                            + İlk cihazı ekle
                          </button>
                        </td>
                      </tr>
                    ) : (
                      nacRules.map((rule) => (
                        <tr key={rule.id} className="hover:bg-muted/40 transition-colors">
                          <td className="py-3 px-4 font-bold flex items-center gap-2">
                            <Laptop className="w-4 h-4 text-primary" />
                            {rule.hostname || 'Tanımsız cihaz'}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold">{rule.mac_address}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 bg-muted rounded border text-[11px] font-semibold">
                              {rule.role === 'pos_terminal'
                                ? '🛒 POS / kasa'
                                : rule.role === 'nvr_camera'
                                ? '📹 NVR kamera'
                                : rule.role === 'voip_phone'
                                ? '📞 IP telefon'
                                : rule.role === 'workstation'
                                ? '💻 Personel bilgisayarı'
                                : rule.role === 'guest'
                                ? '🌐 Misafir ağı'
                                : 'Standart cihaz'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {rule.status === 'allowed' ? (
                              <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full font-bold text-[11px] flex items-center gap-1 w-fit">
                                <CheckCircle2 className="w-3 h-3" /> İzin verildi (tam erişim)
                              </span>
                            ) : rule.status === 'quarantine' ? (
                              <span className="px-2.5 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full font-bold text-[11px] flex items-center gap-1 w-fit">
                                <ShieldAlert className="w-3 h-3" /> Karantinada (yerel & merkez izolasyon)
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 bg-destructive/10 text-destructive border border-destructive/20 rounded-full font-bold text-[11px] flex items-center gap-1 w-fit">
                                <Ban className="w-3 h-3" /> Tamamen engellendi
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right space-x-1.5">
                            {rule.status !== 'allowed' && (
                              <button
                                onClick={() => handleUpdateNacStatus(rule, 'allowed')}
                                className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 rounded font-bold text-[11px] transition-colors"
                              >
                                İzin ver
                              </button>
                            )}
                            {rule.status !== 'quarantine' && (
                              <button
                                onClick={() => handleUpdateNacStatus(rule, 'quarantine')}
                                className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded font-bold text-[11px] transition-colors"
                              >
                                Karantinaya al
                              </button>
                            )}
                            {rule.status !== 'blocked' && (
                              <button
                                onClick={() => handleUpdateNacStatus(rule, 'blocked')}
                                className="px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 rounded font-bold text-[11px] transition-colors"
                              >
                                Engelle
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteNacRule(rule.id)}
                              className="p-1 border rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors ml-1"
                              title="Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: DNAT & QoS */}
        {activeTab === 'dnat_qos' && (
          <div className="space-y-6">
            {/* Bandwidth Limiter Card */}
            <div className="p-6 bg-card border rounded-2xl space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-indigo-500/10 text-indigo-500 rounded-lg">
                    <Sliders className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Akıllı hat hızı & trafik önceliklendirme</h3>
                    <p className="text-xs text-muted-foreground">Kritik iş uygulamalarına (POS, santral, ERP) kesintisiz öncelik tanır, hat dalgalanmalarını engeller.</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sqmEnabled}
                    onChange={(e) => setSqmEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              {sqmEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                      İndirme limiti (download)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={downloadSpeed}
                        onChange={(e) => setDownloadSpeed(e.target.value)}
                        className="bg-background border rounded-lg px-3 py-2 text-sm font-mono tabular-nums font-bold w-full"
                      />
                      <span className="text-xs text-muted-foreground font-bold">Kbps</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                      Yükleme limiti (upload)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={uploadSpeed}
                        onChange={(e) => setUploadSpeed(e.target.value)}
                        className="bg-background border rounded-lg px-3 py-2 text-sm font-mono tabular-nums font-bold w-full"
                      />
                      <span className="text-xs text-muted-foreground font-bold">Kbps</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                      Trafik dengeleme modu
                    </label>
                    <select
                      value={sqmQdisc}
                      onChange={(e) => setSqmQdisc(e.target.value as any)}
                      className="bg-background border rounded-lg px-3 py-2 text-sm font-bold w-full outline-none"
                    >
                      <option value="cake">Dinamik akıllı dengeleme (önerilen)</option>
                      <option value="fq_codel">Düşük gecikme öncelikli</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Service Port Presets */}
            <div className="p-6 bg-card border rounded-2xl space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Hızlı şablonlar (standart servis port yönlendirme)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <button
                  onClick={() => handleQuickAddService('Kamera NVR RTSP Akışı', '554', '554', '20')}
                  className="p-3.5 bg-muted/40 hover:bg-muted border rounded-lg flex items-center gap-3 transition-colors text-left"
                >
                  <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-xs">📹 NVR kamera (RTSP 554)</p>
                    <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">.{branchSubnetBase}.20:554</p>
                  </div>
                </button>

                <button
                  onClick={() => handleQuickAddService('Kasa / POS Terminal API', '8443', '8443', '10')}
                  className="p-3.5 bg-muted/40 hover:bg-muted border rounded-lg flex items-center gap-3 transition-colors text-left"
                >
                  <div className="p-2 bg-sky-500/10 text-sky-500 rounded-lg">
                    <Network className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-xs">🛒 Kasa API (port 8443)</p>
                    <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">.{branchSubnetBase}.10:8443</p>
                  </div>
                </button>

                <button
                  onClick={() => handleQuickAddService('IP Telefon SIP Santral', '5060', '5060', '30')}
                  className="p-3.5 bg-muted/40 hover:bg-muted border rounded-lg flex items-center gap-3 transition-colors text-left"
                >
                  <div className="p-2 bg-indigo-500/10 text-indigo-500 rounded-lg">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-xs">☎️ SIP santral (port 5060)</p>
                    <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">.{branchSubnetBase}.30:5060</p>
                  </div>
                </button>

                <button
                  onClick={() => handleQuickAddService('Yerel Sunucu SSH / RDP', '2222', '22', '40')}
                  className="p-3.5 bg-muted/40 hover:bg-muted border rounded-lg flex items-center gap-3 transition-colors text-left"
                >
                  <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-xs">💻 Uzak masaüstü / SSH</p>
                    <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">.{branchSubnetBase}.40:22</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Active Port Forwarding Table */}
            <div className="bg-card border rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-primary" />
                    Aktif port yönlendirme (DNAT) kuralları
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedDevice?.name || 'Şube'} cihazının WAN portundan iç ağa (LAN) yönlendirilen portlar
                  </p>
                </div>
                <button
                  onClick={() => setIsAddPortModal(true)}
                  className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-lg shadow flex items-center gap-1.5 hover:bg-primary/90"
                >
                  <Plus className="w-4 h-4" /> Yeni port kuralı ekle
                </button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 text-muted-foreground font-bold uppercase tracking-wider text-[10px] border-b">
                    <tr>
                      <th className="px-4 py-3">Kural adı</th>
                      <th className="px-4 py-3">Protokol</th>
                      <th className="px-4 py-3">Dış port (WAN)</th>
                      <th className="px-4 py-3">İç hedef IP (LAN)</th>
                      <th className="px-4 py-3">İç hedef port</th>
                      <th className="px-4 py-3 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {activeRules.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                          Tanımlı aktif port yönlendirme kuralı bulunmuyor. Yukarıdan bir hızlı şablon seçin ya da{' '}
                          <button onClick={() => setIsAddPortModal(true)} className="text-primary hover:underline font-medium">
                            yeni kural ekleyin
                          </button>
                          .
                        </td>
                      </tr>
                    ) : (
                      activeRules.map((r) => (
                        <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-3.5 font-bold">{r.name}</td>
                          <td className="px-4 py-3.5">
                            <span className="px-2 py-0.5 bg-primary/10 text-primary rounded font-mono uppercase font-bold text-[10px]">
                              {r.proto}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 font-mono tabular-nums font-bold">{r.srcPort}</td>
                          <td className="px-4 py-3.5 font-mono tabular-nums font-bold text-primary">{r.destIp}</td>
                          <td className="px-4 py-3.5 font-mono tabular-nums font-bold">{r.destPort}</td>
                          <td className="px-4 py-3.5 text-right">
                            <button
                              onClick={() => setLocalRules(prev => prev.filter(item => item.id !== r.id))}
                              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
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
            </div>
          </div>
        )}

        {/* TAB 2: WHITELIST (BEYAZ LİSTE) MODU */}
        {activeTab === 'whitelist' && (
          <div className="space-y-6">
            <div className="p-6 bg-card border rounded-2xl space-y-4">
              <div className="flex items-start justify-between border-b pb-4">
                <div className="space-y-1">
                  <h3 className="font-bold text-sm flex items-center gap-2 text-emerald-500">
                    <ShieldCheck className="w-5 h-5" /> Şube beyaz liste (whitelist) güvenlik duvarı
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Şube personelinin sadece izin verilen IP/bloklara erişmesini sağlar, kontrolsüz tüm dış interneti (YouTube, sosyal medya vb.) otomatik olarak keser.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">Geri kalan interneti engelle (DROP):</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={blockRemainingWan}
                      onChange={(e) => setBlockRemainingWan(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-destructive"></div>
                  </label>
                </div>
              </div>

              {/* Add New Whitelist IP */}
              <div className="p-4 bg-muted/30 border rounded-lg flex flex-col sm:flex-row gap-3 items-center">
                <input
                  type="text"
                  placeholder="İzin verilecek IP veya blok (örn. 193.140.80.0/24 veya 200.97.171.59)"
                  value={newAllowedIp}
                  onChange={(e) => setNewAllowedIp(e.target.value)}
                  className="w-full bg-background border rounded-lg px-4 py-2.5 text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newAllowedIp && !allowedIps.includes(newAllowedIp)) {
                      setAllowedIps((prev) => [...prev, newAllowedIp]);
                      setNewAllowedIp('');
                    }
                  }}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow transition-colors shrink-0 flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> İzin verilen adresi ekle
                </button>
              </div>

              {/* Whitelist IP Table */}
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 text-muted-foreground font-bold uppercase tracking-wider text-[10px] border-b">
                    <tr>
                      <th className="px-4 py-3">Sıra</th>
                      <th className="px-4 py-3">İzin verilen hedef IP / CIDR</th>
                      <th className="px-4 py-3">Eylem</th>
                      <th className="px-4 py-3 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {allowedIps.length === 0 && !blockRemainingWan ? null : null}
                    {allowedIps.map((ip, idx) => (
                      <tr key={ip} className="hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-mono tabular-nums font-bold text-muted-foreground">#{idx + 1}</td>
                        <td className="px-4 py-3 font-mono font-bold text-emerald-500">{ip}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded font-bold text-[10px]">
                            ACCEPT (izinli)
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setAllowedIps((prev) => prev.filter((item) => item !== ip))}
                            className="p-1.5 text-muted-foreground hover:text-destructive rounded-md transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {allowedIps.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                          Henüz izin verilen bir adres eklenmedi. Yukarıdaki alandan bir IP veya CIDR bloğu ekleyin.
                        </td>
                      </tr>
                    )}
                    {blockRemainingWan ? (
                      <tr className="bg-destructive/5 font-semibold text-destructive">
                        <td className="px-4 py-3 font-mono tabular-nums font-bold">#{allowedIps.length + 1}</td>
                        <td className="px-4 py-3 font-mono">0.0.0.0/0 (kalan tüm dış internet)</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-destructive/15 text-destructive border border-destructive/30 rounded font-bold text-[10px]">
                            DROP (engelli)
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-[11px] text-muted-foreground italic">İzolasyon aktif (sadece izinliler çıkar)</td>
                      </tr>
                    ) : (
                      <tr className="bg-emerald-500/5 font-semibold text-emerald-600">
                        <td className="px-4 py-3 font-mono tabular-nums font-bold">#{allowedIps.length + 1}</td>
                        <td className="px-4 py-3 font-mono">0.0.0.0/0 (kalan tüm dış internet)</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded font-bold text-[10px]">
                            ACCEPT (serbest)
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-[11px] text-muted-foreground italic">İnternet açık (filtresiz geçiş)</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pt-3 border-t flex justify-end">
                <button
                  type="button"
                  disabled={isApplying || targetDevices.length === 0}
                  onClick={async () => {
                    if (targetDevices.length === 0) return;
                    setIsApplying(true);
                    setApplyMessage(null);
                    try {
                      for (const dev of targetDevices) {
                        await applyBranchFirewallWhitelist({
                          deviceId: dev.id,
                          deviceName: dev.name,
                          allowedIps,
                          blockRemainingWan
                        });
                      }
                      setApplyMessage({
                        type: 'success',
                        text: `Beyaz liste güvenlik politikası ${targetDevices.length} şube cihazına başarıyla uygulandı.`
                      });
                    } catch (err: any) {
                      setApplyMessage({
                        type: 'error',
                        text: `Beyaz liste politikası iletilemedi: ${err.message}`
                      });
                    } finally {
                      setIsApplying(false);
                      queryClient.invalidateQueries({ queryKey: ['fw-templates'] });
                    }
                  }}
                  className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-lg shadow transition-colors flex items-center gap-2"
                >
                  <Send className="w-4 h-4" /> Beyaz liste politikasını uygula ({targetDevices.length} şube)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: WEB & DOMAIN FILTERING (L7 / DNS) */}
        {activeTab === 'web_filter' && (
          <div className="space-y-6">
            <div className="p-6 bg-card border rounded-2xl space-y-4">
              <div className="space-y-1 border-b pb-4">
                <h3 className="font-bold text-sm flex items-center gap-2 text-primary">
                  <Globe className="w-5 h-5" /> Web sitesi & domain filtreleme (Dnsmasq / L7)
                </h3>
                <p className="text-xs text-muted-foreground">
                  IP adresi girmeye gerek kalmadan doğrudan alan adı (domain) bazlı engelleme. Şubedeki cihazlar bu domainleri çözümleyemez.
                </p>
              </div>

              {/* Add New Blocked Domain */}
              <div className="p-4 bg-muted/30 border rounded-lg flex flex-col sm:flex-row gap-3 items-center">
                <input
                  type="text"
                  placeholder="Engellenecek web sitesi (örn. tiktok.com, kumar.com, oyun.com)"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  className="w-full bg-background border rounded-lg px-4 py-2.5 text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newDomain && !blockedDomains.includes(newDomain)) {
                      setBlockedDomains((prev) => [...prev, newDomain]);
                      setNewDomain('');
                    }
                  }}
                  className="px-4 py-2.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold text-xs rounded-lg shadow transition-colors shrink-0 flex items-center gap-1.5"
                >
                  <Ban className="w-4 h-4" /> Yasaklı domain ekle
                </button>
              </div>

              {/* Blocked Domains Grid */}
              {blockedDomains.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground rounded-lg border border-dashed">
                  Henüz engellenen bir domain yok. Yukarıdaki alandan bir alan adı ekleyin.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {blockedDomains.map((dom) => (
                    <div key={dom} className="p-3 bg-muted/40 border border-destructive/20 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Ban className="w-4 h-4 text-destructive shrink-0" />
                        <span className="font-mono text-xs font-bold text-foreground">{dom}</span>
                      </div>
                      <button
                        onClick={() => setBlockedDomains((prev) => prev.filter((d) => d !== dom))}
                        className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
                        title="Kaldır"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-3 border-t flex justify-end">
                <button
                  type="button"
                  disabled={isApplying || targetDevices.length === 0}
                  onClick={async () => {
                    if (targetDevices.length === 0) return;
                    setIsApplying(true);
                    setApplyMessage(null);
                    try {
                      for (const dev of targetDevices) {
                        let uciContent = `# SD-WAN Domain Blacklist\n# Şube: ${dev.name}\n\n`;
                        blockedDomains.forEach((d) => {
                          uciContent += `config address\n\toption name '${d}'\n\toption ip '0.0.0.0'\n\n`;
                        });
                        await createTemplate({
                          name: `Domain-Block-${dev.name}`,
                          type: 'dhcp',
                          description: `${dev.name} için web & domain filtreleme kuralı.`,
                          uci_content: uciContent,
                          target_group: dev.group || ''
                        });
                      }
                      setApplyMessage({
                        type: 'success',
                        text: `Web & domain filtreleme kuralları ${targetDevices.length} şube cihazına başarıyla uygulandı.`
                      });
                    } catch (err: any) {
                      setApplyMessage({
                        type: 'error',
                        text: `Filtreleme kuralı iletilemedi: ${err.message}`
                      });
                    } finally {
                      setIsApplying(false);
                      queryClient.invalidateQueries({ queryKey: ['fw-templates'] });
                    }
                  }}
                  className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-lg shadow transition-colors flex items-center gap-2"
                >
                  <Send className="w-4 h-4" /> Domain engellerini uygula ({targetDevices.length} şube)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Port Forward Modal */}
      {isAddPortModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm flex items-center gap-2 border-b pb-3">
              <Plus className="w-4 h-4 text-primary" /> Yeni port yönlendirme (DNAT) kuralı
            </h3>
            <form onSubmit={handleAddRule} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold block mb-1">Kural tanımı *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: NVR-Canli-Kamera"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="w-full bg-background border rounded-md p-2 font-semibold outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Dış port (WAN) *</label>
                  <input
                    type="text"
                    required
                    placeholder="Örn: 8080"
                    value={srcPort}
                    onChange={(e) => setSrcPort(e.target.value)}
                    className="w-full bg-background border rounded-md p-2 font-mono outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Protokol</label>
                  <select
                    value={proto}
                    onChange={(e) => setProto(e.target.value as any)}
                    className="w-full bg-background border rounded-md p-2 font-semibold outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="tcp udp">TCP + UDP</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">İç IP sonu *</label>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground font-mono text-[11px]">{branchSubnetBase}.</span>
                    <input
                      type="number"
                      required
                      value={destIpHost}
                      onChange={(e) => setDestIpHost(e.target.value)}
                      className="w-full bg-background border rounded-md p-2 font-mono outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                <div>
                  <label className="font-semibold block mb-1">İç hedef port *</label>
                  <input
                    type="text"
                    required
                    placeholder="Örn: 80"
                    value={destPort}
                    onChange={(e) => setDestPort(e.target.value)}
                    className="w-full bg-background border rounded-md p-2 font-mono outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="pt-3 border-t flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddPortModal(false)}
                  className="px-4 py-2 border rounded-md font-semibold hover:bg-muted transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-md shadow hover:bg-primary/90"
                >
                  Kuralı ekle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add NAC Rule Modal */}
      {isAddNacModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-primary" /> Yeni şube cihazı & erişim kuralı tanımla
              </h3>
              <button onClick={() => setIsAddNacModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddNacRule} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold block mb-1">Cihaz / servis tanımı *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: 🛒 Kasa-01, 📹 Kamera-Giriş, 💻 Personel-01"
                  value={newNacName}
                  onChange={(e) => setNewNacName(e.target.value)}
                  className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-semibold"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Cihaz fiziksel MAC adresi *</label>
                <input
                  type="text"
                  required
                  placeholder="AA:BB:CC:DD:EE:FF"
                  value={newNacMac}
                  onChange={(e) => setNewNacMac(e.target.value.toUpperCase())}
                  className="w-full bg-background border rounded-md p-2.5 font-mono font-bold outline-none focus:ring-2 focus:ring-primary uppercase"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Şube anahtarı (switch) arkasındaki cihaz bu MAC adresi üzerinden bağımsız olarak filtrelenir.
                </p>
              </div>

              <div>
                <label className="font-semibold block mb-1">Cihaz rolü</label>
                <select
                  value={newNacRole}
                  onChange={(e) => setNewNacRole(e.target.value as any)}
                  className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-semibold"
                >
                  <option value="pos_terminal">🛒 POS / kasa terminali</option>
                  <option value="nvr_camera">📹 NVR kamera sistemi</option>
                  <option value="voip_phone">📞 IP santral / telefon</option>
                  <option value="workstation">💻 Personel bilgisayarı</option>
                  <option value="guest">🌐 Misafir cihazı (izole internet)</option>
                  <option value="standard">Standart ağ cihazı</option>
                </select>
              </div>

              <div className="pt-3 border-t flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddNacModal(false)}
                  className="px-4 py-2 border rounded-md font-semibold hover:bg-muted transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-md shadow hover:bg-primary/90"
                >
                  Cihazı kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
