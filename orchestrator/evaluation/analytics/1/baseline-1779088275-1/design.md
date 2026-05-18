---
project: baseline-1779088275-1
phase: design
created: 2026-05-18
---

# Design — baseline-1779088275-1

Technical structure for the single-user, local-only Bookmarks app. User-facing behaviour lives in `spec.md` `## User stories` (US-001..US-004). This document specifies how the system realises those stories.

## System shape

Single Node process running an Express app. The process owns three responsibilities, separated into modules but not into services:

| Component | File location (under `./app/`) | Ownership |
| --- | --- | --- |
| **Server entry / process bootstrap** | `src/server/index.ts` | Boot the HTTP listener on port 3000, wire the route module and the static middleware onto an Express app, open the SQLite connection, install graceful shutdown. Owns the `npm start` contract. |
| **HTTP routes** | `src/server/routes.ts` | Translate HTTP requests into repo calls; produce HTTP responses (status + JSON) per the `Interfaces` section. No SQL. |
| **Bookmark repository** | `src/server/repo.ts` | All SQL. Exposes typed functions over `better-sqlite3` prepared statements. Owns the database schema bootstrap. |
| **Validation** | `src/server/validation.ts` | Pure functions for `parseTitle` and `parseUrl`. Used by routes; no I/O. |
| **Database connection** | `src/server/db.ts` | Opens the `better-sqlite3` handle to `./app/data/bookmarks.db`, runs schema bootstrap on first open, exports the connection. |
| **Static asset middleware** | wired in `src/server/index.ts` | Serves `dist/` (esbuild output) and `public/` (HTML + CSS) from the same origin as the API. |
| **Frontend entry** | `src/client/main.ts` | Bootstraps on `DOMContentLoaded`, owns the in-memory list state, dispatches API calls, renders. Single module — no SPA router, no framework. |
| **Frontend API client** | `src/client/api.ts` | Thin `fetch` wrappers per endpoint, returns parsed JSON or throws a typed `ApiError`. |
| **Frontend render** | `src/client/render.ts` | Pure DOM-construction helpers: `renderList(bookmarks)`, `renderEmptyState()`, `showFormError(field, message)`. No `fetch`. |
| **HTML entry** | `public/index.html` | Static document with the add-form and the `<ul>` mount node. Loads `/dist/main.js` and `/public/style.css`. |
| **CSS** | `public/style.css` | Plain CSS. Includes a `@media (prefers-color-scheme: dark)` block; no toggle. |

### Boundary rules

- Routes call repo functions. Repo never calls routes.
- Validation is pure: routes call it before reaching the repo. Repo trusts its inputs.
- Frontend `main.ts` is the only module that reads/writes the DOM mount roots; `render.ts` returns elements, it does not own the page.
- `db.ts` is the only module that constructs a `better-sqlite3` `Database` instance. Tests open their own in-memory DB via the same constructor (see `Constraints`).

### Build & run topology

- `esbuild` bundles `src/client/main.ts` to `dist/main.js` as an IIFE bundle (no module loader in the browser), bundled once on `npm start` via a `prestart` script, and again under `npm test` if tests touch the bundle (they should not — tests target server-side modules directly).
- `ts-node`-style execution is not used: `tsc --noEmit` runs in `npm test` for type-checking; the server is executed via `node --import tsx src/server/index.ts` (single dev dependency, no compilation step for the server in this trivial app). Tests run under Vitest which transpiles TypeScript natively.
- Single process, single port (3000), single origin. No CORS configuration needed.

## Interfaces

### HTTP API (JSON, same origin)

All endpoints return `application/json`. Request bodies are JSON. Errors return `{ "error": { "code": string, "message": string, "field"?: string } }` with the status codes listed below.

#### `GET /api/bookmarks`

- **Purpose:** Backs US-002 list rendering and the post-mutation refresh path in US-001 / US-004.
- **Request:** no body, no query params.
- **Response 200:** `{ "bookmarks": Bookmark[] }`, ordered by `created_at DESC, id DESC` (tiebreak on identical timestamps).

#### `POST /api/bookmarks`

