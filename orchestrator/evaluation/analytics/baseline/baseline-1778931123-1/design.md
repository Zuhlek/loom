---
project: baseline-1778931123-1
phase: design
created: 2026-05-16
---

# Bookmarks — Design

Technical structure for the local-only Bookmarks web app specified in
`spec.md`. This document defines how the system realises the five user
stories (US-001..US-005); it does not restate user-facing behaviour.

## System shape

Single Node process serving both an HTTP JSON API and the static UI from
`http://localhost:3000`. Two logical halves run inside the same process:

```
┌──────────────────────── app/ (workspace) ────────────────────────┐
│                                                                  │
│  ┌─────────────────────── Node + Express ─────────────────────┐  │
│  │                                                            │  │
│  │  HTTP layer (src/server.ts)                                │  │
│  │   ├─ static handler  → serves dist/client/* + index.html   │  │
│  │   └─ JSON API router → /api/bookmarks                      │  │
│  │             │                                              │  │
│  │             ▼                                              │  │
│  │  Repository layer (src/db.ts)                              │  │
│  │   ├─ openDb(path) → better-sqlite3 Database               │  │
│  │   ├─ migrate(db)  → creates `bookmarks` table + indices    │  │
│  │   └─ BookmarkRepo { list, create, delete, getById }        │  │
│  │             │                                              │  │
│  │             ▼                                              │  │
│  │  SQLite file  (app/bookmarks.sqlite, gitignored)           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────── Client bundle ──────────────────────┐  │
│  │  src/client/index.html  ← shell loaded by static handler   │  │
│  │  src/client/main.ts     → dist/client/main.js via esbuild  │  │
│  │  src/client/styles.css  → dist/client/styles.css           │  │
│  │                                                            │  │
│  │  main.ts owns:                                             │  │
│  │   ├─ fetchBookmarks()/createBookmark()/deleteBookmark()    │  │
│  │   ├─ render(list)  — DOM-diff-free full re-render          │  │
│  │   └─ form + delete-confirm interaction handlers            │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Components and ownership

| Component | Path | Responsibility | Boundary |
| --- | --- | --- | --- |
| HTTP entrypoint | `app/src/server.ts` | Wire Express, mount static + API routes, listen on 3000 | Owns process lifecycle; delegates persistence to repo |
| API router | `app/src/routes/bookmarks.ts` | Validate request shapes, translate repo errors to HTTP, JSON serialise | Pure adapter between HTTP and repo |
| Repository | `app/src/db.ts` | Prepared statements for all SQL; surface typed errors (`DuplicateUrlError`, `NotFoundError`) | Only module that touches `better-sqlite3` |
| Migration | `app/src/db.ts` (`migrate()`) | Idempotent `CREATE TABLE IF NOT EXISTS` + indices; runs at boot | Called once from `server.ts` before `listen()` |
| Build script | `app/scripts/build-client.ts` | esbuild client entry → `dist/client/main.js`; copy `index.html` + `styles.css` | Invoked by `npm start` and explicitly via `npm run build` |
| Client app | `app/src/client/main.ts` | Fetch list, render, handle form submit + delete | No build-time framework; uses `window.fetch` and DOM APIs |
| Client shell | `app/src/client/index.html` + `styles.css` | Static markup + base styling | Copied verbatim to `dist/client/` |
| Tests | `app/test/*.test.ts` | Vitest unit + integration coverage | Imports server pieces directly; uses temp SQLite files |

### Boundaries (what each layer is forbidden to know)

- The API router does not import `better-sqlite3` — only the repo does.
- The repo does not import `express` — it is plain TypeScript over a `Database` handle, callable from tests without HTTP.
- The client never imports server modules; it talks only over `fetch` to `/api/bookmarks`.
- Nothing outside `app/` is written or read at runtime (workspace isolation).

## Interfaces

### HTTP API

All endpoints are JSON, mounted under `/api`. Same-origin, no auth, no CORS.

| Method | Path | Request body | Success | Error |
| --- | --- | --- | --- | --- |
| `GET` | `/api/bookmarks` | — | `200` `Bookmark[]` ordered `created_at DESC, id DESC` | `500` `{ error }` on DB failure |
| `POST` | `/api/bookmarks` | `{ url: string, title: string }` | `201` `Bookmark` | `400` validation, `409` duplicate, `500` other |
| `DELETE` | `/api/bookmarks/:id` | — | `204` empty | `404` not found, `400` non-integer id, `500` other |

Error envelope (all non-2xx):

```ts
{ error: { code: 'validation' | 'duplicate_url' | 'not_found' | 'internal',
           message: string,
           field?: 'url' | 'title' } }
```

The UI shell is served by Express:

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/` | `index.html` (200, `text/html`) |
| `GET` | `/static/*` | bundled `main.js`, `styles.css` (200, correct MIME) |

### TypeScript signatures

`app/src/types.ts`:

```ts
export interface Bookmark {
  id: number;
  url: string;       // canonical form (see Data model)
  title: string;     // trimmed, non-empty
  created_at: string;// ISO-8601 UTC, e.g. "2026-05-16T11:42:03.123Z"
}

export interface CreateBookmarkInput {
  url: string;
  title: string;
}
```

`app/src/db.ts`:

```ts
export class DuplicateUrlError extends Error { code: 'duplicate_url' }
export class NotFoundError    extends Error { code: 'not_found' }

export function openDb(filePath: string): Database;
export function migrate(db: Database): void;

export interface BookmarkRepo {
  list(): Bookmark[];
  getById(id: number): Bookmark | undefined;
  create(input: CreateBookmarkInput): Bookmark;     // throws DuplicateUrlError
  deleteById(id: number): void;                     // throws NotFoundError
}

export function makeRepo(db: Database): BookmarkRepo;
```

`app/src/routes/bookmarks.ts`:

```ts
export function bookmarksRouter(repo: BookmarkRepo): express.Router;
// Pure: takes a repo, returns a router. No global state. Trivially testable.
```

`app/src/server.ts`:

```ts
export function buildApp(repo: BookmarkRepo): express.Express;
export function startServer(opts?: { port?: number; dbPath?: string }): Promise<Server>;
```

Client API (`app/src/client/api.ts`):

```ts
export async function listBookmarks(): Promise<Bookmark[]>;
export async function createBookmark(input: CreateBookmarkInput): Promise<Bookmark>;
export async function deleteBookmark(id: number): Promise<void>;
// Throws { code, message, field? } on non-2xx so the form can display field-level errors.
```

## Data model

Single table — flat list per Q01.

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL                  -- ISO-8601 UTC
);

CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_url_uniq
  ON bookmarks(url);

CREATE INDEX IF NOT EXISTS bookmarks_created_at_idx
  ON bookmarks(created_at DESC);
```

### Field rules

- `url`: stored in canonical form — parsed with `new URL(input)`, then
  `url.toString()` so trailing slashes / case in host are normalised. Reject
  if parsing throws or the protocol is not `http:` / `https:`.
- `title`: stored after `String.prototype.trim()`. Reject if empty after trim.
- `created_at`: server-generated `new Date().toISOString()` at insert time.
  Never accepted from client input.
- `id`: server-generated; never accepted from client input.

### Uniqueness semantics

`UNIQUE(url)` on the canonical form enforces Q02 at the storage layer.
A `SqliteError` with `code === 'SQLITE_CONSTRAINT_UNIQUE'` from `better-sqlite3`
is caught in the repo and re-thrown as `DuplicateUrlError` so the route layer
can map it to `409`.

Q04 (immutable): no `UPDATE` statement is exposed. After `DELETE`, the URL is
free again (US-004 AC3), which falls out automatically.

### Persistence file

- Path: `app/bookmarks.sqlite` (next to `package.json`).
- Created on first boot via `migrate()`.
- `.gitignore` excludes `*.sqlite`, `dist/`, `node_modules/`.
- Tests use `:memory:` or `node:os.tmpdir()` paths and clean up.

## Integration points

None at runtime. The app is local-only, single-user, no auth, no telemetry,
no external services (confirmed in `repo-context.md`).

Build-time dependencies (npm packages, locked in `package.json`):

| Package | Use | Layer |
| --- | --- | --- |
| `express` | HTTP server | Server |
| `better-sqlite3` | Synchronous SQLite | Server |
| `esbuild` | Client bundling | Build |
| `vitest` | Test runner | Test |
| `supertest` | HTTP integration tests against `buildApp()` | Test |
| `typescript`, `tsx` (or `ts-node`) | TS execution for server + scripts | Build/runtime |
| `@types/express`, `@types/better-sqlite3`, `@types/node` | Types | Build |

No runtime fetches to the public internet from the server or client (the
client only calls same-origin `/api/*`).

## State and error handling

### Server state

The server is effectively stateless above the SQLite file. The only
in-process state is:

- A single `Database` handle (opened at boot, closed on `SIGINT`/`SIGTERM`).
- Prepared statements cached on the repo instance.

### Boot sequence

```
startServer()
  → openDb(dbPath)        // throws → log + exit 1
  → migrate(db)           // idempotent CREATE IF NOT EXISTS
  → makeRepo(db)
  → buildApp(repo)
  → app.listen(port)      // logs "listening on http://localhost:3000"
  → install SIGINT/SIGTERM handler → close server + db
```

`npm start` first invokes `scripts/build-client.ts` (which produces
`dist/client/`), then runs `src/server.ts`. The static handler points at
`dist/client/`.

### Validation pipeline (POST /api/bookmarks)

1. Body shape: must be an object with string `url` and string `title`. Else
   `400 validation`.
2. Trim `title`. Empty after trim → `400 validation` with `field: 'title'`.
3. Parse URL with `new URL(rawUrl)`. Parse failure → `400 validation` with
   `field: 'url'`. Protocol not in `{http:, https:}` → same.
4. Canonicalise to `url.toString()`.
5. `repo.create({ url: canonical, title: trimmed })`.
6. Catch `DuplicateUrlError` → `409 duplicate_url` with
   `field: 'url'` and a message naming the duplicate URL (US-001 AC2).
7. Any other throw → log + `500 internal`.

### Delete pipeline (DELETE /api/bookmarks/:id)

1. Parse `:id` as base-10 integer. NaN or non-positive → `400 validation`.
2. `repo.deleteById(id)`.
3. Catch `NotFoundError` → `404 not_found` (US-004 AC2).
4. Else `204`.

`deleteById` runs `DELETE FROM bookmarks WHERE id = ?`. If `info.changes === 0`,
throw `NotFoundError` — atomic and race-free since `better-sqlite3` is
synchronous.

### Client state

Single in-memory `Bookmark[]` plus a form-error string. Reload-on-write
strategy: after a successful `POST` or `DELETE`, refetch the list and
re-render. No optimistic UI — keeps the client trivial and avoids
divergence on duplicate-URL rejection.

Client states (informal — single component):

| State | Trigger | View |
| --- | --- | --- |
| `loading` | initial load, after mutation | spinner / "Loading…" |
| `empty` | `bookmarks.length === 0` | empty-state message (US-002 AC3) |
| `list`  | `bookmarks.length > 0` | rendered list |
| `error` | fetch/network failure | inline banner with retry |
| `form-error` | `400` / `409` from POST | inline error under offending field |

### Delete confirmation UX

Two-step in-row confirmation (no modal):

1. User clicks `Delete` button on a row.
2. Button swaps to `Confirm delete?` for ~5 seconds. Clicking again confirms;
   clicking elsewhere or waiting cancels.

Rationale: single-user laptop app, no need for a heavyweight modal; `window.confirm`
is acceptable but in-row is cleaner and easier to test deterministically.

### Link safety

Each list row renders the title as `<a href="…" target="_blank" rel="noopener">`
(US-003 AC2). URL is HTML-escaped via `textContent`/`setAttribute` (not
`innerHTML`) to prevent XSS from a hostile pasted URL.

## Constraints

Carried forward from `spec.md` `## Constraints`:

- **Workspace isolation.** Every file written by build, runtime, or tests
  lives under `app/`. The SQLite file is `app/bookmarks.sqlite`; the build
  output is `app/dist/`; `node_modules` is `app/node_modules`.
- **Stack lock.** Node + Express + `better-sqlite3` on the server;
  vanilla TS + esbuild on the client; Vitest for tests. No frameworks added.
- **Single-origin serving.** Static UI and JSON API on `:3000`. No second
  dev server, no CORS middleware.
- **Local-only.** `app.listen(3000)` binds default loopback only — no
  `0.0.0.0`. No telemetry, analytics, service worker, or PWA manifest.
- **One command to run / test.** `npm start` runs build-then-serve; `npm test`
  runs Vitest with a non-zero exit on failure.
- **Persistence across restarts.** Migration is idempotent (`CREATE IF NOT
  EXISTS`), and the SQLite file is not deleted on shutdown.
- **Minimal surface.** Only the four named features ship — no edit, no
  search, no tags, no sort options (Q01, Q03, Q04, Q05).

Runtime envelope:

- Node 20.x or newer (for stable `URL`, `fetch`, ESM/CJS interop).
- `better-sqlite3` requires a native build; documented in `app/README` as a
  prerequisite of `npm install`.
- Performance: list rendering and SQLite scans are O(N) over N bookmarks; at
  the expected scale (tens to low hundreds) no pagination or virtualisation
  is needed.

## Architecture decisions

### ADR-001: Single Express process serves both API and UI

**Context.** The spec requires same-origin serving and one boot command
(US-005, single-origin constraint). Alternatives include splitting into a
separate Vite/esbuild dev server during development.

**Decision.** One Express process. esbuild is invoked once at `npm start`
to produce `dist/client/`; Express serves that directory as static assets.

**Rationale.** Avoids CORS surface, matches the spec literally, keeps the
mental model to one process. The corpus is small enough that lacking HMR
costs almost nothing.

**Alternatives.**
- *Separate dev server (Vite-style proxy).* Rejected: adds a second process,
  reintroduces a CORS or proxy decision, contradicts the single-origin
  constraint.
- *Inline `<script type="module">` with no bundling.* Rejected: the seed
  explicitly requires esbuild bundling to a single JS file.

### ADR-002: Three-layer split — server.ts / routes / db

**Context.** A single-file Express + SQLite app is tempting at this scale,
but tests need to exercise validation and persistence independently.

**Decision.** Three modules: `server.ts` wires the process; `routes/bookmarks.ts`
exposes a `Router` over an injected `BookmarkRepo`; `db.ts` owns all SQL.

**Rationale.** Lets Vitest construct `buildApp(makeRepo(openDb(':memory:')))`
in-process and run integration tests via `supertest` without spawning a
server or touching the disk. Keeps SQL out of the HTTP layer and HTTP out
of the data layer.

**Alternatives.**
- *Single `server.ts` with inline SQL.* Rejected: ties tests to HTTP and disk;
  encourages mixing concerns later.
- *Full DDD layering with services + DTOs.* Rejected: over-engineered for four
  routes against one table.

### ADR-003: Synchronous `better-sqlite3` (not async `sqlite3`)

**Context.** Node SQLite drivers come in two flavours: async callback-based
(`sqlite3`) and synchronous (`better-sqlite3`). The seed names
`better-sqlite3` explicitly.

**Decision.** Use `better-sqlite3`. Repo methods are plain synchronous
functions returning typed results.

**Rationale.** Single-user laptop app, no concurrency pressure. Synchronous
APIs are simpler to test, eliminate a class of race-condition bugs around
`DELETE ... RETURNING changes`, and avoid promise plumbing in route handlers.
Stack lock binds the choice anyway.

**Alternatives.**
- *Async `sqlite3`.* Rejected: not in the locked stack; adds Promise
  noise for no benefit at this scale.

### ADR-004: Server-side URL canonicalisation; UNIQUE index on canonical form

**Context.** Q02 requires rejecting duplicate URLs. Browser users routinely
paste the same logical URL with different trailing slashes or scheme casing,
which would defeat a naive `UNIQUE(url)` constraint.

**Decision.** The server parses `new URL(rawUrl)` and stores `url.toString()`.
The `UNIQUE` index sits on this canonical column. The client sends raw user
input; canonicalisation is the server's job.

**Rationale.** Single canonicalisation point prevents drift between
validation and storage. Using the platform `URL` parser avoids a regex
quagmire. Cases like `HTTPS://Example.com` vs `https://example.com/` collapse
correctly.

**Alternatives.**
- *No canonicalisation, raw URL string.* Rejected: trivially defeated by
  trailing-slash variants — bad UX.
- *Client-side canonicalisation.* Rejected: server still has to validate,
  so client work is duplicative and easy to skip via direct API calls.
- *Application-level duplicate check before INSERT.* Rejected: racy in
  general, and unnecessary given the synchronous driver — but more
  importantly, the UNIQUE constraint is the source of truth even if a
  pre-check existed.

### ADR-005: Reload-on-write client, no optimistic UI

**Context.** After save or delete, the client list must reflect the new
state. Options span from full refetch to local mutation to a hybrid with
rollback on error.

**Decision.** After every successful mutation, refetch `GET /api/bookmarks`
and re-render the list from scratch.

**Rationale.** Eliminates a class of "client thinks it saved but the server
rejected with 409" divergences. The list is small (tens to low hundreds);
a refetch is cheap. The client stays trivially small (no diff engine, no
rollback path), matching the "vanilla TS, no framework" stack lock.

**Alternatives.**
- *Optimistic insert / delete with rollback.* Rejected: extra code paths
  and test cases for a UX improvement that is invisible on `localhost`.
- *Local list mutation from POST response.* Rejected: still needs a
  reorder pass and risks drift if `created_at` formatting differs.

### ADR-006: In-row two-step delete confirmation (no modal, no `window.confirm`)

**Context.** US-004 AC1 says "WHEN the user confirms deletion". The exact
UX is the design's call. Options: `window.confirm`, modal dialog,
in-row toggle.

**Decision.** The row's `Delete` button toggles to `Confirm delete?` for
about five seconds. A second click confirms; clicking elsewhere or letting
the timer elapse cancels.

**Rationale.** No browser-chrome dialog (which is hard to style and
inconsistent across browsers); no extra component (a modal); fully
deterministic in tests (assert button text changes, then click again).
Matches the "minimal surface" constraint.

**Alternatives.**
- *`window.confirm`.* Rejected: blocks the event loop, unstyleable,
  awkward in tests (must stub `window.confirm`).
- *Modal dialog.* Rejected: more DOM, more CSS, no value at this scale.

### ADR-007: Two-process boot via `npm start` — build then serve

**Context.** US-005 AC1 says `npm start` boots the app, building the client
"if needed". esbuild can run as a one-shot script or as a watch process.

**Decision.** `npm start` runs `tsx scripts/build-client.ts` synchronously,
then `tsx src/server.ts`. No watch mode in `start`. A separate `npm run dev`
script (optional) may add `--watch` for the client bundle.

**Rationale.** "Boot the app with one command" is satisfied. Watch mode is
not requested in the spec. Keeping `start` deterministic makes test
ergonomics simpler (a CI-style run is also `npm start` in another shell).

**Alternatives.**
- *Conditional rebuild based on `dist/` mtime.* Rejected: extra logic for
  marginal speedup; rebuild is fast for this codebase.
- *No build, ship raw `.ts` over a runtime transformer.* Rejected: violates
  the "bundled to one JS file via esbuild" stack lock.

## Alternatives considered

Whole-design options weighed and rejected, distinct from per-decision ADRs:

- **Static site + IndexedDB (no server).** Could satisfy "local-only" and
  even simplify deploy. Rejected: the seed names Express and
  `better-sqlite3` — server-side persistence is part of the stack lock,
  and no-server contradicts US-001's "persist to SQLite" criterion.
- **Single bundled monolith file (server + client glued).** Possible with
  `esbuild --bundle src/server.ts`. Rejected: makes tests harder (no
  module-level seams), conflicts with the three-layer split in ADR-002,
  and offers no real benefit.
- **GraphQL or tRPC layer.** Rejected outright: four REST routes against
  one table do not justify the dependency, and the seed asks to minimise
  surface.
- **Frontend framework (React / Vue / Svelte).** Excluded by stack lock; no
  amount of structural benefit overrides that.
- **NoSQL store (lowdb / a JSON file).** Rejected: the seed names SQLite
  via `better-sqlite3` explicitly.

## Open ambiguity

None. All Spec-phase decisions (Q01–Q05) are resolved and incorporated
above. Remaining tactical choices (exact CSS rules, error-message wording,
button copy) are implementation-level and belong to the Build phase.
