'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchDevices,
  fetchStats,
  fetchTemplates,
  fetchSubnets,
  fetchCertificates
} from '@/lib/api';
import {
  Building2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ShieldCheck,
  Network,
  Key,
  Layers,
  RefreshCw,
  Activity
} from 'lucide-react';
import Link from 'next/link';

type TelemetryPoint = {
  time: string;
  total_wan_rx: string;
  total_wan_tx: string;
  avg_rtt: string;
  avg_loss: string;
};

// Gerçek zaman serisi WAN trafiği - iki seri (RX/TX), sabit renk sırası (kategorik
// kural: renk kimliğe göre atanır, asla sıraya göre döngülenmez), 2px çizgi,
// dolgular arası yüzey boşluğu.
function WanTrafficChart({ data }: { data: TelemetryPoint[] }) {
  const w = 100;
  const h = 100;
  if (data.length < 2) {
    return (
      <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
        Henüz yeterli telemetri örneği yok
      </div>
    );
  }
  const rx = data.map((d) => Number(d.total_wan_rx));
  const tx = data.map((d) => Number(d.total_wan_tx));
  const max = Math.max(...rx, ...tx, 0.5);
  const toPath = (series: number[]) =>
    series
      .map((v, i) => {
        const x = (i / (series.length - 1)) * w;
        const y = h - (v / max) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

  const stepLabels = data.filter((_, i) => i % Math.ceil(data.length / 6) === 0);

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-[160px]">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={w} y1={h * f} y2={h * f} stroke="currentColor" className="text-border" strokeWidth={0.3} />
        ))}
        <path d={toPath(rx)} fill="none" stroke="#0ea5e9" strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={toPath(tx)} fill="none" stroke="#8b5cf6" strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground font-mono">
        {stepLabels.map((d, i) => (
          <span key={i}>{d.time}</span>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px]">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> RX (Mbps)
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> TX (Mbps)
        </span>
      </div>
    </div>
  );
}

// Yoğun KPI satırı: kart-içinde-kart yerine düz bir sol kenarlıkla ayrılan
// satır öğesi. Aynı "border+shadow+beyaz kutu" deseninin sayfada tekrar tekrar
// kullanılmasını önlemek için burada kart yerine yatay bir liste hücresi var -
// büyük trafik grafiğiyle görsel olarak birbirine karışmıyor.
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

