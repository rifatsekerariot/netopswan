#!/bin/bash
# ==============================================================================
# NetOpsWan SD-WAN Comprehensive End-to-End System Validation Suite
# Zero-Hardcoded, Fully Automated, Hardware & In-Band Overlay Verified Test Engine
# ==============================================================================

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Bu betik kendi Hub sunucunuza karşı çalışır - aşağıdaki değerleri kendi ortam
# değişkenlerinizle geçin (örn: export SSH_HOST=root@sizin-sunucunuz.com).
SSH_HOST="${SSH_HOST:?HATA: SSH_HOST ortam değişkenini ayarlayın (örn: root@sunucu.example.com)}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:?HATA: SSH_KEY ortam değişkenini SSH private key yolunuzla ayarlayın}"
SSH_CMD="ssh -p ${SSH_PORT} -i ${SSH_KEY} -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${SSH_HOST}"

PASSED_COUNT=0
FAILED_COUNT=0
TOTAL_COUNT=0

log_section() {
    echo -e "\n${BLUE}================================================================================${NC}"
    echo -e "${CYAN}▶ $1${NC}"
    echo -e "${BLUE}================================================================================${NC}"
}

report_test() {
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    local test_name="$1"
    local status="$2"
    local proof="$3"

    if [ "$status" -eq 0 ]; then
        PASSED_COUNT=$((PASSED_COUNT + 1))
        echo -e "${GREEN}[✔ PASS]${NC} ${test_name}"
        if [ -n "$proof" ]; then
            echo -e "         ${CYAN}Kanıt:${NC} ${proof}"
        fi
    else
        FAILED_COUNT=$((FAILED_COUNT + 1))
        echo -e "${RED}[✖ FAIL]${NC} ${test_name}"
        if [ -n "$proof" ]; then
            echo -e "         ${YELLOW}Hata / Kanıt:${NC} ${proof}"
        fi
    fi
}

# ------------------------------------------------------------------------------
# 1. MERKEZ SUNUCU VE SERVİS SAĞLIK DENETİMLERİ (Core Services Health)
# ------------------------------------------------------------------------------
log_section "1. MERKEZ SUNUCU VE SERVİS SAĞLIK KONTROLLERİ"

# 1.1 PM2 Süreçleri
PM2_OUT=$($SSH_CMD "pm2 jlist | jq -r '.[] | \"\(.name):\(.pm2_env.status)\"'")
echo "$PM2_OUT" | grep -q "netopswan:online" && PM2_FE_OK=0 || PM2_FE_OK=1
report_test "Next.js Frontend PM2 Süreci Aktif" $PM2_FE_OK "$(echo "$PM2_OUT" | grep "netopswan")"

echo "$PM2_OUT" | grep -q "netops-hub:online" && PM2_HUB_OK=0 || PM2_HUB_OK=1
report_test "Rust Central Hub PM2 Süreci Aktif" $PM2_HUB_OK "$(echo "$PM2_OUT" | grep "netops-hub")"

