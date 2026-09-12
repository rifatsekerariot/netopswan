import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Halka açık (Public) API ve statik endpoint'ler
  // NOT: /wizard, sistem ilk kez kurulurken (henüz hiçbir admin hesabı/token yokken)
  // çalışması gereken ilk kurulum sihirbazıdır. matcher'da '/wizard/:path*' olduğu
  // için buraya eklenmezse KENDİSİ auth duvarına takılır - hiçbir token
  // üretilemeden hiç render edilemez (bootstrap deadlock, kurulum imkansız hale
  // gelir). Tekrar çalıştırılmasını engelleyen asıl güvenlik kontrolü zaten
  // /api/setup/initialize route'unda (isSystemConfigured() -> 403) var; bu
  // sayfayı halka açık bırakmak o kontrolü atlamaz.
  const isPublicRoute =
    pathname.startsWith('/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/sdwan') || // Rust SD-WAN Hub & Agent register/telemetry
    pathname.startsWith('/api/setup') ||
    pathname.startsWith('/wizard') ||
    pathname === '/favicon.ico';

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Sunucunun kendi kendine (loopback) tetiklediği background job'lar için:
  // paylaşılan bir secret ile auth kontrolünü bypass eder. INTERNAL_SYNC_SECRET
  // env'de tanımlı değilse bu yol asla açılmaz (fail-closed).
  if (pathname === '/api/admin/sync-devices') {
    const internalSecret = process.env.INTERNAL_SYNC_SECRET;
    const providedSecret = req.headers.get('x-internal-sync-token');
    if (internalSecret && providedSecret === internalSecret) {
      return NextResponse.next();
    }
  }

  // Oturum Token'ı Kontrolü
  const token = req.cookies.get('netopswan_token')?.value;

  const deny = () => {
    // Eğer API endpoint'ine yetkisiz istek geliyorsa 401 JSON dön
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Yetkisiz erişim. Lütfen oturum açınız.' }, { status: 401 });
    }
    // Eğer Dashboard sayfasına giriliyorsa /auth/login sayfasına yönlendir
    const loginUrl = new URL('/auth/login', req.url);
    return NextResponse.redirect(loginUrl);
  };

  if (!token) {
    return deny();
  }

  // 🔒 FAZ 2 - KRİTİK GÜVENLİK DÜZELTMESİ (2026-08-22): Önceden burada SADECE
  // cookie'nin var/boş olmadığına bakılıyordu - token'ın GERÇEKTEN geçerli bir oturumu
  // temsil edip etmediği hiç doğrulanmıyordu. Yani `netopswan_token=herhangi-bir-metin`
  // cookie'siyle TÜM API'ler (cihaz yönetimi, firewall, DHCP, PKI) kimlik doğrulaması
  // olmadan erişilebilir durumdaydı. Artık `netops_sessions` tablosuna karşı gerçekten
  // doğrulanıyor - süresi dolmuş veya hiç var olmayan bir token reddedilir.
  try {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT s.user_id, u.role FROM netops_sessions s
       JOIN netops_users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW() LIMIT 1`,
      [token]
    );
    if (result.rows.length === 0) {
      return deny();
    }

    // Rol bilgisini, kendi rolünü sahtelemeye çalışan bir client header'ıyla
    // karıştırılmaması için burada silinip DB'den doğrulanmış değerle
    // yeniden yazılıyor - route handler'lar çağıranın rolünü SADECE bu
    // header'dan (x-user-role) okumalı.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-user-id', result.rows[0].user_id);
    requestHeaders.set('x-user-role', result.rows[0].role || 'operator');
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch (err) {
    console.error('Proxy oturum doğrulaması başarısız:', err);
    return deny();
  }
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/:path*',
    '/wizard/:path*'
  ]
};
