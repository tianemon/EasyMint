// 用 Node 内置 zlib 手写 PNG 编码生成安装图标，零第三方依赖。
// 生成 192 / 512 / 180 三个圆角方形、品牌绿底 + 白色「M」字形的 PNG 到 public/。
// 产物连同脚本一并留在仓库，便于离线构建、测试与审阅。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'public');
mkdirSync(outDir, { recursive: true });

// ---- 最小 PNG 编码器（8bit RGBA、每行 filter 0） ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([len, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 图形：圆角方形绿底 + 简洁白色 M ----
const BRAND = [0x16, 0xa3, 0x4a];       // #16a34a
const CORNER = [0x0f, 0x7a, 0x37];      // 圆角外的深绿，保证 iOS 不吃透明黑角
const WHITE = [0xff, 0xff, 0xff];

/** 圆角矩形 SDF：把坐标夹到 [r, size-r] 内矩形，再看离角心的距离。 */
function inRoundedSquare(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 归一化坐标里的 M：两条竖笔 + 中间 V 形斜笔。 */
function inM(nx, ny) {
  const top = 0.30;
  const bottom = 0.72;
  const halfStroke = 0.042;
  if (ny < top || ny > bottom) return false;
  if (nx >= 0.26 - halfStroke && nx <= 0.26 + halfStroke) return true; // 左竖
  if (nx >= 0.74 - halfStroke && nx <= 0.74 + halfStroke) return true; // 右竖
  if (ny <= 0.57) {
    const t = (ny - top) / (0.57 - top); // 0 → 1
    const leftX = 0.26 + t * 0.24;      // 0.26 → 0.50
    const rightX = 0.74 - t * 0.24;     // 0.74 → 0.50
    if (Math.abs(nx - leftX) <= halfStroke || Math.abs(nx - rightX) <= halfStroke) return true;
  }
  return false;
}

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const px = 1 / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = inRoundedSquare(x + 0.5, y + 0.5, size, r);
      const base = inside ? BRAND : CORNER;
      // M 用 3x3 超采样做轻量抗锯齿
      let hits = 0;
      if (inside) {
        for (let sy = 0; sy < 3; sy += 1) {
          for (let sx = 0; sx < 3; sx += 1) {
            const nx = (x + (sx + 0.5) / 3) * px;
            const ny = (y + (sy + 0.5) / 3) * px;
            if (inM(nx, ny)) hits += 1;
          }
        }
      }
      const cover = hits / 9;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) rgba[i + c] = Math.round(base[c] * (1 - cover) + WHITE[c] * cover);
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];
for (const [name, size] of targets) {
  writeFileSync(path.join(outDir, name), draw(size));
  console.log(`generated public/${name} (${size}x${size})`);
}
