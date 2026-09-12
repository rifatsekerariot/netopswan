'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  Server,
  Network,
  Lock,
  User,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Zap,
  Globe,
  Radio,
  Cpu,
  HardDrive
} from 'lucide-react';

interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  uptime: number;
  totalMemMb: number;
  freeMemMb: number;
  cpus: number;
  networkInterfaces: Array<{ iface: string; ip: string; family: string; isInternal: boolean }>;
}

export default function SetupWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State (Zero-Hardcode: Dynamically Pre-populated)
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [externalDomain, setExternalDomain] = useState('');
  const [externalPort, setExternalPort] = useState(443);
  const [vpnSubnet, setVpnSubnet] = useState('10.8.0.0/24');
  const [vpnPort, setVpnPort] = useState(51820);
  const [autoRegistration, setAutoRegistration] = useState(true);
  
  // Dual-NIC & Zero-Trust İzolasyon Durumları
  const [nicMode, setNicMode] = useState<'single' | 'dual'>('single');
  const [wanInterface, setWanInterface] = useState('');
  const [lanInterface, setLanInterface] = useState('');
  const [isolateWanManagement, setIsolateWanManagement] = useState(true);
  const [sharedSecret, setSharedSecret] = useState('');

  // Initial Pre-Flight Check
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch('/api/setup/status');
        const data = await res.json();

        if (data.configured) {
          router.replace('/auth/login');
          return;
        }

        if (data.systemInfo) {
          setSystemInfo(data.systemInfo);
          if (data.currentConfig?.defaultDomain) {
            setExternalDomain(data.currentConfig.defaultDomain);
          }
          if (data.currentConfig?.defaultVpnSubnet) {
            setVpnSubnet(data.currentConfig.defaultVpnSubnet);
          }
          setAdminEmail(`admin@${data.systemInfo.hostname || 'netopswan.local'}`);

          // Fiziksel Kartları Otomatik Ata
          const ifaces = data.systemInfo.networkInterfaces || [];
          if (ifaces.length >= 2) {
            setNicMode('dual');
            setWanInterface(ifaces[0].iface);
            setLanInterface(ifaces[1].iface);
          } else if (ifaces.length === 1) {
            setWanInterface(ifaces[0].iface);
            setLanInterface(ifaces[0].iface);
          }

          // Kriptografik Rastgele Ağ Gizli Anahtarı Üret (Zero-Hardcode)
          const randomSecret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          setSharedSecret(`netops-${randomSecret}`);
        }
      } catch (err: any) {
        setErrorMessage('Sistem donanım durumu okunamadı: ' + err.message);
      } finally {
        setIsLoading(false);
      }
    }
    checkStatus();
  }, [router]);

  const handleNext = () => {
    setErrorMessage(null);
    if (step === 2) {
      if (!adminUsername.trim()) {
        setErrorMessage('Yönetici kullanıcı adı boş bırakılamaz.');
        return;
      }
      if (!adminPassword || adminPassword.length < 6) {
        setErrorMessage('Yönetici şifresi en az 6 karakter olmalıdır.');
        return;
      }
      if (adminPassword !== adminPasswordConfirm) {
        setErrorMessage('Şifreler birbiriyle eşleşmiyor.');
        return;
      }
    } else if (step === 3) {
      if (!externalDomain.trim()) {
        setErrorMessage('Lütfen sunucu dış erişim IP adresi veya alan adını giriniz.');
        return;
      }
      if (!vpnSubnet.trim() || !vpnSubnet.includes('/')) {
        setErrorMessage('Lütfen geçerli bir CIDR alt ağ formatı giriniz (Örn: 10.8.0.0/24).');
        return;
      }
    }
    setStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrev = () => {
    setErrorMessage(null);
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const handleFinishSetup = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/setup/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminUsername,
          adminPassword,
          adminEmail,
          externalDomain,
          externalPort,
          vpnSubnet,
          vpnPort,
          autoRegistration,
          nicMode,
          wanInterface,
          lanInterface,
          isolateWanManagement,
          sharedSecret
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Kurulum tamamlanamadı.');
      }

      // Success -> Redirect to Login Page
      window.location.href = '/auth/login?setup=success';
    } catch (err: any) {
      setErrorMessage(err.message || 'Kurulum kaydedilirken hata oluştu.');
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-semibold tracking-wide text-muted-foreground animate-pulse">
            NetOpsWan Donanım ve Ortam Taraması Yapılıyor...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 md:p-10 bg-gradient-to-br from-background via-card to-background text-foreground relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/10 blur-[140px] rounded-full pointer-events-none" />

      <div className="w-full max-w-2xl bg-card/80 backdrop-blur-xl border border-border/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col z-10 transition-all duration-300">
        
        {/* Header Branding */}
        <div className="p-6 sm:p-8 border-b border-border/60 bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative size-11 rounded-2xl overflow-hidden border border-border/80 shadow-md bg-background flex items-center justify-center">
              <Image src="/logo.jpeg" alt="NetOpsWan Logo" width={44} height={44} className="object-cover" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
                NetOpsWan <span className="text-xs px-2 py-0.5 bg-primary/15 text-primary rounded-full border border-primary/30">SD-WAN Gateway</span>
              </h1>
              <p className="text-xs text-muted-foreground font-medium">İlk Kurulum ve Donanım Hazırlık Sihirbazı</p>
            </div>
          </div>

          {/* Stepper Indicator */}
          <div className="flex items-center gap-1.5 bg-background/60 border border-border/60 rounded-full px-3 py-1 text-xs font-bold text-muted-foreground">
            <span className={step === 1 ? 'text-primary' : ''}>1</span>
            <span>•</span>
            <span className={step === 2 ? 'text-primary' : ''}>2</span>
            <span>•</span>
            <span className={step === 3 ? 'text-primary' : ''}>3</span>
            <span>•</span>
            <span className={step === 4 ? 'text-primary' : ''}>4</span>
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-6 sm:mx-8 mt-6 p-4 rounded-2xl bg-destructive/10 border border-destructive/30 text-destructive text-xs font-semibold flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Step Content */}
        <div className="p-6 sm:p-8 flex-1">
          
          {/* STEP 1: Pre-flight System & Hardware Discovery */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h2 className="text-base font-bold text-foreground">Sistem & Donanım Uyumluluk Doğrulaması</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sunucunuzun fiziksel donanımı ve ağ yetenekleri incelendi.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="p-4 rounded-2xl border border-border/60 bg-background/50 flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground font-bold flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-primary" /> CPU Çekirdek
                  </span>
                  <span className="text-sm font-extrabold">{systemInfo?.cpus || 1} vCPU ({systemInfo?.arch})</span>
                </div>

                <div className="p-4 rounded-2xl border border-border/60 bg-background/50 flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground font-bold flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5 text-emerald-500" /> RAM Bellek
                  </span>
                  <span className="text-sm font-extrabold">{systemInfo?.totalMemMb || 0} MB (Kullanılabilir: {systemInfo?.freeMemMb || 0} MB)</span>
                </div>

                <div className="p-4 rounded-2xl border border-border/60 bg-background/50 flex flex-col gap-1 col-span-2 sm:col-span-1">
                  <span className="text-[11px] text-muted-foreground font-bold flex items-center gap-1">
                    <Server className="w-3.5 h-3.5 text-indigo-500" /> Hostname / OS
                  </span>
                  <span className="text-sm font-extrabold truncate">{systemInfo?.hostname} ({systemInfo?.platform})</span>
                </div>
              </div>

              {/* Discovered Interfaces */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                  Tespit Edilen Fiziksel Ağ Arayüzleri
                </label>
                <div className="border border-border/60 rounded-2xl overflow-hidden divide-y divide-border/40 bg-background/30">
                  {systemInfo?.networkInterfaces && systemInfo.networkInterfaces.length > 0 ? (
                    systemInfo.networkInterfaces.map((iface, idx) => (
                      <div key={idx} className="p-3 text-xs flex items-center justify-between">
                        <span className="font-bold flex items-center gap-2 font-mono text-primary">
                          <Network className="w-3.5 h-3.5" /> {iface.iface}
                        </span>
                        <span className="font-mono bg-muted/60 px-2.5 py-0.5 rounded-full border border-border/60">
                          {iface.ip}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 text-xs text-muted-foreground italic">Varsayılan yerel döngü (Loopback) tespit edildi.</div>
                  )}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 text-xs text-foreground/90 space-y-1">
                <div className="font-bold text-primary flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" /> Sıfır Bağımlılık & Otomatik Güvenlik
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Kurulum tamamlandığında PostgreSQL, WireGuard L3 Kernel Tüneli, Nginx Reverse Proxy ve DuckDB Log Lakehouse servisleri otomatik olarak yapılandırılacaktır.
                </p>
              </div>
            </div>
          )}

          {/* STEP 2: Super-Administrator Credentials */}
          {step === 2 && (
            <div className="space-y-5 animate-in fade-in">
              <div>
                <h2 className="text-base font-bold text-foreground">Ana Yönetici Hesabı (Super-Admin)</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Merkezi SD-WAN yönetim konsoluna erişim için yetkili yönetici bilgilerini tanımlayınız.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                    Kullanıcı Adı
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      placeholder="admin"
                      className="w-full bg-background border border-border/80 rounded-2xl pl-10 pr-4 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      Yönetici Şifresi
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-background border border-border/80 rounded-2xl pl-10 pr-4 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      Şifre Tekrarı
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="password"
                        value={adminPasswordConfirm}
                        onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-background border border-border/80 rounded-2xl pl-10 pr-4 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                    Bildirim E-Posta Adresi
                  </label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@sirketiniz.com"
                    className="w-full bg-background border border-border/80 rounded-2xl px-4 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: SD-WAN Overlay & Network Topology Configuration */}
          {step === 3 && (
            <div className="space-y-5 animate-in fade-in">
              <div>
                <h2 className="text-base font-bold text-foreground">SD-WAN Tünel & Dış Erişim Yapılandırması</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Şubelerin merkeze bağlanacağı WireGuard tünel havuzu ve dış IP/FQDN parametreleri.
                </p>
              </div>

              <div className="space-y-4">
                {/* 1. Mimari Modu Seçimi (Single-NIC vs Dual-NIC) */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                    Ağ Mimarisi ve İzolasyon Modu
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setNicMode('single')}
                      className={`p-3 rounded-2xl border text-left transition-all flex flex-col gap-1 ${
                        nicMode === 'single'
                          ? 'border-primary bg-primary/10 text-foreground ring-2 ring-primary/30'
                          : 'border-border/60 bg-background/40 hover:bg-background/80 text-muted-foreground'
                      }`}
                    >
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5" /> Tek Port (Single-NIC)
                      </span>
                      <span className="text-[10px] leading-tight">Bulut / VPS ortamları için tek arayüz üzerinden tünel ve yönetim.</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNicMode('dual')}
                      className={`p-3 rounded-2xl border text-left transition-all flex flex-col gap-1 ${
                        nicMode === 'dual'
                          ? 'border-primary bg-primary/10 text-foreground ring-2 ring-primary/30'
                          : 'border-border/60 bg-background/40 hover:bg-background/80 text-muted-foreground'
                      }`}
                    >
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Çift Port (Dual-NIC İzolasyon)
                      </span>
                      <span className="text-[10px] leading-tight">Kurumsal Bare-Metal: WAN (Tünel) ve LAN (Yönetim) fiziksel ayrımı.</span>
                    </button>
                  </div>
                </div>

                {/* Dual-NIC Interface Selection */}
                {nicMode === 'dual' && (
                  <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-background/60 border border-border/80 animate-in fade-in">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                        WAN Arayüzü (Dış Hat / Tüneller)
                      </label>
                      <select
                        value={wanInterface}
                        onChange={(e) => setWanInterface(e.target.value)}
                        className="w-full bg-background border border-border/80 rounded-xl px-3 py-2 text-xs font-mono font-semibold outline-none"
                      >
                        {systemInfo?.networkInterfaces.map((iface, idx) => (
                          <option key={idx} value={iface.iface}>
                            {iface.iface} ({iface.ip})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                        LAN Arayüzü (Şirket İçi Yönetim)
                      </label>
                      <select
                        value={lanInterface}
                        onChange={(e) => setLanInterface(e.target.value)}
                        className="w-full bg-background border border-border/80 rounded-xl px-3 py-2 text-xs font-mono font-semibold outline-none"
                      >
                        {systemInfo?.networkInterfaces.map((iface, idx) => (
                          <option key={idx} value={iface.iface}>
                            {iface.iface} ({iface.ip})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      Dış Erişim IP veya Alan Adı (FQDN)
                    </label>
                    <div className="relative">
                      <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={externalDomain}
                        onChange={(e) => setExternalDomain(e.target.value)}
                        placeholder="sdwan.sirketiniz.com veya Sunucu IP"
                        className="w-full bg-background border border-border/80 rounded-2xl pl-10 pr-4 py-2.5 text-sm font-mono font-semibold outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      HTTPS Portu
                    </label>
                    <input
                      type="number"
                      value={externalPort}
                      onChange={(e) => setExternalPort(parseInt(e.target.value) || 443)}
                      className="w-full bg-background border border-border/80 rounded-2xl px-4 py-2.5 text-sm font-mono font-semibold outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      Dinamik SD-WAN Tünel CIDR Havuzu
                    </label>
                    <div className="relative">
                      <Network className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={vpnSubnet}
                        onChange={(e) => setVpnSubnet(e.target.value)}
                        placeholder="10.8.0.0/24"
                        className="w-full bg-background border border-border/80 rounded-2xl pl-10 pr-4 py-2.5 text-sm font-mono font-semibold outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                      WireGuard Portu
                    </label>
                    <input
                      type="number"
                      value={vpnPort}
                      onChange={(e) => setVpnPort(parseInt(e.target.value) || 51820)}
                      className="w-full bg-background border border-border/80 rounded-2xl px-4 py-2.5 text-sm font-mono font-semibold outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                {/* Zero-Trust Shared Secret Key */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block flex items-center justify-between">
                    <span>Zero-Trust Ağ Gizli Anahtarı (X-NetOps-Secret)</span>
                    <span className="text-[10px] text-emerald-500 font-mono">Otomatik Üretildi</span>
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={sharedSecret}
                      onChange={(e) => setSharedSecret(e.target.value)}
                      placeholder="netops-secret-key"
                      className="w-full bg-background border border-border/80 rounded-2xl pl-10 pr-4 py-2.5 text-sm font-mono font-semibold outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-background/50 border border-border/60">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-foreground block">Yönetim Panelini Dış Ağdan (WAN) Tamamen İzolasyon Yap</span>
                    <span className="text-[11px] text-muted-foreground">Web Dashboard'a dışarıdan (WAN) erişimi engelle (403), sadece LAN ve Tünelden izin ver.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={isolateWanManagement}
                    onChange={(e) => setIsolateWanManagement(e.target.checked)}
                    className="w-5 h-5 accent-primary rounded cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Review & Final Hardening */}
          {step === 4 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h2 className="text-base font-bold text-foreground">Özet & Güvenlik Kilitleme Onayı</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Yapılandırma kaydedildikten sonra sihirbaz kalıcı olarak kilitlenecektir.
                </p>
              </div>

              <div className="border border-border/70 rounded-2xl overflow-hidden divide-y divide-border/40 bg-background/40 text-xs">
                <div className="p-3.5 flex justify-between">
                  <span className="text-muted-foreground font-semibold">Yönetici Kullanıcı Adı:</span>
                  <span className="font-bold font-mono">{adminUsername}</span>
                </div>
                <div className="p-3.5 flex justify-between">
                  <span className="text-muted-foreground font-semibold">Dış Erişim Adresi (FQDN/IP):</span>
                  <span className="font-bold font-mono">{externalDomain}:{externalPort}</span>
                </div>
                <div className="p-3.5 flex justify-between">
                  <span className="text-muted-foreground font-semibold">SD-WAN Tünel CIDR Bloğu:</span>
                  <span className="font-bold font-mono text-primary">{vpnSubnet} (Gateway: {vpnSubnet.split('/')[0].split('.').slice(0, 3).join('.')}.1)</span>
                </div>
                <div className="p-3.5 flex justify-between">
                  <span className="text-muted-foreground font-semibold">WireGuard UDP Portu:</span>
                  <span className="font-bold font-mono">{vpnPort}</span>
                </div>
                <div className="p-3.5 flex justify-between">
                  <span className="text-muted-foreground font-semibold">Zero-Touch Şube Kaydı:</span>
                  <span className="font-bold text-emerald-500">{autoRegistration ? 'Aktif (Açık)' : 'Manuel Onay'}</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-500 flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 shrink-0" />
                <span>
                  Kurulum tamamlandığında merkez sunucuda <strong>.configured</strong> kilit dosyası oluşturulacak ve sistem doğrudan güvenli operasyonel moda geçecektir.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-6 sm:p-8 border-t border-border/60 bg-muted/10 flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={handlePrev}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl border border-border/80 text-xs font-bold hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Geri
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={handleNext}
              className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold rounded-xl shadow-lg transition-colors flex items-center gap-1.5"
            >
              İleri <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinishSetup}
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Kurulum Yapılıyor & Kilitleniyor...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" /> Kurulumu Tamamla ve Başlat
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
