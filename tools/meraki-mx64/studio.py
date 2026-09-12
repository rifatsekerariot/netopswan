#!/usr/bin/env python3
"""
NetOpsWan - Meraki MX64 Staging & Firmware Flash Studio
Mac & Linux uyumlu bağımsız Web GUI sunucusu (Sıfır ek kütüphane bağımlılığı - Standard Python library)
"""

import os
import sys
import json
import time
import shutil
import socket
import subprocess
import threading
import webbrowser
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE_DIR = Path(__file__).resolve().parent
PAYLOAD_DIR = BASE_DIR / "payload"
BACKUP_DIR = BASE_DIR / "backups"
SCRIPTS_DIR = BASE_DIR / "scripts"

PORT = 7890

# Global İşlem ve Log Durumu
STATE = {
    "status": "idle", # idle, scanning, flashing_uboot, preparing_usb, flashing_sysupgrade, success, error
    "progress": 0,
    "current_step": "Hazır",
    "hub_url": "https://sdwan.ariot.com.tr/api/sdwan",
    "detected_device": None, # { host: "192.168.1.1", mode: "diag" | "openwrt_tmp" | "openwrt_perm" }
    "detected_usbs": [],
    "existing_backups": [],
    "logs": []
}

def scan_backups():
    backups = []
    if BACKUP_DIR.exists():
        for b in sorted(BACKUP_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if b.is_file() and (b.name.endswith(".bin") or b.name.endswith(".tar.gz")):
                size_kb = round(b.stat().st_size / 1024, 1)
                mtime = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(b.stat().st_mtime))
                backups.append({"name": b.name, "size_kb": size_kb, "date": mtime})
    STATE["existing_backups"] = backups
    return backups

def add_log(msg: str, level="info"):
    timestamp = time.strftime("%H:%M:%S")
    entry = {"time": timestamp, "msg": msg, "level": level}
    STATE["logs"].append(entry)
    if len(STATE["logs"]) > 200:
        STATE["logs"].pop(0)
    print(f"[{timestamp}] [{level.upper()}] {msg}")

def check_port(host, port, timeout=1.0):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except:
        return False

def scan_usbs():
    usbs = []
    if sys.platform == "darwin":
        volumes_path = Path("/Volumes")
        if volumes_path.exists():
            for v in volumes_path.iterdir():
                if v.is_dir() and not v.name.startswith("Macintosh") and not v.name.startswith("Recovery"):
                    # Check if writeable
                    usbs.append({
                        "name": v.name,
                        "path": str(v),
                        "free_gb": round(shutil.disk_usage(v).free / (1024**3), 1)
                    })
    else: # Linux
        media_path = Path("/media")
        if media_path.exists():
            for root, dirs, files in os.walk("/media"):
                for d in dirs:
                    p = Path(root) / d
                    usbs.append({"name": d, "path": str(p), "free_gb": 4.0})
    STATE["detected_usbs"] = usbs
    return usbs

def get_mac_usb_ethernet():
    if sys.platform == "darwin":
        try:
            out = subprocess.check_output(["networksetup", "-listallhardwareports"]).decode()
            blocks = out.split("Hardware Port: ")
            for block in blocks[1:]:
                lines = block.splitlines()
                port_name = lines[0].lower() if len(lines) > 0 else ""
                dev_line = [l for l in lines if l.startswith("Device: ")]
                dev = dev_line[0].replace("Device: ", "").strip() if dev_line else ""
                if dev and "wi-fi" not in port_name and "bridge" not in port_name:
                    return dev
        except:
            pass
    return "en5"

