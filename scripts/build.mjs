// Builds main, preload and renderer into out/. Used by `npm run build` and,
// with --electron-only, by scripts/dev.mjs.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** main and preload: Node/Electron CommonJS bundles with `electron` external. */
export async function buildElectron({ mode = 'production' } = {}) {
  for (const [name, entry] of [
    ['main', 'src/main/index.ts'],
    ['preload', 'src/preload/index.ts'],
  ]) {
    await build({
      configFile: false,
      root,
      mode,
      logLevel: 'warn',
      build: {
        ssr: resolve(root, entry),
        outDir: resolve(root, 'out', name),
        emptyOutDir: true,
        target: 'node22',
        minify: false,
        sourcemap: mode !== 'production',
        rolldownOptions: {
          external: ['electron', /^node:/],
          output: { format: 'cjs', entryFileNames: 'index.cjs' },
        },
      },
      ssr: { noExternal: true, target: 'node' },
    });
    console.log(`built out/${name}/index.cjs`);
  }
}

export async function buildRenderer() {
  await build({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn' });
  console.log('built out/renderer');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildElectron();
  if (!process.argv.includes('--electron-only')) await buildRenderer();
}
