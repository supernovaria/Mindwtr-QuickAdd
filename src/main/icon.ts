// App/tray icon drawn in code (blue rounded square with a white plus), so the
// repo needs no binary assets. `scripts/make-icon.mjs` writes the same pixels to
// build/icon.png for electron-builder.
import { deflateSync } from 'node:zlib';

const BLUE = [37, 99, 235] as const; // #2563eb, Mindwtr's primary

/** RGBA pixels, row-major, `size`×`size`. */
export function drawIconRgba(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const radius = size * 0.22;
  const bar = Math.max(1, size * 0.13);
  const arm = size * 0.27;
  const c = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 4x supersampling for smooth edges
      let inside = 0;
      let plus = 0;
      for (let sy = 0; sy < 2; sy += 1) {
        for (let sx = 0; sx < 2; sx += 1) {
          const fx = x + (sx + 0.5) / 2;
          const fy = y + (sy + 0.5) / 2;
          const dx = Math.max(radius - fx, 0, fx - (size - radius));
          const dy = Math.max(radius - fy, 0, fy - (size - radius));
          if (dx * dx + dy * dy <= radius * radius) inside += 1;
          const h = Math.abs(fy - c) <= bar / 2 && Math.abs(fx - c) <= arm;
          const v = Math.abs(fx - c) <= bar / 2 && Math.abs(fy - c) <= arm;
          if (h || v) plus += 1;
        }
      }
      const i = (y * size + x) * 4;
      const p = plus / 4;
      px[i] = Math.round(BLUE[0] * (1 - p) + 255 * p);
      px[i + 1] = Math.round(BLUE[1] * (1 - p) + 255 * p);
      px[i + 2] = Math.round(BLUE[2] * (1 - p) + 255 * p);
      px[i + 3] = Math.round((inside / 4) * 255);
    }
  }
  return px;
}

/** Same pixels in BGRA order, as `nativeImage.createFromBitmap` expects. */
export function drawIconBgra(size: number): Buffer {
  const rgba = drawIconRgba(size);
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 2];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i];
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

/** Encodes RGBA pixels as a PNG file. */
export function encodePng(rgba: Uint8Array, size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
