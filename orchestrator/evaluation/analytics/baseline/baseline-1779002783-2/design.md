---
project: baseline-1779002783-2
phase: design
created: 2026-05-17T08:30:00Z
---

# Design — baseline-1779002783-2

Structural design for the local-only Bookmarks web app. Translates the
five accepted user stories (US-001..US-005) and the Q01..Q05 resolutions
into a concrete system shape. User-facing behaviour is owned by
`spec.md`; this document specifies how that behaviour is realised.

## System shape

Single Node + Express process serves both a JSON HTTP API and a static
single-page UI from `http://localhost:3000`. One process, one origin, one
SQLite file. Three internal layers, all in TypeScript:

- **HTTP layer** (`src/server/app.ts`, `src/server/routes/bookmarks.ts`):
  Express application factory, route handlers for `/api/bookmarks*`,
  static file middleware serving `public/`. Owns request parsing,
  response shaping, and HTTP status code selection. Does no SQL.
- **Domain layer** (`src/server/repo/bookmarks.ts`): pure functions over
  the `Database` handle that implement `create`, `list`, `delete`. Owns
  SQL statements (prepared once at module init) and translates SQLite
  errors (notably `SQLITE_CONSTRAINT_UNIQUE`) into typed domain errors
  (`DuplicateUrlError`, `NotFoundError`). No HTTP knowledge.
- **Storage layer** (`src/server/db.ts`): opens the `better-sqlite3`
  database, runs the schema migration on first boot, exports a singleton
  `Database` handle. Path resolution: `BOOKMARKS_DB` env var if set,
  otherwise `./bookmarks.sqlite` resolved relative to `process.cwd()`
  (which is `./app/`).

Frontend is a separate compilation target:

- **Client bundle** (`src/client/main.ts`): vanilla TypeScript compiled by
  `esbuild` into `public/bundle.js`. Renders the list, owns the new-form,
  wires the delete button, and surfaces inline errors. No framework.
- **Static shell** (`public/index.html`, `public/styles.css`): minimal
  HTML page with a form, an empty `<ul id="bookmarks">`, and an
  `<aside id="error">` for inline errors. CSS is hand-written, no
  preprocessor.

Server entry point (`src/server/index.ts`) wires `db.ts` into
`app.ts`, runs the esbuild step before listen if `public/bundle.js` is
absent (so `npm start` works after a clean clone), and calls
`app.listen(3000)`.

### Component ownership

| Component | Path | Owns |
| --- | --- | --- |
| HTTP routes | `src/server/routes/bookmarks.ts` | Request validation, status codes, response shape |
| Repository | `src/server/repo/bookmarks.ts` | SQL, prepared statements, domain errors |
| Storage init | `src/server/db.ts` | Connection, migration, file path |
| App factory | `src/server/app.ts` | Express wiring, middleware order, static |
| Entry point | `src/server/index.ts` | Bootstrap, build-if-missing, listen |
| Client app | `src/client/main.ts` | Fetch, render, form, delete, error UI |
| Static shell | `public/index.html`, `public/styles.css` | DOM skeleton, styles |
| Build script | `scripts/build-client.mjs` | esbuild invocation for client bundle |

### Boundaries

- **HTTP ↔ Domain:** routes call repository methods; repository never
  imports `express`. Domain errors are thrown, caught in a single error
  middleware (or a small `try/catch` wrapper per handler) and mapped to
  status codes.
- **Domain ↔ Storage:** repository module receives the `Database` handle
  by import from `db.ts`; tests substitute by setting `BOOKMARKS_DB` to
  `:memory:` and re-importing.
- **Client ↔ Server:** strictly via the JSON API on the same origin. No
  shared TypeScript types at runtime; both sides re-declare the
  `Bookmark` shape from the API contract below. (Optionally, a
  `src/shared/types.ts` is imported by both — see ADR-005.)

## Interfaces

### HTTP API

Base path: `/api/bookmarks`. All bodies are JSON; `Content-Type:
application/json` required on writes.

#### `GET /api/bookmarks`

- **Response 200:** `{ "bookmarks": Bookmark[] }` — array ordered by
  `created_at DESC, id DESC`. Empty array if none.
