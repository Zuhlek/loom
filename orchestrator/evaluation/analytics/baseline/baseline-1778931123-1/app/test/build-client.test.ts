import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = resolve(__dirname, '..');
const distClient = resolve(appRoot, 'dist/client');

describe('build-client (T-005)', () => {
  beforeAll(() => {
    // Idempotent: the build script overwrites outputs. We do NOT pre-delete
    // dist/client/ — other test files (e.g. server-boot, smoke) read the same
    // directory when the suite runs in parallel.
    const result = spawnSync('npx', ['tsx', 'scripts/build-client.ts'], {
      cwd: appRoot,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `build-client exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
  }, 60_000);

  it('produces dist/client/main.js (non-empty)', () => {
    expect(existsSync(resolve(distClient, 'main.js'))).toBe(true);
    const js = readFileSync(resolve(distClient, 'main.js'), 'utf8');
    expect(js.length).toBeGreaterThan(0);
  });

  it('produces dist/client/index.html referencing the bundled script and stylesheet', () => {
    expect(existsSync(resolve(distClient, 'index.html'))).toBe(true);
    const html = readFileSync(resolve(distClient, 'index.html'), 'utf8');
    expect(html).toContain('/static/main.js');
    expect(html).toContain('/static/styles.css');
  });

  it('produces dist/client/styles.css', () => {
    expect(existsSync(resolve(distClient, 'styles.css'))).toBe(true);
  });
});
