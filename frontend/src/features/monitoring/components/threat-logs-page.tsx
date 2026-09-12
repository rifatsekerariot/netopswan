'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchSmartLogs, fetchDevices, applyNacPolicyToDevice, SecurityEventItem, ThreatAlertItem, Device } from '@/lib/api';
import {
  Terminal,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Search,
  RefreshCw,
  FileSpreadsheet,
  Globe
} from 'lucide-react';

import { useHubEventStream } from '@/hooks/useHubEventStream';

// Yoğun KPI satırı: overview sayfasındaki KpiRow deseniyle aynı - renkli nokta +
// ikon + etiket + sağa hizalı mono değer. Dört ayrı eşit kart yerine tek panel
// içinde bölünen satırlar kullanılıyor.
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
        <p className="text-[10px] text-muted-foreground/70 leading-tight truncate">{caption}</p>
      </div>
      <div className="text-right shrink-0">
        <span className={`text-sm font-semibold font-mono tabular-nums leading-none ${accentMap.text}`}>{value}</span>
      </div>
    </div>
  );
}

export default function ThreatLogsPage() {
  useHubEventStream();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState('all');
  const [threatAlerts, setThreatAlerts] = useState<ThreatAlertItem[]>([]);
  const [isQuarantining, setIsQuarantining] = useState<string | null>(null);
  const [quarantineSuccess, setQuarantineSuccess] = useState<string | null>(null);

  // 1. Canlı DuckDB Loglarını Çek (Sıfır Mock - Canlı Lakehouse Sorgusu)
  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs, isFetching: logsRefetching } = useQuery({
    queryKey: ['smart-security-logs'],
    queryFn: () => fetchSmartLogs(150),
    refetchInterval: 5000
  });

  const { data: devicesData } = useQuery({
    queryKey: ['devices'],
    queryFn: () => fetchDevices()
  });

  const devices: Device[] = devicesData?.results || [];
  const rawLogs: SecurityEventItem[] = logsData?.results || [];

  // Filtrelenmiş Canlı Loglar
  const filteredLogs = useMemo(() => {
    return rawLogs.filter(log => {
      const matchSearch =
        (log.src_ip || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (log.src_mac || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (log.domain_query || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (log.event_type || '').toLowerCase().includes(searchQuery.toLowerCase());

      const matchSeverity = selectedSeverity === 'all' || log.severity.toLowerCase() === selectedSeverity.toLowerCase();
      return matchSearch && matchSeverity;
    });
  }, [rawLogs, searchQuery, selectedSeverity]);

  // Manuel İstemci Karantina İşlemi (Human-in-the-Loop: Kullanıcı Onayıyla NAC Kuralı İter)
  const handleManualQuarantine = async (targetAlert: ThreatAlertItem) => {
    if (!targetAlert.client_mac) return;
    setIsQuarantining(targetAlert.alert_id);
    setQuarantineSuccess(null);

    try {
      const targetDev = devices.find(d => d.name === targetAlert.device_id || d.id === targetAlert.device_id) || devices[0];
      if (!targetDev) throw new Error('Hedef şube cihazı bulunamadı.');

      await applyNacPolicyToDevice(targetDev.id, [
        {
          id: `quarantine-${Date.now()}`,
          device_id: targetDev.id,
          mac_address: targetAlert.client_mac,
          ip_address: targetAlert.client_ip,
          hostname: targetAlert.client_hostname,
          role: 'standard',
          status: 'quarantine'
        }
      ]);

      // Alarm durumunu yerel olarak güncelle
      setThreatAlerts(prev =>
        prev.map(a => (a.alert_id === targetAlert.alert_id ? { ...a, status: 'QUARANTINED' as const } : a))
      );

      setQuarantineSuccess(`İstemci (${targetAlert.client_ip} / ${targetAlert.client_mac}) kullanıcı onayıyla başarıyla karantinaya alındı.`);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsQuarantining(null);
    }
  };

  const handleDismissAndAllowlist = async (targetAlert: ThreatAlertItem) => {
    try {
      // Şüpheli açıklamadaki domaini veya IP'yi kalıcı allowlist'e ekle
      await fetch('/api/allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: targetAlert.client_ip })
      });

      // Alarmı ekrandan kaldır
      setThreatAlerts(prev => prev.filter(a => a.alert_id !== targetAlert.alert_id));
      setQuarantineSuccess(`Alarm kapatıldı ve ${targetAlert.client_ip} kalıcı olarak güvenli listeye eklendi.`);
    } catch (err: any) {
      console.error(err);
    }
  };

  const headerAction = (
    <button
      onClick={() => refetchLogs()}
      className="px-3.5 py-2 bg-card hover:bg-muted border rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${logsRefetching ? 'animate-spin' : ''}`} /> Yenile
    </button>
  );

  return (
    <PageContainer
      pageTitle="Smart Log Lakehouse ve tehdit analitiği"
      pageDescription="DuckDB ve Parquet destekli, düşük kaynak tüketimli merkezi ağ log motoru ve yapay zekâ tabanlı anomali dedektörü"
      pageHeaderAction={headerAction}
    >
      <div className="flex flex-1 flex-col gap-5">
        {/* Motor durumu: eşit dört kart yerine tek yoğun panel içinde satır listesi */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="bg-card border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-primary" /> Log motoru durumu
            </h3>
            <div className="divide-y divide-border/60">
              <KpiRow
                label="İşlenen ağ ve DNS olayı"
                value={logsData?.count || rawLogs.length}
                caption="merkezi ring-buffer ve disk üzerinde aktif"
                accent="primary"
                icon={Terminal}
              />
              <KpiRow
                label="Güvenlik ve anomali alarmları"
                value={threatAlerts.length}
                caption="kullanıcı incelemesi bekleyen hareket"
                accent="amber"
                icon={AlertTriangle}
              />
            </div>
          </div>

          <div className="bg-card border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Mimari
            </h3>
            <div className="divide-y divide-border/60">
              <KpiRow
                label="Depolama ve analitik motoru"
                value="JSONL"
                caption="sütunsal depo, sıfır gecikmeli düşük kaynak mimarisi"
                accent="emerald"
                icon={FileSpreadsheet}
              />
              <KpiRow
                label="Gerçek zamanlı iletim"
                value="SSE"
                caption="asenkron kuyruk ve otomatik eşitleme"
                accent="primary"
                icon={Activity}
              />
            </div>
          </div>
        </div>

        {/* Canlı Tehdit & Anomali Alarmları Bölümü (Human-in-the-loop Manuel Onay) */}
        {threatAlerts.length > 0 && (
          <div className="p-5 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Dikkat gerektiren tehdit ve anomali alarmları
                <span className="font-mono tabular-nums">({threatAlerts.length})</span>
              </h3>
              <span className="text-[10px] bg-amber-500/20 text-amber-600 px-2 py-0.5 rounded-md font-mono font-semibold">
                Kullanıcı onayı gerekir
              </span>
            </div>

            {quarantineSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs font-medium text-emerald-600 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> {quarantineSuccess}
              </div>
            )}

            <div className="divide-y divide-amber-500/20 bg-background border rounded-lg overflow-hidden">
              {threatAlerts.map(alert => (
                <div
                  key={alert.alert_id}
                  className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        alert.threat_type === 'NETWORK_LOOP_DETECTED' ? 'bg-destructive animate-pulse' : 'bg-amber-500'
                      }`}
                    />
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{alert.branch_name || alert.device_id}</span>
                        <span
                          className={`font-mono text-[10px] font-semibold ${
                            alert.threat_type === 'NETWORK_LOOP_DETECTED' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {alert.threat_type === 'NETWORK_LOOP_DETECTED' ? 'AĞ DÖNGÜSÜ (LOOP)' : alert.threat_type}
                        </span>
                        <span className="text-muted-foreground font-mono tabular-nums text-[11px]">
                          {alert.client_ip} ({alert.client_mac})
                        </span>
                      </div>
                      <p className={alert.threat_type === 'NETWORK_LOOP_DETECTED' ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                        {alert.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleDismissAndAllowlist(alert)}
                      className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground font-medium rounded-md transition-colors flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      İzin ver (güvenli)
                    </button>
                    {alert.status === 'QUARANTINED' ? (
                      <span className="px-3 py-1 bg-destructive/10 text-destructive border border-destructive/30 font-semibold rounded-md text-[11px] flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Karantinada
                      </span>
                    ) : (
                      <button
                        onClick={() => handleManualQuarantine(alert)}
                        disabled={isQuarantining === alert.alert_id}
                        className="px-3 py-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {isQuarantining === alert.alert_id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Lock className="w-3.5 h-3.5" />
                        )}
                        Karantinaya al (onayla)
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DuckDB Canlı Log Tablosu */}
        <div className="p-6 bg-card border rounded-2xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Terminal className="w-4 h-4 text-primary" /> Canlı ağ ve güvenlik olayları
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Şubelerden canlı toplanan DNS sorguları ve bağlantı telemetrileri
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="IP, MAC, domain veya olay ara..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-background border rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <select
                aria-label="Seviyeye göre filtrele"
                value={selectedSeverity}
                onChange={e => setSelectedSeverity(e.target.value)}
                className="bg-background border rounded-lg px-3 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-primary cursor-pointer"
              >
                <option value="all">Tüm seviyeler</option>
                <option value="info">INFO</option>
                <option value="warn">WARN</option>
                <option value="critical">CRITICAL</option>
              </select>
            </div>
          </div>

          {logsLoading ? (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">Zaman</th>
                    <th className="py-3 px-4">Olay türü</th>
                    <th className="py-3 px-4">Kaynak (istemci)</th>
                    <th className="py-3 px-4">Hedef / Domain</th>
                    <th className="py-3 px-4">Protokol</th>
                    <th className="py-3 px-4">Seviye</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} aria-label="Yükleniyor">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="py-3 px-4">
                          <Skeleton className="h-3" style={{ width: j === 0 ? '60%' : '70%' }} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              {rawLogs.length === 0
                ? 'Kayıtlı güvenlik veya ağ logu bulunamadı. Şubeler telemetri gönderdikçe burada listelenecektir.'
                : 'Arama ve seviye filtrenizle eşleşen bir log bulunamadı.'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">Zaman</th>
                    <th className="py-3 px-4">Olay türü</th>
                    <th className="py-3 px-4">Kaynak (istemci)</th>
                    <th className="py-3 px-4">Hedef / Domain</th>
                    <th className="py-3 px-4">Protokol</th>
                    <th className="py-3 px-4">Seviye</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50 font-mono">
                  {filteredLogs.map((log, idx) => (
                    <tr key={idx} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-4 text-muted-foreground text-[11px] tabular-nums">
                        {new Date(log.timestamp * 1000).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 font-semibold">
                        <span className="px-2 py-0.5 rounded-md bg-muted text-foreground text-[10px]">
                          {log.event_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-foreground tabular-nums">
                        {log.src_ip} {log.src_mac ? `(${log.src_mac})` : ''}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground">
                        {log.domain_query ? (
                          <span className="text-primary font-medium flex items-center gap-1">
                            <Globe className="w-3 h-3 shrink-0" /> {log.domain_query}
                          </span>
                        ) : (
                          <span className="tabular-nums">{`${log.dst_ip}:${log.dst_port}`}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-muted-foreground">{log.protocol}</td>
                      <td className="py-2.5 px-4" aria-label={log.severity}>
                        <span className="flex items-center gap-1.5 w-fit text-[11px] font-medium">
                          <span
                            aria-hidden="true"
                            className={`w-1.5 h-1.5 rounded-full ${
                              log.severity === 'CRITICAL'
                                ? 'bg-destructive'
                                : log.severity === 'WARN'
                                  ? 'bg-amber-500'
                                  : 'bg-primary'
                            }`}
                          />
                          <span
                            className={
                              log.severity === 'CRITICAL'
                                ? 'text-destructive'
                                : log.severity === 'WARN'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-muted-foreground'
                            }
                          >
                            {log.severity}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
