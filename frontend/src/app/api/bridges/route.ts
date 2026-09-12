import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { validateCIDR, validateIPv4, validateWireguardKey } from '@/lib/validation';
import { SDWAN_HUB_URL } from '@/lib/hub';
import { errorResponse, ErrorCodes } from '@/lib/api-response';

async function ensureBridgesTable(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS netops_interbranch_bridges (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      source_device_id VARCHAR(100) NOT NULL,
      target_device_id VARCHAR(100) NOT NULL,
      source_subnet VARCHAR(50) NOT NULL,
      target_subnet VARCHAR(50) NOT NULL,
      status VARCHAR(20) DEFAULT 'ACTIVE',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(source_device_id, target_device_id)
    );
  `);
}

// 1. GET: Tüm aktif şubeler arası köprüleri çek
export async function GET() {
  try {
    const pool = getDbPool();
    await ensureBridgesTable(pool);

    const res = await pool.query(`
      SELECT 
        b.id,
        b.name,
        b.source_device_id,
        b.target_device_id,
        b.source_subnet,
        b.target_subnet,
        b.status,
        b.created_at,
        d1.name as source_name,
        d2.name as target_name,
        d1.tunnel_ip as source_tunnel_ip,
        d2.tunnel_ip as target_tunnel_ip
      FROM netops_interbranch_bridges b
      LEFT JOIN netops_devices d1 ON b.source_device_id = d1.id
      LEFT JOIN netops_devices d2 ON b.target_device_id = d2.id
      ORDER BY b.created_at DESC;
    `);

    return NextResponse.json({
      count: res.rows.length,
      results: res.rows
    });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

// 2. POST: Yeni Şubeler Arası Köprü Oluştur & Donanımlara Canlı Rota Bas
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { source_device_id, target_device_id, name } = body;

    if (!source_device_id || !target_device_id || source_device_id === target_device_id) {
      return NextResponse.json({ error: 'Geçerli iki farklı şube seçilmelidir.' }, { status: 400 });
    }

    const pool = getDbPool();
    await ensureBridgesTable(pool);

    // 1. Rust SD-WAN Hub'dan canlı peer'ları çekip eksikse PostgreSQL'e kaydet (Auto-Sync)
    try {
      const hubRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers`, { cache: 'no-store' });
      if (hubRes.ok) {
        const hubJson = await hubRes.json();
        const hubPeers = hubJson.results || [];
        for (const p of hubPeers) {
          await pool.query(`
            INSERT INTO netops_devices (id, name, model, mac_address, management_ip, tunnel_ip, lan_gateway, lan_subnet, public_key, status, last_seen)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'online', NOW())
            ON CONFLICT (id) DO UPDATE
            SET management_ip = EXCLUDED.management_ip, tunnel_ip = EXCLUDED.tunnel_ip,
                lan_gateway = COALESCE(NULLIF(EXCLUDED.lan_gateway, ''), netops_devices.lan_gateway),
                lan_subnet = COALESCE(NULLIF(EXCLUDED.lan_subnet, ''), netops_devices.lan_subnet),
                status = 'online', last_seen = NOW();
          `, [p.device_id, p.device_id, p.model || 'Ağ Cihazı', p.mac_address || '', p.management_ip || '', p.virtual_ip || '', p.lan_ip || '', p.lan_ip ? `${p.lan_ip.split('.').slice(0, 3).join('.')}.0/24` : '', p.public_key || p.device_id]);
        }
      }
    } catch {
      // Hub offline ise PostgreSQL'deki mevcut cihazlardan devam et
    }

    // İki cihazın donanım ve alt ağ bilgilerini PostgreSQL'den çek
    const devRes = await pool.query(
      `SELECT id, name, management_ip, tunnel_ip, lan_gateway, lan_subnet FROM netops_devices WHERE id IN ($1, $2)`,
      [source_device_id, target_device_id]
    );

    let d1 = devRes.rows.find(d => d.id === source_device_id);
    let d2 = devRes.rows.find(d => d.id === target_device_id);

    // Eğer arayüzden seçilen ID henüz DB'de yoksa canlı Hub eşleşmesinden dinamik oluştur
    if (!d1 || !d2) {
      let hubPeers: any[] = [];
      try {
        const hubRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers`, { cache: 'no-store' });
        if (hubRes.ok) {
          const hubJson = await hubRes.json();
          hubPeers = hubJson.results || [];
        }
      } catch {}

      if (!d1) {
        const p1 = hubPeers.find((p: any) => p.device_id === source_device_id);
        d1 = {
          id: source_device_id,
          name: source_device_id,
          management_ip: p1?.management_ip || '',
          tunnel_ip: p1?.virtual_ip || '',
          lan_gateway: p1?.lan_ip || '',
          lan_subnet: p1?.lan_ip ? `${p1.lan_ip.split('.').slice(0, 3).join('.')}.0/24` : ''
        };
        await pool.query(`
          INSERT INTO netops_devices (id, name, model, mac_address, management_ip, tunnel_ip, lan_gateway, lan_subnet, public_key, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'online')
          ON CONFLICT (id) DO NOTHING;
        `, [d1.id, d1.name, p1?.model || 'Ağ Cihazı', p1?.mac_address || '', d1.management_ip, d1.tunnel_ip, d1.lan_gateway, d1.lan_subnet, p1?.public_key || d1.id]);
      }

      if (!d2) {
        const p2 = hubPeers.find((p: any) => p.device_id === target_device_id);
        d2 = {
          id: target_device_id,
          name: target_device_id,
          management_ip: p2?.management_ip || '',
          tunnel_ip: p2?.virtual_ip || '',
          lan_gateway: p2?.lan_ip || '',
          lan_subnet: p2?.lan_ip ? `${p2.lan_ip.split('.').slice(0, 3).join('.')}.0/24` : ''
        };
        await pool.query(`
          INSERT INTO netops_devices (id, name, model, mac_address, management_ip, tunnel_ip, lan_gateway, lan_subnet, public_key, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'online')
          ON CONFLICT (id) DO NOTHING;
        `, [d2.id, d2.name, p2?.model || 'Ağ Cihazı', p2?.mac_address || '', d2.management_ip, d2.tunnel_ip, d2.lan_gateway, d2.lan_subnet, p2?.public_key || d2.id]);
      }
    }

    // LAN alt ağlarını çöz (ASLA WAN IP'si kullanılmamalı, sadece cihazın bildirdiği gerçek LAN alt ağı köprülenir)
    const resolveLanSubnet = (dev: any) => {
      if (dev.lan_subnet && dev.lan_subnet.includes('/')) return dev.lan_subnet;
      if (dev.lan_gateway && dev.lan_gateway.includes('.')) {
        return `${dev.lan_gateway.split('.').slice(0, 3).join('.')}.0/24`;
      }
      return null;
    };

    const s1Subnet = resolveLanSubnet(d1);
    const s2Subnet = resolveLanSubnet(d2);

    // GÜVENLİK: s1Subnet/s2Subnet, cihazların Hub'a bildirdiği (dolayısıyla ele
    // geçirilmiş/sahte bir agent tarafından kontrol edilebilecek) lan_ip'den türetilir
    // ve aşağıda shell komutlarına (iptables/ip route/nft) doğrudan interpolе edilir.
    // Kesin CIDR formatında OLMAYAN hiçbir değer bu noktadan geçmemelidir - aksi
    // halde host üzerinde root olarak komut enjeksiyonu mümkün olur.
    if (!s1Subnet || !validateCIDR(s1Subnet)) {
      return NextResponse.json({
        error: `Şube [${d1.name || source_device_id}] için aktif/geçerli bir yerel LAN alt ağı (br-lan) tespit edilemedi. Cihazın LAN arayüzünü kontrol ediniz.`
      }, { status: 400 });
    }

    if (!s2Subnet || !validateCIDR(s2Subnet)) {
      return NextResponse.json({
        error: `Şube [${d2.name || target_device_id}] için aktif/geçerli bir yerel LAN alt ağı (br-lan) tespit edilemedi. Cihazın LAN arayüzünü kontrol ediniz.`
      }, { status: 400 });
    }

    const bridgeId = `bridge-${Date.now()}`;
    const bridgeName = name || `${d1.name} ↔ ${d2.name} Hub Köprüsü`;

    // 1. Veritabanına kaydet
    await pool.query(`
      INSERT INTO netops_interbranch_bridges (id, name, source_device_id, target_device_id, source_subnet, target_subnet, status, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', NOW())
      ON CONFLICT (source_device_id, target_device_id) DO UPDATE
      SET source_subnet = EXCLUDED.source_subnet, target_subnet = EXCLUDED.target_subnet, status = 'ACTIVE', updated_at = NOW();
    `, [bridgeId, bridgeName, source_device_id, target_device_id, s1Subnet, s2Subnet]);

    // 2. Canlı Donanım Tünel & Rota Enjeksiyonu (Dinamik WireGuard / sdwan0 Başlatma)
    // Kesinlikle hardcoded fallback kullanılmaz; tünel IP'si canlı Hub/DB kaydından alınmalıdır
    // GÜVENLİK: tunnel_ip de aşağıda shell komutlarına interpolе edilir - CIDR/32
    // formatına indirgemeden önce kesin bir IPv4 olduğu doğrulanmalıdır.
    if (!d1.tunnel_ip || !validateIPv4(d1.tunnel_ip.split('/')[0])) {
      return NextResponse.json({
        error: `Şube [${d1.name || source_device_id}] için atanmış geçerli bir SD-WAN tünel IP'si bulunamadı. Cihazın Hub bağlantısını kontrol ediniz.`
      }, { status: 400 });
    }

    if (!d2.tunnel_ip || !validateIPv4(d2.tunnel_ip.split('/')[0])) {
      return NextResponse.json({
        error: `Şube [${d2.name || target_device_id}] için atanmış geçerli bir SD-WAN tünel IP'si bulunamadı. Cihazın Hub bağlantısını kontrol ediniz.`
      }, { status: 400 });
    }

    // Hub'dan canlı peer anahtarlarını ve tünel durumlarını dinamik sorgula
    let hubPeers: any[] = [];
    try {
      const hubRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers`, { cache: 'no-store' });
      if (hubRes.ok) {
        const hubJson = await hubRes.json();
        hubPeers = hubJson.results || [];
      }
    } catch {}

    const p1 = hubPeers.find((p: any) => p.device_id === source_device_id || p.mac_address === d1.mac_address);
    const p2 = hubPeers.find((p: any) => p.device_id === target_device_id || p.mac_address === d2.mac_address);

    let hub_pubkey_for_spokes = '';
    try {
      const fs = await import('fs');
      if (fs.existsSync('/etc/netops/hub_identity.key')) {
        const privB64 = fs.readFileSync('/etc/netops/hub_identity.key', 'utf8').trim();
        const { execFileSync } = await import('child_process');
        // GÜVENLİK: shell string interpolasyonu yerine execFileSync + argv dizisi
        // kullanılıyor (stdin ile veri geçiriliyor) - private key içeriği shell
        // metakarakterleri içerse bile komut enjeksiyonuna yol açmaz.
        hub_pubkey_for_spokes = execFileSync('wg', ['pubkey'], { input: privB64 }).toString().trim();
      }
    } catch {}

    const d1PubkeyRaw = p1?.public_key || d1.public_key || '';
    const d2PubkeyRaw = p2?.public_key || d2.public_key || '';
    // GÜVENLİK: pubkey'ler aşağıda `wg set` komutuna interpolе edilir - yalnızca
    // geçerli WireGuard base64 anahtar formatındaki değerler kabul edilir.
    const d1Pubkey = validateWireguardKey(d1PubkeyRaw) ? d1PubkeyRaw : '';
    const d2Pubkey = validateWireguardKey(d2PubkeyRaw) ? d2PubkeyRaw : '';

    const d1TunnelIp = d1.tunnel_ip.includes('/') ? d1.tunnel_ip : `${d1.tunnel_ip}/24`;
    const d2TunnelIp = d2.tunnel_ip.includes('/') ? d2.tunnel_ip : `${d2.tunnel_ip}/24`;
    const d1TunnelRaw = d1TunnelIp.split('/')[0];
    const d2TunnelRaw = d2TunnelIp.split('/')[0];

    // NOT (2026-08-22): `nft add rule inet fw4 forward ...` önceden doğrudan fw4'ün
    // KENDİ zincirine ekleniyordu. Bu komut metninde "ip route" geçtiği için agent'ın
    // `is_route_or_net_cmd` mantığı bu komuttan HEMEN SONRA otomatik bir
    // `/etc/init.d/firewall reload` tetikliyor - fw4, reload'da tüm tablolarını UCI'dan
    // sıfırdan ürettiği için bu ad-hoc kural, agent'ın KENDİ tetiklediği reload
    // tarafından anında siliniyordu (köprü, oluşturulduğu an bozuluyordu). Kamera QoS
    // ve NAC blokları için zaten kullanılan desen izlenerek artık kendi ayrı
    // `inet netops_bridge` tablomuzda çalışıyoruz - fw4 reload bunu silmez. Aynı köprü
    // tekrar oluşturulursa/istek retry edilirse kural katlanmasın diye önce `nft list`
    // ile var olup olmadığı kontrol ediliyor (idempotent).
    const nftBridgeSetup = `nft add table inet netops_bridge 2>/dev/null; nft 'add chain inet netops_bridge fwd { type filter hook forward priority -5; }' 2>/dev/null`;

    // 1. Şube 1 (ARIOT) için komut: Şube 2'nin alt ağını tünel (sdwan0) üzerinden yönlendir
    const cmd1 = `
ip route replace ${s2Subnet} dev sdwan0 2>/dev/null || ip route add ${s2Subnet} dev sdwan0 2>/dev/null || true;
${nftBridgeSetup};
nft list chain inet netops_bridge fwd 2>/dev/null | grep -q "ip daddr ${s2Subnet} accept" || nft add rule inet netops_bridge fwd ip daddr ${s2Subnet} accept 2>/dev/null || iptables -C FORWARD -d ${s2Subnet} -j ACCEPT 2>/dev/null || iptables -A FORWARD -d ${s2Subnet} -j ACCEPT 2>/dev/null || true;
`;

    // 2. Şube 2 (Netfix) için komut: Şube 1'in alt ağını tünel (sdwan0) üzerinden yönlendir
    const cmd2 = `
ip route replace ${s1Subnet} dev sdwan0 2>/dev/null || ip route add ${s1Subnet} dev sdwan0 2>/dev/null || true;
${nftBridgeSetup};
nft list chain inet netops_bridge fwd 2>/dev/null | grep -q "ip daddr ${s1Subnet} accept" || nft add rule inet netops_bridge fwd ip daddr ${s1Subnet} accept 2>/dev/null || iptables -C FORWARD -d ${s1Subnet} -j ACCEPT 2>/dev/null || iptables -A FORWARD -d ${s1Subnet} -j ACCEPT 2>/dev/null || true;
`;

    // 3. 🛡️ Merkez Hub Linux Çekirdeğinde Spoke-to-Spoke Forwarding Kurallarını Koşulsuz Enjekte Et
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // NOT (2026-08-22): Önceden `iptables -I NETOPS_BRIDGES 1 ...` koşulsuz insert
    // kullanıyordu - aynı köprü birden fazla kez oluşturulursa (veya bu istek retry
    // edilirse) NETOPS_BRIDGES zincirinde birebir aynı kural birikirdi. Hub'ın kendi
    // başlangıç kodunda da (netops-hub/src/main.rs) aynı sınıf hata production'da 87+
    // kopya kurala yol açtığı için tespit edildi - burada da `-C` (check) ile önce kural
    // var mı bakılıyor, aynı köprü tekrar oluşturulursa/retry edilirse kural katlanmıyor.
    await execAsync(`
      iptables -C NETOPS_BRIDGES -s ${s1Subnet} -d ${s2Subnet} -j ACCEPT 2>/dev/null || iptables -I NETOPS_BRIDGES 1 -s ${s1Subnet} -d ${s2Subnet} -j ACCEPT 2>/dev/null || true;
      iptables -C NETOPS_BRIDGES -s ${s2Subnet} -d ${s1Subnet} -j ACCEPT 2>/dev/null || iptables -I NETOPS_BRIDGES 1 -s ${s2Subnet} -d ${s1Subnet} -j ACCEPT 2>/dev/null || true;
      ${d1TunnelRaw && d2TunnelRaw ? `
        iptables -C NETOPS_BRIDGES -s ${d1TunnelRaw}/32 -d ${d2TunnelRaw}/32 -j ACCEPT 2>/dev/null || iptables -I NETOPS_BRIDGES 1 -s ${d1TunnelRaw}/32 -d ${d2TunnelRaw}/32 -j ACCEPT 2>/dev/null || true;
        iptables -C NETOPS_BRIDGES -s ${d2TunnelRaw}/32 -d ${d1TunnelRaw}/32 -j ACCEPT 2>/dev/null || iptables -I NETOPS_BRIDGES 1 -s ${d2TunnelRaw}/32 -d ${d1TunnelRaw}/32 -j ACCEPT 2>/dev/null || true;
      ` : ''}
      ${d1Pubkey ? `wg set sdwan0 peer ${d1Pubkey} allowed-ips ${s1Subnet},${d1TunnelRaw}/32 2>/dev/null || true;` : ''}
      ${d2Pubkey ? `wg set sdwan0 peer ${d2Pubkey} allowed-ips ${s2Subnet},${d2TunnelRaw}/32 2>/dev/null || true;` : ''}
    `).catch(() => {});

    // Uç noktalara canlı komutları fırlat (Cihazın gerçek Hub ID'sini kullan: p1?.device_id || source_device_id)
    const hubDevId1 = p1?.device_id || source_device_id;
    const hubDevId2 = p2?.device_id || target_device_id;

    await Promise.all([
      fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/commands/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: hubDevId1, command: cmd1 })
      }).catch(() => {}),
      fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/commands/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: hubDevId2, command: cmd2 })
      }).catch(() => {})
    ]);

    return NextResponse.json({
      success: true,
      bridge: {
        id: bridgeId,
        name: bridgeName,
        source_device_id,
        target_device_id,
        source_subnet: s1Subnet,
        target_subnet: s2Subnet,
        status: 'ACTIVE'
      }
    });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

// 3. DELETE: Şubeler Arası Köprüyü Kaldır & Rotayı / Tüneli Temizle
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Köprü ID zorunludur.' }, { status: 400 });
    }

    const pool = getDbPool();
    const res = await pool.query(`DELETE FROM netops_interbranch_bridges WHERE id = $1 RETURNING *;`, [id]);

    if (res.rows.length > 0) {
      const b = res.rows[0];
      // 1. Donanım uç noktalarındaki rotaları VE izin kuralını anında temizle
      // NOT (2026-08-22): Önceden sadece `ip route del` yapılıyordu - POST handler'ın
      // eklediği `nft ... accept` kuralı (bkz. cmd1/cmd2, artık `inet netops_bridge`
      // tablosunda) burada hiç temizlenmiyordu; köprü silinse bile forward izni
      // kalıcı olarak açık kalıyordu.
      const delCmd1 = `ip route del ${b.target_subnet} dev sdwan0 2>/dev/null || true; nft delete rule inet netops_bridge fwd $(nft -a list chain inet netops_bridge fwd 2>/dev/null | grep "ip daddr ${b.target_subnet} accept" | grep -o 'handle [0-9]*' | awk '{print $2}' | sed 's/^/handle /') 2>/dev/null || true;`;
      const delCmd2 = `ip route del ${b.source_subnet} dev sdwan0 2>/dev/null || true; nft delete rule inet netops_bridge fwd $(nft -a list chain inet netops_bridge fwd 2>/dev/null | grep "ip daddr ${b.source_subnet} accept" | grep -o 'handle [0-9]*' | awk '{print $2}' | sed 's/^/handle /') 2>/dev/null || true;`;

      // 2. Hub üzerindeki izin kuralını ve doğrudan bağlantı yetkisini kaldır (Zero-Trust Teardown)
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      await execAsync(`
        while iptables -D NETOPS_BRIDGES -s ${b.source_subnet} -d ${b.target_subnet} -j ACCEPT 2>/dev/null; do :; done;
        while iptables -D NETOPS_BRIDGES -s ${b.target_subnet} -d ${b.source_subnet} -j ACCEPT 2>/dev/null; do :; done;
        conntrack -D -s ${b.source_subnet} 2>/dev/null || true;
        conntrack -D -d ${b.source_subnet} 2>/dev/null || true;
        conntrack -D -s ${b.target_subnet} 2>/dev/null || true;
        conntrack -D -d ${b.target_subnet} 2>/dev/null || true;
      `).catch(() => {});

      // Hub'daki canlı peer'ları çek
      let hubPeers: any[] = [];
      try {
        const hubRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers`, { cache: 'no-store' });
        if (hubRes.ok) {
          const hubJson = await hubRes.json();
          hubPeers = hubJson.results || [];
        }
      } catch {}

      // NOT: `p.mac_address === b.source_device_id` karşılaştırması bir MAC alanını bir
      // device_id değeriyle kıyaslıyordu - biçimleri asla eşleşemeyeceği için bu fallback
      // hiçbir zaman gerçek bir eşleşme üretmiyordu (POST handler'daki doğru desende
      // MAC, device_id değil device'ın KENDİ mac_address'iyle kıyaslanır). Kaldırıldı.
      const p1 = hubPeers.find((p: any) => p.device_id === b.source_device_id);
      const p2 = hubPeers.find((p: any) => p.device_id === b.target_device_id);
      const hubDevId1 = p1?.device_id || b.source_device_id;
      const hubDevId2 = p2?.device_id || b.target_device_id;

      await Promise.all([
        fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/commands/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: hubDevId1, command: delCmd1 })
        }).catch(() => {}),
        fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/commands/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: hubDevId2, command: delCmd2 })
        }).catch(() => {})
      ]);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}
