'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchDevices,
  fetchStats,
  createDevice,
  updateDevice,
  deleteDevice,
  fetchDeviceGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  toggleBranchWanLock,
  fetchTemplates,
  fetchSubnets,
  Device,
  DeviceGroup
} from '@/lib/api';
import {
  Building2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  Search,
  Filter,
  Trash2,
  Server,
  Layers,
  Key,
  Copy,
  Check,
  X,
  Terminal,
  FolderPlus,
  Lock,
  Unlock,
  ShieldAlert,
  Edit2,
  Globe
} from 'lucide-react';
import BulkActionModal from '@/components/BulkActionModal';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import DeviceDiagnosticsModal from '@/components/DeviceDiagnosticsModal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useHubEventStream } from '@/hooks/useHubEventStream';

// Yoğun durum satırı: eşit dörtlü kart tekrarı yerine tek panel içinde
// renkli nokta + ikon + etiket + sağa yaslı mono değer düzeni.
function StatRow({
  label,
  value,
  caption,
  accent,
  icon: Icon,
  loading
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  accent: 'primary' | 'emerald' | 'destructive' | 'amber';
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
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
        {loading ? (
          <Skeleton className="h-5 w-10 ml-auto" />
        ) : (
          <span className="text-lg font-semibold font-mono tabular-nums leading-none">{value}</span>
        )}
        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{caption}</p>
      </div>
    </div>
  );
}

