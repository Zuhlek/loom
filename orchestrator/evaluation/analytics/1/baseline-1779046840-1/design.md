---
project: baseline-1779046840-1
phase: design
created: 2026-05-17T21:50:00Z
---

# Design — baseline-1779046840-1

Technical structure for the local-only Bookmarks app. User-facing
behaviour lives in `spec.md` `## User stories` (US-001…US-004); this
document specifies how the system realises those stories.

## System shape

Single Node process serving both API and UI from one Express origin on
`http://localhost:3000`. Three internal modules, one process, one
on-disk SQLite file.

```
.loom/baseline-1779046840-1/app/
├── package.json              scripts: start, build, test, dev
├── tsconfig.json             strict TS, shared by server + client
├── esbuild.config.mjs        client bundling config
├── .gitignore                node_modules, dist, bookmarks.db
├── bookmarks.db              SQLite file, created at boot
├── src/
│   ├── server/
│   │   ├── index.ts          server entry — boots Express, wires routes, starts listener
│   │   ├── db.ts             better-sqlite3 wrapper + schema init + statements
│   │   ├── routes.ts         REST handlers for /api/bookmarks
│   │   └── static.ts         static-file middleware mounting dist/client + index.html
│   └── client/
│       ├── index.html        single page; loads /static/app.js
│       ├── styles.css        plain CSS
│       ├── main.ts           entry — wires DOM, calls api.ts, renders list
│       ├── api.ts            fetch wrappers for /api/bookmarks endpoints
│       └── dom.ts            pure render helpers (build <li>, empty state, error nodes)
├── dist/
│   └── client/               esbuild output: app.js (+ copied index.html, styles.css)
└── test/
    ├── api.test.ts           Vitest specs for the REST surface (supertest against Express app)
    └── db.test.ts            Vitest specs for db.ts duplicate / delete semantics
```

### Components and ownership

| Component | Owns | Boundary |
| --- | --- | --- |
| `server/index.ts` | Process lifecycle, Express app composition, port binding | Imports `db`, `routes`, `static`; exported `createApp()` so tests can mount without `listen()` |
| `server/db.ts` | SQLite connection, schema migration on boot, prepared statements, duplicate-detection at SQL level | Sole module that imports `better-sqlite3`; exports typed functions only |
| `server/routes.ts` | HTTP contract for `/api/bookmarks`, request validation, error→status mapping | Imports `db`; no direct SQL |
| `server/static.ts` | Serving `dist/client/` and the SPA `index.html` | Reads from disk under `dist/client/`; no DB access |
| `client/main.ts` | DOM bootstrap, event wiring, list rendering loop | Imports `api`, `dom`; only entry point that touches `window` and live DOM nodes |
| `client/api.ts` | `fetch` calls, JSON parsing, error shape normalisation | No DOM access; returns typed results / typed errors |
| `client/dom.ts` | Pure render helpers (DOM construction, no fetches) | No `fetch`; pure functions of input data |

The server and client share types via a small `src/shared/types.ts`
file imported by both bundles.

## Interfaces

### REST API (server)

All routes are mounted under `/api/bookmarks`. JSON in, JSON out.
Content-Type `application/json; charset=utf-8` for non-empty bodies.

| Method | Path | Body | 2xx response | Errors |
| --- | --- | --- | --- | --- |
| `GET` | `/api/bookmarks` | — | `200` `{ bookmarks: Bookmark[] }` ordered newest-first | — |
| `POST` | `/api/bookmarks` | `{ title: string; url: string }` | `201` `{ bookmark: Bookmark }` | `400` validation; `409` duplicate URL |
| `DELETE` | `/api/bookmarks/:id` | — | `204` no content | `404` not found |

Error body shape (single shape across the surface):

```ts
{ error: { code: 'validation' | 'duplicate' | 'not_found'; message: string; field?: 'title' | 'url' } }
```

### Server module signatures

```ts
// src/shared/types.ts
export interface Bookmark {
  id: number;
  title: string;
  url: string;
  createdAt: string; // ISO-8601, UTC
}

export type ApiError =
  | { code: 'validation'; message: string; field?: 'title' | 'url' }
  | { code: 'duplicate';  message: string }
  | { code: 'not_found';  message: string };

// src/server/db.ts
export interface DbHandle {
  list(): Bookmark[];
  insert(input: { title: string; url: string }): Bookmark; // throws DuplicateUrlError on UNIQUE conflict
  remove(id: number): boolean; // true if a row was deleted, false otherwise
  close(): void;
}
export function openDb(filePath: string): DbHandle;
export class DuplicateUrlError extends Error {}

// src/server/index.ts
export function createApp(db: DbHandle, staticRoot: string): import('express').Express;
// main() at bottom calls openDb(), createApp(), app.listen(3000)
```

