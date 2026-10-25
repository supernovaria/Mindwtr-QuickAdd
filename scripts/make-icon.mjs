// Writes build/icon.png (256×256) for electron-builder from the same drawing
// code the tray uses. Node ≥ 22.18 runs the .ts import natively.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawIconRgba, encodePng } from '../src/main/icon.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const size = 256;
mkdirSync(resolve(root, 'build'), { recursive: true });
writeFileSync(resolve(root, 'build/icon.png'), encodePng(drawIconRgba(size), size));
console.log('wrote build/icon.png');
