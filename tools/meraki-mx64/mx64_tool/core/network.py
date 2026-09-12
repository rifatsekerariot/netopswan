import subprocess
import socket
import platform
import re
from typing import List, Optional
from mx64_tool.utils.logger import log_info, log_success, log_warning, log_error

def is_host_reachable(ip: str = "192.168.1.1", timeout: int = 2) -> bool:
    """Belirtilen IP adresine ping atarak erişilebilirliği kontrol eder."""
    param = "-c" if platform.system().lower() != "windows" else "-n"
    command = ["ping", param, "1", "-W" if platform.system().lower() == "darwin" else "-w", str(timeout * 1000 if platform.system().lower() == "darwin" else timeout), ip]
    try:
        res = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return res.returncode == 0
    except Exception:
        return False

def check_port_open(ip: str, port: int, timeout: float = 2.0) -> bool:
    """Soket bağlantısıyla portun açık olup olmadığını kontrol eder."""
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False

def get_usb_ethernet_interfaces() -> List[str]:
    """Sistemdeki USB Ethernet adaptörlerini (en5, en3, en4 vb.) Wi-Fi'dan (en0) ayırarak listeler."""
    usb_ifaces = []
    try:
        if platform.system().lower() == "darwin":
            out = subprocess.check_output(["networksetup", "-listallhardwareports"]).decode()
            blocks = out.split("Hardware Port: ")
            for block in blocks[1:]:
                lines = block.splitlines()
                port_name = lines[0].lower() if len(lines) > 0 else ""
                dev_line = [l for l in lines if l.startswith("Device: ")]
                dev = dev_line[0].replace("Device: ", "").strip() if dev_line else ""
                # Wi-Fi ve dahili bridge'i atla, USB / LAN / Ethernet olanları al
                if dev and "wi-fi" not in port_name and "bridge" not in port_name:
                    usb_ifaces.append(dev)
    except Exception:
        pass
    if not usb_ifaces:
        # Fallback Bilinen USB Ethernet adaptörleri
        usb_ifaces = ["en5", "en3", "en4"]
    return usb_ifaces

def get_network_interfaces() -> List[str]:
    """Sistemdeki aktif ağ arayüzlerini listeler (USB Ethernet öncelikli)."""
    interfaces = get_usb_ethernet_interfaces()
    try:
        if platform.system().lower() == "darwin":
            out = subprocess.check_output(["ifconfig", "-l"]).decode()
            for iface in out.strip().split():
                if iface not in interfaces and not iface.startswith("lo") and not iface.startswith("utun"):
                    interfaces.append(iface)
        elif platform.system().lower() == "linux":
            out = subprocess.check_output(["ip", "-o", "link", "show"]).decode()
            for line in out.splitlines():
                match = re.search(r"^\d+:\s+([^:@]+)", line)
                if match and match.group(1) not in interfaces:
                    interfaces.append(match.group(1))
    except Exception as e:
        log_warning(f"Ağ arayüzleri taranırken hata: {e}")
    return interfaces

def configure_static_ip(interface: str, ip: str = "192.168.1.2", netmask: str = "255.255.255.0") -> bool:
    """Ağ arayüzüne statik IP adresi atar."""
    try:
        log_info(f"{interface} arayüzüne {ip} atanıyor...")
        if platform.system().lower() == "darwin":
            cmd = ["ifconfig", interface, "inet", ip, "netmask", netmask, "up"]
            subprocess.run(["sudo"] + cmd, check=True)
        elif platform.system().lower() == "linux":
            cmd = ["ip", "addr", "add", f"{ip}/24", "dev", interface]
            subprocess.run(["sudo"] + cmd, check=True)
            subprocess.run(["sudo", "ip", "link", "set", interface, "up"], check=True)
        log_success(f"{interface} arayüzü {ip} olarak yapılandırıldı.")
        return True
    except Exception as e:
        log_error(f"IP yapılandırma hatası: {e}. Lütfen manuel olarak {interface} için 192.168.1.2/24 ayarlayın.")
        return False
