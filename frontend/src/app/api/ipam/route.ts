import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { validateCIDR } from '@/lib/validation';
import { errorResponse, ErrorCodes } from '@/lib/api-response';

export async function GET() {
  try {
    const pool = getDbPool();

    const res = await pool.query(`
      SELECT id, name, subnet, gateway, dhcp_start, dhcp_limit, type, region_group, description, created_at, updated_at
      FROM netops_subnets
      ORDER BY 
        CASE WHEN type = 'sdwan_tunnel' THEN 1 ELSE 2 END ASC,
        created_at ASC
    `);

    const results = res.rows.map(s => ({
      id: s.id,
      name: s.name,
      subnet: s.subnet,
      gateway: s.gateway,
      type: s.type || 'branch_lan',
      region_group: s.region_group || 'Merkez SD-WAN',
      start: s.dhcp_start,
      limit: s.dhcp_limit,
      description: s.description || '',
      created: s.created_at,
      modified: s.updated_at
    }));

    return NextResponse.json({
      count: results.length,
      next: null,
      previous: null,
      results
    });
  } catch (err: any) {
    console.error('IPAM GET Error:', err);
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const pool = getDbPool();
    
    const subnet = body.subnet;
    // NOT: subnet zorunludur ve CIDR olarak geçerli olmalıdır - aksi halde aşağıdaki
    // `subnet.replace(...)` (gateway hesaplama) undefined üzerinde çağrılıp
    // TypeError ile 500 fırlatırdı (beklenen 400 validasyon hatası yerine).
    if (!subnet || !validateCIDR(subnet)) {
      return NextResponse.json({ error: 'Geçerli bir subnet (CIDR formatında, örn. 192.168.1.0/24) zorunludur' }, { status: 400 });
    }

    const id = body.id || `subnet-${Date.now()}`;
    const name = body.name || subnet;
    const gateway = body.gateway || subnet.replace('/24', '').replace('/22', '').replace(/\.0$/, '.1');
    const dhcp_start = body.start || (body.type === 'sdwan_tunnel' ? 10 : 100);
    const dhcp_limit = body.limit || 150;
    const type = body.type || 'branch_lan';
    const region_group = body.region_group || 'Merkez SD-WAN';
    const description = body.description || '';

    const query = `
      INSERT INTO netops_subnets (id, name, subnet, gateway, dhcp_start, dhcp_limit, type, region_group, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          subnet = EXCLUDED.subnet,
          gateway = EXCLUDED.gateway,
          description = EXCLUDED.description,
          type = EXCLUDED.type,
          region_group = EXCLUDED.region_group,
          updated_at = NOW()
      RETURNING *;
    `;

    const res = await pool.query(query, [id, name, subnet, gateway, dhcp_start, dhcp_limit, type, region_group, description]);
    const row = res.rows[0];

    return NextResponse.json({
      id: row.id,
      name: row.name,
      subnet: row.subnet,
      gateway: row.gateway,
      type: row.type,
      region_group: row.region_group,
      start: row.dhcp_start,
      limit: row.dhcp_limit,
      description: row.description
    }, { status: 201 });
  } catch (err: any) {
    console.error('IPAM POST Error:', err);
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const pool = getDbPool();
    const id = body.id;
    if (!id) {
      return NextResponse.json({ error: 'Subnet ID zorunludur' }, { status: 400 });
    }

    const subnet = body.subnet;
    if (!subnet || !validateCIDR(subnet)) {
      return NextResponse.json({ error: 'Geçerli bir subnet (CIDR formatında, örn. 192.168.1.0/24) zorunludur' }, { status: 400 });
    }

    const name = body.name || subnet;
    const gateway = body.gateway || subnet.replace('/24', '').replace('/22', '').replace(/\.0$/, '.1');
    const dhcp_start = body.start || (body.type === 'sdwan_tunnel' ? 10 : 100);
    const dhcp_limit = body.limit || 150;
    const type = body.type || 'branch_lan';
    const region_group = body.region_group || 'Merkez SD-WAN';
    const description = body.description || '';

    const query = `
      UPDATE netops_subnets
      SET name = $2,
          subnet = $3,
          gateway = $4,
          dhcp_start = $5,
          dhcp_limit = $6,
          type = $7,
          region_group = $8,
          description = $9,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `;

    const res = await pool.query(query, [id, name, subnet, gateway, dhcp_start, dhcp_limit, type, region_group, description]);
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Subnet bulunamadı' }, { status: 404 });
    }
    const row = res.rows[0];

    return NextResponse.json({
      id: row.id,
      name: row.name,
      subnet: row.subnet,
      gateway: row.gateway,
      type: row.type,
      region_group: row.region_group,
      start: row.dhcp_start,
      limit: row.dhcp_limit,
      description: row.description
    });
  } catch (err: any) {
    console.error('IPAM PUT Error:', err);
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Subnet ID zorunludur' }, { status: 400 });
    }

    const pool = getDbPool();
    await pool.query('DELETE FROM netops_subnets WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}