def scan_network_device():
    usb_iface = get_mac_usb_ethernet()
    # 1. Check Permanent OpenWrt (192.168.10.1:22)
    if check_port("192.168.10.1", 22, timeout=0.8):
        STATE["detected_device"] = {
            "host": "192.168.10.1",
            "iface": usb_iface,
            "mode": "openwrt_perm",
            "desc": f"Kalıcı OpenWrt Aktif (192.168.10.1:22 - USB: {usb_iface})"
        }
        return STATE["detected_device"]
    # 2. Check Temporary USB/Default OpenWrt (192.168.1.1:22)
    elif check_port("192.168.1.1", 22, timeout=0.8):
        STATE["detected_device"] = {
            "host": "192.168.1.1",
            "iface": usb_iface,
            "mode": "openwrt_tmp",
            "desc": f"Geçici USB / Stok OpenWrt Açık (192.168.1.1:22 - USB: {usb_iface})"
        }
        return STATE["detected_device"]
    # 3. Check Stock Meraki Diag (192.168.1.1:23)
    elif check_port("192.168.1.1", 23, timeout=0.8):
        STATE["detected_device"] = {
            "host": "192.168.1.1",
            "iface": usb_iface,
            "mode": "diag",
            "desc": f"Stok Meraki Diag Modu (192.168.1.1:23 - USB: {usb_iface})"
        }
        return STATE["detected_device"]
    else:
        STATE["detected_device"] = None
        return None

