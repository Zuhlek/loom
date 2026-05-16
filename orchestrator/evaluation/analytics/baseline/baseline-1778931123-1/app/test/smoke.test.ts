import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { startServer, type StartedServer } from '../src/server.js';

describe('smoke: persistence-across-restart (T-009)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bookmarks-smoke-'));
    dbPath = join(tmpDir, 'bookmarks.sqlite');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists a bookmark across a full server restart', async () => {
    // 1st boot: write a bookmark.
    let s: StartedServer = await startServer({ port: 0, dbPath });
    try {
      let addr = s.server.address() as AddressInfo;
      const home = await fetch(`http://127.0.0.1:${addr.port}/`);
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type') ?? '').toMatch(/text\/html/);

      const empty = await fetch(`http://127.0.0.1:${addr.port}/api/bookmarks`);
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual([]);

      const created = await fetch(`http://127.0.0.1:${addr.port}/api/bookmarks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://persist.example/', title: 'P' }),
      });
      expect(created.status).toBe(201);
    } finally {
      await s.close();
    }

    // 2nd boot: same dbPath, expect the row to still be there.
    s = await startServer({ port: 0, dbPath });
    try {
      const addr = s.server.address() as AddressInfo;
      const list = await fetch(`http://127.0.0.1:${addr.port}/api/bookmarks`);
      expect(list.status).toBe(200);
      const rows = (await list.json()) as Array<{ url: string; title: string }>;
      expect(rows.length).toBe(1);
      expect(rows[0].url).toBe('https://persist.example/');
      expect(rows[0].title).toBe('P');
    } finally {
      await s.close();
    }
  }, 30_000);

  it('binds 127.0.0.1 (loopback only)', async () => {
    const s = await startServer({ port: 0, dbPath: ':memory:' });
    try {
      const addr = s.server.address() as AddressInfo;
      expect(addr.address).toBe('127.0.0.1');
    } finally {
      await s.close();
    }
  });

  it('npm start script chains build-client.ts then server.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts.start).toBe('tsx scripts/build-client.ts && tsx src/server.ts');
  });
});
