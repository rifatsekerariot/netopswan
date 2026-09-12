#!/usr/bin/env python3
"""
NetOpsWan Batch Provisioning Tool
CSV veya JSON dosyasındaki 100'lerce şube için tek seferde toplu firmware paketleri üretir.
"""

import os
import sys
import subprocess
import argparse
import csv

def generate_batch(csv_file, server_url, profile, ca_cert, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    
    if not os.path.exists(csv_file):
        print(f"Hata: {csv_file} bulunamadı!")
        sys.exit(1)
        
    print(f"🚀 Toplu Firmware Üretimi Başlatılıyor: {csv_file}")
    print(f"🌐 Merkez Sunucu: {server_url}")
    print(f"📦 Donanım: {profile}")
    print("-" * 60)
    
    count = 0
    with open(csv_file, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            device_name = row.get('name') or row.get('device_name')
            device_key = row.get('key') or row.get('device_key')
            
            if not device_name or not device_key:
                continue
                
            out_file = os.path.join(output_dir, f"{device_name}-{profile}.tar.gz")
            
            cmd = [
                "./build-firmware.sh",
                "--profile", profile,
                "--server", server_url,
                "--device-name", device_name,
                "--device-key", device_key,
                "--output", out_file
            ]
            
            if ca_cert and os.path.exists(ca_cert):
                cmd.extend(["--ca-cert", ca_cert])
                
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0:
                print(f"[✓] Başarılı: {device_name} -> {out_file}")
                count += 1
            else:
                print(f"[✗] Hata ({device_name}): {res.stderr}")
                
    print("-" * 60)
    print(f"🎉 Toplam {count} adet şube için firmware paketi üretildi!")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="NetOpsWan Batch Firmware Generator")
    parser.add_argument("--csv", required=True, help="Şube listesi CSV dosyası (name, key sütunları)")
    parser.add_argument("--server", required=True, help="Merkez SD-WAN Sunucu Adresi")
    parser.add_argument("--profile", default="meraki-mx64", help="Donanım profili (meraki-mx64, rpi-4, x86-64)")
    parser.add_argument("--ca-cert", default="", help="Kök CA sertifika yolu (opsiyonel)")
    parser.add_argument("--outdir", default="./batch_outputs", help="Çıktı klasörü")
    
    args = parser.parse_args()
    generate_batch(args.csv, args.server, args.profile, args.ca_cert, args.outdir)
