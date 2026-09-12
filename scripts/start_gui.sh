#!/usr/bin/env bash
# ==============================================================================
# NetOpsWan Meraki MX64 Provisioning Studio GUI Başlatıcı
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 NetOpsWan Meraki MX64 GUI Studio Başlatılıyor..."
python3 "${SCRIPT_DIR}/meraki_gui.py"
