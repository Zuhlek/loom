---
project: baseline-1779002783-1
phase: design
created: 2026-05-17
---

# Design — Bookmarks

## System shape

Single Node + Express process bound to `http://localhost:3000`, serving
both the JSON API and the static frontend assets from the same origin.
One TypeScript codebase, one `package.json`, one SQLite file on disk.

```
.loom/baseline-1779002783-1/app/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bookmarks.db                 # better-sqlite3 file (created on first run)
├── src/
│   ├── server/
│   │   ├── index.ts             # entrypoint — boots Express, mounts routes
│   │   ├── app.ts               # buildApp(db) — returns an Express app (test seam)
│   │   ├── routes.ts            # /api/bookmarks router
│   │   ├── db.ts                # openDb(path), schema init, prepared statements
│   │   └── validate.ts          # URL + title validation helpers
│   └── web/
│       ├── main.ts              # frontend entry; bundled to public/main.js
│       ├── api.ts               # fetch wrappers around /api/bookmarks
│       └── render.ts            # DOM render helpers (list, empty state, error)
├── public/
│   ├── index.html               # served at GET /
│   ├── styles.css
│   └── main.js                  # esbuild output (gitignored, built on prestart/test)
└── tests/
    ├── api.test.ts              # HTTP-level Vitest tests via supertest + in-memory DB
    ├── db.test.ts               # persistence-layer tests on :memory: + file round-trip
    └── validate.test.ts         # validation unit tests
```

Components and ownership:

- **HTTP layer** (`src/server/app.ts`, `routes.ts`) — Express router for
  `/api/bookmarks/*`; static middleware mounted on `/` pointing at
  `public/`; JSON body parser; centralised error handler that maps
  thrown sentinel errors to HTTP status codes.
- **Persistence layer** (`src/server/db.ts`) — wraps `better-sqlite3`.
  Owns the `CREATE TABLE IF NOT EXISTS` boot step, exposes prepared
  statements (`listAll`, `insert`, `deleteById`) returning plain
  objects. Synchronous (better-sqlite3 has no async API).
- **Validation** (`src/server/validate.ts`) — pure functions returning
  `{ ok: true, value } | { ok: false, error }`. No I/O.
- **Static assets** — Express `express.static('public')` serves
  `index.html`, `styles.css`, `main.js` from the same origin.
- **Frontend bundle** (`src/web/*.ts` → `public/main.js`) — built by
  esbuild, single IIFE bundle, loaded by `index.html`. Owns DOM
  rendering, form submit, delete-click handlers, inline error display.
- **Entrypoint** (`src/server/index.ts`) — opens the file-backed DB at
  `./bookmarks.db`, calls `buildApp(db)`, listens on `:3000`. Tests
  bypass this and call `buildApp(memDb)` directly.

Build pipeline:

- `npm start` → `esbuild src/web/main.ts --bundle --outfile=public/main.js --format=iife --target=es2020` then `tsx src/server/index.ts` (or `node --import tsx` equivalent).
- `npm test` → `vitest run`. Vitest tests import `buildApp` directly and inject a `:memory:` DB; no separate build step needed for tests.

## Interfaces

### REST API

All endpoints share the same origin and return JSON. Request/response
bodies use UTF-8 JSON; `Content-Type: application/json` on both sides
when a body is present.

#### `GET /api/bookmarks`

List every bookmark, newest first.

- Request: no body, no query parameters.
- Response 200:
  ```json
  [
    { "id": 12, "url": "https://example.com", "title": "Example",
      "created_at": "2026-05-17T10:42:03.123Z" },
    ...
  ]
  ```
- Empty table → `200` with `[]`.

#### `POST /api/bookmarks`

Create a new bookmark.

- Request body:
  ```json
  { "url": "https://example.com", "title": "Example" }
  ```
