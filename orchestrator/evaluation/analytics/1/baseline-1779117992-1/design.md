---
project: baseline-1779117992-1
created: 2026-05-18
phase: design
---

# Design — Bookmarks

Structural design for the local-only Bookmarks app specified in `spec.md`.
Specifies component layout, contracts, schema, state, and constraints that
realise stories US-001..US-004. User-facing behaviour is owned by `spec.md`
and is not restated here.

## System shape

Single Node process. Express owns HTTP. `better-sqlite3` owns persistence
(synchronous, in-process, no connection pool). Vanilla TypeScript UI is
bundled by `esbuild` into a single JS file and served as a static asset by
the same Express process on the same origin. There is no separate dev
server, no proxy, no worker, no IPC.

```
.loom/baseline-1779117992-1/app/
├── package.json                # scripts: start, test, build
├── tsconfig.json               # one TS config for server + tests + web
├── esbuild.config.mjs          # bundles src/web/main.ts → public/bundle.js
├── bookmarks.sqlite            # runtime DB file (gitignored, created on boot)
├── src/
│   ├── server.ts               # entrypoint: createApp() + listen(3000)
│   ├── app.ts                  # createApp(db): Express instance (no listen)
│   ├── db.ts                   # openDb(path): Database + migrate()
│   ├── routes/
│   │   └── bookmarks.ts        # GET/POST/DELETE handlers, mounted at /api/bookmarks
│   ├── repo/
│   │   └── bookmarks-repo.ts   # SQL queries; only layer that knows about Database
│   ├── shared/
│   │   └── types.ts            # Bookmark, NewBookmark, ApiError DTOs
│   └── web/
│       ├── index.html          # static page served at GET /
│       ├── styles.css          # plain CSS (system fonts, no toggle)
│       └── main.ts             # client logic, bundled → public/bundle.js
├── public/                     # esbuild output + copied static assets
│   └── bundle.js               # produced by `npm run build`; served at /bundle.js
└── tests/
    ├── repo.test.ts            # repo unit tests against in-memory SQLite
    ├── api.test.ts             # supertest against createApp() with :memory: db
    └── web.test.ts             # smoke test of main.ts render+fetch via jsdom
```

### Component responsibilities

| Component | Owns | Does not own |
| --- | --- | --- |
| `server.ts` | Process bootstrap: open DB, call `createApp`, listen on 3000 | Request handling, SQL |
| `app.ts` | Wires Express middleware, mounts static `/`, mounts `/api/bookmarks`, central JSON error handler | DB lifecycle, HTTP listening |
| `db.ts` | Opens `better-sqlite3` handle, runs idempotent schema migration on boot, exposes typed `Database` | Query execution |
| `routes/bookmarks.ts` | HTTP shape: parse body, validate input, call repo, map repo errors to HTTP status, serialise JSON | SQL, DB connection |
| `repo/bookmarks-repo.ts` | Parameterised SQL only, returns plain `Bookmark` rows, throws typed `DuplicateUrlError` / `NotFoundError` | HTTP, validation, formatting |
| `shared/types.ts` | DTO shapes consumed by both server and web | Logic |
| `web/main.ts` | Render list, handle form submit, handle row open + delete clicks, call `/api/bookmarks` via `fetch` | Storage, routing |
| `web/index.html` + `styles.css` | Static shell, form, list container, empty-state message | Behaviour |

The repo / route split exists so route handlers stay HTTP-shaped and SQL
stays in one file — this is what lets the tests sit at two clean layers
(repo unit + api integration) without spinning up a real port.

## Interfaces

### HTTP API (server)

JSON in, JSON out. Same origin (`http://localhost:3000`). No auth headers,
no cookies, no CSRF (single-user localhost). Content type
`application/json` for all bodies. Error responses share a single shape:
`{ "error": { "code": "<machine_code>", "message": "<human_text>" } }`.

