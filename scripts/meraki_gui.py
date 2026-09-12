#!/usr/bin/env python3
"""
NetOpsWan Meraki MX64 Universal Hardware Flasher & Provisioner GUI
Modern Web/Desktop GUI for Cisco Meraki MX64 SD-WAN Provisioning
"""

import os
import sys
import time
import json
import threading
import subprocess
import webbrowser
from pathlib import Path
from flask import Flask, render_template_string, jsonify, request

app = Flask(__name__)

# Base paths
BASE_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = BASE_DIR / "scripts"
FIRMWARE_DIR = BASE_DIR / "firmware_builder"

# Global state
logs = []
process_running = False
current_step = "Hazır"

def add_log(msg, level="info"):
    timestamp = time.strftime("[%H:%M:%S] ")
    logs.append({"time": timestamp, "msg": msg, "level": level})
    if len(logs) > 1000:
        logs.pop(0)

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NetOpsWan - Meraki MX64 Provisioning Studio</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #090d16;
            --card: #111827;
            --border: #1f2937;
            --text: #f3f4f6;
            --muted: #9ca3af;
            --primary: #3b82f6;
            --primary-hover: #2563eb;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
        body { background: var(--bg); color: var(--text); min-height: 100vh; padding: 2rem; display: flex; justify-content: center; }
        .container { max-width: 1000px; width: 100%; display: flex; flex-direction: column; gap: 1.5rem; }
        
        .header { display: flex; justify-content: space-between; align-items: center; border-b: 1px solid var(--border); padding-bottom: 1rem; }
        .header-title { display: flex; align-items: center; gap: 0.75rem; }
        .logo-badge { background: linear-gradient(135deg, #3b82f6, #8b5cf6); padding: 0.5rem 0.75rem; border-radius: 0.75rem; font-weight: 800; font-size: 1.1rem; color: #fff; }
        
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
        
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem; shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        .card-title { font-size: 1rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; color: #fff; }
        
        .form-group { display: flex; flex-direction: column; gap: 0.4rem; }
        label { font-size: 0.8rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
        input, select { background: #0b0f19; border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.75rem 1rem; color: #fff; font-size: 0.9rem; outline: none; transition: border-color 0.2s; }
        input:focus, select:focus { border-color: var(--primary); }
        
        .btn { background: var(--primary); color: #fff; border: none; padding: 0.85rem 1.5rem; border-radius: 0.6rem; font-weight: 700; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: all 0.2s; }
        .btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .btn-success { background: var(--success); }
        .btn-success:hover { background: #059669; }
        
        .steps { display: flex; flex-direction: column; gap: 0.75rem; }
        .step-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: #0b0f19; border: 1px solid var(--border); border-radius: 0.5rem; font-size: 0.85rem; }
        .step-badge { width: 24px; height: 24px; border-radius: 50%; background: var(--border); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; }
        .step-active { border-color: var(--primary); background: rgba(59, 130, 246, 0.1); }
        .step-active .step-badge { background: var(--primary); color: #fff; }
        
        .terminal { background: #050811; border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; height: 260px; overflow-y: auto; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.25rem; }
        .log-line { line-height: 1.4; word-break: break-all; }
        .log-time { color: #6b7280; }
        .log-info { color: #93c5fd; }
        .log-success { color: #34d399; font-weight: 600; }
        .log-warning { color: #fbbf24; }
        .log-danger { color: #f87171; font-weight: 600; }
        
        .status-pill { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; }
        .pill-online { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
        .pill-busy { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-title">
                <div class="logo-badge">NetOpsWan</div>
                <div>
                    <h2>Meraki MX64 Provisioning Studio</h2>
                    <p style="font-size: 0.8rem; color: var(--muted);">Cisco Meraki MX64 Otomatik Donanım Flashlama ve Kurumsal Mühürleme</p>
                </div>
            </div>
            <div id="statusPill" class="status-pill pill-online">● Sistem Hazır</div>
        </div>

        <div class="grid">
            <!-- Sol Panel: Form & Parametreler -->
            <div class="card">
                <div class="card-title">⚙️ Müşteri ve Cihaz Parametreleri</div>
                
                <div class="form-group">
                    <label>Merkez Sunucu URL (Hub Endpoint)</label>
                    <input type="text" id="serverUrl" value="https://sdwan.ariot.com.tr" placeholder="https://sdwan.domain.com">
                </div>

                <div class="form-group">
                    <label>Zero-Trust Master Secret (Cihaz-Özel Token Türetici)</label>
                    <input type="password" id="deviceKey" placeholder="Ağ yöneticinizden aldığınız gizli anahtarı girin">
                </div>

                <div class="form-group">
                    <label>Şube / Cihaz Adı (Device ID)</label>
                    <input type="text" id="deviceName" placeholder="Örn: Istanbul-Merkez, Ankara-Sube">
                </div>

                <div class="form-group">
                    <label>Mac Ethernet Portu</label>
                    <select id="iface">
                        <option value="en5">en5 (USB Ethernet Adaptörü)</option>
                        <option value="en0">en0 (Dahili Ethernet)</option>
                        <option value="en1">en1</option>
                        <option value="en6">en6</option>
                    </select>
                </div>

                <button id="startBtn" class="btn btn-success" onclick="startProvisioning()">
                    🚀 Cihaz Kimlik Doğrulamalı Flashlamayı Başlat
                </button>
            </div>

            <!-- Sağ Panel: Adımlar & Rehber -->
            <div class="card">
                <div class="card-title">📋 Otomatik Donanım İşlem Adımları</div>
                
                <div class="steps">
                    <div class="step-item" id="step1">
                        <div class="step-badge">1</div>
                        <div><strong>Tam Donanımlı İmaj Derleme:</strong> Pre-baked WireGuard + Rust Agent + Paketler</div>
                    </div>
                    <div class="step-item" id="step2">
                        <div class="step-badge">2</div>
                        <div><strong>Diag Modu & U-Boot:</strong> 192.168.1.1:23 Telnet tespiti ve MTD kilidi</div>
                    </div>
                    <div class="step-item" id="step3">
                        <div class="step-badge">3</div>
                        <div><strong>USB RAM Boot:</strong> Initramfs kernel ile geçici işletim sistemi</div>
                    </div>
                    <div class="step-item" id="step4">
                        <div class="step-badge">4</div>
                        <div><strong>Kalıcı NAND Flash:</strong> SSH Pipe ile Micron Flash'a yazım ve SSH İzolasyonu</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Terminal Canlı Log Çıktısı -->
        <div class="card">
            <div class="card-title" style="justify-content: space-between;">
                <span>📟 Canlı Donanım ve Flash Terminali</span>
                <button onclick="clearLogs()" style="background:none; border:none; color:var(--muted); font-size:0.75rem; cursor:pointer;">Temizle</button>
            </div>
            <div class="terminal" id="terminal"></div>
        </div>
    </div>

    <script>
        function fetchLogs() {
            fetch('/api/status')
                .then(res => res.json())
                .then(data => {
                    const term = document.getElementById('terminal');
                    term.innerHTML = data.logs.map(l => 
                        `<div class="log-line ${l.level === 'success' ? 'log-success' : l.level === 'danger' ? 'log-danger' : l.level === 'warning' ? 'log-warning' : 'log-info'}">
                            <span class="log-time">${l.time}</span> ${l.msg}
                        </div>`
                    ).join('');
                    term.scrollTop = term.scrollHeight;

                    const btn = document.getElementById('startBtn');
                    const pill = document.getElementById('statusPill');
                    if (data.running) {
                        btn.disabled = true;
                        btn.innerText = '⏳ İşlem Devam Ediyor...';
                        pill.className = 'status-pill pill-busy';
                        pill.innerText = '● İşleniyor (' + data.step + ')';
                    } else {
                        btn.disabled = false;
                        btn.innerText = '🚀 Otomatik Flashlama ve Mühürlemeyi Başlat';
                        pill.className = 'status-pill pill-online';
                        pill.innerText = '● Sistem Hazır';
                    }
                });
        }

        function startProvisioning() {
            const payload = {
                server_url: document.getElementById('serverUrl').value,
                device_key: document.getElementById('deviceKey').value,
                device_name: document.getElementById('deviceName').value,
                iface: document.getElementById('iface').value
            };

            fetch('/api/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            }).then(() => fetchLogs());
        }

        function clearLogs() {
            fetch('/api/clear-logs', {method: 'POST'}).then(() => fetchLogs());
        }

        setInterval(fetchLogs, 1000);
        fetchLogs();
    </script>
</body>
</html>
"""

@app.route("/")
def index():
    return render_template_string(HTML_TEMPLATE)

@app.route("/api/status")
def status():
    return jsonify({"running": process_running, "step": current_step, "logs": logs})

@app.route("/api/clear-logs", methods=["POST"])
def clear_logs():
    global logs
    logs = []
    return jsonify({"success": True})

@app.route("/api/start", methods=["POST"])
def start():
    global process_running, current_step
    if process_running:
        return jsonify({"error": "Zaten bir işlem çalışıyor"}), 400

    data = request.json or {}
    server_url = data.get("server_url", "")
    device_key = data.get("device_key", "")
    device_name = data.get("device_name", "")
    iface = data.get("iface", "en5")

    def run_worker():
        global process_running, current_step
        process_running = True
        try:
            add_log(f"🚀 Meraki MX64 Dönüştürme Başlatıldı: {device_name}", "info")
            add_log(f"🌐 Merkez Sunucu: {server_url}", "info")
            current_step = "İmaj Hazırlanıyor"

            script_path = BASE_DIR / "scripts" / "meraki_provisioner.sh"
            cmd = [
                "bash", str(script_path),
                "--server", server_url,
                "--device-key", device_key,
                "--device-name", device_name,
                "--iface", iface
            ]

            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            for line in iter(p.stdout.readline, ''):
                clean_line = line.strip()
                if clean_line:
                    if "HATA" in clean_line or "Error" in clean_line:
                        add_log(clean_line, "danger")
                    elif "TEBRİKLER" in clean_line or "[✓]" in clean_line:
                        add_log(clean_line, "success")
                    elif "LÜTFEN" in clean_line or "👉" in clean_line:
                        add_log(clean_line, "warning")
                    else:
                        add_log(clean_line, "info")

            p.wait()
            if p.returncode == 0:
                add_log("🎉 Meraki MX64 Flashlama ve Mühürleme Başarıyla Tamamlandı!", "success")
            else:
                add_log(f"✖ İşlem hata ile sonuçlandı (Kod: {p.returncode})", "danger")

        except Exception as e:
            add_log(f"Kritik Hata: {str(e)}", "danger")
        finally:
            process_running = False
            current_step = "Tamamlandı"

    threading.Thread(target=run_worker, daemon=True).start()
    return jsonify({"success": True})

if __name__ == "__main__":
    add_log("NetOpsWan Meraki MX64 Studio Başlatıldı.", "success")
    print("🌐 NetOpsWan GUI Başlatılıyor: http://127.0.0.1:5050")
    threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:5050")).start()
    app.run(host="127.0.0.1", port=5050, debug=False)
