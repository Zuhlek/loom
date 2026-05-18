---
project: baseline-1779088265-1
phase: design
created: 2026-05-18
---

# Design — baseline-1779088265-1 (Bookmarks)

Technical structure for the local-only Bookmarks app. User-facing behaviour (US-001..US-004) lives in `spec.md`; this document specifies *how* the system realises those stories.

## System shape

Single Node process. Three internal layers, each owning one concern, communicating in-process via direct function calls (no event bus, no IPC).

```
.loom/baseline-1779088265-1/app/
├── package.json                # scripts: start, test, build:client
├── package-lock.json
├── tsconfig.json               # one root config; targets ES2022, Node16 modules
├── src/
│   ├── server/
│   │   ├── index.ts            # entrypoint: wires db + app, listens on :3000
│   │   ├── app.ts              # Express app factory (no .listen); exported for tests
│   │   ├── routes.ts           # HTTP routes -> repository calls
│   │   ├── db.ts               # better-sqlite3 handle + migration runner
│   │   └── bookmarks-repo.ts   # data access: insert / list / delete
│   ├── client/
│   │   ├── main.ts             # entry: wires form + list; bundled by esbuild
│   │   ├── api.ts              # fetch wrappers over JSON routes
│   │   ├── render.ts           # DOM rendering for list + empty state
│   │   └── form.ts             # save-form validation + submit handling
│   └── shared/
│       └── types.ts            # Bookmark, CreateBookmarkInput, ApiError
├── public/
│   ├── index.html              # static shell loaded at GET /
│   ├── styles.css              # plain CSS, prefers-color-scheme honoured
│   └── bundle.js               # esbuild output of src/client/main.ts (built artifact)
├── test/
│   ├── repo.test.ts            # bookmarks-repo against in-memory sqlite
│   ├── routes.test.ts          # supertest against app factory
│   └── client-render.test.ts   # jsdom DOM rendering tests
└── data/
    └── bookmarks.db            # SQLite file; created on first boot
```

**Components and ownership:**

| Component | Owns | Does NOT own |
| --- | --- | --- |
| `server/index.ts` | Process lifecycle, port binding, db file path resolution. | HTTP handlers, SQL. |
| `server/app.ts` | Express app construction, middleware wiring (JSON parser, static serving from `public/`), error handler. | Direct DB calls; route logic. |
| `server/routes.ts` | URL-to-repository mapping, request validation, response shape. | SQL strings, schema. |
| `server/bookmarks-repo.ts` | All SQL. Returns plain objects matching `Bookmark` type. | HTTP shape, validation messages. |
| `server/db.ts` | `better-sqlite3` Database instance, schema migration on open. | Per-route logic. |
| `client/main.ts` | Boot: load list, mount form. | DOM details, network details. |
| `client/api.ts` | `fetch` calls; throws typed `ApiError` on non-2xx. | UI state, rendering. |
| `client/render.ts` | DOM construction for list rows + empty state. | Network, form. |
| `client/form.ts` | Form-state machine (idle / submitting / error), client-side validation. | Rendering the list. |
| `shared/types.ts` | Cross-tier type contracts. | Any runtime behaviour. |

**Boundaries:**

- Server and client are decoupled by an HTTP/JSON contract; they share only `src/shared/types.ts` (compile-time only). The frontend bundle does NOT import server modules.
- The repository is the only module that opens SQL strings; routes never touch the `Database` handle.
- `app.ts` is exported as a factory so `routes.test.ts` can drive it via `supertest` against an in-memory SQLite instance without binding a port.

## Interfaces

### HTTP API (server <-> client)

All routes serve JSON except `GET /` and `/public/*`. Same-origin, no CORS.

| Method | Path | Request body | Success response | Errors |
| --- | --- | --- | --- | --- |
| `GET`  | `/` | — | `200` `index.html` | — |
| `GET`  | `/public/*` | — | `200` static asset | `404` if missing |
| `GET`  | `/api/bookmarks` | — | `200` `{ bookmarks: Bookmark[] }` ordered `created_at DESC, id DESC` | — |
| `POST` | `/api/bookmarks` | `{ url: string, title: string }` | `201` `{ bookmark: Bookmark }` | `400` validation, `409` duplicate URL |
| `DELETE` | `/api/bookmarks/:id` | — | `204` no body (whether the row existed or not) | `400` non-integer id |

Error response shape (for `400`, `409`):

```ts
{ error: { code: 'VALIDATION' | 'DUPLICATE_URL' | 'BAD_ID', message: string } }
```

`DELETE` is intentionally idempotent — deleting a missing id returns `204`, satisfying US-004 AC3.

### Repository contract (`bookmarks-repo.ts`)

