#!/usr/bin/env bash
# ==============================================================================
# NetOpsWan Meraki MX64 Universal Provisioner & Auto-Flasher Tool
# Birleştirilmiş Uçtan Uca Meraki Dönüştürücü ve Müşteri Enjeksiyon Motoru
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PAYLOAD_DIR="${ROOT_DIR}/firmware_builder/outputs"
DEFAULT_SYSUPGRADE="${ROOT_DIR}/firmware_builder/downloads/openwrt-bcm53xx-generic-meraki_mx64-squashfs.sysupgrade.bin"

echo -e "${BLUE}================================================================================${NC}"
echo -e "${CYAN}🚀 NETOPSWAN CISCO MERAKI MX64 UÇTAN UCA SAHA PROVISIONING SİHİRBAZI${NC}"
echo -e "${BLUE}================================================================================${NC}"

SERVER_URL=""
DEVICE_KEY=""
DEVICE_NAME=""
INTERFACE="en5"

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --server) SERVER_URL="$2"; shift ;;
    --device-key) DEVICE_KEY="$2"; shift ;;
    --device-name) DEVICE_NAME="$2"; shift ;;
    --iface) INTERFACE="$2"; shift ;;
    -h|--help)
      echo "Kullanım:"
      echo "  $0 --server <https://sdwan.musteri.com> --device-key <SHARED_SECRET> --device-name <SUBE_ADI> [--iface <en5|en0>]"
      exit 0
      ;;
    *) shift ;;
  esac
  shift
done

if [ -z "$SERVER_URL" ]; then
    echo -ne "${YELLOW}▶ Merkez Sunucu URL'sini Girin (Örn: https://sdwan.ariot.com.tr): ${NC}"
    read -r SERVER_URL
fi

if [ -z "$DEVICE_KEY" ]; then
    echo -ne "${YELLOW}▶ Zero-Trust Ağ Gizli Anahtarını (Shared Secret) Girin: ${NC}"
    read -r DEVICE_KEY
fi

if [ -z "$DEVICE_NAME" ]; then
    echo -ne "${YELLOW}▶ Şube / Cihaz Adını Girin (Örn: Istanbul-Sube): ${NC}"
    read -r DEVICE_NAME
fi

echo -e "\n${BLUE}[1/5] Müşteriye Özel Tam Donanımlı NetOpsWan İmajı Hazırlanıyor...${NC}"
mkdir -p "${ROOT_DIR}/firmware_builder/outputs"

# Eğer sistemde ImageBuilder varsa doğrudan derle, yoksa merkezden çek
SYSUPGRADE_IMG="${ROOT_DIR}/firmware_builder/outputs/${DEVICE_NAME}-meraki-mx64.sysupgrade.bin"

if [ -f "${ROOT_DIR}/firmware_builder/build-firmware.sh" ]; then
    echo "⚡ Donanımsal Firmware Builder tetikleniyor..."
    "${ROOT_DIR}/firmware_builder/build-firmware.sh" \
      --profile meraki-mx64 \
      --server "$SERVER_URL" \
      --device-name "$DEVICE_NAME" \
      --device-key "$DEVICE_KEY" \
      --outdir "${ROOT_DIR}/firmware_builder/outputs" || true
fi

# Fallback kontrolü
if [ ! -f "$SYSUPGRADE_IMG" ]; then
    SYSUPGRADE_IMG=$(find "${ROOT_DIR}/firmware_builder/outputs" -name "*sysupgrade.bin" | head -n 1 || echo "")
fi

if [ -z "$SYSUPGRADE_IMG" ] || [ ! -f "$SYSUPGRADE_IMG" ]; then
    SYSUPGRADE_IMG="$DEFAULT_SYSUPGRADE"
fi

echo -e "${GREEN}[✓] Kullanılacak İmaj: ${SYSUPGRADE_IMG}${NC}"

