#!/bin/bash
# ==============================================================================
# NetOpsWan SD-WAN Central Appliance - Linux x86_64 Otomatik Kurulum Betiği
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}====================================================================${NC}"
echo -e "${CYAN}    🌐 NetOpsWan SD-WAN Kurumsal Merkezi Yönetim Platformu         ${NC}"
echo -e "${CYAN}    📦 Linux x86_64 Self-Contained Native Appliance Installer      ${NC}"
echo -e "${CYAN}====================================================================${NC}"

# 1. Root Yetkisi Kontrolü
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[!] Lütfen kurulum betiğini root (sudo) yetkisiyle çalıştırınız.${NC}"
  exit 1
fi

INSTALL_DIR="/opt/netopswan"
APP_USER="netopswan"

# 2. Sistem Paket Bağımlılıkları Kurulumu (Öncelikle paketteki offline .deb arşivinden, yoksa APT'den)
echo -e "${BLUE}[1/6] Sistem bağımlılıkları ve veritabanı paketleri yükleniyor...${NC}"
export DEBIAN_FRONTEND=noninteractive

if [ -d "./debs" ] && [ "$(ls -A ./debs 2>/dev/null)" ]; then
  echo -e "${GREEN}[+] %100 Çevrimdışı (Offline) .deb paketleri kuruluyor...${NC}"
  dpkg -i --force-depends ./debs/*.deb 2>/dev/null || apt-get install -f -y --no-install-recommends 2>/dev/null || true
else
  echo -e "${BLUE}[+] Depolardan çevrimiçi paket kurulumu yapılıyor...${NC}"
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y --no-install-recommends \
    postgresql postgresql-contrib postgis postgresql-postgis \
    redis-server \
    nginx \
    openvpn easy-rsa \
    python3 python3-pip python3-venv python3-full python3-dev libpq-dev libgdal-dev build-essential \
    curl git rsync 2>/dev/null || true
fi

# 3. Uygulama Kullanıcısı ve Dizinleri Oluşturma
echo -e "${BLUE}[2/6] Dizin yapıları ve uygulama kullanıcısı hazırlanıyor...${NC}"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -r -d "$INSTALL_DIR" -s /bin/bash "$APP_USER"
fi

mkdir -p "$INSTALL_DIR/backend"
mkdir -p "$INSTALL_DIR/frontend"
mkdir -p "$INSTALL_DIR/config"
mkdir -p "$INSTALL_DIR/logs"
mkdir -p "/etc/netopswan"

# 4. PostgreSQL Veritabanı ve PostGIS Konfigürasyonu
echo -e "${BLUE}[3/6] PostgreSQL veritabanı ve GIS uzantıları yapılandırılıyor...${NC}"
systemctl start postgresql
systemctl enable postgresql

DB_PASS="${DB_PASS:-$(openssl rand -hex 16 2>/dev/null || echo "CHANGE_ME_STRONG_PASS_$(date +%s)")}"
sudo -u postgres psql -c "CREATE USER openwisp WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -c "ALTER USER openwisp CREATEDB;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE openwisp OWNER openwisp;" 2>/dev/null || true
sudo -u postgres psql -d openwisp -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true

# 5. OpenWISP Python Backend Sanal Ortamı
echo -e "${BLUE}[4/6] OpenWISP backend servis ortamı oluşturuluyor...${NC}"
python3 -m venv "$INSTALL_DIR/backend/venv"
"$INSTALL_DIR/backend/venv/bin/pip" install --upgrade pip setuptools wheel 2>/dev/null || true

if [ -d "./wheels" ] && [ "$(ls -A ./wheels 2>/dev/null)" ]; then
  echo -e "${GREEN}[+] %100 Çevrimdışı (Offline) Python Wheels kütüphaneleri kuruluyor...${NC}"
  "$INSTALL_DIR/backend/venv/bin/pip" install --no-index --find-links=./wheels \
    django==4.2.19 \
    openwisp-controller \
    openwisp-users \
    openwisp-utils \
    openwisp-ipam \
    openwisp-network-topology \
    openwisp-notifications \
    djangorestframework-gis \
    django-filter \
    django-taggit \
    django-leaflet \
    django-reversion \
    psycopg2-binary \
    django-redis \
    gunicorn
else
  echo -e "${BLUE}[+] PyPI üzerinden çevrimiçi kütüphaneler kuruluyor...${NC}"
  "$INSTALL_DIR/backend/venv/bin/pip" install \
    django==4.2.19 \
    openwisp-controller \
    openwisp-users \
    openwisp-utils \
    openwisp-ipam \
    openwisp-network-topology \
    openwisp-notifications \
    djangorestframework-gis \
    django-filter \
    django-taggit \
    django-leaflet \
    django-reversion \
    psycopg2-binary \
    django-redis \
    gunicorn
fi

# Backend kodlarını kopyala
cp -r ./backend/* "$INSTALL_DIR/backend/" 2>/dev/null || true
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"

# Django Veritabanı Migration İşlemleri
sudo -u "$APP_USER" "$INSTALL_DIR/backend/venv/bin/python" "$INSTALL_DIR/backend/manage.py" migrate --noinput

# 6. Next.js Frontend Standalone ve Systemd Servisleri
echo -e "${BLUE}[5/6] Web Arayüzü ve Systemd servisleri devreye alınıyor...${NC}"
cp -a ./frontend/. "$INSTALL_DIR/frontend/"
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR/frontend"

# Node.js kontrolü (Eğer sunucuda yoksa Node 20 LTS kurulur)
if ! command -v node >/dev/null 2>&1; then
  echo -e "${BLUE}[+] Node.js ortamı kuruluyor...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Systemd Servislerini Kaydet
cat << 'EOF' > /etc/systemd/system/netopswan-backend.service
[Unit]
Description=NetOpsWan SD-WAN OpenWISP Backend (Gunicorn WSGI)
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/netopswan/backend
ExecStart=/opt/netopswan/backend/venv/bin/gunicorn openwisp_config.wsgi:application --bind 127.0.0.1:8000 --workers 4 --threads 2 --timeout 120
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat << 'EOF' > /etc/systemd/system/netopswan-frontend.service
[Unit]
Description=NetOpsWan SD-WAN Dashboard Frontend (Node.js)
After=network.target netopswan-backend.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/netopswan/frontend
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# OpenVPN Hub Kurulumu & Sertifikalar
mkdir -p /etc/openvpn/server
if [ ! -f /etc/openvpn/server/dh.pem ]; then
  openssl dhparam -out /etc/openvpn/server/dh.pem 2048
fi
if [ ! -f /etc/openvpn/server/ta.key ]; then
  openvpn --genkey secret /etc/openvpn/server/ta.key
fi

cat << 'EOF' > /etc/openvpn/server.conf
port 1194
proto udp
dev tun0
ca /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key /etc/openvpn/server/server.key
dh /etc/openvpn/server/dh.pem
tls-auth /etc/openvpn/server/ta.key 0
server 10.8.0.0 255.255.255.0
topology subnet
keepalive 10 120
cipher AES-256-GCM
auth SHA256
persist-key
persist-tun
status /var/log/openvpn-status.log
verb 3
EOF

# Nginx Yapılandırması (Port 80 LAN + Port 8443 WAN Güvenlik İzolasyonu)
mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/netopswan_8443.crt ]; then
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/netopswan_8443.key \
    -out /etc/nginx/ssl/netopswan_8443.crt \
    -subj "/C=TR/ST=Adana/L=Seyhan/O=Ariot/OU=SDWAN/CN=netopswan.ariot.com.tr"
fi

cat << 'EOF' > /etc/nginx/sites-available/netopswan
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 8443 ssl default_server;
    listen [::]:8443 ssl default_server;
    server_name _;

    ssl_certificate /etc/nginx/ssl/netopswan_8443.crt;
    ssl_certificate_key /etc/nginx/ssl/netopswan_8443.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 20M;

    location ~ ^/(controller/|api/v1/controller/|api/v1/pki/|schema/) {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location / {
        return 403 "Forbidden: Management console is restricted to local network only.";
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/netopswan /etc/nginx/sites-enabled/netopswan

# 7. Servisleri Başlatma
echo -e "${BLUE}[6/6] Servisler başlatılıyor...${NC}"
systemctl daemon-reload
systemctl enable netopswan-backend netopswan-frontend nginx redis-server
systemctl restart netopswan-backend netopswan-frontend nginx redis-server

# IP Tespiti
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}====================================================================${NC}"
echo -e "${GREEN}  🎉 NetOpsWan Kurulumu Başarıyla Tamamlandı!                       ${NC}"
echo -e "${GREEN}====================================================================${NC}"
echo -e "${CYAN}  👉 Yerel Yönetim Paneli : ${NC}http://${SERVER_IP}/wizard"
echo -e "${CYAN}  👉 WAN Şube Kayıt Portu : ${NC}https://${SERVER_IP}:8443"
echo -e "${CYAN}  👉 OpenVPN SD-WAN Portu : ${NC}UDP 1194"
echo ""
echo -e "${GREEN}  Tarayıcınızdan yukarıdaki adrese girerek ilk kurulum sihirbazını ${NC}"
echo -e "${GREEN}  tamamlayabilir ve şifrenizi belirleyebilirsiniz.                 ${NC}"
echo -e "${GREEN}====================================================================${NC}"