| Method | Path | Request body | Success | Error codes |
| --- | --- | --- | --- | --- |
| GET | `/api/bookmarks` | — | `200` `Bookmark[]` ordered `created_at DESC, id DESC` | — |
| POST | `/api/bookmarks` | `{ title: string, url: string }` | `201` `Bookmark` | `400 invalid_input`, `409 duplicate_url` |
| DELETE | `/api/bookmarks/:id` | — | `204` empty body | `404 not_found` |

`GET /` returns `index.html`. `GET /bundle.js`, `GET /styles.css` and any
other web assets are served as static files from `src/web/` and `public/`
(esbuild output). All other paths return `404`.

### Server function signatures

```ts
// src/db.ts
export function openDb(path: string): Database;       // runs migrations
export const SCHEMA_VERSION = 1;

// src/repo/bookmarks-repo.ts
export interface Bookmark {
  id: number;
  title: string;
  url: string;
  created_at: string;   // ISO-8601 UTC, e.g. "2026-05-18T15:34:33.000Z"
}
export interface NewBookmark { title: string; url: string }

export class DuplicateUrlError extends Error { code = 'duplicate_url' as const }
export class NotFoundError    extends Error { code = 'not_found'    as const }

export function listBookmarks(db: Database): Bookmark[];
export function createBookmark(db: Database, input: NewBookmark): Bookmark; // throws DuplicateUrlError
export function deleteBookmark(db: Database, id: number): void;             // throws NotFoundError

// src/app.ts
export function createApp(db: Database): express.Express;
```

### Client function signatures

```ts
// src/web/main.ts (internal)
async function fetchBookmarks(): Promise<Bookmark[]>;
async function postBookmark(input: NewBookmark): Promise<Bookmark>;  // throws ApiError
async function deleteBookmark(id: number): Promise<void>;            // throws ApiError
function renderList(items: Bookmark[]): void;                        // also renders empty state
function showFieldError(field: 'title' | 'url', message: string | null): void;
function clearFormErrors(): void;
```

### Validation rules (shared semantics)

- `title`: trimmed, length `1..512`. Empty after trim → `400 invalid_input` with `field: "title"`.
- `url`: trimmed, parseable by the WHATWG `URL` constructor, scheme MUST be `http:` or `https:`, total length `1..2048`. Anything else → `400 invalid_input` with `field: "url"`.
- The client performs the same checks before calling `POST` and renders inline errors without hitting the server (US-001 AC 3). The server repeats the checks defensively.

## Data model

Single SQLite database file at `./app/bookmarks.sqlite` (alongside the
running server). The file is created on first boot if missing. Schema
migration runs idempotently on every `openDb` call.

### Schema (DDL)

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_url_unique ON bookmarks(url);
CREATE INDEX IF NOT EXISTS bookmarks_created_at_idx ON bookmarks(created_at DESC, id DESC);
```

Pragmas applied on open: `journal_mode = WAL`, `foreign_keys = ON`,
`synchronous = NORMAL`. WAL is chosen so reads do not block writes during
the rare overlap (the app is single-user but Vitest runs may interleave).

### Row → DTO mapping

The repo returns rows verbatim as `Bookmark`. No camelCase conversion;
column names already match the DTO. `id` is `number` (SQLite INTEGER fits
in JS `number` indefinitely at this scale).

### Ordering

`ORDER BY created_at DESC, id DESC`. The `id DESC` tiebreaker covers the
case where two inserts share the same millisecond (possible under tests).

### Uniqueness

URL uniqueness is enforced by the `bookmarks_url_unique` index. The repo
catches `SQLITE_CONSTRAINT_UNIQUE` and rethrows as `DuplicateUrlError`,
which the route layer maps to `409 duplicate_url`. URLs are stored as the
user typed them, after trimming — no normalisation (no scheme-casing, no
trailing-slash collapsing, no fragment stripping). This is the simplest
rule and matches the user's "save what I typed" expectation; a smarter
canonicaliser is explicitly out of scope (see Alternatives).

## Integration points

None at runtime. The process makes zero outbound network calls. The only
external surface is the browser:

- The browser fetches `/`, `/bundle.js`, `/styles.css` and the JSON API
  from the same origin.
- When the user activates a row's open affordance (US-003), the browser
  opens the bookmark's URL in a new tab. This is a standard
  `<a target="_blank" rel="noopener noreferrer">`; the server is not
  involved.

No telemetry, no analytics, no error reporting service, no PWA manifest,
no service worker.

## State and error handling

### Server state

The server is stateless across requests apart from the open SQLite handle
held in `app.locals.db`. There is no session, no in-memory cache, no
queue. A process restart loses nothing because all state is on disk in
SQLite.

### Client state

`main.ts` keeps the current list in a module-scoped `Bookmark[]`. Mutations
go through three transitions:

```
idle ──submit──▶ submitting ──201──▶ idle (list prepended, form cleared)
                              ──400/409──▶ idle (inline error shown, list unchanged)

