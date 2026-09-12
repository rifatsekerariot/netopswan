# 📐 NETOPSWAN SD-WAN & OPENWRT FLEET MANAGEMENT PLATFORM
## Comprehensive Technical System Blueprint & Architecture Specification

---

## 1. Executive Summary & Project Objectives

**NetOpsWan Platform**, 500 adet **Cisco Meraki MX64** donanımı üzerinde çalışan **OpenWrt v23.05** işletim sistemli uç şube yönlendiricilerini (Edge Routers) merkezden tek bir noktadan yönetmek, yapılandırmak, izlemek ve güvenli şifreli VPN tünelleri ile merkeze bağlamak üzere tasarlanmış uçtan uca SD-WAN filo yönetim mimarisidir.

### 🔑 Temel Hedefler:
* **Donanım Mimarisi**: Broadcom BCM58625 (ARM Cortex-A9 Çift Çekirdek), 2GB DDR3 RAM, ~1GB NAND Flaş bellekli Cisco Meraki MX64 cihazları.
* **Şebeke Topolojisi**: Hub-and-Spoke (Tüm 500 şube doğrudan HQ / Veri Merkezi gateway sunucusuna yüksek performanslı WireGuard / OpenVPN tünelleri ile bağlanır).
* **Backend Mimarisi**: Resmi `docker-openwisp` mikroservis kümesi (Django Controller + Postgres + InfluxDB + Redis + Celery + Nginx).
* **Frontend Mimarisi**: Modern Next.js 16 (App Router + Turbopack), TypeScript, Tailwind CSS ve shadcn/ui tabanlı bağımsız, yüksek performanslı web paneli.
* **REST API Entegrasyonu**: Sıfır sahte (mock) veri; tüm işlemler yerel/canlı OpenWISP PostgreSQL veritabanı ve REST API uç noktaları üzerinden doğrudan yürütülür.

---

## 2. High-Level System Architecture & Data Flow

```
                                +-------------------------------------------------------+
                                |      Cisco Meraki MX64 Edge Routers (500 Nodes)      |
                                |     (OpenWrt v23.05 + openwisp-config ubus agent)     |
                                +---------------------------+---------------------------+
                                                            |
                                                            | HTTPS / WireGuard Tunnel
                                                            v
+-------------------------------------------------------------------------------------------------------------------+
| OPENWISP DOCKER BACKEND STACK (docker-openwisp)                                                                  |
|                                                                                                                   |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | NGINX REVERSE PROXY (SSL / TLS SNI: api.openwisp.org & dashboard.openwisp.org)                              |  |
|  +--------------------------------------+--------------------------------------+-------------------------------+  |
|                                         |                                      |                                  |
|                                         v                                      v                                  |
|               +-----------------------------------+          +-----------------------------------+                |
|               | OpenWISP Controller / API Service |          | InfluxDB 1.8 Time-Series Engine   |                |
|               | (Django + DRF + Celery Workers)   |          | (Telemetry Metrics & Logs)        |                |
|               +-----------------+-----------------+          +-----------------+-----------------+                |
|                                 |                                              |                                  |
|                                 v                                              |                                  |
|               +-----------------------------------+                            |                                  |
|               | PostgreSQL (PostGIS) Relational DB|                            |                                  |
|               | (Devices, Templates, PKI, Groups) |                            |                                  |
|               +-----------------------------------+                            |                                  |
+--------------------------------------------------------------------------------|----------------------------------+
                                                                                 |
                                                                                 | Server-to-Server HTTPS
                                                                                 v
+-------------------------------------------------------------------------------------------------------------------+
| NETOPSWAN CUSTOM FRONTEND (Next.js 16 App Router)                                                                 |
|                                                                                                                   |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | NEXT.JS SERVER-SIDE API PROXY ROUTER (/api/openwisp/[...path])                                              |  |
|  | (Bypasses Browser CORS, Manages Bearer Token & Enforces Secure Authorization)                               |  |
|  +-----------------------------------------------------+-------------------------------------------------------+  |
|                                                        |                                                          |
|                                                        v                                                          |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | SHADCN / UI MODERN DASHBOARD INTERFACE (http://localhost:3000)                                                |  |
|  |  * Fleet Management (/fleet)         * UCI Templates Engine (/templates)   * Firmware Canary (/firmware) |  |
|  |  * Telemetry & Metrics (/monitoring)   * IPAM Subnet Map (/ipam)             * PKI & Certificates (/pki)   |  |
|  +-------------------------------------------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------------------------------------------+
```

