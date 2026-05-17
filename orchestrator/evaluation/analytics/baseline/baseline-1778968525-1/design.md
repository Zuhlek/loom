---
project: baseline-1778968525-1
phase: design
created: 2026-05-17
---

# Design — baseline-1778968525-1

## System shape

The deliverable is a single Node.js process that owns both the HTTP API and the static UI assets. All deliverable files live under `./app/` relative to the workspace (i.e. `.loom/baseline-1778968525-1/app/`), per the HARNESS-DIRECTIVE.

Components, owners, and boundaries:

- **HTTP server (`app/src/server/index.ts`)** — Express application factory + bootstrap. Owns route wiring, JSON middleware, and same-origin static serving of the built UI from `app/public/`. Binds to `127.0.0.1:3000` only.
- **Bookmark routes (`app/src/server/routes/bookmarks.ts`)** — Thin Express handlers for the four canonical operations (list, create, delete). Translate HTTP <-> repository calls, map repository errors to HTTP status codes, never touch SQLite directly.
- **Bookmark repository (`app/src/server/repository/bookmarks.ts`)** — Synchronous data-access layer over `better-sqlite3`. Owns all SQL strings and the only references to a `Database` handle. Exposes typed functions (`listBookmarks`, `createBookmark`, `deleteBookmark`). Pure data; no HTTP awareness.
- **SQLite bootstrap (`app/src/server/db/index.ts`)** — Opens the on-disk database file, applies the schema on startup (idempotent `CREATE TABLE IF NOT EXISTS`), and returns a singleton `Database` instance.
- **Validation module (`app/src/server/validation.ts`)** — Pure functions that validate the create-bookmark payload (non-empty title after trim, syntactically valid URL via WHATWG `URL` constructor). Shared by routes; throws typed `ValidationError`.
- **UI bundle source (`app/src/web/main.ts`)** — Vanilla TypeScript entry point. Owns DOM wiring, client-side fetch calls to the API, and rendering. No framework, no client-side router.
- **UI shell (`app/public/index.html`, `app/public/styles.css`)** — Static HTML page that hosts the form + list container, plus a single CSS file. Loads the bundled JS as `<script type="module" src="/app.js">`.
- **Build pipeline (`app/build.mjs` invoked via `npm run build`)** — esbuild script that bundles `src/web/main.ts` to `app/public/app.js` (single output file, ESM, source-mapped). Backend TypeScript is executed via `tsx` (no build step required for the server in dev) or compiled with `tsc` in CI.
- **Test suite (`app/tests/`)** — Vitest specs covering repository (against an in-memory or tmp-file SQLite), validation (pure unit), and HTTP routes (via `supertest` against the Express app).

Boundary rules:

- Routes never construct SQL strings; only the repository does.
- The repository never imports Express types.
- The web bundle never imports server modules; it talks JSON over `fetch`.
- The server makes zero outbound network calls at runtime.

Directory layout (deliverable):

```
app/
  package.json
  tsconfig.json
  build.mjs
  .gitignore
  data/
    bookmarks.sqlite           # created on first boot
  public/
    index.html
    styles.css
    app.js                     # esbuild output (gitignored)
  src/
    server/
      index.ts                 # bootstrap + listen
      app.ts                   # buildApp(db) -> Express
      routes/bookmarks.ts
      repository/bookmarks.ts
      db/index.ts
      validation.ts
      errors.ts
    web/
      main.ts
      api.ts                   # typed fetch wrappers
      dom.ts                   # render helpers
      types.ts                 # shared shapes (Bookmark, ApiError)
  tests/
    repository.test.ts
    validation.test.ts
    routes.test.ts
```

## Interfaces

### HTTP API

All endpoints are JSON over the same origin (`http://localhost:3000`). No authentication.

**`GET /api/bookmarks`**
- Response 200 `application/json`:
  ```json
  { "bookmarks": [ { "id": 1, "title": "Example", "url": "https://example.com", "createdAt": "2026-05-17T10:11:12.000Z" } ] }
  ```
- Order: `created_at DESC, id DESC` (tie-breaker keeps determinism if two rows share a millisecond).