- **Purpose:** US-001 save.
- **Request body:** `{ "title": string, "url": string }`.
- **Response 201:** `{ "bookmark": Bookmark }` — the persisted row including `id` and `created_at`.
- **Response 400** `code: "INVALID_TITLE"` with `field: "title"`: title is empty/whitespace-only after trim.
- **Response 400** `code: "INVALID_URL"` with `field: "url"`: URL fails the `URL` constructor or its protocol is not `http:` / `https:`.
- **Response 409** `code: "DUPLICATE_URL"` with `field: "url"`: URL exactly equals an already-saved URL.

#### `DELETE /api/bookmarks/:id`

- **Purpose:** US-004 delete.
- **Path param:** `id` — positive integer; non-integer or missing yields 400 `code: "INVALID_ID"`.
- **Response 204:** empty body on successful deletion.
- **Response 204:** empty body when the row does not exist (idempotent no-op success per US-004 AC-3).

### Repository (TypeScript)

```ts
// src/server/repo.ts
export interface Bookmark {
  id: number;
  title: string;
  url: string;
  created_at: string; // ISO-8601 UTC, e.g. "2026-05-18T09:18:00.000Z"
}

export interface BookmarkRepo {
  listAll(): Bookmark[];
  insert(input: { title: string; url: string }): Bookmark;     // throws DuplicateUrlError on UNIQUE violation
  deleteById(id: number): boolean;                              // true if a row was removed, false if no row matched
}

export class DuplicateUrlError extends Error {}

export function createRepo(db: Database): BookmarkRepo;
```

### Validation (TypeScript)

```ts
// src/server/validation.ts
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "INVALID_TITLE" | "INVALID_URL"; field: "title" | "url" };

export function parseTitle(raw: unknown): ParseResult<string>;  // trims; rejects non-string, empty-after-trim
export function parseUrl(raw: unknown): ParseResult<string>;    // requires http:/https:; returns the original (un-normalized) string
```

### Frontend API client (TypeScript)

```ts
// src/client/api.ts
export interface Bookmark { id: number; title: string; url: string; created_at: string; }

export class ApiError extends Error {
  status: number;
  code: string;
  field?: "title" | "url";
}

export function fetchBookmarks(): Promise<Bookmark[]>;
export function createBookmark(input: { title: string; url: string }): Promise<Bookmark>;
export function deleteBookmark(id: number): Promise<void>;  // resolves on both 204 paths
```

### Frontend render module (TypeScript)

```ts
// src/client/render.ts
export function renderList(parent: HTMLElement, bookmarks: Bookmark[]): void;
export function renderEmptyState(parent: HTMLElement): void;
export function showFormError(form: HTMLFormElement, field: "title" | "url" | "form", message: string): void;
export function clearFormErrors(form: HTMLFormElement): void;
```

## Data model

### SQLite schema

One table. The schema is created idempotently on connection open via `CREATE TABLE IF NOT EXISTS`.

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  url         TEXT    NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL          -- ISO-8601 UTC string, populated by the application at insert time
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks (created_at DESC);
```

Notes:

- `url UNIQUE` is the storage-layer enforcement of Q02 (reject duplicates). A SQLite `UNIQUE` violation on insert maps to `DuplicateUrlError` → HTTP 409 `DUPLICATE_URL`.
- `created_at` is application-supplied (`new Date().toISOString()`), not `DEFAULT CURRENT_TIMESTAMP`, so the value is consistent across DB engine versions and trivially mockable in tests.
- `AUTOINCREMENT` is preserved so deleted IDs do not get reused; harmless at single-user scale, and stable IDs survive a reload between delete and re-add of a different bookmark with the same URL.
- The descending-creation-time index is small and matches the only list query (`SELECT … ORDER BY created_at DESC, id DESC`).

### Database file location

- Path: `./app/data/bookmarks.db` (resolved relative to the `./app/` workspace at server boot via `path.resolve(__dirname, '..', '..', 'data', 'bookmarks.db')`).
- The `data/` subdirectory is created at boot if missing.
- Listed in `.gitignore`.

### In-memory state (frontend)

A single module-level variable in `main.ts`:

```ts
let bookmarks: Bookmark[] = [];
```

After every successful mutation (create or delete), the client refetches `GET /api/bookmarks` and re-renders the list from the response. Optimistic UI is **not** used — the list is the single source of truth read straight from the server (no client-side cache invalidation problem to solve, no flicker risk at this scale).

## Integration points

None outside the workspace.

- **Browser ↔ Server:** plain `fetch` on the same origin (`http://localhost:3000`). No WebSocket, no SSE, no third-party API.
- **Server ↔ Disk:** synchronous `better-sqlite3` calls against `./app/data/bookmarks.db`. No other persistence.
- **External network:** zero outbound requests from the server. The only outbound HTTP from the system is the browser's own navigation when the user clicks a bookmark (handled by the browser, not by the app's code).

