#!/bin/bash
# EasyMint Icon Generation — Proma 同款工具链
# rsvg-convert (librsvg) + sips + iconutil + ImageMagick
# 源文件: assets/icon.svg → 引用 assets/mint.png

set -e
cd "$(dirname "$0")/.."

for tool in rsvg-convert iconutil magick; do
  if ! command -v $tool &> /dev/null; then
    echo "❌ $tool not found. Install: brew install librsvg imagemagick"
    exit 1
  fi
done

echo "🎨 Generating EasyMint icons..."

# 1. SVG → 1024x1024 PNG
rsvg-convert -w 1024 -h 1024 assets/icon.svg -o assets/icon.png
echo "✅ icon.png (1024x1024) generated from SVG"

# 2. PNG → ICNS (10 Apple standard sizes)
mkdir -p /tmp/easymint.iconset
sips -z 16 16     assets/icon.png --out /tmp/easymint.iconset/icon_16x16.png      > /dev/null 2>&1
sips -z 32 32     assets/icon.png --out /tmp/easymint.iconset/icon_16x16@2x.png   > /dev/null 2>&1
sips -z 32 32     assets/icon.png --out /tmp/easymint.iconset/icon_32x32.png      > /dev/null 2>&1
sips -z 64 64     assets/icon.png --out /tmp/easymint.iconset/icon_32x32@2x.png   > /dev/null 2>&1
sips -z 128 128   assets/icon.png --out /tmp/easymint.iconset/icon_128x128.png    > /dev/null 2>&1
sips -z 256 256   assets/icon.png --out /tmp/easymint.iconset/icon_128x128@2x.png > /dev/null 2>&1
sips -z 256 256   assets/icon.png --out /tmp/easymint.iconset/icon_256x256.png    > /dev/null 2>&1
sips -z 512 512   assets/icon.png --out /tmp/easymint.iconset/icon_256x256@2x.png > /dev/null 2>&1
sips -z 512 512   assets/icon.png --out /tmp/easymint.iconset/icon_512x512.png    > /dev/null 2>&1
sips -z 1024 1024 assets/icon.png --out /tmp/easymint.iconset/icon_512x512@2x.png > /dev/null 2>&1
iconutil -c icns /tmp/easymint.iconset -o assets/icon.icns
rm -rf /tmp/easymint.iconset
echo "✅ icon.icns generated"

# 3. Windows ICO
magick assets/icon.png -define icon:auto-resize=256,128,96,64,48,32,16 assets/icon.ico
echo "✅ icon.ico generated"

echo ""
echo "All done: icon.svg → rsvg-convert → icon.png → sips/iconutil → icon.icns"
echo "                               └→ magick → icon.ico"
