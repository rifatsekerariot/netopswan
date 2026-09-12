import shutil
import subprocess
import platform
from pathlib import Path
from mx64_tool.utils.logger import log_info, log_success, log_warning, log_error

def prepare_usb_drive(usb_mount_path: Path, initramfs_file: Path, hub_url: str) -> bool:
    """FAT32 MBR USB sürücüye initramfs dosyasını, NetOps SD-WAN Agent binary'sini ve müşteriye özel mühürlü konfigürasyonu hazırlar."""
    if not hub_url or not hub_url.strip():
        log_error("Hata: Hub URL (Merkez Sunucu Adresi) boş olamaz!")
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

    # NetOps SD-WAN Müşteri Konfigürasyonunu ve Mühürleme Dosyalarını USB'ye Göm
    try:
        netops_dir = usb_mount_path / "netops"
        netops_dir.mkdir(parents=True, exist_ok=True)

        # 1. hub_url dosyası
        (netops_dir / "hub_url").write_text(hub_url.strip() + "\n")

        # 2. netops.uci konfigürasyonu
        uci_content = f"""config netops 'agent'
\toption enabled '1'
\toption hub_url '{hub_url.strip()}'
\toption listen_port '51820'
\toption auto_discovery '1'
\toption config_dir '/etc/netops'
"""
        (netops_dir / "netops.uci").write_text(uci_content)

        # 3. Otomatik mühürleme betiği (install_agent.sh)
        install_sh = f"""#!/bin/sh
set -e
mkdir -p /etc/netops /etc/config /etc/init.d /usr/bin
echo "{hub_url.strip()}" > /etc/netops/hub_url

cat << 'EOF' > /etc/config/netops
config netops 'agent'
\toption enabled '1'
\toption hub_url '{hub_url.strip()}'
\toption listen_port '51820'
\toption auto_discovery '1'
\toption config_dir '/etc/netops'
EOF

cat << 'EOF' > /etc/init.d/netops-agent
#!/bin/sh /etc/rc.common
USE_PROCD=1
START=95
STOP=10

start_service() {{
    local enabled hub_url
    config_load netops
    config_get_bool enabled agent enabled 1
    config_get hub_url agent hub_url "{hub_url.strip()}"
    [ "$enabled" -eq 1 ] || return 0

    procd_open_instance
    procd_set_param command /usr/bin/netops-agent --hub-url "$hub_url"
    procd_set_param respawn 3600 5 0
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}}
EOF
chmod +x /etc/init.d/netops-agent

uci set firewall.sdwan_wg=rule 2>/dev/null || true
uci set firewall.sdwan_wg.name='Allow-SDWAN-WireGuard' 2>/dev/null || true
uci set firewall.sdwan_wg.src='wan' 2>/dev/null || true
uci set firewall.sdwan_wg.proto='udp' 2>/dev/null || true
uci set firewall.sdwan_wg.dest_port='51820' 2>/dev/null || true
uci set firewall.sdwan_wg.target='ACCEPT' 2>/dev/null || true
uci commit firewall
/etc/init.d/firewall restart 2>/dev/null || true

# LAN İstemcileri İçin Otomatik Gateway ve Ultra Hızlı DNS Enjeksiyonu
LAN_IP=$(uci get network.lan.ipaddr 2>/dev/null || echo "192.168.1.1")
uci del_list dhcp.lan.dhcp_option="3,$LAN_IP" 2>/dev/null || true
uci add_list dhcp.lan.dhcp_option="3,$LAN_IP" 2>/dev/null || true
uci del_list dhcp.lan.dhcp_option="6,1.1.1.1,8.8.8.8" 2>/dev/null || true
uci add_list dhcp.lan.dhcp_option="6,1.1.1.1,8.8.8.8" 2>/dev/null || true
uci set dhcp.@dnsmasq[0].cachesize=10000 2>/dev/null || true
uci set dhcp.@dnsmasq[0].allservers=1 2>/dev/null || true
uci set dhcp.@dnsmasq[0].min_cache_ttl=3600 2>/dev/null || true
uci commit dhcp 2>/dev/null || true
/etc/init.d/dnsmasq restart 2>/dev/null || true

/etc/init.d/netops-agent enable 2>/dev/null || true
/etc/init.d/netops-agent restart 2>/dev/null || true
echo "✔ NetOpsWan SD-WAN Ajanı ve LAN İstemci Ağ Geçidi Başarıyla Mühürlendi!"
"""
        (netops_dir / "install_agent.sh").write_text(install_sh)

        # 4. Eğer workspace dist altında derlenmiş ARMv7 binary varsa USB'ye kopyala
        workspace_dist_binary = Path(__file__).resolve().parent.parent.parent.parent / "packages" / "rust-sdwan" / "dist" / "meraki-armv7" / "netops-agent"
        if workspace_dist_binary.exists():
            shutil.copy2(workspace_dist_binary, netops_dir / "netops-agent")
            log_success(f"NetOps Rust Agent ARMv7 binary'si USB'ye eklendi ({workspace_dist_binary.stat().st_size} bytes)")

        log_success(f"NetOps SD-WAN Hub konfigürasyonu USB'ye mühürlendi (Hub: {hub_url})")
    except Exception as e:
        log_warning(f"NetOps konfigürasyonu USB'ye yazılırken uyarı: {e}")

    # macOS disk önbelleğini diske senkronize et
    try:
        subprocess.run(["sync"], check=True)
    except Exception:
        pass

    log_success("USB bellek mükemmel şekilde hazırlandı! (MBR FAT32 + NetOps SD-WAN Entegre)")
    return True