## State and error handling

### Server-side state

The server holds no state besides the open SQLite connection and the prepared statements cached on it. No sessions, no user objects, no in-memory caches.

### Server-side error pipeline

Each route handler is a small function:

1. Parse and validate inputs via `validation.ts`. On `ok: false`, respond 400 with the `code` and `field` from the parse result.
2. Call the repo.
3. Catch `DuplicateUrlError` from `repo.insert` and respond 409 `DUPLICATE_URL`.
4. Any other thrown error bubbles to a single Express error middleware which logs to `stderr` and responds 500 `{ "error": { "code": "INTERNAL", "message": "Internal server error" } }`. This branch should be unreachable in normal operation; it exists so an unexpected crash returns JSON instead of an Express HTML error page.

### Frontend state machine (per UI interaction)

Three small state machines, all owned by `main.ts`:

**Add form** — states: `idle → submitting → idle` (success path) or `submitting → error(field|form)` (validation/duplicate path) → `idle` on next input. The submit button is disabled in `submitting`. Inline error text is cleared on the next input event for the field that errored.

**List** — states: `loading → ready(items)` on initial fetch, `ready(items) → loading → ready(items')` on refetch after a mutation. While `loading` after the initial fetch, the previous list stays visible (no flash to empty state). On fetch failure, render an inline non-blocking notice above the list ("Couldn't refresh the list — check the server"); the previously-rendered list stays in place.

**Delete control (per row)** — states: `idle → deleting → (row removed from list on next refetch)`. The delete button on a single row is disabled during its own `deleting` state.

### Recovery / failure modes

| Failure | Behaviour |
| --- | --- |
| SQLite open fails at boot | Process exits with non-zero code; stderr carries the error. `npm start` reports the failure. |
| SQLite write fails mid-request (disk full, locked) | 500 `INTERNAL`; row is not persisted; frontend shows the form-level error notice. |
| Frontend `fetch` rejects (server down) | API client throws `ApiError` with `status: 0` and a synthetic `code: "NETWORK"`; UI surfaces the list-level notice or the form-level error as appropriate. |
| Delete on already-deleted row | Repo returns `false`; route still responds 204 (idempotent per US-004 AC-3); list refetch removes the row from the UI. |
| Duplicate URL on insert | Repo throws `DuplicateUrlError`; route responds 409; UI shows inline "This URL is already saved" under the URL field. |
| Type-check failure | `npm test` runs `tsc --noEmit` first and fails the suite. |

## Constraints

Carried forward from `spec.md` and refined here for structural fidelity.

- **Workspace isolation.** Every file written for this run lives under `.loom/baseline-1779088275-1/app/`. Build output, `node_modules`, the SQLite file, and the `data/` subdirectory all stay inside this tree. No writes to repo root, `orchestrator/`, or sibling workspaces.
- **Stack lock.** TypeScript for server and client. Server: Node + Express in a single process. Storage: SQLite via `better-sqlite3`. Frontend: vanilla TypeScript bundled via `esbuild` into one JS file. Tests: Vitest. No framework, no alternate storage layer, no alternate bundler.
- **Run contract.** `npm start` (from `./app/`) bundles the client via a `prestart` esbuild invocation, then boots Express on `http://localhost:3000`. `npm test` (from `./app/`) runs `tsc --noEmit` then `vitest run`.
- **Single origin.** UI and JSON API are served from `http://localhost:3000`. No CORS middleware is installed (none is needed).
- **No auth, no deploy.** No sessions, no users, no Docker, no environment-driven config beyond `PORT` (which defaults to 3000 and is read once at boot).
- **No telemetry, no service worker, no PWA manifest, no dark-mode toggle.** Dark-mode styling falls out of `@media (prefers-color-scheme: dark)` only.
- **URL validation envelope.** `parseUrl` must use the platform `URL` constructor and require `http:` or `https:` protocols. No additional normalization (case-folding, default-port stripping, trailing-slash collapsing) is applied — the stored URL is exactly what the user submitted, and duplicate detection is exact-string equality against that stored value.
- **Title trimming.** `parseTitle` trims leading and trailing whitespace before length check and before persistence.
- **Durability.** Writes are synchronous via `better-sqlite3`. The HTTP response for a successful save/delete is sent after the SQL statement has returned. SQLite journal mode stays at the default (DELETE journal); WAL is not needed at single-user scale.
- **Test isolation.** Server-side tests construct their own `Database(':memory:')` instance via the same `db.ts` factory (factory accepts an optional path; defaults to the on-disk file). The on-disk DB is never touched by the test suite.
- **Performance envelope.** No explicit budget; single-user scale means a few-hundred-row dataset is the upper bound. Index on `created_at DESC` covers the only list query.

