// `npm run dev`: Vite dev server for the renderer + Electron with the built
// main/preload pointed at it. Ctrl+C (or quitting the app) stops both.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildElectron } from './build.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);

await buildElectron({ mode: 'development' });
const server = await createServer({ configFile: resolve(root, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
console.log(`renderer at ${url}`);

const electronPath = require('electron');
const child = spawn(electronPath, [root, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
const stop = async (code = 0) => {
  await server.close();
  process.exit(code);
};
child.on('exit', (code) => void stop(code ?? 0));
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
