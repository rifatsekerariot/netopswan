import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, verifyPassword } from '@/lib/password-hash';
import { successResponse, errorResponse, ErrorCodes } from '@/lib/api-response';
import { validateUsername } from '@/lib/validation';
import { getDbPool } from '@/lib/db';

// 🔒 FAZ 2 DÜZELTMESİ (2026-08-22): Önceden bu sayaçlar bir Node.js `Map`'te (bellek
// içi) tutuluyordu - her deploy/restart'ta SIFIRLANIYORDU, yani kaba kuvvet koruması
// süreklilik göstermiyordu. Artık `netops_login_attempts` tablosunda kalıcı.
async function checkRateLimit(key: string): Promise<{ allowed: boolean; remainingSeconds?: number }> {
  const pool = getDbPool();
  const res = await pool.query(
    'SELECT attempts, lock_until FROM netops_login_attempts WHERE rate_limit_key = $1',
    [key]
  ).catch(() => ({ rows: [] as any[] }));

  const record = res.rows[0];
  if (record && record.lock_until && new Date(record.lock_until).getTime() > Date.now()) {
    const remainingSeconds = Math.ceil((new Date(record.lock_until).getTime() - Date.now()) / 1000);
    return { allowed: false, remainingSeconds };
  }
  return { allowed: true };
}

async function recordFailedAttempt(key: string) {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO netops_login_attempts (rate_limit_key, attempts, lock_until, updated_at)
     VALUES ($1, 1, NULL, NOW())
     ON CONFLICT (rate_limit_key) DO UPDATE SET
       attempts = netops_login_attempts.attempts + 1,
       lock_until = CASE WHEN netops_login_attempts.attempts + 1 >= 5
                         THEN NOW() + INTERVAL '60 seconds'
                         ELSE netops_login_attempts.lock_until END,
       updated_at = NOW()`,
    [key]
  ).catch(() => {});
}

async function resetRateLimit(key: string) {
  const pool = getDbPool();
  await pool.query('DELETE FROM netops_login_attempts WHERE rate_limit_key = $1', [key]).catch(() => {});
}

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    const rawIp = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    const clientIp = rawIp.replace(/^::ffff:/, '');
    const rateLimitKey = `${clientIp}_${username}`;

    // Validate input
    if (!username || !password) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'Username and password are required',
        400
      );
      return NextResponse.json(response, { status });
    }

    if (!validateUsername(username)) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid username format',
        400
      );
      return NextResponse.json(response, { status });
    }

    // Rate limiting
    const rateCheck = await checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      const { response, status } = errorResponse(
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        `Too many login attempts. Please try again in ${rateCheck.remainingSeconds} seconds`,
        429
      );
      return NextResponse.json(response, { status });
    }

    let token = '';
    let authenticated = false;
    let userId = '';

    try {
      const pool = getDbPool();

      const userRes = await pool.query(
        'SELECT id, username, password_hash, role FROM netops_users WHERE username = $1 LIMIT 1',
        [username]
      );

      if (userRes.rows.length > 0) {
        const dbUser = userRes.rows[0];
        const storedHash = dbUser.password_hash || '';

        // Use new password verification (supports bcrypt, pbkdf2, legacy SHA256)
        const isPasswordValid = await verifyPassword(password, storedHash);

        if (isPasswordValid) {
          // Upgrade legacy passwords to new hash
          if (!storedHash.startsWith('$2') && !storedHash.startsWith('$pbkdf2$')) {
            const newHash = await hashPassword(password);
            // NOT: netops_users tablosunda updated_at kolonu yok (bkz. scripts/schema.sql) - eklenirse SQL hatası verir
            await pool.query(
              'UPDATE netops_users SET password_hash = $1 WHERE id = $2',
              [newHash, dbUser.id]
            ).catch(err => console.error('Password upgrade failed:', err));
          }

          const crypto = await import('crypto');
          token = crypto.randomBytes(32).toString('hex');
          authenticated = true;
          userId = dbUser.id;

          // Store session in database (optional)
          await pool.query(
            'INSERT INTO netops_sessions (user_id, token, ip_address, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL \'7 days\')',
            [userId, token, clientIp]
          ).catch(() => {}); // Session table might not exist
        }
      }
    } catch (dbErr) {
      console.error('Database auth check failed:', dbErr);
    }

    // NOT: Kurulum sihirbazı (setup/initialize) admin kullanıcısını zaten netops_users
    // tablosuna gerçek bir password_hash ile ekliyor - bu yüzden yukarıdaki DB kontrolü
    // admin girişini de kapsıyor. Ayrıca burada config-manager üzerinden (dosyada
    // password tutulmayan) bir "fallback admin" yolu YOKTUR - böyle bir mekanizma hem
    // NetOpsWanSystemConfig tipinde olmayan bir alana (adminPassword) referans verdiği
    // için derlenmiyordu hem de env değişkenine karşı düz metin şifre karşılaştırması
    // yapan gereksiz bir ikinci kimlik doğrulama yolu (backdoor riski) oluşturuyordu.

    if (!authenticated) {
      await recordFailedAttempt(rateLimitKey);
      const { response, status } = errorResponse(
        ErrorCodes.INVALID_CREDENTIALS,
        'Invalid username or password',
        401
      );
      return NextResponse.json(response, { status });
    }

    // Success - reset rate limit
    await resetRateLimit(rateLimitKey);

    const response = NextResponse.json(
      successResponse(
        { username, token, userId },
        'Login successful'
      )
    );

    // Set secure HTTP-only cookie for token
    response.cookies.set('netopswan_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 // 1 hour
    });

    // Store username in separate cookie (httpOnly for XSS security)
    response.cookies.set('netopswan_user', username, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60
    });

    return response;
  } catch (error: any) {
    console.error('Login error:', error);
    const { response, status } = errorResponse(
      ErrorCodes.INTERNAL_ERROR,
      'An error occurred during login',
      500
    );
    return NextResponse.json(response, { status });
  }
}
