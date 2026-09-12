#!/usr/bin/env bash
# ==============================================================================
# NetOpsWan - Cisco Meraki MX64 Rust Agent Dağıtım & Servis Kurulum Betiği
# ==============================================================================
set -e

MERAKI_IP="${1:-192.168.10.1}"
MERAKI_USER="${2:-root}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_PATH="$SCRIPT_DIR/../dist/meraki-armv7/netops-agent"

echo "=========================================================="
echo "🚀 NetOpsWan Rust Agent Meraki MX64'e Gönderiliyor..."
echo "🎯 Cihaz IP: $MERAKI_IP"
echo "=========================================================="

if [ ! -f "$BINARY_PATH" ]; then
    echo "❌ Hata: Binary bulunamadı: $BINARY_PATH"
    echo "Lütfen önce ./cross-build-armv7.sh çalıştırın."
    exit 1
fi

echo "📤 Binary kopyalanıyor (/usr/bin/netops-agent)..."
scp -O "$BINARY_PATH" "$MERAKI_USER@$MERAKI_IP:/usr/bin/netops-agent"
ssh "$MERAKI_USER@$MERAKI_IP" "chmod +x /usr/bin/netops-agent"

echo "⚙️  OpenWrt procd servis dosyası oluşturuluyor (/etc/init.d/netops-agent)..."
ssh "$MERAKI_USER@$MERAKI_IP" << 'EOF'
cat << 'SERVICE' > /etc/init.d/netops-agent
#!/bin/sh /etc/rc.common

USE_PROCD=1
START=95
STOP=10

start_service() {
    procd_open_instance
    procd_set_param command /usr/bin/netops-agent --hub-url https://sdwan.ariot.com.tr/api/sdwan
    procd_set_param respawn 3600 5 0
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}
SERVICE
chmod +x /etc/init.d/netops-agent
/etc/init.d/netops-agent enable
/etc/init.d/netops-agent restart
EOF

echo "=========================================================="
echo "✅ Kurulum Tamamlandı! Servis Meraki üzerinde aktif."
echo "=========================================================="
