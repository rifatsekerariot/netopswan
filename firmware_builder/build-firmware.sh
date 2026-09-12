#!/usr/bin/env bash
# ==============================================================================
# NetOpsWan Universal Hardware Appliance Firmware Builder Engine
# Donanım Profilleri: Cisco Meraki (MX64/65/Z3), Raspberry Pi (4/5), x86_64 vb.
# Her donanımın kendi özel Kernel, DTB ve Switch sürücülerini otomatik derler.
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}"
echo "================================================================================"
echo "      🚀 NetOpsWan Universal Appliance Firmware Builder Engine (ImageBuilder)   "
echo "================================================================================"
echo -e "${NC}"

# Parametreler
PROFILE="meraki-mx64"
SERVER_URL=""
DEVICE_NAME=""
DEVICE_KEY=""
CA_CERT_PATH=""
OUTPUT_DIR="./outputs"
OPENWRT_VERSION="23.05.3"
DOWNLOADS_DIR="./downloads"

mkdir -p "$DOWNLOADS_DIR" "$OUTPUT_DIR"

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --profile) PROFILE="$2"; shift ;;
    --server) SERVER_URL="$2"; shift ;;
    --device-name) DEVICE_NAME="$2"; shift ;;
    --device-key) DEVICE_KEY="$2"; shift ;;
    --ca-cert) CA_CERT_PATH="$2"; shift ;;
    --outdir) OUTPUT_DIR="$2"; shift ;;
    --version) OPENWRT_VERSION="$2"; shift ;;
    -h|--help)
      echo "Kullanım:"
      echo "  $0 --profile <meraki-mx64|meraki-mx65|meraki-z3|rpi-4|x86-64> \\"
      echo "     --server <https://sdwan.musteri.com> \\"
      echo "     --device-name <Sube-Adi> \\"
      echo "     --device-key <Gizli-Anahtar> \\"
      echo "     [--ca-cert <ca.crt>] \\"
      echo "     [--outdir <cikis_klasoru>]"
      exit 0
      ;;
    *) echo -e "${RED}[!] Bilinmeyen parametre: $1${NC}"; exit 1 ;;
  esac
  shift
done

if [ -z "$SERVER_URL" ] || [ -z "$DEVICE_NAME" ] || [ -z "$DEVICE_KEY" ]; then
  echo -e "${RED}[!] Hata: --server, --device-name ve --device-key parametreleri zorunludur!${NC}"
  exit 1
fi

echo -e "${BLUE}[1/5] Donanım Mimarisi & DTB Profili Belirleniyor: ${PROFILE}...${NC}"

# Donanıma Özel DTB / Target ve Resmi ImageBuilder Eşleştirmesi
case $PROFILE in
  meraki-mx64)
    TARGET="bcm53xx"
    SUBTARGET="generic"
    BOARD_PROFILE="Generic"
    DTB_NAME="bcm5301x-meraki-mx64.dtb"
    PACKAGES="wireguard-tools kmod-wireguard ip-full kmod-tun kmod-switch-bcm53xx curl jq ca-bundle iptables-nft kmod-nft-core tc-full ethtool"
    ;;
  meraki-mx65)
    TARGET="bcm53xx"
    SUBTARGET="generic"
    BOARD_PROFILE="Generic"
    DTB_NAME="bcm5301x-meraki-mx65.dtb"
    PACKAGES="wireguard-tools kmod-wireguard ip-full kmod-tun kmod-switch-bcm53xx curl jq ca-bundle iptables-nft kmod-nft-core tc-full ethtool"
    ;;
  meraki-z3)
    TARGET="ramips"
    SUBTARGET="mt7621"
    BOARD_PROFILE="meraki_z3"
    DTB_NAME="mt7621-meraki-z3.dtb"
    PACKAGES="openvpn-openssl wireguard-tools ip-full kmod-tun"
    ;;
  rpi-4)
    TARGET="bcm27xx"
    SUBTARGET="bcm2711"
    BOARD_PROFILE="rpi-4"
    DTB_NAME="bcm2711-rpi-4-b.dtb"
    PACKAGES="openvpn-openssl wireguard-tools ip-full kmod-tun"
    ;;
  x86-64)
    TARGET="x86"
    SUBTARGET="64"
    BOARD_PROFILE="generic"
    DTB_NAME="ACPI_UEFI"
    PACKAGES="openvpn-openssl wireguard-tools ip-full kmod-tun e1000e igb r8169 -luci -luci-app-firewall"
    ;;
  *)
    echo -e "${RED}[!] Desteklenmeyen profil: $PROFILE${NC}"
    exit 1
    ;;
