import typer
import time
import subprocess
from pathlib import Path
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.prompt import Confirm, Prompt

from mx64_tool.core.network import is_host_reachable, check_port_open, get_network_interfaces, configure_static_ip
from mx64_tool.core.telnet_client import MerakiTelnetClient
from mx64_tool.core.detector import DeviceDetector
from mx64_tool.core.flasher import MerakiFlasher
from mx64_tool.core.http_server import PayloadHTTPServer
from mx64_tool.core.usb_prep import prepare_usb_drive
from mx64_tool.utils.logger import log_info, log_success, log_warning, log_error

app = typer.Typer(help="Cisco Meraki MX64 OpenWrt Uçtan Uca Otomatik Kurulum ve Flash Sihirbazı")
console = Console()

BASE_DIR = Path(__file__).resolve().parent.parent
PAYLOAD_DIR = BASE_DIR / "payload"
BACKUP_DIR = BASE_DIR / "backups"

@app.command()
def check():
    """Ağ bağlantısını ve MX64 Diag / OpenWrt durumunu test eder."""
    console.print(Panel("[bold cyan]MX64 Bağlantı Kontrolü[/bold cyan]"))
    
    reachable_10 = is_host_reachable("192.168.10.1", timeout=1)
    reachable_1 = is_host_reachable("192.168.1.1", timeout=1)
    ssh_10 = check_port_open("192.168.10.1", 22, timeout=1.0)
    ssh_1 = check_port_open("192.168.1.1", 22, timeout=1.0)
    telnet_open = check_port_open("192.168.1.1", 23, timeout=1.0)

    table = Table(title="Ağ ve Servis Durumu")
    table.add_column("Hedef", style="cyan")
    table.add_column("Durum", style="magenta")
    table.add_column("Açıklama", style="green")

    table.add_row("192.168.10.1 (SSH)", "✔ Açık" if ssh_10 else "✖ Kapalı", "Kalıcı OpenWrt (192.168.10.1)")
    table.add_row("192.168.1.1 (SSH)", "✔ Açık" if ssh_1 else "✖ Kapalı", "Geçici / Varsayılan OpenWrt")
    table.add_row("192.168.1.1 (Telnet)", "✔ Açık" if telnet_open else "✖ Kapalı", "Meraki Diag Modu")

    console.print(table)

@app.command()
def prep_usb(
    usb_path: str = typer.Option(..., "--usb-path", "-u", help="FAT32 MBR USB mount dizini (Örn: /Volumes/OPENWRT)")
):
    """FAT32 MBR USB belleği doğru Clayface kernel adlarıyla otomatik hazırlar."""
    initramfs_file = PAYLOAD_DIR / "openwrt-bcm5862x-generic-meraki_mx64-initramfs-kernel.bin"
    prepare_usb_drive(Path(usb_path), initramfs_file)

@app.command()
def backup_full(
    interface: str = typer.Option("", "--iface", "-i", help="Ağ arayüzü adı (boş bırakılırsa sorulur)"),
    host_ip: str = typer.Option("192.168.1.2", "--host-ip", help="Bu bilgisayarın MX64 ile aynı ağdaki geçici IP'si"),
):
    """🎯 TAM CİHAZ YEDEĞİ: Henüz dönüştürülmemiş, STOK bir Meraki MX64'ün TÜM flash
    bölümlerini (bootloader + kernel/rootfs + nvram/config - ne varsa hepsi) tek tek
    indirir. `run` komutunun aksine hiçbir şey YAZMAZ/FLAŞLAMAZ - sadece okur/yedekler,
    bu yüzden dönüştürme niyeti olmayan, sadece "ileride geri dönüş için orijinal
    durumu sakla" amacıyla da güvenle çalıştırılabilir.

    Elde edilen tam yedek, ileride AYNI donanım revizyonuna sahip dönüştürülmüş bir
    cihazı orijinal durumuna geri getirmek için kullanılabilir (bkz. RECOVERY_GUIDE.md).
    """
    console.print(Panel("[bold green]MX64 TAM CİHAZ YEDEĞİ (Salt-Okunur, Hiçbir Şey Flaşlanmaz)[/bold green]"))

    if not interface:
        interfaces = get_network_interfaces()
        default_iface = "en5" if "en5" in interfaces else ("en0" if "en0" in interfaces else interfaces[0])
        interface = Prompt.ask("MX64'ün bağlı olduğu ethernet arayüzünü girin", default=default_iface)

    configure_static_ip(interface, host_ip)

    log_info("MX64 Diag Telnet (192.168.1.1:23) aranıyor...")
    for _ in range(15):
        if check_port_open("192.168.1.1", 23):
            break
        time.sleep(1)

    telnet = MerakiTelnetClient("192.168.1.1", 23)
    if not telnet.connect():
        log_error("Telnet açılamadı. Cihazı Reset tuşuna basılı tutarak güç verip Diag moduna alın.")
        return

    try:
        detector = DeviceDetector(telnet)
        info = detector.analyze()
        log_success(f"Cihaz Tespiti: {'A0 Revizyonu' if info.is_a0_rev else 'Standart MX64'} | SoC: {info.soc_raw_val}")
        log_info(f"Tespit edilen bölümler: {info.mtd_map}")

        if not info.mtd_map:
            log_error("Hiçbir mtd bölümü tespit edilemedi - /proc/mtd okunamamış olabilir. İşlem durduruldu.")
            return

        if not Confirm.ask(
            f"[bold yellow]{len(info.mtd_map)} bölümün TAMAMI indirilecek (büyük bölümler dakikalar sürebilir). Devam edilsin mi?[/bold yellow]",
            default=True,
        ):
            log_warning("İşlem kullanıcı tarafından durduruldu.")
            return

        flasher = MerakiFlasher(telnet, PAYLOAD_DIR, BACKUP_DIR, http_port=8000)
        results = flasher.backup_all_partitions(info.mtd_map, host_ip=host_ip, mtd_sizes=info.mtd_sizes)

        table = Table(title="Tam Cihaz Yedeği Sonucu")
        table.add_column("Bölüm", style="cyan")
        table.add_column("Etiket", style="magenta")
        table.add_column("Durum", style="green")
        for mtd_name, label in info.mtd_map.items():
            status = f"✔ {results[mtd_name].name}" if mtd_name in results else "✖ BAŞARISIZ"
            table.add_row(mtd_name, label, status)
        console.print(table)

    finally:
        telnet.close()