**`POST /api/bookmarks`**
- Request body `application/json`: `{ "title": string, "url": string }`.
- Response 201 `application/json`: `{ "bookmark": Bookmark }` (same shape as list entry).
- Response 400 `application/json`: `{ "error": { "code": "INVALID_TITLE" | "INVALID_URL", "message": string } }` for validation failure.
- Response 409 `application/json`: `{ "error": { "code": "DUPLICATE_URL", "message": "URL already saved" } }` when the URL violates the UNIQUE constraint.

**`DELETE /api/bookmarks/:id`**
- Path param: `id` (positive integer).
- Response 204 (no body) on success.
- Response 404 `application/json`: `{ "error": { "code": "NOT_FOUND", "message": "Bookmark not found" } }` if `id` does not exist.
- Response 400 `application/json`: `{ "error": { "code": "INVALID_ID", "message": string } }` if `id` is not a positive integer.

**Static**
- `GET /` -> `app/public/index.html`.
- `GET /app.js`, `GET /styles.css` -> served from `app/public/` via `express.static`.

### TypeScript module signatures

```ts
// src/server/repository/bookmarks.ts
export interface BookmarkRow {
  id: number;
  title: string;
  url: string;
  created_at: string; // ISO-8601 UTC
}
export interface NewBookmarkInput { title: string; url: string; }

export function listBookmarks(db: Database): BookmarkRow[];
export function createBookmark(db: Database, input: NewBookmarkInput): BookmarkRow;
//   throws DuplicateUrlError when UNIQUE(url) is violated.
export function deleteBookmark(db: Database, id: number): boolean;
//   returns true if a row was deleted, false if id was not present.
```

```ts
// src/server/validation.ts
export function validateNewBookmark(raw: unknown): NewBookmarkInput;
//   throws ValidationError({ code: 'INVALID_TITLE' | 'INVALID_URL', message }).
//   Trims title; rejects empty / whitespace-only.
//   Rejects URL strings that throw from `new URL(value)`.
```

```ts
// src/server/app.ts
export function buildApp(db: Database): express.Express;
//   Pure factory — no side effects beyond route registration. Used by tests.
```

```ts
// src/web/api.ts
export async function fetchBookmarks(): Promise<Bookmark[]>;
export async function createBookmark(input: NewBookmarkInput): Promise<Bookmark>;
//   throws ApiError on non-2xx, carrying { code, message } parsed from the body.
export async function deleteBookmark(id: number): Promise<void>;
```

## Data model