idle ──delete──▶ deleting ──204──▶ idle (row removed from local list)
                            ──404──▶ idle (full list refetched to reconcile)
                            ──5xx──▶ idle (inline error banner; list unchanged)
```

There is no optimistic UI: the form clears and the list updates only
after the server's `201` / `204`. This keeps the client trivially
consistent with the server and avoids rollback paths.

### Error mapping

| Failure | Repo | Route | Client |
| --- | --- | --- | --- |
| Empty title | (n/a — validated in route) | `400 invalid_input field=title` | inline error under title field |
| Invalid URL | (n/a — validated in route) | `400 invalid_input field=url` | inline error under URL field |
| Duplicate URL | `DuplicateUrlError` from `SQLITE_CONSTRAINT_UNIQUE` | `409 duplicate_url` | inline error under URL field (US-001 AC 2) |
| Delete missing id | `NotFoundError` (no row deleted) | `404 not_found` | refetch list (US-004 AC 2) |
| DB disk error | propagates | `500 internal_error` (central error handler) | top-of-page error banner; list unchanged |
| JSON parse error | (n/a) | `400 invalid_input` from Express body parser | top-of-page error banner |

The central Express error handler logs to `console.error` and returns the
standard error envelope. No retry, no backoff — single-user local app.

### Startup state machine

```
process start
  → openDb('./bookmarks.sqlite')
      → file missing → create empty file
      → run CREATE TABLE / CREATE INDEX IF NOT EXISTS
  → createApp(db)
  → app.listen(3000)
  → log "Bookmarks listening on http://localhost:3000"
```

If `app.listen` fails (port in use), the process exits with code 1 and a
human message. There is no port-search fallback.

## Constraints

Carried forward from `spec.md § Constraints`:

- **Workspace isolation.** Every deliverable file — including
  `package.json`, `tsconfig.json`, source, tests, `node_modules`,
  `bookmarks.sqlite`, and esbuild output — lives under
  `.loom/baseline-1779117992-1/app/`. Nothing is written outside that
  directory. Both `npm start` and `npm test` are runnable with `./app/`
  as the working directory.
- **Stack pin.** TypeScript everywhere (Node ≥ 20, ES2022 target,
  `module: ESNext`, `moduleResolution: bundler`). Express ^4 for HTTP.
  `better-sqlite3` ^11 for persistence. `esbuild` ^0.24 for bundling.
  `vitest` ^2 for tests. No frontend framework. No alternative
  ORMs / query builders.
- **Run-command pin.** `npm start` runs `node --enable-source-maps
  dist/server.js` after a build step (`npm start` is wired to
  `build && node dist/server.js` so a single command boots cleanly).
  `npm test` runs `vitest run`.
- **Locality.** No outbound network calls from the server. The only
  network surface is `localhost:3000`.
- **No nice-to-haves.** No telemetry, analytics, service worker, PWA
  manifest, or dark-mode toggle. Plain `prefers-color-scheme` rules in
  CSS are allowed only if they cost nothing structurally (a couple of
  `@media (prefers-color-scheme: dark)` blocks).
- **Performance envelope.** Expected dataset: tens to low thousands of
  rows. Full-list `GET` is acceptable; no pagination. Synchronous
  `better-sqlite3` calls are acceptable on the request thread at this
  scale.
- **Security envelope.** Single-user localhost; CORS is locked to same
  origin (Express default). Output is rendered with `textContent` /
  attribute setters — no `innerHTML` for user data. `rel="noopener
  noreferrer"` on every outbound bookmark link.

