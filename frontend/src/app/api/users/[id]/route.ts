import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { requireAdmin } from '@/lib/auth-guard';
import { errorResponse, ErrorCodes } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const forbidden = requireAdmin(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await params;
    const body = await request.json();
    const pool = getDbPool();

    const username = (body.first_name || body.username || '').trim();
    const email = body.email;
    const role = (body.role || 'operator').toLowerCase().includes('admin') ? 'admin' : 'operator';

    // id; gerçek DB id'si, username veya email olabilir (Users UI numeric list-index
    // id kullandığı için gerçek eşleştirme email üzerinden yapılıyor)
    // NOT: netops_users tablosunda updated_at kolonu yok (bkz. scripts/schema.sql)
    await pool.query(`
      UPDATE netops_users
      SET email = COALESCE($1, email), role = COALESCE($2, role)
      WHERE id = $3 OR username = $4 OR email = $3;
    `, [email, role, id, username]);

    return NextResponse.json({
      success: true,
      message: 'Kullanıcı başarıyla güncellendi'
    });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const forbidden = requireAdmin(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await params;
    const pool = getDbPool();

    await pool.query('DELETE FROM netops_users WHERE id = $1 OR username = $1 OR email = $1', [id]);

    return NextResponse.json({
      success: true,
      message: 'Kullanıcı başarıyla silindi'
    });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}
