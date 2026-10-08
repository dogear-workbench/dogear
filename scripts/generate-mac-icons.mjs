import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function extractLargestPngFrame(icoPath) {
  const buf = readFileSync(icoPath);
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const w = buf[o] || 256;
    const size = buf.readUInt32LE(o + 8);
    const off = buf.readUInt32LE(o + 12);
    const isPng = buf[off] === 0x89 && buf[off + 1] === 0x50;
    if (isPng && (!best || w > best.w)) best = { w, png: buf.subarray(off, off + size) };
  }
  if (!best) throw new Error(`no embedded PNG frame in ${icoPath}`);
  return best.png;
}

function decodePng(pngBuf) {
  const png = PNG.sync.read(pngBuf);
  if (png.data.length !== png.width * png.height * 4) throw new Error('unexpected non-RGBA png data');
  return { rgba: png.data, width: png.width, height: png.height };
}

function resizeBilinear(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c];
        const p01 = src[(y0 * sw + x1) * 4 + c];
        const p10 = src[(y1 * sw + x0) * 4 + c];
        const p11 = src[(y1 * sw + x1) * 4 + c];
        const top = p00 + (p01 - p00) * wx;
        const bottom = p10 + (p11 - p10) * wx;
        dst[(y * dw + x) * 4 + c] = Math.round(top + (bottom - top) * wy);
      }
    }
  }
  return dst;
}

function encodePng(rgba, width, height) {
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  return PNG.sync.write(png);
}

function buildIcns(pngBySize) {
  const entries = [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const chunks = [];
  let total = 8;
  for (const [type, size] of entries) {
    const payload = pngBySize.get(size);
    chunks.push(Buffer.from(type, 'ascii'), Buffer.alloc(4), payload);
    chunks[chunks.length - 2].writeUInt32BE(payload.length + 8, 0);
    total += 8 + payload.length;
  }
  const icns = Buffer.concat([Buffer.from('icns', 'ascii'), Buffer.alloc(4), ...chunks]);
  icns.writeUInt32BE(total, 4);
  return icns;
}

const icoPath = path.join(ROOT, 'build', 'icon.ico');
const traySource = path.join(ROOT, 'assets', 'dogear-tray-template.svg');
const { rgba, width, height } = decodePng(extractLargestPngFrame(icoPath));
if (width !== 256 || height !== 256) throw new Error(`expected 256x256 source frame, got ${width}x${height}`);

const pngBySize = new Map();
for (const size of [16, 32, 64, 128, 256, 512]) {
  const scaled = size === width ? rgba : resizeBilinear(rgba, width, height, size, size);
  pngBySize.set(size, encodePng(scaled, size, size));
}

const icnsPath = path.join(ROOT, 'build', 'icon.icns');
writeFileSync(icnsPath, buildIcns(pngBySize));

const tray = await sharp(readFileSync(traySource)).resize(32, 32, { fit: 'contain' }).png().toBuffer();
const trayPath = path.join(ROOT, 'build', 'icon-tray.png');
writeFileSync(trayPath, tray);

console.log(`  ✓ ${path.relative(ROOT, icnsPath)}（128/256/512 + @2x 32/64/512）`);
console.log(`  ✓ ${path.relative(ROOT, trayPath)}（透明背景线稿，template image）`);
