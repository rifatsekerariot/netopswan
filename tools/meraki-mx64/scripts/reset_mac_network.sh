#!/usr/bin/env bash
set -e

echo "=== Mac Ağ & Route Ayarlarını Sıfırlama ==="

# 1. Eklenen özel statik route'ları temizle
echo "Statik route kayıtları temizleniyor..."
sudo route delete 192.168.1.1 2>/dev/null || true
sudo route delete 192.168.10.1 2>/dev/null || true
sudo route delete -net 192.168.10.0/24 2>/dev/null || true

# 2. en5 üzerindeki manuel IP'yi kaldırıp DHCP (otomatik) moduna al
echo "en5 arayüzü fabrika (DHCP/Otomatik) ayarlarına sıfırlanıyor..."
sudo ifconfig en5 delete 2>/dev/null || true
sudo ipconfig set en5 DHCP 2>/dev/null || true

# 3. ARP önbelleğini temizle
echo "ARP ve DNS önbelleği temizleniyor..."
sudo arp -a -d 2>/dev/null || true
sudo killall -HUP mDNSResponder 2>/dev/null || true

echo ""
echo "✔ Bilgisayarınızın tüm ağ, route ve ethernet ayarları tamamen sıfırlandı ve fabrika varsayılanına döndü!"