## Architecture decisions

### ADR-001: Three-module server split (routes / repo / validation)

**Context.** The server is small enough to fit in one file, but the test surface needs the SQL to be callable without booting Express, and the validation rules need to be unit-testable without HTTP. The seed pins the stack, not the file layout.

**Decision.** Split the server into `routes.ts` (HTTP only), `repo.ts` (SQL only), `validation.ts` (pure functions), and `db.ts` (connection factory). `index.ts` wires them together.

**Rationale.** Each module has a single concern and a single test fixture: validation tests need no fixture, repo tests need an in-memory DB, route tests need a supertest-style fixture on top of the Express app. This keeps the Vitest suite fast and the failure messages local to the layer that broke.

**Alternatives.**

- *Single-file server (`server.ts` containing routes + SQL + validation).* Rejected: forces every test to boot Express, couples SQL test failures to HTTP failures, and makes the dedupe-error mapping harder to assert without an HTTP layer.
- *Service-layer module between routes and repo.* Rejected: at four endpoints with no business logic between input validation and SQL, an extra layer is dead-weight per the no-mockup, no-scaffolding-without-a-consumer feedback.

### ADR-002: Application-supplied `created_at` (TEXT ISO-8601) over `DEFAULT CURRENT_TIMESTAMP`

**Context.** US-002 requires newest-first ordering and US-001 requires a creation timestamp. SQLite offers `DEFAULT CURRENT_TIMESTAMP` (seconds-resolution UTC string) and `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` (millisecond-resolution).

**Decision.** Store `created_at` as a TEXT column whose value is supplied by the application as `new Date().toISOString()` at insert time.

**Rationale.** Two consecutive saves within the same second otherwise tie on `ORDER BY created_at DESC`, which makes the list order undefined without an `id DESC` tiebreak. Millisecond ISO-8601 strings sort lexicographically the same way they sort chronologically and are trivially mockable in tests by stubbing `Date.now()`. The `id DESC` secondary order is retained as belt-and-braces against same-millisecond inserts.

**Alternatives.**

- *`INTEGER` column with `strftime('%s', 'now')`.* Rejected: seconds resolution reintroduces the tie problem.
- *`DEFAULT CURRENT_TIMESTAMP` on the column.* Rejected: still seconds resolution, plus harder to stub deterministically in unit tests.
- *Auto-incrementing `id` as the sort key.* Rejected: conflates identity and time. If a future change ever inserts a backfilled row with an older timestamp, the list would lie.

### ADR-003: UNIQUE constraint on `url` as the dedupe enforcement

**Context.** Q02 chose "Reject duplicate URLs with an inline error". Enforcement can live at the application layer (read-then-insert), the database layer (`UNIQUE` constraint), or both.

**Decision.** Enforce uniqueness with `UNIQUE` at the column level. The repo catches the SQLite constraint error and throws `DuplicateUrlError`; the route translates that to HTTP 409.

**Rationale.** A read-then-insert check has a TOCTOU window even at single-user scale (two browser tabs racing). The `UNIQUE` constraint is the authoritative answer in one round-trip and aligns the storage invariant with the user-visible rule.

**Alternatives.**

- *Application-layer "SELECT then INSERT".* Rejected: TOCTOU race, plus duplicates the rule between code and schema.
- *Both layers.* Rejected: redundant; the schema-layer check is sufficient and the extra read costs latency.

### ADR-004: Vanilla TypeScript frontend with three modules (api / render / main)

**Context.** The seed forbids a framework. The frontend still needs to fetch, render, and respond to user input. We want testable units without pulling in jsdom or a router.

