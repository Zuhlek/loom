---
project: baseline-1779428627-1
phase: design
created: 2026-05-22
---

# Design — baseline-1779428627-1

Technical structure for the local-only Bookmarks app. This document specifies
how the system realises the four `US-NNN` stories in `spec.md` (save, list,
open, delete). User-facing behaviour is owned by `spec.md`; this file owns
component boundaries, contracts, schemas, and structural decisions.

## System shape

Single Node process running Express. Two compile targets share the
TypeScript source tree but are compiled separately and never imported across
the boundary:

- **Server** — Express app, request validation, SQLite access via
  `better-sqlite3`. Owns persistence and the JSON API. Runs as the only
  process started by `npm start`.
- **Client** — plain HTML shell loads one ES module bundle produced by
  `esbuild` from `src/client/main.ts`. Owns DOM rendering and the four user
  interactions. Talks to the server only over `fetch` against same-origin
  relative paths.

Workspace layout (every path relative to `.loom/baseline-1779428627-1/app/`):

```
app/
  package.json             # scripts: start, build, test
  tsconfig.json            # server + shared
  tsconfig.client.json     # DOM lib for the client bundle
  vitest.config.ts
  src/
    server/
      index.ts             # entry: build, listen on :3000
      app.ts               # Express app factory (used by tests)
      db.ts                # better-sqlite3 handle + migration
      routes/
        bookmarks.ts       # POST / GET / DELETE handlers
      validation.ts        # title + url validation
      errors.ts            # typed error -> HTTP mapping
    client/
      main.ts              # entry; wires form, list, delete
      api.ts               # fetch wrapper for the three endpoints
      render.ts            # list + row rendering
      validation.ts        # client-side title/url checks
    shared/
      types.ts             # Bookmark, CreateBookmarkInput, ApiError
  public/
    index.html             # static shell served by Express
    styles.css             # hand-written CSS
  test/
    server/                # vitest specs against app.ts via supertest-like
    client/                # vitest specs against pure render / validation
  scripts/
    build-client.ts        # invokes esbuild
  data/
    bookmarks.db           # created on first run; gitignored
  dist/                    # build output: server JS + client bundle
```

**Ownership boundaries.**

- `src/shared/` is the only module either side may import. Server never
  imports from `src/client/`; client never imports from `src/server/`.
- `db.ts` is the only module that holds a `better-sqlite3` `Database`
  reference. Routes receive a typed repository, not the raw DB, so tests can
  swap it.
- `public/` is static and served via `express.static`. The HTML shell
  references `/assets/main.js` (the esbuild output) and `/assets/styles.css`.

**Process lifecycle.** `npm start` runs `scripts/build-client.ts` (one-shot
esbuild) and then `node dist/server/index.js`, which (1) opens the SQLite
file at `app/data/bookmarks.db`, (2) runs the idempotent schema migration,
(3) constructs the Express app, (4) binds `0.0.0.0:3000`.

## Interfaces

### HTTP API

Same-origin JSON. Request bodies are `application/json`. All responses use
`Content-Type: application/json; charset=utf-8`. The Express `json()`
middleware caps the request body at 16 KiB.

#### `GET /api/bookmarks`

List every bookmark, newest first.

- Request: no body, no query parameters.
- Response `200`: `Bookmark[]` (see Data model). Empty array when none.
- Errors: none from this handler beyond `5xx`.

#### `POST /api/bookmarks`

Create one bookmark.

- Request body:
  ```ts
  { title: string; url: string }
  ```
- Validation (server, authoritative):
  - `title`: non-empty after `String.prototype.trim()`, length ≤ 2048.
  - `url`: parses with the WHATWG `URL` constructor AND the resulting
    `protocol` is `http:` or `https:`. The stored value is the **trimmed
    raw input** (not a normalized form) so the UNIQUE constraint matches
    what the user typed; see ADR-004.
- Response `201`: the created `Bookmark` (with server-assigned `id` and
  `created_at`).
- Response `400` (`code: "validation_error"`): malformed body or invalid
  title / URL. Body: `{ code, message, field? }`.
- Response `409` (`code: "duplicate_url"`): URL already exists in storage.
  Body: `{ code, message }`.

#### `DELETE /api/bookmarks/:id`

Delete one bookmark by id.

- Path param `id`: positive integer; non-integer returns `400`.
- Response `204` on success (no body).
- Response `404` (`code: "not_found"`) when no row with that id exists.