- **Errors:** none expected; 500 on storage failure.

#### `POST /api/bookmarks`

- **Request body:** `{ "url": string, "title": string }`
- **Response 201:** `{ "bookmark": Bookmark }` — the newly created row.
- **Response 400:** `{ "error": { "code": "invalid_input", "message": string, "field": "url" | "title" } }`
  when `url` is empty / not a syntactic `http(s)://` URL, or `title` is
  empty / whitespace-only.
- **Response 409:** `{ "error": { "code": "duplicate_url", "message": string, "url": string } }`
  when the `url` already exists.
- **Response 415:** when `Content-Type` is not JSON.

#### `DELETE /api/bookmarks/:id`

- `:id` is a positive integer.
- **Response 204:** empty body on success.
- **Response 400:** `{ "error": { "code": "invalid_id" } }` when `:id` is
  not a positive integer.
- **Response 404:** `{ "error": { "code": "not_found", "id": number } }`
  when no row matches.

#### `Bookmark` shape (response)

```ts
type Bookmark = {
  id: number;           // SQLite ROWID
  url: string;          // canonical http(s) URL
  title: string;        // trimmed, non-empty
  createdAt: string;    // ISO 8601 UTC, e.g. "2026-05-17T08:30:00.000Z"
};
```

### Server-side function signatures

```ts
// src/server/db.ts
export function openDatabase(path?: string): import('better-sqlite3').Database;
export function migrate(db: Database): void;
export const db: Database; // module-level singleton

// src/server/repo/bookmarks.ts
export type BookmarkRow = {
  id: number;
  url: string;
  title: string;
  created_at: string;
};
export class DuplicateUrlError extends Error { url: string; }
export class NotFoundError extends Error { id: number; }
export function createBookmark(db: Database, input: { url: string; title: string }): BookmarkRow;
export function listBookmarks(db: Database): BookmarkRow[];
export function deleteBookmark(db: Database, id: number): void; // throws NotFoundError

// src/server/routes/bookmarks.ts
export function bookmarksRouter(db: Database): import('express').Router;

// src/server/app.ts
export function createApp(db: Database): import('express').Express;

// src/server/validate.ts
export function validateUrl(raw: unknown): { ok: true; value: string } | { ok: false; reason: string };
export function validateTitle(raw: unknown): { ok: true; value: string } | { ok: false; reason: string };
export function parseId(raw: string): number | null;
```

### Client-side function signatures

```ts
// src/client/api.ts
export async function fetchBookmarks(): Promise<Bookmark[]>;
export async function createBookmark(url: string, title: string): Promise<Bookmark>; // throws ApiError
export async function deleteBookmark(id: number): Promise<void>;                      // throws ApiError
export class ApiError extends Error { status: number; code: string; field?: string; }

// src/client/render.ts
export function renderList(container: HTMLElement, bookmarks: Bookmark[]): void;
export function renderError(container: HTMLElement, message: string): void;
export function clearError(container: HTMLElement): void;

// src/client/main.ts (entry)
// Wires DOMContentLoaded → fetchBookmarks → renderList,
// form submit → createBookmark → re-fetch,
// delete click → deleteBookmark → re-fetch.
```

## Data model

