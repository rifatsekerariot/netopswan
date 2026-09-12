<div align="center">

<img src="logo.jpeg" alt="NetOpsWan" width="120" />

# NetOpsWan

**Kendi sunucunuzda barındırdığınız, satıcı kilidi olmayan Hub-and-Spoke SD-WAN platformu**

Mevcut Cisco Meraki MX64 donanımınızı Meraki'nin bulut lisansından kurtarıp
kendi Rust yazılımınızla çalıştırın — merkezi bir gösterge panelinden tüm
şubelerinizi, güvenlik duvarlarını, DHCP/DNS'i ve OTA güncellemelerini yönetin.

[![Rust](https://img.shields.io/badge/Rust-000000?style=flat&logo=rust&logoColor=white)](packages/rust-sdwan)
[![Next.js](https://img.shields.io/badge/Next.js%2016-000000?style=flat&logo=nextdotjs&logoColor=white)](frontend)
[![WireGuard](https://img.shields.io/badge/WireGuard-88171A?style=flat&logo=wireguard&logoColor=white)](#mimari)
[![OpenWrt](https://img.shields.io/badge/OpenWrt-00B5E2?style=flat&logo=openwrt&logoColor=white)](#şube-donanımı)
[![License](https://img.shields.io/badge/License-belirtilmedi-lightgrey)](#lisans)

<img src="docs/assets/linkedin-cover-bolum3.png" alt="Yapay Zeka Çıktı, Mertlik Bozuldu 3 — NetOpsWan" width="100%" />

</div>

---

## İçindekiler

- [English summary](#english-summary)
- [Bu proje ne, neden var?](#bu-proje-ne-neden-var)
- [Mimari: nasıl çalışıyor?](#mimari-nasıl-çalışıyor)
- [Öne çıkan özellikler](#öne-çıkan-özellikler)
- [Teknoloji yığını](#teknoloji-yığını)
- [Repo yapısı](#repo-yapısı)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Ortam değişkenleri — hangi şifre nereye yazılır?](#ortam-değişkenleri--hangi-şifre-nereye-yazılır)
- [Şube donanımı: Cisco Meraki MX64 dönüşümü](#şube-donanımı-cisco-meraki-mx64-dönüşümü)
- [Güvenlik modeli ve üretime almadan önce](#güvenlik-modeli-ve-üretime-almadan-önce)
- [Geliştirme ve test](#geliştirme-ve-test)
- [Yol haritası](#yol-haritası)
- [Katkıda bulunma](#katkıda-bulunma)
- [Lisans](#lisans)

---

## English summary

NetOpsWan is a self-hosted, hub-and-spoke SD-WAN platform. A central Rust
service (`netops-hub`) coordinates WireGuard tunnels to lightweight Rust
agents (`netops-agent`) running on branch routers — including repurposed
Cisco Meraki MX64 hardware reflashed to OpenWrt, freed from Meraki's
cloud-licensed firmware. A Next.js dashboard gives network operators one
place to see branch health, manage DHCP/DNS and firewall/NAC rules, roll
out Ed25519-signed OTA firmware updates, and diagnose problems on remote
hardware — without SSHing into every device by hand. See the sections
below (in Turkish, the team's working language) for architecture, setup,
and security notes; the code comments are also in Turkish.

---

## Bu proje ne, neden var?

Perakende/kurumsal şube ağı olan bir işletmenin, onlarca-yüzlerce şubesindeki
ağ cihazlarını (router, güvenlik duvarı, DHCP/DNS, VPN tüneli) **tek bir
merkezi panelden** yönetebilmesi için yazıldı.

Ticari SD-WAN çözümleri (Cisco Meraki, Cato, vb.) bunu çok iyi yapar — ama
donanımı bulut lisansına kilitler: aboneliğiniz bitince cihazlar işe
yaramaz hale gelir, ve trafiğiniz/telemetriniz üçüncü bir bulut kontrol
düzlemi üzerinden geçer.

**NetOpsWan'ın önerdiği yol:** Elinizde zaten duran Cisco Meraki MX64
donanımını (Broadcom BCM58625, ARMv7) Meraki'nin bulut yazılımından
kurtarıp OpenWrt ile yeniden flaşlayın, üzerine bu projenin kendi hafif
Rust ajanını (`netops-agent`) kurun. Artık o cihaz, sizin kendi
sunucunuzdaki `netops-hub`'a WireGuard üzerinden bağlanan, tamamen sizin
kontrolünüzdeki bir SD-WAN uç noktası. Ne aylık lisans, ne üçüncü taraf
bulut bağımlılığı, ne de "satıcı yarın bu özelliği kaldırırsa ne olur"
kaygısı.

Bu depo, bu fikrin gerçek bir işletmede (ARIOT) üretimde çalışan tam
uygulamasıdır: merkez sunucu, saha ajanı, ve ikisini yöneten bir web
panosu.

## Mimari: nasıl çalışıyor?

```mermaid
flowchart LR
    subgraph Merkez["Merkez Sunucu (sizin altyapınız)"]
        HUB["netops-hub (Rust / Axum)\nWireGuard koordinasyonu\nTelemetri • OTA • Komut kanalı"]
        DB[(PostgreSQL)]
        WEB["Next.js Dashboard\n(operatör arayüzü)"]
        WEB <--> DB
        WEB <-->|"/api/v1/sdwan/*\n(127.0.0.1, loopback-only)"| HUB
    end

    subgraph SubeA["Şube A — Cisco Meraki MX64 (OpenWrt)"]
        AGENTA["netops-agent (Rust)"]
        LANA["LAN: POS, kamera/NVR,\nVoIP, yazıcı..."]
        AGENTA --- LANA
    end

    subgraph SubeB["Şube B — Cisco Meraki MX64 (OpenWrt)"]
        AGENTB["netops-agent (Rust)"]
        LANB["LAN cihazları"]
        AGENTB --- LANB
    end

    HUB <-->|"WireGuard tüneli\n(şifreli overlay)"| AGENTA
    HUB <-->|"WireGuard tüneli\n(şifreli overlay)"| AGENTB

    OP["Ağ Operatörü\n(tarayıcı)"] -->|"HTTPS"| WEB
```

Üç ana bileşen:

1. **`netops-hub`** (`packages/rust-sdwan/crates/netops-hub`) — merkez
   sunucuda çalışan Rust/Axum servisi. Her şube ajanının WireGuard
   kayıt/telemetri isteklerini karşılar, tünel havuzunu (IPAM) yönetir,
   cihaz durumunu (ACTIVE/DEGRADED/OFFLINE) canlı tutar, imzalı OTA
   güncellemelerini sunar ve şubeye uzaktan komut (tanı, NAC engelle/aç,
   yapılandırma) gönderme kanalını işletir.
2. **`netops-agent`** (`packages/rust-sdwan/crates/netops-agent`) — şube
   donanımında (OpenWrt) çalışan hafif Rust ajanı. Kendi MAC/donanım
   kimliğini otomatik keşfeder, hub'a kayıt olur, WireGuard tünelini
   kurar, periyodik telemetri gönderir, hub'dan gelen komutları yürütür,
   ve Ed25519 imzalı OTA güncellemelerini güvenli şekilde uygular.
3. **`frontend`** — operatörlerin kullandığı Next.js 16 / shadcn tabanlı
   Türkçe gösterge paneli: filo görünümü, topoloji haritası, DHCP/DNS,
   güvenlik duvarı/NAC, PKI sertifikaları, tehdit logları, OTA dağıtımı.

Hub ile agent arasındaki her kanal (kayıt, telemetri, komut) bir
paylaşılan-sır tabanlı cihaz jetonu (`X-Device-Token`) ile doğrulanır;
OTA güncellemeleri SHA-256 bütünlük + Ed25519 imza ile korunur (bkz.
[Güvenlik modeli](#güvenlik-modeli-ve-üretime-almadan-önce)).

## Öne çıkan özellikler

- **Sıfır-dokunuşla şube kaydı** — MAC, WAN arayüzü, LAN alt ağı elle
  girilmez; ajan donanımı kendisi keşfeder ve hub'a kaydolur.
- **Kendi kendini onaran WireGuard mesh'i** — tünel koptuğunda otomatik
  yeniden kayıt/yeniden kurulum; hub tarafında peer canlılığını hem HTTP
  telemetri hem çekirdek WireGuard handshake'i ile çift kanaldan izleyen
  bir "reaper" görevi.
- **Görev-seviyesi dayanıklılık** — hem hub hem agent'taki her uzun-ömürlü
  arka plan görevi (tünel bekçisi, telemetri döngüsü, güvenlik olay
  kaydı, anomali motoru...) bir "nabız + bekçi köpeği" mekanizmasıyla
  izlenir: bir görev sessizce çöker ya da askıda kalırsa süreç kendini
  temiz bir durumdan yeniden başlatır.
- **Merkezi DHCP/DNS** — sabit IP atamaları, POS/kamera/VoIP/yazıcı için
  hazır hızlı-atama şablonları, şube veya grup bazlı toplu dağıtım.
- **Zero-Trust NAC** — herhangi bir istemci cihazı MAC adresinden şube
  güvenlik duvarında anında engelle/aç.
- **Ed25519 imzalı, sandbox'lı OTA** — imzasız/bozuk bir firmware asla
  kabul edilmez; yeni sürüm önce cihazda bir sandbox testinden geçirilir,
  başarısız olursa eski çalışan sürüm korunur (atomik, geri alınabilir
  güncelleme).
- **Sıfır-yapılandırma kamera/NVR trafik yönetimi** — RTSP port imzasına
  bakarak otomatik bant genişliği sınırlama, elle IP/kamera tanımlamaya
  gerek yok.
- **Şubeler-arası köprüleme** — bir şubenin LAN alt ağını hub üzerinden
  başka bir şubeye yönlendirme.
- **PKI sertifika takibi**, canlı tehdit/güvenlik olay logları (DuckDB
  benzeri hafif bir "Smart Log Engine" ile), gerçek zamanlı SSE akışları.

## Teknoloji yığını

| Katman | Teknoloji |
|---|---|
| Merkez Hub | Rust, [Axum](https://github.com/tokio-rs/axum), Tokio async runtime |
| Şube Ajanı | Rust (ARMv7 / soft-float, OpenWrt hedefli statik binary) |
| Tünel | [WireGuard](https://www.wireguard.com/) |
| Dashboard | Next.js 16, React, TypeScript, shadcn/ui, TanStack Query/Form |
| Veritabanı | PostgreSQL (dashboard verisi), hub'ın kendi hafif log motoru |
| Kimlik doğrulama (dashboard) | Clerk (opsiyonel — keyless modda da çalışır) |
| OTA güvenliği | SHA-256 bütünlük + Ed25519 imza |
| Parola hashleme | Argon2id |
| Şube donanımı | Cisco Meraki MX64 → OpenWrt (yeniden flaşlanmış) |
| Konteynerleştirme | Docker Compose (OpenWISP/PostgreSQL/Redis/InfluxDB altyapısı için) |

## Repo yapısı

```
NetOpsWan/
├── packages/rust-sdwan/          # Rust workspace
│   └── crates/
│       ├── netops-hub/           # Merkez sunucu servisi
│       ├── netops-agent/         # Şube (OpenWrt) ajanı
│       ├── netops-proto/         # Hub↔Agent ortak protokol tipleri
│       ├── netops-auth/          # Zero-Trust cihaz jetonu, JWT, Argon2id
│       ├── netops-ota/           # Ed25519/SHA-256 OTA imzalama + doğrulama
│       ├── netops-ipam/          # Tünel IP havuzu yönetimi
│       └── netops-command/       # Uzaktan komut/tanı protokolü
├── frontend/                     # Next.js 16 operatör gösterge paneli
├── firmware_builder/             # Meraki MX64 → OpenWrt firmware üretim script'leri
├── scripts/                      # Provisioning, e2e test, göç araçları
├── docker-compose.yml            # OpenWISP + PostgreSQL/Redis/InfluxDB altyapısı
├── install.sh                    # Tek komutla sunucu kurulum sihirbazı
└── docs/                         # Ek dokümantasyon ve görseller
```

## Hızlı başlangıç

### Gereksinimler

- Rust 1.90+ (`rustup`)
- Node.js 20+ ve `npm`/`bun`
- PostgreSQL 14+
- Docker + Docker Compose (OpenWISP altyapısı için, opsiyonel)
- Bir Linux sunucu (merkez Hub için) ve/veya test için yerel makineniz
- Şube donanımı olarak denemek isterseniz: bir Cisco Meraki MX64 (bkz.
  [Şube donanımı](#şube-donanımı-cisco-meraki-mx64-dönüşümü))

### 1. Depoyu klonlayın ve ortam dosyalarını hazırlayın

```bash
git clone https://github.com/<kullanici-adiniz>/netopswan.git
cd netopswan
cp .env.example .env
cp frontend/env.example.txt frontend/.env.local
```

Şimdi [Ortam değişkenleri](#ortam-değişkenleri--hangi-şifre-nereye-yazılır)
bölümüne geçip `.env` ve `frontend/.env.local` içindeki tüm
`CHANGE_ME_...` değerlerini kendi şifrelerinizle doldurun.

### 2. Rust Hub'ı derleyin ve çalıştırın

```bash
cd packages/rust-sdwan
cargo build --release -p netops-hub
./target/release/netops-hub \
  --shared-secret "$(openssl rand -hex 32)" \
  --agent-version 0.4.14
```

> `--agent-version` argümanını **her zaman açıkça** verin ve şube
> ajanlarınızın gerçek sürümüyle eşleştirin — boş bırakırsanız hub kendi
> paket sürümünü "ajan hedef sürümü" sanar, bu da OTA'nın yanlışlıkla
> eski bir binary'ye "düşürme" (downgrade) yapmasına yol açabilir.

### 3. Dashboard'u çalıştırın

```bash
cd frontend
npm install
npm run dev
```

Panel `http://localhost:3000` adresinde açılır.

### 4. (Opsiyonel) OpenWISP altyapısını Docker ile ayağa kaldırın

```bash
docker compose up -d
```

veya prod bir sunucuda tek komutla:

```bash
sudo ./install.sh
```

### 5. Şube ajanını derleyin (çapraz derleme)

```bash
cd packages/rust-sdwan
cross build --release --target armv7-unknown-linux-musleabi -p netops-agent
```

Üretilen binary'yi cihaza kopyalayıp çalıştırmak için
[Şube donanımı](#şube-donanımı-cisco-meraki-mx64-dönüşümü) bölümüne
bakın.

## Ortam değişkenleri — hangi şifre nereye yazılır?

Bu proje **iki ayrı** ortam dosyası kullanır. İkisini de `CHANGE_ME_...`
ile başlayan her değeri **kendi** güçlü/rastgele değerlerinizle
doldurarak hazırlayın — hiçbirini örnekteki gibi bırakmayın.

### A) Kök dizin — `.env` (OpenWISP / Docker Compose altyapısı için)

Örnek dosya: [`.env.example`](.env.example) → kopyalayıp `.env` yapın.

| Değişken | Ne işe yarar | Nereden alınır / nasıl üretilir |
|---|---|---|
| `SERVER_DOMAIN`, `SERVER_IP` | Sunucunuzun dışa açık domaini/IP'si | Kendi domaininiz/IP'niz |
| `PANEL_PORT` | Next.js panelinin dinleyeceği port | Genelde `3000` |
| `OPENWISP_API_TOKEN` | OpenWISP API'sine dahili erişim jetonu | `openssl rand -hex 20` ile üretin |
| `DB_USER`, `DB_PASS` | OpenWISP PostgreSQL kullanıcı/şifresi | `DB_PASS` için `openssl rand -base64 24` |
| `DJANGO_SECRET_KEY` | Django'nun oturum/CSRF imzalama anahtarı | `python3 -c "import secrets; print(secrets.token_urlsafe(50))"` |

### B) `frontend/.env.local` (Next.js dashboard için)

Örnek dosya: [`frontend/env.example.txt`](frontend/env.example.txt).

| Değişken | Ne işe yarar | Nereden alınır |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Dashboard'un kendi PostgreSQL bağlantısı | Kendi Postgres sunucunuz |
| `SDWAN_HUB_URL` | `netops-hub`'ın dahili adresi (varsayılan `http://127.0.0.1:8088`) | Hub'ı aynı sunucuda çalıştırıyorsanız değiştirmenize gerek yok |
| `INTERNAL_SYNC_SECRET` | Dashboard'un kendi kendine (arka plan senkron görevi) çağırdığı iç API'yi korur | `openssl rand -hex 32` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Kullanıcı girişi (Clerk) — **boş bırakılabilir**, "keyless mode" ile panel yine çalışır | [clerk.com](https://clerk.com) → kendi projeniz |
| `WEBHOOK_SECRET` | Clerk webhook doğrulaması (opsiyonel) | Clerk Dashboard → Webhooks |
| `NEXT_PUBLIC_SENTRY_DSN` ve diğer Sentry değişkenleri | Hata izleme (opsiyonel) | [sentry.io](https://sentry.io) → kendi projeniz |

### C) Hub'ın kendi çalışma-zamanı sırları (CLI argümanı / kalıcı süreç yöneticisi)

`.env` dosyasında değil, `netops-hub`'ı başlatırken CLI argümanı olarak
verilir (örn. `pm2`/`systemd` servis tanımınıza yazın):

| Argüman | Ne işe yarar |
|---|---|
| `--shared-secret` | Tüm şube ajanlarıyla paylaşılan kök Zero-Trust sırrı. `openssl rand -hex 32` ile üretin, **asla** kod/repo içine yazmayın. |
| `--agent-version` | Filodaki ajanların GERÇEK sürümü (yukarıdaki uyarıya bakın). |
| `--tunnel-subnet` | WireGuard tünel havuzu (varsayılan `10.8.0.0/16`). |

### D) Şube cihazı sırları

Her şube cihazının kendi `/etc/netops/shared_secret` dosyası, hub'ın
`--shared-secret` değeriyle **aynı olmalıdır** (ya da provisioning
sırasında üretilen cihaza-özel bir jeton — bkz. `netops_provisioner.sh
--device-key`). Şubenin **yerel LAN kurtarma SSH şifresi** ise
`firmware_builder/build-firmware.sh` çalıştırılırken `SSH_PASSWORD`
ortam değişkeni ile verilir — depoda hiçbir varsayılan/gerçek şifre
**bırakılmamıştır**, script bu değer verilmeden çalışmayı reddeder.

> ⚠️ **Önemli:** Bu depo daha önce özel/kapalı bir ortamda geliştirildi
> ve bir noktada gerçek bir üretim şifresi kod içinde yer almıştı. Bu
> depo public'e alınmadan önce o değer temizlendi — ama **eğer bu kodu
> zaten üretimde çalıştırıyorsanız, ilgili cihazlardaki ve
> hesaplardaki tüm şifreleri/sırları hemen rotasyona sokun** (LAN
> kurtarma şifresi, `shared_secret`, veritabanı şifreleri, `.env`
> içindeki tüm değerler). Bir deponun geçmişte özel olması, geçmiş
> commit'lerin hiçbir zaman görülmeyeceği anlamına gelmez.

## Şube donanımı: Cisco Meraki MX64 dönüşümü

1. `firmware_builder/build-firmware.sh` ile Meraki MX64 için özel bir
   OpenWrt + `netops-agent` firmware imajı üretin (yerel LAN kurtarma
   şifrenizi `SSH_PASSWORD` ortam değişkeni ile verin).
2. `scripts/meraki_provisioner.sh --server <hub-url> --device-key
   <paylaşılan-sır> --device-name <şube-adı>` ile cihazı uçtan uca
   flaşlayıp ilk kaydını yaptırın.
3. Cihaz ilk açılışta otomatik olarak hub'a kaydolur, bir WireGuard
   tüneli kurar ve telemetri göndermeye başlar — dashboard'un **Filo**
   sayfasında birkaç saniye içinde görünür.

Donanım/güvenlik detayları için [`BLUEPRINT.md`](BLUEPRINT.md) dosyasına
bakın.

## Güvenlik modeli ve üretime almadan önce

- **Zero-Trust cihaz jetonu** — her ajan, kendi MAC adresi + cihaz ID'si
  + paylaşılan sır ile HMAC-SHA256 türetilmiş benzersiz bir jetonla
  kimlik kanıtlar; bir cihazın jetonu ele geçirilse bile diğer
  cihazları taklit edemez.
- **Argon2id** ile parola hashleme (kullanıcı hesapları).
- **Ed25519 imza + SHA-256 bütünlük** ile korunan OTA — imzasız/bozuk
  firmware fail-closed olarak reddedilir; yeni sürüm sandbox'ta test
  edilmeden kalıcı hale gelmez.
- **WAN üzerinden SSH tamamen kapalı** — şube cihazlarına sadece yerel
  LAN üzerinden fiziksel erişimle SSH yapılabilir.
- **Yönetimsel API'ler loopback-only** — `commands/exec`, `peers` gibi
  hassas uç noktalar sadece `127.0.0.1` üzerinden (dashboard'un kendi
  sunucu tarafı) erişilebilir, WAN'dan asla.
- Bu depoyu **kendi altyapınızda** çalıştırmadan önce mutlaka:
  1. `.env` ve `frontend/.env.local` içindeki **her** `CHANGE_ME_...`
     değerini kendi rastgele üretilmiş sırlarınızla değiştirin.
  2. `--shared-secret` ve her şube cihazının LAN kurtarma şifresini
     kendiniz üretin — depoda hiçbir varsayılan şifre yoktur.
  3. Hub'ınızı bir ters proxy (nginx/Caddy) arkasında, geçerli bir TLS
     sertifikasıyla (Let's Encrypt) yayınlayın; `nginx/` klasöründeki
     örnek yapılandırmayı kendi domaininize göre uyarlayın.

## Geliştirme ve test

```bash
# Rust: tüm testleri çalıştır
cd packages/rust-sdwan
cargo test --workspace

# Rust: linting
cargo clippy --workspace

# Frontend: tip kontrolü
cd frontend
npm run typecheck

# Frontend: linting
npm run lint

# Şube ajanını çapraz derle (ARMv7 / OpenWrt)
cd packages/rust-sdwan
cross build --release --target armv7-unknown-linux-musleabi -p netops-agent
```

## Yol haritası

Bkz. [`BLUEPRINT.md`](BLUEPRINT.md) § 7 — bilinen mimari boşluklar ve
planlanan geliştirmeler (ör. OTA'nın indirilen dosyanın beyan edilen
sürümünü de doğrulaması, HA hub failover'ın daha geniş test kapsamı).

## Katkıda bulunma

Sorun bildirimleri ve pull request'ler memnuniyetle karşılanır. Büyük bir
değişiklik göndermeden önce lütfen bir issue açıp yaklaşımınızı
tartışalım — özellikle güvenlik-kritik alanlarda (OTA doğrulama, cihaz
kimlik doğrulama) değişiklik öneriyorsanız.

## Lisans

*(Bu depo için henüz bir lisans dosyası eklenmedi. Bir açık kaynak
lisansı seçip kök dizine bir `LICENSE` dosyası eklemeniz, deponun ne
şekilde kullanılıp dağıtılabileceğini netleştirir.)*

---

<div align="center">

Rifat Şeker tarafından geliştirilmektedir · ARIOT

</div>