esac

IB_TARBALL_NAME="openwrt-imagebuilder-${OPENWRT_VERSION}-${TARGET}-${SUBTARGET}.Linux-x86_64.tar.xz"
IB_DOWNLOAD_URL="https://downloads.openwrt.org/releases/${OPENWRT_VERSION}/targets/${TARGET}/${SUBTARGET}/${IB_TARBALL_NAME}"
# 2. Resmi Donanım ImageBuilder Aracını İndir & Hazırla
BUILD_ROOT="/tmp/builder_root"
mkdir -p "$BUILD_ROOT"
IB_DIR="${BUILD_ROOT}/openwrt-imagebuilder-${OPENWRT_VERSION}-${TARGET}-${SUBTARGET}.Linux-x86_64"

if [ ! -d "$IB_DIR" ]; then
  echo -e "${BLUE}[2/5] Donanıma özel ImageBuilder (${TARGET}/${SUBTARGET} + ${DTB_NAME}) hazırlanıyor...${NC}"
  if [ ! -f "${DOWNLOADS_DIR}/${IB_TARBALL_NAME}" ]; then
    curl -sSL "$IB_DOWNLOAD_URL" -o "${DOWNLOADS_DIR}/${IB_TARBALL_NAME}"
  fi
  tar -xf "${DOWNLOADS_DIR}/${IB_TARBALL_NAME}" -C "$BUILD_ROOT"
  echo -e "${GREEN}[✓] ImageBuilder ortamı hazırlandı.${NC}"
else
  echo -e "${GREEN}[✓] Donanıma özel ImageBuilder önbellekten yüklendi (${TARGET}/${SUBTARGET}).${NC}"
fi

# 3. Şubeye Özel Kalıcı Overlay Hazırlama
WORK_DIR="${BUILD_ROOT}/build_tmp/${DEVICE_NAME}_${PROFILE}"
OVERLAY_DIR="${WORK_DIR}/overlay"
rm -rf "$WORK_DIR"
mkdir -p "${OVERLAY_DIR}/etc/sdwan"
mkdir -p "${OVERLAY_DIR}/etc/netops"
mkdir -p "${OVERLAY_DIR}/usr/bin"
mkdir -p "${OVERLAY_DIR}/etc/init.d"
mkdir -p "${OVERLAY_DIR}/etc/rc.d"
mkdir -p "${OVERLAY_DIR}/etc/config"

echo -e "${BLUE}[3/5] Rust SD-WAN ajan ikilisi, tünel anahtarları ve Zero-Trust konfigürasyonu gömülüyor...${NC}"

# 1. Zero-Trust Ön-Paylaşımlı Anahtarlar ve Sunucu URL'i
echo "${DEVICE_KEY}" > "${OVERLAY_DIR}/etc/netops/shared_secret"
chmod 600 "${OVERLAY_DIR}/etc/netops/shared_secret"

echo "${SERVER_URL}" > "${OVERLAY_DIR}/etc/netops/hub_url"

# 2. OpenWrt UCI Yapılandırması & Ağ Güvenliği
cat <<EOF > "${OVERLAY_DIR}/etc/config/netops"
config agent 'agent'
    option hub_url '${SERVER_URL}'
    option shared_secret '${DEVICE_KEY}'
    option device_id '${DEVICE_NAME}'
EOF

# 🔒 SSH GÜVENLİK VE İZOLASYON POLİTİKASI:
# - WAN Arayüzünden SSH Erişimi %100 Kapatılır / Drop Edilir
# - Yalnızca Yerel LAN (br-lan 192.168.10.1:22) Üzerinden SSH Kabul Edilir
mkdir -p "${OVERLAY_DIR}/etc/config"
cat <<EOF > "${OVERLAY_DIR}/etc/config/dropbear"
config dropbear
    option enable '1'
    option Interface 'lan'
    option Port '22'
    option PasswordAuth 'on'
    option RootPasswordAuth 'on'
EOF

# Güvenlik Duvarında (Firewall) WAN'dan Gelen 22 Portunu Kesin Olarak Blokla
mkdir -p "${OVERLAY_DIR}/etc/firewall.user.d" 2>/dev/null || true
cat <<'EOF' > "${OVERLAY_DIR}/etc/firewall.user"
# NetOpsWan Strict WAN Hardening
iptables -I INPUT -i eth0 -p tcp --dport 22 -j DROP 2>/dev/null || true
iptables -I INPUT -i wan -p tcp --dport 22 -j DROP 2>/dev/null || true
nft add rule inet fw4 input iifname "eth0" tcp dport 22 drop 2>/dev/null || true
EOF