```ts
export interface BookmarksRepo {
  list(): Bookmark[];
  // Throws DuplicateUrlError on UNIQUE(url) constraint violation.
  insert(input: CreateBookmarkInput): Bookmark;
  // Returns true if a row was deleted, false otherwise. Never throws on missing.
  deleteById(id: number): boolean;
}

export class DuplicateUrlError extends Error { code = 'DUPLICATE_URL' as const; }

export function createBookmarksRepo(db: Database): BookmarksRepo;
```

### Database factory (`db.ts`)

```ts
export interface OpenDbOptions { filename: string | ':memory:'; }
export function openDb(opts: OpenDbOptions): Database; // runs migrations synchronously
```

### App factory (`app.ts`)

```ts
export interface AppDeps { repo: BookmarksRepo; staticDir: string; }
export function createApp(deps: AppDeps): express.Express;
```

### Client API (`client/api.ts`)

```ts
export function listBookmarks(): Promise<Bookmark[]>;
export function createBookmark(input: CreateBookmarkInput): Promise<Bookmark>;
export function deleteBookmark(id: number): Promise<void>;
export class ApiError extends Error { code: string; status: number; }
```

### Client rendering (`client/render.ts`)

```ts
export function renderList(root: HTMLElement, bookmarks: Bookmark[]): void;
export function renderEmptyState(root: HTMLElement): void;
export function renderFormError(root: HTMLElement, message: string | null): void;
```

## Data model

### SQLite schema (single table)

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL          -- unix epoch ms, set server-side
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at
  ON bookmarks(created_at DESC, id DESC);
```

Rationale for column choices:

- `id` is the stable handle for `DELETE`; URL is unique but unsuitable as a path parameter (escaping, length).
- `url` carries the `UNIQUE` constraint mandated by Spec `Data model invariants`.
- `created_at` is stored as integer epoch ms (sortable, monotonic, timezone-free).
- The compound `(created_at DESC, id DESC)` index makes the list query a single index scan and breaks ties deterministically when two inserts share a millisecond.

### Shared TypeScript types (`src/shared/types.ts`)

```ts
export interface Bookmark {
  id: number;
  url: string;
  title: string;
  createdAt: number;            // ms since epoch
}

