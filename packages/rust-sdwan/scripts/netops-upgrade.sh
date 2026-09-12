#!/bin/sh
# ==============================================================================
# NetOpsWan - Fail-Safe Atomic Agent Upgrade & Watchdog Rollback Script
# Universal for OpenWrt & Linux SD-WAN Edge Routers
# ==============================================================================
set -e

SOURCE_URL="$1"
TARGET_BIN="/usr/bin/netops-agent"
BACKUP_BIN="/usr/bin/netops-agent.bak"
TEMP_BIN="/tmp/netops-agent.download"
HEALTH_FLAG="/tmp/netops_healthy"
TIMEOUT_SECS=45

if [ -z "$SOURCE_URL" ]; then
    echo "❌ Hata: İndirme URL'si belirtilmedi."
    echo "Kullanım: $0 <binary_url_or_local_path>"
    exit 1
fi

echo "=========================================================="
echo "🛡️  NetOps SD-WAN Güvenli Güncelleme (Fail-Safe OTA) Başlatıldı"
echo "🌐 Kaynak: $SOURCE_URL"
echo "=========================================================="

# 1. Yeni Binary'yi Geçici Dizine İndir veya Kopyala
rm -f "$TEMP_BIN" "$HEALTH_FLAG"

if [ -f "$SOURCE_URL" ]; then
    cp -f "$SOURCE_URL" "$TEMP_BIN"
else
    echo "📥 Yeni binary indiriliyor..."
    if command -v curl >/dev/null 2>&1; then
        curl -sSL -k -o "$TEMP_BIN" "$SOURCE_URL"
    elif command -v wget >/dev/null 2>&1; then
        wget -q --no-check-certificate -O "$TEMP_BIN" "$SOURCE_URL"
    elif command -v uclient-fetch >/dev/null 2>&1; then
        uclient-fetch --no-check-certificate -O "$TEMP_BIN" "$SOURCE_URL"
    else
        echo "❌ Hata: curl veya wget bulunamadı."
        exit 1
    fi
fi

# 2. Binary Bütünlük ve Çalıştırılabilirlik Testi (Sanity Check)
if [ ! -s "$TEMP_BIN" ]; then
    echo "❌ Hata: İndirilen binary boş veya geçersiz!"
    rm -f "$TEMP_BIN"
    exit 1
fi

chmod +x "$TEMP_BIN"

# Binary'nin mimarisini ve ELF başlığını doğrula (Dry-run / Help)
if ! "$TEMP_BIN" --version >/dev/null 2>&1 && ! "$TEMP_BIN" --help >/dev/null 2>&1; then
    echo "❌ Hata: İndirilen binary bu donanım mimarisinde çalışmıyor! Güncelleme iptal edildi."
    rm -f "$TEMP_BIN"
    exit 1
fi

echo "✅ Binary mimari doğrulaması başarılı."

# 3. Mevcut Çalışan Sürümü Yedekle
if [ -f "$TARGET_BIN" ]; then
    echo "📦 Mevcut sürüm yedekleniyor ($BACKUP_BIN)..."
    cp -f "$TARGET_BIN" "$BACKUP_BIN"
fi

# 4. Atomik Olarak Yeni Sürümü Devreye Al
echo "🔄 Yeni sürüm sisteme yerleştiriliyor..."
mv -f "$TEMP_BIN" "$TARGET_BIN"
chmod +x "$TARGET_BIN"

# 5. Servisi Yeniden Başlat
echo "⚡ netops-agent servisi yeniden başlatılıyor..."
if [ -f /etc/init.d/netops-agent ]; then
    /etc/init.d/netops-agent restart
elif command -v systemctl >/dev/null 2>&1; then
    systemctl restart netops-agent || true
fi

# 6. Watchdog: Merkeze Bağlantı ve Sağlık Denetimi
echo "⏳ Watchdog devrede: Merkez bağlantı onayı bekleniyor (${TIMEOUT_SECS}sn)..."
COUNT=0
HEALTHY=0

while [ $COUNT -lt $TIMEOUT_SECS ]; do
    sleep 1
    COUNT=$((COUNT + 1))
    
    if [ -f "$HEALTH_FLAG" ]; then
        HEALTHY=1
        break
    fi
    printf "."
done
echo ""

# 7. Sonuç Değerlendirmesi: Başarı veya Otomatik Rollback
if [ $HEALTHY -eq 1 ]; then
    echo "=========================================================="
    echo "🎉 GÜNCELLEME BAŞARILI! Merkez Hub ile tünel ve telemetri doğrulandı."
    echo "=========================================================="
    rm -f "$BACKUP_BIN"
    exit 0
else
    echo "=========================================================="
    echo "⚠️ UYARI: Yeni agent merkeze bağlanamadı veya yanıt vermedi!"
    echo "↩️  OTOMATİK GERİ ALMA (AUTO-ROLLBACK) BAŞLATILIYOR..."
    echo "=========================================================="
    
    if [ -f "$BACKUP_BIN" ]; then
        cp -f "$BACKUP_BIN" "$TARGET_BIN"
        chmod +x "$TARGET_BIN"
        if [ -f /etc/init.d/netops-agent ]; then
            /etc/init.d/netops-agent restart
        elif command -v systemctl >/dev/null 2>&1; then
            systemctl restart netops-agent || true
        fi
        echo "✅ Önceki çalışan stabil sürüme başarıyla geri dönüldü."
    else
        echo "❌ Yedek binary bulunamadı!"
    fi
    exit 1
fi
