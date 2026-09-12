# Cisco Meraki MX64 OpenWrt Otomasyon Aracı (`mx64-tool`)

Bu yazılım, Cisco Meraki MX64 kurumsal güvenlik cihazını güvenli ve tek komutla resmi OpenWrt tabanlı bir yönlendiriciye dönüştürmek için geliştirilmiş açık kaynaklı bir CLI aracıdır.

---

## Tek Komutla Uçtan Uca Kurulum

Tüm süreci (Diag tespiti, MTD0 yedeği, U-Boot flashlama, USB hazırlama, Sysupgrade ve IP/Netmask yapılandırması) tek bir akışta yürütmek için:

```bash
sudo ./mx64-tool run
```

### Sihirbazın Yürüttüğü Adımlar:
1. **Faz 1 (Diag Modu):** Cihazın donanımını/SoC revizyonunu tespit eder, orijinal `mtd0` boot yedeğini bilgisayara indirir, MTD kilidini açar ve yeni `uboot_mx64`'ü flashlar.
2. **Faz 2 (USB Hazırlama):** Bilgisayara takılan FAT32 MBR USB diske Clayface kararlı initramfs kernel'ını yazar ve USB boot yönlendirmesini yapar.
3. **Faz 3 (Kalıcı Sysupgrade):** SFTP hatası olmadan SSH Pipe üzerinden NAND Flash'a kalıcı OpenWrt yazar, IP'yi `192.168.10.1/24` olarak sabitler ve cihazı hazır hale getirir.

---

## Hızlı Komutlar

| Komut | Açıklama |
|---|---|
| `sudo ./mx64-tool run` | Baştan sona tek komutla tam otomatik kurulum sihirbazı. |
| `./mx64-tool check` | 192.168.10.1, 192.168.1.1 (SSH/Telnet) durumunu test eder. |
| `./mx64-tool prep-usb -u /Volumes/OPENWRT` | USB diski test edilmiş kararlı dosyalarla hazırlar. |
| `./scripts/reset_mac_network.sh` | Mac ağ ve rota ayarlarını anında sıfırlar. |

---

## Cihaz Erişim Bilgileri
- **IP Adresi:** `192.168.10.1` (Netmask: `255.255.255.0`)
- **Kullanıcı Adı:** `root`
- **Şifre:** Yok (Boş)
- **SSH Bağlantısı:** `ssh root@192.168.10.1`
