import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const source = path.join(root, 'assets', 'dogear-icon-final.svg');
const traySource = path.join(root, 'assets', 'dogear-tray-template.svg');
const build = path.join(root, 'build');
const app = path.join(root, 'app');
const pngSource = path.join(build, 'dogear-icon-source.png');

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const faviconSizes = [16, 32, 48, 64, 128, 256];
const icnsSizes = [16, 32, 64, 128, 256, 512];

function pngToIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  const payloads = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    payloads.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...payloads]);
}

function buildIcns(pngBySize) {
  const entries = [
    ['ic07', 128], ['ic08', 256], ['ic09', 512],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ];
  const chunks = [];
  let total = 8;
  for (const [type, size] of entries) {
    const payload = pngBySize.get(size);
    const chunk = Buffer.alloc(8);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(payload.length + 8, 4);
    chunks.push(chunk, payload);
    total += chunk.length + payload.length;
  }
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

const sourceSvg = fs.readFileSync(source);
const rendered = await sharp(sourceSvg).resize(1024, 1024).png().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const rgba = rendered.data;
const renderedPng = await sharp(rgba, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();
fs.writeFileSync(pngSource, renderedPng);

const renderPng = async (size, raw = rgba) => sharp(raw, { raw: { width: 1024, height: 1024, channels: 4 } }).resize(size, size, { fit: 'fill' }).png().toBuffer();
const icoImages = [];
for (const size of icoSizes) icoImages.push({ size, data: await renderPng(size) });
fs.writeFileSync(path.join(build, 'icon.ico'), pngToIco(icoImages));

const faviconImages = [];
for (const size of faviconSizes) faviconImages.push({ size, data: await renderPng(size) });
fs.writeFileSync(path.join(app, 'favicon.ico'), pngToIco(faviconImages));

const pngBySize = new Map();
for (const size of icnsSizes) pngBySize.set(size, await renderPng(size));
fs.writeFileSync(path.join(build, 'icon.icns'), buildIcns(pngBySize));

const traySvg = fs.readFileSync(traySource);
const tray = await sharp(traySvg)
  // Keep this a real template image: transparent background and black alpha mask.
  .resize(32, 32, { fit: 'contain' })
  .png()
  .toBuffer();
fs.writeFileSync(path.join(build, 'icon-tray.png'), tray);

console.log('Generated: build/icon.ico, app/favicon.ico, build/icon.icns, build/icon-tray.png');
console.log('Source preview: build/dogear-icon-source.png');
