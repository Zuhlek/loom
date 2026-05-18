---
project: baseline-1779111523-1
phase: design
created: 2026-05-18
---

# Design — baseline-1779111523-1

Structural design for the local-only Bookmarks app. Specifies how the
system realises the stories defined in `spec.md` (US-001..US-005)
under the seed-locked stack (TypeScript / Node + Express /
`better-sqlite3` / vanilla-TS + `esbuild` / Vitest). Per the harness
constraint, every deliverable lives under
`.loom/baseline-1779111523-1/app/`.

## System shape

A single Node process serves both the JSON API and the static UI
bundle from `http://localhost:3000`. There are three internal
components and one on-disk artefact:

```
                                   HTTP (same origin, localhost:3000)
                                   │
   ┌───────────────────────────────┴───────────────────────────────┐
   │                       Express HTTP layer                       │
   │   - Static handler   → app/public/*  (index.html, app.js, css) │
   │   - JSON routes      → /api/bookmarks (GET/POST), …/:id (DELETE)│
   └──────────────┬────────────────────────────────────┬───────────┘
                  │                                    │
                  ▼                                    ▼
       ┌─────────────────────┐              ┌───────────────────────┐
       │  Bookmark repository │              │  Validation helpers   │
       │  (sync, better-sqlite3)             │  (URL + title checks) │
       └──────────┬──────────┘              └───────────────────────┘
                  │
                  ▼
       ┌─────────────────────┐
       │  SQLite file on disk │
       │  app/data/bookmarks.sqlite
       └─────────────────────┘

   Client (browser, one tab)
   ─────────────────────────
   index.html  → loads  /public/app.js  (bundled by esbuild)
   app.js      → fetch('/api/bookmarks'…)  → renders list, save form,
                 delete buttons. No framework. No routing.
```

### Components and ownership

| Component | Path (under `app/`) | Owns | Boundary |
| --- | --- | --- | --- |
| Server entrypoint | `src/server/index.ts` | Process lifecycle, port binding, route wiring, static mount, DB open | Imports repository + routes; no business logic of its own |
| HTTP routes | `src/server/routes/bookmarks.ts` | Request parsing, validation invocation, status codes, JSON shape | Calls repository; never touches `sqlite` directly |
| Repository | `src/server/db/bookmarks.ts` | SQL statements, row → DTO mapping, schema migration on open | Only module that imports `better-sqlite3` |
| DB bootstrap | `src/server/db/connection.ts` | Opens the SQLite file, applies the migration on first start, exposes a singleton `Database` handle | Pure infrastructure; no domain knowledge |
| Validation | `src/server/validation.ts` | URL well-formedness, non-empty title/URL, trimming | Pure functions, no I/O |
| Client bundle source | `src/client/main.ts` | DOM mount, fetch calls, list render, form handler, delete handler, error display | Vanilla TS; no framework imports |
| Static assets | `public/index.html`, `public/styles.css` | Markup skeleton, baseline CSS | No JS inline |
| Build glue | `package.json` scripts, `esbuild` config inline in `package.json` or `scripts/build.mjs` | Compiles `src/client/main.ts` → `public/app.js`; runs server via `tsx` | Build-time only |
| Tests | `tests/**/*.test.ts` | Repository round-trip tests, HTTP route tests via supertest-style Express handle | Run in-process; use a temp SQLite file |

### Boundaries

- The repository module is the **only** code allowed to import
  `better-sqlite3`. Routes go through it.
- The client never imports server modules. Communication is HTTP/JSON
  on the same origin.
- Validation lives server-side; the client may do trivial empty-string
  checks for snappier UX but the server is authoritative.

## Interfaces

### HTTP API

All routes are JSON over `http://localhost:3000`. Same-origin; no
CORS configuration is required.

| Method | Path | Request body | Success response | Errors |
| --- | --- | --- | --- | --- |
| `GET` | `/api/bookmarks` | — | `200` `{ bookmarks: Bookmark[] }` — newest-first | — |
| `POST` | `/api/bookmarks` | `{ title: string, url: string }` | `201` `{ bookmark: Bookmark }` | `400` invalid input; `409` duplicate URL |
| `DELETE` | `/api/bookmarks/:id` | — | `204` (no body) | `404` not found |
| `GET` | `/` and `/public/*` | — | `200` static HTML / CSS / JS | — |