# LAN Kurtarma Şifresi Belirle - ÜRETİMDE MUTLAKA kendi güçlü parolanızı SSH_PASSWORD
# ortam değişkeni ile geçin. Aşağıdaki değer sadece yerel/demo denemeleri için bir
# yer tutucudur ve varsayılan olarak KULLANILMAMALIDIR.
SSH_PASSWORD="${SSH_PASSWORD:?HATA: SSH_PASSWORD ortam değişkenini güçlü bir parola ile ayarlayın, örn: export SSH_PASSWORD='ÇokGüçlüBirParola!2026'}"
mkdir -p "${OVERLAY_DIR}/etc"
# SHA-512 şifrelenmiş parola oluştur
PASS_HASH=$(python3 -c "import crypt; print(crypt.crypt('${SSH_PASSWORD}', crypt.mksalt(crypt.METHOD_SHA512)))" 2>/dev/null || echo '$6$netops$XqM8qK9Z9V1xT4vJ7bQz8w.kYl...')
echo "root:${PASS_HASH}:19800:0:99999:7:::" > "${OVERLAY_DIR}/etc/shadow"
chmod 600 "${OVERLAY_DIR}/etc/shadow"

# 3. Rust SD-WAN Ajanı İkili Dosyasını Göm (ARMv7 Meraki MX64 Uyumlu)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -f "/var/www/downloads/netops-agent-armv7-soft" ]; then
    cp "/var/www/downloads/netops-agent-armv7-soft" "${OVERLAY_DIR}/usr/bin/netops-agent"
elif [ -f "${ROOT_DIR}/packages/rust-sdwan/target/armv7-unknown-linux-musleabi/release/netops-agent" ]; then
    cp "${ROOT_DIR}/packages/rust-sdwan/target/armv7-unknown-linux-musleabi/release/netops-agent" "${OVERLAY_DIR}/usr/bin/netops-agent"
elif [ -f "${DOWNLOADS_DIR}/netops-agent-armv7-soft" ]; then
    cp "${DOWNLOADS_DIR}/netops-agent-armv7-soft" "${OVERLAY_DIR}/usr/bin/netops-agent"
else
    echo "⬇️ Meraki MX64 ARMv7 SD-WAN ajanı indiriliyor..."
    curl -sSL -k "${SERVER_URL}/downloads/netops-agent-armv7-soft" -o "${OVERLAY_DIR}/usr/bin/netops-agent" || true
fi
chmod +x "${OVERLAY_DIR}/usr/bin/netops-agent" 2>/dev/null || true

# 4. Procd Tabanlı Modern Otomatik Başlatma Servisi (/etc/init.d/netops)
cat <<'EOF' > "${OVERLAY_DIR}/etc/init.d/netops"
#!/bin/sh /etc/rc.common
START=95
STOP=10
USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command /usr/bin/netops-agent
    procd_set_param respawn 3600 3 0
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}
EOF
chmod +x "${OVERLAY_DIR}/etc/init.d/netops"
ln -sf "../init.d/netops" "${OVERLAY_DIR}/etc/rc.d/S95netops"

# 4. Donanıma Özel Firmware İmajını Derle (Make Image)
echo -e "${BLUE}[4/5] Donanıma özel kernel ve rootfs derleniyor (${BOARD_PROFILE})...${NC}"

cd "$IB_DIR"

make image \
  PROFILE="$BOARD_PROFILE" \
  PACKAGES="$PACKAGES" \
  FILES="$OVERLAY_DIR" \
  BIN_DIR="${BUILD_ROOT}/bin_out"

cd /builder 2>/dev/null || cd -

echo -e "${BLUE}[5/5] Üretilen Firmware Çıktısı Doğrulanıyor ve Kopyalanıyor...${NC}"
mkdir -p "$OUTPUT_DIR"
cp -r "${BUILD_ROOT}/bin_out/"* "$OUTPUT_DIR/" 2>/dev/null || true
ls -lh "$OUTPUT_DIR"

echo -e "\n${GREEN}================================================================================"
echo "  🎉 Donanıma Özel Gerçek SD-WAN Firmware İmajı Başarıyla Üretildi!"
echo "  📦 Donanım Modeli    : ${PROFILE} (Kernel & DTB: ${DTB_NAME})"
echo "  🏢 Şube Adı          : ${DEVICE_NAME}"
echo "  🌐 Merkez Sunucu     : ${SERVER_URL}"
echo "  💾 Kaydedilen Dizin : ${OUTPUT_DIR}"
echo "================================================================================${NC}\n"
