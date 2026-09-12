'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { fetchDevices, fetchCAs, fetchCertificates, createClientCertificate, revokeCertificate, Device, ClientCertificate, CertificateAuthority } from '@/lib/api';
import { ConfirmModal } from '@/components/ConfirmModal';

// Yoğun KPI satırı: overview sayfasındaki KpiRow deseniyle tutarlı, tek panel
// içinde ikonlu/mono değerli satır listesi - eşit büyüklükte kart tekrarı yok.
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

export default function PKIPage() {
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedCert, setSelectedCert] = useState<any | null>(null);

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

  // Form State
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [certName, setCertName] = useState('');
  const [certCn, setCertCn] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Fetch registered branches to auto-generate Common Name
  const { data: devicesData } = useQuery({
    queryKey: ['pki-devices'],
    queryFn: () => fetchDevices({ page: 1, page_size: 100 })
  });

  const devices: Device[] = devicesData?.results || [];

  const handleDeviceSelect = (devId: string) => {
    setSelectedDeviceId(devId);
    if (!devId) return;

    const dev = devices.find((d) => d.id === devId);
    if (dev) {
      const cleanBranchName = dev.name
        .toLowerCase()
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ı/g, 'i')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/[^a-z0-9]/g, '-');

      const ipSlug = dev.last_ip && dev.last_ip !== 'Henüz Atanmadı'
        ? dev.last_ip.replace(/[^0-9.]/g, '')
        : '';

      setCertName(`Sertifika — ${dev.name}`);
      setCertCn(ipSlug ? `branch-${cleanBranchName}-${ipSlug}.netopswan.local` : `branch-${cleanBranchName}.netopswan.local`);
    }
  };

  // Fetch CA from Central Controller API
  const { data: caData } = useQuery({
    queryKey: ['pki-ca'],
    queryFn: fetchCAs
  });

  // Fetch Certificates from Central Controller API
  const { data: certsData, isLoading } = useQuery({
    queryKey: ['pki-certs'],
    queryFn: fetchCertificates,
    refetchInterval: 30000
  });

  // Create Client Certificate Mutation
  const createCertMutation = useMutation({
    mutationFn: (data: { name: string; common_name: string }) =>
      createClientCertificate({
        name: data.name,
        common_name: data.common_name,
        ca_id: caData?.results?.[0]?.id || 1
      }),
    onSuccess: (newCert) => {
      queryClient.invalidateQueries({ queryKey: ['pki-certs'] });
      setIsAddModalOpen(false);
      setCertName('');
      setCertCn('');
      setAddError(null);
      setSelectedCert(newCert);
    },
    onError: (err: any) => {
      setAddError(err.message || 'Sertifika üretilirken hata oluştu.');
    }
  });

  // Revoke Certificate Mutation
  const revokeMutation = useMutation({
    mutationFn: (id: string | number) => revokeCertificate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pki-certs'] });
    }
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!certName || !certCn) {
      setAddError('Sertifika adı ve common name zorunludur.');
      return;
    }
    createCertMutation.mutate({ name: certName, common_name: certCn });
  };

  const handleRevoke = (id: string | number, name: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Sertifikayı iptal et (revoke / CRL)',
      description: (
        <span>
          <strong>{name}</strong> sertifikasını iptal etmek (CRL listesine eklemek) istediğinize emin misiniz? Bu sertifikayı kullanan cihazın VPN tüneli düşecektir.
        </span>
      ),
      confirmText: 'Sertifikayı iptal et',
      variant: 'danger',
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        revokeMutation.mutate(id);
      }
    });
  };

  const ca: CertificateAuthority | null = caData?.results?.[0] || null;
  const certs: ClientCertificate[] = certsData?.results || [];
  const revokedCount = certs.filter((c) => !c.is_valid || c.status === 'revoked').length;
  const validCount = certs.length - revokedCount;

  const headerAction = (
    <button
      onClick={() => setIsAddModalOpen(true)}
      className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2"
    >
      <Icons.add className="w-4 h-4" /> Yeni istemci sertifikası ihraç et
    </button>
  );

  return (
    <PageContainer
      pageTitle="Güvenlik ve sertifika yönetimi"
      pageDescription="Merkezi sertifika otoritesi (CA), istemci sertifikaları ve VPN anahtar yönetimi"
      pageHeaderAction={headerAction}
    >
      <div className="flex flex-1 flex-col gap-5">
        {/* Durum paneli: eşit dört kart tekrarı yerine tek panel içinde yoğun
            satır listesi - overview sayfasındaki KpiRow deseniyle tutarlı. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="bg-card border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Icons.shieldCheck className="w-4 h-4 text-emerald-500" /> Kök sertifika otoritesi
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3">Merkez CA yapılandırması ve zincir durumu</p>
            <div className="divide-y divide-border/60">
              <KpiRow
                label="Aktif CA otoritesi"
                value={ca ? ca.name : 'Merkez master CA'}
                caption={ca ? `${ca.key_length}-bit ${ca.digest}` : '2048-bit SHA256'}
                accent="emerald"
                icon={Icons.shieldCheck}
              />
              <KpiRow
                label="CA durumu"
                value={ca ? 'Aktif' : 'Yapılandırıldı'}
                caption="Root CA aktif (256-bit ECC)"
                accent="primary"
                icon={Icons.key}
              />
            </div>
          </div>

          <div className="bg-card border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Icons.key className="w-4 h-4 text-primary" /> Sertifika envanteri
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3">Sistemde kayıtlı istemci sertifikalarının özet durumu</p>
            <div className="divide-y divide-border/60">
              <KpiRow
                label="İhraç edilen sertifika"
                value={isLoading ? '···' : certs.length}
                caption="sistemde kayıtlı"
                accent="primary"
                icon={Icons.key}
              />
              <KpiRow
                label="Geçerli"
                value={isLoading ? '···' : validCount}
                caption="aktif kullanımda"
                accent="emerald"
                icon={Icons.check}
              />
              <KpiRow
                label="İptal edilen (revoked)"
                value={isLoading ? '···' : revokedCount}
                caption="CRL listesinde"
                accent="destructive"
                icon={Icons.lock}
              />
            </div>
          </div>
        </div>

        {/* Certificates Table */}
        <div className="bg-card border rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Icons.post className="w-4 h-4 text-primary" /> Mevcut sertifikalar ve anahtar çiftleri
          </h3>

          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">#ID</th>
                  <th className="py-3 px-4">Sertifika adı</th>
                  <th className="py-3 px-4">Common name (CN)</th>
                  <th className="py-3 px-4">Seri numarası</th>
                  <th className="py-3 px-4">Geçerlilik bitiş</th>
                  <th className="py-3 px-4">Durum</th>
                  <th className="py-3 px-4 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} aria-label="Yükleniyor">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="py-3.5 px-4">
                          <Skeleton className="h-3" style={{ width: j === 1 ? '80%' : '55%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : certs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      Merkez PKI veritabanında henüz sertifika bulunmuyor. Yukarıdaki{' '}
                      <button onClick={() => setIsAddModalOpen(true)} className="text-primary hover:underline font-medium">
                        yeni istemci sertifikası
                      </button>{' '}
                      butonuyla ilk sertifikayı ihraç edebilirsiniz.
                    </td>
                  </tr>
                ) : (
                  certs.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-3.5 px-4 font-mono tabular-nums text-muted-foreground">#{c.id}</td>
                      <td className="py-3.5 px-4 font-medium">{c.name}</td>
                      <td className="py-3.5 px-4 font-mono text-primary">{c.common_name}</td>
                      <td className="py-3.5 px-4 font-mono text-muted-foreground text-[11px] truncate max-w-[120px]" title={c.serial_number}>
                        {c.serial_number}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums">{c.expires?.slice(0, 10) || c.created?.slice(0, 10) || 'N/A'}</td>
                      <td className="py-3.5 px-4">
                        {c.is_valid && c.status !== 'revoked' ? (
                          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-md font-medium text-[11px] flex items-center gap-1 w-fit">
                            <Icons.check className="w-3 h-3" /> Geçerli
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 rounded-md font-medium text-[11px] flex items-center gap-1 w-fit">
                            <Icons.alertCircle className="w-3 h-3" /> İptal edildi (revoked)
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => setSelectedCert(c)}
                          className="px-2.5 py-1 border rounded-md text-[11px] font-medium hover:bg-muted transition-colors"
                        >
                          Detay / PEM
                        </button>
                        {c.is_valid && c.status !== 'revoked' && (
                          <button
                            onClick={() => handleRevoke(c.id, c.name)}
                            className="px-2.5 py-1 border border-destructive/30 text-destructive rounded-md text-[11px] font-medium hover:bg-destructive/10 transition-colors"
                          >
                            İptal et (revoke)
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Detail & Certificate PEM Modal */}
      {selectedCert && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <Icons.key className="w-5 h-5 text-primary" /> {selectedCert.name}
                </h3>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">CN: {selectedCert.common_name}</p>
              </div>
              <button onClick={() => setSelectedCert(null)} className="text-muted-foreground hover:text-foreground">
                <Icons.close className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-lg font-mono text-[11px]">
                <div>
                  <span className="text-muted-foreground block">Seri numarası:</span>
                  <span className="font-semibold text-foreground truncate block">{selectedCert.serial_number}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Anahtar uzunluğu:</span>
                  <span className="font-semibold text-foreground tabular-nums">{selectedCert.key_length || '2048'} bit ({selectedCert.digest || 'sha256'})</span>
                </div>
              </div>

              <div>
                <label className="font-medium block mb-1">X509 PEM sertifikası</label>
                <textarea
                  readOnly
                  rows={8}
                  value={selectedCert.certificate || '-----BEGIN CERTIFICATE-----\nSD-WAN Master X509 PEM Certificate Stream\n-----END CERTIFICATE-----'}
                  className="w-full p-3 bg-slate-950 text-emerald-400 font-mono text-[11px] rounded-lg outline-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t flex justify-between items-center">
              <span className="text-[11px] text-muted-foreground font-mono">
                {selectedCert.revoked ? 'Durum: İptal edildi (CRL)' : 'Durum: Geçerli'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([selectedCert.certificate || ''], { type: 'application/x-pem-file' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${selectedCert.common_name}.crt`;
                    a.click();
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground font-semibold text-xs rounded-lg shadow-sm hover:bg-primary/90 flex items-center gap-1.5"
                >
                  <Icons.download className="w-4 h-4" /> Sertifikayı indir (.crt)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Cert Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Icons.add className="w-5 h-5 text-primary" /> Sertifika otoritesi (CA) ile sertifika ihraç et
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <Icons.close className="w-5 h-5" />
              </button>
            </div>

            {addError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs font-medium">
                {addError}
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-4 text-xs">
              {/* Branch Quick Auto-Fill Selector */}
              <div className="p-3 bg-muted/40 border border-primary/20 rounded-lg space-y-1.5">
                <label className="font-semibold flex items-center gap-1.5 text-primary text-[11px] uppercase tracking-wider">
                  <Icons.building className="w-3.5 h-3.5" /> Kayıtlı şubeden otomatik ata (önerilen)
                </label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => handleDeviceSelect(e.target.value)}
                  className="w-full bg-background border rounded-md p-2 font-medium outline-none focus:ring-2 focus:ring-primary text-xs"
                >
                  <option value="">-- Şube seçiniz (veya manuel doldurunuz) --</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.last_ip || d.management_ip || 'IP atanmadı'})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Icons.sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                  Şube seçildiğinde sertifika adı ve common name (CN) otomatik oluşturulur.
                </p>
              </div>

              <div>
                <label className="font-medium block mb-1">Sertifika / peer adı *</label>
                <input
                  type="text"
                  required
                  placeholder="Sube-01-Tünel-Sertifikası"
                  value={certName}
                  onChange={(e) => setCertName(e.target.value)}
                  className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-medium"
                />
              </div>

              <div>
                <label className="font-medium block mb-1">Common name (CN) *</label>
                <input
                  type="text"
                  required
                  placeholder="branch-01.netopswan.local"
                  value={certCn}
                  onChange={(e) => setCertCn(e.target.value)}
                  className="w-full bg-background border rounded-md p-2.5 font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="pt-3 border-t flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border rounded-lg font-medium hover:bg-muted transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={createCertMutation.isPending}
                  className="px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-lg shadow-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  {createCertMutation.isPending ? 'İhraç ediliyor...' : 'Sertifikayı ihraç et'}
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