Error body shape (uniform):

```ts
type ApiError = {
  error: {
    code: 'invalid_input' | 'duplicate_url' | 'not_found';
    message: string;        // short human-readable
    field?: 'url' | 'title'; // populated for invalid_input / duplicate_url
  };
};
```

`409 duplicate_url` always carries `field: 'url'` so the client can
attach the inline error next to the URL input (US-001 AC2).

### TypeScript signatures

Repository (server-side, synchronous because `better-sqlite3` is
synchronous):

```ts
// src/server/db/bookmarks.ts
export type Bookmark = {
  id: number;
  title: string;
  url: string;
  createdAt: string; // ISO-8601 UTC
};

export type NewBookmark = { title: string; url: string };

export interface BookmarkRepository {
  list(): Bookmark[];                 // newest-first by createdAt then id
  create(input: NewBookmark): Bookmark; // throws DuplicateUrlError | ValidationError
  delete(id: number): boolean;        // true if a row was removed
}

export class DuplicateUrlError extends Error {}
export class ValidationError extends Error {
  constructor(public field: 'url' | 'title', message: string) { super(message); }
}
```

Validation:

```ts
// src/server/validation.ts
export function normaliseInput(raw: { title?: unknown; url?: unknown }):
  { title: string; url: string };       // throws ValidationError
```

Server entry:

```ts
// src/server/index.ts
export function createApp(repo: BookmarkRepository): import('express').Express;
export function start(port?: number): Promise<{ close(): void }>;
```

Client (single file, browser):

```ts
// src/client/main.ts — runs on DOMContentLoaded
type ClientState = { bookmarks: Bookmark[]; saveError?: { field: 'url' | 'title'; message: string } };

async function loadBookmarks(): Promise<void>;
async function saveBookmark(input: { title: string; url: string }): Promise<void>;
async function deleteBookmark(id: number): Promise<void>;
function render(state: ClientState): void;
```

## Data model

One table. No joins, no indices beyond what uniqueness requires.

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  url         TEXT    NOT NULL UNIQUE CHECK (length(trim(url)) > 0),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at_id
  ON bookmarks (created_at DESC, id DESC);
```

Notes:

- `UNIQUE(url)` is the load-bearing invariant for Q02 / US-001 AC2.
  The repository catches the constraint violation
  (`SQLITE_CONSTRAINT_UNIQUE`) and rethrows as `DuplicateUrlError`,
  which the route maps to `409 duplicate_url`.
- `created_at` is an ISO-8601 string for trivial cross-platform
  sortability and deterministic test assertions. `(created_at DESC,
  id DESC)` is the canonical list order; the secondary `id DESC` tie-
  breaks rows created in the same millisecond (relevant for tests).
- DTO mapping converts `created_at` (snake_case) to `createdAt`
  (camelCase) at the repository boundary; SQL columns stay snake_case.

In-memory DTO (wire and domain):

```ts
type Bookmark = {
  id: number;
  title: string;     // trimmed
  url: string;       // trimmed, validated by `new URL(url)`
  createdAt: string; // ISO-8601 UTC, ms precision
};
```

### Persistence layout

```
app/data/bookmarks.sqlite        # canonical store, gitignored
app/data/.gitkeep                # so the directory exists in checkout
```

The DB file path is resolved relative to the server entry's CWD
(`app/`), overridable via `BOOKMARKS_DB_PATH` for tests (each test
creates a temp file).

## Integration points

None. Per `spec.md ## Constraints` "Local-only" and the seed: the
running system makes no outbound network calls and has no third-party
service dependencies. No analytics, no error reporting, no CDN, no
auth provider. The only "integration" is the file system (SQLite
file) and the loopback HTTP socket.

## State and error handling

### Server state machine (per request)

```
        ┌──────────────┐
        │ Request open │
        └──────┬───────┘
               ▼
   ┌──────────────────────┐  invalid     ┌─────────────────────┐
   │ Parse + validate body├─────────────▶│ 400 invalid_input   │
   └──────┬───────────────┘              └─────────────────────┘
          │ valid
          ▼
   ┌──────────────────────┐  UNIQUE viol  ┌─────────────────────┐
   │ Repository.create()  ├──────────────▶│ 409 duplicate_url   │
   └──────┬───────────────┘               └─────────────────────┘
          │ ok
          ▼
   ┌──────────────────────┐
   │ 201 { bookmark }     │
   └──────────────────────┘
```

