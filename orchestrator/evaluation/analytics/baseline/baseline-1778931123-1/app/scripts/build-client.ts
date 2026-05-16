import * as esbuild from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const srcClient = resolve(appRoot, 'src/client');
const distClient = resolve(appRoot, 'dist/client');

mkdirSync(distClient, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(srcClient, 'main.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: resolve(distClient, 'main.js'),
  sourcemap: false,
  logLevel: 'info',
});

copyFileSync(resolve(srcClient, 'index.html'), resolve(distClient, 'index.html'));
copyFileSync(resolve(srcClient, 'styles.css'), resolve(distClient, 'styles.css'));
