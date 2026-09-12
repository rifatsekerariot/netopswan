import { NextRequest, NextResponse } from 'next/server';

// proxy.ts oturumu netops_sessions + netops_users'a karşı doğrulayıp gerçek
// rolü bu header'a yazıyor - route handler'lar çağıranın rolünü SADECE
// buradan okumalı (proxy.ts, gelen istekteki aynı header'ı DB'den okuduğu
// değerle üzerine yazarak sahteciliği engelliyor).
export function getCallerRole(request: NextRequest): string {
  return request.headers.get('x-user-role') || 'operator';
}

// Admin gerektiren endpoint'lerin başında çağrılır. null dönerse çağıran admin'dir,
// devam edilebilir; aksi halde döndürülen 403 yanıtı doğrudan handler'dan return edilmelidir.
export function requireAdmin(request: NextRequest): NextResponse | null {
  if (getCallerRole(request) !== 'admin') {
    return NextResponse.json(
      { error: 'Bu işlem için yönetici (admin) yetkisi gereklidir.' },
      { status: 403 }
    );
  }
  return null;
}