DELETE: `affected === 0` → `404 not_found`; otherwise `204`.

GET list has no failure mode beyond unexpected DB I/O, which is a
process-fatal condition (corrupt file). The server returns `500`
with a generic message; recovery is out of scope (local laptop, user
restarts).

### Client state machine

```
   idle ── submit form ──▶ saving ──┬── ok ──▶ idle (list re-fetched)
                                   └── 400/409 ──▶ idle (error attached to field)

   idle ── click delete ──▶ deleting ──┬── 204 ──▶ idle (list re-fetched)
                                       └── 404 ──▶ idle (re-fetch list anyway)

   page load ──▶ loading ──┬── ok ──▶ idle (list shown)
                          └── error ──▶ error banner (manual reload)
```

The client always re-fetches the list after a mutation rather than
maintaining a separately-mutated cache; with single-user laptop scale
this is the cheapest correct choice and removes a class of UI/DB
divergence bugs.

### Error catalogue

| Where | Trigger | Surface | Recovery |
| --- | --- | --- | --- |
| Validation | Empty/whitespace title or URL | `400 invalid_input` with `field` | Client highlights field |
| Validation | `new URL(url)` throws | `400 invalid_input` with `field: 'url'` | Client shows "Enter a valid URL." |
| Repository | UNIQUE(url) violation | `DuplicateUrlError` → `409 duplicate_url` | Client shows "Already bookmarked." next to URL |
| Repository | Row not found on delete | `repository.delete()` returns `false` → `404 not_found` | Client re-fetches list (likely already stale) |
| Server bootstrap | DB file cannot be opened/migrated | Process exits non-zero with logged error | User fixes file perms, restarts |
| Client | Network failure | Error banner above list | User reloads page |

## Constraints

Carried forward from `spec.md ## Constraints`; restated here for
downstream phases as the technical envelope.

- **Workspace isolation.** All deliverable files live under
  `.loom/baseline-1779111523-1/app/`. `npm start` and `npm test` run
  from that directory. Nothing is written outside it.
- **Stack lock.** TypeScript everywhere; Node + Express single
  process; `better-sqlite3`; plain HTML/CSS + vanilla TS bundled to a
  single JS via `esbuild`; Vitest. No framework on the frontend, no
  alternative storage, no substitutions.
- **One-command boot.** `npm start` builds the client bundle (if
  stale) and launches the server on `http://localhost:3000`, serving
  the UI from the same origin.
- **One-command test.** `npm test` runs the Vitest suite to a clean
  exit code from `app/`.
- **Local-only.** No outbound network at runtime; no telemetry,
  analytics, or remote logging; no runtime CDN fetches.
- **No auth.** No sessions, identity, or access control. Server binds
  to `localhost`; nothing else.
- **Minimal surface.** Only the four features and their listed
  supporting behaviours. No service worker, PWA manifest, or dark
  mode toggle (unless it falls out of CSS for free).
- **Runtime.** Node 20+ (LTS), `better-sqlite3` 11.x, `express` 4.x,
  `esbuild` 0.20+, `vitest` 1.x or 2.x. TypeScript 5.x.
- **Performance envelope.** Single-user, low-hundreds-of-rows store.
  All DB calls are synchronous; no connection pool. List render is a
  single innerHTML rebuild on every refresh.

## Architecture decisions

### ADR-001: Single Node process serves both API and static UI bundle

- **Context.** The seed mandates `npm start` boots one process on
  `http://localhost:3000` and the UI is served from the same origin.
  Splitting into a separate static dev server (e.g. Vite) would add a
  second process and a framework dependency.
- **Decision.** One Express process mounts a static handler for
  `public/` and the `/api/bookmarks` JSON routes on the same port.
  The client bundle is pre-built into `public/app.js` by `esbuild`.
- **Rationale.** Honours the seed's same-origin / one-command boot
  constraint; avoids CORS; removes a moving part; matches the
  "minimal surface" directive.
- **Alternatives.**
  - *Separate static server + API server.* Rejected: two processes,
    CORS or proxy required, violates one-command boot.
  - *Inline the JS in `index.html` via a `<script>` tag with source.*
    Rejected: still need TypeScript compilation, so `esbuild` runs
    anyway; emitting a real bundle is cleaner.

