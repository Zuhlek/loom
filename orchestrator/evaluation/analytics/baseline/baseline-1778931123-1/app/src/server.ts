import express, { type Express } from 'express';
import { createServer, type Server } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openDb, migrate, makeRepo, type Db, type BookmarkRepo } from './db.js';
import { bookmarksRouter } from './routes/bookmarks.js';

const here = dirname(fileURLToPath(import.meta.url));
// src/ → app/
const appRoot = resolve(here, '..');
const DEFAULT_DB_PATH = resolve(appRoot, 'bookmarks.sqlite');
const DIST_CLIENT = resolve(appRoot, 'dist/client');

export function buildApp(repo: BookmarkRepo): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/bookmarks', bookmarksRouter(repo));

  // Static UI (only if the bundle exists; tests with port: 0 / :memory:
  // also benefit from this when dist/client/ is present).
  if (existsSync(DIST_CLIENT)) {
    app.use('/static', express.static(DIST_CLIENT, { fallthrough: false }));
    app.get('/', (_req, res) => {
      res.sendFile(resolve(DIST_CLIENT, 'index.html'));
    });
  }
  return app;
}

export interface StartedServer {
  server: Server;
  close: () => Promise<void>;
}

export async function startServer(
  opts: { port?: number; dbPath?: string } = {},
): Promise<StartedServer> {
  const port = opts.port ?? 3000;
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;

  let db: Db;
  try {
    db = openDb(dbPath);
    migrate(db);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('boot failed:', err);
    throw err;
  }

  const repo = makeRepo(db);
  const app = buildApp(repo);
  const server = createServer(app);

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (err: Error) => {
      server.removeListener('listening', onListening);
      rejectListen(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });

  let closed = false;
  const close = (): Promise<void> => {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise<void>((resolveClose, rejectClose) => {
      server.close((err) => {
        try {
          db.close();
        } catch {
          // ignore
        }
        if (err) rejectClose(err);
        else resolveClose();
      });
    });
  };

  const shutdown = (): void => {
    close().catch(() => {
      /* ignore */
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return { server, close };
}

// Allow `tsx src/server.ts` to start the production server.
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer()
    .then(({ server }) => {
      const addr = server.address();
      const port =
        typeof addr === 'object' && addr ? addr.port : 3000;
      // eslint-disable-next-line no-console
      console.log(`listening on http://localhost:${port}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('failed to start server:', err);
      process.exit(1);
    });
}