export default function OverViewPage() {
  const { data: deviceData, isLoading: devicesLoading } = useQuery({
    queryKey: ['overview-devices'],
    queryFn: () => fetchDevices({ page: 1, page_size: 200 }),
    refetchInterval: 30000
  });

  const { data: templateData } = useQuery({
    queryKey: ['overview-templates'],
    queryFn: fetchTemplates
  });

  const { data: subnetData } = useQuery({
    queryKey: ['overview-subnets'],
    queryFn: fetchSubnets
  });

  const { data: certData } = useQuery({
    queryKey: ['overview-certs'],
    queryFn: fetchCertificates
  });

  const { data: statsData } = useQuery({
    queryKey: ['overview-stats'],
    queryFn: fetchStats,
    refetchInterval: 30000
  });

  // Gerçek WAN trafiği zaman serisi - fix'lenmiş /api/telemetry (delta-bazlı Mbps)
  const { data: telemetryData } = useQuery<TelemetryPoint[]>({
    queryKey: ['overview-telemetry'],
    queryFn: async () => {
      const res = await fetch('/api/telemetry?range=1h', { cache: 'no-store' });
      if (!res.ok) return [];
      const json = await res.json();
      return json.results || [];
    },
    refetchInterval: 15000
  });

  const devices = deviceData?.results || [];
  const totalDevices = statsData?.total ?? deviceData?.count ?? 0;
  const onlineCount = statsData?.online ?? 0;
  const offlineCount = statsData?.offline ?? 0;
  const problemCount = statsData?.problem ?? 0;

  const templateCount = templateData?.count || 0;
  const subnetCount = subnetData?.count || 0;
  const certCount = certData?.results?.length || certData?.count || 0;

  const headerAction = devicesLoading ? (
    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Yükleniyor
    </span>
  ) : (
    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Sistem aktif
    </span>
  );

  return (
    <PageContainer
      pageTitle="SD-WAN Kontrol Paneli"
      pageDescription="Tüm şube ağ cihazları, politikalar ve güvenlik sertifikalarının anlık durumu"
      pageHeaderAction={headerAction}
    >
      <div className="flex flex-1 flex-col gap-5">
        {/* Ana panel: geniş trafik grafiği + yanında yoğun durum listesi.
            Eşit dört/üç sütunlu kart tekrarı yerine tek bir asimetrik blok -
            grafik dikkat çeker, durumlar yan tarafta ikincil bir liste olarak kalır. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
          <div className="p-5 bg-card border rounded-2xl">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Şube geneli WAN trafiği
              </h3>
              <span className="text-[10px] text-muted-foreground font-mono">son 1 saat</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">Tüm uç noktalardan hub üzerine akan toplam tünel trafiği, Mbps</p>
            <WanTrafficChart data={telemetryData || []} />
          </div>

          <div className="bg-card border rounded-2xl p-5 flex flex-col">
            <h3 className="text-sm font-semibold mb-1">Filo durumu</h3>
            <div className="divide-y divide-border/60">
              <KpiRow
                label="Toplam şube"
                value={devicesLoading ? '···' : totalDevices}
                caption="kayıtlı cihaz"
                accent="primary"
                icon={Building2}
                href="/dashboard/fleet"
              />
              <KpiRow
                label="Çevrimiçi"
                value={devicesLoading ? '···' : onlineCount}
                caption="merkeze bağlı"
                accent="emerald"
                icon={CheckCircle2}
              />
              <KpiRow
                label="Çevrimdışı"
                value={devicesLoading ? '···' : offlineCount}
                caption="bağlantı kesilmiş"
                accent="destructive"
                icon={XCircle}
              />
              <KpiRow
                label="Dikkat gerektiren"
                value={devicesLoading ? '···' : problemCount}
                caption="müdahale gerekli"
                accent="amber"
                icon={AlertCircle}
              />
            </div>

            <h3 className="text-sm font-semibold mt-4 mb-1 pt-4 border-t">Yapılandırma</h3>
            <div className="divide-y divide-border/60">
              <KpiRow
                label="Ağ politikaları"
                value={templateCount}
                caption="aktif şablon"
                accent="primary"
                icon={Layers}
                href="/dashboard/templates"
              />
              <KpiRow
                label="IP & subnet planları"
                value={subnetCount}
                caption="tanımlı blok"
                accent="primary"
                icon={Network}
                href="/dashboard/ipam"
              />
              <KpiRow
                label="Güvenlik sertifikaları"
                value={certCount}
                caption="ihraç edilmiş"
                accent="emerald"
                icon={Key}
                href="/dashboard/pki"
              />
            </div>
          </div>
        </div>

        {/* Son eklenen şubeler */}
        <div className="bg-card border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" /> Son eklenen şubeler
            </h3>
            <Link href="/dashboard/fleet" className="text-xs text-primary hover:underline font-medium">
              Tümünü gör →
            </Link>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Şube adı</th>
                  <th className="py-3 px-4">MAC adresi</th>
                  <th className="py-3 px-4">IP adresi</th>
                  <th className="py-3 px-4">Durum</th>
                  <th className="py-3 px-4">Kayıt tarihi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {devicesLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} aria-label="Yükleniyor">
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j} className="py-3 px-4">
                          <Skeleton className="h-3" style={{ width: j === 0 ? '70%' : '50%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-muted-foreground">
                      Henüz kayıtlı şube yok. Yeni bir cihazı{' '}
                      <Link href="/dashboard/fleet" className="text-primary hover:underline font-medium">
                        filo sayfasından
                      </Link>{' '}
                      kaydedebilirsiniz.
                    </td>
                  </tr>
                ) : (
                  devices.slice(0, 8).map((d) => (
                    <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-medium">{d.name}</td>
                      <td className="py-3 px-4 font-mono">{d.mac_address}</td>
                      <td className="py-3 px-4 font-mono text-muted-foreground">{d.ip_address || d.last_ip || 'henüz atanmadı'}</td>
                      <td className="py-3 px-4">
                        <span className="flex items-center gap-1.5 w-fit text-[11px] font-medium">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              d.status === 'online' ? 'bg-emerald-500' : d.status === 'problem' ? 'bg-amber-500' : 'bg-destructive'
                            }`}
                          />
                          {d.status === 'online' ? 'çevrimiçi' : d.status === 'problem' ? 'dikkat' : 'çevrimdışı'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground">
                        {d.created ? new Date(d.created).toLocaleDateString('tr-TR') : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
