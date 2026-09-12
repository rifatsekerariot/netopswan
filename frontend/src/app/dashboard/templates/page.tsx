'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchTemplates,
  fetchGroups,
  fetchSubnets,
  applyTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  UCITemplate,
  fetchDevices,
  Device,
  IPAMSubnet
} from '@/lib/api';
import PageContainer from '@/components/layout/page-container';
import { ConfirmModal } from '@/components/ConfirmModal';
import {
  ShieldCheck,
  Layers,
  Plus,
  Send,
  CheckCircle,
  X,
  RefreshCw,
  Zap,
  Info,
  Radio,
  Wifi,
  Sliders,
  AlertTriangle,
  Building2,
  CheckSquare,
  Square,
  Search,
  Edit3,
  Trash2,
  Copy,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  Save,
  PlayCircle
} from 'lucide-react';

interface PresetPolicy {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: any;
  defaultUci: string;
}

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  
  // State: View Modes ('list' vs 'create' vs 'edit')
  const [viewMode, setViewMode] = useState<'list' | 'create'>('list');
  const [selectedTemplate, setSelectedTemplate] = useState<UCITemplate | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<UCITemplate | null>(null);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  // Search & Filter State (Scalable for 500+ templates)
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // New Policy Form State
  const [name, setName] = useState('');
  const [type, setType] = useState('network');
  const [targetGroup, setTargetGroup] = useState('Tüm Şubeler');
  const [description, setDescription] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('preset-wg');
  const [showAdvancedCode, setShowAdvancedCode] = useState(false);
  const [customUciContent, setCustomUciContent] = useState('');

  // Targeted Branch Deployment State
  const [confirmTemplate, setConfirmTemplate] = useState<UCITemplate | null>(null);
  const [targetScopeMode, setTargetScopeMode] = useState<'all' | 'custom'>('all');
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);

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

  // Queries
  const { data: templatesData, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: fetchTemplates
  });

  const { data: subnetsData } = useQuery({
    queryKey: ['template-subnets'],
    queryFn: fetchSubnets
  });

  const { data: groupsData } = useQuery({
    queryKey: ['template-groups'],
    queryFn: fetchGroups
  });

  const { data: devicesData } = useQuery({
    queryKey: ['deploy-devices'],
    queryFn: () => fetchDevices({ page: 1, page_size: 100 })
  });

  const allTemplates: UCITemplate[] = templatesData?.results || [];
  const devices: Device[] = devicesData?.results || [];
  const subnets: IPAMSubnet[] = subnetsData?.results || [];

  // Dinamik Ağ Verileri (IPAM & Canlı Donanım Telemetrisi)
  const defaultTunnelPool = subnets.find(s => s.type === 'sdwan_tunnel');
  const tunnelAllowedIps = defaultTunnelPool?.subnet || '';

  const activeDevice = devices.find(d => d.status === 'online') || devices[0];
  const defaultBranchLan = activeDevice?.lan_subnet || '';
  const defaultBranchGw = activeDevice?.lan_gateway || (defaultBranchLan ? `${defaultBranchLan.split('.').slice(0, 3).join('.')}.1` : '');

  // Hazır Şablon Havuzu (Preset Library - IPAM ve Canlı Cihazlardan Dinamik Beslenir)
  const presetPolicies: PresetPolicy[] = [
    {
      id: 'preset-wg',
      name: 'SD-WAN Mesh / Hub VPN Tüneli',
      category: 'SD-WAN & Tünel',
      description: 'Merkezi WireGuard Hub üzerinden şubeler arası tam mesh ve güvenli kurumsal VPN tüneli oluşturur.',
      icon: ShieldCheck,
      defaultUci: `config wireguard 'sdwan0'\n\toption name 'sdwan_tunnel'\n\toption listen_port '51820'\n\tlist allowed_ips '${tunnelAllowedIps}'\n\toption persistent_keepalive '25'\n\toption route_allowed_ips '1'`
    },
    {
      id: 'preset-lan',
      name: 'Yerel LAN & DHCP Havuzu',
      category: 'Ağ & IP Dağıtımı',
      description: 'Şube için yerel alt ağ geçidi, IP aralığı ve DHCP otomatik IP dağıtım politikasını belirler.',
      icon: Layers,
      defaultUci: `config interface 'lan'\n\toption proto 'static'\n\toption ipaddr '${defaultBranchGw}'\n\toption netmask '255.255.255.0'\n\nconfig dhcp 'lan'\n\toption interface 'lan'\n\toption start '100'\n\toption limit '150'\n\toption leasetime '12h'`
    },
    {
      id: 'preset-qos',
      name: 'POS & VoIP Öncelikli QoS Hız Limiti',
      category: 'Trafik & Hız Yönetimi',
      description: 'Kasa/POS ve IP telefon trafiğine her koşulda mutlak öncelik tanır; şube interneti dolsa bile kesinti yaşanmaz.',
      icon: Zap,
      defaultUci: `config qos 'interface_wan'\n\toption upload '50000'\n\toption download '100000'\n\toption enabled '1'\n\nconfig classify 'pos_priority'\n\toption target 'Express'\n\toption ports '443,8443,10000-20000'\n\toption comment 'POS & VoIP Absolute Priority'`
    },
    {
      id: 'preset-dns-shield',
      name: 'Kurumsal DNS Kalkanı & Reklam Filtresi',
      category: 'Güvenlik & Filtreleme',
      description: 'Şube kullanıcılarını zararlı web sitelerinden, oltalama (phishing) tuzaklarından ve izleyicilerden korur.',
      icon: ShieldCheck,
      defaultUci: `config dnsmasq\n\tlist server '1.1.1.2'\n\tlist server '1.0.0.2'\n\toption rebind_protection '1'\n\toption boguspriv '1'\n\toption filterwin2k '1'`
    },
    {
      id: 'preset-routes',
      name: 'Merkez VLAN & Sunucu Statik Rotaları',
      category: 'Yönlendirme (Routing)',
      description: 'Merkez veri merkezindeki ERP, muhasebe veya kamera NVR sunucu alt ağlarına tünel üzerinden güvenli rota açar.',
      icon: Radio,
      defaultUci: `config route 'hq_vlan_erp'\n\toption interface 'tun0'\n\toption target '10.0.0.0'\n\toption netmask '255.255.0.0'`
    }
  ];

  // Filtered & Paginated Templates (500+ Scalable)
  const filteredTemplates = useMemo(() => {
    return allTemplates.filter((t) => {
      const matchesSearch = 
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.target_group || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.uci_content || '').toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (categoryFilter !== 'all' && t.type !== categoryFilter) return false;
      if (groupFilter !== 'all' && t.target_group !== groupFilter) return false;

      return true;
    });
  }, [allTemplates, searchQuery, categoryFilter, groupFilter]);

  const totalPages = Math.ceil(filteredTemplates.length / itemsPerPage) || 1;
  const paginatedTemplates = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredTemplates.slice(start, start + itemsPerPage);
  }, [filteredTemplates, currentPage]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setViewMode('list');
      setApplyResult('Yeni politika başarıyla oluşturuldu ve şablon havuzuna eklendi.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: updateTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setEditingTemplate(null);
      setApplyResult('Politika başarıyla güncellendi.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setSelectedTemplate(null);
      setEditingTemplate(null);
      setApplyResult('Politika havuzdan kaldırıldı.');
    }
  });

  const applyMutation = useMutation({
    mutationFn: ({ templateId, deviceId }: { templateId: string; deviceId?: string }) =>
      applyTemplate(templateId, deviceId),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      const targetCount = targetScopeMode === 'all' ? devices.length : selectedBranchIds.length;
      setApplyResult(`Politika ${targetCount} şube donanımına başarıyla gönderildi ve aktif edildi.`);
      setConfirmTemplate(null);
    }
  });

  // Handle Create Submit
  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const preset = presetPolicies.find((p) => p.id === selectedPresetId) || presetPolicies[0];
    const uci = showAdvancedCode && customUciContent ? customUciContent : preset.defaultUci;

    createMutation.mutate({
      name: name || preset.name,
      type,
      description: description || preset.description,
      target_group: targetGroup || 'Tüm Şubeler',
      uci_content: uci
    });
  };

  // Handle Edit Submit
  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;

    updateMutation.mutate({
      id: editingTemplate.id,
      name: editingTemplate.name,
      type: editingTemplate.type,
      target_group: editingTemplate.target_group,
      description: editingTemplate.description,
      uci_content: editingTemplate.uci_content
    });
  };

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Ağ Politikaları & Şablon Orkestrasyonu</h1>
            <p className="text-xs text-muted-foreground mt-1">
              500+ şubeye tek tıkla dağıtılacak ağ, güvenlik duvarı, yerel IP/DHCP ve SD-WAN rota şablonları.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setViewMode('list'); setEditingTemplate(null); }}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 ${
                viewMode === 'list' && !editingTemplate
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <Sliders className="w-4 h-4" /> Şablon Kütüphanesi ({allTemplates.length})
            </button>
            <button
              onClick={() => { setViewMode('create'); setEditingTemplate(null); }}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 ${
                viewMode === 'create'
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              <Plus className="w-4 h-4" /> + Yeni Politika Ekle
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {applyResult && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-xl flex items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-5 h-5 shrink-0" />
              <span className="text-xs font-semibold">{applyResult}</span>
            </div>
            <button onClick={() => setApplyResult(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* VIEW 1: YENİ POLİTİKA FORMU */}
        {viewMode === 'create' && (
          <div className="bg-card border rounded-2xl p-6 shadow-sm space-y-6 animate-in fade-in">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Zap className="w-5 h-5 text-primary" /> Yeni Ağ Politikası Oluştur & Yayınla
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Hazır şablonlardan birini seçerek parametreleri belirleyin ve şube filonuza dağıtın.
                </p>
              </div>
              <button
                onClick={() => setViewMode('list')}
                className="px-3 py-1.5 bg-muted text-muted-foreground hover:text-foreground text-xs font-semibold rounded-lg flex items-center gap-1"
              >
                <X className="w-4 h-4" /> Listeye Dön
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-6">
              {/* Presets Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {presetPolicies.map((preset) => {
                  const Icon = preset.icon;
                  const isSelected = selectedPresetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      onClick={() => {
                        setSelectedPresetId(preset.id);
                        setName(preset.name);
                        setDescription(preset.description);
                        if (preset.id === 'preset-wg') setType('sdwan_tunnel');
                        else if (preset.id === 'preset-lan') setType('dhcp');
                        else if (preset.id === 'preset-qos') setType('qos');
                        else if (preset.id === 'preset-dns-shield') setType('dns');
                        else if (preset.id === 'preset-routes') setType('routing');
                      }}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-primary/10 border-primary ring-2 ring-primary/20 shadow-sm'
                          : 'bg-card hover:bg-muted/40 border-border/70'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-bold text-xs">{preset.name}</p>
                          <p className="text-[10px] text-muted-foreground font-semibold">{preset.category}</p>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2 line-clamp-2">{preset.description}</p>
                    </div>
                  );
                })}
              </div>

              {/* General Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t">
                <div>
                  <label className="text-xs font-semibold block mb-1">Politika Adı *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Örn: Ege Bölgesi DHCP & DNS Politikası"
                    className="w-full px-3 py-2 bg-background border rounded-xl font-semibold text-xs focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold block mb-1">Hedef Şube Grubu</label>
                  <select
                    value={targetGroup}
                    onChange={(e) => setTargetGroup(e.target.value)}
                    className="w-full px-3 py-2 bg-background border rounded-xl font-semibold text-xs focus:ring-2 focus:ring-primary outline-none"
                  >
                    <option value="Tüm Şubeler">Tüm Şubeler (Merkez & Bölge)</option>
                    {groupsData?.results.map((g) => (
                      <option key={g.id} value={g.name}>{g.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold block mb-1">Politika Türü</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full px-3 py-2 bg-background border rounded-xl font-semibold text-xs focus:ring-2 focus:ring-primary outline-none"
                  >
                    <option value="dhcp">DHCP & IP Dağıtımı</option>
                    <option value="firewall">Güvenlik Duvarı & Filtreleme</option>
                    <option value="sdwan_tunnel">SD-WAN & VPN</option>
                    <option value="qos">QoS & Hız Limiti</option>
                    <option value="routing">Yönlendirme & VLAN Rota</option>
                    <option value="dns">DNS Kalkanı</option>
                    <option value="custom">Özel (Custom UCI)</option>
                  </select>
                </div>
              </div>

              {/* Advanced Code Switcher */}
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Code2 className="w-4 h-4 text-primary" /> UCI / Shell Kural İçeriği
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (!customUciContent) {
                        const preset = presetPolicies.find(p => p.id === selectedPresetId);
                        setCustomUciContent(preset?.defaultUci || '');
                      }
                      setShowAdvancedCode(!showAdvancedCode);
                    }}
                    className="text-xs font-bold text-primary hover:underline"
                  >
                    {showAdvancedCode ? 'Basit Moda Geç' : 'Doğrudan UCI Kodunu Düzenle'}
                  </button>
                </div>

                {showAdvancedCode && (
                  <textarea
                    rows={6}
                    value={customUciContent}
                    onChange={(e) => setCustomUciContent(e.target.value)}
                    placeholder="config rule ..."
                    className="w-full p-3 bg-zinc-950 text-emerald-400 font-mono text-xs border rounded-xl outline-none focus:ring-2 focus:ring-primary leading-relaxed"
                  />
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className="px-4 py-2 border rounded-xl text-xs font-semibold hover:bg-muted"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-6 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl shadow hover:bg-primary/90 flex items-center gap-2"
                >
                  {createMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Politikayı Kaydet
                </button>
              </div>
            </form>
          </div>
        )}

        {/* VIEW 2: DÜZENLEME (EDIT MODAL / DRAWER) */}
        {editingTemplate && (
          <div className="bg-card border-2 border-primary/40 rounded-2xl p-6 shadow-xl space-y-6 animate-in fade-in">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-primary" /> Şablonu Canlı Düzenle: {editingTemplate.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Politika parametrelerini ve donanıma basılacak UCI kodunu doğrudan değiştirip güncelleyebilirsiniz.
                </p>
              </div>
              <button
                onClick={() => setEditingTemplate(null)}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="font-semibold block mb-1">Politika Adı *</label>
                  <input
                    type="text"
                    required
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                    className="w-full p-2.5 bg-background border rounded-xl font-semibold outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="font-semibold block mb-1">Hedef Şube Grubu</label>
                  <select
                    value={editingTemplate.target_group}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, target_group: e.target.value })}
                    className="w-full p-2.5 bg-background border rounded-xl font-semibold outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="Tüm Şubeler">Tüm Şubeler</option>
                    {groupsData?.results.map((g) => (
                      <option key={g.id} value={g.name}>{g.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold block mb-1">Tür</label>
                  <input
                    type="text"
                    value={editingTemplate.type}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, type: e.target.value })}
                    className="w-full p-2.5 bg-background border rounded-xl font-mono outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1">Açıklama</label>
                <input
                  type="text"
                  value={editingTemplate.description || ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                  className="w-full p-2.5 bg-background border rounded-xl outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                    <Code2 className="w-4 h-4 text-primary" /> Donanım UCI Yapılandırması (Canlı Kod)
                  </label>
                  <span className="text-[11px] text-muted-foreground font-mono">OpenWrt /etc/config syntax</span>
                </div>
                <textarea
                  rows={8}
                  value={editingTemplate.uci_content || ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, uci_content: e.target.value })}
                  className="w-full p-3 bg-zinc-950 text-emerald-400 font-mono text-xs border rounded-xl outline-none focus:ring-2 focus:ring-primary leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setEditingTemplate(null)}
                  className="px-4 py-2 border rounded-xl font-semibold hover:bg-muted"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="px-6 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl shadow hover:bg-primary/90 flex items-center gap-2"
                >
                  {updateMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Değişiklikleri Kaydet
                </button>
              </div>
            </form>
          </div>
        )}

        {/* VIEW 3: 500+ ŞABLON DESTEKLİ TABLO & ARAMA LİSTESİ */}
        {viewMode === 'list' && (
          <div className="bg-card border rounded-2xl p-6 shadow-sm space-y-4">
            {/* Search & Filter Controls */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 border-b pb-4">
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Şablon adı, grup veya kod ara..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="w-full pl-9 pr-4 py-2 bg-background border rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                <select
                  value={categoryFilter}
                  onChange={(e) => { setCategoryFilter(e.target.value); setCurrentPage(1); }}
                  className="bg-background border rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">Tüm Kategoriler ({allTemplates.length})</option>
                  <option value="dhcp">DHCP & IP Dağıtımı</option>
                  <option value="firewall">Güvenlik Duvarı</option>
                  <option value="sdwan_tunnel">SD-WAN / VPN</option>
                  <option value="qos">QoS & Hız Limiti</option>
                  <option value="routing">Yönlendirme</option>
                </select>

                <select
                  value={groupFilter}
                  onChange={(e) => { setGroupFilter(e.target.value); setCurrentPage(1); }}
                  className="bg-background border rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">Tüm Hedef Gruplar</option>
                  {groupsData?.results.map((g) => (
                    <option key={g.id} value={g.name}>{g.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Templates Table */}
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider font-bold">
                    <th className="py-3 px-4">Şablon / Politika Adı</th>
                    <th className="py-3 px-4">Kategori & Tür</th>
                    <th className="py-3 px-4">Hedef Grup</th>
                    <th className="py-3 px-4">İçerik Özeti (UCI)</th>
                    <th className="py-3 px-4 text-right">Aksiyonlar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-muted-foreground">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                        Şablon havuzu yükleniyor...
                      </td>
                    </tr>
                  ) : paginatedTemplates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-muted-foreground">
                        {searchQuery ? 'Aramanıza uygun şablon bulunamadı.' : 'Henüz tanımlı bir politika bulunmamaktadır. Yeni bir tane oluşturun.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedTemplates.map((tmpl) => (
                      <tr key={tmpl.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-foreground">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary shrink-0" />
                            <span>{tmpl.name}</span>
                          </div>
                          {tmpl.description && (
                            <p className="text-[11px] font-normal text-muted-foreground mt-0.5 truncate max-w-xs">
                              {tmpl.description}
                            </p>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <span className="px-2.5 py-0.5 bg-muted text-foreground border rounded-full font-mono text-[10px] uppercase font-bold">
                            {tmpl.type}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 font-semibold text-muted-foreground flex items-center gap-1.5 pt-4">
                          <Layers className="w-3.5 h-3.5 text-primary" />
                          <span>{tmpl.target_group || 'Tüm şubeler'}</span>
                        </td>

                        <td className="py-3.5 px-4">
                          <button
                            onClick={() => setSelectedTemplate(tmpl)}
                            className="px-2.5 py-1 bg-zinc-900 text-emerald-400 font-mono text-[10px] tabular-nums rounded-md border border-zinc-800 hover:border-emerald-500/50 flex items-center gap-1.5 transition-colors"
                          >
                            <Code2 className="w-3 h-3" /> UCI kodu ({tmpl.uci_content?.length || 0} bayt)
                          </button>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setConfirmTemplate(tmpl);
                                setTargetScopeMode('all');
                              }}
                              className="px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary text-xs font-bold rounded-lg transition-colors flex items-center gap-1 hover:text-primary-foreground shadow-sm"
                              title="Şubelere Dağıt"
                            >
                              <PlayCircle className="w-3.5 h-3.5" /> Dağıt
                            </button>

                            <button
                              onClick={() => {
                                setEditingTemplate(tmpl);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                              title="İçeriği Düzenle"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => {
                                setConfirmModal({
                                  isOpen: true,
                                  title: `Şablonu sil: ${tmpl.name}`,
                                  description: 'Bu şablon veritabanından kalıcı olarak kaldırılacaktır. Onaylıyor musunuz?',
                                  confirmText: 'Evet, sil',
                                  variant: 'danger',
                                  onConfirm: () => {
                                    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                                    deleteMutation.mutate(tmpl.id);
                                  }
                                });
                              }}
                              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                              title="Sil"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
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
                <span className="font-mono tabular-nums">
                  Toplam {filteredTemplates.length} şablondan {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, filteredTemplates.length)} arası gösteriliyor
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 border rounded-md hover:bg-muted disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-bold text-foreground font-mono tabular-nums">Sayfa {currentPage} / {totalPages}</span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 border rounded-md hover:bg-muted disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* UCI Code Inspector Modal */}
        {selectedTemplate && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-card border rounded-2xl p-6 w-full max-w-2xl shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2">
                  <Code2 className="w-5 h-5 text-primary" />
                  <h3 className="text-sm font-bold">{selectedTemplate.name} — UCI kodu inceleme</h3>
                </div>
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 max-h-96 overflow-y-auto">
                <pre className="text-emerald-400 font-mono text-xs whitespace-pre-wrap leading-relaxed">
                  {selectedTemplate.uci_content || '# Şablon içeriği boş.'}
                </pre>
              </div>

              <div className="flex items-center justify-between pt-2 border-t text-xs">
                <span className="text-muted-foreground font-mono">Hedef grup: <strong>{selectedTemplate.target_group}</strong></span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingTemplate(selectedTemplate);
                      setSelectedTemplate(null);
                    }}
                    className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-lg shadow hover:bg-primary/90 flex items-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Canlı düzenle
                  </button>
                  <button
                    onClick={() => setSelectedTemplate(null)}
                    className="px-4 py-2 border rounded-lg font-semibold hover:bg-muted"
                  >
                    Kapat
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Targeted Branch Deployment Modal */}
        {confirmTemplate && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-card border rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Send className="w-4 h-4 text-primary" /> Politikayı şubelere dağıt
                </h3>
                <button
                  onClick={() => setConfirmTemplate(null)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 bg-muted/40 border rounded-lg">
                  <p className="font-bold text-sm text-foreground">{confirmTemplate.name}</p>
                  <p className="text-muted-foreground mt-0.5">{confirmTemplate.description}</p>
                </div>

                <div className="space-y-2">
                  <label className="font-bold text-muted-foreground uppercase tracking-wider block">
                    Hedef dağıtım kapsamı
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTargetScopeMode('all')}
                      className={`p-3 rounded-lg border text-left font-bold transition-all ${
                        targetScopeMode === 'all'
                          ? 'bg-primary/10 border-primary text-primary shadow-sm'
                          : 'bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      Tüm şubelere dağıt (<span className="font-mono tabular-nums">{devices.length}</span>)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetScopeMode('custom')}
                      className={`p-3 rounded-lg border text-left font-bold transition-all ${
                        targetScopeMode === 'custom'
                          ? 'bg-primary/10 border-primary text-primary shadow-sm'
                          : 'bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      Özel şube seçimi (<span className="font-mono tabular-nums">{selectedBranchIds.length}</span>)
                    </button>
                  </div>
                </div>

                {targetScopeMode === 'custom' && (
                  <div className="p-3 border rounded-lg bg-background max-h-40 overflow-y-auto space-y-1.5">
                    {devices.map((d) => {
                      const isChecked = selectedBranchIds.includes(d.id);
                      return (
                        <button
                          type="button"
                          key={d.id}
                          onClick={() => {
                            if (isChecked) setSelectedBranchIds(prev => prev.filter(id => id !== d.id));
                            else setSelectedBranchIds(prev => [...prev, d.id]);
                          }}
                          className={`w-full p-2 rounded-md text-xs font-semibold border flex items-center justify-between text-left transition-colors ${
                            isChecked ? 'bg-primary/10 border-primary text-primary font-bold' : 'bg-card text-muted-foreground hover:bg-muted/40'
                          }`}
                        >
                          <span>{d.name} {d.group ? `[${d.group}]` : ''}</span>
                          <span className="font-mono tabular-nums text-[10px]">{d.last_ip || 'IP yok'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setConfirmTemplate(null)}
                  className="px-4 py-2 border rounded-lg font-semibold hover:bg-muted"
                >
                  İptal
                </button>
                <button
                  type="button"
                  disabled={applyMutation.isPending || (targetScopeMode === 'custom' && selectedBranchIds.length === 0)}
                  onClick={() => {
                    applyMutation.mutate({
                      templateId: confirmTemplate.id,
                      deviceId: targetScopeMode === 'custom' ? selectedBranchIds.join(',') : undefined
                    });
                  }}
                  className="px-5 py-2.5 bg-primary text-primary-foreground font-bold rounded-lg shadow hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50"
                >
                  {applyMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Donanımlara uygula
                </button>
              </div>
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
      </div>
    </PageContainer>
  );
}