Single table, single SQLite file at `app/data/bookmarks.sqlite`.

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  url        TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks (created_at DESC);
```

Notes:

- `id` is the surrogate key exposed through the HTTP API and used by the delete route.
- `url` is the natural uniqueness key (Q02 → reject duplicates). The UNIQUE constraint is the single source of truth; the application never pre-checks.
- `created_at` is stored as ISO-8601 UTC text so SQLite's lexicographic ordering matches chronological ordering. The default expression on the column means the application can insert without supplying a timestamp; tests may override the value when verifying ordering.
- No `updated_at` (Q04 → immutable).
- `better-sqlite3` is opened with `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` for forward compatibility, though no foreign keys exist today.

Client-side TypeScript shape (mirrors API response, not DB row):

```ts
export interface Bookmark {
  id: number;
  title: string;
  url: string;
  createdAt: string; // ISO-8601 UTC
}
```

UI state (in-memory only, lives in the module closure of `main.ts`):

```ts
type UiState = {
  bookmarks: Bookmark[];   // current list, newest-first
  formError: string | null;
  listError: string | null;
};
```

## Integration points

None. The system is intentionally hermetic:

- **No outbound HTTP** from the server (no favicon fetching, no link health checks — explicitly out of scope).
- **No third-party services** (no auth, no analytics, no error reporting).
- **No external databases** — SQLite file on local disk only.
- **No CDN** — all UI assets served from the Express process (same-origin constraint).
- **Filesystem** is the only external resource: the SQLite file at `app/data/bookmarks.sqlite` and the static asset directory `app/public/`.

## State and error handling

### Server lifecycle states

1. **Boot** — `index.ts` opens the SQLite file (creating it and the `data/` directory if missing), runs the idempotent schema bootstrap, builds the Express app via `buildApp(db)`, and binds to `127.0.0.1:3000`. Any failure here logs and exits with code 1 — there is no retry; the user re-runs `npm start`.
2. **Serving** — steady state. All errors are per-request and never crash the process.
3. **Shutdown** — `SIGINT`/`SIGTERM` close the HTTP listener and the SQLite handle; process exits 0.

### Per-request error taxonomy

| Error class            | HTTP code | API body code     | Source                                  |
| ---------------------- | --------- | ----------------- | --------------------------------------- |
| `ValidationError`      | 400       | `INVALID_TITLE` / `INVALID_URL` / `INVALID_ID` | `validation.ts`         |
| `DuplicateUrlError`    | 409       | `DUPLICATE_URL`   | repository (catches SQLite `SQLITE_CONSTRAINT_UNIQUE`) |
| `NotFoundError`        | 404       | `NOT_FOUND`       | delete route when `deleteBookmark` returns false |
| Unexpected `Error`     | 500       | `INTERNAL`        | global error handler; logs stack server-side |

A single Express error-handling middleware sits at the end of the chain and maps these classes to the response shape `{ "error": { "code", "message" } }`. Routes use `next(err)` rather than handling errors inline.

### UI state machines

**Create-bookmark form** — states: `idle` → `submitting` → (`idle` on success, `error` on failure). The form input is disabled during `submitting`. On `error`, the inline message is rendered next to the form and cleared the next time the user edits either field.

**Bookmark list** — states: `loading` (initial fetch in flight) → `loaded` (renders entries or empty-state message when zero rows) → `error` (renders an inline reload prompt). Successful create prepends to the in-memory array and re-renders without re-fetching (US-002 AC3). Successful delete splices the entry out of the array and re-renders (US-004 AC1); on delete failure, the array is unchanged and an inline error is shown (US-004 AC2).

### Failure modes and recovery

- **SQLite file unwritable on boot** — process exits with a clear log. User remedies filesystem permissions and retries.
- **UNIQUE(url) constraint violation** — repository throws `DuplicateUrlError`; route returns 409; UI renders "URL already saved" inline next to the URL field (US-001 AC4).
- **Server unreachable from the UI** (fetch network error) — UI surfaces an inline error in the relevant region (form or list). The page itself does not reload.
- **Malformed JSON request body** — Express JSON middleware emits a 400; the global error handler normalises it to `{ error: { code: 'INVALID_BODY', message } }`.
- **Concurrent delete of the same id** — second delete returns 404; UI tolerates this (idempotent from the user's perspective).

## Constraints

Pinned by the seed (`spec.md` §Constraints) and inherited unchanged:

- **Workspace isolation:** every deliverable file under `app/` inside this workspace. Nothing written to the repo root or sibling workspaces.
- **Stack:** TypeScript end-to-end. Backend Node + Express, single process. Storage `better-sqlite3` on local disk. Frontend vanilla TS bundled by esbuild into one JS file. Tests Vitest. No framework substitutions.
- **One-command run:** `npm start` from `app/` boots Express on `http://localhost:3000`.
- **One-command test:** `npm test` from `app/` runs Vitest to completion.
- **Local-only:** server binds to `127.0.0.1` only; zero outbound network calls.
- **All state in SQLite:** no in-memory-only or external state.
- **URL uniqueness at schema level:** `UNIQUE(url)` on `bookmarks.url`.
- **Same-origin asset serving:** Express hosts UI and API.
- **Minimum surface:** only save / list / open / delete plus inline validation. No telemetry, analytics, service worker, PWA manifest, dark-mode toggle.

Derived technical envelope:

- **Runtime:** Node.js >= 20 (for the global `fetch`, `URL`, and modern ESM support; `better-sqlite3` prebuilt binaries are available).
- **Module system:** ESM throughout (`"type": "module"` in `package.json`). Server entry executed via `tsx` for `npm start`; bundle output is ESM.
- **Performance envelope:** single-user, expected row count well under 10k. No pagination, no indexing beyond `idx_bookmarks_created_at`.
- **Security envelope:** localhost binding obviates auth/TLS. Links use `target="_blank"` + `rel="noopener noreferrer"` (US-003 AC2). All DB access via parameterised statements (no string interpolation).

## Architecture decisions

### ADR-001: Reject duplicate URLs via SQLite `UNIQUE(url)` constraint

