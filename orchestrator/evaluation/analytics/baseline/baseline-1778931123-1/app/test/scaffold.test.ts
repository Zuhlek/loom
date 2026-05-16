import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = resolve(__dirname, '..');

function readJson<T = unknown>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

describe('workspace scaffold (T-001)', () => {
  it('has package.json with start and test scripts', () => {
    const pkg = readJson<{ scripts?: Record<string, string> }>(
      resolve(appRoot, 'package.json')
    );
    expect(pkg.scripts?.start).toBe('tsx scripts/build-client.ts && tsx src/server.ts');
    expect(pkg.scripts?.test).toBe('vitest run');
  });

  it('declares the locked stack dependencies', () => {
    const pkg = readJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(resolve(appRoot, 'package.json'));
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const name of [
      'express',
      'better-sqlite3',
      'esbuild',
      'vitest',
      'supertest',
      'tsx',
      'typescript',
      '@types/express',
      '@types/better-sqlite3',
      '@types/node',
      '@types/supertest',
    ]) {
      expect(all, `missing ${name}`).toHaveProperty(name);
    }
  });

  it('has tsconfig.json with strict mode and ES2022', () => {
    const ts = readJson<{
      compilerOptions?: Record<string, unknown>;
      include?: string[];
    }>(resolve(appRoot, 'tsconfig.json'));
    expect(ts.compilerOptions?.strict).toBe(true);
    expect(ts.compilerOptions?.target).toBe('ES2022');
    expect(ts.include).toEqual(expect.arrayContaining(['src/**/*', 'test/**/*']));
  });

  it('has .gitignore covering node_modules, dist, sqlite files', () => {
    const gi = readFileSync(resolve(appRoot, '.gitignore'), 'utf8');
    expect(gi).toMatch(/node_modules/);
    expect(gi).toMatch(/dist/);
    expect(gi).toMatch(/\*\.sqlite/);
  });

  it('has a README.md documenting npm install/start/test', () => {
    expect(existsSync(resolve(appRoot, 'README.md'))).toBe(true);
    const r = readFileSync(resolve(appRoot, 'README.md'), 'utf8');
    expect(r).toMatch(/npm install/);
    expect(r).toMatch(/npm start/);
    expect(r).toMatch(/npm test/);
  });
});
