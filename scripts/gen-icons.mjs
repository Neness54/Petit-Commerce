// Génère les icônes de l'application (PNG + ICO) sans dépendance externe.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c;
    });
  }
  let c = -1;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Dessin : panier de courses stylisé sur fond vert
function draw(size) {
  const img = Buffer.alloc(size * size * 4);
  const s = size / 128; // on dessine dans une grille 128

  const px = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (Math.floor(y) * size + Math.floor(x)) * 4;
    // alpha blending
    const na = a / 255, oa = img[i + 3] / 255, out = na + oa * (1 - na);
    if (out === 0) return;
    img[i] = Math.round((r * na + img[i] * oa * (1 - na)) / out);
    img[i + 1] = Math.round((g * na + img[i + 1] * oa * (1 - na)) / out);
    img[i + 2] = Math.round((b * na + img[i + 2] * oa * (1 - na)) / out);
    img[i + 3] = Math.round(out * 255);
  };

  const roundRect = (x0, y0, x1, y1, rad, col) => {
    const [r, g, b, a = 255] = col;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const dx = Math.max(x0 + rad - x, x - (x1 - rad), 0);
        const dy = Math.max(y0 + rad - y, y - (y1 - rad), 0);
        if (dx * dx + dy * dy <= rad * rad) px(x * s, y * s, r, g, b, a);
      }
  };

  // Fond : dégradé vert arrondi
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = Math.max(18 - x / s, x / s - 110, 0);
      const dy = Math.max(18 - y / s, y / s - 110, 0);
      if (dx * dx + dy * dy > 18 * 18) continue;
      const t = y / size;
      px(x, y, Math.round(22 + 10 * t), Math.round(140 - 30 * t), Math.round(80 - 15 * t));
    }

  // Panier : corps trapézoïdal blanc
  for (let y = 58; y < 104; y++) {
    const t = (y - 58) / 46;
    const half = 34 - 8 * t;
    for (let x = 64 - half; x < 64 + half; x++) px(x * s, y * s, 255, 255, 255);
  }
  // Bordure du panier
  roundRect(26, 52, 102, 62, 5, [255, 255, 255]);
  // Anse (arc)
  for (let y = 26; y < 54; y++)
    for (let x = 34; x < 94; x++) {
      const dx = x - 64, dy = y - 54;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 24 && d <= 31 && y <= 54) px(x * s, y * s, 255, 255, 255);
    }
  // Rayures dans le panier (creux)
  for (let y = 68; y < 96; y++) {
    if (y % 12 >= 7) continue;
    const t = (y - 58) / 46;
    const half = 34 - 8 * t - 8;
    for (let x = 64 - half; x < 64 + half; x++) px(x * s, y * s, 22, 130, 78);
  }

  return img;
}

mkdirSync("src-tauri/icons", { recursive: true });
const sizes = [32, 128, 256];
const pngs = {};
for (const sz of sizes) pngs[sz] = encodePNG(sz, draw(sz));
writeFileSync("src-tauri/icons/32x32.png", pngs[32]);
writeFileSync("src-tauri/icons/128x128.png", pngs[128]);
writeFileSync("src-tauri/icons/128x128@2x.png", pngs[256]);
writeFileSync("src-tauri/icons/icon.png", pngs[256]);

// ICO : contient les PNG 16,32,48,256 (format PNG-in-ICO)
function icoSize(sz) {
  return sz === 256 ? pngs[256] : encodePNG(sz, draw(sz));
}
const entries = [16, 32, 48, 256].map((sz) => ({ sz, data: icoSize(sz) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = 6 + 16 * entries.length;
const dir = [];
for (const e of entries) {
  const d = Buffer.alloc(16);
  d[0] = e.sz === 256 ? 0 : e.sz;
  d[1] = e.sz === 256 ? 0 : e.sz;
  d.writeUInt16LE(1, 4); // planes
  d.writeUInt16LE(32, 6); // bpp
  d.writeUInt32LE(e.data.length, 8);
  d.writeUInt32LE(offset, 12);
  offset += e.data.length;
  dir.push(d);
}
writeFileSync("src-tauri/icons/icon.ico", Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]));
console.log("Icônes générées : 32x32, 128x128, 128x128@2x, icon.png, icon.ico");
