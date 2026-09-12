'use client';

import Image from 'next/image';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@/components/ui/sidebar';

export function OrgSwitcher() {
  const { state } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size='lg' className="bg-sidebar-accent/40 hover:bg-sidebar-accent/60 transition-all">
          <div className='relative flex aspect-square size-8 shrink-0 items-center justify-center rounded-xl overflow-hidden shadow-sm border border-border/40 bg-background/50 backdrop-blur-sm'>
            <Image
              src="/logo.jpeg"
              alt="NetOps WAN Logo"
              fill
              sizes="32px"
              className="object-cover"
              priority
            />
          </div>
          <div
            className={`grid flex-1 text-left text-sm leading-tight transition-all duration-200 ease-in-out ${
              state === 'collapsed'
                ? 'invisible max-w-0 overflow-hidden opacity-0'
                : 'visible max-w-full opacity-100'
            }`}
          >
            <span className='truncate font-bold tracking-tight'>NetOps WAN</span>
            <span className='text-muted-foreground truncate text-[10px] uppercase font-semibold'>SD-WAN Yönetim Konsolu</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