export interface CreateBookmarkInput {
  url: string;
  title: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
```

Server converts snake_case rows to camelCase at the repository boundary so neither HTTP nor client sees `created_at`.

### Migrations

Single bootstrap migration baked into `openDb()`: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`. No migration framework — the schema has one table and is not expected to change in v1. `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` are set on open.

## Integration points

None outside the workspace. Specifically:

- No outbound HTTP calls from server or client.
- No analytics, telemetry, error reporting.
- No service worker, no PWA manifest.
- No OS integrations beyond the SQLite file under `./data/bookmarks.db`.
- Static assets are served from `./public/` by the same Express process; no CDN, no reverse proxy.

The only "integration" is between the bundled client JS and the local Express server, both same-origin on `http://localhost:3000`.

## State and error handling

### Server-side state

The server is otherwise stateless across requests; all state is in SQLite. The `Database` handle is opened once at boot and reused (better-sqlite3 is synchronous and thread-safe for a single Node process).

**Error flow:**

```
route handler
   |-- validate request (zod-like inline checks)
   |     |-- invalid  -> 400 { code: 'VALIDATION', ... }
   |
   |-- call repo
   |     |-- DuplicateUrlError      -> 409 { code: 'DUPLICATE_URL', ... }
   |     |-- other thrown error      -> next(err) -> error middleware -> 500
   |
   |-- success -> 2xx + JSON
```

A single Express error middleware logs to `stderr` and responds `500 { code: 'INTERNAL', ... }`. SQLite `SQLITE_CONSTRAINT_UNIQUE` is detected by inspecting `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` inside the repo and rethrown as `DuplicateUrlError`.

### Client-side state

The form is a small state machine:

```
        submit                  201
[idle] -------> [submitting] --------> [idle]  (clear inputs, refresh list)
   ^                |
   |  user edits    | 400 / 409
   +----[error]<----+
```

The list is recomputed by refetching `/api/bookmarks` after every successful create or delete (no optimistic updates — list size is small, latency is local). On network failure during list load, render an inline retry message; do not crash.

### Failure modes

| Failure | Detected by | Behaviour |
| --- | --- | --- |
| SQLite file unwritable | `openDb()` throws at boot | Process exits with code 1; stderr explains path |
| Duplicate URL on insert | `SQLITE_CONSTRAINT_UNIQUE` in repo | `409` to client; form shows "URL already saved" |
| Delete of missing id | `changes === 0` from `run()` | `204` regardless (idempotent per US-004 AC3) |
| Malformed URL submitted | Client-side `URL` constructor throws | Form rejects without network call |
| Server unreachable from client | `fetch` rejects | List shows retry; form shows network error |
| Two tabs delete same row | First wins, second `204`s | Each tab refetches list and converges |

## Constraints

Carried forward from `spec.md § Constraints` and pinned here for downstream phases:

- **Language:** TypeScript across server, client, shared, and tests. `tsconfig.json` targets `ES2022`, `module: NodeNext` for server, with a separate `tsconfig.client.json` extending it for the browser bundle (`module: ESNext`, `target: ES2020`).
- **Runtime:** Node >= 20 (LTS). Single process. No clustering.
- **Libraries (production):** `express`, `better-sqlite3`. Nothing else for runtime.
- **Libraries (dev):** `typescript`, `esbuild`, `vitest`, `supertest`, `@types/express`, `@types/node`, `@types/supertest`, `jsdom` (for client-render tests via Vitest's `environment: 'jsdom'`).
- **No frameworks** on the client (no React, Vue, Svelte, htmx). DOM only.
- **Workspace isolation:** every artifact lives under `.loom/baseline-1779088265-1/app/`. SQLite file at `./data/bookmarks.db`. No writes outside the workspace.
- **Network envelope:** only `http://localhost:3000`. No outbound calls.
- **Security:** all rendered anchor tags use `target="_blank"` + `rel="noopener noreferrer"`. The list is rendered via `textContent` / `setAttribute`, never `innerHTML`, to avoid XSS via a malicious title. Express body limit `10kb`.
- **Performance envelope:** expected size "tens of bookmarks". The compound index makes list `O(n)` on a tiny `n`; no pagination needed.
- **Build:** `npm start` runs `tsc` for server then `node dist/server/index.js`; pre-step bundles client via `esbuild`. `npm test` runs `vitest run`. Scripts:
  - `build:server` → `tsc -p tsconfig.json`
  - `build:client` → `esbuild src/client/main.ts --bundle --outfile=public/bundle.js --format=esm --target=es2020`
  - `start` → `npm run build:client && npm run build:server && node dist/server/index.js`
  - `test` → `vitest run`

## Architecture decisions

### ADR-001: Three-layer server (index / app / routes / repo)

**Context.** The server has tiny scope but must be testable without binding a port and must not let SQL leak into HTTP handlers.

**Decision.** Split into four files: `index.ts` (process boot), `app.ts` (Express factory taking deps), `routes.ts` (handlers), `bookmarks-repo.ts` (SQL). `app.ts` is exported and reused by tests with `supertest` and an in-memory SQLite.

**Rationale.** Keeps SQL isolated, makes routes pure mappers between HTTP and the repository contract, and yields a `createApp({ repo, staticDir })` factory that tests drive directly.

**Alternatives.**
- *Single `server.ts` doing everything.* Rejected: SQL and HTTP would intermix and route tests would require an HTTP listener on a real port.
- *Add a service layer between routes and repo.* Rejected: no behaviour to host there — routes are thin, repo is thin, a service layer would be a pass-through.

### ADR-002: SQLite `id INTEGER PRIMARY KEY AUTOINCREMENT` as the delete handle

**Context.** US-004 needs a way to address a single bookmark. URL is unique but unwieldy as a path parameter and would leak into the URL bar.

**Decision.** Use an auto-incrementing integer `id` as the primary key and the `DELETE /api/bookmarks/:id` path parameter. `url` keeps its `UNIQUE` constraint for the duplicate-detection invariant (Q02).

**Rationale.** Numeric ids are short, escape-free, monotonic, and decouple the API path from user data.

**Alternatives.**
- *URL-as-PK.* Rejected: requires URL-encoding in path; long; rebinds API stability to the user-supplied string.
- *UUID PK.* Rejected: unnecessary for a single-user local app; larger index, no distribution requirement.

### ADR-003: `created_at` as integer epoch milliseconds

**Context.** US-002 AC1 requires deterministic newest-first ordering. SQLite has no native datetime type and JavaScript `Date` round-trips through ms.

**Decision.** Store `created_at` as `INTEGER NOT NULL` containing `Date.now()` at insert time. Sort by `(created_at DESC, id DESC)` to break ms-collision ties.

**Rationale.** Trivially sortable, timezone-free, indexable, and survives JSON round-trips losslessly. The secondary `id DESC` makes ordering deterministic even at sub-ms insert cadence.

**Alternatives.**
- *ISO-8601 text.* Rejected: lexicographic sort works but is more bytes, less efficient to compare, and forces parse on the client.
- *SQLite `DATETIME DEFAULT CURRENT_TIMESTAMP`.* Rejected: pushes time generation into the DB (harder to mock in tests), one-second resolution invites collisions.

### ADR-004: No optimistic UI updates

**Context.** The client must reflect server state after create / delete. The system is local, latency is sub-ms.

**Decision.** After any successful mutation, refetch `/api/bookmarks` and re-render the list. No optimistic insertion or removal.

**Rationale.** Source-of-truth is the server. At local latencies, the visual lag is undetectable. Eliminates rollback logic on `409` and avoids divergence between two open tabs.

**Alternatives.**
- *Optimistic insert + rollback on 409.* Rejected: real complexity for imperceptible UX gain locally.
- *WebSocket push for cross-tab sync.* Rejected: out of scope, adds a long-lived connection and a second protocol.

### ADR-005: `DELETE` is idempotent (`204` even when row is missing)

**Context.** US-004 AC3 requires that deleting an already-deleted bookmark "responds without error and leaves the remaining list intact". Two tabs is the obvious trigger.

**Decision.** `DELETE /api/bookmarks/:id` always returns `204` when the id parses, regardless of whether a row was removed. Only a non-integer id returns `400`.

**Rationale.** Matches REST `DELETE` semantics and US-004 AC3 directly. The client need not distinguish "I just deleted it" from "another tab beat me to it".

**Alternatives.**
- *`404` on missing.* Rejected: forces the client to swallow `404` to satisfy AC3 — needless ceremony.
- *`200` with `{ deleted: boolean }`.* Rejected: client doesn't need the signal; adds a body for nothing.

### ADR-006: Vanilla DOM via `textContent` only (no template lib, no `innerHTML`)

**Context.** Frontend must be plain HTML+CSS+TS with no framework (seed). Bookmark titles are user-supplied strings.

**Decision.** `render.ts` builds DOM with `document.createElement` and assigns user data exclusively via `textContent` (or `setAttribute('href', ...)` for the URL). `innerHTML` is forbidden in client code.

**Rationale.** Eliminates the XSS vector inherent to string templating user content into HTML. Trivially testable under jsdom.

**Alternatives.**
- *Tagged-template tiny renderer.* Rejected: extra surface, still requires careful escaping discipline.
- *`innerHTML` with manual escape.* Rejected: one missed escape is an XSS.

### ADR-007: `better-sqlite3` synchronous API used directly

**Context.** The seed pins `better-sqlite3`. The library is synchronous by design.

**Decision.** Route handlers call repository methods synchronously and return JSON in the same tick. No `Promise.resolve` wrapping.

**Rationale.** `better-sqlite3` is faster synchronous than async wrappers; a single-user local app has no concurrency pressure that would benefit from async I/O. Simplifies error handling — no `await` rejection paths.

**Alternatives.**
- *Wrap every call in `Promise.resolve`.* Rejected: false-async; obscures stack traces; no benefit.
- *Switch to `sqlite3` (callback/async).* Rejected: seed pins `better-sqlite3`.

### ADR-008: One root `tsconfig.json` plus `tsconfig.client.json` for the browser bundle

**Context.** Server runs on Node (CommonJS-ish via NodeNext); client runs in the browser (ESM). A single tsconfig cannot satisfy both module systems.

**Decision.** Root `tsconfig.json` targets Node for `src/server/**` and `src/shared/**` and runs via `tsc` to `dist/`. A `tsconfig.client.json` extends it, restricts `include` to `src/client/**` + `src/shared/**`, and is consumed by `esbuild` (which uses it for path resolution but does its own emit to `public/bundle.js`).

**Rationale.** Keeps `shared/` usable from both sides without duplicating types or fighting the type checker on module syntax.

**Alternatives.**
- *Single tsconfig.* Rejected: forces either server-side ESM gymnastics or client-side CJS bundle.
- *Two separate src trees with duplicated types.* Rejected: defeats the purpose of `shared/`.

## Alternatives considered

Whole-design options weighed and rejected before settling on the layout above:

- **No backend; pure static page with `localStorage`.** Rejected: seed pins Node + Express + `better-sqlite3` and persistence in a SQLite file. `localStorage` also doesn't survive browser-profile resets the way a file on disk does.
- **Backend writes HTML server-side (SSR / forms POST + redirect, no JSON API).** Rejected: seed pins a vanilla-TS client bundled by `esbuild`, implying a JSON API consumed by a browser app. SSR would make the client bundle vestigial.
- **Monorepo with separate `server/` and `client/` packages.** Rejected: overkill for ~10 source files; one `package.json` at `./app/` is sufficient and matches the "keep the surface small" axis.
- **ORM (Drizzle, Prisma, Kysely) on top of `better-sqlite3`.** Rejected: one table, three SQL statements (insert, select, delete) — an ORM is more code to learn and maintain than the SQL itself.
- **Dev-time `nodemon` + `tsx` for hot reload.** Rejected: out of scope for the seed's `npm start` / `npm test` contract; can be added later without disturbing the structure here.

## Open ambiguity

None. All structural choices are either pinned by Spec constraints, resolved by ADR-001..008 above, or trivially derivable from those (e.g. exact CSS rules, exact wording of error messages). Plan phase can proceed.