## Architecture decisions

### ADR-001: Route / Repo split, no service layer

**Context.** The app has four operations across one table. We could put
SQL directly in route handlers, introduce a thin repo, or add a full
service layer between routes and repo.

**Decision.** Two layers: HTTP-shaped route handlers and a single
`bookmarks-repo` module that owns all SQL. No separate service layer.

**Rationale.** The repo boundary lets unit tests hit SQL against an
in-memory SQLite without spinning up Express, and lets API tests use
`supertest` without mocking SQL. A service layer would add a third file
per operation for no behavioural gain at this surface size.

**Alternatives.**
- *SQL inline in routes.* Rejected: makes unit testing the SQL contract
  awkward and entangles HTTP concerns with persistence.
- *Routes → Service → Repo.* Rejected: adds ceremony with nothing to put
  in the middle layer; revisit if business rules grow past trivial
  validation.

### ADR-002: `better-sqlite3` synchronous API, single shared handle

**Context.** `better-sqlite3` is synchronous. The seed pins it. Choices
are: one handle on `app.locals`, a handle per request, or a connection
pool.

**Decision.** Open one `Database` handle in `server.ts`, attach it to
`app.locals.db`, share it across all requests. Tests get their own
`:memory:` handle per `createApp(db)` call.

**Rationale.** `better-sqlite3` is in-process and thread-safe for its
intended single-writer pattern. One handle avoids file-lock churn and
makes WAL behaviour predictable. Per-request handles would create
N opens per page load for no gain.

**Alternatives.**
- *Pool.* Rejected: `better-sqlite3` is synchronous; pooling adds
  complexity with zero throughput benefit at single-user scale.
- *Open per request.* Rejected: slow and fights the WAL design.

### ADR-003: URL uniqueness via UNIQUE index, no normalisation

**Context.** Q02 resolved to reject duplicate URLs. Implementation
options: enforce via app-level pre-check, via a UNIQUE index, or via a
normalisation step (canonicalise URLs before comparison).

**Decision.** Single `UNIQUE INDEX` on `bookmarks(url)`. URLs are stored
verbatim after trimming. The repo translates `SQLITE_CONSTRAINT_UNIQUE`
into `DuplicateUrlError`; the route layer returns `409 duplicate_url`.

**Rationale.** The index is atomic and race-free (the alternative app-
level check has a TOCTOU window). No normalisation matches the user's
literal "save what I typed" expectation and avoids the maintenance burden
of a URL-canonicaliser (scheme, trailing slash, fragment, query order,
percent-encoding all have edge cases).

**Alternatives.**
- *App-level pre-check.* Rejected: race condition under concurrent
  Vitest writes.
- *Canonicalise before comparing.* Rejected: scope creep, surprising to
  the user (`http://x` and `https://x` should remain distinct here).

### ADR-004: Bundle web TS with esbuild, serve from Express

**Context.** The seed pins `esbuild` and "one JS bundle". The build can
run on every `npm start`, on a watch process during dev, or out-of-band.

**Decision.** `npm run build` invokes `esbuild` to produce
`public/bundle.js` from `src/web/main.ts`. `npm start` is wired as
`npm run build && node dist/server.js` so a single command produces a
working app. Express serves `src/web/index.html`, `src/web/styles.css`,
and `public/bundle.js` as static assets.

