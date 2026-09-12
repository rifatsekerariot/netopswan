import { NextRequest, NextResponse } from 'next/server';
import { isSystemConfigured, saveSystemConfig } from '@/lib/config-manager';
import { getDbPool } from '@/lib/db';
import { hashPassword, validatePasswordStrength } from '@/lib/password-hash';
import crypto from 'crypto';
import fs from 'fs';

export async function POST(req: NextRequest) {
  try {
    // 🔒 GÜVENLİK ÖNLEMİ: Sistem daha önce yapılandırıldıysa ikinci kez kurulamaz!
    if (isSystemConfigured()) {
      return NextResponse.json(
        { error: 'Sistem zaten yapılandırılmıştır. Kurulum sihirbazı güvenlik sebebiyle kilitlenmiştir.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const adminUsername = (body.adminUsername || 'admin').trim();
    const adminPassword = (body.adminPassword || '').trim();
    const adminEmail = (body.adminEmail || `${adminUsername}@netopswan.local`).trim();
    const externalDomain = (body.externalDomain || '').trim();
    const externalPort = parseInt(body.externalPort || 443);
    const vpnSubnet = (body.vpnSubnet || '10.8.0.0/24').trim();
    const vpnPort = parseInt(body.vpnPort || 51820);
    const autoRegistration = Boolean(body.autoRegistration !== false);

    if (!adminUsername) {
      return NextResponse.json(
        { error: 'Lütfen geçerli bir yönetici kullanıcı adı belirleyiniz.' },
        { status: 400 }
      );
    }

    const passwordCheck = validatePasswordStrength(adminPassword);
    if (!passwordCheck.valid) {
      return NextResponse.json(
        { error: `Yönetici şifresi güvenlik gereksinimlerini karşılamıyor: ${passwordCheck.errors.join(', ')}` },
        { status: 400 }
      );
    }

    if (!externalDomain) {
      return NextResponse.json(
        { error: 'Lütfen sunucu dış erişim IP adresi veya alan adını (FQDN) giriniz.' },
        { status: 400 }
      );
    }

    // 1. PostgreSQL veritabanına Admin kullanıcısını ve varsayılan SD-WAN Tünel Havuzunu ekle
    const pool = getDbPool();
    const passwordHash = await hashPassword(adminPassword);

    // Admin Kullanıcısını oluştur
    // NOT: netops_users.email NOT NULL UNIQUE'dir (schema.sql) - önceki sürüm bunu hiç
    // INSERT etmiyordu, bu da kurulumun her zaman constraint violation ile başarısız
    // olmasına yol açıyordu. updated_at kolonu da tabloda yok.
    await pool.query(`
      INSERT INTO netops_users (id, username, email, password_hash, role, created_at)
      VALUES ($1, $2, $3, $4, 'admin', NOW())
      ON CONFLICT (username) DO UPDATE
      SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash;
    `, [`user-admin-${Date.now()}`, adminUsername, adminEmail, passwordHash]);

    // Dinamik SD-WAN Gateway IP Hesapla (Sıfır Hardcode: Alt ağın 1. IP'si)
    const subnetPrefix = vpnSubnet.split('/')[0].split('.').slice(0, 3).join('.');
    const gatewayIp = `${subnetPrefix}.1`;

    // İlk SD-WAN Tünel Havuzunu IPAM'e ekle
    await pool.query(`
      INSERT INTO netops_subnets (id, name, subnet, gateway, dhcp_start, dhcp_limit, type, region_group, description)
      VALUES ($1, 'Merkez SD-WAN Tünel Havuzu', $2, $3, 2, 250, 'sdwan_tunnel', 'Merkez SD-WAN', 'İlk Kurulum SD-WAN Tünel Havuzu')
      ON CONFLICT (id) DO UPDATE
      SET subnet = EXCLUDED.subnet, gateway = EXCLUDED.gateway;
    `, [`subnet-sdwan-default`, vpnSubnet, gatewayIp]).catch(() => {});

    // Varsayılan Cihaz Grupları
    await pool.query(`
      INSERT INTO netops_device_groups (id, name, description, created_at)
      VALUES 
        ('group-hq', 'Genel Merkez', 'Merkez Ofis ve Ana Gateway Cihazları', NOW()),
        ('group-branches', 'Şube Ağları', 'Uzak Ofis ve Saha SD-WAN Cihazları', NOW())
      ON CONFLICT (id) DO NOTHING;
    `).catch(() => {});

    const apiToken = crypto.randomBytes(32).toString('hex');
    const sharedSecret = (body.sharedSecret || ('netops-secret-' + crypto.randomBytes(16).toString('hex'))).trim();

    // /etc/netops/shared_secret dosyasını oluştur (Rust Hub ve Agent entegrasyonu)
    try {
      if (!fs.existsSync('/etc/netops')) {
        fs.mkdirSync('/etc/netops', { recursive: true });
      }
      fs.writeFileSync('/etc/netops/shared_secret', `${sharedSecret}\n`, 'utf-8');
    } catch (_) {}

    // 2. Kalıcı konfigürasyonu ve güvenlik kilidini kaydet
    const saved = saveSystemConfig({
      adminUsername,
      adminEmail,
      externalDomain,
      externalPort,
      vpnSubnet,
      vpnPort,
      autoRegistration,
      openwispApiToken: apiToken,
      sharedSecret
    });

    return NextResponse.json({
      success: true,
      message: 'NetOpsWan SD-WAN sistemi başarıyla yapılandırıldı ve kilitlendi.',
      config: saved
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Kurulum sırasında hata oluştu', details: error.message }, { status: 500 });
  }
}