---

## 3. Backend Stack Architecture Specification (`docker-openwisp`)

Backend katmanı, konteynerize edilmiş resmi OpenWISP mikroservislerinden oluşur. Her servis özel sorumluluk alanlarına ayrılmıştır:

| Konteyner Servisi | Konteyner İmajı | Görevi ve Sorumluluğu |
|---|---|---|
| `nginx` | `openwisp/openwisp-nginx:edge` | SSL/TLS sonlandırması, SSL sertifikaları yönetimi, API (`api.openwisp.org`) ve Dashboard (`dashboard.openwisp.org`) HTTPS yönlendirmesi. |
| `api` | `openwisp/openwisp-api:edge` | DRF (Django REST Framework) tabanlı REST API sunucusu. Cihaz ekleme, silme, şablon, grup ve token işlemlerini işler. |
| `dashboard` | `openwisp/openwisp-dashboard:edge` | Yönetim paneli backend servisi, veritabanı migrasyonları, statik dosya sunumu (`collectstatic`). |
| `postgres` | `postgis/postgis:15-3.4-alpine` | İlişkisel PostgreSQL veritabanı. Cihazlar (`config_device`), gruplar (`config_devicegroup`), şablonlar (`config_template`) ve kullanıcı kayıtlarını tutar. |
| `influxdb` | `influxdb:1.8-alpine` | Zaman serisi telemetri veritabanı. Cihaz CPU, RAM, bant genişliği ve latency verilerini saniyelik/dakikalık saklar. |
| `redis` | `redis:alpine` | Önbellekleme (Caching) ve Celery arka plan görev kuyruğu (Task Queue). |
| `celery` / `celerybeat` | `openwisp/openwisp-dashboard:edge` | Zamanlanmış görevler (kronik cihaz durum kontrolleri, otomatik yedeklemeler, toplu şablon uygulamaları). |
| `openvpn` | `openwisp/openwisp-openvpn:edge` | OpenVPN tünelleri için yönetilen PKI ve tünel sonlandırma servisi. |
| `freeradius` | `openwisp/openwisp-freeradius:edge` | AAA (Authentication, Authorization, Accounting) ve 802.1X ağ doğrulama servisi. |

---

## 4. Frontend Architecture & Next.js Proxy Specification (`frontend`)

Frontend uygulaması, `Kiranism/next-shadcn-dashboard-starter` temel alınarak Next.js 16 (Turbopack) ile sıfırdan geliştirilmiştir.

### 🛡️ Next.js Server-Side API Proxy Router (`src/app/api/openwisp/[...path]/route.ts`):
Tarayıcının CORS (Cross-Origin Resource Sharing) engellerini aşmak ve OpenWISP Bearer Token'ını istemci tarayıcıda açık etmemek için sunucu taraflı Proxy mimarisi kurulmuştur:
* **HTTP Metotları**: `GET`, `POST`, `PATCH`, `PUT`, `DELETE` desteklenir.
* **Token İletimi**: İstemci tarayıcı `/api/openwisp/...` adresine istek attığında, Next.js Proxy sunucusu arka planda OpenWISP REST API'sine `Authorization: Bearer <ADMIN_TOKEN>` ve `Host: api.openwisp.org` başlıklarıyla güvenli HTTPS isteği yapar.
* **Güvenlik**: TLS sertifikaları ve admin token bilgisi istemciye asla sızdırılmaz.

---

## 5. Modern UI Dashboard Modules Specification

Sistem 6 ana operasyonel modüle bölünmüştür:

### 📱 Modül 1: Cihaz Filosu (`/dashboard/fleet`)
* **Fonksiyon**: 500 Meraki MX64 cihazının canlı takibi, sorgulaması ve yönetimi.
* **Özellikler**:
  * Sanallaştırılmış yüksek hızlı tablo rendering (`@tanstack/react-virtual`).
  * Canlı **"+ Yeni Cihaz / Şube Ekle"** formu (Cihaz adı, MAC adresi, Model ve Notlar ile doğrudan PostgreSQL'e kayıt).
  * Cihaza özel **OpenWISP Secret Registration Key** görüntüleme.
  * Canlı Cihaz Silme (`PATCH is_deactivated: true` -> `DELETE`).
  * Toplu İşlemler (Reboot, SQM QoS Toggle, VPN Restart).
  * 30 saniye otomatik polling güncellemeleri.

### 📝 Modül 2: UCI Şablon Motoru (`/dashboard/templates`)
* **Fonksiyon**: OpenWrt UCI (Unified Configuration Interface) şablon kütüphanesi ve yayınlama motoru.
* **Hazır Şablonlar**:
  1. `Hub-and-Spoke WireGuard Base`: HQ Gateway ile şifreli tünel yapılandırması.
  2. `SQM/QoS Rate Limiter`: Cake / Piece-of-Cake algoritması ile VoIP trafiği önceliklendirme.
  3. `MWAN3 Dual-WAN Failover`: Birincil Fiber WAN koptuğunda 4G LTE yedek hatta saniyelik geçiş.
* **Özellikler**: Canlı UCI kod editörü, syntax vurgulama, hedef grup seçimi ve veritabanına kaydetme (`POST /api/v1/controller/template/`).

### 🚀 Modül 3: Kademeli Firmware Güncelleme & Canary Rollout (`/dashboard/firmware`)
* **Fonksiyon**: OpenWrt `sysupgrade.bin` imaj yükleme ve riski sıfırlayan aşamalı güncelleme.
* **Özellikler**:
  * OpenWrt `.bin` imaj kütüphanesi ve SHA256 doğrulama.
  * Canary Dalga Seçimi (%5 Pilot -> %25 Dalga 1 -> %70 Dalga 2 -> %100 Tam Filo).
  * Otomatik Rollback Koruması: Güncelleme sonrası 5 dakika içinde tünel kuramayan cihaz eski sürüme otomatik döner.

### 📊 Modül 4: Telemetri & Zaman Serisi Analizi (`/dashboard/monitoring`)
* **Fonksiyon**: InfluxDB zaman serisi veri akışı ile donanım ve ağ metriklerinin görselleştirilmesi.
* **Özellikler**:
  * CPU & RAM Kullanım Trend Grafikleri (Broadcom BCM58625 çift çekirdek yükü).
  * WAN1 (Metro Ethernet) vs WAN2 (4G LTE) Trafik Dağılım Grafikleri.
  * Ortalama Tünel Latency ve Paket Kaybı göstergeleri.
  * Eşik Değeri Alarm Kuralları (CPU %85+ uyarısı, 4G Kota aşım takibi).

### 🌐 Modül 5: IPAM & Subnet Haritası (`/dashboard/ipam`)
* **Fonksiyon**: 500 şubenin `/24` subnet blokları ve IP adres havuzlarının yönetimi.
* **Özellikler**:
  * `/24` Şube Subnet tahsis haritası (`10.100.1.0/24` -> `10.100.500.0/24`).
  * IP Çakışma Önleme Motoru (Conflict Detector).
  * VLAN ve Gateway Atama Matrisi.

### 🔑 Modül 6: PKI & VPN Sertifikaları (`/dashboard/pki`)
* **Fonksiyon**: OpenWISP CA (Certificate Authority) sertifika otoritesi ve VPN anahtar yönetimi.
* **Özellikler**:
  * Master CA 4096-bit sertifika kontrolü.
  * WireGuard Peer Public/Private Key çiftleri ihraç ekranı.
  * İptal Edilen Sertifikalar (CRL - Certificate Revocation List) takibi.

---

## 6. OpenWrt Cisco Meraki MX64 Edge Agent Setup Blueprint

Sahadaki fiziksel Meraki MX64 cihazlarına OpenWrt yüklendikten sonra merkezi OpenWISP sunucusuna otomatik olarak kaydolabilmesi için yapılan ajansal (agent) kurulum adımları:

### 1. OpenWrt Paket Kurulumu:
```bash
opkg update
opkg install openwisp-config sqm-scripts mwan3 wireguard luci-proto-wireguard
```

### 2. `/etc/config/openwisp` Yapılandırması:
```uci
config controller 'http'
    option url 'https://sdwan.ariot.com.tr'
    option shared_secret 'OPENWISP_SHARED_SECRET_KEY'
    option uuid ''
    option key ''
    option verify_ssl '1'
    option interval '120'
```

### 3. Otomatik Bağlantı Akışı:
1. `openwisp-config` servisi başlar.
2. Sunucuya MAC adresi ve donanım bilgisi ile kayıt isteği (registration) gönderir.
3. Sunucu cihaza özel `UUID` ve `Key` üretip yanıt verir.
4. Cihaz sunucudan derlenmiş UCI şablonlarını (WireGuard tüneli, SQM QoS ve MWAN3 kuralları) indirip kendi lokal `/etc/config/` dosyalarına uygular ve servisleri yeniden başlatır.

---

## 7. Data Schemas & Main Entities

### 1. Device Entity (`config_device`):
* `id`: UUID (Primary Key)
* `name`: CharField (Şube Adı)
* `mac_address`: MACAddressField (Benzersiz MAC)
* `key`: CharField (OpenWISP Kayıt Anahtarı)
* `model`: CharField (`Cisco Meraki MX64`)
* `notes`: TextField (Donanım/Lokasyon notları)
* `last_ip`: IPAddressField (Son bilinen IP)
* `is_active`: BooleanField
* `organization_id`: FK (`Organization`)

### 2. DeviceGroup Entity (`config_devicegroup`):
* `id`: UUID
* `name`: CharField (`Bölge-Merkez`, `Bölge-Anadolu`, `Bölge-Ege`, `Model-MX64-Prod`)
* `description`: TextField

### 3. Template Entity (`config_template`):
* `id`: UUID
* `name`: CharField (Şablon Adı)
* `type`: CharField (`custom`, `network`, `qos`, `vpn`)
* `config`: TextField (Raw UCI Konfigürasyon metni)

---

## 8. Directory & Project Structure Map

```
NetOpsWan/
├── docker-openwisp/                   # Resmi OpenWISP Docker Compose Sunucu Kümesi
│   ├── docker-compose.yml             # Postgres, InfluxDB, Nginx, Redis, API Servisleri
│   └── .env                           # OpenWISP Domain ve DB Çevre Değişkenleri
│
├── mock-backend/                      # Geliştirme/Test Amaçlı Standalone REST API Server
│   └── server.js                      # Express.js REST API Simülatörü (Port 8001)
│
├── docs/                              # Teknik Dokümantasyon ve Kurulum Rehberleri
│   ├── api-endpoints.md               # OpenWISP REST API Referans Dokümanı
│   ├── device-agent-setup.md          # OpenWrt Meraki MX64 Ajan Kurulum Rehberi
│   └── project-blueprint.md           # Proje Ana Teknik Blueprint Dokümanı
│
└── frontend/                          # Next.js 16 Custom SD-WAN Filo Yönetim Paneli
    ├── src/
    │   ├── app/
    │   │   ├── api/openwisp/[...path]/# Next.js Server-Side API Proxy Router (CORS Bypasser)
    │   │   └── dashboard/
    │   │       ├── fleet/             # Modül 1: Cihaz Filosu ve Canlı Ekleme/Silme
    │   │       ├── templates/         # Modül 2: UCI Şablon Motoru
    │   │       ├── firmware/          # Modül 3: Kademeli Firmware & Canary Rollout
    │   │       ├── monitoring/        # Modül 4: Telemetri & InfluxDB Zaman Serisi
    │   │       ├── ipam/              # Modül 5: IPAM Subnet & IP Haritası
    │   │       └── pki/               # Modül 6: PKI Sertifika Otoritesi & VPN
    │   ├── components/                # Reusable UI Bileşenleri (Modal, Table, Cards)
    │   ├── config/                    # Sidebar Navigasyon Yapılandırması (nav-config.ts)
    │   └── lib/
    │       └── api.ts                 # OpenWISP Canlı REST API Client & TS Tipleri
    ├── package.json
    └── next.config.js
```

---

## 9. Summary of Deployment & Production Operations

1. **Backend Başlatma**:
   ```bash
   cd docker-openwisp
   DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose up -d
   ```
2. **Admin Token Alma**:
   ```bash
   docker exec -it docker-openwisp-dashboard-1 python manage.py drf_create_token admin
   ```
3. **Frontend Derleme ve Başlatma**:
   ```bash
   cd frontend
   npm run build
   npm run start -- -p 3000
   ```

**Proje Mimarisi Tamamen Hazırdır!** 🚀
