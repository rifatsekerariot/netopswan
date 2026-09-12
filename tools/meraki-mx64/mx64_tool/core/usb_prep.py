import shutil
import subprocess
import platform
from pathlib import Path
from mx64_tool.utils.logger import log_info, log_success, log_warning, log_error

def prepare_usb_drive(usb_mount_path: Path, initramfs_file: Path) -> bool:
    """FAT32 MBR USB sürücüye doğru isimdeki initramfs dosyasını hazırlar."""
    if not usb_mount_path.exists():
        log_error(f"USB mount yolu bulunamadı: {usb_mount_path}")
        return False

    if not initramfs_file.exists():
        log_error(f"Initramfs dosyası bulunamadı: {initramfs_file}")
        return False

    # Clayface U-Boot'unun USB'den okuduğu kritik dosya adları
    target_names = [
        "openwrt-bcm5862x-generic-meraki_mx64-initramfs-kernel.bin",
        "openwrt-bcm5862x-generic-meraki_mx64a0-initramfs-kernel.bin",
        "openwrt-bcm53xx-generic-meraki_mx64-initramfs.bin"
    ]

    log_info(f"Initramfs dosyaları USB'ye yazılıyor ({usb_mount_path})...")
    for name in target_names:
        target_path = usb_mount_path / name
        try:
            shutil.copy2(initramfs_file, target_path)
            log_success(f"Yazıldı: {name}")
        except Exception as e:
            log_error(f"Yazma hatası ({name}): {e}")
            return False

    # macOS disk önbelleğini diske senkronize et
    try:
        subprocess.run(["sync"], check=True)
    except Exception:
        pass

    log_success("USB bellek mükemmel şekilde hazırlandı! (MBR FAT32 uyumlu)")
    return True