- Response 201:
  ```json
  { "id": 13, "url": "https://example.com", "title": "Example",
    "created_at": "2026-05-17T10:42:03.123Z" }
  ```
- Response 400 (validation failure — empty/missing/invalid title or url):
  ```json
  { "error": "url must be a valid http(s) URL" }
  ```
  Error message is human-readable and rendered verbatim in the UI's
  inline error slot. Stable shape (`{ error: string }`) is the contract;
  the exact wording is not.
- Response 409 (duplicate url):
  ```json
  { "error": "duplicate", "message": "this URL is already saved" }
  ```
  The `error: "duplicate"` literal is the machine-readable signal the
  frontend keys off to render the duplicate inline error.

#### `DELETE /api/bookmarks/:id`

Delete a bookmark by id.

- `:id` is parsed as a positive integer; non-integer paths fall through
  to the 404 handler.
- Response 204: no body (success).
- Response 404 (id not found):
  ```json
  { "error": "not found" }
  ```

#### Error envelope

Any unhandled exception → `500` with `{ "error": "internal error" }`.
Errors are logged server-side via `console.error`; no telemetry, no
external reporting.

### Server-side function signatures

```ts
// src/server/db.ts
export interface Bookmark {
  id: number;
  url: string;
  title: string;
  created_at: string; // ISO-8601, UTC, ms precision
}
export interface BookmarkInput { url: string; title: string }

export class DuplicateUrlError extends Error {}
export class NotFoundError extends Error {}

export interface BookmarksRepo {
  listAll(): Bookmark[];                    // ORDER BY created_at DESC, id DESC
  insert(input: BookmarkInput): Bookmark;   // throws DuplicateUrlError
  deleteById(id: number): void;             // throws NotFoundError
  close(): void;
}

export function openDb(path: string): BookmarksRepo;
// path may be ':memory:' for tests or an absolute file path for prod.
```

```ts
// src/server/validate.ts
export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };
export function validateBookmarkInput(raw: unknown): Validated<BookmarkInput>;
//   - title must be a non-empty string after trim, max 500 chars
//   - url must parse via `new URL(...)` AND have protocol http: or https:
//   - returns trimmed title and the canonical url string
```

```ts
// src/server/app.ts
import type { Express } from 'express';
export function buildApp(repo: BookmarksRepo): Express;
```

### Frontend function signatures

```ts
// src/web/api.ts
export async function fetchBookmarks(): Promise<Bookmark[]>;
export async function createBookmark(input: BookmarkInput): Promise<Bookmark>;
//   - throws { kind: 'duplicate' } on 409
//   - throws { kind: 'validation', message: string } on 400
//   - throws { kind: 'network' } otherwise
export async function deleteBookmark(id: number): Promise<void>;
```

```ts
// src/web/render.ts
export function renderList(root: HTMLElement, items: Bookmark[]): void;
export function renderEmptyState(root: HTMLElement): void;
export function renderInlineError(slot: HTMLElement, message: string): void;
export function clearInlineError(slot: HTMLElement): void;
```

```ts
// src/web/main.ts
// boot() wires DOMContentLoaded → fetchBookmarks → renderList,
// attaches form submit + delegated click handler on the list for
// delete buttons. No exports; IIFE entry.
```

## Data model