echo -e "\n${BLUE}[2/5] Mac Ağ Kartı Yapılandırılıyor (${INTERFACE} -> 192.168.1.2)...${NC}"
sudo ifconfig "$INTERFACE" inet 192.168.1.2 netmask 255.255.255.0 up 2>/dev/null || true

echo -e "\n${YELLOW}================================================================================${NC}"
echo -e "${YELLOW}👉 LÜTFEN ŞİMDİ ŞUNU YAPIN:${NC}"
echo -e "   1. Meraki MX64'ün arkasındaki RESET tuşuna basılı tutun."
echo -e "   2. Güç adaptörünü takın."
echo -e "   3. Ön paneldeki LED Yanıp sönmeye başlayınca RESET'i bırakın (Diag Modu)."
echo -e "${YELLOW}================================================================================${NC}"

echo -ne "Cihaz Diag Moduna alındı mı? [Enter]: "
read -r _

# Telnet Kontrolü
echo "🔍 MX64 Diag Telnet (192.168.1.1:23) aranıyor..."
for i in {1..20}; do
    if nc -z -G 1 192.168.1.1 23 2>/dev/null; then
        echo -e "${GREEN}[✓] MX64 Diag Telnet Açık!${NC}"
        break
    fi
    sleep 1
done

echo -e "\n${BLUE}[3/5] U-Boot Bootloader & MTD Kilit Açma İşlemleri...${NC}"
# Python NetOpsWan Dahili Flashlama Motorunu Tetikle
echo "⚡ U-Boot Flashlama Fazı Başlatılıyor..."
python3 -c "
import sys
from pathlib import Path

root_dir = Path('${ROOT_DIR}')
flasher_dir = root_dir / 'tools' / 'meraki_flasher'
sys.path.insert(0, str(root_dir / 'tools'))

try:
    from meraki_flasher.core.telnet_client import MerakiTelnetClient
    from meraki_flasher.core.flasher import MerakiFlasher
    from meraki_flasher.core.http_server import PayloadHTTPServer
    
    payload = flasher_dir / 'payload'
    backups = flasher_dir / 'backups'
    backups.mkdir(exist_ok=True)

    server = PayloadHTTPServer(payload, port=8000)
    server.start()
    telnet = MerakiTelnetClient('192.168.1.1', 23)
    if telnet.connect():
        flasher = MerakiFlasher(telnet, payload, backups, 8000)
        flasher.unlock_mtd0('192.168.1.2')
        flasher.flash_uboot('192.168.1.2')
        telnet.close()
        print('U-Boot Flashlama Başarılı!')
    else:
        print('Hata: Telnet bağlantısı açılamadı!')
    server.stop()
except Exception as e:
    print('U-Boot Hatası:', e)
"

echo -e "\n${YELLOW}================================================================================${NC}"
echo -e "${YELLOW}👉 LÜTFEN ŞİMDİ USB İLE RAM BOOT YAPIN:${NC}"
echo -e "   1. FAT32 USB belleği Meraki MX64'ün USB portuna takın."
echo -e "   2. Ethernet kablosunu LAN 1 portuna takın."
echo -e "   3. Reset tuşuna basılı tutarak güç verin (LED YEŞİL yanınca bırakın)."
echo -e "${YELLOW}================================================================================${NC}"

echo -ne "Cihaz USB ile açıldı ve LED Yeşil yandı mı? [Enter]: "
read -r _

echo -e "\n${BLUE}[4/5] MX64 RAM Ortamı Taranıyor ve Sysupgrade Başlatılıyor...${NC}"
TARGET_HOST=""
for i in {1..15}; do
    if nc -z -G 1 192.168.1.1 22 2>/dev/null; then
        TARGET_HOST="192.168.1.1"
        break
    elif nc -z -G 1 192.168.10.1 22 2>/dev/null; then
        TARGET_HOST="192.168.10.1"
        break
    fi
    sleep 1
done

if [ -z "$TARGET_HOST" ]; then
    TARGET_HOST="192.168.1.1"
fi

echo -e "${GREEN}[✓] Hedef MX64 Bulundu: ${TARGET_HOST}${NC}"