export default function FleetPage() {
  useHubEventStream();
  const queryClient = useQueryClient();

  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState<boolean>(false);

  // In-App Confirm/Alert Modal State
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

  // Detail Modal State
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [diagnosticsDevice, setDiagnosticsDevice] = useState<Device | null>(null);

  // Add Device Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [newDeviceName, setNewDeviceName] = useState<string>('');
  const [newDeviceMac, setNewDeviceMac] = useState<string>('');
  const [newDeviceModel, setNewDeviceModel] = useState<string>('Cisco Meraki MX64');
  const [newDeviceGroup, setNewDeviceGroup] = useState<string>('');
  const [newDeviceLanSubnet, setNewDeviceLanSubnet] = useState<string>('');
  const [isManualSubnetEntry, setIsManualSubnetEntry] = useState<boolean>(false);
  const [newDeviceNotes, setNewDeviceNotes] = useState<string>('');
  const [addError, setAddError] = useState<string | null>(null);

  // Edit Device Name / Info State
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editDeviceName, setEditDeviceName] = useState<string>('');
  const [editDeviceLanSubnet, setEditDeviceLanSubnet] = useState<string>('');
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);

  // Group Management State (List / Edit / Delete / Create)
  const [isGroupModalOpen, setIsGroupModalOpen] = useState<boolean>(false);
  const [editingGroup, setEditingGroup] = useState<DeviceGroup | null>(null);
  const [newGroupName, setNewGroupName] = useState<string>('');
  const [newGroupDesc, setNewGroupDesc] = useState<string>('');
  const [groupError, setGroupError] = useState<string | null>(null);

  // Newly Created Key Modal State
  const [createdDeviceKey, setCreatedDeviceKey] = useState<{ name: string; key: string } | null>(null);

  // Copy state
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Internet Durumu Filtresi (Tümü / Kilitli-Drop / Açık)
  const [wanFilter, setWanFilter] = useState<'all' | 'locked' | 'unlocked'>('all');

  // Queries
  const { data: devicesData, isLoading: devicesLoading } = useQuery({
    queryKey: ['fleet-devices', selectedGroup, search],
    queryFn: () =>
      fetchDevices({
        group: selectedGroup !== 'all' ? selectedGroup : undefined,
        search: search || undefined
      }),
    refetchInterval: 30000
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['fleet-stats'],
    queryFn: fetchStats,
    refetchInterval: 30000
  });

  const { data: groupsData } = useQuery({
    queryKey: ['fleet-groups'],
    queryFn: fetchDeviceGroups
  });

  // IPAM'daki tanımlı şube LAN alt ağları - "Yeni Şube Ekle" modalinde manuel IP
  // girişi yerine buradan seçim yapılabilir; IPAM'da olmayan yeni bir subnet girilirse
  // backend (POST /api/devices) onu otomatik olarak IPAM'a da kaydeder.
  const { data: subnetsData } = useQuery({
    queryKey: ['fleet-ipam-subnets'],
    queryFn: fetchSubnets
  });

  const branchLanSubnets = (subnetsData?.results || []).filter((s) => s.type !== 'sdwan_tunnel');
  const usedSubnets = new Set((devicesData?.results || []).map((d) => d.lan_subnet).filter(Boolean));
  const availableLanSubnets = branchLanSubnets.filter((s) => !usedSubnets.has(s.subnet));

  // Create Group Mutation
  const createGroupMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => createGroup(data.name, data.description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-groups'] });
      queryClient.invalidateQueries({ queryKey: ['device-groups'] });
      queryClient.invalidateQueries({ queryKey: ['dhcp-groups'] });
      queryClient.invalidateQueries({ queryKey: ['topology-groups'] });
      setNewGroupName('');
      setNewGroupDesc('');
      setGroupError(null);
    },
    onError: (err: any) => {
      setGroupError(err.message || 'Grup oluşturulurken bir hata oluştu.');
    }
  });

  // Update Group Mutation
  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string } }) =>
      updateGroup(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-groups'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
      setEditingGroup(null);
      setGroupError(null);
    },
    onError: (err: any) => {
      setGroupError(err.message || 'Grup güncellenirken bir hata oluştu.');
    }
  });

  // Delete Group Mutation
  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => deleteGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-groups'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
    },
    onError: (err: any) => {
      setConfirmModal({
        isOpen: true,
        title: 'Grup Silinemedi',
        description: `Grup silinirken hata oluştu: ${err.message}`,
        variant: 'danger'
      });
    }
  });

  const handleDeleteGroup = (group: DeviceGroup) => {
    setConfirmModal({
      isOpen: true,
      title: 'Şube Grubunu Sil',
      description: (
        <span>
          <strong>{group.name}</strong> grubunu silmek istediğinize emin misiniz? Gruba bağlı cihazlar bağımsız hale gelecektir.
        </span>
      ),
      confirmText: 'Grubu Sil',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        deleteGroupMutation.mutate(group.id);
      }
    });
  };

  // Create Device Mutation
  const createMutation = useMutation({
    mutationFn: createDevice,
    onSuccess: (newDev) => {
      queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-stats'] });
      queryClient.invalidateQueries({ queryKey: ['overview-devices'] });
      queryClient.invalidateQueries({ queryKey: ['overview-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sdwan-topology'] });
      queryClient.invalidateQueries({ queryKey: ['dhcp-devices'] });
      queryClient.invalidateQueries({ queryKey: ['pki-devices'] });
      // Yeni bir subnet otomatik olarak IPAM'a eklenmiş olabilir (bkz. POST /api/devices)
      queryClient.invalidateQueries({ queryKey: ['fleet-ipam-subnets'] });
      queryClient.invalidateQueries({ queryKey: ['ipam-subnets'] });
      setIsAddModalOpen(false);
      setNewDeviceName('');
      setNewDeviceMac('');
      setNewDeviceGroup('');
      setNewDeviceLanSubnet('');
      setIsManualSubnetEntry(false);
      setNewDeviceNotes('');
      setAddError(null);

      // Show key modal
      if (newDev.key) {
        setCreatedDeviceKey({ name: newDev.name, key: newDev.key });
      }
    },
    onError: (err: any) => {
      setAddError(err.message || 'Şube eklenirken bir hata oluştu.');
    }
  });

  // Fetch Templates to check locked WAN state
  const { data: templatesData } = useQuery({
    queryKey: ['fleet-templates'],
    queryFn: fetchTemplates
  });

  const lockedBranches = (templatesData?.results || [])
    .filter((t) => t.name.startsWith('WAN-Killswitch-'))
    .map((t) => t.name.replace('WAN-Killswitch-', ''));

  const isBranchLocked = (dev: Device) => {
    return lockedBranches.includes(dev.name) || lockedBranches.includes(dev.id) || !!dev.is_wan_locked_hw;
  };

  // WAN Killswitch Lock/Unlock Mutation
  const [lockingDeviceId, setLockingDeviceId] = useState<string | null>(null);
  const wanLockMutation = useMutation({
    mutationFn: (params: { deviceId: string; deviceName: string; locked: boolean }) =>
      toggleBranchWanLock(params),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['fleet-templates'] });
      queryClient.invalidateQueries({ queryKey: ['fw-templates'] });
      setLockingDeviceId(null);
    },
    onError: (err: any) => {
      setConfirmModal({
        isOpen: true,
        title: 'İşlem Başarısız',
        description: `İnternet kilidi değiştirilemedi: ${err.message}`,
        variant: 'danger'
      });
      setLockingDeviceId(null);
    }
  });

  const handleToggleWanLock = (dev: Device) => {
    const isCurrentlyLocked = isBranchLocked(dev);
    const title = isCurrentlyLocked ? 'Şube İnternet Kilidini Aç' : 'Şube İnternetini Kilitle';
    const description = isCurrentlyLocked ? (
      <span>
        <strong>{dev.name}</strong> şubesinin internet erişim kilidini açmak istiyor musunuz? Şube kullanıcıları normal dış internete çıkmaya devam edebilecektir.
      </span>
    ) : (
      <div className="space-y-2">
        <p>
          <strong>{dev.name}</strong> şubesinin internet çıkışını kilitlemek istiyor musunuz?
        </p>
        <p className="text-[11px] text-emerald-500 font-medium">
          ✓ Şubenin SD-WAN merkez yönetim bağı ve tüneli açık kalmaya devam edecektir.
        </p>
      </div>
    );

    setConfirmModal({
      isOpen: true,
      title,
      description,
      confirmText: isCurrentlyLocked ? 'Kilidi Kaldır' : 'İnterneti Kilitle',
      variant: isCurrentlyLocked ? 'info' : 'warning',
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        setLockingDeviceId(dev.id);
        wanLockMutation.mutate({
          deviceId: dev.id,
          deviceName: dev.name,
          locked: !isCurrentlyLocked
        });
      }
    });
  };

  // Delete Device Mutation
  const deleteMutation = useMutation({
    mutationFn: deleteDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-stats'] });
      queryClient.invalidateQueries({ queryKey: ['overview-devices'] });
      queryClient.invalidateQueries({ queryKey: ['overview-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sdwan-topology'] });
      queryClient.invalidateQueries({ queryKey: ['dhcp-devices'] });
    }
  });

  // Update Device / Assign Group Mutation
  const [updatingGroupDeviceId, setUpdatingGroupDeviceId] = useState<string | null>(null);
  const updateDeviceMutation = useMutation({
    mutationFn: ({ id, group }: { id: string; group: string | null }) =>
      updateDevice(id, { group }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-groups'] });
      queryClient.invalidateQueries({ queryKey: ['overview-devices'] });
      queryClient.invalidateQueries({ queryKey: ['sdwan-topology'] });
      setUpdatingGroupDeviceId(null);
    },
    onError: (err: any) => {
      setConfirmModal({
        isOpen: true,
        title: 'Grup Ataması Başarısız',
        description: `Cihaz gruba atanamadı: ${err.message}`,
        variant: 'danger'
      });
      setUpdatingGroupDeviceId(null);
    }
  });

  const handleAssignGroup = (deviceId: string, groupId: string) => {
    setUpdatingGroupDeviceId(deviceId);
    updateDeviceMutation.mutate({
      id: deviceId,
      group: groupId ? groupId : null
    });
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeviceName || !newDeviceMac) {
      setAddError('Şube Adı ve MAC adresi zorunludur.');
      return;
    }
    createMutation.mutate({
      name: newDeviceName,
      mac_address: newDeviceMac,
      model: newDeviceModel,
      group: newDeviceGroup || undefined,
      lan_subnet: newDeviceLanSubnet || undefined,
      notes: newDeviceNotes
    });
  };

  const handleDeleteDevice = (id: string, name: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Şube Kaydını Sil',
      description: (
        <span>
          <strong>{name}</strong> şubesinin sistem kaydını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
        </span>
      ),
      confirmText: 'Şubeyi Sil',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        deleteMutation.mutate(id);
      }
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked && devicesData?.results) {
      setSelectedDeviceIds(devicesData.results.map((d) => d.id));
    } else {
      setSelectedDeviceIds([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedDeviceIds((prev) => [...prev, id]);
    } else {
      setSelectedDeviceIds((prev) => prev.filter((item) => item !== id));
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const allDevicesList = devicesData?.results || [];
  const devices = allDevicesList.filter((d) => {
    const isLocked = lockedBranches.includes(d.name) || d.is_wan_locked_hw;
    if (wanFilter === 'locked') return isLocked;
    if (wanFilter === 'unlocked') return !isLocked;
    return true;
  });

  const headerAction = (
    <div className="flex flex-wrap items-center gap-2">
      {selectedDeviceIds.length > 0 && (
        <button
          onClick={() => setIsBulkModalOpen(true)}
          className="px-3.5 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold rounded-lg border transition-colors flex items-center gap-2"
        >
          <Layers className="w-4 h-4" /> Toplu işlem ({selectedDeviceIds.length})
        </button>
      )}
      <button
        onClick={() => {
          setEditingGroup(null);
          setNewGroupName('');
          setNewGroupDesc('');
          setGroupError(null);
          setIsGroupModalOpen(true);
        }}
        className="px-3.5 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold rounded-lg border transition-colors flex items-center gap-2"
      >
        <FolderPlus className="w-4 h-4 text-primary" /> Grup & bölge yönetimi
      </button>
      <button
        onClick={() => setIsAddModalOpen(true)}
        className="px-3.5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg shadow transition-colors flex items-center gap-2"
      >
        <Plus className="w-4 h-4" /> Yeni şube ekle
      </button>
    </div>
  );

  return (
    <PageContainer
      pageTitle="Cihaz & şube filosu yönetimi"
      pageDescription="Merkezi SD-WAN şube ağ geçitlerinin canlı takibi, kaydı ve donanım durumları"
      pageHeaderAction={headerAction}
    >
      <div className="flex flex-1 flex-col gap-5">
      {/* Durum özeti + filtre/arama tek panelde: eşit dörtlü kart tekrarı yerine
          yoğun bir satır listesi, arama ve WAN filtreleri yanında ikincil kalır. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="bg-card border rounded-2xl p-5">
          <h3 className="text-sm font-semibold mb-1">Filo durumu</h3>
          <div className="divide-y divide-border/60">
            <StatRow
              label="Toplam kayıtlı şube"
              value={stats?.total ?? 0}
              caption="sistemdeki tüm noktalar"
              accent="primary"
              icon={Building2}
              loading={statsLoading}
            />
            <StatRow
              label="Çevrimiçi"
              value={stats?.online ?? 0}
              caption="merkeze bağlı ve faal"
              accent="emerald"
              icon={CheckCircle2}
              loading={statsLoading}
            />
            <StatRow
              label="Çevrimdışı"
              value={stats?.offline ?? 0}
              caption="bağlantısı kesilmiş"
              accent="destructive"
              icon={XCircle}
              loading={statsLoading}
            />
            <StatRow
              label="Dikkat gerektiren"
              value={stats?.problem ?? 0}
              caption="yüksek gecikme riskli"
              accent="amber"
              icon={AlertCircle}
              loading={statsLoading}
            />
          </div>
        </div>

        <div className="bg-card border rounded-2xl p-5 flex flex-col gap-4">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Şube adı, MAC adresi veya IP ile ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-background border rounded-lg pl-9 pr-4 py-2 text-xs focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* WAN izolasyon durumu filtresi */}
            <div className="flex items-center bg-muted/60 p-1 rounded-lg border text-xs font-semibold max-w-full overflow-x-auto">
              <button
                type="button"
                onClick={() => setWanFilter('all')}
                className={`px-3 py-1.5 rounded-md transition-all font-mono tabular-nums shrink-0 whitespace-nowrap ${
                  wanFilter === 'all'
                    ? 'bg-background text-foreground shadow font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Tüm şubeler ({allDevicesList.length})
              </button>
              <button
                type="button"
                onClick={() => setWanFilter('locked')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 font-mono tabular-nums shrink-0 whitespace-nowrap ${
                  wanFilter === 'locked'
                    ? 'bg-destructive text-destructive-foreground shadow font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Lock className="w-3.5 h-3.5" /> Kilitli / drop (
                {allDevicesList.filter((d) => lockedBranches.includes(d.name) || d.is_wan_locked_hw).length}
                )
              </button>
              <button
                type="button"
                onClick={() => setWanFilter('unlocked')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 font-mono tabular-nums shrink-0 whitespace-nowrap ${
                  wanFilter === 'unlocked'
                    ? 'bg-emerald-600 text-white shadow font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Unlock className="w-3.5 h-3.5" /> İnterneti açık (
                {allDevicesList.filter((d) => !lockedBranches.includes(d.name) && !d.is_wan_locked_hw).length}
                )
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="bg-background border rounded-lg p-2 text-xs focus:ring-2 focus:ring-primary outline-none"
              >
                <option value="all">Tüm şube grupları ({groupsData?.results?.length || 0})</option>
                {groupsData?.results?.map((g) => (
                  <option key={g.id} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-card border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider whitespace-nowrap">
                <th className="py-2.5 px-3 w-8">
                  <input
                    type="checkbox"
                    checked={selectedDeviceIds.length > 0 && selectedDeviceIds.length === devices.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                  />
                </th>
                <th className="py-2.5 px-3">Şube / cihaz</th>
                <th className="py-2.5 px-3">Grup</th>
                <th className="py-2.5 px-3">MAC adresi</th>
                <th className="py-2.5 px-3">IP adresi</th>
                <th className="py-2.5 px-3">Sürüm & canary</th>
                <th className="py-2.5 px-3">Anahtar</th>
                <th className="py-2.5 px-3">Model</th>
                <th className="py-2.5 px-3">Durum</th>
                <th className="py-2.5 px-3 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {devicesLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} aria-label="Yükleniyor">
                    <td className="py-3 px-3"><Skeleton className="h-3.5 w-3.5" /></td>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="py-3 px-3">
                        <Skeleton className="h-3" style={{ width: j === 0 ? '80%' : '55%' }} />
                      </td>
                    ))}
                    <td className="py-3 px-3 text-right"><Skeleton className="h-3 w-16 ml-auto" /></td>
                  </tr>
                ))
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center space-y-3">
                    <div className="p-4 bg-muted/50 rounded-full w-fit mx-auto text-muted-foreground">
                      <Server className="w-8 h-8" />
                    </div>
                    <p className="font-bold text-sm text-foreground">Sistemde kayıtlı şube bulunmuyor</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Henüz tanımlanmış bir şube kaydı yok. Sağ üstteki "Yeni şube ekle" butonunu kullanarak ilk şubenizi kaydedebilirsiniz.
                    </p>
                    <button
                      onClick={() => setIsAddModalOpen(true)}
                      className="px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg shadow inline-flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> İlk şubeyi kaydet
                    </button>
                  </td>
                </tr>
              ) : (
                devices.map((dev) => (
                  <tr key={dev.id} className="hover:bg-muted/30 transition-colors whitespace-nowrap">
                    <td className="py-2.5 px-3">
                      <input
                        type="checkbox"
                        checked={selectedDeviceIds.includes(dev.id)}
                        onChange={(e) => handleSelectOne(dev.id, e.target.checked)}
                        className="rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                      />
                    </td>
                    <td className="py-2.5 px-3 font-bold text-foreground">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setSelectedDevice(dev)}
                          className="hover:underline text-left text-primary font-bold text-xs"
                        >
                          {dev.name}
                        </button>
                        <button
                          onClick={() => {
                            setEditingDevice(dev);
                            setEditDeviceName(dev.name);
                            setEditDeviceLanSubnet(dev.lan_subnet || dev.lan_gateway || '');
                            setIsEditModalOpen(true);
                          }}
                          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                          title="Şube / Cihaz Adını Düzenle"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                      {dev.notes && <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{dev.notes}</div>}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1">
                        <select
                          value={dev.group || ''}
                          disabled={updatingGroupDeviceId === dev.id}
                          onChange={(e) => handleAssignGroup(dev.id, e.target.value)}
                          className="bg-background border rounded px-1.5 py-0.5 text-xs font-medium outline-none focus:ring-1 focus:ring-primary text-foreground cursor-pointer hover:border-primary/50 transition-colors max-w-[130px]"
                        >
                          <option value="">Bağımsız</option>
                          {groupsData?.results?.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        {updatingGroupDeviceId === dev.id && (
                          <span className="text-[10px] text-primary animate-spin">⏳</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-xs">{dev.mac_address}</td>
                    <td className="py-2.5 px-3 font-mono text-muted-foreground text-xs">{dev.ip_address}</td>
                    <td className="py-2.5 px-3 font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded font-bold text-[10px]">
                          {dev.agent_version ? `v${dev.agent_version}` : 'Bilinmiyor'}
                        </span>
                        <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded font-medium text-[10px]">
                          {dev.ota_cohort === 'CANARY_5' ? '🛡️ %5 Kanarya' : dev.ota_cohort === 'PILOT_25' ? '🚀 %20 Pilot' : '🌐 %100 Genel'}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {dev.key ? (
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded border border-primary/20 font-bold text-[10px] flex items-center gap-1">
                            <Key className="w-3 h-3" /> {dev.key.slice(0, 8)}...
                          </span>
                          <button
                            onClick={() => copyToClipboard(dev.key!, dev.id)}
                            className="p-1 border rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            title="Anahtarı Kopyala"
                          >
                            {copiedKeyId === dev.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-xs truncate max-w-[130px]">{dev.model}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1">
                        {dev.status === 'online' ? (
                          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full font-semibold text-[10px] flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Çevrimiçi
                          </span>
                        ) : dev.status === 'problem' ? (
                          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full font-semibold text-[10px] flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Dikkat
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 rounded-full font-semibold text-[10px] flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> Çevrimdışı
                          </span>
                        )}

                        {lockedBranches.includes(dev.name) && dev.is_wan_locked_hw ? (
                          <span className="px-1.5 py-0.5 bg-destructive/15 text-destructive border border-destructive/30 rounded-full font-bold text-[10px] flex items-center gap-1" title="Merkez Veritabanı ve Şube Donanım Çekirdeği Doğrulamalı İzolasyon">
                            <Lock className="w-2.5 h-2.5" /> 🛡️ WAN Kilitli
                          </span>
                        ) : lockedBranches.includes(dev.name) ? (
                          <span className="px-1.5 py-0.5 bg-amber-500/15 text-amber-500 border border-amber-500/30 rounded-full font-bold text-[10px] flex items-center gap-1" title="Merkezde kilitli, şube donanımının doğrulaması bekleniyor...">
                            <Lock className="w-2.5 h-2.5 animate-pulse" /> ⏳ Senkronize
                          </span>
                        ) : dev.is_wan_locked_hw ? (
                          <span className="px-1.5 py-0.5 bg-purple-500/15 text-purple-400 border border-purple-500/30 rounded-full font-bold text-[10px] flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> 🔒 Donanım Kilitli
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-muted/40 text-muted-foreground border border-border/40 rounded-full font-medium text-[10px] flex items-center gap-1">
                            <Globe className="w-2.5 h-2.5 opacity-70" /> Açık
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1.5">
                      <button
                        onClick={() => handleToggleWanLock(dev)}
                        disabled={lockingDeviceId === dev.id}
                        className={`px-2 py-0.5 border rounded text-[10px] font-semibold transition-colors inline-flex items-center gap-1 ${
                          isBranchLocked(dev)
                            ? 'border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10'
                            : 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10'
                        }`}
                      >
                        {lockingDeviceId === dev.id ? (
                           <span className="animate-spin">⏳</span>
                        ) : isBranchLocked(dev) ? (
                          <>
                            <Unlock className="w-3 h-3 text-emerald-500" /> Kilidi Aç
                          </>
                        ) : (
                          <>
                            <Lock className="w-3 h-3 text-amber-500" /> Kilitle
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => setDiagnosticsDevice(dev)}
                        className="px-2 py-0.5 border border-primary/30 text-primary hover:bg-primary/10 rounded text-[10px] font-semibold transition-colors inline-flex items-center gap-1"
                      >
                        <Terminal className="w-3 h-3" /> Tanı
                      </button>
                      <button
                        onClick={() => setSelectedDevice(dev)}
                        className="px-2 py-0.5 border rounded text-[10px] font-semibold hover:bg-muted transition-colors"
                      >
                        İncele
                      </button>
                      <button
                        onClick={() => handleDeleteDevice(dev.id, dev.name)}
                        className="px-2 py-0.5 border border-destructive/30 text-destructive rounded text-[10px] font-semibold hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-3 h-3 inline" />
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

      {/* Add Device Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" /> Yeni şube / cihaz kaydı ekle
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {addError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-xs font-medium">
                {addError}
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold block mb-1">Şube / cihaz adı *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Kadıköy Şube Ağ Geçidi"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary font-semibold"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Cihaz MAC adresi *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: 00:18:0A:1B:2C:3D"
                  value={newDeviceMac}
                  onChange={(e) => setNewDeviceMac(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Şube grubu / bölge</label>
                <select
                  value={newDeviceGroup}
                  onChange={(e) => setNewDeviceGroup(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary font-semibold"
                >
                  <option value="">Grup Yok (Bağımsız Şube)</option>
                  {groupsData?.results?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold block">Şube yerel LAN alt ağı (subnet)</label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsManualSubnetEntry((v) => !v);
                      setNewDeviceLanSubnet('');
                    }}
                    className="text-[10px] font-semibold text-primary hover:underline"
                  >
                    {isManualSubnetEntry ? 'IPAM Listesinden Seç' : '✏️ Manuel / Yeni Subnet Gir'}
                  </button>
                </div>

                {isManualSubnetEntry ? (
                  <input
                    type="text"
                    placeholder="Örn: 10.1.161.0/24 (Gateway: 10.1.161.1)"
                    value={newDeviceLanSubnet}
                    onChange={(e) => setNewDeviceLanSubnet(e.target.value)}
                    className="w-full bg-background border rounded-lg p-2.5 font-mono outline-none focus:ring-2 focus:ring-primary"
                  />
                ) : (
                  <select
                    value={newDeviceLanSubnet}
                    onChange={(e) => setNewDeviceLanSubnet(e.target.value)}
                    className="w-full bg-background border rounded-lg p-2.5 font-mono outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Otomatik Ata (IPAM havuzundan)</option>
                    {availableLanSubnets.map((s) => (
                      <option key={s.id} value={s.subnet}>
                        {s.subnet} — {s.name}
                      </option>
                    ))}
                  </select>
                )}

                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {isManualSubnetEntry
                    ? 'IPAM\'da henüz kayıtlı olmayan yeni bir subnet giriyorsunuz - kaydettiğinizde otomatik olarak IPAM havuzuna da eklenecek.'
                    : 'Şube içi Kasa, NVR, VoIP ve bilgisayarların bağlanacağı yerel IP bloğu - IPAM\'da tanımlı, henüz başka bir şubeye atanmamış alt ağlar listelenir.'}
                </p>
              </div>

              <div>
                <label className="font-semibold block mb-1">Donanım modeli</label>
                <select
                  value={newDeviceModel}
                  onChange={(e) => setNewDeviceModel(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary font-semibold"
                >
                  <option value="Cisco Meraki MX64">Cisco Meraki MX64 (BCM58625)</option>
                  <option value="Cisco Meraki MX65">Cisco Meraki MX65</option>
                  <option value="Raspberry Pi Zero 2 W">Raspberry Pi Zero 2 W</option>
                  <option value="SD-WAN Kurumsal Ağ Geçidi">SD-WAN Kurumsal Ağ Geçidi</option>
                </select>
              </div>

              <div>
                <label className="font-semibold block mb-1">Lokasyon / notlar</label>
                <textarea
                  placeholder="Şube adresi, saha sorumlusu veya ağ notları..."
                  value={newDeviceNotes}
                  onChange={(e) => setNewDeviceNotes(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary h-20"
                />
              </div>

              <div className="pt-3 border-t flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border rounded-lg font-semibold hover:bg-muted"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-5 py-2 bg-primary text-primary-foreground font-bold rounded-lg shadow hover:bg-primary/90 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Kaydediliyor...' : 'Şube Cihazını Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Created Device Key Modal */}
      {createdDeviceKey && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-base font-bold flex items-center gap-2 text-emerald-500">
                <CheckCircle2 className="w-5 h-5" /> Şube kaydı başarıyla oluşturuldu!
              </h3>
              <button onClick={() => setCreatedDeviceKey(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-muted-foreground">
                <strong className="text-foreground">{createdDeviceKey.name}</strong> şubesi için merkez sunucuda kayıt oluşturuldu. Cihazı merkeze bağlamak için aşağıdaki gizli anahtarı kullanın:
              </p>

              <div>
                <label className="font-semibold block mb-1">Gizli bağlantı anahtarı (shared secret key):</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={createdDeviceKey.key}
                    className="w-full p-3 bg-slate-950 text-emerald-400 font-mono font-bold rounded-xl outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(createdDeviceKey.key, 'modal-key')}
                    className="p-3 bg-primary text-primary-foreground font-bold rounded-xl flex items-center gap-1 hover:bg-primary/90 shrink-0"
                  >
                    {copiedKeyId === 'modal-key' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    Kopyala
                  </button>
                </div>
              </div>

              <div className="p-4 bg-muted/40 rounded-xl space-y-3 border">
                <div className="flex items-center gap-2 font-bold text-foreground">
                  <Terminal className="w-4 h-4 text-primary" /> Cisco Meraki MX64 Otomatik Flash & Provisioning Komutu:
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Stok Meraki MX64'ü masanızda dönüştürüp doğrudan bu müşteriye mühürlemek için çalıştırın:
                </p>
                <div className="relative">
                  <pre className="p-3 bg-slate-950 text-emerald-400 font-mono text-[11px] rounded-lg overflow-x-auto whitespace-pre-wrap select-all">
                    {`./scripts/meraki_provisioner.sh --server "${typeof window !== 'undefined' ? window.location.origin : 'https://sdwan.ariot.com.tr'}" --device-key "${createdDeviceKey.key}" --device-name "${createdDeviceKey.name}"`}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(`./scripts/meraki_provisioner.sh --server "${typeof window !== 'undefined' ? window.location.origin : 'https://sdwan.ariot.com.tr'}" --device-key "${createdDeviceKey.key}" --device-name "${createdDeviceKey.name}"`, 'modal-meraki-cmd')}
                    className="absolute top-2 right-2 p-1.5 bg-primary/80 text-primary-foreground rounded-md text-[10px] flex items-center gap-1 hover:bg-primary"
                  >
                    {copiedKeyId === 'modal-meraki-cmd' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    Kopyala
                  </button>
                </div>
              </div>

              <div className="p-4 bg-muted/40 rounded-xl space-y-2 border">
                <div className="flex items-center gap-2 font-bold text-foreground">
                  <Terminal className="w-4 h-4 text-primary" /> Halihazırda Çalışan Cihazlar İçin Tek Satırlık Kurulum (Linux / OpenWrt):
                </div>
                <pre className="p-3 bg-slate-950 text-slate-200 font-mono text-[11px] rounded-lg overflow-x-auto whitespace-pre-wrap select-all">
                  {`curl -sSL ${typeof window !== 'undefined' ? window.location.origin : 'https://sdwan.ariot.com.tr'}/downloads/provision.sh | sh -s -- --hub-url "${typeof window !== 'undefined' ? window.location.origin : 'https://sdwan.ariot.com.tr'}" --shared-secret "${createdDeviceKey.key}" --device-id "${createdDeviceKey.name}"`}
                </pre>
              </div>
            </div>

            <div className="pt-3 border-t flex justify-end">
              <button
                onClick={() => setCreatedDeviceKey(null)}
                className="px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl shadow hover:bg-primary/90"
              >
                Tamam, Anladım
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group & Region Management Modal */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-card border rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-primary" /> Şube grubu & bölge yönetimi
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Mevcut grupları düzenleyin, silin veya yeni bir operasyonel bölge tanımlayın
                </p>
              </div>
              <button
                onClick={() => {
                  setIsGroupModalOpen(false);
                  setEditingGroup(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {groupError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{groupError}</span>
              </div>
            )}

            {/* Existing Groups List */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                Kayıtlı Şube Grupları ({groupsData?.results?.length || 0})
              </label>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1 border rounded-xl p-2 bg-muted/20">
                {groupsData?.results?.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    Henüz tanımlı bir grup/bölge bulunmamaktadır.
                  </p>
                ) : (
                  groupsData?.results?.map((g) => (
                    <div
                      key={g.id}
                      className="p-3 bg-card border rounded-xl flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-foreground flex items-center gap-1.5 truncate">
                          <Layers className="w-3.5 h-3.5 text-primary" /> {g.name}
                        </p>
                        {g.description && (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{g.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGroup(g);
                            setNewGroupName(g.name);
                            setNewGroupDesc(g.description || '');
                            setGroupError(null);
                          }}
                          className="p-1.5 hover:bg-primary/10 text-primary border border-primary/20 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                          title="Grubu Düzenle"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(g)}
                          className="p-1.5 hover:bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                          title="Grubu Sil"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Create or Edit Group Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newGroupName) {
                  setGroupError('Grup adı zorunludur.');
                  return;
                }
                if (editingGroup) {
                  updateGroupMutation.mutate({
                    id: editingGroup.id,
                    data: { name: newGroupName, description: newGroupDesc }
                  });
                } else {
                  createGroupMutation.mutate({ name: newGroupName, description: newGroupDesc });
                }
              }}
              className="space-y-3 pt-2 border-t text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground">
                  {editingGroup ? `"${editingGroup.name}" Grubunu Düzenle` : 'Yeni Grup / Bölge Ekle'}
                </span>
                {editingGroup && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingGroup(null);
                      setNewGroupName('');
                      setNewGroupDesc('');
                    }}
                    className="text-[11px] text-primary hover:underline"
                  >
                    + Yeni Grup Ekleme Moduna Dön
                  </button>
                )}
              </div>

              <div>
                <label className="font-semibold block mb-1">Grup / bölge adı *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Marmara Bölgesi, Ege Şubeleri, POS Terminalleri..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 font-semibold outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Açıklama (isteğe bağlı)</label>
                <textarea
                  placeholder="Grup kapsamı ve operasyonel notlar..."
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-primary h-16"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsGroupModalOpen(false);
                    setEditingGroup(null);
                  }}
                  className="px-4 py-2 border rounded-xl font-semibold hover:bg-muted"
                >
                  Kapat
                </button>
                <button
                  type="submit"
                  disabled={createGroupMutation.isPending || updateGroupMutation.isPending}
                  className="px-5 py-2 bg-primary text-primary-foreground font-bold rounded-xl shadow hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
                >
                  {createGroupMutation.isPending || updateGroupMutation.isPending
                    ? 'Kaydediliyor...'
                    : editingGroup
                    ? 'Değişiklikleri Kaydet'
                    : 'Yeni Grubu Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Device Name / Info Modal */}
      {isEditModalOpen && editingDevice && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-lg text-foreground">Şube / cihaz adını güncelle</h3>
                <p className="text-xs text-muted-foreground font-mono">{editingDevice.mac_address} ({editingDevice.id})</p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!editDeviceName.trim()) return;
                
                await fetch(`/api/devices?id=${editingDevice.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: editDeviceName.trim(),
                    lan_subnet: editDeviceLanSubnet.trim() || undefined
                  })
                });
                queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
                setIsEditModalOpen(false);
              }}
              className="space-y-4 text-xs"
            >
              <div>
                <label className="font-semibold block mb-1 text-foreground">Görünen şube adı *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Kadıköy Şubesi, Levent Merkez, Mağaza #104..."
                  value={editDeviceName}
                  onChange={(e) => setEditDeviceName(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1 text-foreground">Şube yerel LAN alt ağı (subnet / gateway)</label>
                <input
                  type="text"
                  placeholder="Örn: 192.168.101.0/24 veya 192.168.101.1"
                  value={editDeviceLanSubnet}
                  onChange={(e) => setEditDeviceLanSubnet(e.target.value)}
                  className="w-full bg-background border rounded-lg p-2.5 font-mono text-xs outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Değiştirdiğinizde cihazın yerel LAN IP'si ve DHCP dağıtım havuzu canlı olarak güncellenir.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 border rounded-xl font-semibold hover:bg-muted"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-primary text-primary-foreground font-bold rounded-xl shadow hover:bg-primary/90"
                >
                  Kaydet ve Donanıma Uygula
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Action Modal */}
      <BulkActionModal
        selectedIds={selectedDeviceIds}
        action={isBulkModalOpen ? 'reboot' : null}
        onClose={() => setIsBulkModalOpen(false)}
        onSuccess={() => {
          setIsBulkModalOpen(false);
          setSelectedDeviceIds([]);
          queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
          queryClient.invalidateQueries({ queryKey: ['fleet-stats'] });
        }}
      />

      {/* Device Detail Modal */}
      <DeviceDetailModal
        deviceId={selectedDevice?.id || null}
        initialDevice={selectedDevice}
        onClose={() => setSelectedDevice(null)}
      />

      {/* Device Diagnostics & Live Tool Modal */}
      <DeviceDiagnosticsModal
        device={diagnosticsDevice}
        isOpen={Boolean(diagnosticsDevice)}
        onClose={() => setDiagnosticsDevice(null)}
      />

      {/* Global In-App Action & Confirm Modal */}
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