Single SQLite table, file path `./bookmarks.db` (relative to the
process cwd, which is `./app/` per the run commands).

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL          -- ISO-8601 UTC, set by the server at insert
);
-- The UNIQUE constraint on `url` creates an implicit index used by
-- duplicate detection on insert and by any future url lookup.
```

Notes:

- No migration tooling. Schema is declared exactly once via
  `CREATE TABLE IF NOT EXISTS` at DB open. The seed-pinned scope
  forbids schema versioning beyond this.
- `created_at` is server-assigned (`new Date().toISOString()`) so the
  ordering remains monotonic regardless of client clock skew.
- `ORDER BY created_at DESC, id DESC` is used so two rows inserted in
  the same millisecond still have a deterministic order (insertion
  order, since `id` is monotonic).
- Frontend in-memory state mirrors the server list (`Bookmark[]`).
  After each successful POST or DELETE the list is re-fetched from
  `GET /api/bookmarks` rather than mutated locally — keeps the state
  authoritative on the server and avoids drift.

## Integration points

None. No external services, no third-party APIs, no remote fetch at
runtime. The single native dependency is `better-sqlite3`, which ships
prebuilt binaries via npm; no separate install step.

## State and error handling

### Server

- DB open at boot. If `openDb` throws (e.g. corrupt file, permissions),
  the process exits non-zero with the error logged. No retry loop.
- Request lifecycle is stateless per request. No sessions, no
  connection pool (better-sqlite3 is a single in-process handle).
- Error mapping (centralised in an Express error-handler middleware):

  | Thrown                  | HTTP | Body                                                 |
  |-------------------------|------|------------------------------------------------------|
  | `validate.ok === false` | 400  | `{ error: <validator message> }`                     |
  | `DuplicateUrlError`     | 409  | `{ error: "duplicate", message: "this URL is already saved" }` |
  | `NotFoundError`         | 404  | `{ error: "not found" }`                             |
  | anything else           | 500  | `{ error: "internal error" }` + `console.error` log  |

- No retry, no background jobs, no queues. Every request is a single
  synchronous SQLite call inside a single Express handler.

### Frontend

- Single page (`index.html`). State machine per session:

  ```
  loading → ready
  ready   → (submit)   → ready (on success, re-fetch + render)
  ready   → (submit)   → ready + inline-error (on 400/409)
  ready   → (delete)   → ready (on success, re-fetch + render)
  ready   → (network)  → ready + inline-error ("network error")
  ```

- Inline error slot is a single `<p class="error">` element above the
  list, populated on validation/duplicate/network failure and cleared
  on the next successful action or form input event.
- No optimistic updates: the list re-renders only after the server
  confirms. Avoids needing rollback logic on failure.
- Open-in-new-tab is pure HTML: each row's title is an `<a href="…"
  target="_blank" rel="noopener noreferrer">`. No JS handler.

## Constraints

- **Language:** TypeScript everywhere (`"strict": true` in
  `tsconfig.json`). No plain `.js` source files (`public/main.js` is a
  generated artefact, not a source file).
- **Runtime:** Node ≥ 20 (for built-in `fetch`, `--import`, stable
  test runners). Single process.
- **Backend libs:** `express` (HTTP), `better-sqlite3` (persistence),
  `tsx` (TS execution at runtime for `npm start`). No ORM.
- **Frontend libs:** none. Vanilla TS + DOM.
- **Build:** `esbuild` only. No webpack, no Vite, no Rollup.
- **Tests:** `vitest` + `supertest` for HTTP-level tests.
- **Workspace isolation (HARNESS-DIRECTIVE):** every deliverable file
  lives strictly under `.loom/baseline-1779002783-1/app/`. Nothing is
  written to the repo root, `orchestrator/`, or any sibling workspace.
  `npm start` and `npm test` are invoked from `./app/`.
- **Network:** loopback only, port 3000, single origin. No CORS
  middleware (not needed — same origin). No external network calls at
  runtime.
- **Performance envelope:** single-user local; expected list size
  O(hundreds), absolute ceiling O(thousands). `GET /api/bookmarks`
  returns the full list every time; no pagination.
- **Security envelope:** no auth (local-only). Trust boundary is the
  loopback interface. URLs are output to the DOM via `textContent` and
  `href`; the validator restricts protocols to `http:`/`https:` so
  `javascript:` URIs cannot become clickable links.

## Architecture decisions

### ADR-001: Single Express process serves API and static frontend

- **Context:** The seed pins a single-origin app on `http://localhost:3000` and forbids a separate frontend dev server. Two-process setups (e.g. Vite dev server proxying to Express) add a port, a proxy config, and a CORS story.
- **Decision:** One Express process mounts `/api/*` JSON routes and `express.static('public')` for the bundled frontend. `npm start` runs an esbuild step then boots the server; no watcher, no HMR.
- **Rationale:** Matches seed constraint verbatim. Eliminates CORS, proxy, and dual-port concerns. Smallest possible operational surface for a local-only app.
- **Alternatives:** (a) Separate Vite dev server with Express proxy — rejected; doubles processes and contradicts "same origin." (b) Server-rendered HTML with no client bundle — rejected; would still need JS for delete/POST handlers, and the seed pins esbuild bundling.

