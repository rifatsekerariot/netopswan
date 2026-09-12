export const SDWAN_HUB_URL = process.env.SDWAN_HUB_URL || 'http://127.0.0.1:8088';

/**
 * Dinamik Hub Peer Çözümleme Yardımcısı (Zero-Hardcode Rule & Multi-Stage Fallback)
 * 
 * Veritabanı ID'si, Şube Adı veya MAC adresi ne olursa olsun, Rust Hub üzerindeki
 * canlı peer'ların public_key, mac_address, device_id veya isim benzerlikleri üzerinden
 * eşleşen gerçek canlı Hub peer ID'sini çözer.
 */
export async function resolveHubPeerId(rawDeviceId: string, pool: any): Promise<string[]> {
  if (!rawDeviceId) return [];
  const candidateIds = new Set<string>([rawDeviceId]);

  try {
    // 1. Veritabanından cihazın bilinen kimliklerini çek
    const devRes = await pool.query(
      'SELECT id, name, mac_address, public_key, tunnel_ip FROM netops_devices WHERE id = $1 OR name = $1 OR mac_address = $1 OR public_key = $1',
      [rawDeviceId]
    );

    const dbDev = devRes.rows[0];
    if (dbDev) {
      if (dbDev.id) candidateIds.add(dbDev.id);
      if (dbDev.public_key) candidateIds.add(dbDev.public_key);
      if (dbDev.name) {
        candidateIds.add(dbDev.name);
        candidateIds.add(dbDev.name.replace(/\s+/g, '_'));
        candidateIds.add(`${dbDev.id}_SUBE`);
      }
    }

    const cleanMac = dbDev?.mac_address ? dbDev.mac_address.replace(/[^A-F0-9]/gi, '').toUpperCase() : '';
    const dbPubkey = dbDev?.public_key || '';

    // 2. Hub canlı peer listesini sorgula ve en güçlü eşleşmeyi başa al
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const hubRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers`, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (hubRes.ok) {
      const hubJson = await hubRes.json();
      const peers = hubJson.results || [];

      for (const p of peers) {
        const peerMac = p.mac_address ? p.mac_address.replace(/[^A-F0-9]/gi, '').toUpperCase() : '';
        const isMacMatch = cleanMac && peerMac && cleanMac === peerMac;
        const isPubkeyMatch = dbPubkey && p.public_key && dbPubkey === p.public_key;
        const isIdMatch = candidateIds.has(p.device_id) || candidateIds.has(p.public_key);

        if (isMacMatch || isPubkeyMatch || isIdMatch) {
          if (p.device_id) candidateIds.add(p.device_id);
          if (p.public_key) candidateIds.add(p.public_key);
        }
      }
    }
  } catch (err) {
    console.warn('Hub peer resolution fallback degraded gracefully:', err);
  }

  return Array.from(candidateIds);
}
