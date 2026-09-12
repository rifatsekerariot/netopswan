#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
PAYLOAD_DIR="$BASE_DIR/payload"

mkdir -p "$PAYLOAD_DIR"
mkdir -p "$BASE_DIR/backups"

echo "=== Cisco Meraki MX64 Payload İndirici ==="
echo "Hedef Dizin: $PAYLOAD_DIR"

# 1. Clayface GitHub Repo Dosyaları (U-Boot, MTD-RW, MTD Araçları)
CLAYFACE_RAW="https://raw.githubusercontent.com/clayface/U-boot-MX64-20190430_MX64/master"

download_file() {
    local url="$1"
    local dest="$2"
    if [ -f "$dest" ]; then
        echo "[ATLANDI] Dosya zaten mevcut: $(basename "$dest")"
    else
        echo "[İNDİRİLİYOR] $(basename "$dest") <- $url"
        curl -fSL "$url" -o "$dest"
    fi
}

echo ""
echo "--- U-Boot ve Yardımcı Araçlar İndiriliyor ---"
download_file "$CLAYFACE_RAW/uboot_mx64" "$PAYLOAD_DIR/uboot_mx64"
download_file "$CLAYFACE_RAW/uboot_mx64_small" "$PAYLOAD_DIR/uboot_mx64_small"
download_file "$CLAYFACE_RAW/mtd" "$PAYLOAD_DIR/mtd"
download_file "$CLAYFACE_RAW/mtd-rw.ko" "$PAYLOAD_DIR/mtd-rw.ko"
download_file "$CLAYFACE_RAW/openwrt-bcm5862x-generic-meraki_mx64a0-initramfs-kernel.bin" "$PAYLOAD_DIR/openwrt-bcm5862x-generic-meraki_mx64a0-initramfs-kernel.bin"
download_file "$CLAYFACE_RAW/openwrt-bcm5862x-generic-meraki_mx64-initramfs-kernel.bin" "$PAYLOAD_DIR/openwrt-bcm5862x-generic-meraki_mx64-initramfs-kernel.bin"

echo ""
echo "--- OpenWrt Resmi Snapshot / Sürüm İmajları İndiriliyor ---"
OPENWRT_SNAP_URL="https://downloads.openwrt.org/snapshots/targets/bcm53xx/generic"
download_file "$OPENWRT_SNAP_URL/openwrt-bcm53xx-generic-meraki_mx64-squashfs.sysupgrade.bin" "$PAYLOAD_DIR/openwrt-bcm53xx-generic-meraki_mx64-squashfs.sysupgrade.bin"
download_file "$OPENWRT_SNAP_URL/openwrt-bcm53xx-generic-meraki_mx64-initramfs.bin" "$PAYLOAD_DIR/openwrt-bcm53xx-generic-meraki_mx64-initramfs.bin"
download_file "$OPENWRT_SNAP_URL/openwrt-bcm53xx-generic-meraki_mx64-a0-squashfs.sysupgrade.bin" "$PAYLOAD_DIR/openwrt-bcm53xx-generic-meraki_mx64-a0-squashfs.sysupgrade.bin"
download_file "$OPENWRT_SNAP_URL/openwrt-bcm53xx-generic-meraki_mx64-a0-initramfs.bin" "$PAYLOAD_DIR/openwrt-bcm53xx-generic-meraki_mx64-a0-initramfs.bin"

echo ""
echo "--- Checksum Kontrolü & Hash Üretimi ---"
cd "$PAYLOAD_DIR"
shasum -a 256 * > "$BASE_DIR/payload/SHA256SUMS" || true
echo ""
echo "Tüm dosyalar başarıyla hazırlandı:"
ls -lh "$PAYLOAD_DIR"