### ADR-002: Synchronous `better-sqlite3` API, no async wrapper

- **Context:** `better-sqlite3` exposes a synchronous API by design. Wrapping it in promises adds latency and complicates stack traces with no upside for a single-user single-process app.
- **Decision:** The persistence layer (`BookmarksRepo`) exposes synchronous methods (`listAll(): Bookmark[]`, `insert(...): Bookmark`, `deleteById(...): void`). Route handlers call them directly inside the Express handler body; only the response is async because Express middleware is async.
- **Rationale:** Idiomatic better-sqlite3 usage. Each request maps to one synchronous DB call under a millisecond; no event-loop starvation risk at the expected scale. Test code is simpler (no `await` on DB operations).
- **Alternatives:** Async wrapper around each statement — rejected; non-idiomatic for better-sqlite3 and adds zero value here.

### ADR-003: esbuild bundles a single IIFE `public/main.js` from `src/web/main.ts`

- **Context:** Seed pins esbuild and forbids frontend frameworks. The frontend is small (one page, one form, one list, one error slot).
- **Decision:** A single esbuild invocation `--bundle --format=iife --target=es2020 --outfile=public/main.js` compiles `src/web/main.ts` plus its imports (`api.ts`, `render.ts`, shared types from `src/server/db.ts`) into one immediately-invoked script tag included from `index.html`. No source maps in shipped output (local-only, no debugging-in-prod concern); maps enabled in dev via env flag if needed.
- **Rationale:** One artefact, one `<script>` tag, no module loader gymnastics. Matches seed constraint and keeps the browser-side surface to a single network request.
- **Alternatives:** ESM modules in the browser (`<script type="module">` per file) — rejected; multiplies requests and requires careful path handling; bundling is what the seed asked for.

### ADR-004: URL uniqueness enforced at the SQLite layer and surfaced as HTTP 409

- **Context:** Q02 mandates rejecting duplicate URLs with an inline error. Two enforcement points are possible: a `SELECT … WHERE url = ?` check before insert, or a SQLite `UNIQUE` constraint that throws on conflicting insert.
- **Decision:** Declare `url TEXT NOT NULL UNIQUE` in the schema. The insert prepared statement catches better-sqlite3's `SqliteError` with code `SQLITE_CONSTRAINT_UNIQUE` and throws `DuplicateUrlError`. The Express error handler maps it to `409 { error: "duplicate", … }`. The frontend keys off `error === "duplicate"` to render the inline duplicate message.
- **Rationale:** Database-level uniqueness is the single source of truth; no TOCTOU window between check and insert. The `error: "duplicate"` literal is a stable machine signal for the frontend; the human-readable `message` field is decoupled and can change without breaking the contract.
- **Alternatives:** Pre-check via SELECT — rejected; race-prone in principle and redundant when SQLite already enforces it. Application-level uniqueness only (no UNIQUE constraint) — rejected; weakens the data invariant.

### ADR-005: Tests run against `:memory:` SQLite plus a file-backed round-trip

