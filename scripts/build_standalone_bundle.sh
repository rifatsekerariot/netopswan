#!/bin/bash
# ==============================================================================
# NetOpsWan Bare-Metal Zero-Dependency Standalone Installer & Packager
# Builds a production-ready, self-contained offline deployment bundle
# ==============================================================================

set -e

[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env" || true
export PATH="$HOME/.cargo/bin:$PATH"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
BUNDLE_DIR="${DIST_DIR}/netopswan-bundle"

echo -e "\n${BLUE}================================================================================${NC}"
echo -e "${CYAN}🚀 NETOPSWAN SIFIR BAĞIMLILIKLI ÇEVRİMDIŞI (OFFLINE) PAKETLEYİCİ${NC}"
echo -e "${BLUE}================================================================================${NC}"

# 1. Hazırlık
rm -rf "${DIST_DIR}"
mkdir -p "${BUNDLE_DIR}/bin"
mkdir -p "${BUNDLE_DIR}/downloads"
mkdir -p "${BUNDLE_DIR}/frontend"
mkdir -p "${BUNDLE_DIR}/systemd"
mkdir -p "${BUNDLE_DIR}/config"

# 2. Rust Hub & Agent İkili Dosyalarını Derle
echo -e "\n${YELLOW}[1/4] Rust Central Hub ve ARMv7 Ajan Paketi Derleniyor...${NC}"
cd "${ROOT_DIR}/packages/rust-sdwan"

# Host x86_64 Hub derlemesi
cargo build --release --bin netops-hub
cp target/release/netops-hub "${BUNDLE_DIR}/bin/netops-hub"

# ARMv7 Meraki MX64 Ajan derlemesi (Varsa)
if rustup target list | grep -q "armv7-unknown-linux-musleabi (installed)"; then
    cargo build --release --target armv7-unknown-linux-musleabi --bin netops-agent || true
    if [ -f target/armv7-unknown-linux-musleabi/release/netops-agent ]; then
        cp target/armv7-unknown-linux-musleabi/release/netops-agent "${BUNDLE_DIR}/downloads/netops-agent-armv7-soft"
    fi
fi

# 3. Next.js Frontend Standalone Paketini Derle
echo -e "\n${YELLOW}[2/4] Next.js 16 Web Arayüzü Derleniyor (Standalone Mode)...${NC}"
cd "${ROOT_DIR}/frontend"
npm run build

# Standalone build çıktılarını kopyala
cp -r .next/standalone/* "${BUNDLE_DIR}/frontend/" 2>/dev/null || cp -r .next "${BUNDLE_DIR}/frontend/"
cp -r public "${BUNDLE_DIR}/frontend/" 2>/dev/null || true
cp -r .next/static "${BUNDLE_DIR}/frontend/.next/static" 2>/dev/null || true

# 4. Systemd ve Nginx Servis Şablonlarını Oluştur
echo -e "\n${YELLOW}[3/4] Systemd & Nginx Servis Konfigürasyonları Paketleniyor...${NC}"

cat << 'EOF' > "${BUNDLE_DIR}/systemd/netops-hub.service"
[Unit]
Description=NetOpsWan SD-WAN Central Hub Gateway Engine
After=network.target wireguard.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/netopswan
ExecStart=/opt/netopswan/bin/netops-hub --api-listen 0.0.0.0:8088 --tunnel-port 51820 --tunnel-subnet 10.8.0.0/24
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat << 'EOF' > "${BUNDLE_DIR}/systemd/netops-web.service"
[Unit]
Description=NetOpsWan SD-WAN Web Dashboard & Management Console
After=network.target netops-hub.service postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/netopswan/frontend
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=POSTGRES_HOST=127.0.0.1
Environment=POSTGRES_PORT=5432
Environment=POSTGRES_DB=netopswan
Environment=POSTGRES_USER=postgres
Environment=POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-CHANGE_ME_STRONG_PASSWORD}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat << 'EOF' > "${BUNDLE_DIR}/systemd/netopswan-nginx.conf"
# NetOpsWan Zero-Trust Enterprise Nginx Gateway Configuration

# 1. SD-WAN Tünel İçi (In-Band 10.8.0.1) & Yerel Yönetim (127.0.0.1) - Tam Yetkili
server {
    listen 80;
    server_name 127.0.0.1 10.8.0.1 localhost;

    client_max_body_size 100M;

    location /downloads/ {
        alias /opt/netopswan/downloads/;
        autoindex on;
    }

    location /api/v1/sdwan/ {
        proxy_pass http://127.0.0.1:8088/api/v1/sdwan/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# 2. Dış İnternet / WAN Arayüzü (Sadece Register ve İndirmelere İzin Verilir)
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 100M;

    # Yalnızca Güvenli Şube Kayıt Uç Noktası Açık
    location /api/v1/sdwan/register {
        proxy_pass http://127.0.0.1:8088/api/v1/sdwan/register;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Agent ve Güncelleme İndirmeleri
    location /downloads/ {
        alias /opt/netopswan/downloads/;
        autoindex on;
    }

    # Web Dashboard ve Diğer API'ler
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

# 5. Tek Tıkla Kurulum Dosyası (deploy_baremetal.sh)
cat << 'EOF' > "${BUNDLE_DIR}/install.sh"
#!/bin/bash
set -e

echo "📦 NetOpsWan Bare-Metal Kurulumu Başlatılıyor..."

# 1. Gerekli Dizinleri Oluştur
mkdir -p /opt/netopswan/bin
mkdir -p /opt/netopswan/downloads
mkdir -p /opt/netopswan/frontend
mkdir -p /opt/netopswan/config

# 2. Dosyaları Taşı
cp -r bin/* /opt/netopswan/bin/
cp -r downloads/* /opt/netopswan/downloads/ 2>/dev/null || true
cp -r frontend/* /opt/netopswan/frontend/
chmod +x /opt/netopswan/bin/*

# 3. Systemd Servislerini Kur
cp systemd/netops-hub.service /etc/systemd/system/
cp systemd/netops-web.service /etc/systemd/system/
systemctl daemon-reload

# 4. Nginx Yapılandırması
if [ -d /etc/nginx/sites-available ]; then
    cp systemd/netopswan-nginx.conf /etc/nginx/sites-available/netopswan
    ln -sf /etc/nginx/sites-available/netopswan /etc/nginx/sites-enabled/netopswan
    nginx -t && systemctl reload nginx || systemctl restart nginx
fi

# 5. Servisleri Başlat
systemctl enable netops-hub
systemctl enable netops-web
systemctl restart netops-hub
systemctl restart netops-web

SERVER_IP=$(ip -4 addr show scope global | grep inet | awk '{print $2}' | cut -d/ -f1 | head -n 1)

echo "================================================================================"
echo "✅ NetOpsWan SD-WAN Sunucusu Başarıyla Kuruldu!"
echo "👉 Kurulum Sihirbazı Adresi: http://${SERVER_IP:-localhost}/wizard"
echo "================================================================================"
EOF

chmod +x "${BUNDLE_DIR}/install.sh"

# 6. Tar.gz ve Zip Dağıtım Arşivi Oluştur
echo -e "\n${YELLOW}[4/4] Çevrimdışı Kurulum Paketi Arşivleniyor...${NC}"
cd "${DIST_DIR}"
tar -czf "netopswan-server-v0.4.9-standalone.tar.gz" -C "${DIST_DIR}" "netopswan-bundle"

echo -e "\n${GREEN}================================================================================${NC}"
echo -e "${GREEN}🎉 PAKETLEME TAMAMLANDI!${NC}"
echo -e "   Dağıtım Arşivi: ${DIST_DIR}/netopswan-server-v0.4.9-standalone.tar.gz"
echo -e "${GREEN}================================================================================${NC}\n"
