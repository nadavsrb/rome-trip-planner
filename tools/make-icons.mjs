// Renders the app icon (same design as icons/icon.svg) to PNG with no dependencies.
// Usage: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CREAM = [251, 243, 228];
const SUN = [242, 193, 78];
const TOP = [201, 87, 58];
const BOTTOM = [156, 58, 32];
const COLS = [140, 198, 256, 314, 372];

const inRect = (x, y, x0, y0, w, h) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
const inArch = (x, y, cx, top, bottom, r = 18) => {
  if (x < cx - r || x > cx + r || y > bottom || y < top) return false;
  const yc = top + r;
  return y >= yc || (x - cx) ** 2 + (y - yc) ** 2 <= r * r;
};
function inRoundRect(x, y, s, r) {
  const cx = Math.min(Math.max(x, r), s - r), cy = Math.min(Math.max(y, r), s - r);
  return x >= 0 && y >= 0 && x < s && y < s && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Colour at a point in the 512-unit design space, or null for transparent.
function sample(x, y, rounded) {
  if (rounded ? !inRoundRect(x, y, 512, 112) : !inRect(x, y, 0, 0, 512, 512)) return null;
  const t = y / 512;
  let c = TOP.map((v, i) => v + (BOTTOM[i] - v) * t);
  if ((x - 380) ** 2 + (y - 132) ** 2 <= 46 * 46) c = SUN;
  const body = inRect(x, y, 88, 196, 336, 16) || inRect(x, y, 100, 212, 312, 204);
  if (body) {
    const hole = COLS.some(cx => inRect(x, y, cx - 11, 228, 22, 18) || inArch(x, y, cx, 262, 330) || inArch(x, y, cx, 346, 404));
    if (!hole) c = CREAM;
  }
  return c;
}

function render(size, rounded) {
  const S = 4; // supersamples per axis
  const px = Buffer.alloc(size * (size * 4 + 1));
  const k = 512 / size;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    px[row] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = sample((x + (sx + 0.5) / S) * k, (y + (sy + 0.5) / S) * k, rounded);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = row + 1 + x * 4;
      if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; }
      px[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  return png(size, size, px);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-192.png', render(192, true));
writeFileSync('icons/icon-512.png', render(512, true));
writeFileSync('icons/icon-maskable-512.png', render(512, false));
writeFileSync('icons/apple-touch-icon.png', render(180, false));
console.log('icons written');
