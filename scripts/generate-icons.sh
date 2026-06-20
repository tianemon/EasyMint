#!/bin/bash
# EasyMint Icon Generation Script
# Proma 同款 SVG 模板 => 1024x1024 图标，100px 边距 + 824px 活动区 + 185px 圆角

set -e
cd "$(dirname "$0")/.."

echo "Generating EasyMint icons..."
mkdir -p assets

python3.12 -c "
from PIL import Image
import os

os.makedirs('assets', exist_ok=True)

orig = Image.open('assets/mint.png').convert('RGBA' if os.path.exists('assets/mint.png') else None)
if orig is None:
    print('ERROR: assets/mint.png not found. Place source file first.')
    exit(1)

w = 1024
margin = 100
inner = w - margin * 2  # 824
radius = 185

leaf_size = int(inner * 1.05)
leaf = orig.resize((leaf_size, leaf_size), Image.LANCZOS)
l = (leaf_size - inner) // 2
t = (leaf_size - inner) // 2
leaf_cropped = leaf.crop((l, t, l + inner, t + inner))

# 纯白正方形，零透明，避免 macOS 26 灰底
canvas = Image.new('RGBA', (w, w), (255, 255, 255, 255))
canvas.paste(leaf_cropped, (margin, margin), leaf_cropped)
canvas.save('assets/icon.png')
print('icon.png generated')
"

# ICNS — 严格对齐 Apple 标准尺寸（16/32/128/256/512 pt + @2x）
mkdir -p /tmp/easymint-iconset
sips -z 16 16     assets/icon.png --out /tmp/easymint-iconset/icon_16x16.png      > /dev/null 2>&1
sips -z 32 32     assets/icon.png --out /tmp/easymint-iconset/icon_16x16@2x.png   > /dev/null 2>&1
sips -z 32 32     assets/icon.png --out /tmp/easymint-iconset/icon_32x32.png      > /dev/null 2>&1
sips -z 64 64     assets/icon.png --out /tmp/easymint-iconset/icon_32x32@2x.png   > /dev/null 2>&1
sips -z 128 128   assets/icon.png --out /tmp/easymint-iconset/icon_128x128.png    > /dev/null 2>&1
sips -z 256 256   assets/icon.png --out /tmp/easymint-iconset/icon_128x128@2x.png > /dev/null 2>&1
sips -z 256 256   assets/icon.png --out /tmp/easymint-iconset/icon_256x256.png    > /dev/null 2>&1
sips -z 512 512   assets/icon.png --out /tmp/easymint-iconset/icon_256x256@2x.png > /dev/null 2>&1
sips -z 512 512   assets/icon.png --out /tmp/easymint-iconset/icon_512x512.png    > /dev/null 2>&1
sips -z 1024 1024 assets/icon.png --out /tmp/easymint-iconset/icon_512x512@2x.png > /dev/null 2>&1
iconutil -c icns /tmp/easymint-iconset -o assets/icon.icns
rm -rf /tmp/easymint-iconset
echo "icon.icns generated"

# ICO
python3.12 -c "
from PIL import Image
img = Image.open('assets/icon.png')
img.save('assets/icon.ico', format='ICO', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])
"
echo "icon.ico generated"

echo "Done: icon.png, icon.icns, icon.ico"
