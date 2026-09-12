import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { successResponse, errorResponse, ErrorCodes } from '@/lib/api-response';
import { SDWAN_HUB_URL } from '@/lib/hub';

const HUB_TIMEOUT = 5000;

/**
 * Device Sync Endpoint
 *
 * Reconciles database devices with Rust Hub peers:
 * - Updates tunnel_ip if changed in Hub
 * - Updates device_id/name if mismatch found
 * - Identifies duplicate entries
 * - Cleans up stale/offline-only entries
 *
 * This prevents the issue where database and Hub get out of sync
 */
export async function POST(req: NextRequest) {
  try {
    const pool = getDbPool();
    const { action = 'sync', cleanupDuplicates = false } = await req.json();

    // Fetch Hub peers
    const hubRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers`, {
      signal: AbortSignal.timeout(HUB_TIMEOUT)
    });

    if (!hubRes.ok) {
      return NextResponse.json(
        errorResponse(
          ErrorCodes.INTERNAL_ERROR,
          `Rust Hub unreachable: ${hubRes.statusText}`,
          503
        ),
        { status: 503 }
      );
    }

    const hubData = await hubRes.json();
    const hubPeers = hubData.results || [];

    // Get database devices
    const dbRes = await pool.query('SELECT * FROM netops_devices');
    const dbDevices = dbRes.rows;

    const syncReport = {
      synced: 0,
      cleaned: 0,
      duplicates: [] as any[],
      mismatches: [] as any[],
      errors: [] as any[]
    };

    // Build MAC -> Peers mapping (Hub)
    const macToPeers: { [key: string]: any[] } = {};
    hubPeers.forEach((peer: any) => {
      const cleanMac = peer.mac_address?.replace(/[^A-F0-9]/gi, '').toUpperCase();
      if (cleanMac) {
        if (!macToPeers[cleanMac]) macToPeers[cleanMac] = [];
        macToPeers[cleanMac].push(peer);
      }
    });

    // Sync each database device
    for (const dbDevice of dbDevices) {
      const cleanMac = dbDevice.mac_address?.replace(/[^A-F0-9]/gi, '').toUpperCase();

      // Find matching peer(s)
      const matchingPeers = macToPeers[cleanMac] || [];

      if (matchingPeers.length === 0) {
        // No matching peer in Hub
        syncReport.mismatches.push({
          dbId: dbDevice.id,
          dbName: dbDevice.name,
          mac: dbDevice.mac_address,
          issue: 'No matching peer in Hub'
        });
        continue;
      }

      if (matchingPeers.length > 1) {
        // Multiple peers with same MAC
        syncReport.duplicates.push({
          mac: dbDevice.mac_address,
          deviceId: dbDevice.id,
          peers: matchingPeers.map((p: any) => ({
            id: p.device_id,
            ip: p.virtual_ip,
            status: p.status
          }))
        });

        if (cleanupDuplicates) {
          // En güncel (last_seen) ACTIVE peer'ı tercih et; yoksa en son görülen peer'ı al
          const activeMatches = matchingPeers.filter((p: any) => p.status === 'ACTIVE');
          const candidates = activeMatches.length > 0 ? activeMatches : matchingPeers;
          const targetPeer = candidates.reduce((best: any, current: any) =>
            (current.last_seen || 0) > (best.last_seen || 0) ? current : best
          );

          // NOT: `id` alanı PRIMARY KEY'dir ve netops_telemetry FK ile ona bağlıdır
          // (schema.sql'de ON UPDATE CASCADE tanımlı değil) - bu yüzden burada id
          // DEĞİŞTİRİLMEZ, sadece tunnel_ip/management_ip senkronize edilir. ID
          // uyuşmazlığı varsa mismatches raporuna düşer, manuel inceleme gerekir.
          try {
            await pool.query(
              `UPDATE netops_devices
               SET tunnel_ip = $1, management_ip = COALESCE($2, management_ip), last_seen = NOW()
               WHERE mac_address = $3`,
              [targetPeer.virtual_ip, targetPeer.management_ip, dbDevice.mac_address]
            );
            syncReport.synced++;
          } catch (err) {
            syncReport.errors.push({
              device: dbDevice.id,
              error: String(err)
            });
          }
        }
        continue;
      }

      // Tek eşleşen peer - gerekirse senkronize et (id KESİNLİKLE değiştirilmez, bkz. yukarıdaki not)
      const peer = matchingPeers[0];
      const needsSync =
        dbDevice.tunnel_ip !== peer.virtual_ip ||
        dbDevice.management_ip !== peer.management_ip;

      if (dbDevice.id !== peer.device_id) {
        syncReport.mismatches.push({
          dbId: dbDevice.id,
          hubId: peer.device_id,
          issue: 'Device ID Hub ile uyuşmuyor - otomatik değiştirilmedi (FK riski), manuel inceleme gerekli'
        });
      }

      if (needsSync) {
        try {
          await pool.query(
            `UPDATE netops_devices
             SET tunnel_ip = $1, management_ip = COALESCE($2, management_ip), last_seen = NOW()
             WHERE mac_address = $3`,
            [
              peer.virtual_ip,
              peer.management_ip,
              dbDevice.mac_address
            ]
          );
          syncReport.synced++;
        } catch (err) {
          syncReport.errors.push({
            device: dbDevice.id,
            error: String(err)
          });
        }
      }
    }

    return NextResponse.json(
      successResponse(syncReport, 'Device sync completed')
    );
  } catch (error: any) {
    console.error('Device sync error:', error);
    return NextResponse.json(
      errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        'Device sync failed: ' + error.message,
        500
      ),
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for checking sync status
 */
export async function GET() {
  return NextResponse.json(
    successResponse(
      { status: 'ready', endpoint: 'POST to sync devices' },
      'Device sync endpoint ready'
    )
  );
}