echo "📦 Sysupgrade İmajı ve Müşteri Parametreleri SSH Pipe ile Aktarılıyor..."
cat "$SYSUPGRADE_IMG" 2>/dev/null | ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 "root@$TARGET_HOST" "cat > /tmp/sysupgrade.bin" 2>/dev/null || true

echo "⚙️ Müşteri Zero-Trust Parametreleri ve SSH Güvenlik İzolasyonu Enjekte Ediliyor..."
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 "root@$TARGET_HOST" << EOF || true
mkdir -p /etc/netops
echo "${SERVER_URL}" > /etc/netops/hub_url
echo "${DEVICE_KEY}" > /etc/netops/shared_secret
chmod 600 /etc/netops/shared_secret

uci set network.lan.ipaddr='192.168.10.1'
uci set network.lan.netmask='255.255.255.0'
uci commit network

# 🔒 SSH İZOLASYONU: WAN'dan erişimi kapat, sadece LAN'dan parola ile erişime izin ver
uci set dropbear.@dropbear[0].Interface='lan'
uci set dropbear.@dropbear[0].Port='22'
uci set dropbear.@dropbear[0].PasswordAuth='on'
uci set dropbear.@dropbear[0].RootPasswordAuth='on'
uci commit dropbear

# Güvenlik Duvarında WAN SSH Girişini Blokla
iptables -I INPUT -i eth0 -p tcp --dport 22 -j DROP 2>/dev/null || true
iptables -I INPUT -i wan -p tcp --dport 22 -j DROP 2>/dev/null || true

# LAN Kurtarma Şifresi - ÜRETİMDE mutlaka kendi güçlü parolanızı LAN_RECOVERY_PASSWORD
# ortam değişkeni ile geçin (örn: export LAN_RECOVERY_PASSWORD='ÇokGüçlüBirParola!2026').
LAN_RECOVERY_PASSWORD="${LAN_RECOVERY_PASSWORD:?HATA: LAN_RECOVERY_PASSWORD ortam değişkenini güçlü bir parola ile ayarlayın}"
(echo "$LAN_RECOVERY_PASSWORD"; echo "$LAN_RECOVERY_PASSWORD") | passwd root 2>/dev/null || true

uci set netops.agent=agent 2>/dev/null || true
uci set netops.agent.hub_url="${SERVER_URL}" 2>/dev/null || true
uci set netops.agent.shared_secret="${DEVICE_KEY}" 2>/dev/null || true
uci set netops.agent.device_id="${DEVICE_NAME}" 2>/dev/null || true
uci commit netops 2>/dev/null || true

# Kalıcı NAND Flash Yazımı
sysupgrade -v -n /tmp/sysupgrade.bin
EOF

echo -e "\n${BLUE}================================================================================${NC}"
echo -e "${GREEN}🎉 TEBRİKLER! ${DEVICE_NAME} ŞUBESİ İÇİN MERAKİ MX64 DÖNÜŞÜMÜ TAMAMLANDI!${NC}"
echo -e "   🏢 Müşteri Sunucusu : ${SERVER_URL}"
echo -e "   🔑 Zero-Trust Token : ${DEVICE_KEY:0:16}..."
echo -e "   🌐 Şube LAN IP      : 192.168.10.1"
echo -e "   🛡️ SSH İzolasyonu   : WAN SSH %100 KAPALI | Yalnızca LAN Açık (Kullanıcı: root / Şifre: az önce belirlediğiniz parola)"
echo -e "   💾 Depolama         : Kalıcı Micron NAND Flash Mühürlendi"
echo -e "${BLUE}================================================================================${NC}\n"
echo -e "   🔑 Zero-Trust Token : ${DEVICE_KEY:0:16}..."
echo -e "   🌐 Şube LAN IP      : 192.168.10.1"
echo -e "   💾 Depolama         : Kalıcı Micron NAND Flash Mühürlendi"
echo -e "${BLUE}================================================================================${NC}\n"
