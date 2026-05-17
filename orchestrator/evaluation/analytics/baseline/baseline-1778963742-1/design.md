---
project: baseline-1778963742-1
phase: design
created: 2026-05-16
---

# Design — Bookmarks (local-only)

Solution structure for the four-feature, local-only Bookmarks web app pinned by
`seed.md` and contracted by `spec.md`. This document owns system shape,
interfaces, data model, error handling, and architecture decisions. It does
NOT restate user stories or flows — those live in `spec.md`.

## System shape

Single-process Node + Express application packaged as a single npm project
rooted at `.loom/baseline-1778963742-1/app/`. Three internal layers, all
TypeScript, all compiled by the same toolchain:

```
.loom/baseline-1778963742-1/app/
├── package.json              # npm scripts: start, build, build:client, test
├── tsconfig.json             # shared TS config (NodeNext, strict)
├── tsconfig.client.json      # browser-target TS config (DOM lib, no Node types)
├── vitest.config.ts          # Vitest config (node env)
├── bookmarks.db              # created at runtime by better-sqlite3 (gitignored)
├── .gitignore                # node_modules/, dist/, bookmarks.db
├── src/
│   ├── server/
│   │   ├── index.ts          # entry: opens DB, mounts routes, app.listen(3000)
│   │   ├── app.ts            # Express factory (exported for tests): createApp(db)
│   │   ├── db.ts             # openDb(path) → Database; runs schema migration
│   │   ├── routes.ts         # mounts /api/bookmarks router
│   │   ├── bookmarks.ts      # repository: insert/list/delete + duplicate detection
│   │   └── validation.ts     # validateUrl, validateTitle
│   └── client/
│       ├── index.html        # single HTML page
│       ├── style.css         # single stylesheet
│       └── main.ts           # vanilla TS entry → bundled to dist/client/main.js
├── scripts/
│   └── build-client.ts       # esbuild driver for the client bundle
├── dist/
│   └── client/               # esbuild output: main.js (+ source map)
└── tests/
    ├── api.bookmarks.test.ts # Vitest + supertest against createApp(inMemoryDb)
    └── validation.test.ts    # pure-function tests for URL/title validation
```

**Component ownership.**

| Component | Owns | Imported by |
| --- | --- | --- |
| `server/db.ts` | SQLite handle, schema migration | `index.ts`, tests |
| `server/bookmarks.ts` | All SQL for bookmarks, duplicate detection, error translation | `routes.ts`, tests |
| `server/validation.ts` | URL + title shape checks | `routes.ts`, tests |
| `server/routes.ts` | HTTP shape of `/api/bookmarks/*` | `app.ts` |
| `server/app.ts` | Express wiring, static serving, JSON middleware | `index.ts`, tests |
| `server/index.ts` | Boot: open DB at `app/bookmarks.db`, build app, listen on 3000 | npm `start` |
| `client/main.ts` | All DOM interactions, fetch calls, render loop | served as `dist/client/main.js` |
| `scripts/build-client.ts` | esbuild invocation (one-shot bundle to `dist/client/`) | `prestart`, `build`, `build:client` npm scripts |

**Boundaries.**

- The client communicates with the server ONLY via the JSON HTTP API under
  `/api/bookmarks` and via static-file fetches from `/` and `/static/*`. No
  shared in-process state.
- The server communicates with SQLite ONLY through `server/db.ts` +
  `server/bookmarks.ts`. No other module touches `better-sqlite3` directly.
- Tests construct an Express app via `createApp(db)` with an in-memory
  `better-sqlite3` database (`new Database(':memory:')`). Production boot wires
  the same factory to a file-backed DB. No HTTP listener is opened in tests.

## Interfaces

### HTTP API

