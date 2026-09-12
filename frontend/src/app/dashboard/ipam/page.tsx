'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Network, Plus, ShieldCheck, Search, Server, Trash2, Edit2, X, CheckCircle2, Globe, Building2, Layers } from 'lucide-react';
import { fetchSubnets, createSubnet, updateSubnet, deleteSubnet, fetchGroups, IPAMSubnet } from '@/lib/api';
import { ConfirmModal } from '@/components/ConfirmModal';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';

// Yoğun KPI satırı: overview sayfasındaki KpiRow deseniyle aynı - eşit dört
// sütunlu kart tekrarı yerine tek panel içinde noktalı/simgeli satır listesi.
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
  accent: 'primary' | 'emerald' | 'destructive' | 'amber' | 'sky';
  icon: React.ComponentType<{ className?: string }>;
}) {
  const accentMap = {
    primary: { text: 'text-primary', dot: 'bg-primary' },
    emerald: { text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    destructive: { text: 'text-destructive', dot: 'bg-destructive' },
    amber: { text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
    sky: { text: 'text-sky-600 dark:text-sky-400', dot: 'bg-sky-500' }
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

export default function IPAMPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'branch_lan' | 'sdwan_tunnel'>('all');

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

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSubnet, setEditingSubnet] = useState<IPAMSubnet | null>(null);

  // Form State for Add / Edit
  const [subnetName, setSubnetName] = useState('');
  const [subnetCidr, setSubnetCidr] = useState('');
  const [subnetType, setSubnetType] = useState<'branch_lan' | 'sdwan_tunnel'>('branch_lan');
  const [subnetRegionGroup, setSubnetRegionGroup] = useState('Merkez SD-WAN');
  const [subnetDesc, setSubnetDesc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Query live IPAM subnets from Central Controller API
  const { data: ipamData, isLoading } = useQuery({
    queryKey: ['ipam-subnets'],
    queryFn: fetchSubnets,
    refetchInterval: 30000
  });

  // Query groups
  const { data: groupsData } = useQuery({
    queryKey: ['groups-list'],
    queryFn: fetchGroups
  });

  // Create Subnet Mutation
  const createSubnetMutation = useMutation({
    mutationFn: (data: {
      name: string;
      subnet: string;
      type: 'branch_lan' | 'sdwan_tunnel';
      region_group?: string;
      description?: string;
    }) => createSubnet(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipam-subnets'] });
      setIsAddModalOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err.message);
    }
  });

  // Update/Edit Subnet Mutation
  const updateSubnetMutation = useMutation({
    mutationFn: (data: {
      id: string;
      name: string;
      subnet: string;
      type: 'branch_lan' | 'sdwan_tunnel';
      region_group?: string;
      description?: string;
    }) => updateSubnet(data.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipam-subnets'] });
      setEditingSubnet(null);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err.message);
    }
  });

  // Delete Subnet Mutation
  const deleteSubnetMutation = useMutation({
    mutationFn: (id: string) => deleteSubnet(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipam-subnets'] });
    }
  });

  const resetForm = () => {
    setSubnetName('');
    setSubnetCidr('');
    setSubnetType('branch_lan');
    setSubnetRegionGroup('Merkez SD-WAN');
    setSubnetDesc('');
    setFormError(null);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subnetName || !subnetCidr) {
      setFormError('Subnet adı ve CIDR adresi zorunludur.');
      return;
    }
    createSubnetMutation.mutate({
      name: subnetName,
      subnet: subnetCidr,
      type: subnetType,
      region_group: subnetRegionGroup,
      description: subnetDesc
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubnet) return;
    if (!subnetName || !subnetCidr) {
      setFormError('Subnet adı ve CIDR adresi zorunludur.');
      return;
    }
    updateSubnetMutation.mutate({
      id: editingSubnet.id,
      name: subnetName,
      subnet: subnetCidr,
      type: subnetType,
      region_group: subnetRegionGroup,
      description: subnetDesc
    });
  };

  const handleDeleteClick = (sub: IPAMSubnet) => {
    setConfirmModal({
      isOpen: true,
      title: 'Subnet bloğunu sil',
      description: (
        <span>
          <strong>{sub.name}</strong> ({sub.subnet}) bloğunu silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
        </span>
      ),
      confirmText: 'Subneti sil',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        deleteSubnetMutation.mutate(sub.id);
      }
    });
  };

  const subnetsList: IPAMSubnet[] = ipamData?.results || [];

  const filteredSubnets = subnetsList.filter((s) => {
    const matchesSearch =
      (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.subnet || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.region_group || '').toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;
    if (activeTab === 'all') return true;
    return s.type === activeTab;
  });

  const tunnelSubnets = subnetsList.filter((s) => s.type === 'sdwan_tunnel');
  const lanSubnets = subnetsList.filter((s) => s.type !== 'sdwan_tunnel');

  const headerAction = (
    <button
      onClick={() => {
        resetForm();
        setIsAddModalOpen(true);
      }}
      className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2"
    >
      <Plus className="w-4 h-4" /> Yeni subnet / tünel havuzu tanımla
    </button>
  );

  return (
    <PageContainer
      pageTitle="IP & subnet planlama (IPAM)"
      pageDescription="Bölgesel SD-WAN tünel havuzları ve şube yerel LAN alt ağlarının dinamik yönetimi"
      pageHeaderAction={headerAction}
    >
      <div className="flex flex-1 flex-col gap-5">
        {/* Ana panel: durum özeti + arama/filtre tek panelde, eşit kart tekrarı
            yerine yoğun satır listesi kullanılıyor. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="bg-card border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-1">Havuz özeti</h3>
            <div className="divide-y divide-border/60">
              <KpiRow
                label="SD-WAN tünel havuzları"
                value={tunnelSubnets.length}
                caption="bölgesel tünel ağı"
                accent="sky"
                icon={Globe}
              />
              <KpiRow
                label="Şube yerel LAN blokları"
                value={lanSubnets.length}
                caption="kasa / NVR / ofis ağı"
                accent="emerald"
                icon={Building2}
              />
              <KpiRow
                label="Toplam tanımlı blok"
                value={isLoading ? '···' : subnetsList.length}
                caption="merkez IPAM veritabanı"
                accent="primary"
                icon={Network}
              />
              <KpiRow
                label="Ağ güvenliği & izolasyon"
                value={<CheckCircle2 className="w-4 h-4 inline text-emerald-500" />}
                caption="bölge bazlı izolasyon aktif"
                accent="emerald"
                icon={ShieldCheck}
              />
            </div>
          </div>

          <div className="bg-card border rounded-2xl p-5 flex flex-col gap-4">
            <h3 className="text-sm font-semibold">Filtre & arama</h3>
            {/* Category Tabs */}
            <div className="flex flex-wrap items-center gap-2 p-1 bg-muted rounded-lg w-fit max-w-full">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Tüm subnetler ({subnetsList.length})
              </button>
              <button
                onClick={() => setActiveTab('branch_lan')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                  activeTab === 'branch_lan' ? 'bg-background shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" /> Şube yerel LAN ({lanSubnets.length})
              </button>
              <button
                onClick={() => setActiveTab('sdwan_tunnel')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                  activeTab === 'sdwan_tunnel' ? 'bg-background shadow-sm text-sky-600 dark:text-sky-400' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Globe className="w-3.5 h-3.5" /> SD-WAN tünelleri ({tunnelSubnets.length})
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Subnet CIDR, ad veya bölge ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-background border rounded-lg pl-9 pr-4 py-2 text-xs focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>
        </div>

        {/* Subnet Table */}
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" /> Subnet blokları
            </h3>
            <span className="text-[10px] text-muted-foreground font-mono">{filteredSubnets.length} kayıt</span>
          </div>
          <div className="overflow-x-auto p-5 pt-3">
            <table className="w-full text-left text-xs rounded-lg overflow-hidden">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Subnet türü</th>
                  <th className="py-3 px-4">Subnet CIDR</th>
                  <th className="py-3 px-4">Ağ / havuz adı</th>
                  <th className="py-3 px-4">Bölge / grup</th>
                  <th className="py-3 px-4">Ağ geçidi (gateway)</th>
                  <th className="py-3 px-4">Açıklama</th>
                  <th className="py-3 px-4 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} aria-label="Yükleniyor">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="py-3 px-4">
                          <Skeleton className="h-3" style={{ width: j === 0 ? '60%' : j === 6 ? '40%' : '70%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filteredSubnets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      Kayıtlı subnet bloğu bulunamadı. Yukarıdaki{' '}
                      <button
                        onClick={() => {
                          resetForm();
                          setIsAddModalOpen(true);
                        }}
                        className="text-primary hover:underline font-medium"
                      >
                        yeni subnet
                      </button>{' '}
                      butonuyla ilk bloğu tanımlayabilirsiniz.
                    </td>
                  </tr>
                ) : (
                  filteredSubnets.map((sub) => (
                    <tr key={sub.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4">
                        {sub.type === 'sdwan_tunnel' ? (
                          <span className="px-2.5 py-1 bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 rounded-full font-medium text-[10px] flex items-center gap-1 w-fit">
                            <Globe className="w-3 h-3" /> SD-WAN tünel
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full font-medium text-[10px] flex items-center gap-1 w-fit">
                            <Building2 className="w-3 h-3" /> Şube yerel LAN
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums font-semibold text-foreground">{sub.subnet}</td>
                      <td className="py-3 px-4 font-medium">{sub.name}</td>
                      <td className="py-3 px-4 text-muted-foreground">
                        <span className="px-2 py-0.5 bg-muted rounded-md border text-[11px] flex items-center gap-1 w-fit">
                          <Layers className="w-3 h-3 text-primary" /> {sub.region_group || 'Merkez SD-WAN'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-muted-foreground">{sub.gateway || '—'}</td>
                      <td className="py-3 px-4 text-muted-foreground text-[11px] max-w-xs truncate">{sub.description || '—'}</td>
                      <td className="py-3 px-4 text-right space-x-2">
                        <button
                          onClick={() => {
                            setEditingSubnet(sub);
                            setSubnetName(sub.name);
                            setSubnetCidr(sub.subnet);
                            setSubnetType(sub.type || 'branch_lan');
                            setSubnetRegionGroup(sub.region_group || 'Merkez SD-WAN');
                            setSubnetDesc(sub.description || '');
                          }}
                          className="p-1.5 border rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Düzenle"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(sub)}
                          className="p-1.5 border border-destructive/30 rounded-md hover:bg-destructive/10 text-destructive transition-colors"
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

      {/* Add Subnet Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" /> Yeni subnet / tünel havuzu ekle
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-4 text-xs">
              <div>
                <label htmlFor="ipam-add-type" className="font-medium block mb-1">Subnet türü *</label>
                <div id="ipam-add-type" className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSubnetType('branch_lan')}
                    className={`p-2.5 rounded-lg border text-left flex items-center gap-2 transition-all ${
                      subnetType === 'branch_lan'
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Building2 className="w-4 h-4" /> Şube yerel LAN
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubnetType('sdwan_tunnel')}
                    className={`p-2.5 rounded-lg border text-left flex items-center gap-2 transition-all ${
                      subnetType === 'sdwan_tunnel'
                        ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Globe className="w-4 h-4" /> SD-WAN tüneli
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="ipam-add-name" className="font-medium block mb-1">Ağ / havuz adı *</label>
                <input
                  id="ipam-add-name"
                  type="text"
                  required
                  placeholder={subnetType === 'sdwan_tunnel' ? 'Örn: Marmara Bölgesi SD-WAN Tüneli' : 'Örn: Kadıköy Şube Yerel LAN'}
                  value={subnetName}
                  onChange={(e) => setSubnetName(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="ipam-add-cidr" className="font-medium block mb-1">Subnet CIDR *</label>
                <input
                  id="ipam-add-cidr"
                  type="text"
                  required
                  placeholder={subnetType === 'sdwan_tunnel' ? 'Örn: 10.10.0.0/22' : 'Örn: 10.1.161.0/24'}
                  value={subnetCidr}
                  onChange={(e) => setSubnetCidr(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 font-mono tabular-nums outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {subnetType === 'sdwan_tunnel'
                    ? 'Merkez ile şubeler arasındaki noktadan noktaya tünel IP aralığı'
                    : 'Şubenin arkasındaki kasa, NVR, VoIP cihazlarının yerel IP bloğu'}
                </p>
              </div>

              <div>
                <label htmlFor="ipam-add-group" className="font-medium block mb-1">Bağlı bölge / şube grubu</label>
                <select
                  id="ipam-add-group"
                  value={subnetRegionGroup}
                  onChange={(e) => setSubnetRegionGroup(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="Merkez SD-WAN">Merkez SD-WAN (genel)</option>
                  {groupsData?.results?.map((g: any) => (
                    <option key={g.id} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="ipam-add-desc" className="font-medium block mb-1">Açıklama</label>
                <textarea
                  id="ipam-add-desc"
                  placeholder="Subnet kullanım amacı ve lokasyon notları..."
                  value={subnetDesc}
                  onChange={(e) => setSubnetDesc(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary h-16"
                />
              </div>

              <div className="pt-3 border-t flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border rounded-lg font-medium hover:bg-muted"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={createSubnetMutation.isPending}
                  className="px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-lg shadow-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  {createSubnetMutation.isPending ? 'Kaydediliyor...' : 'Bloğu kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Subnet Modal */}
      {editingSubnet && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-primary" /> Subnet bloğunu düzenle
              </h3>
              <button onClick={() => setEditingSubnet(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              <div>
                <label htmlFor="ipam-edit-type" className="font-medium block mb-1">Subnet türü</label>
                <div id="ipam-edit-type" className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSubnetType('branch_lan')}
                    className={`p-2.5 rounded-lg border text-left flex items-center gap-2 transition-all ${
                      subnetType === 'branch_lan'
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Building2 className="w-4 h-4" /> Şube yerel LAN
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubnetType('sdwan_tunnel')}
                    className={`p-2.5 rounded-lg border text-left flex items-center gap-2 transition-all ${
                      subnetType === 'sdwan_tunnel'
                        ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Globe className="w-4 h-4" /> SD-WAN tüneli
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="ipam-edit-name" className="font-medium block mb-1">Ağ / havuz adı *</label>
                <input
                  id="ipam-edit-name"
                  type="text"
                  required
                  value={subnetName}
                  onChange={(e) => setSubnetName(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="ipam-edit-cidr" className="font-medium block mb-1">Subnet CIDR *</label>
                <input
                  id="ipam-edit-cidr"
                  type="text"
                  required
                  value={subnetCidr}
                  onChange={(e) => setSubnetCidr(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 font-mono tabular-nums outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="ipam-edit-group" className="font-medium block mb-1">Bağlı bölge / şube grubu</label>
                <select
                  id="ipam-edit-group"
                  value={subnetRegionGroup}
                  onChange={(e) => setSubnetRegionGroup(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="Merkez SD-WAN">Merkez SD-WAN (genel)</option>
                  {groupsData?.results?.map((g: any) => (
                    <option key={g.id} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="ipam-edit-desc" className="font-medium block mb-1">Açıklama</label>
                <textarea
                  id="ipam-edit-desc"
                  value={subnetDesc}
                  onChange={(e) => setSubnetDesc(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary h-16"
                />
              </div>

              <div className="pt-3 border-t flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingSubnet(null)}
                  className="px-4 py-2 border rounded-lg font-medium hover:bg-muted"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={updateSubnetMutation.isPending}
                  className="px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-lg shadow-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  {updateSubnetMutation.isPending ? 'Güncelleniyor...' : 'Değişiklikleri kaydet'}
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
