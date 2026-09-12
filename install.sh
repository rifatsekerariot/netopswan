#!/usr/bin/env bash
# ==============================================================================
# NetOpsWan Enterprise SD-WAN Platform - Tek Komut Kurulum & Otomasyon Sihirbazı
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}"
echo "================================================================================"
echo "    🚀 NetOpsWan Enterprise SD-WAN + OpenWISP Core Kurulum & Güncelleme         "
echo "================================================================================"
echo -e "${NC}"

# 1. Root / Sudo Yetki Kontrolü
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[!] Bu kurulum scripti root yetkisiyle veya sudo ile çalıştırılmalıdır.${NC}"
  exit 1
fi

INSTALL_DIR="/opt/netopswan"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 2. Docker & Docker Compose Otomatik Kurulumu
if ! command -v docker &> /dev/null; then
  echo -e "${BLUE}[+] Docker tespit edilemedi, otomatik kuruluyor...${NC}"
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm -f get-docker.sh
  systemctl enable --now docker
  echo -e "${GREEN}[✓] Docker başarıyla kuruldu ve başlatıldı.${NC}"
else
  echo -e "${GREEN}[✓] Docker kurulu ve hazır.${NC}"
fi

# 3. GitHub'dan Güncel All-in-One Compose ve Nginx Gateway Dosyalarını İndir
echo -e "${BLUE}[+] GitHub'dan en güncel Nginx Gateway ve sistem konfigürasyonu çekiliyor...${NC}"
mkdir -p nginx
curl -sSL https://raw.githubusercontent.com/rifatsekerariot/netopswan/main/docker-compose.yml -o docker-compose.yml
curl -sSL https://raw.githubusercontent.com/rifatsekerariot/netopswan/main/nginx/gateway.conf -o nginx/gateway.conf

# 4. Ortam Değişkenleri (.env) Oluşturma / Koruma
if [ ! -f ".env" ]; then
  echo -e "${BLUE}[+] Sunucu IP adresi ve güvenlik anahtarları üretiliyor...${NC}"
  SERVER_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')
  SECRET_KEY=$(openssl rand -hex 32 2>/dev/null || echo "netopswan_enterprise_secret_2026_$(date +%s)")
  DB_PASSWORD=$(openssl rand -hex 16 2>/dev/null || echo "AriotSecurePass2026")

  cat <<EOF > .env
# --- Temel Sunucu Yapılandırması ---
SERVER_IP=${SERVER_IP}
SERVER_DOMAIN=localhost
HTTP_PORT=80
HTTPS_PORT=443

# --- OpenWISP Core & API Entegrasyonu ---
DASHBOARD_DOMAIN=dashboard.openwisp.org
API_DOMAIN=api.openwisp.org
VPN_DOMAIN=openvpn.openwisp.org
OPENWISP_API_TOKEN=3524d06794c7b25f20da8ea3183a3b6edde79b7f
OPENWISP_API_HOST=api.openwisp.org
OPENWISP_INTERNAL_HOST=openwisp_nginx
OPENWISP_PORT=443
OPENWISP_VERSION=edge

# --- Veritabanı & Güvenlik ---
DB_USER=admin
DB_PASS=${DB_PASSWORD}
DB_NAME=openwisp
INFLUXDB_USER=admin
INFLUXDB_PASS=${DB_PASSWORD}
INFLUXDB_NAME=openwisp
DJANGO_SECRET_KEY=${SECRET_KEY}
SSL_CERT_MODE=SelfSigned
TZ=Europe/Istanbul

# --- Modüller ---
USE_OPENWISP_RADIUS=True
USE_OPENWISP_TOPOLOGY=True
USE_OPENWISP_FIRMWARE=True
USE_OPENWISP_MONITORING=True
EOF
  echo -e "${GREEN}[✓] .env ortam yapılandırması başarıyla oluşturuldu.${NC}"
fi

# 5. Tüm Konteyner İmajlarını Çek ve Başlat
echo -e "${BLUE}[+] NetOpsWan Yönetim Paneli ve OpenWISP Çekirdek İmajları İndiriliyor...${NC}"
docker compose pull

echo -e "${BLUE}[+] Güvenli Nginx Gateway ve SD-WAN Altyapısı Başlatılıyor...${NC}"
docker compose up -d

SERVER_IP_DISPLAY=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')

echo -e "\n${GREEN}================================================================================"
echo "  🎉 NetOpsWan Enterprise SD-WAN Sistemi Başarıyla Kuruldu & Çalışıyor!"
echo "  🌐 NetOpsWan Yönetim Paneli : http://${SERVER_IP_DISPLAY} (Port 80/443 Standart)"
echo "  🛡️  SD-WAN VPN Ağ Geçidi     : ${SERVER_IP_DISPLAY}:1194 (UDP)"
echo "  🔒 Güvenlik Durumu          : 3000 portu ve Veritabanı dışarıya kapalıdır."
echo "  📁 Kurulum & Veri Dizini    : ${INSTALL_DIR}"
echo "================================================================================${NC}\n"
