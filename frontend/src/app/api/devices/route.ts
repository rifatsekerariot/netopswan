import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { errorResponse, ErrorCodes } from '@/lib/api-response';
import { validateDeviceName, validateMacAddress, validateCIDR, validateIPv4, clampNumber, parseIntSafely, netmaskFromCIDR } from '@/lib/validation';
import { SDWAN_HUB_URL } from '@/lib/hub';

const HUB_TIMEOUT = parseIntSafely(process.env.SDWAN_HUB_TIMEOUT_MS, 5000);

export async function GET(request: NextRequest) {
  try {
    const pool = getDbPool();
    const { searchParams } = request.nextUrl;
    const page = clampNumber(parseIntSafely(searchParams.get('page'), 1), 1, 1000);
    const limit = clampNumber(parseIntSafely(searchParams.get('limit'), 10), 1, 100);
    const offset = (page - 1) * limit;

    // Fetch live peers from Rust Hub with timeout
    let activeHubPeers: any[] = [];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HUB_TIMEOUT);

      const hubRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers`, {
        cache: 'no-store',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (hubRes.ok) {
        const hubJson = await hubRes.json();
        activeHubPeers = hubJson.results || [];
      }
    } catch (err) {
      console.error('Rust Hub connection failed:', SDWAN_HUB_URL, err);
      // Continue with database-only data if Hub unavailable
    }

    // 2. Server-Driven SQL View (v_unified_devices) Üzerinden Tekil Doğru Veriyi Çek
    const viewRes = await pool.query('SELECT * FROM v_unified_devices ORDER BY created_at DESC');
    const dbDevices = viewRes.rows.filter((d: any) => !d.id.startsWith('edge-') && d.id.length < 35);

    let lockedTemplateNames: string[] = [];
    try {
      const tplRes = await pool.query("SELECT name FROM netops_templates WHERE name LIKE 'WAN-Killswitch-%'");
      lockedTemplateNames = tplRes.rows.map((r: any) => r.name);
    } catch {}

    // 3. Sunucu Tarafında Bütünsel Nesneleri Oluştur (Arayüzde Sıfır Hesaplama Mantığı)
    //
    // Cihaz <-> Hub peer eşleştirmesi ÖNCELİK TURLARI (round) halinde, TÜM cihazlar
    // için topluca yapılır - tek tek cihaz sırasına göre AÇGÖZLÜ (greedy) eşleştirme
    // YAPILMAZ. Neden: cihazlar `created_at DESC` sırasıyla işlenirse, daha SONRA
    // oluşturulmuş ama sadece ZAYIF bir sinyalle (örn. isim benzerliği) eşleşen bir
    // cihaz, GÜÇLÜ bir sinyalle (örn. MAC) eşleşecek başka bir cihazdan ÖNCE davranıp
    // ortak peer'ı çalabiliyordu. Production'da tam olarak gözlemlendi: "Netfix Sube"
    // adı tesadüfen Hub'ın (yanlış etiketlenmiş) "Netfix_Sube" device_id'siyle
    // string eşleşiyordu ve önce işlendiği için, gerçek MAC sahibi "Ariot Sube" hiç
    // sıra bulamadan peer'ı kaybediyordu. Şimdi: önce TÜM cihazlarda public_key
    // denenir, sonra TÜM cihazlarda device_id, sonra TÜM cihazlarda MAC, vs. - bir
    // öncelik seviyesi TÜM cihazlar için tüketilmeden bir alt seviyeye inilmez.
    const claimedPeerKeys = new Set<string>();
    const peerKey = (p: any) => p.public_key || p.device_id || p.virtual_ip;
    const matchedPeerByDevice = new Map<number, any>();

    function findMacMatch(d: any, availablePeers: any[]) {
      if (!d.mac_address) return null;
      const cleanMac = d.mac_address.replace(/[^A-F0-9]/gi, '').toUpperCase();
      const macMatches = availablePeers.filter((p: any) =>
        p.mac_address && p.mac_address.replace(/[^A-F0-9]/gi, '').toUpperCase() === cleanMac
      );
      if (macMatches.length === 0) return null;
      if (macMatches.length === 1) return macMatches[0];
      // Hub'da aynı MAC için birden fazla (stale/duplicate/yeniden adlandırılmış) peer
      // kaydı olabilir; ACTIVE + en güncel last_seen olanı seçiyoruz.
      const activeMatches = macMatches.filter((p: any) => p.status === 'ACTIVE');
      const candidates = activeMatches.length > 0 ? activeMatches : macMatches;
      return candidates.reduce((best: any, current: any) =>
        (current.last_seen || 0) > (best.last_seen || 0) ? current : best
      );
    }

    const matchRounds: Array<(d: any, availablePeers: any[]) => any> = [
      // 1. Public key eşleştirmesi (en güvenilir)
      (d, avail) => (d.public_key ? avail.find((p: any) => p.public_key === d.public_key) : null),
      // 2. Device ID eşleştirmesi (database ID'si Hub'daki device_id ile aynı)
      (d, avail) => (d.id ? avail.find((p: any) => p.device_id === d.id) : null),
      // 3. MAC address eşleştirmesi (donanım kimliği)
      (d, avail) => findMacMatch(d, avail),
      // 4. Tunnel IP eşleştirmesi (son çarelerden biri - DB'deki tunnel_ip bayat/yanlış
      // olabilir, bu yüzden MAC'ten SONRA gelir; aksi halde dairesel bir tuzağa düşülür:
      // bayat IP, Hub'daki eski/stale bir peer'la tesadüfen eşleşip kendini "doğrular")
      (d, avail) => (d.tunnel_ip
        ? avail.find((p: any) =>
            p.virtual_ip === d.tunnel_ip || p.virtual_ip?.split('/')[0] === d.tunnel_ip?.split('/')[0]
          )
        : null),
      // 5. İsim bazlı eşleştirme (EN SON çare - salt string benzerliği, donanım
      // kimliğiyle ilgisi yok; Hub'daki device_id etiketleri elle/yanlış girilmiş
      // olabilir, bu yüzden en düşük güven seviyesindedir)
      (d, avail) => {
        if (!d.name) return null;
        const normalizedName = d.name.replace(/\s+/g, '_');
        return avail.find((p: any) =>
          p.device_id === `${d.id}_SUBE` ||
          p.device_id === normalizedName ||
          p.device_id?.toLowerCase() === d.name.toLowerCase()
        );
      }
    ];

    for (const matchFn of matchRounds) {
      for (let i = 0; i < dbDevices.length; i++) {
        if (matchedPeerByDevice.has(i)) continue;
        const availablePeers = activeHubPeers.filter((p: any) => !claimedPeerKeys.has(peerKey(p)));
        const peer = matchFn(dbDevices[i], availablePeers);
        if (peer) {
          matchedPeerByDevice.set(i, peer);
          claimedPeerKeys.add(peerKey(peer));
        }
      }
    }

    const results = dbDevices.map((d: any, i: number) => {
      const isTemplateLocked = lockedTemplateNames.some(tn => tn === `WAN-Killswitch-${d.name}` || tn === `WAN-Killswitch-${d.id}`);
      const peer = matchedPeerByDevice.get(i) || null;

      if (!peer && activeHubPeers.length > 0) {
        console.warn(`Device match failed: DB[${d.id}/${d.name}] MAC[${d.mac_address}] IP[${d.tunnel_ip}]`);
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const isOnline = peer ? (peer.status === 'ACTIVE' || (peer.last_seen ? (nowSec - peer.last_seen) <= 180 : true)) : (d.status === 'online');

      // Canlı Hub'dan gelen gerçek kurumsal şube tüneli IP'si (Örn: 10.8.0.5)
      const liveTunnelIp = peer?.virtual_ip || d.tunnel_ip || '';
      // Cihazın kendi telemetrisinde bildirdiği fiilen yapılandırılmış tünel IP'si -
      // Hub'ın kayıt anında ATADIĞI IP'den (liveTunnelIp) farklı olabilir (tünel yeniden
      // kurulduğunda vb.), bu yüzden arayüzde bu öncelikli gösterilir.
      const agentReportedTunnelIp = peer?.tunnel_ip || '';
      const liveManagementIp = peer?.management_ip || d.management_ip || '';
      const liveUptimeSeconds = peer?.uptime_seconds || 0;
      const liveLanGateway = d.lan_gateway ? `${d.lan_gateway}/24` : (d.lan_subnet || '');

      // Canlı tünel IP'si değişmişse PostgreSQL veritabanında da arka planda güncelle (Single Source of Truth)
      if (peer?.virtual_ip && peer.virtual_ip !== d.tunnel_ip) {
        pool.query('UPDATE netops_devices SET tunnel_ip = $1, last_seen = NOW() WHERE id = $2', [peer.virtual_ip, d.id]).catch(() => {});
      }

      // 🔒 FAZ 1 - KİMLİK ÖZ-İYİLEŞTİRME: `netops_devices.public_key` şemada zaten var
      // ve eşleştirme turlarında (yukarıda matchRounds[0]) EN GÜÇLÜ/ilk denenen sinyal -
      // ama kayıt anında hiç doldurulmadığı için pratikte hep boş kalıp MAC/isim gibi
      // daha zayıf, sezgisel turlara düşülmesine sebep oluyordu (bkz. "Netfix Şube" vs
      // "Ariot Şube" MAC çakışması yorumu, satır 57-60). Bu cihaz bu istekte GÜÇLÜ bir
      // sinyalle (MAC/tunnel_ip/isim - round 2+) eşleştiyse, kazanan peer'ın public_key'i
      // kalıcı olarak yazılır - bir sonraki istekte artık Round 1 (public_key) doğrudan
      // ve KESİN olarak eşleşir, sezgisel turlara bir daha hiç düşülmez. Hub'a yeni bir
      // Postgres bağımlılığı eklemeden (mevcut tunnel_ip deseniyle birebir tutarlı),
      // sadece Next.js tarafından, fire-and-forget şekilde yapılır.
      if (peer?.public_key && peer.public_key !== d.public_key) {
        pool.query('UPDATE netops_devices SET public_key = $1 WHERE id = $2', [peer.public_key, d.id]).catch(() => {});
      }

      // 4. Canlı Hub Telemetrilerini %100 Gerçek Olarak PostgreSQL netops_telemetry Tablosuna Yaz
      if (peer && isOnline) {
        pool.query(`
          INSERT INTO netops_telemetry (device_id, cpu_usage_pct, ram_used_mb, ram_total_mb, rtt_ms, jitter_ms, packet_loss_pct, tx_bytes, rx_bytes, recorded_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        `, [
          d.id,
          peer.cpu_usage_pct || 0,
          peer.ram_used_mb || 0,
          peer.ram_total_mb || 2048,
          peer.rtt_ms || 0,
          peer.jitter_ms || 0.5,
          peer.packet_loss_pct || 0,
          peer.tx_bytes || 0,
          peer.rx_bytes || 0
        ]).catch(() => {});
      }

      return {
        id: d.id,
        name: d.name,
        serial_number: d.serial_number || '',
        model: d.model || 'Cisco Meraki MX64',
        mac_address: d.mac_address || (peer?.mac_address || ''),
        management_ip: liveManagementIp,
        tunnel_ip: liveTunnelIp,
        last_ip: liveTunnelIp,
        ip_address: d.lan_subnet || liveTunnelIp || '',
        lan_subnet: d.lan_subnet || '',
        lan_gateway: d.lan_gateway || '',
        dhcp_enabled: d.dhcp_enabled !== false,
        status: isOnline ? 'online' : 'offline',
        cpu_usage_pct: peer?.cpu_usage_pct || 0,
        ram_used_mb: peer?.ram_used_mb || 0,
        ram_total_mb: peer?.ram_total_mb || 2048,
        ram_usage_pct: peer?.ram_total_mb ? Math.round(((peer.ram_used_mb || 0) / peer.ram_total_mb) * 100) : (peer?.ram_used_mb ? Math.round((peer.ram_used_mb / 2048) * 100) : 0),
        rtt_ms: peer?.rtt_ms || 0,
        uptime_seconds: liveUptimeSeconds,
        lan_client_count: peer?.lan_client_count || 0,
        active_camera_sessions: peer?.active_camera_sessions || 0,
        agent_version: peer?.agent_version || '',
        active_wan_interface: d.active_wan_interface || 'wan',
        group: d.group_id || 'Genel',
        created: d.created_at,
        modified: d.last_seen,
        firewall_mode: isTemplateLocked ? 'LOCKED' : 'OPEN',
        is_wan_locked_hw: isTemplateLocked,
        // İstemci (Frontend) için sunucuda %100 hesaplanmış hazır arayüz dizisi
        interfaces: [
          { name: 'LAN Arayüzü', type: 'Yerel Ağ Köprüsü', status: isOnline ? 'up' : 'down', ip: liveLanGateway || 'Atanmadı', mac: d.mac_address || '-' },
          { name: 'WAN Arayüzü', type: 'İnternet Bağlantısı', status: isOnline ? 'up' : 'down', ip: liveManagementIp || 'Atanmadı', mac: d.mac_address || '-' },
          { name: 'Kurumsal Şube Tüneli', type: 'Merkez Ofis Bağlantısı (Overlay)', status: isOnline ? 'up' : 'down', ip: agentReportedTunnelIp || liveTunnelIp || 'Atanmadı' }
        ]
      };
    });

    // NOT: frontend/src/lib/api.ts::fetchDevices() üst seviyede `results` alanı bekliyor.
    // Bu sözleşmeyi değiştirmek client'ı güncellemeden yapılırsa tablo sessizce boşalır
    // (önceki bir commit'te tam olarak bu hataya düşüldü) - bu yüzden düz format korunuyor.
    return NextResponse.json({
      count: results.length,
      next: null,
      previous: null,
      results
    });
  } catch (err: any) {
    console.error('Get devices error:', err);
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const pool = getDbPool();

    // Validate input
    const name = (body.name || '').trim();
    if (!name || !validateDeviceName(name)) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'Geçersiz şube/cihaz adı (1-128 karakter; harf, rakam, boşluk, tire, alt çizgi, parantez kullanılabilir)',
        400
      );
      return NextResponse.json(response, { status });
    }

    if (body.mac_address && !validateMacAddress(body.mac_address)) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid MAC address format',
        400
      );
      return NextResponse.json(response, { status });
    }

    if (body.lan_subnet && !validateCIDR(body.lan_subnet)) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid LAN subnet format (use CIDR notation)',
        400
      );
      return NextResponse.json(response, { status });
    }

    if (body.tunnel_ip && !validateIPv4(body.tunnel_ip)) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid tunnel IP format',
        400
      );
      return NextResponse.json(response, { status });
    }

    const id = `device-${Date.now()}`;
    const serial = body.serial_number || `SN-${id}`;
    const mac = body.mac_address || '';
    const model = body.model || 'Network Device';
    const group_id = body.group || '';

    let lan_subnet = body.lan_subnet || '';
    let lan_gateway = body.lan_gateway || '';
    let tunnel_ip = body.tunnel_ip || '';

    // Dynamically allocate from IPAM if not provided
    if (!lan_subnet || !tunnel_ip) {
      try {
        const subnetsRes = await pool.query("SELECT subnet, gateway, type FROM netops_subnets ORDER BY created_at ASC");
        const branchPool = subnetsRes.rows.find(s => s.type === 'branch_lan');
        const tunnelPool = subnetsRes.rows.find(s => s.type === 'sdwan_tunnel');

        if (!lan_subnet && branchPool && validateCIDR(branchPool.subnet)) {
          lan_subnet = branchPool.subnet;
          lan_gateway = branchPool.gateway;
        }
        if (!tunnel_ip && tunnelPool) {
          // Use next available IP in pool (safer than random)
          const base = tunnelPool.subnet.split('.').slice(0, 3).join('.');
          const randomOctet = clampNumber(Math.floor(Math.random() * 200) + 10, 1, 254);
          tunnel_ip = `${base}.${randomOctet}`;
        }
      } catch (err) {
        console.error('IPAM allocation failed:', err);
      }
    }

    if (!lan_gateway && lan_subnet) {
      lan_gateway = lan_subnet.replace('/24', '').replace('/22', '').replace(/\.0$/, '.1');
    }

    // IPAM SENKRONİZASYONU: Kullanıcı IPAM'da kayıtlı olmayan yeni bir LAN subnet'i
    // elle girdiyse (dropdown'daki "Manuel / Yeni Subnet" seçeneği), bu subnet otomatik
    // olarak netops_subnets'e (IPAM havuzu) de kaydedilir - böylece bir sonraki cihaz
    // eklemede bu subnet IPAM listesinden seçilebilir hale gelir ve IPAM ile fleet
    // arasında manuel senkronizasyon ihtiyacı ortadan kalkar.
    if (lan_subnet && validateCIDR(lan_subnet)) {
      try {
        const existingSubnet = await pool.query(
          'SELECT id FROM netops_subnets WHERE subnet = $1 LIMIT 1',
          [lan_subnet]
        );
        if (existingSubnet.rows.length === 0) {
          const subnetId = `subnet-${Date.now()}`;
          await pool.query(
            `INSERT INTO netops_subnets (id, name, subnet, gateway, type, region_group, description)
             VALUES ($1, $2, $3, $4, 'branch_lan', $5, $6)
             ON CONFLICT (subnet) DO NOTHING`,
            [
              subnetId,
              `${name} LAN`,
              lan_subnet,
              lan_gateway || lan_subnet.replace(/\/\d+$/, '').replace(/\.0$/, '.1'),
              group_id || 'Merkez SD-WAN',
              `"${name}" şubesi eklenirken otomatik oluşturuldu`
            ]
          );
        }
      } catch (err) {
        console.error('IPAM auto-register failed:', err);
      }
    }

    // CHECK FOR DUPLICATE TUNNEL IP (UNIQUE CONSTRAINT)
    if (tunnel_ip) {
      const existingIpRes = await pool.query(
        'SELECT id, name FROM netops_devices WHERE tunnel_ip = $1 LIMIT 1',
        [tunnel_ip]
      );

      if (existingIpRes.rows.length > 0) {
        const existing = existingIpRes.rows[0];
        const { response, status } = errorResponse(
          ErrorCodes.DUPLICATE_ENTRY,
          `Tunnel IP ${tunnel_ip} is already assigned to device "${existing.name}" (${existing.id})`,
          409
        );
        return NextResponse.json(response, { status });
      }
    }

    // CHECK FOR DUPLICATE MAC ADDRESS (within same name/group to allow re-registration)
    if (mac && name) {
      const existingMacRes = await pool.query(
        'SELECT id, name FROM netops_devices WHERE mac_address = $1 AND name != $2',
        [mac, name]
      );

      if (existingMacRes.rows.length > 0) {
        const existing = existingMacRes.rows[0];
        console.warn(
          `MAC address ${mac} already registered to device "${existing.name}". ` +
          `This may indicate duplicate entries in the database.`
        );
        // Still allow creation, but log warning for manual cleanup
      }
    }

    await pool.query(`
      INSERT INTO netops_devices (id, name, serial_number, mac_address, model, tunnel_ip, lan_subnet, lan_gateway, public_key, group_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'offline')
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, mac_address = EXCLUDED.mac_address, model = EXCLUDED.model,
          group_id = EXCLUDED.group_id, lan_subnet = EXCLUDED.lan_subnet, lan_gateway = EXCLUDED.lan_gateway;
    `, [id, name, serial, mac, model, tunnel_ip, lan_subnet, lan_gateway, `KEY-${id}`, group_id]);

    return NextResponse.json({
      id,
      name,
      mac_address: mac,
      model,
      group: group_id,
      ip_address: tunnel_ip,
      lan_subnet,
      lan_gateway,
      status: 'offline',
      created: new Date().toISOString()
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
    const targetId = id || body.id;

    if (!targetId) {
      return NextResponse.json({ error: 'Cihaz ID zorunludur' }, { status: 400 });
    }

    const pool = getDbPool();
    // Kolonun varlığını garantiye al
    await pool.query('ALTER TABLE netops_devices ADD COLUMN IF NOT EXISTS dhcp_enabled BOOLEAN DEFAULT true;').catch(() => {});

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (body.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(body.name);
    }
    if (body.group !== undefined || body.group_id !== undefined) {
      updates.push(`group_id = $${paramIndex++}`);
      values.push(body.group || body.group_id);
    }
    if (body.lan_subnet !== undefined) {
      updates.push(`lan_subnet = $${paramIndex++}`);
      values.push(body.lan_subnet);
    }
    if (body.lan_gateway !== undefined) {
      updates.push(`lan_gateway = $${paramIndex++}`);
      values.push(body.lan_gateway);
    }
    if (body.dhcp_enabled !== undefined) {
      updates.push(`dhcp_enabled = $${paramIndex++}`);
      values.push(Boolean(body.dhcp_enabled));
    }

    if (updates.length > 0) {
      // Hub'daki canlı peer listesini çek ve targetId'ye karşılık gelen gerçek node ID (edge-...) ile eşleştir
      let livePeerNodeId = targetId;
      let peerModel = 'Ağ Cihazı';
      let peerMac = '';
      let peerTunnelIp = '';
      let peerPubkey = '';

      try {
        const hubRes = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers`, { cache: 'no-store' });
        if (hubRes.ok) {
          const hubJson = await hubRes.json();
          const peers = hubJson.results || [];

          // DB'den targetId verisini çekerek MAC / Pubkey / Tunnel IP verisini al
          const devDbRes = await pool.query('SELECT * FROM netops_devices WHERE id = $1 OR name = $1', [targetId]);
          const devDb = devDbRes.rows[0];

          const peer = peers.find((p: any) => 
            p.device_id === targetId ||
            (devDb && devDb.mac_address && p.mac_address && p.mac_address.replace(/[^A-F0-9]/gi, '') === devDb.mac_address.replace(/[^A-F0-9]/gi, '')) ||
            (devDb && devDb.public_key && p.public_key === devDb.public_key) ||
            (devDb && devDb.tunnel_ip && p.virtual_ip && p.virtual_ip.includes(devDb.tunnel_ip.split('/')[0]))
          );

          if (peer) {
            livePeerNodeId = peer.device_id;
            peerModel = peer.model || 'Ağ Cihazı';
            peerMac = peer.mac_address || '';
            peerTunnelIp = peer.virtual_ip || '';
            peerPubkey = peer.public_key || '';
          }
        }
      } catch {}

      await pool.query(`
        INSERT INTO netops_devices (id, name, model, mac_address, tunnel_ip, public_key, status)
        VALUES ($1, $1, $2, $3, $4, $5, 'online')
        ON CONFLICT (id) DO NOTHING;
      `, [targetId, peerModel, peerMac, peerTunnelIp, peerPubkey || targetId]);

      values.push(targetId);
      const query = `UPDATE netops_devices SET ${updates.join(', ')}, last_seen = NOW() WHERE id = $${paramIndex} RETURNING *;`;
      const res = await pool.query(query, values);
      const updatedRow = res.rows[0];

      // 🏷️ Canlı Donanım Hostname ve Cihaz İsmi Enjeksiyonu (RPC)
      // Kullanıcı arayüzden adı değiştirdiğinde hem OpenWrt system hostname hem de netops device_id senkronize edilir ve agent servisi yeniden başlatılır
      let extraCmds = '';
      if (body.name && body.name.trim()) {
        const cleanName = body.name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        extraCmds += `
uci set system.@system[0].hostname='${cleanName}';
uci commit system;
/etc/init.d/system reload 2>/dev/null || true;
sed -i 's/--device-id .*/--device-id "${cleanName}"/' /etc/init.d/netops-agent 2>/dev/null || true;
echo "${cleanName}" > /etc/netops/device_id 2>/dev/null || true;
/etc/init.d/netops-agent restart 2>/dev/null || true;
`;
      }

      // 🌐 Canlı Donanım LAN ve DHCP Enjeksiyonu (RPC)
      // Eğer cihazın LAN IP'si veya Gateway'i değiştirildiyse donanımı canlı olarak yeni subnet'e geçir
      const newLanGatewayRaw = body.lan_gateway || (body.lan_subnet ? body.lan_subnet.replace(/\/\d{1,2}$/, '').replace(/\.0$/, '.1') : null);
      // GÜVENLİK: newLanGateway aşağıda uci komutlarına doğrudan interpolе edilip
      // branch cihazında root olarak çalıştırılır - kesin IPv4 formatında olduğu
      // doğrulanmadan geçirilirse komut enjeksiyonuna (RCE) yol açar.
      const newLanGateway = newLanGatewayRaw && validateIPv4(newLanGatewayRaw) ? newLanGatewayRaw : null;
      // Zero-Hardcode: netmask her zaman /24 varsayılmaz - şubenin gerçek CIDR
      // önekinden (lan_subnet) türetilir; bilinmiyorsa /24'e düşülür.
      const newLanNetmask = body.lan_subnet ? netmaskFromCIDR(body.lan_subnet) : '255.255.255.0';
      if (newLanGateway) {
        extraCmds += `
uci set network.lan.ipaddr='${newLanGateway}';
uci set network.lan.netmask='${newLanNetmask}';
uci commit network;
uci set dhcp.lan.start='100';
uci set dhcp.lan.limit='150';
uci del_list dhcp.lan.dhcp_option='3,${newLanGateway}' 2>/dev/null || true;
uci add_list dhcp.lan.dhcp_option='3,${newLanGateway}';
uci del_list dhcp.lan.dhcp_option='6,1.1.1.1,8.8.8.8' 2>/dev/null || true;
uci add_list dhcp.lan.dhcp_option='6,1.1.1.1,8.8.8.8';
uci commit dhcp;
/etc/init.d/network reload 2>/dev/null || true;
/etc/init.d/dnsmasq restart 2>/dev/null || true;
`;
      }

      if (extraCmds) {
        fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/commands/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: livePeerNodeId, command: extraCmds })
        }).catch(() => {});
      }

      return NextResponse.json(updatedRow || { id: targetId, success: true });
    }

    return NextResponse.json({ id: targetId, success: true });
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
      return NextResponse.json({ error: 'Cihaz ID zorunludur' }, { status: 400 });
    }

    const pool = getDbPool();
    await pool.query('DELETE FROM netops_devices WHERE id = $1', [id]);

    // Canlı Rust Hub'dan da peer bağlantısını kaldır (varsa)
    try {
      await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/peers/${id}`, { method: 'DELETE' });
    } catch {}

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}