### SQLite schema

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_url_unique ON bookmarks(url);
CREATE INDEX IF NOT EXISTS bookmarks_created_at_idx ON bookmarks(created_at DESC, id DESC);
```

- `id` is the public identifier exposed by the API.
- `url` is stored verbatim after trimming. No canonicalisation
  (lowercasing host, stripping trailing slash) — Q02 rejects on
  byte-equal duplicates; tighter canonicalisation is out of scope (see
  ADR-004).
- `title` is stored after trimming. Empty / whitespace-only titles are
  rejected before they reach SQLite.
- `created_at` is generated by SQLite using millisecond-precision ISO
  8601 UTC. This makes ordering deterministic across rapid inserts and
  gives the API a parseable timestamp without server-side clock fiddling.

### Migration

Single forward migration, idempotent (`IF NOT EXISTS`). Runs once on
process boot via `migrate(db)`. No down-migration; no migration table —
the schema is one immutable shape for the lifetime of this project. If
future schema changes are needed, that's a follow-up project.

### Database file path

- Production / `npm start`: `./bookmarks.sqlite` resolved relative to
  `process.cwd()`. Because `npm start` is run from `./app/`, the file
  lives at `.loom/baseline-1779002783-2/app/bookmarks.sqlite`.
- Tests: `:memory:` SQLite instance per test file, created by the test
  helper. No on-disk artefacts from test runs.
- Override hook: `BOOKMARKS_DB` env var overrides the path.

### In-memory state

None. The Express app is stateless; the only mutable state is in SQLite.
A process restart re-opens the same file and resumes serving without
recovery logic (US-005).

## Integration points

None. Single-process, single-user, local-only. The server makes no
outbound network calls at any time:

- No telemetry, analytics, or external asset fetch.
- No service worker, no PWA manifest.
- No CDN: the client bundle and `index.html` are served by the same
  Express process via `express.static('public')`.
- No authentication provider — the loopback origin is the trust
  boundary.

## State and error handling

### Application state machine

The server is effectively stateless past boot. Lifecycle:

1. **Boot:** `index.ts` calls `openDatabase()` → `migrate()` →
   `createApp(db)` → `app.listen(3000)`. Failure to open the SQLite file
   or run the migration causes the process to exit with code 1 and a
   message on stderr; there is no retry.
2. **Steady state:** Express handles requests synchronously against the
   `better-sqlite3` handle (which is itself synchronous). No
   long-running tasks, no background jobs, no connection pool.
3. **Shutdown:** `SIGINT` / `SIGTERM` close the HTTP server, then call
   `db.close()`. No graceful drain needed since requests are synchronous
   and short.

### Per-request error mapping

Single error-handling strategy: route handlers wrap the repository call
in `try`, map known domain errors to status codes, and let unexpected
errors fall through to an Express error middleware that returns 500
with `{ "error": { "code": "internal" } }` and logs the stack to stderr.

| Domain error | HTTP status | API body |
| --- | --- | --- |
| `validateUrl` rejects | 400 | `{ error: { code: "invalid_input", field: "url", message } }` |
| `validateTitle` rejects | 400 | `{ error: { code: "invalid_input", field: "title", message } }` |
| `parseId` rejects | 400 | `{ error: { code: "invalid_id" } }` |
| `DuplicateUrlError` | 409 | `{ error: { code: "duplicate_url", url, message } }` |
| `NotFoundError` | 404 | `{ error: { code: "not_found", id } }` |
| Other `Error` | 500 | `{ error: { code: "internal" } }` |

### Client UI states

The client maintains a tiny three-state UI (no library, just DOM):

- **Loading:** initial fetch in flight. Renders a "Loading…" placeholder
  inside `#bookmarks`.
- **Empty:** fetch returned `[]`. Renders the empty-state copy per
  US-002 AC-2.
- **Populated:** renders `<li>` per bookmark with title (anchor with
  `target="_blank" rel="noopener noreferrer"`), URL text, and a delete
  button.
- **Error overlay:** `#error` is a separate region that surfaces the
  most recent API error (duplicate, validation, not-found). It does
  not replace the list; it appears above the form. Cleared on next
  successful action.

After every successful POST or DELETE, the client re-fetches the full
list. This is acceptable at the expected dataset scale (a few hundred
rows) and removes the need for optimistic update reconciliation logic
(see ADR-006).

### Validation rules (single source of truth)

- `url`: must be a non-empty string of length ≤ 2048 after trimming; must
  start with `http://` or `https://` and parse via `new URL(value)`
  without throwing. Stored exactly as submitted (post-trim).
- `title`: must be a non-empty string of length ≤ 512 after trimming.
  Whitespace-only is rejected.
- `id` (path param): must match `/^[1-9]\d*$/` and parse to a finite
  positive integer.

Both client and server validate; the server is authoritative. Client
validation is a UX nicety, not a security boundary.

## Constraints

Carried forward from `spec.md ## Constraints` and the seed; not relaxed.

