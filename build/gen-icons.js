// Generates tray icons (green/gray/red) and the app icon, with no external deps.
// Pure Node: hand-rolled PNG encoder + a PNG-in-ICO wrapper (valid on Windows Vista+).
// Run once: `node build/gen-icons.js`.

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Array(256);
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

// Draw a filled antialiased circle of `hex` color on a transparent square of `size`.
function drawCircle(size, hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;
  const raw = Buffer.alloc(size * (size * 4 + 1)); // +1 filter byte per row
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // simple 1px feather for antialiasing
      let alpha = 0;
      if (dist <= radius - 0.5) alpha = 255;
      else if (dist < radius + 0.5) alpha = Math.round((radius + 0.5 - dist) * 255);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = alpha;
    }
  }
  return raw;
}

function encodePng(size, hex) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(drawCircle(size, hex));
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Wrap PNGs into an ICO (PNG-in-ICO format).
function encodeIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const bodies = [];
  pngs.forEach((png, i) => {
    const base = i * 16;
    const dim = png.size >= 256 ? 0 : png.size;
    dir[base] = dim; // width (0 = 256)
    dir[base + 1] = dim; // height
    dir[base + 2] = 0; // palette
    dir[base + 3] = 0; // reserved
    dir.writeUInt16LE(1, base + 4); // color planes
    dir.writeUInt16LE(32, base + 6); // bpp
    dir.writeUInt32LE(png.data.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += png.data.length;
    bodies.push(png.data);
  });
  return Buffer.concat([header, dir, ...bodies]);
}

const iconsDir = path.join(__dirname, '..', 'src', 'renderer', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const colors = {
  'tray-green': '#00C875',
  'tray-gray': '#5A6378',
  'tray-red': '#E2445C'
};

for (const [name, hex] of Object.entries(colors)) {
  // 32px main + 16px for crisp small rendering, both written; tray uses the 32px.
  fs.writeFileSync(path.join(iconsDir, `${name}.png`), encodePng(32, hex));
  fs.writeFileSync(path.join(iconsDir, `${name}@16.png`), encodePng(16, hex));
}

// App icon: blue circle, multiple sizes packed into an ICO.
const blue = '#0073EA';
const ico = encodeIco([
  { size: 16, data: encodePng(16, blue) },
  { size: 32, data: encodePng(32, blue) },
  { size: 48, data: encodePng(48, blue) },
  { size: 256, data: encodePng(256, blue) }
]);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
fs.writeFileSync(path.join(__dirname, 'icon.png'), encodePng(256, blue));

console.log('Icons generated in', iconsDir, 'and build/icon.ico');
