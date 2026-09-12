#!/usr/bin/env bash
# ==============================================================================
# NetOpsWan - Cisco Meraki MX64 Acil Durum OpenVPN Geri Dönüş (Rollback) Betiği
# ==============================================================================
set -e

MERAKI_IP="${1:-192.168.10.1}"
MERAKI_USER="${2:-root}"

echo "=========================================================="
echo "🚨 Meraki MX64 Güvenli OpenVPN Moduna Geri Döndürülüyor..."
echo "🎯 Cihaz IP: $MERAKI_IP"
echo "=========================================================="

ssh "$MERAKI_USER@$MERAKI_IP" << 'EOF'
echo "1. Rust SD-WAN ajanını durduruluyor..."
if [ -f /etc/init.d/netops-agent ]; then
    /etc/init.d/netops-agent stop || true
    /etc/init.d/netops-agent disable || true
fi

echo "2. Orijinal OpenVPN servisi başlatılıyor..."
/etc/init.d/openvpn enable || true
/etc/init.d/openvpn restart || true

echo "3. OpenWISP config ajanı kontrol ediliyor..."
/etc/init.d/openwisp_config restart || true

echo "✅ Geri dönüş (Rollback) başarıyla tamamlandı!"
EOF
