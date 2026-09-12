import re
from dataclasses import dataclass
from typing import Optional, Dict
from mx64_tool.core.telnet_client import MerakiTelnetClient
from mx64_tool.utils.logger import log_info, log_success, log_warning, log_error

@dataclass
class DeviceInfo:
    is_mx64: bool
    is_a0_rev: bool
    soc_raw_val: str
    mtd0_locked: bool
    mtd_map: Dict[str, str]
    mtd_sizes: Dict[str, str]
    recommended_image: str
    recommended_initramfs: str

class DeviceDetector:
    def __init__(self, telnet: MerakiTelnetClient):
        self.telnet = telnet

    def analyze(self) -> Optional[DeviceInfo]:
        log_info("Cihaz donanım ve yazılım bilgileri taranıyor...")
        
        # 1. MTD Tablosunu Oku
        mtd_output = self.telnet.execute_command("cat /proc/mtd", wait_seconds=1.0)
        mtd_map = {}
        mtd_sizes = {}
        for line in mtd_output.splitlines():
            match = re.search(r'(mtd\d+):\s+([0-9a-fA-F]+)\s+[0-9a-fA-F]+\s+"([^"]+)"', line)
            if match:
                mtd_map[match.group(1)] = match.group(3)
                mtd_sizes[match.group(1)] = match.group(2)

        # 2. MTD0 Salt-Okunur Durumu
        ro_output = self.telnet.execute_command("cat /sys/block/mtdblock0/ro", wait_seconds=0.5)
        mtd0_locked = "1" in ro_output

        # 3. SoC Revizyonunu Oku (devmem 0x18000000)
        soc_output = self.telnet.execute_command("devmem 0x18000000 || devmem2 0x18000000", wait_seconds=0.5)
        
        is_a0 = False
        soc_val = "UNKNOWN"
        # 0x3F00 - 0x3F03 -> A0
        match_hex = re.search(r'0x[0-9a-fA-F]{4,8}', soc_output)
        if match_hex:
            soc_val = match_hex.group(0)
            try:
                val_int = int(soc_val, 16)
                # BCM Revizyon maskesi
                rev_part = val_int & 0xFFFF
                if 0x3F00 <= rev_part <= 0x3F03:
                    is_a0 = True
            except ValueError:
                pass

        # İmaj belirleme
        if is_a0:
            rec_image = "openwrt-bcm53xx-generic-meraki_mx64-a0-squashfs.sysupgrade.bin"
            rec_initramfs = "openwrt-bcm53xx-generic-meraki_mx64-a0-initramfs.bin"
        else:
            rec_image = "openwrt-bcm53xx-generic-meraki_mx64-squashfs.sysupgrade.bin"
            rec_initramfs = "openwrt-bcm53xx-generic-meraki_mx64-initramfs.bin"

        is_mx64 = any("boot" in name.lower() or "ubi" in name.lower() for name in mtd_map.values()) or len(mtd_map) > 0

        info = DeviceInfo(
            is_mx64=is_mx64,
            is_a0_rev=is_a0,
            soc_raw_val=soc_val,
            mtd0_locked=mtd0_locked,
            mtd_map=mtd_map,
            mtd_sizes=mtd_sizes,
            recommended_image=rec_image,
            recommended_initramfs=rec_initramfs
        )
        return info