### ADR-002: `better-sqlite3` synchronous API, no async wrapper

- **Context.** `better-sqlite3` is synchronous by design. We could
  wrap it in `async` functions to "future-proof" or expose a Promise
  API to callers.
- **Decision.** Repository methods are synchronous (`list(): Bookmark[]`,
  `create(...): Bookmark`, `delete(id): boolean`). Express route
  handlers call them directly; no `await`.
- **Rationale.** Single-user, single-process, blocking SQL completes
  in microseconds at this scale. Pretending it's async adds Promise
  bookkeeping for zero benefit and contradicts the library's design.
- **Alternatives.**
  - *Wrap in `async`.* Rejected: ceremony without payoff at this
    scale; complicates tests.
  - *Switch to `sqlite3` (async, callback-based).* Rejected: the seed
    pins `better-sqlite3` explicitly.

### ADR-003: Enforce URL uniqueness in the schema, not just in code

- **Context.** Q02 resolved to "reject duplicate URLs." Uniqueness
  can be enforced (a) only by a pre-INSERT SELECT in the repository,
  or (b) by a `UNIQUE` constraint on the column, or (c) both.
- **Decision.** SQL `UNIQUE(url)`. The repository attempts the
  INSERT and catches `SQLITE_CONSTRAINT_UNIQUE` to raise
  `DuplicateUrlError`. No pre-SELECT.
- **Rationale.** Schema-level uniqueness is atomic, race-free
  (irrelevant here but free), and self-documenting. A pre-SELECT is
  TOCTOU-unsafe in principle and slower in practice.
- **Alternatives.**
  - *Pre-SELECT, no constraint.* Rejected: relies on application
    discipline; the invariant lives in two places.
  - *Both.* Rejected: redundant; the constraint alone suffices.

### ADR-004: Server re-fetch over client-side cache mutation

- **Context.** After a save or delete, the client could (a) mutate
  its in-memory list and re-render, or (b) re-fetch `GET /api/bookmarks`
  and re-render from server truth.
- **Decision.** Re-fetch after every mutation.
- **Rationale.** With one user, one tab, and a tiny dataset, the
  network and DB cost is negligible. Re-fetching keeps the client a
  pure projection of server state and removes a class of "stale
  list" bugs (especially around 404-on-delete, where the local cache
  would have already removed the row).
- **Alternatives.**
  - *Optimistic local mutation.* Rejected: more code, more failure
    modes, no perceptible benefit at this scale.
  - *Server-pushed updates (SSE / WebSocket).* Rejected: single-user,
    single-tab; pushes are pointless.

### ADR-005: ISO-8601 string `created_at` over Unix epoch INTEGER

- **Context.** SQLite has no native timestamp type. We can store
  creation time as an INTEGER (Unix ms) or a TEXT ISO-8601 string.
- **Decision.** TEXT ISO-8601 UTC with ms precision, defaulted via
  `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
- **Rationale.** Round-trips to JS `Date` trivially, sorts
  lexicographically equivalent to chronological, reads cleanly in
  test failures and in a `sqlite3` CLI inspection.
- **Alternatives.**
  - *INTEGER epoch ms.* Rejected: needs conversion in every read,
    less human-readable in DB dumps.
  - *SQLite `CURRENT_TIMESTAMP`.* Rejected: second-precision only;
    tests that create two rows in the same second would tie and rely
    on the secondary `id DESC` index purely for ordering — workable
    but uglier than ms precision.

### ADR-006: WHATWG `URL` constructor for validation, no allow-list

- **Context.** `spec.md ## Open ambiguity` flags URL validation
  strictness as a Design-level decision. Options range from "any
  non-empty string" to RFC-strict to scheme allow-listing.
- **Decision.** Treat input as valid iff (a) trimmed length > 0 and
  (b) `new URL(input)` does not throw. No scheme restriction.
- **Rationale.** WHATWG `URL` is the same parser the browser uses;
  what it accepts is what the click-to-open behaviour (US-003) will
  honour. Scheme allow-listing would surprise the user (e.g.
  rejecting `file://` or custom schemes) for no security gain in a
  single-user local app.
