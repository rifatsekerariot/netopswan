#!/usr/bin/env bash
# NetOpsWan - Meraki MX64 Staging Studio Başlatıcı (Mac / Linux)

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================================="
echo "⚡ NetOpsWan Meraki MX64 Staging Studio Başlatılıyor..."
echo "=========================================================="

python3 "$DIR/studio.py"
