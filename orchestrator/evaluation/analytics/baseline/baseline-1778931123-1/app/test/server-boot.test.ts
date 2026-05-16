import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type StartedServer } from '../src/server.js';
import type { AddressInfo } from 'node:net';

describe('startServer (T-004)', () => {
  let started: StartedServer | undefined;

  afterEach(async () => {
    if (started) {
      await started.close();
      started = undefined;
    }
  });

  it('binds 127.0.0.1 on an ephemeral port', async () => {
    started = await startServer({ port: 0, dbPath: ':memory:' });
    const addr = started.server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.port).toBeGreaterThan(0);
  });

  it('GET / returns 200 with HTML content', async () => {
    started = await startServer({ port: 0, dbPath: ':memory:' });
    const addr = started.server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toMatch(/<html/i);
    expect(html).toContain('/static/main.js');
  });

  it('GET /api/bookmarks returns 200 []', async () => {
    started = await startServer({ port: 0, dbPath: ':memory:' });
    const addr = started.server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/bookmarks`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('GET /static/main.js returns 200', async () => {
    started = await startServer({ port: 0, dbPath: ':memory:' });
    const addr = started.server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/static/main.js`);
    expect(res.status).toBe(200);
  });

  it('close() shuts the server down', async () => {
    const local = await startServer({ port: 0, dbPath: ':memory:' });
    await local.close();
    expect(local.server.listening).toBe(false);
  });
});