### Client module signatures

```ts
// src/client/api.ts
export async function listBookmarks(): Promise<Bookmark[]>;
export async function createBookmark(input: { title: string; url: string }): Promise<Bookmark>;
export async function deleteBookmark(id: number): Promise<void>;
// Each rejects with an ApiClientError carrying the parsed ApiError body.

// src/client/dom.ts
export function renderList(target: HTMLElement, items: Bookmark[]): void;
export function renderEmptyState(target: HTMLElement): void;
export function renderFieldError(form: HTMLFormElement, field: 'title' | 'url' | 'form', message: string): void;
export function clearFieldErrors(form: HTMLFormElement): void;
```

## Data model

### SQLite schema

One table, one index for newest-first ordering (covered by `id DESC`
since `id` is monotonic — no separate `created_at` index required).

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  url        TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

Notes:
- `url UNIQUE` enforces Spec constraint #6 at storage layer.
- `created_at` is an ISO-8601 string in UTC (SQLite has no native
  timestamp type; ISO strings sort lexicographically as time).
- Newest-first ordering uses `ORDER BY id DESC` — `AUTOINCREMENT`
  guarantees monotonic IDs, so this is stable even within the same
  millisecond.
- Schema initialisation runs unconditionally at boot via the
  `CREATE TABLE IF NOT EXISTS` form. No migrations system; greenfield.

### In-memory shapes

`Bookmark` (above) is the wire shape, the storage shape (after column
mapping), and the client shape. `db.ts` is the only module that maps
between SQL row columns (`snake_case`) and the TS shape (`camelCase`).

### Filesystem state

- `bookmarks.db` — created at `path.join(__dirname, 'bookmarks.db')`
  on first boot, persists across restarts.
- `dist/client/` — esbuild output: `app.js`, `index.html`, `styles.css`.
- No other persistent state.

## Integration points

