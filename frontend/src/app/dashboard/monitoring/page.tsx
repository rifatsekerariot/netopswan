'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDeviceGroups, fetchDevices, calculateDeviceStatus, Device } from '@/lib/api';
import {
  Activity,
  Wifi,
  Zap,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Layers,
  Filter,
  Cpu,
  Globe,
  Radio,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Gauge
} from 'lucide-react';
import Link from 'next/link';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend
} from 'recharts';

// Yoğun KPI satırı: kart-içinde-kart yerine düz bir liste hücresi - overview
// sayfasındaki KpiRow ile aynı desen, "border+shadow+beyaz kutu" tekrarını önler.
function KpiRow({
  label,
  value,
  caption,
  accent,
  icon: Icon,
  href
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  accent: 'primary' | 'emerald' | 'destructive' | 'amber';
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
}) {
  const accentMap = {
    primary: { text: 'text-primary', dot: 'bg-primary' },
    emerald: { text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    destructive: { text: 'text-destructive', dot: 'bg-destructive' },
    amber: { text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' }
  }[accent];

  const content = (
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

  return href ? (
    <Link href={href} className="block hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors">
      {content}
    </Link>
  ) : (
    content
  );
}

export default function MonitoringPage() {
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedMetricView, setSelectedMetricView] = useState<'all' | 'traffic' | 'system'>('all');

  // Grupları çek
  const { data: groupsData } = useQuery({
    queryKey: ['monitoring-groups'],
    queryFn: fetchDeviceGroups
  });

  // Canlı şube cihazlarını ve telemetrilerini çek (10s polling)
  const { data: deviceData, isLoading: devicesLoading, refetch: refetchDevices } = useQuery({
    queryKey: ['monitoring-devices', selectedGroup],
    queryFn: () =>
      fetchDevices({
        page: 1,
        page_size: 200,
        group: selectedGroup !== 'all' ? selectedGroup : undefined
      }),
    refetchInterval: 10000
  });

  const devices: Device[] = deviceData?.results || [];
  const totalDevices = deviceData?.count || devices.length;

  // Cihaz durum dağılımı ve metrik hesaplama
  const { onlineDevices, offlineDevices, avgCpu, avgRtt, networkHealthScore } = useMemo(() => {
    const online: Device[] = [];
    const offline: Device[] = [];
    const problem: Device[] = [];
    let cpuSum = 0;
    let ramUsedSum = 0;
    let ramMaxSum = 0;
    let rttSum = 0;
    let rttCount = 0;

    for (const d of devices) {
      const status = calculateDeviceStatus(d);
      if (status === 'online') {
        online.push(d);
        cpuSum += d.cpu_usage_pct || 0;
        ramUsedSum += d.ram_used_mb || (d.ram_usage_pct ? d.ram_usage_pct * 20.48 : 0);
        ramMaxSum += d.ram_total_mb || 2048;
        if (d.rtt_ms && d.rtt_ms > 0) {
          rttSum += d.rtt_ms;
          rttCount++;
        }
      } else if (status === 'problem') {
        problem.push(d);
      } else {
        offline.push(d);
      }
    }

    const onlineCount = online.length;
    const calculatedAvgCpu = onlineCount > 0 ? Number((cpuSum / onlineCount).toFixed(1)) : 0;
    const calculatedAvgRtt = rttCount > 0 ? Number((rttSum / rttCount).toFixed(1)) : 0;

    // Global ağ sağlığı skoru (0-100 arası dinamik puanlama)
    let health = 100;
    if (devices.length > 0) {
      const availabilityPct = (onlineCount / devices.length) * 100;
      const cpuPenalty = Math.max(0, (calculatedAvgCpu - 70) * 0.5);
      const offlinePenalty = (offline.length / devices.length) * 60;
      const problemPenalty = (problem.length / devices.length) * 25;
      health = Math.max(0, Math.round(availabilityPct - cpuPenalty - offlinePenalty - problemPenalty));
    }

    return {
      onlineDevices: online,
      offlineDevices: offline,
      problemDevices: problem,
      avgCpu: calculatedAvgCpu,
      avgRam: ramMaxSum > 0 ? Number(((ramUsedSum / ramMaxSum) * 100).toFixed(1)) : 0,
      avgRtt: calculatedAvgRtt,
      networkHealthScore: devices.length === 0 ? 100 : health
    };
  }, [devices]);

  // 100% gerçek PostgreSQL telemetri zaman serisini çek
  const { data: telemetryData } = useQuery({
    queryKey: ['monitoring-telemetry-series'],
    queryFn: async () => {
      const res = await fetch('/api/telemetry?range=1h', { cache: 'no-store' });
      if (!res.ok) return [];
      const json = await res.json();
      return json.results || [];
    },
    refetchInterval: 10000
  });

  const chartData = useMemo(() => {
    if (telemetryData && telemetryData.length > 0) {
      return telemetryData;
    }
    // Canlı veritabanı henüz boşsa anlık aktif şubeler üzerinden ilk noktayı oluştur
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return [
      {
        time: nowTime,
        total_wan_rx: Number((onlineDevices.length * 0.1).toFixed(2)),
        total_wan_tx: Number((onlineDevices.length * 0.05).toFixed(2)),
        avg_rtt: avgRtt,
        avg_loss: 0
      }
    ];
  }, [telemetryData, onlineDevices, avgRtt]);

  const headerAction = devicesLoading ? (
    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Telemetri eşitleniyor
    </span>
  ) : (
    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
      <Radio className="w-3 h-3 text-emerald-500 animate-pulse" /> Canlı hub telemetrisi — {onlineDevices.length} / {totalDevices} şube aktif
    </span>
  );

  return (
    <PageContainer
      pageTitle="Ağ sağlığı ve canlı telemetri"
      pageDescription="Rust SD-WAN hub üzerinden yönetilen tüm şube cihazlarının kümelenmiş ağ sağlığı, donanım yükü ve canlı telemetri matrisi"
      pageHeaderAction={headerAction}
    >
      <div className="flex flex-1 flex-col gap-5">
        {/* Filtre & görünüm çubuğu */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-card border rounded-2xl">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-muted/40 border rounded-lg px-3 py-1.5">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="bg-transparent text-xs font-medium outline-none cursor-pointer"
                aria-label="Şube grubu filtrele"
              >
                <option value="all">Tüm şube grupları ({groupsData?.results?.length || 0})</option>
                {groupsData?.results?.map((g) => (
                  <option key={g.id} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-lg border text-xs">
              <button
                onClick={() => setSelectedMetricView('all')}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  selectedMetricView === 'all' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Genel bakış
              </button>
              <button
                onClick={() => setSelectedMetricView('traffic')}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  selectedMetricView === 'traffic' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Trafik ve uplink
              </button>
              <button
                onClick={() => setSelectedMetricView('system')}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  selectedMetricView === 'system' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Donanım ve bellek
              </button>
            </div>
          </div>

          <button
            onClick={() => refetchDevices()}
            className="p-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors border text-muted-foreground hover:text-foreground"
            title="Şimdi yenile"
            aria-label="Şimdi yenile"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Ağ sağlığı skoru + yoğun filo metrikleri: eşit kart tekrarı yerine
            overview'daki asimetrik grafik/liste bloğu deseni. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.4fr]">
          <div className="p-5 bg-card border rounded-2xl flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Gauge className={`w-4 h-4 ${networkHealthScore > 80 ? 'text-emerald-500' : networkHealthScore > 50 ? 'text-amber-500' : 'text-destructive'}`} />
                Ağ sağlığı skoru
              </h3>
            </div>
            <div className="mt-4">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold font-mono tabular-nums">{networkHealthScore}</span>
                <span className="text-xs text-muted-foreground">/ 100</span>
              </div>
              <div className="w-full bg-muted/60 h-1.5 rounded-full mt-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    networkHealthScore > 80 ? 'bg-emerald-500' : networkHealthScore > 50 ? 'bg-amber-500' : 'bg-destructive'
                  }`}
                  style={{ width: `${networkHealthScore}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Erişilebilirlik, CPU yükü ve kesinti oranına göre hesaplanan bileşik puan
              </p>
            </div>
          </div>

          <div className="bg-card border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-1">Filo metrikleri</h3>
            <div className="divide-y divide-border/60">
              <KpiRow
                label="Aktif tüneller"
                value={devicesLoading ? '···' : onlineDevices.length}
                caption={`/ ${totalDevices} şube`}
                accent="emerald"
                icon={CheckCircle2}
              />
              <KpiRow
                label="Kesintili şubeler"
                value={devicesLoading ? '···' : offlineDevices.length}
                caption="tünel kapalı"
                accent="destructive"
                icon={XCircle}
              />
              <KpiRow label="Ortalama gecikme" value={`${avgRtt} ms`} caption="canlı ICMP ping" accent="primary" icon={Zap} />
              <KpiRow label="Ortalama CPU yükü" value={`%${avgCpu}`} caption="donanım yükü" accent="amber" icon={Cpu} />
              <KpiRow
                label="Bağlı istemciler"
                value={devices.reduce((acc, d) => acc + (d.lan_client_count || 0), 0)}
                caption="DHCP & LAN"
                accent="primary"
                icon={Layers}
              />
            </div>
          </div>
        </div>

        {/* Çoklu cihaz canlı grafikler */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(selectedMetricView === 'all' || selectedMetricView === 'traffic') && (
            <div className="p-5 bg-card border rounded-2xl space-y-3 min-w-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-sky-500" /> Şube geneli agregasyonel WAN trafiği
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Tüm uç noktalardan hub üzerine akan toplam tünel trafiği, Mbps</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-mono">
                  <span className="flex items-center gap-1 text-sky-500">
                    <ArrowDownLeft className="w-3.5 h-3.5" /> İndirme
                  </span>
                  <span className="flex items-center gap-1 text-emerald-500">
                    <ArrowUpRight className="w-3.5 h-3.5" /> Yükleme
                  </span>
                </div>
              </div>

              <div className="h-64 w-full min-w-0" style={{ minHeight: '260px' }}>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }} />
                    <Area type="monotone" dataKey="total_wan_rx" stroke="#0ea5e9" strokeWidth={1.2} fillOpacity={1} fill="url(#colorRx)" name="Toplam download (Mbps)" />
                    <Area type="monotone" dataKey="total_wan_tx" stroke="#10b981" strokeWidth={1.2} fillOpacity={1} fill="url(#colorTx)" name="Toplam upload (Mbps)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {(selectedMetricView === 'all' || selectedMetricView === 'system') && (
            <div className="p-5 bg-card border rounded-2xl space-y-3 min-w-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-500" /> Çoklu şube CPU ve RAM karşılaştırması
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Her şubenin anlık donanım kaynak tüketimi, %</p>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 bg-muted rounded-md text-muted-foreground">canlı</span>
              </div>

              <div className="h-64 w-full min-w-0" style={{ minHeight: '260px' }}>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart
                    data={devices.map((d) => ({
                      name: d.name,
                      cpu: d.status === 'online' ? d.cpu_usage_pct || 0 : 0,
                      ram: d.status === 'online' ? d.ram_usage_pct || 0 : 0,
                      rtt: d.status === 'online' ? d.rtt_ms || 0 : 0
                    }))}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }} />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    <Bar dataKey="cpu" fill="#10b981" radius={[3, 3, 0, 0]} name="İşlemci yükü (%)" />
                    <Bar dataKey="ram" fill="#6366f1" radius={[3, 3, 0, 0]} name="Bellek kullanımı (%)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Çoklu şube donanım ve tünel telemetri matrisi */}
        <div className="bg-card border rounded-2xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" /> Çoklu şube donanım ve tünel telemetri matrisi
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Tüm şube ağ geçitlerinin anlık CPU, RAM, tünel IP, gecikme ve rota sağlık durumu</p>
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">Toplam {devices.length} uç nokta</div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Şube / cihaz</th>
                  <th className="py-3 px-4">Model & donanım</th>
                  <th className="py-3 px-4">Tünel (VIP) & LAN subnet</th>
                  <th className="py-3 px-4">WAN gateway</th>
                  <th className="py-3 px-4">CPU yükü</th>
                  <th className="py-3 px-4">RAM tüketimi</th>
                  <th className="py-3 px-4">Gecikme (RTT)</th>
                  <th className="py-3 px-4">Tünel durumu</th>
                  <th className="py-3 px-4">Son heartbeat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {devicesLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} aria-label="Yükleniyor">
                      {Array.from({ length: 9 }).map((__, j) => (
                        <td key={j} className="py-3 px-4">
                          <Skeleton className="h-3" style={{ width: j === 0 ? '80%' : '60%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-muted-foreground">
                      Bu grupta kayıtlı uç nokta yok. Yeni bir cihazı{' '}
                      <Link href="/dashboard/fleet" className="text-primary hover:underline font-medium">
                        filo sayfasından
                      </Link>{' '}
                      kaydedebilirsiniz.
                    </td>
                  </tr>
                ) : (
                  devices.map((d: any) => {
                    const status = calculateDeviceStatus(d);
                    const isOnline = status === 'online';
                    const cpu = isOnline ? d.cpu_usage_pct || 0 : 0;
                    const ramPct = isOnline ? d.ram_usage_pct || 0 : 0;
                    const ramUsed = isOnline ? d.ram_used_mb || 0 : 0;
                    const rtt = isOnline ? d.rtt_ms || 0 : 0;

                    return (
                      <tr key={d.id} className="hover:bg-muted/40 transition-colors">
                        {/* Şube adı */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                            <div>
                              <span className="font-medium text-foreground block">{d.name}</span>
                              <span className="text-[10px] font-mono text-muted-foreground">{d.mac_address}</span>
                            </div>
                          </div>
                        </td>

                        {/* Model */}
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 bg-muted rounded-md text-[11px] font-mono">{d.model || 'Cisco Meraki MX64'}</span>
                        </td>

                        {/* Tünel IP & LAN subnet */}
                        <td className="py-3 px-4 font-mono">
                          <div className="space-y-0.5">
                            <div className="text-primary font-medium flex items-center gap-1">
                              <Zap className="w-3 h-3" /> {d.last_ip || d.ip_address || '10.8.0.x'}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              LAN: {d.lan_subnet || `${d.lan_gateway?.split('.').slice(0, 3).join('.')}.0/24` || 'belirtilmedi'}
                            </div>
                          </div>
                        </td>

                        {/* WAN yönetim IP */}
                        <td className="py-3 px-4 font-mono text-muted-foreground">{d.management_ip || 'dinamik NAT'}</td>

                        {/* CPU çubuğu */}
                        <td className="py-3 px-4">
                          <div className="w-24 space-y-1">
                            <div className="flex justify-between text-[10px] font-mono tabular-nums">
                              <span>%{cpu.toFixed(1)}</span>
                            </div>
                            <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${cpu > 80 ? 'bg-destructive' : cpu > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(100, cpu)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* RAM çubuğu */}
                        <td className="py-3 px-4">
                          <div className="w-28 space-y-1">
                            <div className="flex justify-between text-[10px] font-mono tabular-nums">
                              <span>%{ramPct.toFixed(0)}</span>
                              <span className="text-muted-foreground text-[9px]">{ramUsed}M</span>
                            </div>
                            <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, ramPct)}%` }} />
                            </div>
                          </div>
                        </td>

                        {/* Gecikme RTT */}
                        <td className="py-3 px-4 font-mono tabular-nums">
                          {isOnline ? (
                            <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400 text-[11px] font-medium w-fit">
                              <Clock className="w-3 h-3" /> {rtt} ms
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-[11px]">-</span>
                          )}
                        </td>

                        {/* Durum */}
                        <td className="py-3 px-4">
                          {status === 'problem' ? (
                            <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 w-fit">
                              <AlertCircle className="w-3.5 h-3.5" /> Sınırlı
                            </span>
                          ) : status === 'online' ? (
                            <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 w-fit">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Tünel aktif
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-[11px] font-medium text-destructive w-fit">
                              <XCircle className="w-3.5 h-3.5" /> Çevrimdışı
                            </span>
                          )}
                        </td>

                        {/* Son görülme */}
                        <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground">
                          {d.modified || d.last_seen ? <span>{new Date(d.modified || d.last_seen).toLocaleTimeString('tr-TR')}</span> : 'N/A'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