- **Context:** Vitest is pinned. The DB layer needs unit tests; the HTTP layer needs end-to-end tests; the file-backed durability claim needs at least one explicit test.
- **Decision:** Three test files. `validate.test.ts` is pure-function unit tests. `db.test.ts` opens `openDb(':memory:')` for fast tests, plus one test that opens a temp-file DB, writes a row, closes, reopens, and asserts the row survives. `api.test.ts` uses supertest against `buildApp(openDb(':memory:'))` for full request/response coverage of all endpoints and status codes.
- **Rationale:** `:memory:` keeps the suite fast and hermetic. The one file-backed test pins the durability claim from the spec ("survives restarts" in US-001). HTTP-level tests via supertest exercise the real Express middleware chain including the error mapper.
- **Alternatives:** All tests file-backed with per-test tmpdirs — rejected; slower with no extra coverage. Mocked DB — rejected; would not catch SQLite constraint behaviour (ADR-004's core invariant).

### ADR-006: `created_at` is a server-assigned ISO-8601 string, ordered with id tie-break

- **Context:** Spec requires newest-first ordering. Two design choices: store an integer epoch-ms or an ISO-8601 string; tie-break or not.
- **Decision:** Store ISO-8601 UTC strings (`new Date().toISOString()`) assigned server-side at insert. List query is `ORDER BY created_at DESC, id DESC` to make same-millisecond inserts deterministic.
- **Rationale:** ISO-8601 strings are human-readable on disk (`sqlite3 bookmarks.db` debugging) and sort lexicographically the same as chronologically. Server-assigned avoids client clock-skew bugs. The `id DESC` tie-break is a one-token addition that prevents flaky test ordering.
- **Alternatives:** Integer epoch-ms — rejected; less greppable on disk for no real benefit. SQLite's `DEFAULT CURRENT_TIMESTAMP` — rejected; SQLite's default format lacks subsecond precision, increasing tie-break frequency.

### ADR-007: Frontend re-fetches the list after each mutation rather than patching locally

- **Context:** After POST or DELETE, the frontend must reflect the new state. Options: optimistic update with rollback on failure, or re-fetch from server.
- **Decision:** After every successful POST or DELETE, call `fetchBookmarks()` and re-render. No client-side list mutation.
- **Rationale:** Server stays authoritative; no rollback logic; the extra GET on localhost is negligible. Keeps the frontend state machine to two states (`loading`, `ready`) without an `optimistic-pending` branch.
- **Alternatives:** Optimistic update — rejected; adds rollback complexity for zero perceptible latency improvement on loopback.

## Alternatives considered

- **Fastify instead of Express.** Rejected — seed pins Express explicitly.
- **`node:sqlite` (Node ≥ 22 built-in) or `sqlite3` (async).** Rejected — seed pins `better-sqlite3`.
- **Vite for the frontend build.** Rejected — seed pins esbuild and forbids substitutions.
- **A frontend framework (React/Preact/Vue/Svelte).** Rejected — seed explicitly forbids frameworks; the UI is one form + one list + one error slot, well within vanilla DOM's comfort zone.
- **Splitting `src/server` and `src/web` into two npm packages (monorepo).** Rejected — single process, single deployable, single `package.json` is simpler and the harness directive treats `./app/` as the single workspace.
- **An ORM (Prisma, Drizzle, Kysely).** Rejected — three prepared statements do not justify a schema-management toolchain, and migration tooling is explicitly out of scope.
- **A request validation library (Zod, Valibot).** Rejected — two fields with trivial rules; a dozen lines of hand-written validation is smaller than the dependency.
- **Server-Sent Events / WebSocket for live list updates.** Rejected — single user, single tab in practice; re-fetch on mutation (ADR-007) is sufficient.
- **PWA manifest / service worker for offline.** Rejected — explicitly out of scope per spec.

## Open ambiguity

None. All five seed-flagged decisions are resolved in `decisions.md`, the
harness directive pins the workspace layout, and the remaining choices
(file layout, error envelope shape, ordering tie-break, test strategy)
are recorded as ADRs above.