### Repository interface (server-internal)

`routes/bookmarks.ts` does not call `better-sqlite3` directly; it depends on
a `BookmarkRepository` object whose shape is the entire data contract:

```ts
interface BookmarkRepository {
  list(): Bookmark[];                              // ORDER BY created_at DESC, id DESC
  create(input: { title: string; url: string }): Bookmark; // throws DuplicateUrlError
  delete(id: number): boolean;                     // false when no row matched
}
```

`db.ts` exports `openDatabase(filePath: string): { repo: BookmarkRepository; close(): void }`.
The Express factory `createApp(repo: BookmarkRepository): express.Express`
takes the repo by injection so Vitest can use an in-memory SQLite database
(`new Database(':memory:')`) per test.

### Client API client

`src/client/api.ts`:

```ts
async function listBookmarks(): Promise<Bookmark[]>;
async function createBookmark(input: { title: string; url: string }): Promise<Bookmark>;        // throws ApiError on 4xx
async function deleteBookmark(id: number): Promise<void>;                                       // throws ApiError on 4xx
```

`ApiError` carries `{ status: number; code: string; message: string; field?: string }` so
the form can route `duplicate_url` and `validation_error` to inline
messages.

### DOM contract

`public/index.html` ships with these stable hook ids; the client bundle
binds to them by id and otherwise treats the DOM as its own tree:

- `#bookmark-form` — the create form (`<form>`).
- `#bookmark-title` — title input (`<input type="text">`).
- `#bookmark-url` — URL input (`<input type="url">`).
- `#bookmark-submit` — submit button.
- `#form-error` — empty inline error region above the list.
- `#bookmark-list` — the `<ul>` the client renders rows into.
- `#empty-state` — the empty-state node, toggled via a `hidden` attribute.

Each rendered list item is a `<li data-id="<id>">` containing the link
(`<a href target="_blank" rel="noopener noreferrer">`), a secondary line
with the URL, and a delete `<button data-action="delete">`.

## Data model

### SQLite schema (single table)

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  url        TEXT    NOT NULL UNIQUE,
  created_at INTEGER NOT NULL  -- Unix epoch milliseconds, server clock
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at
  ON bookmarks (created_at DESC, id DESC);
```

- `id` is the surrogate key used by the delete route.
- `url` carries a `UNIQUE` constraint; this is the load-bearing piece of
  Q02 (reject-on-duplicate). The SQLite error `SQLITE_CONSTRAINT_UNIQUE`
  surfaces as `DuplicateUrlError` in the repository layer, which the route
  maps to `409`.
- `created_at` is stored as `INTEGER` (epoch ms) — sortable as an integer,
  no timezone ambiguity, no locale parsing. The client formats for display.
- The index gives a stable `ORDER BY created_at DESC, id DESC` for the list
  endpoint and disambiguates rows created in the same millisecond by id.

### Migration

`db.ts` runs the two `CREATE … IF NOT EXISTS` statements on startup inside a
transaction. There is exactly one schema version; no migration table is
needed for v1 (see ADR-003).

### Shared types (`src/shared/types.ts`)

```ts
export interface Bookmark {
  id: number;
  title: string;
  url: string;
  created_at: number;   // epoch ms
}

export interface CreateBookmarkInput {
  title: string;
  url: string;
}

export type ApiErrorCode =
  | "validation_error"
  | "duplicate_url"
  | "not_found";

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  field?: "title" | "url";
}
```

### Client state

The client holds a single in-memory array `bookmarks: Bookmark[]` mirroring
the server list ordering. Mutations (`create`, `delete`) update both server
and array, then re-render the list incrementally:

- After successful create: `unshift` the returned bookmark; prepend its
  `<li>` to `#bookmark-list`.
- After successful delete: remove from array by id; remove the matching
  `<li>` from the DOM.

No global store, no observers — the array is owned by `main.ts`.

## Integration points

None. The system makes no outbound network calls. There are no third-party
services, no SaaS dependencies, no auth providers, no analytics endpoints.
The only external surface is:

- **The filesystem** — `app/data/bookmarks.db` is created and read by
  `better-sqlite3`. The directory is created on startup if missing.
- **The local browser** — same-origin only, no CORS configuration.

This is reaffirmed by the spec constraint "The system shall not make any
outbound network calls at runtime."

## State and error handling

