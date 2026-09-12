-- NetOpsWan Enterprise SD-WAN PostgreSQL 16 Schema (500+ Nodes Scale)

CREATE TABLE IF NOT EXISTS netops_devices (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    serial_number VARCHAR(128) UNIQUE,
    model VARCHAR(64) DEFAULT 'Cisco Meraki MX64',
    mac_address VARCHAR(32) NOT NULL,
    management_ip VARCHAR(64),
    tunnel_ip VARCHAR(64) NOT NULL UNIQUE,
    public_key VARCHAR(64) NOT NULL,
    status VARCHAR(16) DEFAULT 'offline',
    active_wan_interface VARCHAR(32) DEFAULT 'eth0',
    group_id VARCHAR(64),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Faz 1 - Cihaz Kimliği (bkz. 2026-08-22 oturumu): bu view önceden SADECE production
-- veritabanında elle oluşturulmuştu, hiçbir yerde (git) takip edilmiyordu - "şema
-- kayması" riski. Ayrıca `public_key` kolonu SEÇİLMİYORDU, bu yüzden frontend'in
-- device<->hub-peer eşleştirmesinde en güçlü/ilk sinyal (public_key) her zaman boş
-- geliyor, MAC/isim gibi çok daha zayıf sezgisel eşleştirme turlarına düşülüyordu
-- (bkz. "Netfix Şube" vs "Ariot Şube" MAC çakışması, frontend/src/app/api/devices/route.ts).
-- `public_key` sona eklendi (CREATE OR REPLACE VIEW mevcut kolonların POZİSYONUNU
-- değiştirmeye izin vermez, sadece sona ekleme yapılabilir).
CREATE OR REPLACE VIEW v_unified_devices AS
SELECT DISTINCT ON (d.id) d.id,
    d.name,
    COALESCE(d.serial_number, '') AS serial_number,
    COALESCE(d.model, 'Cisco Meraki MX64') AS model,
    COALESCE(d.mac_address, '') AS mac_address,
    COALESCE(d.management_ip, '') AS management_ip,
    COALESCE(d.tunnel_ip, '') AS tunnel_ip,
    COALESCE(d.lan_subnet, s.subnet, '') AS lan_subnet,
    COALESCE(d.lan_gateway, s.gateway, '') AS lan_gateway,
    COALESCE(d.dhcp_enabled, true) AS dhcp_enabled,
    COALESCE(d.status, 'offline') AS status,
    COALESCE(d.active_wan_interface, 'wan') AS active_wan_interface,
    COALESCE(d.group_id, 'Genel') AS group_id,
    d.created_at,
    d.last_seen,
    COALESCE(d.public_key, '') AS public_key
FROM netops_devices d
LEFT JOIN netops_subnets s ON s.name::text = d.name::text OR s.region_group::text = d.group_id::text OR s.id::text = d.group_id::text
ORDER BY d.id, s.created_at DESC;

CREATE TABLE IF NOT EXISTS netops_telemetry (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(64) REFERENCES netops_devices(id) ON DELETE CASCADE,
    cpu_usage_pct REAL NOT NULL,
    ram_used_mb INT NOT NULL,
    ram_total_mb INT NOT NULL,
    rtt_ms REAL NOT NULL,
    jitter_ms REAL DEFAULT 0.0,
    packet_loss_pct REAL DEFAULT 0.0,
    tx_bytes BIGINT DEFAULT 0,
    rx_bytes BIGINT DEFAULT 0,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON netops_telemetry(device_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS netops_subnets (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    subnet VARCHAR(64) NOT NULL UNIQUE,
    gateway VARCHAR(64) NOT NULL,
    dhcp_start INT DEFAULT 100,
    dhcp_limit INT DEFAULT 150,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS netops_templates (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    type VARCHAR(32) NOT NULL,
    target_group VARCHAR(64),
    description TEXT,
    uci_content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS netops_users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(128) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    role VARCHAR(32) DEFAULT 'operator',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Faz 2 - Güvenlik Sertleştirme (bkz. 2026-08-22 oturumu): Bu tablo daha önce HİÇ
-- oluşturulmamıştı - login route'u `INSERT INTO netops_sessions ...` yapıyordu ama
-- hata `.catch(() => {})` ile yutuluyordu ("Session table might not exist" yorumu).
-- Daha da kritiği: `dashboard/layout.tsx` ve HİÇBİR /api/* route'u token'ı bu tabloya
-- karşı DOĞRULAMIYORDU - sadece cookie'nin var/boş olmadığına bakılıyordu. Yani
-- `netopswan_token=herhangi-bir-metin` cookie'siyle TÜM API'ler (cihaz yönetimi,
-- firewall, DHCP, PKI) kimlik doğrulamasız erişilebilir durumdaydı. Artık
-- `middleware.ts` her isteği bu tabloya karşı gerçekten doğruluyor.
CREATE TABLE IF NOT EXISTS netops_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES netops_users(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    ip_address VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON netops_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON netops_sessions(user_id);

-- Faz 2: Login rate-limit sayaçları önceden yalnızca Node.js process belleğindeki bir
-- `Map` içindeydi - her deploy/restart'ta sıfırlanıyordu (kaba kuvvet koruması geçici
-- ve deploy sıklığına bağımlıydı). Artık kalıcı.
CREATE TABLE IF NOT EXISTS netops_login_attempts (
    rate_limit_key VARCHAR(256) PRIMARY KEY, -- Örn: "1.2.3.4_admin"
    attempts INT NOT NULL DEFAULT 0,
    lock_until TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- İlk başlangıç kayıtları
INSERT INTO netops_users (id, username, email, password_hash, role)
VALUES ('user-admin', 'admin', 'admin@netopswan.com', 'admin1234', 'admin')
ON CONFLICT (username) DO NOTHING;

INSERT INTO netops_subnets (id, name, subnet, gateway, description)
VALUES ('subnet-sdwan-default', 'SD-WAN Tünel Havuzu', '10.8.0.0/24', '10.8.0.1', 'Merkezi SD-WAN Yönetim Ağı')
ON CONFLICT (subnet) DO NOTHING;
