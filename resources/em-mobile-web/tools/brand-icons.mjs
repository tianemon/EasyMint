// 从 App 的品牌图标生成主屏安装图标（180 / 192 / 512）。
//
// 为什么要这一步：`assets/brand/appicon.png` 四角是透明的圆角，而 iOS 的
// apple-touch-icon 会自己再切一次圆角——透明角在 iOS 上会被填成黑色。
// 这里把圆角外的透明区域按「最近的边缘像素」扩散填充成同一底色，得到满版图，
// 再交给系统切角，边缘才不会出现一圈黑边。
//
// 零第三方依赖：解码/缩放/编码都用 Node 内置 zlib 手写，构建机不需要 macOS 的 sips。
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = path.join(root, '..', '..', '..', 'EasyMintMobile', 'assets', 'brand', 'appicon.png');
const outDir = path.join(root, 'public');
mkdirSync(outDir, { recursive: true });

// ── PNG 解码（8bit RGB/RGBA，够用） ─────────────────────────────
function decodePng(buffer) {
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buffer.length) {
    const len = buffer.readUInt32BE(off);
    const type = buffer.toString('ascii', off + 4, off + 8);
    const data = buffer.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error('只支持 8bit RGB/RGBA');
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, ch, data: out };
}

// ── PNG 编码（RGBA，filter 0） ─────────────────────────────────
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
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 透明角按最近的不透明像素扩散填充 ───────────────────────────
function flattenCorners({ width, height, ch, data }) {
  const rgba = Buffer.alloc(width * height * 4);
  const filled = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const alpha = ch === 4 ? data[i * 4 + 3] : 255;
    rgba[i * 4] = data[i * ch];
    rgba[i * 4 + 1] = data[i * ch + 1];
    rgba[i * 4 + 2] = data[i * ch + 2];
    rgba[i * 4 + 3] = 255;
    filled[i] = alpha > 8 ? 1 : 0;
  }
  // 多轮扩散：每轮把未填充像素染成邻居均值，直到填满（圆角带很窄，几轮就够）
  for (let round = 0; round < 2048; round += 1) {
    let changed = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (!filled[j]) continue;
          r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n += 1;
        }
        if (!n) continue;
        rgba[i * 4] = Math.round(r / n);
        rgba[i * 4 + 1] = Math.round(g / n);
        rgba[i * 4 + 2] = Math.round(b / n);
        filled[i] = 2;
        changed += 1;
      }
    }
    for (let i = 0; i < filled.length; i += 1) if (filled[i] === 2) filled[i] = 1;
    if (!changed) break;
  }
  return { width, height, data: rgba };
}

// ── 双线性缩放 ─────────────────────────────────────────────────
function resize({ width, height, data }, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sy = (y + 0.5) * (height / size) - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < size; x += 1) {
      const sx = (x + 0.5) * (width / size) - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = sx - x0;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const p00 = data[(y0 * width + x0) * 4 + c];
        const p10 = data[(y0 * width + x1) * 4 + c];
        const p01 = data[(y1 * width + x0) * 4 + c];
        const p11 = data[(y1 * width + x1) * 4 + c];
        out[o + c] = Math.round(
          p00 * (1 - wx) * (1 - wy) + p10 * wx * (1 - wy) + p01 * (1 - wx) * wy + p11 * wx * wy,
        );
      }
      out[o + 3] = 255;
    }
  }
  return { width: size, height: size, data: out };
}

/**
 * maskable：Android 会把主屏图标裁成圆形/圆角，安全区只有直径 80%。
 * 不声明 maskable 时 Chrome 会自己垫一层白底再把整张图缩小一圈——那正是
 * 「安卓主屏图标比 App 小一圈」的来源。这里把整张图缩到 78% 铺在同色底上：
 * mark 落在安全区内，四角是纯背景色，被裁掉也看不出接缝。
 */
function maskable(icon, size, scale = 0.78) {
  const canvas = Buffer.alloc(size * size * 4);
  const [r, g, b] = [icon.data[0], icon.data[1], icon.data[2]];
  for (let i = 0; i < size * size; i += 1) {
    canvas[i * 4] = r; canvas[i * 4 + 1] = g; canvas[i * 4 + 2] = b; canvas[i * 4 + 3] = 255;
  }
  const inner = Math.round(size * scale);
  const art = resize(icon, inner);
  const offset = Math.floor((size - inner) / 2);
  for (let y = 0; y < inner; y += 1) {
    for (let x = 0; x < inner; x += 1) {
      const src = (y * inner + x) * 4;
      const dst = ((y + offset) * size + (x + offset)) * 4;
      canvas[dst] = art.data[src];
      canvas[dst + 1] = art.data[src + 1];
      canvas[dst + 2] = art.data[src + 2];
      canvas[dst + 3] = 255;
    }
  }
  return canvas;
}

const source = decodePng(readFileSync(SOURCE));
const flat = flattenCorners(source);
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  const scaled = resize(flat, size);
  writeFileSync(path.join(outDir, name), encodePng(size, size, scaled.data));
  console.log(`${name} ${size}x${size}`);
}
for (const [name, size] of [['maskable-192.png', 192], ['maskable-512.png', 512]]) {
  writeFileSync(path.join(outDir, name), encodePng(size, size, maskable(flat, size)));
  console.log(`${name} ${size}x${size} (maskable)`);
}
