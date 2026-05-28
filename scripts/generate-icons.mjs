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

function render({ bg, fg }) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const radius = 24;
  const inCorner = (x, y) => {
    const cx = x < radius ? radius : x >= SIZE - radius ? SIZE - radius - 1 : x;
    const cy = y < radius ? radius : y >= SIZE - radius ? SIZE - radius - 1 : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  // three "loadsheet" bars
  const bars = [
    { y0: 40, y1: 54 },
    { y0: 62, y1: 76 },
    { y0: 84, y1: 98 },
  ];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (!inCorner(x, y)) {
        buf[i + 3] = 0; // transparent outside rounded square
        continue;
      }
      const onBar = bars.some((b) => y >= b.y0 && y <= b.y1 && x >= 28 && x <= 100);
      const c = onBar ? fg : bg;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      buf[i + 3] = 255;
    }
  }
  return buf;
}

mkdirSync(assetsDir, { recursive: true });
// icon_light = used on LIGHT theme → dark navy glyph
writeFileSync(
  resolve(assetsDir, "icon-light.png"),
  png(render({ bg: [30, 41, 59], fg: [226, 232, 240] })),
);
// icon_dark = used on DARK theme → light slate glyph
writeFileSync(
  resolve(assetsDir, "icon-dark.png"),
  png(render({ bg: [226, 232, 240], fg: [30, 41, 59] })),
);
console.log("wrote icon-light.png + icon-dark.png to", assetsDir);