### Server error taxonomy

`src/server/errors.ts` defines:

```ts
class ValidationError extends Error { field?: "title" | "url"; }
class DuplicateUrlError extends Error {}
class NotFoundError extends Error {}
```

A single Express error-handler middleware maps:

| Error                | HTTP | `code`             |
| -------------------- | ---- | ------------------ |
| `ValidationError`    | 400  | `validation_error` |
| `DuplicateUrlError`  | 409  | `duplicate_url`    |
| `NotFoundError`      | 404  | `not_found`        |
| `SyntaxError` (json) | 400  | `validation_error` |
| anything else        | 500  | `internal_error`   |

Unexpected errors log to `stderr` with the stack; never to the response
body. Logging is `console.error` only — no logging framework.

### Repository failure modes

- `create` catches `SQLITE_CONSTRAINT_UNIQUE` and rethrows as
  `DuplicateUrlError`. All other SQLite errors propagate (mapped to 500).
- `delete` returns `false` when `db.prepare(...).run(id).changes === 0`;
  the route turns that into a `NotFoundError`.
- `list` cannot fail under normal conditions; any thrown error is a 500.

### Client states

The client is a small finite set of states per surface:

- **Form state** — `idle | submitting | error(duplicate|validation)`.
  - `submit` button is disabled while `submitting`.
  - `#form-error` shows the message; cleared on next keystroke in either
    input.
  - Successful create resets the form to `idle` and clears the inputs.
- **List state** — `loading | empty | populated`.
  - Initial load: show neither rows nor empty-state until the `GET`
    resolves; render whichever applies. On unexpected fetch failure, show
    a generic "Could not load bookmarks." message in `#form-error` and
    leave the list empty.
- **Row state** — each row is either present or being deleted; the delete
  button is disabled while its DELETE is in flight. On `404` from delete,
  the client treats it as success (the row is already gone) and removes the
  row from the DOM; this aligns the client with eventual server truth.

### Concurrency

`better-sqlite3` is synchronous; Node's single-threaded event loop
serialises requests at the JS layer. No transaction is needed for the
single-row INSERT or DELETE. No write-conflict handling is needed because
there is exactly one writer.

## Constraints

Carried forward from `spec.md` `## Constraints` — these are envelope
conditions on the structure, not duplicated user behaviour.

### Workspace isolation

- All deliverable files (source, tests, build output, `node_modules`, the
  SQLite file) live under `.loom/baseline-1779428627-1/app/`.
- The structure above places `node_modules` and `data/bookmarks.db`
  inside `app/`; `.gitignore` inside `app/` excludes `node_modules/`,
  `dist/`, and `data/`.

### Stack pinning

- TypeScript for every first-party source file (server, client, tests,
  build script). `tsconfig.json` targets `ES2022`; `tsconfig.client.json`
  overrides `lib` to include `DOM`.
- Node + Express, single process. Express version pinned in
  `package.json` (`^4`).
- `better-sqlite3` for persistence; database file at `app/data/bookmarks.db`.
- Client built by `esbuild` to a single `dist/client/main.js` bundle. No
  framework, no CSS framework.
- Vitest as the test runner.

### Runtime

- `npm start` builds the client and starts the server on
  `http://localhost:3000`.
- `npm test` runs Vitest.
- Both commands runnable from `app/`.
- Same-origin: Express serves `/` (HTML), `/assets/*` (bundle and CSS),
  and `/api/*` (JSON API). No CORS middleware.

### Performance

- Expected scale: tens to low hundreds of rows. The `idx_bookmarks_created_at`
  index makes the `ORDER BY` trivially fast at this size.
- Bundle size budget for `dist/client/main.js`: under 30 KiB unminified.
  The codebase has no framework; staying under the budget is a structural
  constraint, not an optimisation goal.

### Security

- `rel="noopener noreferrer"` on every bookmark link (spec US-003 AC2).
- All HTML written by the client uses `textContent` / element creation;
  no `innerHTML` with user input. `url` is set via `element.href = url`,
  which the browser treats as a URL attribute (`javascript:` URLs are
  filtered out at validation time because the server only accepts
  `http:` / `https:` schemes).
- Request body size capped at 16 KiB.
- No secrets, no auth, no PII. The SQLite file lives in the workspace
  and is the user's own data.

## Architecture decisions

### ADR-001: Single Express process serves API and static assets

