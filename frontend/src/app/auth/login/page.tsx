'use client';

import Image from 'next/image';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InteractiveGridPattern } from '@/features/auth/components/interactive-grid';
import { ShieldCheck, Lock, User, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Kullanıcı adı ve şifre zorunludur.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Giriş yapılamadı. Bilgilerinizi kontrol ediniz.');
      }

      // Successful login -> Redirect to SD-WAN Overview Dashboard
      window.location.href = '/dashboard/overview';
    } catch (err: any) {
      setError(err.message || 'Giriş yapılırken bir hata oluştu.');
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden md:grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      {/* Left Branding Panel (Uses template's sidebar style and InteractiveGridPattern) */}
      <div className="relative hidden h-full flex-col p-10 lg:flex border-r bg-sidebar">
        <div className="text-sidebar-foreground relative z-20 flex items-center gap-3 text-lg font-bold">
          <div className="relative size-9 rounded-xl overflow-hidden border border-white/10 shadow-md bg-background/40 backdrop-blur-md">
            <Image
              src="/logo.jpeg"
              alt="NetOps WAN Logo"
              width={36}
              height={36}
              className="object-cover w-full h-full"
            />
          </div>
          <span className="tracking-tight">NetOps WAN SD-WAN</span>
        </div>

        <InteractiveGridPattern
          className={cn(
            'mask-[radial-gradient(400px_circle_at_center,white,transparent)]',
            'inset-x-0 inset-y-[0%] h-full skew-y-12 opacity-40'
          )}
        />

        {/* Sol Panel Ortasındaki Kenarları Eriyik Blurlu Logo (Filigran) */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none z-10">
          <div className="relative w-72 h-72 opacity-25 blur-[1px] [mask-image:radial-gradient(circle_at_center,black_35%,transparent_75%)]">
            <Image
              src="/logo.jpeg"
              alt="NetOps WAN Watermark"
              width={288}
              height={288}
              className="object-contain w-full h-full"
            />
          </div>
        </div>

        <div className="text-sidebar-foreground relative z-20 mt-auto space-y-4">
          <div className="p-5 bg-background/30 backdrop-blur-md border border-white/10 rounded-2xl shadow-lg space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <ShieldCheck className="w-4 h-4" /> Kurumsal SD-WAN Yönetim Konsolu
            </div>
            <p className="text-xs text-sidebar-foreground/80 leading-relaxed">
              Merkezi şube ağ geçitleri, şifreli tünel politikaları ve canlı performans metriklerine güvenli erişim portalı.
            </p>
          </div>
          <p className="text-[11px] text-sidebar-foreground/50 font-mono text-right">
            NetOps WAN Central Gateway • v24.1
          </p>
        </div>
      </div>

      {/* Right Login Form Container */}
      <div className="flex h-full w-full items-center justify-center p-6 lg:p-12 bg-background">
        <div className="flex w-full max-w-sm flex-col space-y-6">
          <div className="flex flex-col space-y-3 text-center items-center">
            {/* Corporate Logo Header with subtle backdrop blur */}
            <div className="relative size-16 rounded-2xl overflow-hidden shadow-lg border border-border/50 bg-card/60 backdrop-blur-md p-1">
              <div className="relative w-full h-full rounded-xl overflow-hidden">
                <Image
                  src="/logo.jpeg"
                  alt="NetOps WAN Logo"
                  width={64}
                  height={64}
                  className="object-cover w-full h-full"
                />
              </div>
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Kullanıcı Girişi</h1>
              <p className="text-xs text-muted-foreground">
                SD-WAN yönetim paneline erişmek için hesabınızla giriş yapın
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-xs font-medium flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-muted-foreground" /> Kullanıcı Adı
              </label>
              <input
                type="text"
                required
                placeholder="Kullanıcı Adı"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-card border rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Şifre
              </label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-card border rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary font-medium"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-lg shadow-md hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Giriş Yapılıyor...
                </>
              ) : (
                'Giriş Yap'
              )}
            </button>
          </form>

          <p className="text-[11px] text-center text-muted-foreground border-t pt-4">
            © 2026 NetOpsWan SD-WAN Ağ & Güvenlik Yönetim Platformu. Tüm hakları saklıdır.
          </p>
        </div>
      </div>
    </div>
  );
}