- **Alternatives.**
  - *No validation beyond non-empty.* Rejected: silently saves
    "not a url"; click-to-open does nothing useful.
  - *Allow-list `http:`/`https:` only.* Rejected: surprising and
    over-prescriptive for a personal store.

### ADR-007: One-click delete, no confirmation modal

- **Context.** `spec.md ## Open ambiguity` flags whether delete
  should confirm. The seed pushes for minimal surface.
- **Decision.** One-click delete. No confirmation step, no undo.
- **Rationale.** Single-user, single-laptop, no shared state, easy
  to re-add a wrong delete (Q04 made delete-then-recreate the edit
  path anyway). A modal is UI weight the seed explicitly disclaims.
- **Alternatives.**
  - *Confirmation modal.* Rejected: surface growth.
  - *Soft-delete with undo toast.* Rejected: schema and UI growth
    well beyond the four-feature scope.

### ADR-008: Vanilla DOM rendering via `innerHTML` rebuild

- **Context.** No framework is allowed. The client needs to render a
  list, a form, and handle two mutation events. We could hand-write
  per-row DOM construction (`document.createElement`), use a tiny
  template-string `innerHTML` rebuild, or pull in a microlib.
- **Decision.** Build the list HTML as an escaped template string
  and assign to `listEl.innerHTML` on every render. Wire delegated
  click handlers on the list container (one listener for delete, one
  for open).
- **Rationale.** Fewest moving parts for a list of low-hundreds of
  rows. Escaping is a single helper. Event delegation avoids
  re-binding per row.
- **Alternatives.**
  - *`createElement` per row.* Rejected: more verbose, no observable
    benefit at this size.
  - *Pull in a microlib (`lit-html`, `morphdom`).* Rejected: violates
    the "no framework" stack lock; adds a dependency for no payoff.

### ADR-009: Vitest runs server tests in-process with a temp SQLite file

- **Context.** The HTTP layer is small; we want round-trip coverage
  of `POST → DB → GET` and of error paths (duplicate, 404, invalid)
  without spawning the real server.
- **Decision.** Each test file creates a fresh temp SQLite file
  (e.g. via `node:fs` `mkdtempSync`), passes its path via
  `BOOKMARKS_DB_PATH`, builds the Express app via `createApp(repo)`,
  and exercises it with `supertest` or Node's built-in `fetch`
  against `app.listen(0)`. The temp file is removed in `afterAll`.
- **Rationale.** Fast, hermetic, parallel-safe; tests exercise the
  exact code path `npm start` runs. No mocks of the DB layer.
- **Alternatives.**
  - *In-memory SQLite (`:memory:`).* Acceptable, but we explicitly
    want to exercise the on-disk-file path used by US-005 (restart
    persistence) at least once.
  - *Mock the repository.* Rejected: would miss the UNIQUE constraint
    behaviour that ADR-003 leans on.

## Alternatives considered

Whole-design options weighed and rejected before per-decision ADRs.

- **Static site + JSON file storage (no SQLite).** Drop Express,
  write a `bookmarks.json` from a tiny CLI. Rejected: seed pins
  SQLite + `better-sqlite3` and `npm start` as the boot command.
- **Single-file server (route handlers inline, no repository layer).**
  Tempting at this size, but a repository module gives one clear
  place to enforce the UNIQUE catch (ADR-003) and one obvious seam
  for tests. The cost is one extra file.
- **Server-rendered HTML (no client bundle).** Express renders the
  list view; forms POST and the page reloads. Rejected: the seed
  explicitly requires a vanilla-TS client bundled by `esbuild`,
  which forces a real client. Server-rendering would leave `esbuild`
  with nothing to do.
- **TypeScript compiled ahead-of-time for the server (tsc → dist/).**
  Rejected in favour of running the server via `tsx` (or `node --import
  tsx`) at `npm start`: one fewer build step, no `dist/` to manage,
  matches the "one command" intent. The client still needs `esbuild`
  because the browser cannot consume `.ts`.

## Open ambiguity

None blocking. The three items `spec.md ## Open ambiguity` flagged
are resolved at Design level:

- URL validation strictness → ADR-006 (WHATWG `URL` constructor).
- Delete confirmation → ADR-007 (one-click, no confirmation).
- Inline duplicate error wording → "Already bookmarked." attached to
  the URL field, served as `409 duplicate_url` body
  `error.message`.

No structure-critical questions remain. Plan phase can proceed.
