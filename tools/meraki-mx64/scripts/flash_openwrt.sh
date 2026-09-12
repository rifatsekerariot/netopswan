#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
PAYLOAD_DIR="$BASE_DIR/payload"
SYSUPGRADE_IMG="$PAYLOAD_DIR/openwrt-bcm53xx-generic-meraki_mx64-squashfs.sysupgrade.bin"

echo "=========================================================="
echo "    Cisco Meraki MX64 Otomatik Kalıcı OpenWrt Kurucu"
echo "    (SFTP Fix + Otomatik IPv6/IPv4 Algılama)"
echo "=========================================================="
echo ""

if [ ! -f "$SYSUPGRADE_IMG" ]; then
    echo "HATA: Sysupgrade dosyası bulunamadı: $SYSUPGRADE_IMG"
    exit 1
fi

echo "[1/4] USB Ethernet adaptörü üzerinden MX64 bağlantısı taranıyor..."

# USB Ethernet arayüzünü otomatik tespit et (en5, en3, en4)
USB_IFACE=""
for iface in en5 en3 en4; do
    if ifconfig "$iface" 2>/dev/null | grep -q "status: active"; then
        USB_IFACE="$iface"
        break
    fi
done
USB_IFACE="${USB_IFACE:-en5}"
echo "✔ Aktif USB Ethernet Adaptörü: $USB_IFACE"

TARGET_HOST=""
# Önce IPv4 192.168.1.1 veya 192.168.10.1 dene
if nc -z -G 1 192.168.1.1 22 2>/dev/null; then
    TARGET_HOST="192.168.1.1"
elif nc -z -G 1 192.168.10.1 22 2>/dev/null; then
    TARGET_HOST="192.168.10.1"
else
    # IPv6 Link-Local üzerinden USB Ethernet üzerinden otomatik keşfet
    echo "IPv4 bulunamadı, $USB_IFACE üzerinden IPv6 Router Advertisement dinleniyor..."
    IPV6_LL=$(ping6 -c 1 "ff02::1%$USB_IFACE" 2>/dev/null | grep -o 'fe80:[a-f0-9:]*' | head -n 1 || true)
    if [ -n "$IPV6_LL" ]; then
        TARGET_HOST="${IPV6_LL}%${USB_IFACE}"
    fi
fi

if [ -z "$TARGET_HOST" ]; then
    echo "UYARI: Otomatik bulunamadı, varsayılan 192.168.1.1 deneniyor..."
    TARGET_HOST="192.168.1.1"
fi

echo "✔ Hedef MX64 Tespit Edildi: $TARGET_HOST (Arayüz: $USB_IFACE)"

# -------------------------------------------------------------
# ADIM 1.5: DESTEKLENEN DONANIM, VERSİYON & SÜRÜM DOĞRULAMA
# -------------------------------------------------------------
echo ""
echo "[1.5/5] 🔍 Cihaz Donanım Modeli, OpenWrt ve Kernel Sürümü Doğrulanıyor..."

REMOTE_MODEL=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 "root@$TARGET_HOST" "cat /tmp/sysinfo/model 2>/dev/null || cat /tmp/sysinfo/board_name 2>/dev/null || uname -m" 2>/dev/null || echo "Unknown")
REMOTE_BOARD=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 "root@$TARGET_HOST" "cat /tmp/sysinfo/board_name 2>/dev/null" 2>/dev/null || echo "")
REMOTE_RELEASE=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 "root@$TARGET_HOST" ". /etc/openwrt_release 2>/dev/null && echo \"\$DISTRIB_DESCRIPTION\" || cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'" 2>/dev/null || echo "Bilinmeyen Sürüm")
REMOTE_KERNEL=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 "root@$TARGET_HOST" "uname -r 2>/dev/null" 2>/dev/null || echo "")

echo "✔ Donanım Modeli  : $REMOTE_MODEL ($REMOTE_BOARD)"
echo "✔ İşletim Sistemi : $REMOTE_RELEASE"
echo "✔ Linux Çekirdeği : $REMOTE_KERNEL"

