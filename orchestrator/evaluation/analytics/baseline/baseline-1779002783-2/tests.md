---
project: baseline-1779002783-2
phase: plan
---

# Tests — baseline-1779002783-2

**Mutation Testing:** no

Rationale for `no`: the deliverable is a single-user local-only
bookmarks app with no money flow, no auth boundary, no irreversible
external side effects, and no PII beyond URLs the user typed
themselves. The cost of running Stryker on this codebase is not
justified by the bug-impact of an undetected mutant. Standard unit +
integration coverage from Vitest is sufficient.

## Verification environment

`node-test`. Vitest is the seed-frozen runner (ADR-009). Server HTTP
tests use `supertest` against the Express app constructed by
`createApp(openDatabase(':memory:'))`. Client DOM tests run under
Vitest's `happy-dom` environment.

`npm test` from `.loom/baseline-1779002783-2/app/` runs the entire
suite. Build's pre-flight asserts:

- Node ≥ 20 on `$PATH`.
- `vitest`, `supertest`, `@types/supertest`, `happy-dom` declared in
  `app/package.json` devDependencies.
- `npm install` completes from `app/`.
- `npm test` exits 0 on an empty pre-test database.

If any pre-flight check fails, Build returns `status: blocked` with
the failing check named.

## Test layers

### Unit — `app/tests/unit/`

- **`validate.test.ts`** — exercises `validateUrl`, `validateTitle`,
  `parseId` against the rules in `design.md ## Validation rules`.
  Covers: empty, whitespace-only, non-`http(s)` schemes, length cap,
  leading/trailing whitespace trim, `new URL()` throw paths, integer
  edge cases (`0`, negative, `1.5`, scientific notation).
- **`repo.test.ts`** — exercises `createBookmark`, `listBookmarks`,
  `deleteBookmark` against a fresh `:memory:` SQLite per test. Covers:
  insert returns row with `id` + `createdAt`; duplicate URL throws
  `DuplicateUrlError`; list returns rows ordered by `created_at DESC,
  id DESC`; delete throws `NotFoundError` when row absent; persistence
  across multiple writes within a single `:memory:` handle.
- **`db.test.ts`** — covers migration idempotence (running `migrate`
  twice on the same handle succeeds; the `bookmarks` table and indexes
  exist after one run; running on an empty file creates the schema).
- **`client/render.test.ts`** — under `happy-dom`: empty-state copy
  renders when `bookmarks = []`; populated state renders one `<li>` per
  bookmark; anchors carry `target="_blank"` and
  `rel="noopener noreferrer"`; titles are inserted via `textContent`
  (no `innerHTML`); `renderError`/`clearError` toggle the `#error`
  region.
- **`client/api.test.ts`** — mocks `fetch`; verifies request bodies,
  headers (`Content-Type: application/json`), error-path mapping from
  status codes to `ApiError` instances with `code`/`field` fields.

### Integration — `app/tests/integration/`

- **`bookmarks.api.test.ts`** — boots `createApp(openDatabase(':memory:'))`
  and exercises every endpoint via `supertest`. Per-spec acceptance
  criteria covered:
  - `GET /api/bookmarks` empty → `200 { bookmarks: [] }`.
  - `POST /api/bookmarks` with valid body → `201 { bookmark: {...} }`,
    visible in next `GET` (US-001 AC-1, US-002 AC-1).
  - `POST /api/bookmarks` duplicate → `409 { error: { code:
    "duplicate_url", url } }` (US-001 AC-2).
  - `POST /api/bookmarks` invalid URL → `400 { error: { code:
    "invalid_input", field: "url" } }` (US-001 AC-3).
  - `POST /api/bookmarks` empty / whitespace title → `400 { error: {
    code: "invalid_input", field: "title" } }` (US-001 AC-4).
  - `POST /api/bookmarks` non-JSON Content-Type → `415`.
  - Multiple `POST`s → `GET` returns them in `created_at DESC, id
    DESC` order (US-002 AC-1).
  - `GET` with zero rows → response carries empty-state-friendly
    `bookmarks: []` (US-002 AC-2 is asserted at the client layer too).
  - `DELETE /api/bookmarks/:id` for existing row → `204`; subsequent
    `GET` does not include it (US-004 AC-1).
  - `DELETE /api/bookmarks/:id` for absent id → `404 { error: { code:
    "not_found", id } }` (US-004 AC-2).
  - `DELETE /api/bookmarks/:id` for non-positive-integer `:id` →
    `400 { error: { code: "invalid_id" } }`.

### Smoke — `app/scripts/smoke.mjs` (gated by `npm run smoke`)

- Spawns `npm start` against a temp SQLite path via the `BOOKMARKS_DB`
  env var.
- Waits for `:3000/` to respond `200`.
- `POST`s a bookmark; `GET`s and asserts it appears.
- Sends `SIGINT`, awaits exit, respawns against the same DB file.
- `GET`s and asserts the bookmark is still present (US-005 AC-1).
- Deletes the temp SQLite file.

Smoke runs in `node-test` capability (no browser); Build treats it as
an optional gate that runs after `npm test`. T-010 owns this script.

## Story → test mapping (acceptance gates)

| Story | AC | Test |
| --- | --- | --- |
| US-001 | AC-1 (persist + appears on list) | `bookmarks.api.test.ts` POST+GET; `repo.test.ts` create+list |
| US-001 | AC-2 (duplicate → 409 + inline error) | `bookmarks.api.test.ts` duplicate; `repo.test.ts` duplicate; `client/api.test.ts` 409→ApiError; client form integration in T-007 |
| US-001 | AC-3 (invalid URL → 400) | `validate.test.ts`; `bookmarks.api.test.ts` invalid URL |
| US-001 | AC-4 (empty title → 400) | `validate.test.ts`; `bookmarks.api.test.ts` empty/whitespace title |
| US-002 | AC-1 (newest-first list) | `bookmarks.api.test.ts` ordering; `repo.test.ts` ordering; `client/render.test.ts` ordering preserved |
| US-002 | AC-2 (empty-state copy) | `client/render.test.ts` empty state |
| US-002 | AC-3 (title + URL displayed) | `client/render.test.ts` populated state |
| US-003 | AC-1 (opens in new tab) | `client/render.test.ts` `target="_blank"` |
| US-003 | AC-2 (`rel="noopener noreferrer"`) | `client/render.test.ts` rel attr |
| US-004 | AC-1 (removes row) | `bookmarks.api.test.ts` delete+GET; `repo.test.ts` delete |
| US-004 | AC-2 (404 on missing id) | `bookmarks.api.test.ts` 404; `repo.test.ts` `NotFoundError`; client `T-009` 404 UI |
| US-005 | AC-1 (survives restart) | `smoke.mjs` restart cycle (T-010); `repo.test.ts` writes persist within a handle |
| US-005 | AC-2 (creates file on first boot) | `db.test.ts` migration idempotence; `smoke.mjs` cold start |