HTML_PAGE = """<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NetOpsWan - Meraki MX64 Staging & Flash Studio</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #090d16;
            --card: #111827;
            --card-border: #1f293d;
            --primary: #3b82f6;
            --primary-glow: rgba(59, 130, 246, 0.2);
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --text: #f3f4f6;
            --text-muted: #9ca3af;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            padding: 24px;
        }
        .container { max-width: 1100px; margin: 0 auto; width: 100%; }
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-b: 1px solid var(--card-border);
            padding-bottom: 20px;
            margin-bottom: 24px;
        }
        .logo-box { display: flex; align-items: center; gap: 12px; }
        .logo-icon {
            width: 44px; height: 44px;
            background: linear-gradient(135deg, #2563eb, #3b82f6);
            border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            font-size: 22px; font-weight: 800; color: white;
            box-shadow: 0 0 20px var(--primary-glow);
        }
        h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
        .subtitle { font-size: 12px; color: var(--text-muted); }
        .badge {
            padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 700;
            display: inline-flex; align-items: center; gap: 6px;
        }
        .badge-online { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
        .badge-offline { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
        
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
        
        .card {
            background: var(--card);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .card-title {
            font-size: 14px; font-weight: 700; margin-bottom: 14px;
            display: flex; align-items: center; justify-content: space-between;
        }
        
        .field { margin-bottom: 16px; }
        label { display: block; font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; }
        input, select {
            width: 100%; padding: 10px 14px; background: #0c121e; border: 1px solid var(--card-border);
            border-radius: 10px; color: white; font-family: inherit; font-size: 13px; font-weight: 600;
            outline: none; transition: 0.2s;
        }
        input:focus, select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-glow); }
        
        .btn {
            display: inline-flex; align-items: center; justify-content: center; gap: 8px;
            padding: 12px 20px; border-radius: 12px; font-size: 13px; font-weight: 700;
            cursor: pointer; border: none; transition: 0.2s; text-decoration: none; width: 100%;
        }
        .btn-primary { background: #2563eb; color: white; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-success { background: #059669; color: white; }
        .btn-success:hover { background: #047857; }
        .btn-secondary { background: #1f293d; color: var(--text); }
        .btn-secondary:hover { background: #27354f; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .progress-box { margin-top: 16px; }
        .progress-bar-bg { width: 100%; height: 8px; background: #1f293d; border-radius: 999px; overflow: hidden; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #10b981); width: 0%; transition: width 0.4s ease; }
        
        .terminal {
            background: #060911; border: 1px solid #1a2333; border-radius: 12px;
            padding: 14px; font-family: 'JetBrains Mono', monospace; font-size: 11px;
            height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
        }
        .log-time { color: #6b7280; margin-right: 6px; }
        .log-info { color: #93c5fd; }
        .log-success { color: #6ee7b7; font-weight: bold; }
        .log-warning { color: #fde047; }
        .log-error { color: #fca5a5; font-weight: bold; }

        .guide-box {
            background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2);
            border-radius: 12px; padding: 14px; font-size: 12px; line-height: 1.5; color: #bfdbfe;
            margin-top: 14px;
        }
        .guide-step { display: flex; gap: 10px; margin-bottom: 8px; align-items: flex-start; }
        .step-num {
            width: 20px; height: 20px; background: var(--primary); color: white; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; shrink: 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo-box">
                <div class="logo-icon">⚡</div>
                <div>
                    <h1>NetOpsWan Staging Studio</h1>
                    <p class="subtitle">Cisco Meraki MX64 Otomatik Flashlama & Müşteri Mühürleme Yazılımı</p>
                </div>
            </div>
            <div id="device-status-badge" class="badge badge-offline">
                <span id="device-dot">●</span> <span id="device-status-text">Cihaz Aranıyor...</span>
            </div>
        </header>

        <div class="grid">
            <!-- Sol Panel: Kurulum Parametreleri & Kontrol -->
            <div class="card">
                <div class="card-title">
                    <span>⚙️ Kurulum & Mühürleme Parametreleri</span>
                    <button onclick="refreshState()" class="btn btn-secondary" style="width: auto; padding: 6px 12px; font-size: 11px;">Yenile</button>
                </div>

                <div class="field">
                    <label>Müşteri Merkez Hub API URL *</label>
                    <input type="text" id="hub_url" value="https://sdwan.ariot.com.tr/api/sdwan" placeholder="https://musteri.domain.com/api/sdwan">
                    <small style="color: #6b7280; font-size: 10px; margin-top: 4px; display: block;">Cihaz açıldığında bu adrese tünel açıp kendini panele tescilleyecektir.</small>
                </div>

                <div class="field">
                    <label>Hedef USB Sürücüsü (FAT32 MBR)</label>
                    <select id="usb_select">
                        <option value="">USB Aranıyor...</option>
                    </select>
                </div>

                <div class="field">
                    <label>Algılanan Donanım Durumu</label>
                    <div id="device-desc" style="padding: 10px; background: #0c121e; border: 1px solid var(--card-border); border-radius: 10px; font-size: 12px; font-weight: 600; color: #9ca3af;">
                        Bağlantı taranıyor...
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
                    <button id="btn-flash-uboot" onclick="startFlashUboot()" class="btn btn-secondary" style="border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24;">
                        ⚡ (Opsiyonel) Stok Diag Modundan U-Boot Flashla
                    </button>
                    <button id="btn-prep-usb" onclick="startPrepUsb()" class="btn btn-primary">
                        💾 1. USB Belleği Hazırla & Mühürle
                    </button>
                    <button id="btn-full-flash" onclick="startFullFlash()" class="btn btn-success">
                        🚀 2. Uçtan Uca Tam Otomatik Flashla (Sysupgrade)
                    </button>
                </div>

                <div class="progress-box">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; margin-bottom: 6px;">
                        <span id="step-label">Durum: Bekleniyor</span>
                        <span id="percent-label">0%</span>
                    </div>
                    <div class="progress-bar-bg">
                        <div id="progress-fill" class="progress-bar-fill"></div>
                    </div>
                </div>

                <div class="guide-box">
                    <div class="guide-step">
                        <div class="step-num">1</div>
                        <div>USB belleği bilgisayarınıza takıp <strong>"USB Belleği Hazırla"</strong> butonuna basın.</div>
                    </div>
                    <div class="guide-step">
                        <div class="step-num">2</div>
                        <div>USB'yi Meraki MX64'e takın, <strong>Reset</strong> tuşuna basılı tutarak güç verin.</div>
                    </div>
                    <div class="guide-step">
                        <div class="step-num">3</div>
                        <div>LED yeşile dönünce <strong>"Tam Otomatik Flashla"</strong> butonuna basın. Cihazınız hazır!</div>
                    </div>
                </div>
            </div>

            <!-- Sağ Panel: Canlı Terminal & Log Konsolu + Yedek Arşivi -->
            <div style="display: flex; flex-direction: column; gap: 20px;">
                <div class="card" style="display: flex; flex-direction: column;">
                    <div class="card-title">
                        <span>📟 Canlı İşlem Konsolu (Real-Time Terminal)</span>
                        <button onclick="clearLogs()" class="btn btn-secondary" style="width: auto; padding: 4px 10px; font-size: 10px;">Temizle</button>
                    </div>
                    <div id="terminal" class="terminal">
                        <div><span class="log-time">00:00:00</span> <span class="log-info">Staging Studio başlatıldı. Cihaz ve USB taranıyor...</span></div>
                    </div>
                </div>

                <!-- Cihaz Yedek Arşivi (MTD / Bootloader Vault) -->
                <div class="card">
                    <div class="card-title">
                        <span>🛡️ Cihaz Yedek Arşivi (MTD0 & Boot Vault)</span>
                        <span id="backup-count-badge" class="badge" style="background: rgba(59, 130, 246, 0.15); color: var(--primary);">0 Yedek</span>
                    </div>
                    <div id="backups-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; font-size: 11px;">
                        <div style="color: var(--text-muted);">Yedekler taranıyor...</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        function updateUI(state) {
            // Update device badge
            const badge = document.getElementById('device-status-badge');
            const statusText = document.getElementById('device-status-text');
            const desc = document.getElementById('device-desc');
            
            if (state.detected_device) {
                badge.className = 'badge badge-online';
                statusText.innerText = state.detected_device.desc;
                desc.innerHTML = `<span style="color: #10b981;">✔ Bulundu:</span> ${state.detected_device.desc}`;
            } else {
                badge.className = 'badge badge-offline';
                statusText.innerText = 'Cihaz Bekleniyor (Ethernet / Diag)';
                desc.innerHTML = `<span style="color: #ef4444;">✖ Cihaz Bulunamadı.</span> Ethernet kablosunu kontrol edin.`;
            }

            // Update USB list
            const usbSelect = document.getElementById('usb_select');
            if (state.detected_usbs && state.detected_usbs.length > 0) {
                const currentVal = usbSelect.value;
                usbSelect.innerHTML = state.detected_usbs.map(u => 
                    `<option value="${u.path}" ${u.path === currentVal ? 'selected' : ''}>${u.name} (${u.path}) - ${u.free_gb} GB Boş</option>`
                ).join('');
            } else {
                usbSelect.innerHTML = `<option value="">Takılı USB Bellek Yok (/Volumes)</option>`;
            }

            // Update Progress
            document.getElementById('step-label').innerText = 'Durum: ' + state.current_step;
            document.getElementById('percent-label').innerText = state.progress + '%';
            document.getElementById('progress-fill').style.width = state.progress + '%';

            // Update Buttons
            const isBusy = state.status !== 'idle' && state.status !== 'success' && state.status !== 'error';
            document.getElementById('btn-prep-usb').disabled = isBusy;
            document.getElementById('btn-full-flash').disabled = isBusy;

            // Render Backups
            const backupBadge = document.getElementById('backup-count-badge');
            const backupsList = document.getElementById('backups-list');
            if (state.existing_backups && state.existing_backups.length > 0) {
                backupBadge.innerText = state.existing_backups.length + ' Yedek Arşivde';
                backupsList.innerHTML = state.existing_backups.map(b => `
                    <div style="padding: 6px 10px; background: #0c121e; border: 1px solid var(--card-border); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-family: 'JetBrains Mono', monospace; color: #93c5fd; font-weight: 600;">📁 ${b.name}</span>
                        <span style="color: #6b7280; font-size: 10px;">${b.size_kb} KB • ${b.date}</span>
                    </div>
                `).join('');
            } else {
                backupBadge.innerText = '0 Yedek';
                backupsList.innerHTML = `<div style="color: var(--text-muted); padding: 4px;">Henüz arşivlenmiş MTD yedeği yok.</div>`;
            }

            // Render Logs
            const terminal = document.getElementById('terminal');
            terminal.innerHTML = state.logs.map(l => 
                `<div><span class="log-time">${l.time}</span> <span class="log-${l.level}">${l.msg}</span></div>`
            ).join('');
            terminal.scrollTop = terminal.scrollHeight;
        }

        async function refreshState() {
            try {
                const res = await fetch('/api/state');
                const data = await res.json();
                updateUI(data);
            } catch (e) {
                console.error(e);
            }
        }

        async function startFlashUboot() {
            if (!confirm('UYARI: Stok Meraki Diag modundaki cihazın MTD0 boot bölümü Clayface U-Boot ile güncellenecektir. Öncesinde otomatik MTD0 yedeği alınacaktır. Onaylıyor musunuz?')) return;
            await fetch('/api/flash-uboot', { method: 'POST' });
        }

        async function startPrepUsb() {
            const usbPath = document.getElementById('usb_select').value;
            const hubUrl = document.getElementById('hub_url').value;
            if (!usbPath) {
                alert('Lütfen bir USB bellek seçiniz!');
                return;
            }
            await fetch('/api/prep-usb', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usb_path: usbPath, hub_url: hubUrl })
            });
        }

        async function startFullFlash() {
            const hubUrl = document.getElementById('hub_url').value;
            if (!confirm('Meraki MX64 cihazına kalıcı OpenWrt ve NetOps SD-WAN mühürlemesi başlatılacak. Onaylıyor musunuz?')) return;
            await fetch('/api/flash', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hub_url: hubUrl })
            });
        }

        async function clearLogs() {
            await fetch('/api/clear-logs', { method: 'POST' });
            refreshState();
        }

        setInterval(refreshState, 1500);
        refreshState();
    </script>
</body>
</html>
"""

class StagingHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/" or parsed.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode("utf-8"))
        elif parsed.path == "/api/state":
            scan_network_device()
            scan_usbs()
            scan_backups()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(STATE).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len) if content_len > 0 else b'{}'
        try:
            data = json.loads(body.decode('utf-8'))
        except:
            data = {}

        if parsed.path == "/api/prep-usb":
            usb_path = data.get("usb_path")
            hub_url = data.get("hub_url", STATE["hub_url"])
            STATE["hub_url"] = hub_url
            threading.Thread(target=self.run_usb_prep_thread, args=(usb_path, hub_url)).start()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))

        elif parsed.path == "/api/flash-uboot":
            threading.Thread(target=self.run_uboot_flash_thread).start()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))

        elif parsed.path == "/api/flash":
            hub_url = data.get("hub_url", STATE["hub_url"])
            STATE["hub_url"] = hub_url
            threading.Thread(target=self.run_flash_thread, args=(hub_url,)).start()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))

        elif parsed.path == "/api/clear-logs":
            STATE["logs"] = []
            self.send_response(200)
            self.end_headers()

    def run_uboot_flash_thread(self):
        """Clayface U-Boot Diag Modu Flashlama: Detect -> Backup -> Unlock -> Verify -> Flash U-Boot"""
        STATE["status"] = "flashing_uboot"
        STATE["progress"] = 10
        STATE["current_step"] = "Diag Modu Bağlantısı & Donanım Tespiti..."
        add_log("=== FAZ 1: Stok Meraki Diag Modu U-Boot Flashlama Başlatıldı ===", "info")

        try:
            from mx64_tool.core.telnet_client import MerakiTelnetClient
            from mx64_tool.core.detector import DeviceDetector
            from mx64_tool.core.flasher import MerakiFlasher
            from mx64_tool.core.http_server import PayloadHTTPServer

            telnet = MerakiTelnetClient("192.168.1.1", 23)
            if not telnet.connect():
                add_log("✖ Telnet (192.168.1.1:23) açılamadı. Cihazı Reset basılıyken güç verip Diag moduna alın.", "error")
                STATE["status"] = "error"
                return

            http_server = PayloadHTTPServer(PAYLOAD_DIR, port=8000)
            http_server.start()

            try:
                # 1. Donanım & SoC Revizyon Tespiti
                detector = DeviceDetector(telnet)
                info = detector.analyze()
                add_log(f"✔ Donanım Tespiti: {'A0 Revizyonu (mx64a0)' if info.is_a0_rev else 'Standart MX64 (mx64)'} | SoC Register: {info.soc_raw_val}", "success")
                STATE["progress"] = 30

                # 2. MTD0 (Bootloader) Yedeği
                STATE["current_step"] = "MTD0 Bootloader Yedeği Alınıyor..."
                flasher = MerakiFlasher(telnet, PAYLOAD_DIR, BACKUP_DIR, http_port=8000)
                flasher.backup_mtd0("192.168.1.2")
                STATE["progress"] = 50

                # 3. MTD0 Kilit Açma (insmod mtd-rw.ko)
                if info.mtd0_locked:
                    STATE["current_step"] = "MTD0 Kilidi Açılıyor (mtd-rw.ko)..."
                    flasher.unlock_mtd0("192.168.1.2")
                STATE["progress"] = 70

                # 4. Clayface U-Boot Flashlama
                STATE["current_step"] = "Clayface U-Boot Flashlanıyor..."
                flasher.flash_uboot("192.168.1.2")
                STATE["progress"] = 100
                STATE["status"] = "success"
                STATE["current_step"] = "U-Boot Başarıyla Flashlandı! Şimdi USB ile Başlatın."
                add_log("🎉 U-Boot başarıyla flashlandı! Cihazı kapatıp USB bellek takılıyken Reset ile açınız.", "success")

            finally:
                telnet.close()
                http_server.stop()

        except Exception as e:
            STATE["status"] = "error"
            add_log(f"U-Boot Flash Hatası: {e}", "error")

    def run_usb_prep_thread(self, usb_path, hub_url):
        STATE["status"] = "preparing_usb"
        STATE["progress"] = 10
        STATE["current_step"] = "USB Bellek Hazırlanıyor..."
        add_log(f"USB Hazırlama Başlatıldı: {usb_path}", "info")
        
        try:
            initramfs = PAYLOAD_DIR / "openwrt-bcm5862x-generic-meraki_mx64-initramfs-kernel.bin"
            from mx64_tool.core.usb_prep import prepare_usb_drive
            STATE["progress"] = 40
            ok = prepare_usb_drive(Path(usb_path), initramfs, hub_url)
            if ok:
                STATE["progress"] = 100
                STATE["status"] = "success"
                STATE["current_step"] = "USB Başarıyla Hazırlandı!"
                add_log("✔ USB Bellek Clayface ve NetOps SD-WAN konfigürasyonuyla mühürlendi!", "success")
            else:
                STATE["status"] = "error"
                STATE["current_step"] = "USB Yazma Hatası!"
                add_log("✖ USB hazırlanamadı. Lütfen izinleri ve FAT32 formatını kontrol edin.", "error")
        except Exception as e:
            STATE["status"] = "error"
            add_log(f"Hata: {e}", "error")

    def run_flash_thread(self, hub_url):
        STATE["status"] = "flashing_sysupgrade"
        STATE["progress"] = 20
        STATE["current_step"] = "Kalıcı Sysupgrade Flashlanıyor..."
        add_log("Kalıcı OpenWrt Sysupgrade başlatılıyor...", "info")

        try:
            flash_script = SCRIPTS_DIR / "flash_openwrt.sh"
            if not flash_script.exists():
                add_log(f"Script bulunamadı: {flash_script}", "error")
                STATE["status"] = "error"
                return

            proc = subprocess.Popen(
                ["bash", str(flash_script)],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )

            for line in proc.stdout:
                line_str = line.strip()
                if line_str:
                    add_log(line_str, "info")

            proc.wait()
            if proc.returncode == 0:
                STATE["progress"] = 100
                STATE["status"] = "success"
                STATE["current_step"] = "Tüm Kurulum Başarıyla Tamamlandı!"
                add_log("🎉 TEBRİKLER! Meraki MX64 Kalıcı OpenWrt ve NetOps SD-WAN ile ayağa kaldırıldı!", "success")
            else:
                STATE["status"] = "error"
                STATE["current_step"] = "Flashlama Hatası"
                add_log(f"İşlem hata ile sonlandı (Exit Code: {proc.returncode})", "error")

        except Exception as e:
            STATE["status"] = "error"
            add_log(f"Kritik Hata: {e}", "error")

def run_server():
    server = HTTPServer(("127.0.0.1", PORT), StagingHandler)
    url = f"http://127.0.0.1:{PORT}"
    print(f"\n=======================================================")
    print(f"🚀 NetOpsWan Meraki MX64 Staging Studio Başlatıldı!")
    print(f"🌐 Tarayıcı Arayüzü: {url}")
    print(f"=======================================================\n")
    
    # Otomatik tarayıcı aç
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSunucu kapatıldı.")

if __name__ == "__main__":
    run_server()