@app.command()
def run(
    interface: str = typer.Option("", "--iface", "-i", help="Ağ arayüzü adı (boş bırakılırsa sorulur)")
):
    """UÇTAN UCA TAM OTOMATİK SİHİRBAZ:
    1. Diag & Telnet Bağlantısı
    2. Donanım & SoC Tespiti
    3. MTD0 (Boot) Yedeği Alma
    4. MTD Kilit Açma & U-Boot Flashlama
    5. USB Hazırlama & USB Boot Rehberliği
    6. SSH Pipe ile Kalıcı Sysupgrade Kurulumu (Netmask / IP Fix Dahil)
    """
    console.print(Panel("[bold green]Cisco Meraki MX64 Uçtan Uca OpenWrt Kurulum Sihirbazı[/bold green]\n[yellow]Bu sihirbaz cihazınızı stok durumdan tam çalışan OpenWrt'ye dönüştürür.[/yellow]"))

    # AĞ ARAYÜZÜ
    if not interface:
        interfaces = get_network_interfaces()
        default_iface = "en5" if "en5" in interfaces else ("en0" if "en0" in interfaces else interfaces[0])
        interface = Prompt.ask("MX64'ün bağlı olduğu ethernet arayüzünü girin", default=default_iface)

    # -------------------------------------------------------------
    # FAZ 1: DİAG MODU VE U-BOOT FLASH
    # -------------------------------------------------------------
    console.print(Panel("[bold cyan]FAZ 1: Stok Meraki Diag Modu & U-Boot Flashlama[/bold cyan]"))
    configure_static_ip(interface, "192.168.1.2")

    log_info("MX64 Diag Telnet (192.168.1.1:23) aranıyor...")
    for _ in range(15):
        if check_port_open("192.168.1.1", 23):
            break
        time.sleep(1)
    
    telnet = MerakiTelnetClient("192.168.1.1", 23)
    if not telnet.connect():
        log_error("Telnet açılamadı. Cihazı Reset tuşuna basılı tutarak güç verip Diag moduna alın.")
        return

    http_server = PayloadHTTPServer(PAYLOAD_DIR, port=8000)
    http_server.start()

    try:
        # 1. Donanım Tespiti
        detector = DeviceDetector(telnet)
        info = detector.analyze()
        log_success(f"Cihaz Tespiti: {'A0 Revizyonu' if info.is_a0_rev else 'Standart MX64'} | SoC: {info.soc_raw_val}")

        # 2. MTD0 Yedeği (her zaman - hızlı, küçük, U-Boot flashlama için zaten şart)
        flasher = MerakiFlasher(telnet, PAYLOAD_DIR, BACKUP_DIR, http_port=8000)
        flasher.backup_mtd0("192.168.1.2")

        # 2b. TAM CİHAZ YEDEĞİ (opsiyonel) - "ileride bu donanım revizyonundaki bir
        # cihazı orijinal stok Meraki durumuna geri döndürebilmek" için TÜM bölümlerin
        # (kernel/rootfs/nvram dahil) indirilmesi. mtd0'dan çok daha uzun sürebilir
        # (rootfs/ubi onlarca-yüzlerce MB olabilir) - bu yüzden varsayılan olarak
        # SORULUR, otomatik çalışmaz. Bu adım tamamen salt-okunurdur, hiçbir şeyi
        # değiştirmez/flaşlamaz - reddedilse de dönüştürme akışı normal devam eder.
        if Confirm.ask(
            "[bold cyan]Bu cihazın TÜM bölümlerinin (kernel/rootfs/nvram dahil) tam yedeğini de almak ister misiniz? "
            "(İleride bu donanım revizyonundaki cihazları orijinal Meraki durumuna geri döndürmek için gereklidir)[/bold cyan]",
            default=True,
        ):
            log_info(f"Tespit edilen bölümler: {info.mtd_map}")
            results = flasher.backup_all_partitions(info.mtd_map, host_ip="192.168.1.2", mtd_sizes=info.mtd_sizes)
            if len(results) == len(info.mtd_map):
                log_success(f"✅ Tam cihaz yedeği tamamlandı ({len(results)} bölüm) - {BACKUP_DIR}")
            else:
                log_warning(f"⚠️ Tam cihaz yedeği KISMEN tamamlandı ({len(results)}/{len(info.mtd_map)} bölüm) - eksik bölümler için `mx64-tool backup-full` komutunu ayrıca çalıştırabilirsiniz.")

        # 3. Kilit Açma
        if info.mtd0_locked:
            flasher.unlock_mtd0("192.168.1.2")

        # 4. U-Boot Flashlama
        if not Confirm.ask("[bold red]U-Boot flashlama işlemini onaylıyor musunuz?[/bold red]", default=True):
            log_warning("İşlem kullanıcı tarafından durduruldu.")
            return

        flasher.flash_uboot("192.168.1.2")
        log_success("U-Boot başarıyla flashlandı!")

    finally:
        telnet.close()
        http_server.stop()

    # -------------------------------------------------------------
    # FAZ 2: USB HAZIRLAMA VE BOOT
    # -------------------------------------------------------------
    console.print(Panel("""[bold cyan]FAZ 2: USB Bellek Hazırlama & USB Boot[/bold cyan]

1. FAT32 MBR formatlı bir USB belleği bilgisayarınıza takın.
2. USB'nin mount dizinini girin (Örn: /Volumes/OPENWRT).
"""))

    usb_mount = Prompt.ask("USB Bellek Dizini", default="/Volumes/OPENWRT")
    initramfs_file = PAYLOAD_DIR / "openwrt-bcm5862x-generic-meraki_mx64-initramfs-kernel.bin"
    prepare_usb_drive(Path(usb_mount), initramfs_file)

    console.print(Panel("""[bold yellow]Lütfen Şimdi Şunları Yapın:[/bold yellow]
1. USB belleği Mac'ten çıkarıp MX64'ün USB portuna takın.
2. Ethernet kablosunu MX64'ün LAN 1 portuna takın.
3. Reset tuşuna basılı tutarak MX64'e güç verin (LED yeşile dönünce Reset'i bırakın).
"""))

    Confirm.ask("Cihazı USB ile açtınız ve LED yeşile döndü mü?", default=True)

    # -------------------------------------------------------------
    # FAZ 3: KALICI OPENWRT KURULUMU (SYSUPGRADE)
    # -------------------------------------------------------------
    console.print(Panel("[bold cyan]FAZ 3: Kalıcı OpenWrt Sysupgrade Flashlama[/bold cyan]"))
    
    flash_script = BASE_DIR / "scripts" / "flash_openwrt.sh"
    log_info("Kalıcı flashlama scripti (flash_openwrt.sh) otomatik yürütülüyor...")
    subprocess.run([str(flash_script)], check=True)

    # -------------------------------------------------------------
    # FAZ 4: TAMAMLAMA & ERİŞİM BİLGİSİ
    # -------------------------------------------------------------
    console.print(Panel("""[bold green]TEBRİKLER! TÜM DÖNÜŞÜM İŞLEMLERİ EKSİKSİZ TAMAMLANDI.[/bold green]

[bold cyan]Cihaz Bilgileri:[/bold cyan]
- [bold]IP Adresi:[/bold] 192.168.10.1 (Netmask: 255.255.255.0)
- [bold]SSH Kullanıcı Adı:[/bold] root
- [bold]SSH Şifresi:[/bold] YOK (Boş)
- [bold]Bağlantı Komutu:[/bold] ssh root@192.168.10.1

USB belleği artık cihazdan çıkarabilirsiniz. MX64 dahili hafızasından OpenWrt olarak çalışacaktır.
"""))

if __name__ == "__main__":
    app()
