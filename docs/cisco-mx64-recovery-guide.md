# Cisco Meraki MX64 Brick Durumları & Geri Dönüş (Recovery / Unbrick) Kılavuzu

Cisco Meraki MX64 üzerinde OpenWrt dönüşümü sırasında meydana gelebilecek bir "brick" (cihazın açılmaması) durumunda geri dönüş yöntemleri, arızanın **hangi seviyede** gerçekleştiğine bağlı olarak değişir.

---

## 1. Brick Seviyeleri ve Teşhis

| Seviye | Durum | Belirti | Kurtarma Yolu | Zorluk Derecesi |
|---|---|---|---|---|
| **Soft-Brick (Kernel/Sysupgrade Hatası)** | U-Boot çalışıyor, ancak OpenWrt kernel veya rootfs açılmıyor/panic veriyor. | Seri konsolda U-Boot logları akıyor, cihaz açılışta takılıyor veya döngüye giriyor. | **USB Initramfs ile Yeniden Başlatma** veya **TFTP/U-Boot Console** | 🟢 Kolay (Yazılımsal) |
| **Diag/Config Brick** | Stok Meraki ortamında config bozuldu, Telnet yanıt vermiyor. | Cihaz IP almıyor / 192.168.1.1 ping vermiyor. | **Reset Butonu ile Diag Mode'a tekrar alma** | 🟢 Kolay |
| **Hard-Brick (Bootloader / U-Boot Bozulması)** | Stok U-Boot silindi, yeni U-Boot yazılamadı veya hatalı yazıldı. | Cihazda hiçbir LED yanmıyor/sabit yanıyor, **seri konsoldan hiç çıktı gelmiyor (ölü cihaz)**. | **Harici SPI/NAND Flash Programlayıcı (CH341A / Klips)** veya **JTAG** | 🔴 İleri Düzey (Donanımsal Müdahale) |

---

## 2. Senaryo A: Soft-Brick Kurtarma (U-Boot Sağlam)

Eğer U-Boot sağlamsa (yeni `uboot_mx64` yazılmış olsa bile), cihazı kurtarmak son derece basittir:

### Yöntem 1: USB'den Acil Durum Initramfs Boot
1. FAT32 formatlı USB belleğinize çalışan bir initramfs imajını (`openwrt-...-initramfs-kernel.bin`) kopyalayın.
2. USB'yi MX64'e takın.
3. Reset butonuna basılı tutarak cihaza güç verin.
4. U-Boot doğrudan USB'deki sağlam kernel'i RAM'e yükleyerek cihazı açacaktır.
5. Açıldıktan sonra `192.168.1.1` üzerinden SSH ile bağlanıp bozuk olan NAND flash'a tekrar temiz bir `sysupgrade` yazabilirsiniz:
   ```bash
   sysupgrade -v -n /tmp/openwrt-24.10.0-sysupgrade.bin
   ```

### Yöntem 2: Seri Konsol (UART) ve U-Boot TFTP/USB Kurtarma
PCB üzerindeki J1 seri portuna (3.3V TTL) bağlandığınızda:
1. Cihaz açılırken klavyeden bir tuşa basarak U-Boot komut satırına (`MX64#`) düşün.
2. USB üzerinden manuel kernel yükleyin:
   ```text
   usb start
   fatload usb 0:1 0x61000000 openwrt-bcm5862x-generic-meraki_mx64-initramfs-kernel.bin
   bootm 0x61000000
   ```
3. Cihaz doğrudan bellekte açılır.

---

## 3. Senaryo B: Stok Meraki'ye Geri Dönüş (Rollback to Stock)

OpenWrt'den vazgeçip orijinal Meraki haline dönmek isterseniz:

1. Kurulumun başında `mx64-tool` tarafından **`backups/`** klasörüne alınan `orig_mtd0_boot.bin` ve `orig_mtd3_nvram.bin` yedekleri kullanılır.
2. OpenWrt çalışırken bu yedekler cihaza SCP ile aktarılır:
   ```bash
   scp backups/orig_mtd0_boot.bin root@192.168.1.1:/tmp/
   ```
3. OpenWrt içinden orijinal Meraki bootloader geri yazılır:
   ```bash
   mtd write /tmp/orig_mtd0_boot.bin "boot"
   # veya
   dd if=/tmp/orig_mtd0_boot.bin of=/dev/mtdblock0
   ```
4. Cihaz yeniden başlatıldığında tekrar orijinal Cisco Meraki haline döner.

---

## 4. Senaryo C: Hard-Brick Kurtarma (U-Boot Bozulursa / Donanımsal Kurtarma)

Eğer `/dev/mtd0` yazılırken elektrik kesilirse veya bozuk bir bootloader binary'si yazılırsa işlemci ilk boot kodunu çalıştıramaz. Bu durumda **ağ veya USB çalışmaz**.

Kurtarma adımları:

### 1. SPI/NAND Flash Programlayıcı (CH341A veya Benzeri)
- MX64 anakartı üzerinde boot kodunu barındıran SPI Flash çipi bulunur.
- Bir **SOIC-8/16 klips** veya **harici programlayıcı (CH341A / TL866)** ile anakarttaki flash çipine doğrudan bağlanılır.
- Bilgisayardan `flashrom` veya programlayıcı yazılımı ile kurulumun başında aldığımız `orig_mtd0_boot.bin` (veya `uboot_mx64.bin`) doğrudan çipin ilk sektörlerine geri yazılır:
  ```bash
  flashrom -p ch341a_spi -w backups/orig_mtd0_boot.bin
  ```
- Flash yazıldıktan sonra klips çıkarılır ve cihaz tekrar normal şekilde açılır.

### 2. JTAG Bağlantısı
- Broadcom BCM58625 üzerinde JTAG pinleri mevcuttur.
- OpenOCD ve bir FTDI JTAG adaptörü (FT232H / J-Link) ile işlemci durdurularak RAM'e doğrudan U-Boot yüklenip flash yeniden yazılabilir.

---

## 5. Brick Riskini Sıfıra Yaklaştıran Önlemlerimiz (`mx64-tool` İçinde)

1. **U-Boot Dosya Hash Doğrulaması:** Yazılacak `uboot_mx64` dosyasının boyutu ve SHA-256 hash'i cihaza aktarıldıktan sonra kontrol edilir; eksik/bozuk dosya yazımı engellenir.
2. **Güç Kesintisi Koruması:** Flash işlemi yalnızca 2-3 saniye sürer. Bu aşamada güç kesilmedikçe risk oluşmaz.
3. **Otomatik Yedekleme:** Cihaza dokunulmadan önce orijinal `mtd0` (boot) ve `mtd3` (nvram) bilgisayara çekilir.
