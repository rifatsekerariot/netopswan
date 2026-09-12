#!/bin/bash
# ==============================================================================
# NetOpsWan Complete Bootable Bare-Metal Linux ISO Builder (Appliance Edition)
# Downloads Debian 12 Base Linux Kernel & Installer, bundles NetOpsWan Offline Suite
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
ISO_WORK_DIR="${DIST_DIR}/iso-appliance-build"
ISO_OUTPUT="${DIST_DIR}/netopswan-appliance-v0.5.0-x86_64.iso"
DEBIAN_MIRROR="https://deb.debian.org/debian/dists/bookworm/main/installer-amd64/current/images/netboot"

echo -e "\n${BLUE}================================================================================${NC}"
echo -e "${CYAN}💿 NETOPSWAN TAM BARE-METAL LINUX APPLIANCE ISO OLUŞTURUCU${NC}"
echo -e "${BLUE}================================================================================${NC}"

# 1. Önce Standalone NetOpsWan Paketini Üret
if [ ! -f "${DIST_DIR}/netopswan-server-v0.4.9-standalone.tar.gz" ]; then
    echo -e "${YELLOW}[1/4] Standalone uygulama paketi hazırlanıyor...${NC}"
    "${ROOT_DIR}/scripts/build_standalone_bundle.sh"
fi

rm -rf "${ISO_WORK_DIR}"
mkdir -p "${ISO_WORK_DIR}/isolinux"
mkdir -p "${ISO_WORK_DIR}/install"
mkdir -p "${ISO_WORK_DIR}/netopswan"

# 2. Standalone Paketi ISO'ya Kopyala
cp "${DIST_DIR}/netopswan-server-v0.4.9-standalone.tar.gz" "${ISO_WORK_DIR}/netopswan/"

# 3. Gerçek Linux Çekirdeği (Kernel: vmlinuz) ve initrd İndir
echo -e "\n${YELLOW}[2/4] Debian 12 Bookworm Resmi x86_64 Linux Çekirdeği İndiriliyor...${NC}"
if [ ! -f "${DIST_DIR}/vmlinuz" ] || [ ! -f "${DIST_DIR}/initrd.gz" ]; then
    curl -sSL "${DEBIAN_MIRROR}/debian-installer/amd64/linux" -o "${DIST_DIR}/vmlinuz"
    curl -sSL "${DEBIAN_MIRROR}/debian-installer/amd64/initrd.gz" -o "${DIST_DIR}/initrd.gz"
fi

cp "${DIST_DIR}/vmlinuz" "${ISO_WORK_DIR}/install/vmlinuz"
cp "${DIST_DIR}/initrd.gz" "${ISO_WORK_DIR}/install/initrd.gz"

# 4. ISOLINUX Bootloader Dosyalarını Kopyala
echo -e "\n${YELLOW}[3/4] ISOLINUX & Syslinux Bootloader Paketleniyor...${NC}"
if [ -f /usr/lib/ISOLINUX/isolinux.bin ]; then
    cp /usr/lib/ISOLINUX/isolinux.bin "${ISO_WORK_DIR}/isolinux/"
elif [ -f /usr/lib/syslinux/isolinux.bin ]; then
    cp /usr/lib/syslinux/isolinux.bin "${ISO_WORK_DIR}/isolinux/"
fi

for c32 in ldlinux.c32 libutil.c32 libcom32.c32 menu.c32 vesamenu.c32; do
    find /usr/lib/syslinux /usr/lib/ISOLINUX -name "$c32" -exec cp {} "${ISO_WORK_DIR}/isolinux/" \; 2>/dev/null || true
done

# 5. Tam Otomatik Unattended Kurulum (Preseed)
cat << 'EOF' > "${ISO_WORK_DIR}/preseed.cfg"
# NetOpsWan Appliance Fully Automated Debian Preseed
d-i debian-installer/locale string en_US
d-i console-setup/ask_detect boolean false
d-i keyboard-configuration/xkb-keymap select tr
d-i netcfg/choose_interface select auto
d-i netcfg/get_hostname string netopswan-gateway
d-i netcfg/get_domain string local

# Root ve Admin Kullanıcıları (Parola ilk açılışta Setup Wizard tarafından kilitlenecek)
ISO_ROOT_PASS="${ISO_ROOT_PASSWORD:-CHANGE_ME_SECURE_ROOT_PASSWORD}"
d-i passwd/root-login boolean true
d-i passwd/root-password password ${ISO_ROOT_PASS}
d-i passwd/root-password-again password ${ISO_ROOT_PASS}
d-i passwd/make-user boolean false

# Saat Dilimi
d-i clock-setup/utc boolean true
d-i time/zone string Europe/Istanbul
d-i clock-setup/ntp boolean true

# Disk Bölümleme (Tüm Diske Otomatik Temiz Kurulum)
d-i partman-auto/method string regular
d-i partman-auto/choose_recipe select atomic
d-i partman-partitioning/confirm_write_new_label boolean true
d-i partman/choose_partition select finish
d-i partman/confirm boolean true
d-i partman/confirm_nooverwrite boolean true

# Paketler (NodeJS, WireGuard, Nginx, PostgreSQL, Curl)
tasksel tasksel/first multiselect standard, ssh-server
d-i pkgsel/include string wireguard nginx postgresql nodejs curl jq sudo
d-i pkgsel/upgrade select full-upgrade

# GRUB Bootloader
d-i grub-installer/only_debian boolean true
d-i grub-installer/with_other_os boolean true
d-i grub-installer/bootdev string default

# Kurulum Sonrası NetOpsWan'ı Kur ve Servisleri Başlat
d-i preseed/late_command string \
    in-target mkdir -p /opt/netopswan; \
    in-target tar -xzf /cdrom/netopswan/netopswan-server-v0.4.9-standalone.tar.gz -C /tmp; \
    in-target /tmp/netopswan-bundle/install.sh; \
    in-target rm -rf /tmp/netopswan-bundle; \
    in-target systemctl enable netops-hub; \
    in-target systemctl enable netops-web

d-i finish-install/reboot_in_progress note
EOF

# 6. Bootloader Menüsü
cat << 'EOF' > "${ISO_WORK_DIR}/isolinux/isolinux.cfg"
default netopswan
prompt 0
timeout 30

label netopswan
  menu label ^1. NetOpsWan SD-WAN Bare-Metal Otomatik Kurulum
  kernel /install/vmlinuz
  append vga=788 initrd=/install/initrd.gz auto=true priority=critical file=/cdrom/preseed.cfg --- quiet
EOF

# 7. ISO Dosyasını Üret
echo -e "\n${YELLOW}[4/4] xorriso ile Bootable Appliance ISO Dosyası Üretiliyor...${NC}"
xorriso -as mkisofs \
    -r -V "NETOPSWAN_OS" \
    -J -l -b isolinux/isolinux.bin \
    -c isolinux/boot.cat \
    -no-emul-boot -boot-load-size 4 -boot-info-table \
    -o "${ISO_OUTPUT}" "${ISO_WORK_DIR}"

echo -e "\n${GREEN}================================================================================${NC}"
echo -e "${GREEN}🎉 TAM BARE-METAL APPLIANCE ISO BAŞARIYLA ÜRETİLDİ!${NC}"
echo -e "   ISO Dosyası: ${ISO_OUTPUT}"
echo -e "   Boyut      : $(ls -lh "${ISO_OUTPUT}" | awk '{print $5}')"
echo -e "${GREEN}================================================================================${NC}\n"
