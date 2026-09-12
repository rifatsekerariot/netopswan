'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

type BreadcrumbItem = {
  title: string;
  link: string;
};

// This allows to add custom title as well
const routeMapping: Record<string, BreadcrumbItem[]> = {
  '/dashboard': [{ title: 'Kontrol Paneli', link: '/dashboard' }],
  '/dashboard/fleet': [{ title: 'Cihaz & Şube Yönetimi', link: '/dashboard/fleet' }],
  '/dashboard/topology': [{ title: 'SD-WAN Topolojisi', link: '/dashboard/topology' }],
  '/dashboard/dhcp': [{ title: 'DHCP & Ağ Yönetimi', link: '/dashboard/dhcp' }],
  '/dashboard/firewall': [{ title: 'Güvenlik Duvarı & NAC', link: '/dashboard/firewall' }],
  '/dashboard/monitoring': [{ title: 'Ağ Sağlığı & Telemetri', link: '/dashboard/monitoring' }],
  '/dashboard/ipam': [{ title: 'IPAM Alt Ağlar', link: '/dashboard/ipam' }],
  '/dashboard/pki': [{ title: 'Güvenlik & Sertifikalar', link: '/dashboard/pki' }]
};

export function useBreadcrumbs() {
  const pathname = usePathname();

  const breadcrumbs = useMemo(() => {
    // Check if we have a custom mapping for this exact path
    if (routeMapping[pathname]) {
      return routeMapping[pathname];
    }

    // If no exact match, fall back to generating breadcrumbs from the path
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      return {
        title: segment.charAt(0).toUpperCase() + segment.slice(1),
        link: path
      };
    });
  }, [pathname]);

  return breadcrumbs;
}