**Decision.** Three small frontend modules: `api.ts` (pure fetch wrappers, no DOM), `render.ts` (pure DOM helpers, no fetch), and `main.ts` (the only module that touches the document, owns local state, wires events). HTML lives in `public/index.html` with the add-form and list mount nodes hand-written.

**Rationale.** `api.ts` and `render.ts` are individually unit-testable (api with `fetch` mocked, render with a happy-dom or jsdom environment if frontend tests are added). `main.ts` is the only module that needs an end-to-end test, and at the seed's scope that test surface is small.

**Alternatives.**

- *Single `main.ts` with everything inline.* Rejected: couples fetch errors to render bugs in test failure output.
- *Web Components.* Rejected: adds a templating surface that the seed didn't ask for and doesn't simplify anything at four-feature scale.

### ADR-005: Refetch-on-mutate (no optimistic UI, no client cache)

**Context.** After a successful POST or DELETE, the UI must reflect the new state (US-001 AC-2 and US-004 AC-2). Two patterns: refetch the full list, or mutate the local array optimistically.

**Decision.** After every successful mutation, the client calls `GET /api/bookmarks` and re-renders the returned list. Local state is replaced wholesale.

**Rationale.** At single-user, single-process scale the refetch is ~free, and it removes a whole class of bugs (client/server drift, partial-update race, ordering-after-insert) for one extra HTTP round-trip the user will not perceive. The list is the server's truth, full stop.

**Alternatives.**

- *Optimistic insert/remove with rollback on error.* Rejected: introduces a rollback path and a drift risk for zero perceived benefit at this scale.
- *Server pushes via SSE/WebSocket.* Rejected: single-user; out of scope; multi-tab sync (e.g. the cross-tab-already-deleted case in US-004 AC-3) is covered by refetch-on-action plus idempotent delete.

### ADR-006: `idx_bookmarks_created_at` on the only ordered query

**Context.** The list endpoint is the only ordered SQL query and runs on every page load and every mutation.

**Decision.** Create `CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks (created_at DESC)` at boot.

**Rationale.** Costs ~nothing at single-user scale, but documents the query pattern in the schema and stays correct if the table ever grows. The cost of not having it is a full table sort on every list fetch.

**Alternatives.**

- *No index, rely on the primary key.* Rejected: PK is on `id`, not `created_at`; the list query would still sort.
- *Index on `(created_at, id)`.* Rejected: marginal gain for an extra column in the index; ordering by `id DESC` as a tiebreak after `created_at DESC` is cheap without it at this scale.

### ADR-007: Single-port single-origin static serving

**Context.** The seed mandates `http://localhost:3000` for both the API and the UI.

**Decision.** Express mounts `express.static('public')` for `index.html` and `style.css`, and `express.static('dist')` for `main.js`. API routes are mounted under `/api/*`. The root route serves `public/index.html`.

**Rationale.** No CORS, no dev-server / prod-server split, no second port. One process, one port, one origin.

**Alternatives.**

- *Vite-style dev server on a separate port with proxying.* Rejected: out of stack (esbuild is mandated, not Vite); adds a second port; would require CORS or a proxy config.
- *Inline the JS in `index.html`.* Rejected: defeats the `esbuild` bundle output as a real artifact; complicates caching headers (which we don't set, but the artifact split is still cleaner).

## Alternatives considered

Whole-design alternatives weighed before the per-decision ADRs:

- **Serverless / static-only with IndexedDB.** Rejected because the seed mandates Node + Express + SQLite. Not viable.
- **Tauri / Electron desktop wrapper.** Rejected because the seed mandates a localhost web app run via `npm start`, not a packaged desktop binary.
- **Two-process split (API server + static file server).** Rejected because the seed mandates single-process Express serving from the same origin.
- **ORM (Drizzle, Prisma, Kysely).** Rejected because the schema is one table with four columns. Hand-written prepared statements via `better-sqlite3` are the smallest surface that meets the requirement; an ORM would add a generator step, a migration tool, and a dependency for negative return at this scope.
- **Frontend in JSX-via-esbuild (no React, just JSX as a templating syntax).** Rejected because it implies either a React-like runtime (forbidden by the seed) or a custom `h()` runtime (a framework by another name). Plain DOM API is shorter than the JSX setup at four-feature scope.

## Open ambiguity

None. The spec plus the ADRs above pin the structural surface; remaining choices (exact CSS, exact `esbuild` flag set, the exact wording of inline error strings, the precise Vitest config object) are implementation details for Build.