- **Language:** TypeScript on server and client. `tsconfig.json` uses
  `"strict": true`, `"target": "ES2022"`, `"module": "NodeNext"` for the
  server compile and `"module": "ESNext"` for the client (esbuild
  handles the client output).
- **Runtime:** Node ≥ 20 (for native fetch in any tests that use it; and
  for `node:test`-compatible behaviour, though we use Vitest).
- **Backend:** Node + Express in a single process. Express 4.x.
- **Storage:** `better-sqlite3`. Synchronous API; chosen over `sqlite3`
  for that synchronous-handle ergonomics and lower latency at this scale.
- **Frontend:** plain HTML + CSS + vanilla TypeScript bundled by
  `esbuild` into one JS file. No React / Vue / Svelte / Solid / Lit / etc.
- **Tests:** Vitest. Both unit (validation, repository against
  `:memory:`) and integration (Express app via `supertest` against
  `:memory:`).
- **Same-origin:** UI and API both served from `http://localhost:3000`
  by the same Express process; no CORS configuration needed.
- **No outbound network at runtime.** No telemetry, no analytics, no
  service worker, no PWA manifest, no external asset fetch.
- **Workspace isolation:** every deliverable file lives under
  `.loom/baseline-1779002783-2/app/`. `npm start` and `npm test` run
  from that directory.
- **Performance envelope:** target dataset is a few dozen to a few
  hundred bookmarks. No pagination, no virtualisation, no caching
  layer. List queries return all rows.
- **Security envelope:** loopback-only single user, no auth. The only
  abuse vector worth handling is link `target="_blank"` reverse
  tabnabbing, mitigated by `rel="noopener noreferrer"` (US-003 AC-2).
  XSS surface: render bookmark titles and URLs via `textContent` /
  setting `href` (which DOM-escapes) rather than `innerHTML`.

## Architecture decisions

### ADR-001: Flat schema, no tags / categories

**Context.** Q01 asked whether bookmarks carry tags, a single category,
or stay flat.

**Decision.** One `bookmarks` table with `(id, url, title, created_at)`.
No `tags`, `categories`, or join tables.

**Rationale.** Q01 resolved to flat list. The user stories (US-002:
"single flat list") and the seed's "small surface" preference both
preclude a filter UI. Adding tags later is a schema migration plus a
filter UI; that's deferred until the user asks for it.

**Alternatives.**
- **Free-form tags (many-to-many).** Rejected: requires `tags` and
  `bookmark_tags` tables, a tag-picker UI, filter chips, and tag-scoped
  list queries. No story demands this.
- **Single category per bookmark.** Rejected: requires a `category`
  column or table, a picker on save, and an implicit "All" filter. Half
  the cost of full tags for none of the requested value.

### ADR-002: Duplicate URLs rejected via `UNIQUE(url)` + 409

**Context.** Q02 asked how duplicate-URL submissions are handled.

**Decision.** `CREATE UNIQUE INDEX bookmarks_url_unique ON
bookmarks(url)`. POST `/api/bookmarks` catches the
`SQLITE_CONSTRAINT_UNIQUE` error and returns 409 with a structured
body. The client surfaces an inline error per US-001 AC-2.

**Rationale.** Q02 resolved to reject-with-inline-error. The DB-level
unique index is the cheapest correctness guarantee; an explicit pre-check
SELECT would race against concurrent inserts (not a real concern at this
scale but still avoidable). The 409 status code is the semantic match.

**Alternatives.**
- **Merge into existing (update title + bump timestamp).** Rejected by
  Q02: silent overwrite is surprising, and the schema would need an
  `updated_at` column and ordering rules.
- **Allow duplicates.** Rejected by Q02: noisy list, no
  deduplication, defeats the "what did I save" use case.
- **Pre-check SELECT before INSERT.** Rejected: race-prone, redundant
  with the unique index, slower in the steady state.

### ADR-003: Immutable bookmarks (no PATCH endpoint)

**Context.** Q04 asked whether `url` / `title` can be edited after
creation.

**Decision.** No edit endpoint. Bookmarks are immutable; corrections are
delete-and-recreate.