None. The seed forbids:
- network calls beyond localhost (Spec constraint #5);
- third-party services, telemetry, analytics (out of scope);
- background workers, PWAs, service workers (Spec constraint #7).

`better-sqlite3` and `express` are the only runtime third-party
dependencies. `esbuild`, `typescript`, `vitest`, `supertest`,
`@types/*` are dev-only.

## State and error handling

### Server states

The server is effectively stateless per request; the only stateful
resource is the open `better-sqlite3` Database handle. Process states:

```
boot → openDb (create schema if missing) → createApp → listen(3000) → serving
                                                                        ↓ SIGINT/SIGTERM
                                                                       db.close() → exit 0
```

On boot failure (port in use, DB file unwritable) the process logs the
error to stderr and exits non-zero.

### Server error mapping

| Failure | HTTP status | Error code |
| --- | --- | --- |
| Missing/empty title or url, malformed url | `400` | `validation` (with `field`) |
| `UNIQUE` constraint violation on `url` | `409` | `duplicate` |
| `DELETE` of a non-existent id | `404` | `not_found` |
| Anything else (unexpected throw) | `500` | `internal` — logged, surfaced to client as a generic message |

URL validation uses the WHATWG `URL` constructor: a string is a valid
URL iff `new URL(input)` does not throw AND the resulting protocol is
`http:` or `https:`. Title validation: non-empty after trim, length
≤ 2048. URL length ≤ 2048.

### Client states

The page has three concurrent UI regions, each with its own state:

1. **Save form**
   - `idle` → user types → `submitting` (on submit) → `idle` (on 201) or `error` (on 400/409).
   - Field-level error nodes render under each input; a form-level node
     captures the 409 duplicate message under the URL field.
2. **List**
   - `loading` (during initial `GET`) → `populated` (≥ 1 row) | `empty`
     (0 rows after a successful fetch) | `error` (network/5xx).
   - On successful POST: optimistic prepend then replaced by the server's
     returned row (simplest correctness path: append the returned row,
     no rollback logic needed because the POST result is authoritative).
   - On successful DELETE: remove the row from the in-memory list and
     re-render.
3. **Per-row delete control**
   - Idle → `deleting` (disabled while in flight) → removed-from-DOM on
     success, or restored + inline non-fatal banner on `404`
     ("This bookmark was already removed.").

Errors never reload the page. All transitions are driven by `main.ts`
calling `api.ts` and dispatching `dom.ts` renderers.

### Acceptance-criteria → handler mapping

| Story / AC | Handler |
| --- | --- |
| US-001 AC1, AC2 | `POST /api/bookmarks` + client prepend on 201 |
| US-001 AC3 | `409 duplicate` → inline error under URL field |
| US-001 AC4 | `400 validation` with `field` → inline error under that field; client also runs `URL`/non-empty checks before submit to short-circuit obvious cases |
| US-002 AC1 | `GET /api/bookmarks` ordered by `id DESC`; rendered on page load |
| US-002 AC2 | `dom.renderList` emits title + URL + delete button per row |
| US-002 AC3 | `dom.renderEmptyState` rendered when the array is empty |
| US-003 AC1, AC2 | Each row's title is an `<a target="_blank" rel="noopener noreferrer">` |
| US-004 AC1, AC2 | `DELETE /api/bookmarks/:id` + client splice-and-rerender on 204 |
| US-004 AC3 | `404 not_found` → non-fatal banner, row removed from local list anyway |

## Constraints

Inherited from `spec.md` `## Constraints` (1–7), restated here only
where they pin a structural choice:

- **Workspace.** All files under `.loom/baseline-1779046840-1/app/`.
  The layout above is the only directory tree this design creates.
- **One process, one origin.** `express.static('dist/client')` mounts
  the built bundle under `/` (with `/api/*` taking precedence). No
  separate dev server, no CORS configuration.
- **Stack pinned.** Express 4.x, `better-sqlite3` 11.x, `esbuild` 0.25.x,
  TypeScript 5.x, Vitest 2.x, Node ≥ 20 (the harness's default). No
  framework on the client.
- **Performance.** Synchronous `better-sqlite3` calls are acceptable
  given single-user laptop scale. No connection pooling, no async DB
  layer.
- **Security.** `target="_blank"` links use `rel="noopener noreferrer"`.
  No CSRF protection needed (no auth, no cross-origin surface). Input
  is rejected, not sanitised — the only place URLs/titles render as DOM
  is via `textContent` / `href` attribute, never `innerHTML`.

## Architecture decisions

### ADR-001: One Express process serves API and built client bundle

- **Context.** Spec constraint #3 requires `http://localhost:3000` to
  serve both the API and the UI from the same origin. The frontend is
  vanilla TS bundled by esbuild (constraint #4). Spec constraint #7
  rules out service workers and PWA setup.
- **Decision.** Express mounts `/api/*` routes first and falls through
  to `express.static('dist/client')` for everything else. `index.html`
  is served at `/`. `npm start` runs `npm run build` as a pre-step so
  the bundle exists before `listen()`.
- **Rationale.** Single origin, single process, single port — exactly
  what the spec asks for. Pre-build on start keeps the run-command
  surface to one verb.
- **Alternatives.**
  - *Vite or webpack dev server with proxy.* Rejected: introduces a
    second process and CORS surface, both explicitly excluded by
    constraints #3 and #5.
  - *Inline the JS into `index.html` at build time.* Rejected: still
    needs esbuild, complicates debugging, no benefit at this scale.

### ADR-002: SQLite `UNIQUE(url)` is the authoritative duplicate check

- **Context.** Spec constraint #6 mandates DB-level URL uniqueness.
  Q02 resolved duplicates as reject-with-inline-error.
- **Decision.** Schema declares `url TEXT NOT NULL UNIQUE`. The
  `insert()` function in `db.ts` catches the `SQLITE_CONSTRAINT_UNIQUE`
  error and throws `DuplicateUrlError`, which `routes.ts` maps to a
  `409` response with the `duplicate` error code. No pre-check
  `SELECT` — the unique constraint is the source of truth.
- **Rationale.** A pre-check `SELECT` followed by `INSERT` is a TOCTOU
  race even in single-user code; the constraint makes the duplicate
  case atomic. It also satisfies spec constraint #6 literally.
- **Alternatives.**
  - *Application-level pre-check.* Rejected: race-prone, redundant
    once the constraint exists, contradicts constraint #6.
  - *`INSERT OR IGNORE` and report success without insert.* Rejected:
    Q02 explicitly chose reject-with-error over silent merge/allow.

### ADR-003: Newest-first ordering via `ORDER BY id DESC`

- **Context.** Q05 chose newest-first only. The schema has both `id`
  (`AUTOINCREMENT`) and `created_at` (ISO-8601 string).
- **Decision.** The list query is `SELECT … FROM bookmarks ORDER BY id DESC`.
- **Rationale.** `AUTOINCREMENT` guarantees strictly monotonic IDs, so
  ordering by `id DESC` matches insertion order without depending on
  millisecond resolution or clock monotonicity. The `created_at`
  column is still useful for display, but is not the sort key.
- **Alternatives.**
  - *`ORDER BY created_at DESC`.* Rejected: two rows inserted in the
    same millisecond would tie; `id` is naturally unique and free.
  - *Drop `created_at` entirely.* Rejected: it is cheap, has display
    value, and gives a stable wire shape for future read-only consumers.

### ADR-004: REST shape under `/api/bookmarks`, JSON only

- **Context.** Four CRUD-like operations (less the U — Q04 immutable),
  consumed exclusively by one local client.
- **Decision.** Three routes: `GET /api/bookmarks`, `POST /api/bookmarks`,
  `DELETE /api/bookmarks/:id`. JSON request and response bodies. Single
  uniform error shape `{ error: { code, message, field? } }`.
- **Rationale.** Matches the four scoped features with the smallest
  REST surface. The `/api/*` prefix keeps the static fallthrough
  unambiguous in `static.ts`. One error shape means the client has one
  parse path.
- **Alternatives.**
  - *RPC-style `POST /api/save`, `POST /api/delete`.* Rejected: no
    benefit at this scale, loses HTTP-status semantics for 404/409.
  - *GraphQL.* Rejected: spec constraint #4 pins the stack; adding a
    GraphQL layer would be an unrequested substitution.

### ADR-005: `createApp(db, staticRoot)` factory, separate from `listen()`

- **Context.** Vitest + supertest needs an Express handle without
  binding to a port. The server also needs a real `listen()` for
  `npm start`.
- **Decision.** `src/server/index.ts` exports `createApp(db, staticRoot)`
  which returns the configured Express instance. A `main()` function
  at the bottom (gated by `import.meta.url === ...` or a simple
  `require.main === module` check after compilation) opens the DB,
  builds the app, and calls `listen(3000)`.
- **Rationale.** Tests can pass an in-memory `:memory:` SQLite DB and
  hit routes via supertest without touching the network. Production
  path remains a single `npm start`.
- **Alternatives.**
  - *Test against the running server on `localhost:3000`.* Rejected:
    requires port management, flakier, slower.
  - *Mock the DB in tests.* Rejected: `:memory:` SQLite gives real
    schema enforcement (UNIQUE constraint exercised) without I/O.

### ADR-006: `npm start` runs the build as a pre-step

- **Context.** Two-command surface (`npm start`, `npm test`) per spec.
  esbuild bundling must happen before the server serves `dist/client/`.
- **Decision.** `package.json` scripts:
  - `build`: runs esbuild for the client + `tsc --noEmit` for the
    server (server is compiled on the fly via `tsx` at start, or
    pre-compiled — see below).
  - `start`: `npm run build && node --enable-source-maps dist/server/index.js`.
  - `test`: `vitest run`.
  - `dev` (convenience, not required by spec): `tsx watch src/server/index.ts`.

  Server TypeScript is compiled via `tsc` to `dist/server/` as part of
  `build`, so `start` runs the JS output. This avoids a `tsx`/`ts-node`
  dependency at start time.
- **Rationale.** One command boots the app from a clean checkout
  (after `npm install`). The build step is idempotent.
- **Alternatives.**
  - *`tsx` to run server TS directly.* Rejected: adds a runtime
    dependency where `tsc` already exists; keeps the start path to a
    single Node invocation.
  - *Separate `npm run build` required before `npm start`.* Rejected:
    spec wants one-command start.

## Alternatives considered

Whole-design alternatives not tied to a single decision:

- **Two-process architecture (Vite dev server + Express API).**
  Rejected: violates Spec constraint #3 (one origin) and constraint #5
  (no extra network surface). Also doubles the `npm` script surface.
- **In-memory store with periodic JSON dump instead of SQLite.**
  Rejected: Spec constraint #4 pins SQLite via `better-sqlite3`, and
  constraint #6 pins DB-level uniqueness — both impossible without
  SQLite.
- **Server-side rendering (Express renders HTML, no client bundle).**
  Rejected: Spec constraint #4 pins a bundled vanilla-TS client.
  Acceptance criteria US-001 AC2 and US-004 AC2 also require updates
  without a manual page reload, which is awkward without a client
  bundle.
- **Monorepo split of `server/` and `client/` as separate packages.**
  Rejected: four-feature scope does not justify the workspace overhead;
  one `package.json` is simpler and matches the spec's "small surface"
  mandate.

## Open ambiguity

None. The stack is fully pinned by Spec constraint #4, the workspace
by constraint #1, the persistence shape by constraint #6, and the
feature set by US-001…US-004. The decisions above resolve every
structural choice the Spec phase deferred to Design.