- **Context:** When the user saves a URL already present, the system must respond deterministically. Three reasonable shapes exist: reject, merge (upsert), or allow duplicates. (Q02.)
- **Decision:** Reject. The `bookmarks` table declares `url TEXT NOT NULL UNIQUE`. The repository catches `SQLITE_CONSTRAINT_UNIQUE` and throws `DuplicateUrlError`; the route maps that to HTTP 409; the UI renders "URL already saved" inline next to the URL field.
- **Rationale:** The UNIQUE constraint makes the invariant authoritative at the schema layer rather than at the application layer, eliminating race conditions and pre-check logic. Rejection gives the clearest user feedback and never silently mutates data the user already saved.
- **Alternatives:**
  - *Merge (upsert on URL, overwrite title):* rejected — silently mutates user data; surprising for a single-user tool where the user already knows the row exists.
  - *Allow duplicates (no constraint):* rejected — clutters the chronological list with redundant rows for no benefit in a single-user context.

### ADR-002: Flat single-table schema (no tags, no categories)

- **Context:** Whether bookmarks need organisational metadata beyond title + URL drives schema shape, UI surface, and API surface. (Q01.)
- **Decision:** One `bookmarks` table only. No `tags` table, no `bookmark_tags` join, no `category` column.
- **Rationale:** Matches the seed's "clean four-feature app" bias. Tag / category surfaces (chips, filter bar, manage-tags UI) are out of scope per `spec.md`. A single-table model collapses both API and UI to their minimum.
- **Alternatives:**
  - *Many-to-many tags:* rejected — adds two tables, tag-CRUD endpoints, and filter UI that the spec explicitly excludes.
  - *Single nullable category column:* rejected — still requires a picker + filter affordance not requested.

### ADR-003: Bookmarks are immutable after creation (no update endpoint)

- **Context:** Whether the user can edit a bookmark's title or URL after saving determines whether the API exposes an UPDATE route and whether the UI gains an inline-edit affordance. (Q04.)
- **Decision:** Immutable. The API exposes only `GET`, `POST`, `DELETE`. The list entry has a delete control and no edit control. Corrections are performed by delete + re-add.
- **Rationale:** The seed lists exactly four canonical operations (save, list, open, delete) and conspicuously omits update. Edit-after-create adds an endpoint, validation paths, and an inline-edit state machine for a workflow the seed did not call out.
- **Alternatives:**
  - *Editable with `PATCH /api/bookmarks/:id`:* rejected — expands the surface area beyond the four canonical operations.

### ADR-004: Newest-first only ordering, no sort UI

- **Context:** Sort order drives the default `ORDER BY` and whether a toggle UI exists. (Q05.)
- **Decision:** `ORDER BY created_at DESC, id DESC`. No client-side toggle, no `position` column.
- **Rationale:** Single query path, single visual state. Matches both the recency-driven workflow and the seed's "no UI affordance the user did not ask for" bias. The `id DESC` tie-breaker keeps ordering deterministic when two rows share a millisecond timestamp (relevant in tests).
- **Alternatives:**
  - *Newest-first + alphabetical toggle:* rejected — adds a dropdown, a preference, and a second query path.
  - *Manual drag-reorder with a `position` column:* rejected — large surface (drag-and-drop, persistence) far outside the envelope.

### ADR-005: Chronological list only, no search box

- **Context:** Whether to expose a search input affects both UI (input + result state) and API (a `?q=` filter). (Q03.)
- **Decision:** No search box. The page renders the full list; the user relies on browser-native find (Ctrl/Cmd+F).
- **Rationale:** Single-user, expected row count is small. The flat-list decision (ADR-002) already removed tag-filtering; adding a separate search affordance the user has not validated needing contradicts the "keep surface small" bias.
- **Alternatives:**
  - *Server-side `LIKE` filter via `GET /api/bookmarks?q=`:* rejected — surface the spec did not request.

### ADR-006: Express factory pattern (`buildApp(db)`) for testability

