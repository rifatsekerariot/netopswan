#!/usr/bin/env bash
set -e

NEW_IP="192.168.10.1"
TARGET_IP="192.168.1.1"

echo "=========================================================="
echo "    MX64 LAN IP Değiştirici (192.168.1.1 -> $NEW_IP)"
echo "=========================================================="
echo "Bu işlem, ev/ofis modemi (192.168.1.1) ile çakışmayı önler."
echo ""

echo "MX64'e bağlanılıyor..."
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 "root@$TARGET_IP" << 'EOF'
uci set network.lan.ipaddr='192.168.10.1'
uci commit network
/etc/init.d/network restart &
EOF

echo ""
echo "✔ MX64 LAN IP adresi $NEW_IP olarak değiştirildi!"
echo "Artık ev modemi (192.168.1.1) ile çakışmayacaktır."
echo "Yeni Erişim Adresi: http://192.168.10.1"
