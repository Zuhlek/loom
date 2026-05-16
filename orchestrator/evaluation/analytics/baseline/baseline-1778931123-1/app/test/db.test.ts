import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDb,
  migrate,
  makeRepo,
  DuplicateUrlError,
  NotFoundError,
  canonicaliseUrl,
  type BookmarkRepo,
  type Db,
} from '../src/db.js';

describe('db / repo (T-002)', () => {
  let db: Db;
  let repo: BookmarkRepo;

  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    repo = makeRepo(db);
  });

  describe('migrate', () => {
    it('is idempotent — running twice does not throw', () => {
      expect(() => migrate(db)).not.toThrow();
      expect(() => migrate(db)).not.toThrow();
    });
  });

  describe('canonicaliseUrl', () => {
    it('lowercases host and adds trailing slash on bare host', () => {
      expect(canonicaliseUrl('HTTPS://Example.com')).toBe('https://example.com/');
    });

    it('preserves a non-default path', () => {
      expect(canonicaliseUrl('https://Example.com/foo')).toBe('https://example.com/foo');
    });

    it('throws on non-http(s) protocol', () => {
      expect(() => canonicaliseUrl('ftp://x.example/')).toThrow();
    });

    it('throws on unparseable input', () => {
      expect(() => canonicaliseUrl('not-a-url')).toThrow();
      expect(() => canonicaliseUrl('')).toThrow();
    });
  });

  describe('create', () => {
    it('returns a Bookmark with id and created_at populated', () => {
      const b = repo.create({ url: 'https://a.example/', title: 'A' });
      expect(b.id).toBeGreaterThan(0);
      expect(b.url).toBe('https://a.example/');
      expect(b.title).toBe('A');
      expect(b.created_at).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('throws DuplicateUrlError on second insert of canonical-equal URL', () => {
      repo.create({ url: 'HTTPS://Example.com', title: 'Example' });
      expect(() => repo.create({ url: 'https://example.com/', title: 'Other' })).toThrow(
        DuplicateUrlError,
      );
    });
  });

  describe('list', () => {
    it('returns rows ordered by created_at DESC, id DESC', async () => {
      const a = repo.create({ url: 'https://a.example/', title: 'A' });
      await new Promise((r) => setTimeout(r, 5));
      const b = repo.create({ url: 'https://b.example/', title: 'B' });
      const rows = repo.list();
      expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    });

    it('returns [] when empty', () => {
      expect(repo.list()).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns the row when present', () => {
      const b = repo.create({ url: 'https://a.example/', title: 'A' });
      expect(repo.getById(b.id)?.url).toBe('https://a.example/');
    });

    it('returns undefined when absent', () => {
      expect(repo.getById(9999)).toBeUndefined();
    });
  });

  describe('deleteById', () => {
    it('removes the row', () => {
      const b = repo.create({ url: 'https://a.example/', title: 'A' });
      repo.deleteById(b.id);
      expect(repo.list()).toEqual([]);
    });

    it('throws NotFoundError when the id does not exist', () => {
      expect(() => repo.deleteById(9999)).toThrow(NotFoundError);
    });

    it('frees the URL for re-creation', () => {
      const b = repo.create({ url: 'https://a.example/', title: 'A' });
      repo.deleteById(b.id);
      const again = repo.create({ url: 'https://a.example/', title: 'A again' });
      expect(again.id).not.toBe(b.id);
      expect(again.title).toBe('A again');
    });
  });
});