**Rationale.** One-shot build keeps `npm start` deterministic and avoids
shipping a dev server. Same-origin static serving is the simplest path
to "UI from the same origin" (constraint pin).

**Alternatives.**
- *Watch + dev server.* Rejected: requires a second process and a proxy;
  adds nothing for a single-user app.
- *Pre-built bundle checked into the repo.* Rejected: stale-bundle risk
  and noisy diffs.

### ADR-005: Immutable rows, no PATCH endpoint

**Context.** Q04 resolved to immutability. The API surface either
includes a PATCH route for safety or omits it.

**Decision.** No PATCH route. The API is `GET` / `POST` / `DELETE` only.
No edit affordance in the UI.

**Rationale.** Surface minimisation. Adding a PATCH route purely to
return `405` for it adds nothing; not exposing it is the cleaner contract.

**Alternatives.**
- *Expose PATCH returning 405.* Rejected: documents a feature we
  explicitly don't have; no client will probe it.

### ADR-006: ISO-8601 millisecond timestamps in TEXT

**Context.** SQLite has no native datetime type. We could store epoch
integers, Julian floats, or ISO-8601 text.

**Decision.** `created_at TEXT NOT NULL DEFAULT
(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`. Ordering uses this column with
an `id DESC` tiebreaker.

**Rationale.** ISO-8601 sorts lexicographically the same way it sorts
chronologically, is human-readable in `sqlite3` shell sessions, and
serialises straight to JSON. Millisecond precision avoids equal-timestamp
collisions in tests; the `id DESC` tiebreaker covers the residual case.

**Alternatives.**
- *Epoch integer.* Rejected: not human-readable; needs conversion at
  every boundary.
- *Julian real.* Rejected: lossy and surprising in JSON.

### ADR-007: Same-origin serving, no CORS, no auth

**Context.** The UI and API share an origin by seed pin. CORS could
still be configured permissively to ease debugging.

**Decision.** No CORS middleware. Express defaults reject cross-origin
requests by simply not setting CORS headers. No auth middleware. The
server binds to `0.0.0.0:3000` by default; if the user wants to bind to
localhost only, that is a one-line change but not required by the spec.

**Rationale.** Single-user laptop app; cross-origin access is an
anti-feature. Auth is explicitly out of scope per seed.

**Alternatives.**
- *Permissive CORS.* Rejected: opens the local API to any page in the
  user's browser for no benefit.
- *Bind to 127.0.0.1 only.* Considered; deferred — does not change the
  contract and the seed says "localhost" not "loopback only".

## Alternatives considered

Whole-design options weighed and rejected before the per-decision ADRs:

- **Server-rendered HTML, no JSON API.** Express could render the list
  directly with a template engine and post-redirect-get for mutations.
  Rejected: the seed pins a TypeScript bundle for the frontend, which
  implies a client-side rendering loop and a JSON boundary.
- **SPA with hash routing.** Multiple "pages" (list, detail) via client-
  side routing. Rejected: the spec has one screen; routing is pure
  overhead.
- **ORM (Prisma / Drizzle / Kysely).** Rejected: four queries against
  one table do not justify an ORM. `better-sqlite3` is pinned and its
  raw API is more direct than any wrapper at this size.
- **Separate dev server (Vite) for the frontend.** Rejected: two
  processes and a proxy for a four-feature app. esbuild one-shot is
  enough.
- **In-memory map with periodic flush.** Rejected: SQLite is pinned by
  the seed and gives durability for free; an in-memory cache is
  inversion of the pin.
- **Per-request DB handle.** Rejected: see ADR-002.

## Open ambiguity

None. The seed pinned stack and run surface; Q01–Q05 in `decisions.md`
pinned the four-feature scope; the design above resolves component split,
schema, error envelope, and ordering without inventing new structural
questions. Plan phase can proceed.
