import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isSystemConfigured } from '@/lib/config-manager';

export default async function Page() {
  // 1. Sistem daha önce kurulmadıysa kurulum sihirbazına yönlendir
  if (!isSystemConfigured()) {
    redirect('/wizard');
  }

  const cookieStore = await cookies();
  const token = cookieStore.get('netopswan_token')?.value;

  if (!token) {
    redirect('/auth/login');
  }

  redirect('/dashboard/overview');
}
