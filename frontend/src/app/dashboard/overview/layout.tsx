import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SD-WAN Kontrol Paneli | NetOpsWan',
  description: 'Şube ağ cihazları, politikalar ve güvenlik sertifikalarının anlık durum özeti'
};

export default function OverViewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
