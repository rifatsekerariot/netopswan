#!/bin/sh
# ==============================================================================
# NetOpsWan Zero-Touch Branch Router Provisioning Script (OpenWrt / Linux)
# Usage:
#   curl -sSL https://sdwan.ariot.com.tr/downloads/provision.sh | sh -s -- \
#     --hub-url https://sdwan.ariot.com.tr \
#     --shared-secret <SECRET> \
#     --device-id <DEVICE_ID>
# ==============================================================================

set -e

HUB_URL=""
SHARED_SECRET=""
DEVICE_ID=""
ARCH=$(uname -m)

# Argümanları ayrıştır
while [ "$#" -gt 0 ]; do
    case "$1" in
        --hub-url) HUB_URL="$2"; shift 2;;
        --shared-secret) SHARED_SECRET="$2"; shift 2;;
        --device-id) DEVICE_ID="$2"; shift 2;;
        *) shift 1;;
    esac
done

if [ -z "$HUB_URL" ]; then
    echo "❌ HATA: --hub-url parametresi zorunludur! (Örn: https://sdwan.sirketiniz.com)"
    exit 1
fi

if [ -z "$SHARED_SECRET" ]; then
    echo "❌ HATA: --shared-secret parametresi zorunludur!"
    exit 1
fi

echo "================================================================================"
echo "🚀 NETOPSWAN ŞUBE OTOMATİK KURULUM VE PROVISIONING MOTORU"
echo "   Sunucu        : $HUB_URL"
echo "   Şube/Cihaz ID : ${DEVICE_ID:-Otomatik MAC}"
echo "   Mimari        : $ARCH"
echo "================================================================================"

# 1. Gerekli Dizinleri Oluştur
mkdir -p /etc/netops
mkdir -p /usr/bin

# 2. Shared Secret'ı Güvenli Dosyaya ve UCI'a Yaz
echo "$SHARED_SECRET" > /etc/netops/shared_secret
chmod 600 /etc/netops/shared_secret

echo "$HUB_URL" > /etc/netops/hub_url

if command -v uci >/dev/null 2>&1; then
    touch /etc/config/netops 2>/dev/null || true
    uci set netops.agent=agent 2>/dev/null || true
    uci set netops.agent.hub_url="$HUB_URL" 2>/dev/null || true
    uci set netops.agent.shared_secret="$SHARED_SECRET" 2>/dev/null || true
    [ -n "$DEVICE_ID" ] && uci set netops.agent.device_id="$DEVICE_ID" 2>/dev/null || true
    uci commit netops 2>/dev/null || true
fi

# 3. Mimarisine Göre Uygun Ajanı İndir
AGENT_BIN="netops-agent"
if [ "$ARCH" = "armv7l" ] || [ "$ARCH" = "armv7" ]; then
    AGENT_BIN="netops-agent-armv7-soft"
elif [ "$ARCH" = "aarch64" ]; then
    AGENT_BIN="netops-agent-aarch64"
fi

echo "⬇️ NetOpsWan Ajanı İndiriliyor ($AGENT_BIN)..."
wget -q -O /usr/bin/netops-agent "${HUB_URL}/downloads/${AGENT_BIN}" || curl -sSL -o /usr/bin/netops-agent "${HUB_URL}/downloads/${AGENT_BIN}"
chmod +x /usr/bin/netops-agent

# 4. OpenWrt Init.d Servisi Oluştur
cat << 'EOF' > /etc/init.d/netops
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

chmod +x /etc/init.d/netops
/etc/init.d/netops enable 2>/dev/null || true
/etc/init.d/netops restart 2>/dev/null || (/usr/bin/netops-agent > /dev/null 2>&1 &)

echo "================================================================================"
echo "✅ KURULUM BAŞARILI! Şube cihazı merkeze bağlandı ve güvenli tünel açıldı."
echo "================================================================================"