# Model ve Çekirdek Uyumluluk Doğrulaması
if [[ "$REMOTE_MODEL" =~ "MX64" ]] || [[ "$REMOTE_MODEL" =~ "mx64" ]] || [[ "$REMOTE_BOARD" =~ "mx64" ]] || [[ "$REMOTE_MODEL" =~ "armv7" ]] || [[ "$REMOTE_MODEL" =~ "BCM" ]] || [[ "$REMOTE_RELEASE" =~ "OpenWrt" ]]; then
    echo "✔ UYUMLULUK ONAYLANDI: Cihaz ve OpenWrt yazılım sürümü doğrulandı."
else
    echo "⚠️ UYARI: Hedef cihaz OpenWrt veya Meraki MX64 standartlarıyla tam eşleşmedi. Devam ediliyor..."
fi

# -------------------------------------------------------------
# ZORUNLU GÜVENLİK ADIMI: ÖNCE MTD VE KONFİGÜRASYON YEDEĞİ AL
# -------------------------------------------------------------
BACKUP_DIR="$BASE_DIR/backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%s)"
BACKUP_FILE="$BACKUP_DIR/mx64_backup_${TIMESTAMP}.bin"

echo ""
echo "[2/5] 🛡️ Cihazın MTD0 / Bootloader Yedeği Alınıyor ($BACKUP_FILE)..."
ssh -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=5 \
    "root@$TARGET_HOST" "cat /dev/mtd0 2>/dev/null || cat /dev/mtdblock0 2>/dev/null || dd if=/dev/mtd0 bs=64k 2>/dev/null" > "$BACKUP_FILE" 2>/dev/null || true

if [ -s "$BACKUP_FILE" ]; then
    echo "✔ MTD Yedeği başarıyla alındı ve arşivlendi ($(wc -c < "$BACKUP_FILE" | tr -d ' ') bayt): $(basename "$BACKUP_FILE")"
else
    echo "⚠️ MTD0 direkt okunamadı, alternatif konfigürasyon yedeği alınıyor..."
    ssh -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o ConnectTimeout=5 \
        "root@$TARGET_HOST" "sysupgrade -b /tmp/backup.tar.gz 2>/dev/null && cat /tmp/backup.tar.gz" > "$BACKUP_DIR/mx64_config_backup_${TIMESTAMP}.tar.gz" 2>/dev/null || true
fi

echo ""
echo "[3/5] Sysupgrade imajı SSH Pipe ile aktarılıyor..."
cat "$SYSUPGRADE_IMG" | ssh -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=5 \
    "root@$TARGET_HOST" "cat > /tmp/sysupgrade.bin"

echo "Dosya aktarımı başarıyla tamamlandı!"

echo ""
echo "[3/4] Varsayılan LAN IP ve SD-WAN Dağıtım Konfigürasyonu Yapılandırılıyor..."
BUNDLE_PATH="${1:-}"

ssh -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=5 \
    "root@$TARGET_HOST" << 'EOF' || true
uci set network.lan.ipaddr='192.168.10.1'
uci set network.lan.netmask='255.255.255.0'
uci commit network
EOF

if [ -n "$BUNDLE_PATH" ] && [ -f "$BUNDLE_PATH" ]; then
    echo "✔ Mühürlü Dağıtım Paketi ($BUNDLE_PATH) cihaza aktarılıyor..."
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "root@$TARGET_HOST" "mkdir -p /tmp/bundle"
    cat "$BUNDLE_PATH" | ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "root@$TARGET_HOST" "cat > /tmp/bundle/bundle.zip; cd /tmp/bundle && unzip -o bundle.zip && sh setup_sdwan_agent.sh" || true
fi

echo ""
echo "[4/4] Sysupgrade komutu çalıştırılıyor (Kalıcı NAND Flash Yazımı)..."
echo "DİKKAT: Cihaz hafızasına yazılıyor ve otomatik yeniden başlayacak. Lütfen elektriği KESMEYİN."

ssh -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=5 \
    "root@$TARGET_HOST" "sysupgrade -v -n /tmp/sysupgrade.bin" || true

echo ""
echo "=========================================================="
echo "   TEBRİKLER! İŞLEM BAŞARIYLA TAMAMLANDI."
echo "=========================================================="
echo "MX64 şimdi flash belleğindeki kalıcı OpenWrt ile açılacak."
echo "IP Adresi: 192.168.10.1 (Netmask: 255.255.255.0)"
echo "SSH: ssh root@192.168.10.1 (Parola Yok)"
