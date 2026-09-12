#!/usr/bin/env bash
# ==============================================================================
# NetOpsWan - Cisco Meraki MX64 (ARMv7 musl) Rust Cross-Compiler Script
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="armv7-unknown-linux-musleabi"
OUTPUT_DIR="$WORKSPACE_DIR/dist/meraki-armv7"

echo "=========================================================="
echo "🛠️  Meraki MX64 Rust Agent Derleme Başlatılıyor..."
echo "🎯 Hedef Mimari: $TARGET"
echo "📂 Workspace: $WORKSPACE_DIR"
echo "=========================================================="

mkdir -p "$OUTPUT_DIR"

# Docker ile Cross Derleme (Host makineden bağımsız temiz C toolchain)
if command -v cross &> /dev/null; then
    echo "📦 'cross' aracı kullanılarak derleniyor..."
    cd "$WORKSPACE_DIR"
    cross build --target "$TARGET" --release --bin netops-agent
    cp "target/$TARGET/release/netops-agent" "$OUTPUT_DIR/netops-agent"
else
    echo "🐳 Docker doğrudan çalıştırılarak derleniyor..."
    docker run --rm -v "$WORKSPACE_DIR":/workspace -w /workspace \
        ghcr.io/cross-rs/armv7-unknown-linux-musleabihf:edge \
        cargo build --target "$TARGET" --release --bin netops-agent
    cp "$WORKSPACE_DIR/target/$TARGET/release/netops-agent" "$OUTPUT_DIR/netops-agent"
fi

echo "=========================================================="
echo "✅ Derleme Başarıyla Tamamlandı!"
echo "📦 Üretilen Binary: $OUTPUT_DIR/netops-agent"
ls -lh "$OUTPUT_DIR/netops-agent"
echo "=========================================================="
