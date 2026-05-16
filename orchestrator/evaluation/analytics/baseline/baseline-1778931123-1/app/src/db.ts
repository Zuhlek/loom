import Database from 'better-sqlite3';
import type { Bookmark, CreateBookmarkInput } from './types.js';

export type Db = Database.Database;

export class DuplicateUrlError extends Error {
  code = 'duplicate_url' as const;
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateUrlError';
  }
}

export class NotFoundError extends Error {
  code = 'not_found' as const;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export function openDb(filePath: string): Db {
  return new Database(filePath);
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      url         TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      created_at  TEXT    NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_url_uniq
      ON bookmarks(url);
    CREATE INDEX IF NOT EXISTS bookmarks_created_at_idx
      ON bookmarks(created_at DESC);
  `);
}

export interface BookmarkRepo {
  list(): Bookmark[];
  getById(id: number): Bookmark | undefined;
  create(input: CreateBookmarkInput): Bookmark;
  deleteById(id: number): void;
}

export function canonicaliseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  return parsed.toString();
}

interface SqliteError extends Error {
  code?: string;
}

export function makeRepo(db: Db): BookmarkRepo {
  const stmtList = db.prepare(
    'SELECT id, url, title, created_at FROM bookmarks ORDER BY created_at DESC, id DESC',
  );
  const stmtGetById = db.prepare(
    'SELECT id, url, title, created_at FROM bookmarks WHERE id = ?',
  );
  const stmtInsert = db.prepare(
    'INSERT INTO bookmarks (url, title, created_at) VALUES (?, ?, ?)',
  );
  const stmtDelete = db.prepare('DELETE FROM bookmarks WHERE id = ?');

  return {
    list(): Bookmark[] {
      return stmtList.all() as Bookmark[];
    },
    getById(id: number): Bookmark | undefined {
      return stmtGetById.get(id) as Bookmark | undefined;
    },
    create(input: CreateBookmarkInput): Bookmark {
      const canonical = canonicaliseUrl(input.url);
      const title = input.title;
      const created_at = new Date().toISOString();
      try {
        const info = stmtInsert.run(canonical, title, created_at);
        const id = Number(info.lastInsertRowid);
        return { id, url: canonical, title, created_at };
      } catch (err) {
        const e = err as SqliteError;
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new DuplicateUrlError(`URL already exists: ${canonical}`);
        }
        throw err;
      }
    },
    deleteById(id: number): void {
      const info = stmtDelete.run(id);
      if (info.changes === 0) {
        throw new NotFoundError(`bookmark not found: ${id}`);
      }
    },
  };
}
