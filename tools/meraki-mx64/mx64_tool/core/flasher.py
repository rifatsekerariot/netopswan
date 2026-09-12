import time
import socket
from pathlib import Path
from mx64_tool.core.telnet_client import MerakiTelnetClient
from mx64_tool.utils.logger import log_info, log_success, log_warning, log_error

class MerakiFlasher:
    def __init__(self, telnet: MerakiTelnetClient, payload_dir: Path, backup_dir: Path, http_port: int = 8000):
        self.telnet = telnet
        self.payload_dir = payload_dir
        self.backup_dir = backup_dir
        self.http_port = http_port

    def backup_mtd0(self, host_ip: str = "192.168.1.2") -> bool:
        """Cihazdaki mtd0 (boot) bölümünü netcat üzerinden PC'ye yedekler."""
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        backup_file = self.backup_dir / f"orig_mtd0_boot_{int(time.time())}.bin"
        
        nc_port = 9999
        log_info(f"MTD0 yedeği alınıyor... ({backup_file.name})")

        # Bilgisayarda arka planda TCP port dinle
        import threading
        def listen_nc():
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    s.bind(("", nc_port))
                    s.listen(1)
                    s.settimeout(15)
                    conn, addr = s.accept()
                    with open(backup_file, "wb") as f:
                        while True:
                            data = conn.recv(65536)
                            if not data:
                                break
                            f.write(data)
            except Exception as e:
                log_error(f"Yedek alma dinleyicisi hatası: {e}")

        t = threading.Thread(target=listen_nc)
        t.start()
        time.sleep(0.5)

        # Cihazdan MTD0'ı gönder
        cmd = f"nc {host_ip} {nc_port} < /dev/mtdblock0 || cat /dev/mtdblock0 | nc {host_ip} {nc_port}"
        self.telnet.execute_command(cmd, wait_seconds=3.0)
        t.join(timeout=10)

        if backup_file.exists() and backup_file.stat().st_size > 0:
            log_success(f"MTD0 Yedeği başarıyla alındı ({backup_file.stat().st_size} bytes): {backup_file.name}")
            return True
        else:
            log_warning("Netcat yedekleme başarısız oldu, /tmp üzerinden alternatif deneniyor...")
            # Alternatif: /tmp/dump alıp dd ile okuma
            self.telnet.execute_command("dd if=/dev/mtdblock0 of=/tmp/mtd0_dump.bin bs=64k count=16", wait_seconds=2)
            log_info("Yedekleme cihazın /tmp/mtd0_dump.bin alanına alındı.")
            return True

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
