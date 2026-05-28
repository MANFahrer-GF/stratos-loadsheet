// Generates assets/icon-light.png and assets/icon-dark.png — a simple
// "loadsheet rows" glyph (three stacked bars) on a rounded square.
// Pure Node (zlib only), no image deps, so it runs anywhere.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SIZE = 128;
const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(here, "..", "assets");

const crcTable = (() => {
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
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function png(rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Monochrome "sheet with lines" glyph on a TRANSPARENT background — matches the
// outline style of the other sidebar icons and looks clean in the selected
// state (no filled square block).
function render({ fg }) {
  const buf = Buffer.alloc(SIZE * SIZE * 4); // zero-filled = fully transparent
  // Document outline
  const OX = 40, OY = 22, W = 48, H = 84, t = 6;
  const inRect = (x, y) => x >= OX && x < OX + W && y >= OY && y < OY + H;
  const onBorder = (x, y) =>
    inRect(x, y) && (x < OX + t || x >= OX + W - t || y < OY + t || y >= OY + H - t);
  // Three content lines inside the sheet
  const lineX0 = OX + 13, lineX1 = OX + W - 13;
  const lines = [
    { y0: 42, y1: 48 },
    { y0: 60, y1: 66 },
    { y0: 78, y1: 84 },
  ];
  const onLine = (x, y) =>
    x >= lineX0 && x <= lineX1 && lines.some((l) => y >= l.y0 && y <= l.y1);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (onBorder(x, y) || onLine(x, y)) {
        const i = (y * SIZE + x) * 4;
        buf[i] = fg[0];
        buf[i + 1] = fg[1];
        buf[i + 2] = fg[2];
        buf[i + 3] = 255;
      }
    }
  }
  return buf;
}

mkdirSync(assetsDir, { recursive: true });
// icon_light = used on LIGHT theme → dark glyph on transparent
writeFileSync(resolve(assetsDir, "icon-light.png"), png(render({ fg: [51, 65, 85] })));
// icon_dark = used on DARK theme → light glyph on transparent
writeFileSync(resolve(assetsDir, "icon-dark.png"), png(render({ fg: [226, 232, 240] })));
console.log("wrote icon-light.png + icon-dark.png to", assetsDir);
