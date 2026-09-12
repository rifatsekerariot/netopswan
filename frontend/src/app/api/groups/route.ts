import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { errorResponse, ErrorCodes } from '@/lib/api-response';

async function ensureGroupsTable(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS netops_groups (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

export async function GET() {
  try {
    const pool = getDbPool();
    await ensureGroupsTable(pool);

    // 1. Gruplar tablosundaki tüm grupları ve netops_devices ile eşleşen cihaz sayılarını çek
    const res = await pool.query(`
      SELECT 
        g.id,
        g.name,
        g.description,
        COALESCE(d.cnt, 0)::int as device_count
      FROM netops_groups g
      LEFT JOIN (
        SELECT group_id, COUNT(*) as cnt
        FROM netops_devices
        GROUP BY group_id
      ) d ON g.id = d.group_id OR g.name = d.group_id
      ORDER BY g.created_at ASC;
    `);

    let groups = res.rows;

    // Eğer tabloda hiç grup yoksa varsayılan grubu oluştur
    if (groups.length === 0) {
      await pool.query(`
        INSERT INTO netops_groups (id, name, description)
        VALUES ('Merkez SD-WAN', 'Merkez SD-WAN', 'Ana SD-WAN Tünel Grubu')
        ON CONFLICT (id) DO NOTHING;
      `);
      groups = [{ id: 'Merkez SD-WAN', name: 'Merkez SD-WAN', description: 'Ana SD-WAN Tünel Grubu', device_count: 0 }];
    }

    return NextResponse.json({
      count: groups.length,
      results: groups
    });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = (body.name || '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Grup adı boş olamaz.' }, { status: 400 });
    }

    const id = name;
    const description = (body.description || '').trim();
    const pool = getDbPool();
    await ensureGroupsTable(pool);

    await pool.query(`
      INSERT INTO netops_groups (id, name, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, description = EXCLUDED.description;
    `, [id, name, description]);

    return NextResponse.json({
      id,
      name,
      description,
      device_count: 0
    }, { status: 201 });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const body = await req.json();
    const newName = (body.name || '').trim();
    const description = (body.description || '').trim();

    if (!id) {
      return NextResponse.json({ error: 'Grup ID belirtilmedi.' }, { status: 400 });
    }

    const pool = getDbPool();
    await ensureGroupsTable(pool);

    // NOT: netops_groups.id oluşturulduktan sonra HİÇBİR ZAMAN değişmez (her zaman
    // ilk oluşturulan `name` değeridir) - sadece `name` değişir. Bağlı cihazların
    // group_id'sini bu grubun İMMUTABLE id'si yerine ESKİ (güncellemeden hemen
    // önceki) `name` değerine göre senkronize etmemiz gerekiyor, çünkü bir önceki
    // rename'de cihazların group_id'si zaten o zamanki yeni isme güncellenmiş
    // olabilir. `id` kullanmak, ikinci bir rename'de cihazları sessizce
    // "yetim" bırakıyordu (group_id hiçbir gruba eşleşmiyor, cihazlar grup
    // listesinden kayboluyor).
    const currentRes = await pool.query('SELECT name FROM netops_groups WHERE id = $1', [id]);
    const currentName = currentRes.rows[0]?.name;

    await pool.query(`
      UPDATE netops_groups
      SET name = COALESCE(NULLIF($2, ''), name),
          description = $3
      WHERE id = $1;
    `, [id, newName, description]);

    // Eğer grup adı değiştiyse bağlı cihazların group_id'sini de güncelle
    if (newName && currentName && newName !== currentName) {
      await pool.query(`
        UPDATE netops_devices
        SET group_id = $2
        WHERE group_id = $1;
      `, [currentName, newName]);
    }

    return NextResponse.json({
      id,
      name: newName || currentName || id,
      description,
      device_count: 0
    });
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
      return NextResponse.json({ error: 'Silinecek grup ID belirtilmedi.' }, { status: 400 });
    }

    const pool = getDbPool();
    await ensureGroupsTable(pool);

    await pool.query(`DELETE FROM netops_groups WHERE id = $1;`, [id]);

    // İlgili cihazların grubunu boşa çıkar veya Merkez SD-WAN yap
    await pool.query(`
      UPDATE netops_devices
      SET group_id = 'Merkez SD-WAN'
      WHERE group_id = $1;
    `, [id]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}
