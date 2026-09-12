#!/usr/bin/env bash
set -e

echo "=== MX64 IP Adresini 192.168.10.1 Yapma (İnterneti Kesmeden) ==="

# 1. Sadece 192.168.1.1 IP'sini geçici olarak MX64 ethernetine (en5) yönlendir
sudo ifconfig en5 inet 192.168.1.2 netmask 255.255.255.0 up
sudo route delete 192.168.1.1 2>/dev/null || true
sudo route add -host 192.168.1.1 -interface en5

echo "MX64'e bağlanılıyor ve IP kalıcı olarak 192.168.10.1 yapılıyor..."
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 root@192.168.1.1 << 'EOF'
uci set network.lan.ipaddr='192.168.10.1'
uci commit network
/etc/init.d/network restart
EOF

# 2. Yönlendirmeyi kaldırıp en5'i 192.168.10.2 yap
sudo route delete 192.168.1.1 2>/dev/null || true
sudo ifconfig en5 inet 192.168.10.2 netmask 255.255.255.0 up

echo ""
echo "✔ İŞLEM TAMAMLANDI!"
echo "1. Wi-Fi internetiniz aynen devam ediyor (192.168.1.1 modeminize bağlı)."
echo "2. MX64 cihazınız artık kalıcı olarak 192.168.10.1 oldu."
echo "Erişim adresi: http://192.168.10.1"
