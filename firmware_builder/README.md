# NetOpsWan Universal Appliance Firmware Builder (ImageBuilder Engine)

Evrensel SD-WAN Cihazları (**Cisco Meraki MX64/65/Z3**, **Raspberry Pi 4/5**, **x86_64 Mini PC**, **Endüstriyel Ağ Geçitleri**) için her donanımın kendi **resmi Linux Çekirdeği, DTB (Device Tree) ve Switch sürücülerini** kullanarak doğrudan cihaza yazılabilir gerçek **`.bin` / `.img` / `.img.gz`** imajları üreten otomasyon motoru.

---

## 🎯 Donanım & DTB Haritası

| Donanım Profili | İşlemci Mimarisi (SoC) | Hedef DTB (Device Tree) | Switch / Ağ Sürücüsü | Üretilen İmaj Tipi |
| :--- | :--- | :--- | :--- | :--- |
| `meraki-mx64` | Broadcom BCM58625 (ARMv7) | `bcm5301x-meraki-mx64.dtb` | BCM53125 Gigabit Switch | `sysupgrade.bin` |
| `meraki-mx65` | Broadcom BCM58625 (ARMv7) | `bcm5301x-meraki-mx65.dtb` | BCM53125 Switch + PoE | `sysupgrade.bin` |
| `meraki-z3` | MediaTek MT7621AT (MIPS) | `mt7621-meraki-z3.dtb` | MT7621 Switch + LTE | `sysupgrade.bin` |
| `rpi-4` | Broadcom BCM2711 (ARM64) | `bcm2711-rpi-4-b.dtb` | Gigabit Native + USB3 | `factory.img.gz` |
| `x86-64` | Intel / AMD x86_64 | ACPI / UEFI GRUB2 | Intel e1000e, igb, Realtek | `combined-efi.img.gz` |

---

## 🚀 Kullanım

### 1. Tek Komutla Donanıma Özel Gerçek Firmware Üretme:

```bash
./build-firmware.sh \
  --profile meraki-mx64 \
  --server https://sdwan.musteri.com \
  --device-name "Kadikoy-Sube" \
  --device-key "3524d06794c7b25f20da8ea3183a3b6edde79b7f" \
  --ca-cert ./ca.crt \
  --outdir ./outputs
```

### 2. Toplu Şube Üretimi (Batch CSV):
```bash
python3 batch_generator.py \
  --csv branches_example.csv \
  --server https://sdwan.musteri.com \
  --profile meraki-mx64
```

---

## 🔒 Otomatik Enjekte Edilen Bileşenler:
* **`/etc/sdwan/sdwan.conf`**: Merkezin domain adresi, şube adı ve gizli tünel anahtarı.
* **`/etc/sdwan/ca.crt`**: Merkezin Kök CA sertifikası.
* **`/etc/init.d/sdwan-agent`**: Cihaz fişe takıldığı anda arka planda otomatik olarak tüneli açan `S99sdwan-agent` boot servisi.
* **Sadeleştirilmiş Paketler:** LuCI web arayüzü çıkarılmış, hafif (~15-20 MB), VPN ve tünel araçları önceden entegre edilmiş kararlı sistem.
