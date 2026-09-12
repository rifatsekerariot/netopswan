import { NavGroup } from '@/types';

export const navGroups: NavGroup[] = [
  {
    label: 'SD-WAN Yönetim Konsolu',
    items: [
      {
        title: 'Genel Bakış (Overview)',
        url: '/dashboard/overview',
        icon: 'dashboard',
        isActive: true,
        shortcut: ['o', 'v'],
        items: []
      },
      {
        title: 'Cihaz & Şube Filosu',
        url: '/dashboard/fleet',
        icon: 'laptop',
        isActive: false,
        shortcut: ['f', 'f'],
        items: []
      },
      {
        title: 'Ağ Politikaları & UCI Şablonları',
        url: '/dashboard/templates',
        icon: 'code',
        isActive: false,
        shortcut: ['t', 't'],
        items: []
      },
      {
        title: 'Ağ Sağlığı & Canlı Telemetri',
        url: '/dashboard/monitoring',
        icon: 'kanban',
        isActive: false,
        shortcut: ['m', 'm'],
        items: []
      },
      {
        title: 'IP Planlama & Subnet (IPAM)',
        url: '/dashboard/ipam',
        icon: 'user',
        isActive: false,
        shortcut: ['i', 'p'],
        items: []
      },
      {
        title: 'DHCP Havuzları & Statik IP',
        url: '/dashboard/dhcp',
        icon: 'kanban',
        isActive: false,
        shortcut: ['d', 'h'],
        items: []
      },
      {
        title: 'Ağ Topolojisi & Harita',
        url: '/dashboard/topology',
        icon: 'kanban',
        isActive: false,
        shortcut: ['t', 'm'],
        items: []
      },
      {
        title: 'Smart Log Lakehouse & Tehdit',
        url: '/dashboard/threat-logs',
        icon: 'dashboard',
        isActive: false,
        shortcut: ['s', 'l'],
        items: []
      },
      {
        title: 'Güvenlik Duvarı, Filtreleme & QoS',
        url: '/dashboard/firewall',
        icon: 'settings',
        isActive: false,
        shortcut: ['f', 'w'],
        items: []
      },
      {
        title: 'Şifreleme & Kripto Sertifikalar',
        url: '/dashboard/pki',
        icon: 'settings',
        isActive: false,
        shortcut: ['p', 'k'],
        items: []
      }
    ]
  }
];
