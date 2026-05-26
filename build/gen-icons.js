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

// Draw a rounded rectangle with "CM" text for the app icon.
function drawCmIcon(size) {
  // Red background
  const bgR = 0xE2, bgG = 0x44, bgB = 0x5C;
  // White text
  const fgR = 255, fgG = 255, fgB = 255;
  const radius = size * 0.18; // corner radius
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;

  // 5x7 pixel font for C and M (scalable via cell size)
  const FONT_C = [
    ' ### ',
    '#   #',
    '#    ',
    '#    ',
    '#    ',
    '#   #',
    ' ### '
  ];
  const FONT_M = [
    '#   #',
    '## ##',
    '# # #',
    '# # #',
    '#   #',
    '#   #',
    '#   #'
  ];

  // Calculate cell size and positioning
  const cellW = Math.floor(size / 12);  // each pixel in the font = cellW real pixels
  const cellH = Math.floor(size / 10);
  const letterW = 5 * cellW;
  const letterH = 7 * cellH;
  const gap = Math.floor(size * 0.06);
  const totalW = letterW * 2 + gap;
  const offX = Math.floor((size - totalW) / 2);
  const offY = Math.floor((size - letterH) / 2);

  // Check if a pixel is inside the rounded rect
  function inRoundedRect(x, y) {
    // Distance from edge for anti-aliasing
    const margin = 0.5;
    if (x < radius) {
      if (y < radius) {
        const d = Math.sqrt((radius - x - 0.5) ** 2 + (radius - y - 0.5) ** 2);
        if (d > radius + margin) return 0;
        if (d > radius - margin) return (radius + margin - d) / (2 * margin);
        return 1;
      }
      if (y > size - radius - 1) {
        const d = Math.sqrt((radius - x - 0.5) ** 2 + (y + 0.5 - (size - radius)) ** 2);
        if (d > radius + margin) return 0;
        if (d > radius - margin) return (radius + margin - d) / (2 * margin);
        return 1;
      }
    }
    if (x > size - radius - 1) {
      if (y < radius) {
        const d = Math.sqrt((x + 0.5 - (size - radius)) ** 2 + (radius - y - 0.5) ** 2);
        if (d > radius + margin) return 0;
        if (d > radius - margin) return (radius + margin - d) / (2 * margin);
        return 1;
      }
      if (y > size - radius - 1) {
        const d = Math.sqrt((x + 0.5 - (size - radius)) ** 2 + (y + 0.5 - (size - radius)) ** 2);
        if (d > radius + margin) return 0;
        if (d > radius - margin) return (radius + margin - d) / (2 * margin);
        return 1;
      }
    }
    return 1;
  }

  // Check if a pixel is part of the CM text
  function inText(x, y) {
    // Check C
    const cx = x - offX;
    const cy = y - offY;
    if (cx >= 0 && cx < letterW && cy >= 0 && cy < letterH) {
      const col = Math.floor(cx / cellW);
      const row = Math.floor(cy / cellH);
      if (col < 5 && row < 7 && FONT_C[row][col] === '#') return true;
    }
    // Check M
    const mx = x - offX - letterW - gap;
    const my = y - offY;
    if (mx >= 0 && mx < letterW && my >= 0 && my < letterH) {
      const col = Math.floor(mx / cellW);
      const row = Math.floor(my / cellH);
      if (col < 5 && row < 7 && FONT_M[row][col] === '#') return true;
    }
    return false;
  }

  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const a = inRoundedRect(x, y);
      if (a <= 0) {
        raw[p++] = 0; raw[p++] = 0; raw[p++] = 0; raw[p++] = 0;
      } else if (inText(x, y)) {
        raw[p++] = fgR; raw[p++] = fgG; raw[p++] = fgB; raw[p++] = Math.round(a * 255);
      } else {
        raw[p++] = bgR; raw[p++] = bgG; raw[p++] = bgB; raw[p++] = Math.round(a * 255);
      }
    }
  }
  return raw;
}

// Tray icon: colored circle with a small white "C" in the center.
function drawTrayIcon(size, hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;
  const raw = Buffer.alloc(size * (size * 4 + 1));

  // Tiny C glyph for tray (3x5 at size 16, 5x7 at size 32)
  const TINY_C = size <= 16 ? [
    ' ##',
    '#  ',
    '#  ',
    '#  ',
    ' ##'
  ] : [
    ' ### ',
    '#   #',
    '#    ',
    '#    ',
    '#    ',
    '#   #',
    ' ### '
  ];

  const cellW = size <= 16 ? 2 : 2;
  const cellH = size <= 16 ? 2 : 2;
  const glyphW = TINY_C[0].length * cellW;
  const glyphH = TINY_C.length * cellH;
  const gx = Math.floor((size - glyphW) / 2);
  const gy = Math.floor((size - glyphH) / 2);

  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let alpha = 0;
      if (dist <= radius - 0.5) alpha = 255;
      else if (dist < radius + 0.5) alpha = Math.round((radius + 0.5 - dist) * 255);

      if (alpha === 0) {
        raw[p++] = 0; raw[p++] = 0; raw[p++] = 0; raw[p++] = 0;
      } else {
        // Check if this pixel is part of the C glyph
        const lx = x - gx;
        const ly = y - gy;
        let isText = false;
        if (lx >= 0 && lx < glyphW && ly >= 0 && ly < glyphH) {
          const col = Math.floor(lx / cellW);
          const row = Math.floor(ly / cellH);
          if (row < TINY_C.length && col < TINY_C[0].length && TINY_C[row][col] === '#') isText = true;
        }
        if (isText) {
          raw[p++] = 255; raw[p++] = 255; raw[p++] = 255; raw[p++] = alpha;
        } else {
          raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = alpha;
        }
      }
    }
  }
  return raw;
}

function encodePng(size, rawPixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(rawPixels);
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

// Tray icons: colored circles with a white "C" inside.
const colors = {
  'tray-green': '#00C875',
  'tray-gray': '#5A6378',
  'tray-red': '#E2445C'
};

for (const [name, hex] of Object.entries(colors)) {
  fs.writeFileSync(path.join(iconsDir, `${name}.png`), encodePng(32, drawTrayIcon(32, hex)));
  fs.writeFileSync(path.join(iconsDir, `${name}@16.png`), encodePng(16, drawTrayIcon(16, hex)));
}

// App icon: red rounded rect with white "CM" text.
const ico = encodeIco([
  { size: 16, data: encodePng(16, drawCmIcon(16)) },
  { size: 32, data: encodePng(32, drawCmIcon(32)) },
  { size: 48, data: encodePng(48, drawCmIcon(48)) },
  { size: 256, data: encodePng(256, drawCmIcon(256)) }
]);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
fs.writeFileSync(path.join(__dirname, 'icon.png'), encodePng(256, drawCmIcon(256)));

console.log('Icons generated in', iconsDir, 'and build/icon.ico');
