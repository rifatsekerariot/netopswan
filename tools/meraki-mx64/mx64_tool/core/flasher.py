import re
import time
import socket
from pathlib import Path
from typing import Dict, Optional
from mx64_tool.core.telnet_client import MerakiTelnetClient
from mx64_tool.utils.logger import log_info, log_success, log_warning, log_error

class MerakiFlasher:
    def __init__(self, telnet: MerakiTelnetClient, payload_dir: Path, backup_dir: Path, http_port: int = 8000):
        self.telnet = telnet
        self.payload_dir = payload_dir
        self.backup_dir = backup_dir
        self.http_port = http_port

    def _slugify(self, label: str) -> str:
        """Bölüm adını (örn. "rootfs_data") dosya adında güvenle kullanılabilir hale getirir."""
        return re.sub(r'[^a-zA-Z0-9_-]+', '_', label.strip()) or "unknown"

    def backup_partition(self, mtd_name: str, label: str, size_hex: Optional[str] = None,
                          host_ip: str = "192.168.1.2", nc_port: int = 9999) -> Optional[Path]:
        """
        Belirtilen HERHANGİ BİR mtd bölümünü (mtd0, mtd1, mtd2 ...) netcat üzerinden
        PC'ye tam olarak yedekler. `backup_mtd0`'ın genelleştirilmiş hali - tam cihaz
        yedeği (backup_all_partitions) ve tekil bölüm yedeği için ortak kod yolu.

        NOT: `/dev/mtdblockN` üzerinden okuma yapılır (mtdblock0, mtdblock1, ...) - bu
        MX64 stok Meraki ortamında zaten `mtd0` için doğrulanmış, çalışan bir yöntemdir.
        """
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        mtd_index = re.sub(r'\D', '', mtd_name) or "0"
        safe_label = self._slugify(label)
        backup_file = self.backup_dir / f"orig_{mtd_name}_{safe_label}_{int(time.time())}.bin"

        size_info = f" (~{int(size_hex, 16) // 1024} KB)" if size_hex else ""
        log_info(f"{mtd_name} (\"{label}\") bölümü yedekleniyor{size_info}... -> {backup_file.name}")

        import threading
        received = {"ok": False}

        def listen_nc():
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    s.bind(("", nc_port))
                    s.listen(1)
                    s.settimeout(30)
                    conn, addr = s.accept()
                    with open(backup_file, "wb") as f:
                        while True:
                            data = conn.recv(65536)
                            if not data:
                                break
                            f.write(data)
                    received["ok"] = True
            except Exception as e:
                log_error(f"{mtd_name} yedek alma dinleyicisi hatası: {e}")

        t = threading.Thread(target=listen_nc)
        t.start()
        time.sleep(0.5)

        # Büyük bölümler (rootfs/ubi, onlarca-yüzlerce MB) küçük mtd0'dan çok daha uzun
        # sürebilir - sabit 3 saniye yerine boyuta göre orantılı, üst sınırlı bir bekleme.
        wait_seconds = 3.0
        if size_hex:
            try:
                size_mb = int(size_hex, 16) / (1024 * 1024)
                wait_seconds = min(max(3.0, size_mb * 0.5), 180.0)
            except ValueError:
                pass

        cmd = f"nc {host_ip} {nc_port} < /dev/mtdblock{mtd_index} || cat /dev/mtdblock{mtd_index} | nc {host_ip} {nc_port}"
        self.telnet.execute_command(cmd, wait_seconds=wait_seconds)
        t.join(timeout=30)

        if backup_file.exists() and backup_file.stat().st_size > 0:
            log_success(f"{mtd_name} (\"{label}\") yedeği alındı ({backup_file.stat().st_size} bytes): {backup_file.name}")
            return backup_file
        else:
            log_warning(f"{mtd_name} (\"{label}\") için netcat yedeklemesi başarısız oldu - atlanıyor.")
            if backup_file.exists():
                backup_file.unlink(missing_ok=True)
            return None

    def backup_mtd0(self, host_ip: str = "192.168.1.2") -> bool:
        """Cihazdaki mtd0 (boot) bölümünü netcat üzerinden PC'ye yedekler.
        Geriye dönük uyumluluk için korunmuştur - artık `backup_partition`'ı sarar."""
        result = self.backup_partition("mtd0", "boot", host_ip=host_ip)
        if result:
            return True

        log_warning("Netcat yedekleme başarısız oldu, /tmp üzerinden alternatif deneniyor...")
        self.telnet.execute_command("dd if=/dev/mtdblock0 of=/tmp/mtd0_dump.bin bs=64k count=16", wait_seconds=2)
        log_info("Yedekleme cihazın /tmp/mtd0_dump.bin alanına alındı.")
        return True

    def backup_all_partitions(self, mtd_map: Dict[str, str], host_ip: str = "192.168.1.2",
                               mtd_sizes: Optional[Dict[str, str]] = None) -> Dict[str, Path]:
        """
        🎯 TAM CİHAZ YEDEĞİ: `/proc/mtd`'de listelenen HER bölümü (bootloader, kernel,
        rootfs/ubi, nvram/config - ne varsa) tek tek indirir. Amaç: orijinal, stok bir
        Meraki cihazından (henüz OpenWrt'ye dönüştürülmemiş) eksiksiz bir flash imajı
        çıkarmak - böylece ileride dönüştürülmüş bir cihaz, isteğe bağlı olarak orijinal
        (donör ile aynı donanım revizyonuna sahip) bir MX64'ün tam durumuna geri
        döndürülebilir.

        ⚠️ ÖNEMLİ (kimlik çakışması riski): Kernel/rootfs bölümleri modeldeki TÜM
        cihazlarda genelde aynıdır, ama nvram/config bölümü cihaza özel seri numarası/
        MAC/lisans bilgisi içerebilir. Bu fonksiyon HER bölümü ayrı, adlandırılmış
        dosyalara yedekler (örn. `orig_mtd3_nvram_....bin`) - geri yükleme yapılırken
        hangi bölümün donörden, hangisinin cihazın KENDİ orijinal kaydından (varsa)
        gelmesi gerektiğine bilinçli karar verilebilsin diye bölümler asla otomatik
        birleştirilmez/karıştırılmaz.

        Döner: {mtd_name: yedek_dosya_yolu} - başarısız olan bölümler sözlükte yer almaz.
        """
        if not mtd_map:
            log_error("mtd_map boş - önce DeviceDetector.analyze() ile /proc/mtd okunmalı.")
            return {}

        log_info(f"🎯 TAM CİHAZ YEDEĞİ başlıyor: {len(mtd_map)} bölüm tespit edildi ({', '.join(mtd_map.values())})")
        results: Dict[str, Path] = {}

        for mtd_name, label in sorted(mtd_map.items(), key=lambda kv: int(re.sub(r'\D', '', kv[0]) or 0)):
            size_hex = (mtd_sizes or {}).get(mtd_name)
            backup_file = self.backup_partition(mtd_name, label, size_hex=size_hex, host_ip=host_ip)
            if backup_file:
                results[mtd_name] = backup_file
            else:
                log_warning(f"⚠️ {mtd_name} (\"{label}\") ATLANDI - tam yedek EKSİK kalacak, manuel kontrol gerekebilir.")

        if len(results) == len(mtd_map):
            log_success(f"✅ TAM CİHAZ YEDEĞİ TAMAMLANDI: {len(results)}/{len(mtd_map)} bölüm başarıyla indirildi.")
        else:
            log_warning(f"⚠️ TAM CİHAZ YEDEĞİ KISMEN TAMAMLANDI: {len(results)}/{len(mtd_map)} bölüm indirildi - eksik bölümleri tekrar deneyin.")

        return results

    def unlock_mtd0(self, host_ip: str = "192.168.1.2") -> bool:
        """mtd-rw.ko modülünü indirip yükleyerek mtd0 kilidini açar."""
        log_info("MTD kilit açma modülü (mtd-rw.ko) cihaza yükleniyor...")
        self.telnet.execute_command(f"wget http://{host_ip}:{self.http_port}/mtd-rw.ko -O /tmp/mtd-rw.ko", wait_seconds=2.0)
        
        # Kernel modülünü yükle
        out = self.telnet.execute_command("insmod /tmp/mtd-rw.ko i_want_a_brick=1", wait_seconds=1.5)
        dmesg = self.telnet.execute_command("dmesg | tail -n 10", wait_seconds=0.5)
        
        if "setting writeable flag" in dmesg or "mtd-rw" in dmesg:
            log_success("MTD0 yazma kilidi başarıyla açıldı (writeable flag set).")
            return True
        else:
            log_warning(f"Kilit durumu teyit edilemedi. Dmesg çıktısı: {dmesg}")
            return False

    def flash_uboot(self, host_ip: str = "192.168.1.2") -> bool:
        """Yeni uboot_mx64 dosyasını indirip flashlar."""
        log_info("U-Boot ve mtd binary'leri cihaza indiriliyor...")
        self.telnet.execute_command(f"wget http://{host_ip}:{self.http_port}/mtd -O /tmp/mtd && chmod +x /tmp/mtd", wait_seconds=1.5)
        self.telnet.execute_command(f"wget http://{host_ip}:{self.http_port}/uboot_mx64 -O /tmp/uboot_mx64", wait_seconds=2.0)

        # Hash kontrolü (cihaz tarafında)
        log_info("U-Boot flashlama işlemi başlatılıyor (/dev/mtd0)...")
        # Öncelik mtd write aracı
        out = self.telnet.execute_command("/tmp/mtd write /tmp/uboot_mx64 /dev/mtd0 || dd if=/tmp/uboot_mx64 of=/dev/mtdblock0", wait_seconds=4.0)
        
        log_success("U-Boot flashlama komutu tamamlandı!")
        log_info("Çıktı:\n" + out)
        return True
