'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { fetchDeviceDetail, updateDevice, fetchDeviceLogs, fetchNacRules, toggleBranchWanLock, fetchCertificates } from '@/lib/api';
import { Icons } from '@/components/icons';

import { useHubEventStream } from '@/hooks/useHubEventStream';

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted/60 ${className}`} />;
}

function TableSkeleton({ rows = 3, cols = 3 }: { rows?: number; cols?: number }) {
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="bg-muted/50 border-b h-9" />
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((__, c) => (
              <SkeletonBlock key={c} className="h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface Props {
  deviceId: string | null;
  initialDevice?: any | null;
  onClose: () => void;
}

// Şube 360° Görünümü (bkz. 2026-08-22 tasarım kararı): operatörün bir şubeyle ilgili
// her şey için (DHCP, loglar...) ayrı sayfalara gitmesi yerine tek bir yerden bakıp
// müdahale edebilmesi için bu modal sekmeli hale getirildi. Genel sayfalar (DHCP
// yönetimi, loglar) hâlâ duruyor - bu sadece "bu şubeye özel hızlı bakış" katmanı.
type Tab = 'overview' | 'dhcp' | 'firewall' | 'pki' | 'logs';

export default function DeviceDetailModal({ deviceId, initialDevice, onClose }: Props) {
  useHubEventStream();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const { data: detailData, isLoading, error } = useQuery({
    queryKey: ['deviceDetail', deviceId],
    queryFn: () => fetchDeviceDetail(deviceId!),
    enabled: !!deviceId,
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['deviceLogs', deviceId],
    queryFn: () => fetchDeviceLogs(deviceId!, 50),
    enabled: !!deviceId && activeTab === 'logs',
  });

  const dhcpMutation = useMutation({
    mutationFn: (dhcp_enabled: boolean) => updateDevice(deviceId!, { dhcp_enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deviceDetail', deviceId] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    }
  });

  const { data: nacData, isLoading: nacLoading } = useQuery({
    queryKey: ['deviceNac', deviceId],
    queryFn: () => fetchNacRules(deviceId!),
    enabled: !!deviceId && activeTab === 'firewall',
  });

  const { data: certsData, isLoading: certsLoading } = useQuery({
    queryKey: ['certificates'],
    queryFn: fetchCertificates,
    enabled: !!deviceId && activeTab === 'pki',
  });

  const wanLockMutation = useMutation({
    mutationFn: (locked: boolean) => toggleBranchWanLock({ deviceId: deviceId!, deviceName: device?.name || deviceId!, locked }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deviceDetail', deviceId] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    }
  });

  if (!deviceId) return null;


  const device = detailData || initialDevice;

  const formatUptime = (seconds: number, isOnline?: boolean) => {
    if (!seconds) return isOnline ? 'Canlı (Ölçüm Bekleniyor)' : 'Çevrimdışı';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days > 0 ? days + 'g ' : ''}${hours}s ${mins}dk`;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-modal-title"
        className="bg-card border text-card-foreground rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between bg-muted/40">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 text-primary rounded-lg border border-primary/20">
              <Icons.server className="w-6 h-6" />
            </div>
            <div>
              <h2 id="device-modal-title" className="text-lg font-bold tracking-tight">{device?.name || deviceId}</h2>
              <p className="text-xs text-muted-foreground font-mono tabular-nums">{device?.mac_address} • {device?.ip_address}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Kapat"
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Icons.close className="w-5 h-5" />
          </button>
        </div>

        {/* Sekmeler */}
        <div role="tablist" className="px-6 border-b bg-muted/20 flex items-center gap-1">
          {([
            { id: 'overview' as Tab, label: 'Genel Bakış', icon: Icons.server },
            { id: 'dhcp' as Tab, label: 'DHCP', icon: Icons.router },
            { id: 'firewall' as Tab, label: 'Güvenlik Duvarı', icon: Icons.shieldCheck },
            { id: 'pki' as Tab, label: 'Sertifika', icon: Icons.key },
            { id: 'logs' as Tab, label: 'Loglar', icon: Icons.post },
          ]).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-t-sm ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" /> {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-6">
              <SkeletonBlock className="h-14 w-full" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SkeletonBlock className="h-20" />
                <SkeletonBlock className="h-20" />
                <SkeletonBlock className="h-20" />
              </div>
              <TableSkeleton rows={3} cols={4} />
            </div>
          ) : error || !device ? (
            <div className="py-8 text-center text-destructive">
              Cihaz detayları alınırken bir hata oluştu.
            </div>
          ) : activeTab === 'dhcp' ? (
            <div className="space-y-4">
              <div className="p-4 bg-muted/20 border rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold">DHCP Sunucusu</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Bu şubenin yerel ağında IP dağıtımını aç/kapat</div>
                </div>
                <button
                  onClick={() => dhcpMutation.mutate(!(device.dhcp_enabled !== false))}
                  disabled={dhcpMutation.isPending}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    device.dhcp_enabled !== false
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20'
                      : 'bg-muted text-muted-foreground border hover:bg-muted/70'
                  }`}
                >
                  {dhcpMutation.isPending ? 'Uygulanıyor...' : device.dhcp_enabled !== false ? '● Açık' : '○ Kapalı'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-muted/30 border rounded-xl">
                  <div className="text-xs text-muted-foreground mb-1">Yerel LAN Alt Ağı</div>
                  <div className="text-sm font-bold font-mono">{device.lan_subnet || 'Atanmadı'}</div>
                </div>
                <div className="p-4 bg-muted/30 border rounded-xl">
                  <div className="text-xs text-muted-foreground mb-1">Gateway</div>
                  <div className="text-sm font-bold font-mono">{device.lan_gateway || 'Atanmadı'}</div>
                </div>
                <div className="p-4 bg-muted/30 border rounded-xl">
                  <div className="text-xs text-muted-foreground mb-1">Grup / Bölge</div>
                  <div className="text-sm font-bold">{device.group || 'Genel'}</div>
                </div>
                <div className="p-4 bg-muted/30 border rounded-xl">
                  <div className="text-xs text-muted-foreground mb-1">Bağlı LAN İstemcisi</div>
                  <div className="text-sm font-bold">{device.lan_client_count ?? 0} cihaz</div>
                </div>
              </div>

              <a
                href="/dashboard/dhcp"
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1.5"
              >
                <Icons.network className="w-3.5 h-3.5" /> Grup/alt-ağ ataması veya toplu dağıtım için DHCP paneline git →
              </a>
            </div>
          ) : activeTab === 'firewall' ? (
            <div className="space-y-4">
              <div className="p-4 bg-muted/20 border rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold">İnternet Çıkışı (WAN Kilidi)</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Kilitlenirse şube tüm dış internet erişimini kaybeder, sadece tünel/yönetim trafiği devam eder</div>
                </div>
                <button
                  onClick={() => wanLockMutation.mutate(!device.is_wan_locked_hw)}
                  disabled={wanLockMutation.isPending}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    device.is_wan_locked_hw
                      ? 'bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20'
                      : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20'
                  }`}
                >
                  {wanLockMutation.isPending ? 'Uygulanıyor...' : device.is_wan_locked_hw ? (<><Icons.lock className="w-3.5 h-3.5" /> Kilitli</>) : (<><Icons.unlock className="w-3.5 h-3.5" /> Açık</>)}
                </button>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Icons.shieldCheck className="w-4 h-4 text-primary" /> Erişim Kontrolü (NAC) — Bu Şubedeki Cihazlar
                </h3>
                {nacLoading ? (
                  <TableSkeleton rows={3} cols={3} />
                ) : !nacData?.results?.length ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">Bu şubede henüz tanımlı bir NAC kuralı yok.</div>
                ) : (
                  <div className="border rounded-xl overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                        <tr>
                          <th className="px-4 py-2.5">MAC / IP</th>
                          <th className="px-4 py-2.5">Rol</th>
                          <th className="px-4 py-2.5">Durum</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {nacData.results.map((rule) => (
                          <tr key={rule.id} className="hover:bg-muted/20">
                            <td className="px-4 py-2 font-mono">
                              <div>{rule.mac_address}</div>
                              {rule.ip_address && <div className="text-muted-foreground text-[10px]">{rule.ip_address}</div>}
                            </td>
                            <td className="px-4 py-2">{rule.hostname || rule.role}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                rule.status === 'blocked' ? 'bg-destructive/10 text-destructive' :
                                rule.status === 'quarantine' ? 'bg-amber-500/10 text-amber-500' :
                                'bg-emerald-500/10 text-emerald-500'
                              }`}>{rule.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <a
                href="/dashboard/firewall"
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1.5"
              >
                <Icons.shieldCheck className="w-3.5 h-3.5" /> Kural düzenleme ve şablonlar için Güvenlik Duvarı paneline git →
              </a>
            </div>
          ) : activeTab === 'pki' ? (
            <div className="space-y-3">
              {certsLoading ? (
                <TableSkeleton rows={3} cols={4} />
              ) : (() => {
                  const deviceCerts = (certsData?.results || []).filter(
                    (c) => c.id === `cert-${deviceId}` || String((c as any).device_id) === deviceId
                  );
                  return deviceCerts.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">Bu şube için tanımlı bir sertifika bulunamadı.</div>
                  ) : (
                    <div className="border rounded-xl overflow-hidden">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                          <tr>
                            <th className="px-4 py-2.5">Ad</th>
                            <th className="px-4 py-2.5">Ortak Ad (CN)</th>
                            <th className="px-4 py-2.5">Seri No</th>
                            <th className="px-4 py-2.5">Durum</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {deviceCerts.map((c) => (
                            <tr key={c.id} className="hover:bg-muted/20">
                              <td className="px-4 py-2 font-bold flex items-center gap-1.5"><Icons.key className="w-3.5 h-3.5 text-primary" /> {c.name}</td>
                              <td className="px-4 py-2 font-mono text-muted-foreground">{c.common_name}</td>
                              <td className="px-4 py-2 font-mono">{c.serial_number}</td>
                              <td className="px-4 py-2">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  c.is_valid || c.status === 'valid' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-destructive/10 text-destructive'
                                }`}>{c.status || (c.is_valid ? 'valid' : 'unknown')}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              <a
                href="/dashboard/pki"
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1.5"
              >
                <Icons.key className="w-3.5 h-3.5" /> Sertifika yönetimi (yenileme/iptal) için PKI paneline git →
              </a>
            </div>
          ) : activeTab === 'logs' ? (
            <div className="space-y-3">
              {logsLoading ? (
                <TableSkeleton rows={4} cols={5} />
              ) : !logsData?.results?.length ? (
                <div className="py-8 text-center text-xs text-muted-foreground">Bu şube için henüz kaydedilmiş bir güvenlik olayı yok.</div>
              ) : (
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                      <tr>
                        <th className="px-4 py-2.5">Zaman</th>
                        <th className="px-4 py-2.5">Tür</th>
                        <th className="px-4 py-2.5">Kaynak IP</th>
                        <th className="px-4 py-2.5">Alan Adı / Hedef</th>
                        <th className="px-4 py-2.5">Önem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {logsData.results.map((ev: any, idx: number) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="px-4 py-2 font-mono text-muted-foreground">
                            {ev.timestamp ? new Date(ev.timestamp * 1000).toLocaleTimeString('tr-TR') : '-'}
                          </td>
                          <td className="px-4 py-2 font-semibold">{ev.event_type}</td>
                          <td className="px-4 py-2 font-mono">{ev.src_ip}</td>
                          <td className="px-4 py-2 font-mono text-muted-foreground truncate max-w-[220px]">{ev.domain_query || ev.dst_ip}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              ev.severity === 'CRITICAL' ? 'bg-destructive/10 text-destructive' :
                              ev.severity === 'WARN' ? 'bg-amber-500/10 text-amber-500' :
                              'bg-muted text-muted-foreground'
                            }`}>{ev.severity}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Basic Info Bar */}
              <div className="p-4 bg-muted/20 border rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Icons.network className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted-foreground">Donanım Modeli:</span>
                  <span className="text-xs font-bold font-mono">{device.model || 'Bilinmiyor'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Icons.shieldCheck className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs text-muted-foreground">Bağlantı Durumu:</span>
                  <span className="text-xs font-bold text-emerald-500 font-sans uppercase">
                    {device.status === 'online' ? 'Çevrimiçi' : device.status === 'problem' ? 'Dikkat' : 'Çevrimdışı'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Agent Sürümü:</span>
                  <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    {device.agent_version ? `v${device.agent_version}` : 'Bilinmiyor'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">OTA Kümesi:</span>
                  <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                    {device.ota_cohort === 'CANARY_5' ? '🛡️ %5 Kanarya' : device.ota_cohort === 'PILOT_25' ? '🚀 %20 Pilot' : '🌐 %100 Genel'}
                  </span>
                </div>
                {!!device.active_camera_sessions && (
                  <div className="flex items-center gap-2">
                    <Icons.video className="w-4 h-4 text-amber-500" />
                    <span className="text-xs text-muted-foreground">Kamera Akışı:</span>
                    <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                      {device.active_camera_sessions} aktif oturum
                    </span>
                  </div>
                )}

              </div>


              {/* Summary Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-muted/30 border rounded-xl space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Icons.cpu className="w-4 h-4 text-emerald-500" /> İşlemci & Mimarisi
                  </div>
                  <div className="text-sm font-bold">{device.cpu_architecture}</div>
                  <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden mt-2">
                    <div
                      className="bg-emerald-500 h-full transition-all duration-300"
                      style={{ width: `${device.cpu_usage_pct}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-muted-foreground text-right font-mono tabular-nums">% {device.cpu_usage_pct} Yük</div>
                </div>

                <div className="p-4 bg-muted/30 border rounded-xl space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Icons.hardDrive className="w-4 h-4 text-sky-500" /> RAM
                  </div>
                  <div className="text-sm font-bold">{device.ram_total}</div>
                  <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden mt-2">
                    <div
                      className="bg-sky-500 h-full transition-all duration-300"
                      style={{ width: `${device.ram_usage_pct}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-muted-foreground text-right font-mono tabular-nums">% {device.ram_usage_pct} Kullanım</div>
                </div>

                <div className="p-4 bg-muted/30 border rounded-xl space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Icons.activity className="w-4 h-4 text-primary" /> Çalışma Süresi (Uptime)
                  </div>
                  <div className="text-sm font-bold font-mono tabular-nums">{formatUptime(device.uptime_seconds || 0, device.status === 'online')}</div>
                  <div className="text-xs text-muted-foreground mt-2 font-mono">FW: {device.firmware}</div>
                </div>
              </div>

              {/* Interfaces Table */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Icons.wifi className="w-4 h-4 text-primary" /> Ağ Arayüzleri (Interfaces)
                </h3>
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                      <tr>
                        <th className="px-4 py-2.5">Arayüz</th>
                        <th className="px-4 py-2.5">Tip</th>
                        <th className="px-4 py-2.5">IP Adresi</th>
                        <th className="px-4 py-2.5">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-mono">
                      {device.interfaces?.map((iface: any, idx: number) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="px-4 py-2 font-bold text-primary">{iface.name}</td>
                          <td className="px-4 py-2 text-muted-foreground uppercase text-[10px] font-sans font-bold">{iface.type}</td>
                          <td className="px-4 py-2">{iface.ip}</td>
                          <td className="px-4 py-2">
                            {iface.status === 'up' ? (
                              <span className="text-emerald-500 font-bold uppercase text-[10px] flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> UP
                              </span>
                            ) : (
                              <span className="text-muted-foreground uppercase text-[10px] flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" /> DOWN
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Services Table */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Icons.activity className="w-4 h-4 text-primary" /> Sistem Servisleri (Daemons)
                </h3>
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                      <tr>
                        <th className="px-4 py-2.5">Servis Adı</th>
                        <th className="px-4 py-2.5">Versiyon</th>
                        <th className="px-4 py-2.5">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {device.services?.map((svc: any, idx: number) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="px-4 py-2 font-bold">{svc.name}</td>
                          <td className="px-4 py-2 font-mono text-muted-foreground">{svc.version || '-'}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-sans font-medium ${
                              svc.status === 'active' 
                                ? 'bg-emerald-500/10 text-emerald-500' 
                                : 'bg-destructive/10 text-destructive'
                            }`}>
                              {svc.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-muted/40 flex items-center justify-between">
          <a
            href="/dashboard/dhcp"
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1.5"
          >
            <Icons.network className="w-3.5 h-3.5" /> Şube DHCP & MAC Yönetimi Paneline Git →
          </a>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
