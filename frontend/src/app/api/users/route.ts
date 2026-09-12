import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { hashPassword, generateSecurePassword } from '@/lib/password-hash';
import { successResponse, errorResponse, ErrorCodes } from '@/lib/api-response';
import { validateUsername, validateEmail, clampNumber, parseIntSafely } from '@/lib/validation';
import { requireAdmin } from '@/lib/auth-guard';

export async function GET(request: NextRequest) {
  const forbidden = requireAdmin(request);
  if (forbidden) return forbidden;
  try {
    const { searchParams } = request.nextUrl;
    const page = clampNumber(parseIntSafely(searchParams.get('page'), 1), 1, 1000);
    const limit = clampNumber(parseIntSafely(searchParams.get('limit'), 10), 1, 100);
    const search = (searchParams.get('search') ?? '').trim().substring(0, 100);
    const offset = (page - 1) * limit;

    const pool = getDbPool();
    // NOT: netops_users tablosunda updated_at kolonu yok (bkz. scripts/schema.sql)
    let query = `SELECT id, username, email, role, created_at FROM netops_users`;
    let countQuery = `SELECT COUNT(*) FROM netops_users`;
    const params: any[] = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` WHERE username ILIKE $1 OR email ILIKE $1`;
      countQuery += ` WHERE username ILIKE $1 OR email ILIKE $1`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const countRes = await pool.query(countQuery, search ? [params[0]] : []);
    const total = parseInt(countRes.rows[0]?.count || '0');

    const res = await pool.query(query, [...params, limit, offset]);

    const users = res.rows.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email || `${u.username}@netopswan.local`,
      role: u.role === 'admin' ? 'Administrator' : 'Operator',
      created_at: u.created_at,
      status: 'Active'
    }));

    return NextResponse.json(
      successResponse(
        { users, total },
        'Users retrieved successfully',
        {
          page,
          limit,
          total,
          has_more: offset + limit < total
        }
      )
    );
  } catch (err: any) {
    console.error('Get users error:', err);
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function POST(request: NextRequest) {
  const forbidden = requireAdmin(request);
  if (forbidden) return forbidden;
  try {
    const body = await request.json();
    const pool = getDbPool();

    // Validate input
    const username = (body.username || body.first_name || '').trim();
    const email = (body.email || '').trim();
    // NOT: Kullanıcı yönetim formu (UserMutationPayload) şifre alanı toplamıyor -
    // admin tarafından oluşturulan hesaplar için güvenli rastgele bir şifre üretilir;
    // kullanıcı ilk girişte "şifremi değiştir" akışını kullanmalıdır.
    const password = (body.password || '').trim() || generateSecurePassword();
    const role = (body.role || 'operator').toLowerCase().includes('admin') ? 'admin' : 'operator';

    if (!username || !validateUsername(username)) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid username format',
        400
      );
      return NextResponse.json(response, { status });
    }

    if (!email || !validateEmail(email)) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid email format',
        400
      );
      return NextResponse.json(response, { status });
    }

    const passwordHash = await hashPassword(password);
    const id = `user-${Date.now()}`;

    // NOT: netops_users tablosunda updated_at kolonu yok (bkz. scripts/schema.sql)
    await pool.query(`
      INSERT INTO netops_users (id, username, email, password_hash, role, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (username) DO UPDATE
      SET email = EXCLUDED.email, role = EXCLUDED.role;
    `, [id, username, email, passwordHash, role]);

    return NextResponse.json(
      successResponse(
        {
          id,
          first_name: username,
          last_name: '',
          email,
          phone: body.phone || '',
          status: 'Active',
          role: role === 'admin' ? 'Administrator' : 'Operator',
          created_at: new Date().toISOString()
        },
        'User created successfully'
      ),
      { status: 201 }
    );
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}