**Context.** The spec mandates same-origin delivery of the UI and the API
under `npm start`, with no CORS surface. We must decide whether to run a
single Express process or split UI hosting from API.

**Decision.** One Express process. `express.static('public')` serves the
HTML shell and `express.static('dist/client')` serves the built JS/CSS.
`/api/*` is mounted on the same app.

**Rationale.** Matches the spec's "same Express process on the same
origin" constraint literally. One process means one entry point
(`src/server/index.ts`), one port, no process supervisor, no dev/prod
divergence.

**Alternatives.**
- *Separate static server (e.g. Vite dev server) on a different port.*
  Rejected — introduces CORS, contradicts "same Express process".
- *Reverse-proxy Express in front of a static directory.* Rejected —
  unnecessary indirection for a localhost app.

### ADR-002: Repository pattern over direct `better-sqlite3` calls in routes

**Context.** Routes need to persist and read bookmarks. They could call
`better-sqlite3` prepared statements directly, or go through a typed
repository layer.

**Decision.** Introduce a `BookmarkRepository` interface (`list`, `create`,
`delete`) implemented by `db.ts` against `better-sqlite3`. The Express app
factory `createApp(repo)` receives the repository by injection.

**Rationale.**
- Vitest server tests can construct `createApp(openDatabase(':memory:').repo)`
  without touching the real `data/bookmarks.db` file.
- The `SQLITE_CONSTRAINT_UNIQUE` → `DuplicateUrlError` translation happens
  exactly once, inside the repository, instead of being repeated in each
  route.
- Decouples HTTP shape from SQL shape; if the schema changes the routes do
  not.

**Alternatives.**
- *Call `db.prepare(...).run(...)` inline in route handlers.* Rejected —
  forces every test to spin up a real SQLite file and entangles SQL error
  codes with HTTP status mapping.
- *Use a query builder or ORM (Knex, Drizzle, Prisma).* Rejected — three
  hand-written statements do not justify a dependency, and the seed pins
  `better-sqlite3` explicitly.

### ADR-003: No migration framework; single-statement idempotent schema

**Context.** SQLite needs a `bookmarks` table on first boot. Common
choices are a migration framework (Knex migrations, Umzug, etc.) or
inline `CREATE TABLE IF NOT EXISTS`.

**Decision.** Inline `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT
EXISTS` run in `db.ts` at startup, inside one transaction. No migration
table, no version metadata.

**Rationale.** v1 has one table. The spec forbids deferred-feature
scaffolding, including "stubbed endpoints for features that aren't
shipped" — adding a migration framework for one statement falls in the
same category. If a v2 ever needs a real migration, that future iteration
can add the framework as part of its design phase.

**Alternatives.**
- *Knex migrations / Umzug.* Rejected — premature scaffolding.
- *Schema file loaded from disk at startup.* Rejected — same idempotent
  effect with more moving parts.

### ADR-004: URL uniqueness is exact-string on the trimmed raw input

**Context.** Q02 chose reject-on-duplicate. SQLite enforces uniqueness on
the column value, so the system must decide what string is stored. URLs
have many equivalent forms (`http://example.com` vs `http://example.com/`,
case in scheme/host, query order, fragment). Normalising before insert
would make `http://example.com` and `http://example.com/` collide; not
normalising would let them coexist.

**Decision.** Store the user-submitted URL trimmed of leading and
trailing whitespace, with no further normalisation. The `UNIQUE`
constraint is on that exact string.

**Rationale.** The spec scopes duplicates to "matches a URL already
present in storage". The user only sees the URLs they typed; matching
what they typed is the least-surprising rule. Aggressive normalisation
risks false-positive duplicates ("but they're different URLs!") which is
worse than the false-negative case at this scale.

**Alternatives.**
- *Normalise via WHATWG `URL` (`new URL(input).href`).* Rejected — turns
  `http://example.com` into `http://example.com/`, which the user did
  not type; surprises documented in `URL` spec around trailing slashes,
  default ports, and lowercasing.
- *Normalise host case and strip trailing slash before storage.*
  Rejected — partial normalisation is the worst of both worlds.

### ADR-005: `esbuild` invoked from a TypeScript build script, not via a config plugin

**Context.** The client bundle must be produced before the server can
serve it. Options: a `package.json` script line calling `esbuild` CLI,
a JS config file, or a TypeScript build script invoked via `tsx` or the
compiled output.

