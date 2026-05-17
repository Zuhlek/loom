---
project: baseline-1778968525-1
phase: plan
created: 2026-05-17
---

# Tests — baseline-1778968525-1

**Verification environment:** node-test (Vitest pinned by seed).
**Mutation Testing:** no

## Strategy

- **Repository specs** run against a fresh per-test SQLite database opened
  with `better-sqlite3` against `:memory:` (or an `os.tmpdir()` file when an
  on-disk path is required). Each test seeds rows directly via the schema
  bootstrap.
- **Validation specs** are pure-function tests — no DB, no HTTP.
- **Route specs** drive the Express app returned by `buildApp(db)` through
  `supertest`. Each test constructs a fresh in-memory DB to keep tests
  isolated and parallel-safe.
- **Smoke spec** boots `buildApp` and asserts the static asset
  (`/index.html` or `/`) responds 200 same-origin.

No browser-level test harness (out of scope; UI is plain DOM and is covered
through route-level + bundle-load smoke).

## Per-task test sketches

### T-001 — Workspace scaffolding
- No behaviour tests; verification is `npm install` succeeds and the
  directory layout exists. `tsc --noEmit` runs clean on the empty tree.

### T-002 — SQLite bootstrap and schema
- Opening `db/index.ts` against `:memory:` returns a `Database` with the
  `bookmarks` table present.
- Schema bootstrap is idempotent: calling it twice does not error.
- Inserting two rows with the same `url` raises a
  `SQLITE_CONSTRAINT_UNIQUE` error.
- `created_at` default produces an ISO-8601 UTC string when omitted.

### T-003 — Bookmark repository
- `createBookmark` returns the inserted `BookmarkRow` including `id` and
  `created_at`. (US-001 AC1)
- `createBookmark` with a URL that already exists throws
  `DuplicateUrlError`. (US-001 AC4)
- `listBookmarks` returns rows in `created_at DESC, id DESC` order.
  (US-002 AC1)
- `listBookmarks` returns an empty array when no rows exist. (US-002 AC4)
- `deleteBookmark` returns `true` when a row was removed and the row is no
  longer listed. (US-004 AC1)
- `deleteBookmark` returns `false` when the id is not present.

### T-004 — Validation
- `validateNewBookmark` returns the trimmed title and the URL string on a
  valid payload. (US-001 AC1)
- `validateNewBookmark` throws `ValidationError{ code: 'INVALID_TITLE' }`
  for missing / empty / whitespace-only titles. (US-001 AC3)
- `validateNewBookmark` throws `ValidationError{ code: 'INVALID_URL' }`
  for missing / non-string / unparseable URL values (the WHATWG `URL`
  constructor throws). (US-001 AC2)
- Validation rejects payloads that are not objects.

### T-005 — Errors module and Express app factory
- `ValidationError`, `DuplicateUrlError`, `NotFoundError` carry the
  expected `code` field.
- The global error middleware maps each error class to its declared HTTP
  status with body `{ error: { code, message } }`. (ADR-008)
- An unmapped `Error` becomes a 500 with `code: 'INTERNAL'`.
- A malformed JSON body produces 400 with `code: 'INVALID_BODY'`.

### T-006 — HTTP routes
- `GET /api/bookmarks` returns `{ bookmarks: [...] }` newest-first with
  the API field set (`createdAt` camelCase). (US-002 AC1, AC2)
- `GET /api/bookmarks` on an empty DB returns `{ bookmarks: [] }`.
  (US-002 AC4)
- `POST /api/bookmarks` with a valid body returns 201 and
  `{ bookmark: ... }`; the row is then listed first. (US-001 AC1)
- `POST /api/bookmarks` with empty title returns 400 with
  `code: 'INVALID_TITLE'` and writes no row. (US-001 AC3)
- `POST /api/bookmarks` with invalid URL returns 400 with
  `code: 'INVALID_URL'` and writes no row. (US-001 AC2)
- `POST /api/bookmarks` with a duplicate URL returns 409 with
  `code: 'DUPLICATE_URL'` and leaves the existing row untouched.
  (US-001 AC4)
- `DELETE /api/bookmarks/:id` returns 204 and the row no longer appears in
  the list. (US-004 AC1)
- `DELETE /api/bookmarks/:id` with a non-existent id returns 404 with
  `code: 'NOT_FOUND'`.
- `DELETE /api/bookmarks/:id` with a non-numeric id returns 400 with
  `code: 'INVALID_ID'`.

### T-007 — Server bootstrap and static serving
- `GET /` returns the static `index.html` with `200` and
  `Content-Type: text/html`. (US-002 supporting; same-origin invariant)
- `GET /styles.css` returns 200 with the CSS file.
- The HTTP listener binds to `127.0.0.1` (asserted via supertest server
  address inspection where feasible; unit-level coverage in T-010 smoke).

### T-008 — UI shell
- No automated assertions beyond a snapshot of the HTML structure; the
  shell is asserted through the smoke spec in T-010.
- Manual review checklist: form has title + URL inputs and a submit
  button; list region present; empty-state element present;
  `<script type="module" src="/app.js">` declared.

### T-009 — Web bundle source
- Pure functions in `dom.ts` (rendering helpers that build link markup)
  are unit-tested with JSDOM-style assertions inside Vitest's default
  environment (or via Vitest's `happy-dom` if needed; minimal coverage):
  - `renderBookmarkListItem` produces an `<a>` with `target="_blank"`
    and `rel="noopener noreferrer"`. (US-003 AC2)
  - The renderer escapes title text (no inline HTML injection).
- `api.ts` typed fetch wrappers are tested with a mocked `fetch` to
  assert request shape, success parsing, and `ApiError` thrown on
  non-2xx with the parsed `{ code, message }`.

### T-010 — esbuild pipeline and npm scripts + smoke
- `npm run build` produces `public/app.js` as a single ESM bundle.
- A Vitest smoke spec: builds the app via `buildApp(db)` with an empty
  in-memory DB and asserts:
  - `GET /` returns 200 text/html (US-002 AC4 empty state lives in the
    same shell).
  - `GET /app.js` returns 200 application/javascript when the bundle
    exists (skipped or marked TODO when running before `npm run build`).
- `npm start` smoke (best-effort, behind an env-gated test): spawn the
  server, hit `http://localhost:3000/`, expect 200, shut it down.
