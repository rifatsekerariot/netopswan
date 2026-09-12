'use client';

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchSystemUsers,
  createSystemUser,
  deleteSystemUser,
  SystemUser
} from '@/lib/api';
import {
  User,
  ShieldCheck,
  Key,
  Server,
  Lock,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Trash2,
  Users,
  X,
  UserPlus
} from 'lucide-react';

// Yoğun bilgi satırı: overview sayfasındaki KpiRow deseniyle aynı dil - eşit
// dört kart tekrarı yerine tek panel içinde bölünen satırlar.
function InfoRow({
  label,
  value,
  accent,
  icon: Icon
}: {
  label: string;
  value: React.ReactNode;
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
        <span className={`text-xs font-semibold font-mono leading-none ${accentMap.text}`}>{value}</span>
      </div>
    </div>
  );
}

export default function ProfileViewPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'profile' | 'users'>('profile');
  const [username, setUsername] = useState('Operatör');

  // Password Change Form State
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPassLoading, setIsPassLoading] = useState(false);
  const [passMessage, setPassMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add User Modal State
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'operator'>('operator');
  const [addUserError, setAddUserError] = useState<string | null>(null);

  useEffect(() => {
    const match = document.cookie.match(new RegExp('(^| )netopswan_user=([^;]+)'));
    if (match) {
      setUsername(decodeURIComponent(match[2]));
    }
  }, []);

  // Fetch Users Query
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['system-users'],
    queryFn: fetchSystemUsers
  });

  // Create User Mutation
  const createUserMutation = useMutation({
    mutationFn: createSystemUser,
    onSuccess: (newUser) => {
      queryClient.invalidateQueries({ queryKey: ['system-users'] });
      setIsAddUserOpen(false);
      setNewUsername('');
      setNewUserEmail('');
      setNewUserPassword('');
      setAddUserError(null);
      alert(`'${newUser.username}' kullanıcısı başarıyla eklendi.`);
    },
    onError: (err: any) => {
      setAddUserError(err.message || 'Kullanıcı eklenirken bir hata oluştu.');
    }
  });

  // Delete User Mutation
  const deleteUserMutation = useMutation({
    mutationFn: deleteSystemUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-users'] });
    }
  });

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMessage(null);

    if (!oldPassword || !newPassword || !confirmPassword) {
      setPassMessage({ type: 'error', text: 'Tüm parola alanlarını doldurunuz.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPassMessage({ type: 'error', text: 'Yeni parola ile parola tekrarı eşleşmiyor.' });
      return;
    }

    if (newPassword.length < 6) {
      setPassMessage({ type: 'error', text: 'Yeni parola en az 6 karakter olmalıdır.' });
      return;
    }

    setIsPassLoading(true);

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Parola güncellenemedi.');
      }

      setPassMessage({ type: 'success', text: 'Parolanız başarıyla güncellendi.' });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPassMessage({ type: 'error', text: err.message || 'Parola değiştirilirken bir hata oluştu.' });
    } finally {
      setIsPassLoading(false);
    }
  };

  const handleAddUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newUserEmail || !newUserPassword) {
      setAddUserError('Kullanıcı adı, e-posta ve parola zorunludur.');
      return;
    }

    createUserMutation.mutate({
      username: newUsername,
      email: newUserEmail,
      password: newUserPassword,
      role: newUserRole
    });
  };

  const handleDeleteUser = (id: string, name: string) => {
    if (confirm(`'${name}' kullanıcısını silmek istediğinize emin misiniz?`)) {
      deleteUserMutation.mutate(id);
    }
  };

  const systemUsers = usersData?.results || [];

  return (
    <PageContainer
      pageTitle="Kullanıcı ve yönetici ekranı"
      pageDescription="Profil bilgileri, parola yönetimi ve kullanıcı hesap yönetimi"
    >
      <div className="max-w-3xl space-y-6">
        {/* Navigation Tabs */}
        <div className="flex border-b space-x-6 text-sm font-semibold">
          <button
            onClick={() => setActiveTab('profile')}
            className={`pb-3 transition-colors flex items-center gap-2 border-b-2 ${
              activeTab === 'profile'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <User className="w-4 h-4" /> Profilim ve parola
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 transition-colors flex items-center gap-2 border-b-2 ${
              activeTab === 'users'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="w-4 h-4" /> Kullanıcı yönetimi
            <span className="font-mono tabular-nums text-xs opacity-70">({systemUsers.length})</span>
          </button>
        </div>

        {/* TAB 1: PROFILE & PASSWORD CHANGE */}
        {activeTab === 'profile' && (
          <div className="space-y-5">
            {/* Profile Info Panel */}
            <div className="bg-card border rounded-2xl p-6 space-y-1">
              <div className="flex items-center gap-4 border-b pb-5 mb-1">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center text-lg font-bold">
                  {username.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">{username}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Sistem yöneticisi ve ağ operatörü</p>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 mt-2">
                    <CheckCircle2 className="w-3 h-3" /> Oturum aktif
                  </span>
                </div>
              </div>

              <div className="divide-y divide-border/60">
                <InfoRow label="Kullanıcı adı" value={username} accent="primary" icon={User} />
                <InfoRow label="Erişim rolü" value="Sistem yöneticisi (full admin)" accent="emerald" icon={ShieldCheck} />
                <InfoRow label="Bağlantı tipi" value="Merkezi sunucu bağlantısı" accent="primary" icon={Server} />
                <InfoRow label="Oturum güvenliği" value="Kurumsal şifreli oturum" accent="amber" icon={Key} />
              </div>
            </div>

            {/* Password Change Form Panel */}
            <div className="bg-card border rounded-2xl p-6 space-y-5">
              <div className="border-b pb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" /> Parola güncelleme
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Hesap güvenliğiniz için parolanızı periyodik olarak güncellemeniz önerilir.
                </p>
              </div>

              {passMessage && (
                <div
                  className={`p-3.5 rounded-lg text-xs font-medium border flex items-center gap-2 animate-in fade-in ${
                    passMessage.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                      : 'bg-destructive/10 border-destructive/30 text-destructive'
                  }`}
                >
                  {passMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span>{passMessage.text}</span>
                </div>
              )}

              <form onSubmit={handlePasswordChange} className="space-y-4 text-xs">
                <div>
                  <label htmlFor="old-password" className="font-medium block mb-1">Mevcut parola *</label>
                  <input
                    id="old-password"
                    type="password"
                    required
                    placeholder="••••••••"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-medium"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="new-password" className="font-medium block mb-1">Yeni parola *</label>
                    <input
                      id="new-password"
                      type="password"
                      required
                      placeholder="En az 6 karakter"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-medium"
                    />
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="font-medium block mb-1">Yeni parola (tekrar) *</label>
                    <input
                      id="confirm-password"
                      type="password"
                      required
                      placeholder="En az 6 karakter"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-medium"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={isPassLoading}
                    className="px-5 py-2.5 bg-primary text-primary-foreground font-semibold text-xs rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {isPassLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Güncelleniyor...
                      </>
                    ) : (
                      'Parolayı güncelle'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TAB 2: USER MANAGEMENT (LIST, ADD, DELETE) */}
        {activeTab === 'users' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" /> Sistem kullanıcıları
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  SD-WAN yönetim paneline erişim yetkisi bulunan kullanıcı hesapları
                </p>
              </div>

              <button
                onClick={() => setIsAddUserOpen(true)}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" /> Yeni kullanıcı ekle
              </button>
            </div>

            {/* Users Table */}
            <div className="bg-card border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-4">Kullanıcı adı</th>
                      <th className="py-3 px-4">E-posta adresi</th>
                      <th className="py-3 px-4">Yetki rolü</th>
                      <th className="py-3 px-4">Durum</th>
                      <th className="py-3 px-4 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {usersLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i} aria-label="Yükleniyor">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <Skeleton className="w-7 h-7 rounded-lg shrink-0" />
                              <Skeleton className="h-3 w-24" />
                            </div>
                          </td>
                          {Array.from({ length: 4 }).map((__, j) => (
                            <td key={j} className="py-3.5 px-4">
                              <Skeleton className="h-3" style={{ width: '60%' }} />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : systemUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-muted-foreground">
                          Kayıtlı kullanıcı bulunamadı. "Yeni kullanıcı ekle" ile ilk hesabı oluşturabilirsiniz.
                        </td>
                      </tr>
                    ) : (
                      systemUsers.map((u: SystemUser) => (
                        <tr key={u.id} className="hover:bg-muted/40 transition-colors">
                          <td className="py-3.5 px-4 font-semibold text-foreground flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary font-semibold flex items-center justify-center text-xs shrink-0">
                              {u.username.slice(0, 2).toUpperCase()}
                            </div>
                            {u.username}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-muted-foreground">{u.email}</td>
                          <td className="py-3.5 px-4">
                            {u.is_superuser || u.is_staff ? (
                              <span className="px-2.5 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-md font-medium text-[11px]">
                                Yönetici (admin)
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 bg-muted text-muted-foreground border rounded-md font-medium text-[11px]">
                                Saha operatörü
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4" aria-label="Aktif">
                            <span className="flex items-center gap-1.5 w-fit text-[11px] font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span className="text-emerald-600 dark:text-emerald-400">Aktif</span>
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {u.username !== 'admin' && (
                              <button
                                onClick={() => handleDeleteUser(u.id, u.username)}
                                className="px-2.5 py-1 border border-destructive/30 text-destructive rounded-md hover:bg-destructive/10 transition-colors text-[11px] font-medium"
                                title="Kullanıcıyı sil"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Sil
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
        )}
      </div>

      {/* Add User Modal */}
      {isAddUserOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-primary" /> Yeni kullanıcı hesabı ekle
              </h3>
              <button
                onClick={() => setIsAddUserOpen(false)}
                aria-label="Kapat"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {addUserError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs font-medium">
                {addUserError}
              </div>
            )}

            <form onSubmit={handleAddUserSubmit} className="space-y-4 text-xs">
              <div>
                <label htmlFor="new-username" className="font-medium block mb-1">Kullanıcı adı *</label>
                <input
                  id="new-username"
                  type="text"
                  required
                  placeholder="Örn: ahmet.yilmaz"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-medium"
                />
              </div>

              <div>
                <label htmlFor="new-user-email" className="font-medium block mb-1">E-posta adresi *</label>
                <input
                  id="new-user-email"
                  type="email"
                  required
                  placeholder="Örn: ahmet@sirket.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full bg-background border rounded-md p-2.5 font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="new-user-password" className="font-medium block mb-1">İlk parola *</label>
                <input
                  id="new-user-password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  className="w-full bg-background border rounded-md p-2.5 font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="new-user-role" className="font-medium block mb-1">Yetki rolü *</label>
                <select
                  id="new-user-role"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full bg-background border rounded-md p-2.5 outline-none focus:ring-2 focus:ring-primary font-medium"
                >
                  <option value="operator">Saha operatörü (sınırlı yetki)</option>
                  <option value="admin">Sistem yöneticisi (tam yetkili admin)</option>
                </select>
              </div>

              <div className="pt-3 border-t flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="px-4 py-2 border rounded-lg font-medium hover:bg-muted transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={createUserMutation.isPending}
                  className="px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {createUserMutation.isPending ? 'Kaydediliyor...' : 'Kullanıcıyı kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
