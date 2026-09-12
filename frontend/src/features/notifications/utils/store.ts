import { create } from 'zustand';
import type { NotificationStatus, NotificationAction } from '@/components/ui/notification-card';
import { fetchDevices, calculateDeviceStatus } from '@/lib/api';

export type Notification = {
  id: string;
  title: string;
  body: string;
  status: NotificationStatus;
  createdAt: string;
  actions?: NotificationAction[];
};

type NotificationState = {
  notifications: Notification[];
  isLoading: boolean;
  fetchLiveNotifications: () => Promise<void>;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  addNotification: (notification: Omit<Notification, 'status'>) => void;
  unreadCount: () => number;
};

export const useNotificationStore = create<NotificationState>()(
  (set, get) => ({
    notifications: [],
    isLoading: false,

    fetchLiveNotifications: async () => {
      set({ isLoading: true });
      try {
        const data = await fetchDevices({ page: 1, page_size: 100 });
        const devices = data.results || [];

        const liveNotifs: Notification[] = [];

        // 1. Genel Sunucu Durumu Bildirimi
        liveNotifs.push({
          id: 'sys-status',
          title: 'Merkez Sunucu Bağlantısı Aktif',
          body: `SD-WAN Merkez Gateway veritabanına ulaşıldı. Toplam ${data.count || devices.length} şube cihazı kayıtlı.`,
          status: 'read',
          createdAt: new Date().toISOString(),
          actions: [
            {
              id: 'view-fleet',
              label: 'Cihaz Yönetimine Git',
              type: 'redirect',
              style: 'primary'
            }
          ]
        });

        // 2. Problemli / Çevrimdışı Cihaz Alarmları (Merkezi Status Kontrolü)
        for (const dev of devices) {
          if (dev.status === 'problem') {
            liveNotifs.push({
              id: `prob-${dev.id}`,
              title: `⚠️ Dikkat Uyarısı: ${dev.name}`,
              body: `Cihazda performans veya yüksek gecikme uyarısı tespit edildi. (IP: ${dev.ip_address || 'Yok'})`,
              status: 'unread',
              createdAt: dev.modified || dev.created || new Date().toISOString(),
              actions: [
                {
                  id: 'view-fleet',
                  label: 'Cihazı İncele',
                  type: 'redirect',
                  style: 'primary'
                }
              ]
            });
          } else if (dev.status === 'offline') {
            liveNotifs.push({
              id: `off-${dev.id}`,
              title: `🔴 Cihaz Çevrimdışı: ${dev.name}`,
              body: `Şube cihazının merkez ile olan tünel bağlantısı kapalı veya yanıt vermiyor. (MAC: ${dev.mac_address})`,
              status: 'unread',
              createdAt: dev.modified || dev.created || new Date().toISOString()
            });
          } else if (dev.status === 'online') {
            liveNotifs.push({
              id: `rec-${dev.id}`,
              title: `🟢 Şube Çevrimiçi: ${dev.name}`,
              body: `Şube cihazı merkeze bağlı ve faal çalışıyor. (IP: ${dev.ip_address})`,
              status: 'read',
              createdAt: dev.created || new Date().toISOString()
            });
          }
        }

        set({ notifications: liveNotifs, isLoading: false });
      } catch {
        set({
          notifications: [
            {
              id: 'sys-fallback',
              title: 'Merkez Sunucu Durumu',
              body: 'Saha cihazlarının durum kontrolü gerçekleştiriliyor.',
              status: 'unread',
              createdAt: new Date().toISOString()
            }
          ],
          isLoading: false
        });
      }
    },

    markAsRead: (id) =>
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, status: 'read' as const } : n
        )
      })),

    markAllAsRead: () =>
      set((state) => ({
        notifications: state.notifications.map((n) => ({
          ...n,
          status: 'read' as const
        }))
      })),

    removeNotification: (id) =>
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id)
      })),

    addNotification: (notification) =>
      set((state) => ({
        notifications: [{ ...notification, status: 'unread' as const }, ...state.notifications]
      })),

    unreadCount: () => get().notifications.filter((n) => n.status === 'unread').length
  })
);
