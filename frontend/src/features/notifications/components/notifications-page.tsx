'use client';

import React, { useEffect } from 'react';
import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { NotificationCard } from '@/components/ui/notification-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRouter } from 'next/navigation';
import { useNotificationStore } from '../utils/store';

const actionRoutes: Record<string, string> = {
  'view-fleet': '/dashboard/fleet'
};

export default function NotificationsPage() {
  const { notifications, markAsRead, markAllAsRead, unreadCount, fetchLiveNotifications } = useNotificationStore();
  const router = useRouter();
  const count = unreadCount();

  useEffect(() => {
    fetchLiveNotifications();
  }, [fetchLiveNotifications]);

  const unreadNotifications = notifications.filter((n) => n.status === 'unread');
  const readNotifications = notifications.filter((n) => n.status === 'read');

  const renderList = (items: typeof notifications) => {
    if (items.length === 0) {
      return (
        <div className='flex flex-col items-center justify-center py-16'>
          <Icons.notification className='text-muted-foreground/40 mb-3 h-10 w-10' />
          <p className='text-muted-foreground text-sm'>Henüz kayıtlı bildirim bulunmuyor</p>
        </div>
      );
    }

    return (
      <div className='flex flex-col gap-2'>
        {items.map((notification) => (
          <NotificationCard
            key={notification.id}
            id={notification.id}
            title={notification.title}
            body={notification.body}
            status={notification.status}
            createdAt={notification.createdAt}
            actions={notification.actions}
            onMarkAsRead={markAsRead}
            onAction={(notifId, actionId) => {
              const route = actionRoutes[actionId] || '/dashboard/fleet';
              markAsRead(notifId);
              router.push(route);
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <PageContainer
      pageTitle='Sistem Bildirimleri'
      pageDescription='Tüm şube ve ağ cihazı olay bildirimlerini görüntüleyin ve yönetin.'
      pageHeaderAction={
        count > 0 ? (
          <Button variant='outline' size='sm' onClick={markAllAsRead}>
            Tümünü Okundu İşaretle
          </Button>
        ) : undefined
      }
    >
      <Tabs defaultValue='all'>
        <TabsList>
          <TabsTrigger value='all'>Tümü ({notifications.length})</TabsTrigger>
          <TabsTrigger value='unread'>Okunmamış ({unreadNotifications.length})</TabsTrigger>
          <TabsTrigger value='read'>Okunmuş ({readNotifications.length})</TabsTrigger>
        </TabsList>
        <TabsContent value='all' className='mt-4'>
          {renderList(notifications)}
        </TabsContent>
        <TabsContent value='unread' className='mt-4'>
          {renderList(unreadNotifications)}
        </TabsContent>
        <TabsContent value='read' className='mt-4'>
          {renderList(readNotifications)}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