- **Context:** Vitest specs need to exercise the HTTP layer without spinning up a real listener or relying on a shared on-disk SQLite file.
- **Decision:** Split server bootstrap (`src/server/index.ts`) from app construction (`src/server/app.ts`). `buildApp(db)` is a pure function returning an `express.Express` instance; `index.ts` is the only place that calls `app.listen` and opens the production DB. Tests pass a per-test SQLite instance (file in `os.tmpdir()` or in-memory via `:memory:`) to `buildApp` and drive it through `supertest`.
- **Rationale:** Keeps routes free of singleton coupling, lets every test get an isolated database, and removes any need to manage port conflicts in CI.
- **Alternatives:**
  - *Module-level singleton DB imported by routes:* rejected — forces tests to mutate shared state and to mock the module.
  - *Hitting a real listener with a random port:* rejected — adds setup/teardown latency for no benefit over `supertest`'s in-process invocation.

### ADR-007: esbuild for the web bundle; `tsx` for server dev execution

- **Context:** The seed pins esbuild for the frontend bundle. The server is also TypeScript and needs a startup story.
- **Decision:** A small `app/build.mjs` invokes the esbuild Node API to bundle `src/web/main.ts` -> `public/app.js` (ESM, single file, source-mapped). `npm start` first runs the bundle build, then launches the server via `tsx src/server/index.ts`. `npm test` invokes Vitest, which handles its own TS transpilation. No separate `tsc` output directory is required for the runtime path.
- **Rationale:** Honours the esbuild pin for the frontend, avoids a second compile step for the server, and keeps `tsconfig.json` as a type-check / editor concern rather than a build artifact source. `tsc --noEmit` may still run in CI for type safety.
- **Alternatives:**
  - *Compile the server with `tsc` to `dist/` and run `node dist/index.js`:* rejected — adds a build step and a second output tree for a one-command-run app.
  - *Use esbuild for the server too:* rejected — unnecessary; `tsx` is fewer moving parts for a single dev-mode boot.

### ADR-008: Server emits `{ error: { code, message } }`; UI keys off `code`

- **Context:** US-001 AC4 requires a specific inline "URL already saved" message; the UI also needs to distinguish bad-URL, bad-title, and unexpected failures.
- **Decision:** Every non-2xx response carries `{ "error": { "code": string, "message": string } }`. The UI switches on `code` to choose where to render the message (form vs. list region) and may override the displayed string for localisation; it does not parse `message`.
- **Rationale:** Stable machine-readable contract decoupled from human copy. Lets tests assert on `code` rather than on prose.
- **Alternatives:**
  - *Plain-text error bodies:* rejected — couples UI logic to server copy.
  - *HTTP status alone:* rejected — 400 covers multiple distinct validation failures that the UI must route differently.

## Alternatives considered

Whole-design options weighed and rejected before per-decision ADRs:

- **Static-first architecture (no server, IndexedDB in the browser).** Rejected: the seed pins Express + `better-sqlite3` + same-origin serving, and explicitly wants the data file on local disk owned by the user.
- **Monorepo with separate `client/` and `server/` packages.** Rejected: only one process, one bundle, no shared publishable units. A single flat `app/` tree is simpler and matches the workspace-isolation directive.
- **Fastify or Koa instead of Express.** Rejected: the seed pins Express.
- **Knex / Prisma / Drizzle over raw `better-sqlite3`.** Rejected: a single table with three statements does not justify an ORM, and `better-sqlite3` is pinned. Raw parameterised statements keep the dependency surface minimal.
- **Server-rendered HTML (Express templating) instead of a JSON API + client bundle.** Rejected: US-002 AC3 requires prepending a newly saved bookmark "without requiring a full page reload," which implies client-side rendering, and the seed pins esbuild for a TS bundle.
- **WebSockets / Server-Sent Events for real-time list updates.** Rejected: single-user, single-tab assumption; in-memory state plus optimistic prepend is sufficient.

## Open ambiguity

- **SQLite file location.** The seed phrases storage as "file on disk next to the server." Design pins this to `app/data/bookmarks.sqlite` (created at boot if missing), trading "literally next to `index.ts`" for a tidy data directory. If the build phase prefers `app/bookmarks.sqlite` at the workspace root, that is an equivalent satisfaction of the constraint.
- **Server entry execution choice.** Design picks `tsx` for `npm start` to avoid a server compile step. Build phase may substitute `node --import tsx/esm` or a pre-compiled `dist/` output without altering any other decision in this document.
