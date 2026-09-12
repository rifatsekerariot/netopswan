import DhcpPage from '@/features/dhcp/components/dhcp-page';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Şube DHCP & MAC Yönetimi | NetOpsWan',
  description: 'Şubeler için alt ağ (subnet) yapılandırması, DHCP aralığı ve MAC adresi bazlı sabit IP tahsisi yönetimi'
};

export default function Page() {
  return <DhcpPage />;
}
