# Cisco Meraki MX64 OpenWrt Manuel Yapılandırma & Kullanım Kılavuzu

Tebrikler! Cihazınızın bootloader'ı (U-Boot) başarıyla güncellendi ve dahili hafızasına (NAND Flash) resmi OpenWrt işletim sistemi kuruldu.

Bu kılavuz, ev/ofis modeminiz ile MX64 arasındaki `192.168.1.1` IP çakışmasını **en temiz ve basit şekilde** manuel olarak nasıl çözeceğinizi ve arayüze nasıl gireceğinizi adım adım anlatır.

---

## Yöntem 1: En Temiz ve Kolay Yol (Doğrudan Kablolu Bağlantı)

İki cihazın (Modem ve MX64) aynı anda `192.168.1.1` olmasından kaynaklanan karışıklığı önlemenin en basit yolu 1 dakikalığına Wi-Fi'ı kapatıp IP'yi değiştirmektir:

### Adım 1: Wi-Fi'ı Geçici Olarak Kapatın
- Mac'inizin üst menüsünden Wi-Fi simgesine tıklayıp Wi-Fi'ı kapatın.

### Adım 2: Ethernet Portunu Yapılandırın
- Ethernet kablosunu MX64'ün **1. LAN Portuna (Port 1)** takın.
- Terminali açıp Mac'inize IP verin:
  ```bash
  sudo ifconfig en5 inet 192.168.1.2 netmask 255.255.255.0 up
  ```

### Adım 3: MX64'e SSH ile Bağlanın
- Terminalden doğrudan OpenWrt'ye bağlanın:
  ```bash
  ssh root@192.168.1.1
  ```
  *(İlk kurulumda parola yoktur, direkt Enter'a basın veya OpenWrt terminal ekranı gelir).*

### Adım 4: MX64 LAN IP Adresini `192.168.10.1` Olarak Değiştirin
- OpenWrt terminaline şu 3 satırı sırayla yazın / yapıştırın:
  ```sh
  uci set network.lan.ipaddr='192.168.10.1'
  uci commit network
  /etc/init.d/network restart
  ```
- Ardından bağlantıdan çıkın:
  ```sh
  exit
  ```

### Adım 5: Wi-Fi'ı Tekrar Açın ve Mac Ethernet'ini Güncelleyin
- Mac'inizin Wi-Fi'ını tekrar açın (İnternetiniz normale döner).
- Mac'in ethernet kartını MX64'ün yeni IP bloğuna geçirin:
  ```bash
  sudo ifconfig en5 inet 192.168.10.2 netmask 255.255.255.0 up
  ```

### Adım 6: Tamamlandı! Artık Her İkisi de Aynı Anda Çalışır
- **Modeminiz:** `192.168.1.1` (Wi-Fi üzerinden internete bağlı)
- **MX64 OpenWrt:** `192.168.10.1` (Ethernet üzerinden bağlı)
- Tarayıcınızdan doğrudan **`http://192.168.10.1`** adresini açabilirsiniz!

---

## Yöntem 2: MX64'ü Ev Modeminize WAN Olarak Bağlamak (Router Modu)

Eğer MX64'ü evinizde ana router olarak kullanmak veya ona internet vermek isterseniz:

1. Modemin bir LAN portundan çıkan Ethernet kablosunu MX64'ün **İnternet / WAN (En soldaki port)** portuna takın.
2. Bilgisayarınızı MX64'ün **1. LAN portuna** bağlayın.
3. MX64 otomatik olarak modeminizden WAN IP'si alacaktır.

---

## Web Arayüzü (LuCI) Yükleme (İhtiyaç Halinde)

OpenWrt Snapshot sürümlerinde web arayüzü varsayılan olarak yüklü gelmeyebilir. MX64'e internet bağladıktan sonra web arayüzünü (LuCI) açmak için:

1. MX64 terminaline girin (`ssh root@192.168.10.1`).
2. Şu komutları çalıştırın:
   ```sh
   opkg update
   opkg install luci
   /etc/init.d/uhttpd start
   /etc/init.d/uhttpd enable
   ```
3. Artık tarayıcınızdan `http://192.168.10.1` adresine girdiğinizde Türkçe/İngilizce modern LuCI kontrol paneli açılacaktır.

---

## Geri Dönüş ve Kurtarma Notları
- Cihazınızda herhangi bir sorun olursa daha önce aldığımız boot yedeği: `backups/orig_mtd0_boot_1786722972.bin`
- USB üzerinden kurtarma adımları için [RECOVERY_GUIDE.md](RECOVERY_GUIDE.md) dosyasını referans alabilirsiniz.