**Rationale.** Q04 resolved to immutable. Editing adds a PATCH route,
unique-collision handling against the edit, an edit form mode, and
optimistic-update reconciliation — none of which is in scope for the
seed's four-feature surface.

**Alternatives.**
- **`PATCH /api/bookmarks/:id` for partial update.** Rejected by Q04:
  surface area inflation for a workaround (delete+re-add) the user has
  accepted.
- **`PUT /api/bookmarks/:id` for full replace.** Same rejection rationale.

### ADR-004: Byte-equal URL uniqueness, no canonicalisation

**Context.** "Duplicate URL" needs a precise definition. `https://x.com`
and `https://x.com/` and `HTTPS://X.COM` could each be considered the
same or different.

**Decision.** Two URLs are duplicates iff their stored strings are
byte-equal. We trim leading/trailing whitespace on input; we do **not**
lowercase the host, strip the trailing slash, normalise the scheme, or
fold default ports.

**Rationale.** Canonicalisation is a rabbit hole (which form of `%`
encoding wins? does `#` matter? how about `?utm_source=…`?). For a
single-user store at this scale, the user is the only one entering URLs
and can choose a consistent form. Byte-equal matches user expectation
("the same URL I typed before") with zero ambiguity. If false-negative
duplicates become a real problem, ADR-004 is re-opened.

**Alternatives.**
- **WHATWG URL parser canonicalisation.** Rejected: `new URL(x).href`
  does some normalisation (default port, percent-encoding) but not
  case-folding the host; behaviour is subtle and version-dependent. Not
  worth the surprise budget.
- **Aggressive canonicalisation (lowercase host, strip trailing `/`,
  strip query, strip fragment).** Rejected: opinionated; would silently
  collapse URLs the user thinks are distinct (e.g. distinct query
  params on the same page).

### ADR-005: No shared TypeScript types between client and server

**Context.** Both client and server need a `Bookmark` shape. Sharing
types via a common module is convenient but requires the client compile
to reach into a sibling directory.

**Decision.** Client and server each declare their own `Bookmark` /
`ApiError` types locally. The API contract in this document is the
shared specification.

**Rationale.** Two small declarations are cheaper than build-graph
plumbing to share one. The contract is small (4 fields) and stable. If
drift becomes a real problem, introduce `src/shared/types.ts` later.

**Alternatives.**
- **`src/shared/types.ts` imported by both bundles.** Rejected: requires
  esbuild and the server `tsc` to agree on the import path resolution
  and module format. Not zero-cost.
- **Codegen from an OpenAPI document.** Rejected: vastly oversized for
  four endpoints.

### ADR-006: Full re-fetch after mutation (no optimistic UI)

**Context.** After a successful POST or DELETE, the client could
optimistically mutate its local state, or re-fetch from the server.

**Decision.** Re-fetch the full list. No optimistic updates, no diffing.

**Rationale.** Dataset is small; the GET is cheap. Re-fetching keeps the
server as the single source of truth, removes a class of state-drift
bugs (e.g. local state says "created" but the server returned 409), and
simplifies the client.

**Alternatives.**
- **Optimistic insert / remove.** Rejected: needs rollback on error
  paths, especially the 409 duplicate path.
- **Server-sent events / WebSocket push.** Rejected: single user, single
  tab, no concurrent writers — push has nothing to push.

### ADR-007: Synchronous `better-sqlite3` handle, no async wrapper

**Context.** `better-sqlite3` exposes a synchronous API; Express route
handlers conventionally return promises.

**Decision.** Route handlers call repository methods directly
(synchronously) inside an `async` function for try/catch ergonomics, but
do not wrap repository calls in `Promise.resolve` or worker threads.

**Rationale.** Synchronous SQLite calls at this scale are sub-millisecond
and would not benefit from threading. Wrapping them adds noise and
hides errors behind microtask boundaries.

**Alternatives.**
- **`sqlite3` (async).** Rejected by the seed's stack freeze.
- **Worker thread per request.** Rejected: overkill for a single-user
  loopback service.

### ADR-008: Build the client bundle ahead of `npm start`, not on request

**Context.** The client TypeScript needs to be bundled into
`public/bundle.js`. This can happen at install time, at start time, or
on each request.

