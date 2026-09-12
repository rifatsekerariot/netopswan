import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { errorResponse, ErrorCodes } from '@/lib/api-response';

export async function GET() {
  try {
    const pool = getDbPool();
    const res = await pool.query(`
      SELECT id, name, type, target_group, description, uci_content, created_at, updated_at
      FROM netops_templates
      ORDER BY created_at DESC
    `);

    const results = res.rows.map(t => ({
      id: t.id,
      name: t.name,
      type: t.type,
      description: t.description || '',
      target_group: t.target_group || 'Tüm Gruplar',
      device_count: 1,
      updated_at: t.updated_at,
      uci_content: t.uci_content
    }));

    return NextResponse.json({
      count: results.length,
      results
    });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const pool = getDbPool();
    
    const id = body.id || `tpl-${Date.now()}`;
    const name = body.name;
    const type = body.type || 'custom';
    const target_group = body.target_group || '';
    const description = body.description || '';
    const uci_content = body.uci_content || '';

    const query = `
      INSERT INTO netops_templates (id, name, type, target_group, description, uci_content)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (name) DO UPDATE
      SET uci_content = EXCLUDED.uci_content, description = EXCLUDED.description, updated_at = NOW()
      RETURNING *;
    `;

    const res = await pool.query(query, [id, name, type, target_group, description, uci_content]);
    const row = res.rows[0];

    return NextResponse.json({
      id: row.id,
      name: row.name,
      type: row.type,
      target_group: row.target_group,
      description: row.description,
      uci_content: row.uci_content,
      updated_at: row.updated_at
    }, { status: 201 });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const pool = getDbPool();
    const { id, name, type, target_group, description, uci_content } = body;

    if (!id && !name) {
      return NextResponse.json({ error: 'ID veya İsim zorunludur' }, { status: 400 });
    }

    const query = id 
      ? `UPDATE netops_templates SET name = COALESCE($2, name), type = COALESCE($3, type), target_group = COALESCE($4, target_group), description = COALESCE($5, description), uci_content = COALESCE($6, uci_content), updated_at = NOW() WHERE id = $1 RETURNING *;`
      : `UPDATE netops_templates SET type = COALESCE($2, type), target_group = COALESCE($3, target_group), description = COALESCE($4, description), uci_content = COALESCE($5, uci_content), updated_at = NOW() WHERE name = $1 RETURNING *;`;

    const params = id 
      ? [id, name, type, target_group, description, uci_content]
      : [name, type, target_group, description, uci_content];

    const res = await pool.query(query, params);
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Şablon bulunamadı' }, { status: 404 });
    }

    return NextResponse.json(res.rows[0]);
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Template ID zorunludur' }, { status: 400 });
    }

    const pool = getDbPool();
    await pool.query('DELETE FROM netops_templates WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}