**Decision.** `scripts/build-client.ts` calls `esbuild.build({...})`
programmatically. `npm start` runs `tsx scripts/build-client.ts` then
starts the server. `npm run build` runs the same script.

**Rationale.** Spec mandates "TypeScript everywhere"; the build step is
first-party code. A `.ts` build script keeps configuration co-located,
type-checked, and importable from tests if needed (e.g. a snapshot test
of build options).

**Alternatives.**
- *Bare CLI invocation `esbuild src/client/main.ts --bundle …`.* Rejected
  — long flag strings in `package.json` resist evolution and are not
  type-checked.
- *`esbuild.config.js`.* Rejected — violates "TypeScript everywhere".

### ADR-006: Server validation is authoritative; client validation is duplicate-but-best-effort

**Context.** The spec requires server-side validation for every input.
The client could rely entirely on the server (one round trip per error)
or duplicate the rules client-side for instant feedback.

**Decision.** Both layers validate. `src/client/validation.ts` and
`src/server/validation.ts` are two implementations of the same rules
(non-empty trimmed title; `new URL(input)` succeeds; scheme is
`http:` or `https:`). The client uses its copy to show inline errors
before submitting; the server treats every request as untrusted and
re-validates. Shared `types.ts` carries the contract; the validators do
not share code beyond the type signatures.

**Rationale.** Spec constraint: "validate all user-submitted input on the
server before persistence … independent of any client-side validation."
That phrasing accepts both layers existing. Duplicating ~15 lines of
validation is cheaper than the alternative of a round trip for every
typo.

**Alternatives.**
- *Server-only validation.* Rejected — every typo costs a round trip,
  bad ergonomics for a local app where the latency floor is the only
  signal the user has that something happened.
- *Shared validator module imported by both client and server.* Rejected
  — drags `URL` parsing into the client bundle indirectly and forces
  the validator to live in `src/shared/`, where any future server-only
  dependency would leak to the client. Not worth the abstraction for 15
  lines.

### ADR-007: Surrogate integer id, not the URL, as the delete key

**Context.** Delete needs to address a single bookmark. The URL is
already unique, so it could serve as the natural key in the route path.

**Decision.** `DELETE /api/bookmarks/:id` where `:id` is the
`AUTOINCREMENT` integer primary key.

**Rationale.**
- URLs contain `:`, `/`, `?`, `#`, and percent-encoded bytes; using them
  in path positions invites encoding bugs.
- Integer ids are cheap to render in `data-id` attributes and to validate
  (positive integer regex / `Number.isSafeInteger`).
- The UNIQUE constraint on `url` already serves the deduplication role;
  it does not need to also serve as an external key.

**Alternatives.**
- *`DELETE /api/bookmarks?url=…`.* Rejected — URL in a query string drags
  encoding edge cases into the route layer.

## Alternatives considered

Whole-design options weighed and rejected (per-decision alternatives are
captured in their ADR blocks above).

- **Server-rendered HTML with no client JS.** Express could render the
  list server-side and use form posts for create/delete. Rejected because
  the spec pins "vanilla TypeScript compiled to a single bundle by
  `esbuild`" and requires create/delete to update the list "without
  requiring a full page reload" (US-001 AC2, US-004 AC2) — both imply a
  client-side bundle that mutates the DOM.
- **Static-file frontend served separately (e.g. via `serve`) with API on
  a second port.** Rejected because the spec mandates same-origin
  delivery from the same Express process (`## Constraints` › Runtime and
  origin).
- **JSON file storage instead of SQLite.** Simpler dependency surface,
  but the seed pins `better-sqlite3` and SQLite gives the UNIQUE
  constraint for Q02 for free. Rejected on stack-pinning grounds.
- **One file per layer (`server.ts`, `client.ts`).** Smaller surface but
  forces the server to mix routes, validation, and persistence. Rejected
  — the repository injection in ADR-002 already requires three modules
  (`app.ts`, `db.ts`, `routes/bookmarks.ts`), and splitting client
  rendering from API calls keeps each unit testable in isolation.
- **Service-worker-cached UI for offline use.** Excluded by the spec
  (`## Out of scope` › service worker, PWA manifest).

## Open ambiguity

None. All structural questions raised by the spec and decisions are
resolved above. The Plan phase has a complete set of file paths, module
boundaries, API contracts, and the SQLite schema to sequence into work.