All endpoints serve `Content-Type: application/json` (except the static / and
/static/* responses). Request bodies are `application/json`.

#### POST /api/bookmarks — create

- Request body:
  ```ts
  { url: string; title: string }
  ```
- Behavior: validate `url` (non-empty, parseable via `new URL()`) and `title`
  (non-empty after trim). Reject duplicate `url` (case-sensitive exact match,
  matching the SQLite UNIQUE constraint). Insert and return the created row.
- Responses:
  - `201 Created` →
    ```ts
    { id: number; url: string; title: string; created_at: number }
    ```
  - `400 Bad Request` (validation) →
    ```ts
    { error: "invalid_url" | "invalid_title" | "invalid_body" ; message: string }
    ```
  - `409 Conflict` (duplicate) →
    ```ts
    { error: "duplicate_url"; message: "URL is already saved" }
    ```

#### GET /api/bookmarks — list

- Request: no body, no query parameters.
- Behavior: returns every row ordered by `created_at DESC, id DESC` (the `id`
  tiebreak guarantees deterministic ordering when two rows share a millisecond
  timestamp, which matters for the Vitest suite).
- Responses:
  - `200 OK` →
    ```ts
    Array<{ id: number; url: string; title: string; created_at: number }>
    ```

#### DELETE /api/bookmarks/:id — delete

- Path param: `id` (positive integer; non-integer → 400).
- Behavior: delete the row. If no row matched, return 404.
- Responses:
  - `204 No Content` (deleted)
  - `400 Bad Request` (`invalid_id`)
  - `404 Not Found` (`not_found`)

#### GET / — UI entry

- Returns `src/client/index.html` (served from disk; not bundled).
- `200 OK`, `Content-Type: text/html`.

#### GET /static/* — bundled assets

- Mounted via `express.static(path.join(__dirname, '../../dist/client'))` for
  the bundled JS (and any future static asset), and a sibling
  `express.static(path.join(__dirname, '../client'))` route for `style.css`.
- The `index.html` references `/static/main.js` and `/static/style.css`.

### Module exports

```ts
// server/db.ts
export function openDb(filename: string): Database;
// Runs the schema migration (CREATE TABLE IF NOT EXISTS) before returning.

// server/bookmarks.ts
export type Bookmark = { id: number; url: string; title: string; created_at: number };
export type CreateInput = { url: string; title: string };
export class DuplicateUrlError extends Error {}
export function createBookmarksRepo(db: Database): {
  insert(input: CreateInput): Bookmark;              // throws DuplicateUrlError on UNIQUE violation
  list(): Bookmark[];                                 // newest-first
  deleteById(id: number): boolean;                    // false → row did not exist
};

// server/validation.ts
export function validateUrl(raw: unknown): { ok: true; value: string } | { ok: false; reason: "invalid_url" };
export function validateTitle(raw: unknown): { ok: true; value: string } | { ok: false; reason: "invalid_title" };

// server/app.ts
export function createApp(db: Database): express.Express;

// server/index.ts — no exports; side-effectful boot.

// scripts/build-client.ts — CLI entry; no exports.
```

### Client → server contract (consumed by `client/main.ts`)

```ts
// All requests are same-origin; no auth header.
async function listBookmarks(): Promise<Bookmark[]>;
async function saveBookmark(url: string, title: string): Promise<Bookmark>;
// throws { kind: "duplicate" } on 409, { kind: "validation", message } on 400.
async function deleteBookmark(id: number): Promise<void>;
// throws { kind: "not_found" } on 404.
```

The client never holds bookmark state beyond what the most recent
`listBookmarks()` returned; after every successful mutation it re-fetches the
list and re-renders, keeping the render path single-sourced.

## Data model

### SQLite schema

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT    NOT NULL UNIQUE,
  title      TEXT    NOT NULL,
  created_at INTEGER NOT NULL                 -- Date.now() at insert time
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at
  ON bookmarks (created_at DESC, id DESC);
```

- `id`: server-assigned monotonic integer; primary key.
- `url`: full URL string as submitted (post `new URL()` round-trip — we store
  `new URL(input).toString()` so that the UNIQUE constraint normalises trivial
  divergences like a trailing slash on the origin). Case-sensitive uniqueness;
  this is acceptable for the personal-laptop scope.
- `title`: trimmed user-supplied label; non-empty.
- `created_at`: integer milliseconds since epoch (`Date.now()`). Sortable;
  avoids any timezone surface.

`better-sqlite3` opens the database synchronously and runs the
`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` at startup. No
external migration tool.

### File location

- Production: `.loom/baseline-1778963742-1/app/bookmarks.db`, resolved as
  `path.resolve(process.cwd(), 'bookmarks.db')` when launched via `npm start`
  from `./app/`. Listed in `.gitignore`.
- Tests: `new Database(':memory:')` per test file (or per test). Production
  file is never touched by Vitest.

### Server-side state shape

The server is request/response stateless beyond the SQLite handle held by
`createApp`. No sessions, no in-memory caches.

### Client-side state shape

```ts
// Held inside client/main.ts; not exported.
let bookmarks: Bookmark[] = [];   // last fetched list, newest-first
let formError: string | null;     // inline error under the add form
let listError: string | null;     // non-fatal banner above the list (e.g. delete-of-missing)
```

The render function is a pure transformation of these three fields into DOM.

## Integration points

The app has **no third-party integrations**. The only systems it talks to are:

- **The local SQLite file** at `app/bookmarks.db`, via `better-sqlite3` (a
  native Node addon — see Constraints for the install implication).
- **The local browser**, via HTTP on `http://localhost:3000`. The client opens
  bookmark URLs in a new tab using `<a target="_blank" rel="noopener noreferrer">`,
  which is the only "external" surface the app touches; the navigation is
  initiated by the browser, not by the server.

No outbound network calls are made by either the server or the client at
runtime. No telemetry, no analytics, no font CDN, no service worker.

## State and error handling

### Server failure modes

| Failure | Detection | Response | Recovery |
| --- | --- | --- | --- |
| Body is not JSON / not an object | `express.json()` parse + manual type guard | `400 invalid_body` | Caller fixes payload |
| `url` missing / non-string / fails `new URL()` | `validateUrl` | `400 invalid_url` | Caller submits parseable URL |
| `title` missing / non-string / empty after trim | `validateTitle` | `400 invalid_title` | Caller submits non-empty title |
| Duplicate URL on insert | `better-sqlite3` throws on UNIQUE; repo catches and re-throws `DuplicateUrlError` | `409 duplicate_url` | Caller informed via inline UI error |
| `:id` path param not a positive integer | route parser | `400 invalid_id` | Caller fixes URL |
| Delete target row does not exist | `info.changes === 0` from `db.prepare(...).run(id)` | `404 not_found` | Caller refreshes list |
| Unexpected DB write failure (disk full, permissions) | Uncaught throw from `better-sqlite3` | `500` via Express default error handler returning `{ error: "internal", message }` | Operator inspects disk; restart server |
| DB file cannot be opened at boot | `openDb` throws | Process exits non-zero with logged reason | Operator removes/repairs `bookmarks.db` |

A small final Express error-handling middleware catches anything that escapes
route handlers, logs it, and returns `500 internal`. Validation errors and
duplicate errors are thrown by typed error classes inside the route and
translated to the contracts above; they never reach the 500 path.

### Client failure modes

| Failure | UI behaviour |
| --- | --- |
| `saveBookmark` → 400 | Inline error under the form: validation message from server |
| `saveBookmark` → 409 | Inline error under the form: "URL is already saved" |
| `saveBookmark` → network / 500 | Inline error under the form: "Could not save — try again" |
| `deleteBookmark` → 404 | Non-fatal banner above the list: "That bookmark was already removed"; the list is re-fetched so the UI converges (US-004 AC3) |
| `deleteBookmark` → network / 500 | Banner: "Could not delete — try again"; row stays |
| `listBookmarks` fails on initial load | Banner: "Could not load bookmarks"; user can retry via reload |

Empty state (US-002 AC3) is not an error — when `bookmarks.length === 0` the
render function emits a single `<p class="empty">No bookmarks yet.</p>` in
place of the list.

## Constraints

- **Workspace isolation (harness directive).** Every deliverable file — source,
  config, `node_modules`, build output, `bookmarks.db` — lives under
  `.loom/baseline-1778963742-1/app/`. No write may escape that directory. `npm
  start` and `npm test` are invoked from `./app/`. Relative paths (e.g. the DB
  file) are resolved against that cwd.
- **Stack pinning (no substitutions).**
  - Language: TypeScript 5.x on both server and client.
  - Runtime: Node 20+ (required by current `better-sqlite3` and `esbuild`).
  - Backend: Express 4.x, single process.
  - Storage: `better-sqlite3` (synchronous; native addon — installed during
    `npm install`; no separate native build step required by the project).
  - Frontend bundler: `esbuild` 0.20+, invoked via `scripts/build-client.ts`.
    No additional bundler, no Vite, no webpack.
  - Tests: Vitest 1.x with `supertest` for HTTP-level tests against
    `createApp(inMemoryDb)`.
  - Framework prohibition: no React, no Vue, no Svelte, no jQuery on the
    client.
- **Run / test commands.**
  - `npm start` runs `prestart` (`npm run build:client`) then `tsx
    src/server/index.ts` (or the equivalent — Plan picks the exact runner; the
    surface is one command). Server listens on `http://localhost:3000` and
    serves UI + API from the same origin.
  - `npm test` runs `vitest run`.
- **Local-only.** No outbound HTTP at runtime; no font/CDN dependency in
  `index.html`; no analytics; no service worker; no PWA manifest; no explicit
  dark-mode toggle.
- **No auth.** Single trusted local user. No session middleware, no CSRF
  middleware (same-origin local, single user, no cookies).
- **Minimal surface.** Only the four named features plus the duplicate-rejection
  guard. No search endpoint, no sort parameter, no edit endpoint, no tags table.
- **Performance envelope.** Personal use (low-hundreds of bookmarks). No
  pagination. The full list is returned on every `GET /api/bookmarks` and
  re-rendered client-side after every mutation. This is intentional, and the
  index on `(created_at DESC, id DESC)` keeps list reads cheap.
- **Security envelope.** Bookmark URLs are rendered as `<a href="...">`; the
  client uses `textContent` for title and URL display so user input cannot
  inject HTML. `target="_blank" rel="noopener noreferrer"` is mandatory on
  every link to prevent reverse-tabnabbing.

## Architecture decisions

### ADR-001: Single-process Express server serves both API and UI from one origin

- **Context.** The seed pins a single `npm start` command on
  `http://localhost:3000`, with the UI served from the same origin as the API.
- **Decision.** One Express process binds `:3000`. The same process mounts the
  JSON API under `/api/bookmarks/*`, serves `index.html` at `/`, and serves the
  esbuild output under `/static/*`. No separate dev server, no proxy.
- **Rationale.** Single-origin avoids CORS entirely, eliminates a class of
  configuration bugs, and keeps the production boot path identical to the
  developer experience.
- **Alternatives.** A two-process setup with Vite for the client was rejected
  because the seed forbids substituting the bundler and the same-origin
  requirement makes a second process pure overhead.

### ADR-002: `better-sqlite3` (synchronous) over `sqlite3` (async)

- **Context.** The seed pins `better-sqlite3` by name; we still document why
  the synchronous model is acceptable.
- **Decision.** Use `better-sqlite3` synchronously inside route handlers. No
  async wrapper.
- **Rationale.** Single-user laptop scope; query latency is microseconds;
  Express handlers complete in a single event-loop tick. Synchronous calls
  simplify the repository module and eliminate a class of unhandled-promise
  bugs. The seed pins the dependency, so the choice is also non-negotiable.
- **Alternatives.** `sqlite3` (callback API) or `drizzle-orm` were rejected —
  the first by the seed, the second as ORM weight unjustified at this scope.

### ADR-003: UNIQUE constraint on `bookmarks.url` enforces duplicate rejection

- **Context.** Q02 resolved to "reject duplicate URLs with an inline error".
  The contract holds whether the check happens in the application layer or the
  database layer.
- **Decision.** A `UNIQUE` constraint on `bookmarks.url` is the source of
  truth. The repository catches the constraint violation and throws
  `DuplicateUrlError`; the route translates that to `409 duplicate_url`. URLs
  are normalised via `new URL(input).toString()` before insert so that trivial
  differences (e.g. trailing slash on the origin) collapse to the same key.
- **Rationale.** A DB-level constraint cannot be bypassed by a future code
  path; an application-only check can race itself even in a single-process
  app if writes ever move off the main loop. Normalising via `new URL()`
  matches user intent (`https://example.com` and `https://example.com/`
  are the same site).
- **Alternatives.** Application-only `SELECT … WHERE url = ?` then `INSERT`
  was rejected as redundant given the constraint. Case-insensitive uniqueness
  via a `lower(url)` index was rejected as scope creep for the personal-use
  envelope — URLs are case-sensitive after the host anyway, and the user can
  delete-and-re-add in the rare collision.

### ADR-004: Flat single-table schema (no tags, no categories)

- **Context.** Q01 resolved to "flat list".
- **Decision.** One `bookmarks` table. No `tags`, no `bookmark_tags`, no
  `category_id` column.
- **Rationale.** Matches the resolved decision; matches the seed's
  "keep the surface small" directive; eliminates a join, a CRUD surface, and a
  UI affordance that none of the four user stories require.
- **Alternatives.** Many-to-many tags or a single-category column — both
  rejected by Q01 and by spec scope.

### ADR-005: No PATCH endpoint; bookmarks are immutable

- **Context.** Q04 resolved to "immutable once added".
- **Decision.** The HTTP surface exposes only POST/GET/DELETE for bookmarks.
  The repository has no `update` method.
- **Rationale.** Matches the resolved decision; removes an endpoint, a
  validation surface, and an in-row edit UI. Delete-and-re-add covers the rare
  correction case.
- **Alternatives.** PATCH `/api/bookmarks/:id` for title/URL — rejected by
  Q04 and by spec scope.

### ADR-006: Fixed `ORDER BY created_at DESC, id DESC` (no sort selector, no list query params)

- **Context.** Q03 resolved to "no search"; Q05 resolved to "newest-first
  only".
- **Decision.** `GET /api/bookmarks` accepts no query parameters and always
  returns `ORDER BY created_at DESC, id DESC`. The `id` tiebreaker makes the
  order deterministic for tests when two inserts share a millisecond.
- **Rationale.** Matches the resolved decisions; produces a single fixed SQL
  query the index covers; keeps the UI a single rendered list with no
  selector.
- **Alternatives.** Accept `?sort=…` / `?q=…` query params — rejected by Q03
  and Q05.

### ADR-007: `createApp(db)` factory so tests run against an in-memory database

- **Context.** Tests must exercise the four HTTP endpoints without touching
  the production SQLite file, and without binding to port 3000 (which would
  conflict with a running dev server).
- **Decision.** `server/app.ts` exports `createApp(db: Database): Express`.
  Production boot (`server/index.ts`) calls `openDb('bookmarks.db')` then
  `createApp(db).listen(3000)`. Tests construct `new Database(':memory:')`,
  run the same schema migration, build the app via `createApp(db)`, and
  drive it through `supertest` without ever calling `.listen()`.
- **Rationale.** Single source of routing truth (the factory) means the test
  surface is exactly the production surface. In-memory SQLite is fast and
  hermetic per test file.
- **Alternatives.** Spinning the real server on a random port for tests —
  rejected as slower, racier, and bringing no extra coverage given the
  in-memory DB exercises the same schema.

### ADR-008: Same-origin static delivery via two `express.static` mounts; no service worker

- **Context.** The seed forbids a PWA / service worker and pins esbuild as the
  only bundler.
- **Decision.** `express.static('dist/client')` is mounted at `/static` for
  the esbuild output; `express.static('src/client')` is also mounted at
  `/static` for `style.css` (which is not bundled). `GET /` returns
  `src/client/index.html` directly via `res.sendFile`. The `index.html`
  references `/static/main.js` and `/static/style.css`.
- **Rationale.** Lowest-overhead static delivery; no build step for CSS; the
  bundler stays scoped to one file; no service worker means no cache
  invalidation puzzles.
- **Alternatives.** Inlining CSS into the bundle — rejected because keeping
  `style.css` editable as a flat file is faster to iterate on and the seed
  asks for "plain HTML + CSS + vanilla TypeScript".

### ADR-009 (resolved-in-this-doc): URL normalisation via `new URL(input).toString()` at insert time

- **Context.** The seed and decisions do not specify whether
  `https://example.com` and `https://example.com/` are "the same" URL for the
  duplicate-rejection check. The non-interactive directive instructs the
  Design agent to make and document the call.
- **Decision.** On `POST /api/bookmarks`, the server validates the URL by
  constructing `new URL(rawUrl)`. If construction succeeds, the value
  persisted is `parsed.toString()` (which canonicalises e.g. an origin-only
  URL to include the trailing slash, lowercases the host, etc.). The UNIQUE
  constraint then operates on the canonical form.
- **Rationale.** This is the minimal-surface choice that matches user mental
  model: the user thinks of `https://example.com` and `https://example.com/`
  as "the same bookmark". `new URL` is built into Node and the browser, so
  the canonicalisation is consistent across both layers with zero
  dependencies.
- **Alternatives.** (a) Store the user's raw string and let `UNIQUE` only
  catch exact duplicates — rejected as user-hostile (they'll re-save the same
  site with a trailing slash and not understand why it stuck the second time).
  (b) Normalise more aggressively (strip default ports, sort query params,
  lowercase the path) — rejected as scope creep; `URL.toString()` is the
  boundary.

### ADR-010 (resolved-in-this-doc): `created_at` is `Date.now()` milliseconds, deterministic order via `(created_at DESC, id DESC)`

- **Context.** The seed and decisions do not specify the timestamp type or
  the tiebreaker for two bookmarks created in the same millisecond.
- **Decision.** Store `created_at` as `INTEGER` (`Date.now()` at insert).
  Order by `created_at DESC, id DESC`. The `id` tiebreaker is required for
  deterministic Vitest assertions when two inserts land in the same
  millisecond.
- **Rationale.** Integer epoch ms is the simplest sortable representation,
  carries no timezone surface, and round-trips trivially to the client. The
  `id DESC` tiebreaker makes "newest" unambiguous and keeps tests
  flake-free.
- **Alternatives.** ISO-8601 TEXT (`datetime('now')`) — rejected because it
  introduces a string-vs-number rendering decision client-side for zero
  benefit. Microsecond timestamps via `process.hrtime.bigint()` — rejected as
  overkill at personal-use scale.

## Alternatives considered

The whole-design alternatives weighed and rejected at the system level:

- **Two-process dev setup (Vite for client, Express for API, proxied).**
  Rejected: the seed pins `esbuild`, and the same-origin requirement makes a
  second process pure overhead. The chosen single-process design serves both
  surfaces from one port with no proxy.
- **SQLite via `sqlite3` (callback / async).** Rejected: the seed pins
  `better-sqlite3`. Even absent the pin, the synchronous model is simpler at
  this scale.
- **JSON file persistence (no SQLite).** Rejected: the seed pins SQLite, and
  the duplicate-rejection constraint is cleanest as a DB UNIQUE.
- **An ORM (Drizzle / Prisma / Kysely).** Rejected: four hand-written
  prepared statements (insert / list / delete / count-by-url) are smaller
  than any ORM's surface and avoid a code-gen step.
- **HTMX or server-rendered HTML over JSON.** Rejected: the seed pins
  "vanilla TypeScript bundled by esbuild" as the frontend, which presumes a
  JSON-fed SPA-style render. Server-rendered fragments would either add a
  templating dependency or require string-concatenated HTML on the server.
- **Pagination of `GET /api/bookmarks`.** Rejected: personal-laptop scope
  caps realistic counts in the low hundreds; the index makes the full list
  read cheap; pagination adds UI and contract surface that the four user
  stories do not require.
- **A client-side store / state framework.** Rejected: the client holds three
  fields (`bookmarks`, `formError`, `listError`) and re-renders by full
  re-paint after each mutation. A store layer would dwarf the logic it
  managed.
- **An optimistic-UI delete path.** Rejected: round-trip to local SQLite is
  fast enough that perceived latency is not a problem; the simpler
  "delete → refetch → render" loop also makes US-004 AC3 (delete-of-missing
  surfaces a non-fatal error) trivial to implement without rollback.

## Open ambiguity

*(none — Q01–Q05 are resolved in `decisions.md`; ADR-009 and ADR-010 capture
the two structural calls Design made under non-interactive mode.)*
