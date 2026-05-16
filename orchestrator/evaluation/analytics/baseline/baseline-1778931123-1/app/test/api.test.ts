import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../src/server.js';
import { openDb, migrate, makeRepo } from '../src/db.js';

function makeApp(): Express {
  const db = openDb(':memory:');
  migrate(db);
  return buildApp(makeRepo(db));
}

describe('API router (T-003)', () => {
  let app: Express;

  beforeEach(() => {
    app = makeApp();
  });

  describe('GET /api/bookmarks', () => {
    it('returns [] when empty', async () => {
      const res = await request(app).get('/api/bookmarks');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('does not emit Access-Control-* headers (single-origin)', async () => {
      const res = await request(app).get('/api/bookmarks');
      for (const k of Object.keys(res.headers)) {
        expect(k.toLowerCase().startsWith('access-control-')).toBe(false);
      }
    });
  });

  describe('POST /api/bookmarks', () => {
    it('creates and returns 201 with the persisted bookmark', async () => {
      const res = await request(app)
        .post('/api/bookmarks')
        .send({ url: 'https://a.example/', title: 'A' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.url).toBe('https://a.example/');
      expect(res.body.title).toBe('A');
      expect(res.body.created_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('subsequent GET returns the new row at the top', async () => {
      await request(app).post('/api/bookmarks').send({ url: 'https://a.example/', title: 'A' });
      await new Promise((r) => setTimeout(r, 5));
      await request(app).post('/api/bookmarks').send({ url: 'https://b.example/', title: 'B' });
      const res = await request(app).get('/api/bookmarks');
      expect(res.status).toBe(200);
      expect(res.body.map((b: { url: string }) => b.url)).toEqual([
        'https://b.example/',
        'https://a.example/',
      ]);
    });

    it('409 duplicate_url on canonical-equal repeat', async () => {
      await request(app).post('/api/bookmarks').send({ url: 'HTTPS://Example.com', title: 'X' });
      const res = await request(app)
        .post('/api/bookmarks')
        .send({ url: 'https://example.com/', title: 'Other' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('duplicate_url');
      expect(res.body.error.field).toBe('url');
      expect(typeof res.body.error.message).toBe('string');
    });

    it('400 validation when url is empty string', async () => {
      const res = await request(app).post('/api/bookmarks').send({ url: '', title: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
      expect(res.body.error.field).toBe('url');
    });

    it('400 validation when url is unparseable', async () => {
      const res = await request(app)
        .post('/api/bookmarks')
        .send({ url: 'not-a-url', title: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
      expect(res.body.error.field).toBe('url');
    });

    it('400 validation when url protocol is not http(s)', async () => {
      const res = await request(app)
        .post('/api/bookmarks')
        .send({ url: 'ftp://x.example/', title: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
      expect(res.body.error.field).toBe('url');
    });

    it('400 validation when title is empty/whitespace', async () => {
      const res = await request(app)
        .post('/api/bookmarks')
        .send({ url: 'https://a.example/', title: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
      expect(res.body.error.field).toBe('title');
    });

    it('400 validation when body is not an object with the right shape', async () => {
      const res = await request(app)
        .post('/api/bookmarks')
        .send({ url: 123, title: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    });
  });

  describe('DELETE /api/bookmarks/:id', () => {
    it('204 on existing id and the row is gone afterwards', async () => {
      const created = await request(app)
        .post('/api/bookmarks')
        .send({ url: 'https://a.example/', title: 'A' });
      const del = await request(app).delete(`/api/bookmarks/${created.body.id}`);
      expect(del.status).toBe(204);
      const list = await request(app).get('/api/bookmarks');
      expect(list.body).toEqual([]);
    });

    it('404 not_found when id does not exist', async () => {
      const res = await request(app).delete('/api/bookmarks/9999');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('400 validation on non-integer id', async () => {
      const res = await request(app).delete('/api/bookmarks/abc');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    });

    it('allows re-saving the same URL after delete', async () => {
      const created = await request(app)
        .post('/api/bookmarks')
        .send({ url: 'https://a.example/', title: 'A' });
      await request(app).delete(`/api/bookmarks/${created.body.id}`);
      const again = await request(app)
        .post('/api/bookmarks')
        .send({ url: 'https://a.example/', title: 'A again' });
      expect(again.status).toBe(201);
      expect(again.body.title).toBe('A again');
    });
  });
});
