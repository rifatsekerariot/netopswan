import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { SDWAN_HUB_URL } from '@/lib/hub';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawTarget = body.device_id;
    let targetDeviceId = rawTarget;

    // Ortak Yapı (Single Source of Truth):
    // Ne gönderilirse gönderilsin (ID, Şube Adı vb.) Önce DB'den değişmez MAC adresini bul, sonra Hub'daki o MAC'e sahip canlı peer'a yönlendir.
    try {
      const pool = getDbPool();
      const devRes = await pool.query(
        'SELECT id, name, mac_address, public_key FROM netops_devices WHERE id = $1 OR name = $1 OR mac_address = $1',
        [rawTarget]
      );

      const targetDbDev = devRes.rows[0];
      const targetMac = targetDbDev?.mac_address?.replace(/[^A-F0-9]/gi, '') || '';
      const targetPubkey = targetDbDev?.public_key || '';

      const hubRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers`, { cache: 'no-store' });
      if (hubRes.ok) {
        const hubJson = await hubRes.json();
        const hubPeers = hubJson.results || [];

        const matchedPeer = hubPeers.find((p: any) => {
          const peerMac = p.mac_address?.replace(/[^A-F0-9]/gi, '') || '';
          return (
            (targetMac && peerMac && targetMac === peerMac) ||
            (targetPubkey && p.public_key && targetPubkey === p.public_key) ||
            p.device_id === rawTarget
          );
        });

        if (matchedPeer) {
          targetDeviceId = matchedPeer.device_id;
        }
      }
    } catch {}

    const payload = {
      ...body,
      device_id: targetDeviceId
    };

    const res = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/commands/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ status: 'error', output: 'Hub yanıt vermedi.' }, { status: 502 });
  } catch (err: any) {
    return NextResponse.json({ status: 'error', output: err.message }, { status: 500 });
  }
}