**Decision.** `npm start` runs `node scripts/build-client.mjs` (which
invokes esbuild) before `app.listen`, and skips it if the output is
newer than the inputs. There is no on-request build, no watch mode in
production.

**Rationale.** One predictable boot path. esbuild on this codebase
finishes in well under a second; doing it on every `npm start` is
imperceptible. A separate `npm run build` script remains available for
explicit rebuilds.

**Alternatives.**
- **Build on every request via middleware.** Rejected: surprise latency,
  extra dependency, no benefit at this scale.
- **Require a separate `npm run build` step before `npm start`.**
  Rejected: violates the seed's "one command to run it" promise.
- **Pre-build and commit the bundle.** Rejected: bundle is workspace-
  scoped output, not source; lives in `.loom/.../app/public/` which is
  inside the workspace.

### ADR-009: Test stack — Vitest + supertest, `:memory:` SQLite per file

**Context.** The seed mandates Vitest. We need both unit coverage on
validation/repository and integration coverage on the HTTP API.

**Decision.** Vitest for both unit and integration tests. HTTP-level
tests use `supertest` against the Express app constructed by
`createApp(openDatabase(':memory:'))`. Each test file gets its own
fresh `:memory:` database.

**Rationale.** Vitest is the seed-frozen test runner; `supertest` is
the de-facto Express HTTP test client. `:memory:` per-file isolation
avoids inter-test contamination without per-test DB teardown overhead.
No on-disk artefacts in `./app/` from test runs.

**Alternatives.**
- **Mock the repository layer in HTTP tests.** Rejected: lower fidelity
  on the integration error paths (the 409 path specifically depends on
  the real `SQLITE_CONSTRAINT_UNIQUE` error).
- **Real on-disk SQLite file per test.** Rejected: slower, leaves
  artefacts unless cleaned up; no benefit over `:memory:` here.

### ADR-010: HTTP API mounted at `/api`, static UI at `/`

**Context.** The client and server share an origin. Routes can be
flat (`/bookmarks`) or namespaced (`/api/bookmarks`).

**Decision.** All JSON endpoints live under `/api/`. The static UI is
served from `/` by `express.static('public')`.

**Rationale.** Namespacing the API prevents path collisions with future
static assets and makes the client's `fetch('/api/bookmarks')` calls
visually distinct from page navigation. Trivial cost.

**Alternatives.**
- **Flat `/bookmarks` routes.** Rejected: minor risk of colliding with
  a future static asset of the same name.
- **Separate ports for UI and API.** Rejected: violates the same-origin
  invariant from the spec.

## Alternatives considered

Whole-design-level options weighed and rejected:

- **Multi-process split (separate API + static servers).** Rejected:
  contradicts the seed's "single process" invariant and adds nothing at
  single-user scale.
- **Server-rendered HTML (templates, no client bundle).** Rejected: the
  seed mandates "vanilla TypeScript compiled to one JS bundle via
  esbuild," which presumes a client-side bundle. SSR-only would
  contradict the stack freeze.
- **ORM / query-builder layer (Knex, Drizzle, Prisma).** Rejected: the
  schema is one table, three operations; raw prepared statements are
  shorter, faster, and have zero migration tooling to learn. The seed
  also names `better-sqlite3` directly, not an ORM.
- **Per-bookmark detail page / route.** Rejected: no story requires it.
  US-003 opens the bookmark in a new tab; that's the only "detail"
  view.
- **Soft delete (`deleted_at` column).** Rejected: US-004 says the row
  disappears on next render; no undo flow is requested. Hard delete is
  simpler and matches user intent.
- **Auth shim "for later".** Rejected: spec explicitly forbids auth,
  multi-user, and network egress. A loopback origin is the trust
  boundary.

## Open ambiguity

None. The five Q01..Q05 resolutions, the stack freeze, the workspace
isolation directive, and the user stories together specify the
structure unambiguously. Remaining decisions (e.g. ADR-004's byte-equal
URL match, ADR-008's build-at-start policy) are resolved here rather
than deferred, with re-open criteria recorded in their Rationale
sections.
