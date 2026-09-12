import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { validateMacAddress } from '@/lib/validation';
import { SDWAN_HUB_URL, resolveHubPeerId } from '@/lib/hub';
import { errorResponse, ErrorCodes } from '@/lib/api-response';

async function ensureNacTable(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS netops_nac_rules (
      id VARCHAR(100) PRIMARY KEY,
      device_id VARCHAR(100) NOT NULL,
      mac_address VARCHAR(50) NOT NULL,
      ip_address VARCHAR(50) DEFAULT '',
      hostname VARCHAR(100) DEFAULT '',
      role VARCHAR(50) DEFAULT 'standard',
      status VARCHAR(50) DEFAULT 'allowed',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(device_id, mac_address)
    );
  `);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get('device_id');
    const pool = getDbPool();
    await ensureNacTable(pool);

    // 1. Veritabanındaki tanımlı NAC kurallarını çek
    let query = `
      SELECT id, device_id, mac_address, ip_address, hostname, role, status, created_at, updated_at
      FROM netops_nac_rules
    `;
    const params: any[] = [];

    if (deviceId) {
      query += ` WHERE device_id = $1`;
      params.push(deviceId);
    }
    query += ` ORDER BY updated_at DESC`;

    const res = await pool.query(query, params);
    const existingRules = res.rows;
    const knownMacs = new Set(existingRules.map(r => r.mac_address.toUpperCase()));

    // 2. Hub'daki Canlı Telemetriden aktif DHCP Lease / ARP istemcilerini al (Zero-Hardcode & Dynamic Peer Fallback)
    let liveClients: Array<{ mac_address: string; ip_address: string; hostname: string }> = [];

    try {
      if (deviceId) {
        // Dinamik peer çözümleme: device_id, public_key veya Şube Adı adayları taranır
        const candidatePeerIds = await resolveHubPeerId(deviceId, pool);

        for (const candidateId of candidatePeerIds) {
          const lanRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers/${encodeURIComponent(candidateId)}/lan-clients`, { cache: 'no-store' });
          if (lanRes.ok) {
            const clients = await lanRes.json();
            if (Array.isArray(clients) && clients.length > 0) {
              liveClients.push(...clients);
              break; // Başarılı sonuç alındıysa döngüyü tamamla
            }
          }
        }
      }
    } catch (hubErr) {
      console.warn('Hub lan-clients fetch degraded gracefully:', hubErr);
    }

    // 3. Canlı telemetriden gelen istemcileri DB ile eşitle (Yeni ise ekle, IP/Hostname değiştiyse DB'yi güncelle)
    for (const c of liveClients) {
      const mac = (c.mac_address || '').toUpperCase();
      const ip = c.ip_address || '';
      const hostname = c.hostname || '';

      if (!mac) continue;

      const existingIndex = existingRules.findIndex(r => r.mac_address.toUpperCase() === mac);

      if (existingIndex >= 0) {
        // İstemci veritabanında var ama IP'si veya Hostname'i değişmişse DB'yi güncelle
        const existing = existingRules[existingIndex];
        if (existing.ip_address !== ip || (hostname && existing.hostname !== hostname)) {
          await pool.query(`
            UPDATE netops_nac_rules 
            SET ip_address = $1, hostname = COALESCE(NULLIF($2, ''), hostname), updated_at = NOW()
            WHERE id = $3;
          `, [ip, hostname, existing.id]).catch(() => {});

          existing.ip_address = ip;
          if (hostname) existing.hostname = hostname;
          existing.updated_at = new Date().toISOString();
        }
      } else {
        // Tamamen yeni keşfedilen istemci
        const newId = `nac-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        await pool.query(`
          INSERT INTO netops_nac_rules (id, device_id, mac_address, ip_address, hostname, role, status, updated_at)
          VALUES ($1, $2, $3, $4, $5, 'standard', 'allowed', NOW())
          ON CONFLICT (device_id, mac_address) DO UPDATE 
          SET ip_address = EXCLUDED.ip_address, hostname = EXCLUDED.hostname, updated_at = NOW();
        `, [newId, deviceId || '', mac, ip, hostname]).catch(() => {});

        existingRules.push({
          id: newId,
          device_id: deviceId || '',
          mac_address: mac,
          ip_address: ip,
          hostname: hostname,
          role: 'standard',
          status: 'allowed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        knownMacs.add(mac);
      }
    }

    return NextResponse.json({
      count: existingRules.length,
      results: existingRules
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
    await ensureNacTable(pool);

    const id = body.id || `nac-${Date.now()}`;
    const device_id = body.device_id;
    const mac_address = body.mac_address?.toUpperCase();
    const ip_address = body.ip_address || '';
    const hostname = body.hostname || '';
    const role = body.role || 'standard';
    const status = body.status || 'allowed'; // 'allowed' | 'quarantine' | 'blocked'

    if (!device_id || !mac_address) {
      return NextResponse.json({ error: 'device_id ve mac_address zorunludur' }, { status: 400 });
    }

    // GÜVENLİK: mac_address, aşağıda uzak cihaza gönderilen bir shell komut string'ine
    // (nft/iptables) doğrudan interpolе ediliyor - kesin MAC formatında olmayan hiçbir
    // değer bu noktadan geçmemelidir, aksi halde uç cihazda komut enjeksiyonu mümkün olur.
    if (!validateMacAddress(mac_address)) {
      return NextResponse.json({ error: 'Geçersiz MAC adresi formatı (xx:xx:xx:xx:xx:xx bekleniyor)' }, { status: 400 });
    }

    const query = `
      INSERT INTO netops_nac_rules (id, device_id, mac_address, ip_address, hostname, role, status, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (device_id, mac_address) DO UPDATE
      SET ip_address = EXCLUDED.ip_address,
          hostname = EXCLUDED.hostname,
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          updated_at = NOW()
      RETURNING *;
    `;

    const res = await pool.query(query, [id, device_id, mac_address, ip_address, hostname, role, status]);

    // 🛡️ Meraki Donanımına Canlı Zero-Trust NAC Enjeksiyonu (0ms Hardware Enforcement)
    try {
      const isBlocked = status === 'blocked' || status === 'quarantine';
      const actionPayload = isBlocked
        ? { BlockMac: { mac_address } }
        : { UnblockMac: { mac_address } };

      const rpcPayload = {
        device_id,
        command: isBlocked
          ? `nft add rule inet fw4 forward ether saddr ${mac_address.toLowerCase()} drop 2>/dev/null || iptables -I FORWARD -m mac --mac-source ${mac_address.toLowerCase()} -j DROP 2>/dev/null || true`
          : `iptables -D FORWARD -m mac --mac-source ${mac_address.toLowerCase()} -j DROP 2>/dev/null || true; /etc/init.d/firewall reload 2>/dev/null || true`,
        control_action: actionPayload
      };

      fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/commands/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcPayload)
      }).catch(() => {});
    } catch {}

    return NextResponse.json(res.rows[0], { status: 201 });
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
      return NextResponse.json({ error: 'Kural ID zorunludur' }, { status: 400 });
    }
    const pool = getDbPool();
    await ensureNacTable(pool);
    await pool.query('DELETE FROM netops_nac_rules WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}