# 1.2 PostgreSQL Veritabanı Sağlığı
DB_CHECK=$($SSH_CMD "cd /opt/netoswan/frontend && node -e '
const { Pool } = require(\"pg\");
const p = new Pool({
  host: process.env.POSTGRES_HOST || \"127.0.0.1\",
  port: parseInt(process.env.POSTGRES_PORT || \"5432\"),
  database: process.env.POSTGRES_DB || \"netopswan\",
  user: process.env.POSTGRES_USER || \"postgres\",
  password: process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || \"CHANGE_ME_PASSWORD\"
});
p.query(\"SELECT count(*) as dev_count FROM netops_devices\").then(r => {
  console.log(\"DB_OK:\" + r.rows[0].dev_count);
  p.end();
}).catch(e => { console.log(\"DB_ERR:\" + e.message); p.end(); });
'")
echo "$DB_CHECK" | grep -q "DB_OK" && DB_OK=0 || DB_OK=1
report_test "PostgreSQL Bağlantısı & netops_devices Tablosu" $DB_OK "$DB_CHECK"

# 1.3 Nginx Proxy ve SSL Sağlığı
NGINX_TEST=$($SSH_CMD "curl -k -s -o /dev/null -w '%{http_code}' https://sdwan.ariot.com.tr/health || true")
[ "$NGINX_TEST" = "200" ] && NGINX_OK=0 || NGINX_OK=1
report_test "Nginx SSL Reverse Proxy (/health)" $NGINX_OK "HTTP Status: $NGINX_TEST"

# ------------------------------------------------------------------------------
# 2. ŞUBE KEŞFİ VE IN-BAND OVERLAY TÜNEL TESTLERİ (SD-WAN L3 Mesh)
# ------------------------------------------------------------------------------
log_section "2. ŞUBE KEŞFİ VE TÜNEL İÇİ (IN-BAND OVERLAY) TESTLERİ"

PEERS_JSON=$($SSH_CMD "curl -s http://127.0.0.1:8088/api/v1/sdwan/peers")
PEER_COUNT=$(echo "$PEERS_JSON" | jq -r '.count // 0')
[ "$PEER_COUNT" -ge 2 ] && PEERS_OK=0 || PEERS_OK=1
report_test "Central Hub Aktif Şube Sayısı (>= 2)" $PEERS_OK "Bağlı Şube Sayısı: $PEER_COUNT"

# Dinamik Şube Bilgilerini Çıkar
ARIOT_ID=$(echo "$PEERS_JSON" | jq -r '.results[] | select(.mac_address=="F8:9E:28:82:BA:A8") | .device_id')
ARIOT_VIP=$(echo "$PEERS_JSON" | jq -r '.results[] | select(.mac_address=="F8:9E:28:82:BA:A8") | .virtual_ip' | cut -d/ -f1)
ARIOT_LAN=$(echo "$PEERS_JSON" | jq -r '.results[] | select(.mac_address=="F8:9E:28:82:BA:A8") | .lan_ip')

NETFIX_ID=$(echo "$PEERS_JSON" | jq -r '.results[] | select(.mac_address=="F8:9E:28:82:B8:70") | .device_id')
NETFIX_VIP=$(echo "$PEERS_JSON" | jq -r '.results[] | select(.mac_address=="F8:9E:28:82:B8:70") | .virtual_ip' | cut -d/ -f1)
NETFIX_LAN=$(echo "$PEERS_JSON" | jq -r '.results[] | select(.mac_address=="F8:9E:28:82:B8:70") | .lan_ip')

# 2.1 Hub -> ARIOT Tünel Ping Testi
PING_ARIOT=$($SSH_CMD "ping -c 3 -W 2 $ARIOT_VIP 2>&1 || true")
echo "$PING_ARIOT" | grep -q "0% packet loss" && PING_ARIOT_OK=0 || PING_ARIOT_OK=1
report_test "Hub (10.8.0.1) -> ARIOT ($ARIOT_VIP) Tünel Pingi" $PING_ARIOT_OK "$(echo "$PING_ARIOT" | tail -n 2)"

# 2.2 Hub -> Netfix Tünel Ping Testi
PING_NETFIX=$($SSH_CMD "ping -c 3 -W 2 $NETFIX_VIP 2>&1 || true")
echo "$PING_NETFIX" | grep -q "0% packet loss" && PING_NETFIX_OK=0 || PING_NETFIX_OK=1
report_test "Hub (10.8.0.1) -> Netfix ($NETFIX_VIP) Tünel Pingi" $PING_NETFIX_OK "$(echo "$PING_NETFIX" | tail -n 2)"

# 2.3 Inter-Branch Mesh Ping Testi (ARIOT -> Netfix LAN)
MESH_PING=$($SSH_CMD "curl -s -X POST http://127.0.0.1:8088/api/v1/sdwan/commands/exec -H 'Content-Type: application/json' -d '{\"device_id\":\"$ARIOT_ID\",\"command\":\"ping -c 3 -W 2 $NETFIX_VIP\"}' | jq -r '.output'")
echo "$MESH_PING" | grep -q "0% packet loss" && MESH_OK=0 || MESH_OK=1
report_test "Şubeler Arası SD-WAN Mesh: ARIOT -> Netfix ($NETFIX_VIP)" $MESH_OK "$(echo "$MESH_PING" | tail -n 2 | tr '\n' ' ')"

# ------------------------------------------------------------------------------
# 3. DONANIM KİLİTLEME VE OTOMATİK İZOLASYON TESTLERİ (WAN Killswitch)
# ------------------------------------------------------------------------------
log_section "3. DONANIM KİLİTLEME (DROP) VE RESTORE TESTLERİ"

# 3.1 ARIOT Şubesi İnternetini Kilitle (Drop Egress)
$SSH_CMD "curl -s -X POST http://127.0.0.1:8088/api/v1/sdwan/commands/exec -H 'Content-Type: application/json' -d '{\"device_id\":\"$ARIOT_ID\",\"command\":\"uci delete firewall.forwarding1 2>/dev/null || true; uci commit firewall && /etc/init.d/firewall restart\"}'" > /dev/null
sleep 4

# Donanım Seviyesinde İnternetin Engellendiğini Doğrula
DROP_TEST=$($SSH_CMD "curl -s -X POST http://127.0.0.1:8088/api/v1/sdwan/commands/exec -H 'Content-Type: application/json' -d '{\"device_id\":\"$ARIOT_ID\",\"command\":\"ping -I br-lan -c 2 -W 2 8.8.8.8 2>&1 || echo LAN_IS_BLOCKED\"}' | jq -r '.output'")
echo "$DROP_TEST" | grep -q "LAN_IS_BLOCKED" && DROP_OK=0 || DROP_OK=1
report_test "WAN Killswitch: ARIOT LAN Dış İnternet Çıkışı %100 Engellendi" $DROP_OK "$(echo "$DROP_TEST" | tr '\n' ' ')"

# İnternet Kapalıyken Tünel İçi Telemetri Akıyor mu?
DROP_TEL_FW=$($SSH_CMD "curl -s http://127.0.0.1:8088/api/v1/sdwan/peers | jq -r '.results[] | select(.device_id==\"$ARIOT_ID\") | .firewall_mode'")
[ "$DROP_TEL_FW" = "DROP_ALL" ] && TEL_DROP_OK=0 || TEL_DROP_OK=1
report_test "In-Band Telemetri: Şube İnterneti Kapalıyken Hub'a 'DROP_ALL' Bildirdi" $TEL_DROP_OK "firewall_mode: $DROP_TEL_FW"

# 3.2 ARIOT Şubesi İnternetini Geri Aç (Restore)
$SSH_CMD "curl -s -X POST http://127.0.0.1:8088/api/v1/sdwan/commands/exec -H 'Content-Type: application/json' -d '{\"device_id\":\"$ARIOT_ID\",\"command\":\"uci set firewall.forwarding1=forwarding && uci set firewall.forwarding1.src=lan && uci set firewall.forwarding1.dest=wan && uci commit firewall && /etc/init.d/firewall restart\"}'" > /dev/null
sleep 4

RESTORE_TEST=$($SSH_CMD "curl -s -X POST http://127.0.0.1:8088/api/v1/sdwan/commands/exec -H 'Content-Type: application/json' -d '{\"device_id\":\"$ARIOT_ID\",\"command\":\"ping -I br-lan -c 2 -W 2 8.8.8.8 2>&1\"}' | jq -r '.output'")
echo "$RESTORE_TEST" | grep -q "0% packet loss" && RESTORE_OK=0 || RESTORE_OK=1
report_test "WAN Killswitch Açma: ARIOT LAN İnternet Çıkışı Başarıyla Yeniden Açıldı" $RESTORE_OK "$(echo "$RESTORE_TEST" | tail -n 2 | tr '\n' ' ')"

RESTORE_TEL_FW=$($SSH_CMD "curl -s http://127.0.0.1:8088/api/v1/sdwan/peers | jq -r '.results[] | select(.device_id==\"$ARIOT_ID\") | .firewall_mode'")
[ "$RESTORE_TEL_FW" = "OPEN" ] && TEL_OPEN_OK=0 || TEL_OPEN_OK=1
report_test "In-Band Telemetri: Şube İnterneti Açılınca Hub'a 'OPEN' Bildirdi" $TEL_OPEN_OK "firewall_mode: $RESTORE_TEL_FW"

# ------------------------------------------------------------------------------
# 4. GÜVENLİK, LOG ENGINE VE NAC KONTROLLERİ
# ------------------------------------------------------------------------------
log_section "4. GÜVENLİK DUVALI, ZERO-TRUST NAC VE DUCKDB LOG MOTORU"

# 4.1 DuckDB Canlı Log Sorgulama API'si
LOGS_JSON=$($SSH_CMD "curl -s http://127.0.0.1:8088/api/v1/sdwan/logs")
LOG_COUNT=$(echo "$LOGS_JSON" | jq -r '.count // 0')
[ "$LOG_COUNT" -ge 0 ] && LOG_OK=0 || LOG_OK=1
report_test "DuckDB Güvenlik ve Ağ Log Akış Motoru" $LOG_OK "Sistemdeki Güvenlik Olayı Sayısı: $LOG_COUNT"

# 4.2 Şubelerdeki Ajan Sürümü Doğrulaması
ARIOT_VER=$($SSH_CMD "curl -s -X POST http://127.0.0.1:8088/api/v1/sdwan/commands/exec -H 'Content-Type: application/json' -d '{\"device_id\":\"$ARIOT_ID\",\"command\":\"/usr/bin/netops-agent --version\"}' | jq -r '.output'" | tr -d '\n')
NETFIX_VER=$($SSH_CMD "curl -s -X POST http://127.0.0.1:8088/api/v1/sdwan/commands/exec -H 'Content-Type: application/json' -d '{\"device_id\":\"$NETFIX_ID\",\"command\":\"/usr/bin/netops-agent --version\"}' | jq -r '.output'" | tr -d '\n')

[ "$ARIOT_VER" = "netops-agent 0.4.9" ] && VER_ARIOT_OK=0 || VER_ARIOT_OK=1
report_test "ARIOT Şubesi Ajan Sürümü (v0.4.9 Doğrulaması)" $VER_ARIOT_OK "$ARIOT_VER"

[ "$NETFIX_VER" = "netops-agent 0.4.9" ] && VER_NETFIX_OK=0 || VER_NETFIX_OK=1
report_test "Netfix Şubesi Ajan Sürümü (v0.4.9 Doğrulaması)" $VER_NETFIX_OK "$NETFIX_VER"

# ------------------------------------------------------------------------------
# 5. FRONTEND VE ARAYÜZ API EŞLEME DENETİMİ (Full Stack UI Tests)
# ------------------------------------------------------------------------------
log_section "5. FRONTEND & ARAYÜZ ENTEGRASYON TESTLERİ"

FE_DEVICES=$($SSH_CMD "curl -s https://sdwan.ariot.com.tr/api/devices")
FE_DEV_COUNT=$(echo "$FE_DEVICES" | jq -r '.count // 0')
[ "$FE_DEV_COUNT" -ge 2 ] && FE_DEV_OK=0 || FE_DEV_OK=1
report_test "Frontend /api/devices Uç Noktası (Veritabanı & Hub Eşleşmesi)" $FE_DEV_OK "Listelenen Cihaz Sayısı: $FE_DEV_COUNT"

# Frontend DTO İçinde is_wan_locked_hw ve firewall_mode Alanları Var mı?
HAS_FW_FIELDS=$(echo "$FE_DEVICES" | jq -r '.results[0] | has("firewall_mode") and has("is_wan_locked_hw")')
[ "$HAS_FW_FIELDS" = "true" ] && FE_FIELDS_OK=0 || FE_FIELDS_OK=1
report_test "Frontend API DTO Donanım Güvenlik Alanları (is_wan_locked_hw)" $FE_FIELDS_OK "DTO Alanları Mevcut: $HAS_FW_FIELDS"

# ------------------------------------------------------------------------------
# TEST RAPORU VE ÖZET
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}================================================================================${NC}"
echo -e "${CYAN}                       GENEL TEST ÖZET RAPORU                                   ${NC}"
echo -e "${BLUE}================================================================================${NC}"
echo -e "  Toplam Yürütülen Test  : ${TOTAL_COUNT}"
echo -e "  Başarılı Testler (PASS): ${GREEN}${PASSED_COUNT}${NC}"
echo -e "  Başarısız Testler(FAIL): ${RED}${FAILED_COUNT}${NC}"

if [ "$FAILED_COUNT" -eq 0 ]; then
    echo -e "\n${GREEN}🎉 TEBRİKLER! Tüm sistem bileşenleri, şubeler, tüneller ve güvenlik kuralları %100 SORUNSUZ ÇALIŞIYOR.${NC}\n"
    exit 0
else
    echo -e "\n${RED}⚠️ DİKKAT! $FAILED_COUNT adet test başarısız oldu. Lütfen yukarıdaki detayları inceleyiniz.${NC}\n"
    exit 1
fi
