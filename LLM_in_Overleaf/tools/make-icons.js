// 零依赖生成扩展图标（16/48/128 PNG）：Overleaf 绿底 + 白色"文档卡片" + 文字线 + 琥珀色编辑点。
// 只用 Node 内置 zlib 手写 PNG，避免引入图像依赖。（改自 paper_read 的同名脚本）
import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');

// —— CRC32（PNG chunk 校验用）——
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function inRounded(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const rx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const ry = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  const dx = x - rx, dy = y - ry;
  return dx * dx + dy * dy <= r * r;
}

function drawIcon(S) {
  const buf = Buffer.alloc(S * S * 4);
  const set = (x, y, c) => {
    const i = (y * S + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
  };
  const GREEN = [19, 138, 7, 255];    // Overleaf 品牌绿
  const WHITE = [255, 255, 255, 255];
  const GRAY = [196, 210, 198, 255];
  const AMBER = [245, 158, 11, 255];

  const m = S * 0.2;
  const cardR = S * 0.1;
  const cx0 = m, cy0 = m * 0.9, cx1 = S - m, cy1 = S - m * 0.9;
  const linePad = S * 0.09;
  const lineH = Math.max(1, S * 0.055);
  const lineYs = [0.34, 0.5, 0.66].map((f) => cy0 + (cy1 - cy0) * f);
  const lineX0 = cx0 + linePad, lineX1 = cx1 - linePad;
  // 编辑点（右下角，代表"改这段"）
  const dotR = S * 0.16;
  const dotCx = cx1 - S * 0.02, dotCy = cy1 - S * 0.02;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let c = GREEN;
      if (inRounded(x, y, cx0, cy0, cx1, cy1, cardR)) {
        c = WHITE;
        for (let li = 0; li < lineYs.length; li++) {
          const ly = lineYs[li];
          const w = li === 1 ? (lineX1 - lineX0) * 0.7 : lineX1 - lineX0; // 中间一行短一点（像选中改动）
          if (y >= ly - lineH / 2 && y <= ly + lineH / 2 && x >= lineX0 && x <= lineX0 + w) {
            c = li === 1 ? AMBER : GRAY; // 中间那行是"被修改"的琥珀色
          }
        }
      }
      const dx = x - dotCx, dy = y - dotCy;
      if (dx * dx + dy * dy <= dotR * dotR) c = AMBER;
      set(x, y, c);
    }
  }
  return encodePNG(S, S, buf);
}

for (const size of [16, 48, 128]) {
  const png = drawIcon(size);
  const file = path.join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`✓ ${file} (${png.length} bytes)`);
}
