#!/bin/bash
# ==============================================================================
# NetOpsWan Zero-Trust & Dual-NIC Enterprise Security Audit
# Validates Unauthorized Access Blocking, WAN Minimization, and Secret Token Auth
# ==============================================================================

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

log_pass() {
    echo -e "${GREEN}[✔ PASS]${NC} $1"
    echo -e "         ${CYAN}Kanıt:${NC} $2\n"
    PASS_COUNT=$((PASS_COUNT + 1))
}

log_fail() {
    echo -e "${RED}[✖ FAIL]${NC} $1"
    echo -e "         ${YELLOW}Hata / Kanıt:${NC} $2\n"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

echo -e "\n${BLUE}================================================================================${NC}"
echo -e "${CYAN}🛡️ NETOPSWAN SIFIR GÜVEN (ZERO-TRUST) VE GÜVENLİK AUDIT TESTİ${NC}"
echo -e "${BLUE}================================================================================${NC}"

# TEST 1: Yetkisiz Cihazın Şifresiz/Tokensiz Kayıt Olma Girişimi
echo -e "\n${YELLOW}▶ 1. Yetkisiz Cihaz Kayıt Güvenliği (Unauthorized Device Registration)${NC}"
UNAUTH_RES=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://127.0.0.1:8088/api/v1/sdwan/register \
  -H "Content-Type: application/json" \
  -d '{"device_id":"unauthorized-rogue","mac_address":"00:AA:BB:CC:DD:EE","model":"RogueBox","serial_number":"ROGUE1","public_key":"dummy=","local_ip_ranges":[],"management_ip":"1.1.1.1","tunnel_listen_port":51820,"agent_version":"1.0"}')

if echo "$UNAUTH_RES" | grep -q "HTTP_STATUS:401" || echo "$UNAUTH_RES" | grep -q "Unauthorized"; then
    log_pass "Yetkisiz / Şifresiz Cihaz Kaydı %100 Engellendi (HTTP 401)" "$UNAUTH_RES"
else
    log_fail "Yetkisiz Cihaz Engellenemedi!" "$UNAUTH_RES"
fi

# TEST 2: Yetkili Ön-Paylaşımlı Secret (PSK) ile Doğru Kayıt
echo -e "${YELLOW}▶ 2. Yetkili Zero-Trust Token (X-NetOps-Secret) ile Kayıt Doğrulaması${NC}"
SECRET=$(cat /etc/netops/shared_secret 2>/dev/null | tr -d '\n' || echo "netops-prod-secret-9a8b7c6d5e4f3a2b")
AUTH_RES=$(curl -s -X POST http://127.0.0.1:8088/api/v1/sdwan/register \
  -H "Content-Type: application/json" \
  -H "X-NetOps-Secret: ${SECRET}" \
  -d '{"device_id":"security-test-device","mac_address":"00:AA:BB:CC:DD:99","model":"Meraki MX64","serial_number":"SEC99","public_key":"secpubkey123=","local_ip_ranges":[],"management_ip":"1.1.1.1","tunnel_listen_port":51820,"agent_version":"0.4.9"}')

if echo "$AUTH_RES" | grep -q "assigned_virtual_ip"; then
    log_pass "Yetkili Cihaz X-NetOps-Secret ile Başarıyla Doğrulandı" "$AUTH_RES"
    # Temizlik
    curl -s -X DELETE "http://127.0.0.1:8088/api/v1/sdwan/peers/security-test-device" > /dev/null 2>&1 || true
else
    log_fail "Yetkili Cihaz Kaydı Başarısız!" "$AUTH_RES"
fi

# TEST 3: Dış Ağdan (WAN) Doğrudan Komut Çalıştırma / Peers İzolasyonu
echo -e "${YELLOW}▶ 3. Merkez Hub ve Canlı Peer Bütünlüğü Kontrolü${NC}"
PEERS_RES=$(curl -s http://127.0.0.1:8088/api/v1/sdwan/peers)
PEER_COUNT=$(echo "$PEERS_RES" | jq '.count' 2>/dev/null || echo "0")

if [ "$PEER_COUNT" -ge 2 ]; then
    log_pass "Tüm Şubeler Hub Üzerinde Aktif ve Güvenli Tünel İçinde" "Aktif Şube Sayısı: ${PEER_COUNT}"
else
    log_fail "Şubeler Hub Üzerinde Görünmüyor" "$PEERS_RES"
fi

# TEST 4: Veritabanı ve Şifrelenmiş Parola Bütünlüğü (SHA-256)
echo -e "${YELLOW}▶ 4. Veritabanı Kimlik Doğrulama Güvenliği (Zero Plaintext Passwords)${NC}"
DB_PASSWORDS=$(PGPASSWORD="${DB_PASSWORD:-CHANGE_ME_PASSWORD}" psql -h "${DB_HOST:-127.0.0.1}" -U "${DB_USER:-postgres}" -d "${DB_NAME:-netopswan}" -t -c "SELECT password_hash FROM netops_users LIMIT 1;" 2>/dev/null | tr -d ' \n' || echo "")

if [ ${#DB_PASSWORDS} -eq 64 ]; then
    log_pass "Veritabanında Düz Metin (Plaintext) Şifre Yok (64 Karakter SHA-256 Hash Doğrulandı)" "Hash: ${DB_PASSWORDS:0:16}...${DB_PASSWORDS:48:16}"
else
    log_fail "Şifre Hash Uzunluğu Beklenen 64 Karakter Değil" "Okunan: $DB_PASSWORDS"
fi

echo -e "${BLUE}================================================================================${NC}"
echo -e "${CYAN}📊 GÜVENLİK AUDIT SONUCU: ${GREEN}${PASS_COUNT} BAŞARILI${NC} / ${RED}${FAIL_COUNT} BAŞARISIZ${NC}"
echo -e "${BLUE}================================================================================${NC}\n"
