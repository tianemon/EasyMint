#!/bin/bash
# EasyMint Icon Generation Script
# Proma 同款 SVG 模板 => 1024x1024 图标，100px 边距 + 824px 活动区 + 185px 圆角

set -e
cd "$(dirname "$0")/.."

echo "Generating EasyMint icons..."
mkdir -p assets

python3.12 -c "
from PIL import Image, ImageDraw
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

canvas = Image.new('RGBA', (w, w), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle([margin, margin, margin + inner - 1, margin + inner - 1],
                        radius=radius, fill=(255, 255, 255, 255))
canvas.paste(leaf_cropped, (margin, margin), leaf_cropped)
canvas.save('assets/icon.png')
print('icon.png generated')
"

# ICNS
mkdir -p /tmp/easymint-iconset
for s in 16 32 64 128 256 512; do
  sips -z $s $s assets/icon.png --out "/tmp/easymint-iconset/icon_${s}x${s}.png" > /dev/null 2>&1
done
for s in 32 64 256 512 1024; do
  d=$((s * 2))
  sips -z $d $d assets/icon.png --out "/tmp/easymint-iconset/icon_${s}x${s}@2x.png" > /dev/null 2>&1
done
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
