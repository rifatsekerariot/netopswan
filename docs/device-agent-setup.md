# OpenWrt Cihaz Tarafı Kurulum Rehberi (`openwisp-config`)

Bu doküman, Cisco Meraki MX64 veya herhangi bir OpenWrt cihazı üzerinde **OpenWISP Agent** (`openwisp-config`) kurulumu ve yapılandırmasını açıklar.

---

## 1. Paket Kurulumu (OpenWrt Shell)

OpenWrt cihazında SSH ile oturum açtıktan sonra paket listesini güncelleyin ve gerekli OpenWISP agent paketlerini yükleyin:

```bash
opkg update
opkg install openwisp-config curl jsonfilter
```

*(Not: Eğer OpenWrt imajını ImageBuilder ile derliyorsanız, `PACKAGES="openwisp-config curl jsonfilter wireguard mwan3"` parametrelerini imaja gömebilirsiniz.)*

---

## 2. OpenWISP Agent Yapılandırması (`/etc/config/openwisp`)

Agent'ın merkezi OpenWISP Controller sunucusuna bağlanabilmesi için `/etc/config/openwisp` dosyasını düzenleyin:

```uci
config controller 'http'
	option url 'https://api.openwisp.org'
	option uuid 'YOUR_DEVICE_UUID'
	option key 'YOUR_DEVICE_SECRET_KEY'
	option verify_ssl '0'
	option interval '120'
	option connect_timeout '15'
	option read_timeout '30'
```

Alternatif olarak UCI komut satırı ile yapılandırabilirsiniz:

```bash
uci set openwisp.http.url='https://api.openwisp.org'
uci set openwisp.http.uuid='<DEVICE_UUID>'
uci set openwisp.http.key='<DEVICE_KEY>'
uci set openwisp.http.verify_ssl='0' # Test ortamında Self-Signed SSL için 0
uci commit openwisp
```

---

## 3. Servisi Başlatma ve Otomatik Çalıştırma

```bash
/etc/init.d/openwisp_config enable
/etc/init.d/openwisp_config start
```

### Log Kontrolü:
Agent'ın sunucu ile iletişim kurduğunu doğrulamak için logları izleyin:

```bash
logread -e openwisp
```

Başarılı bağlantıda:
`INFO: Registered/Synchronized with OpenWISP Controller successfully.` mesajı görülmelidir.
