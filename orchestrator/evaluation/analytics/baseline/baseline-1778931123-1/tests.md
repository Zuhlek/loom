---
project: baseline-1778931123-1
phase: plan
created: 2026-05-16
---

**Mutation Testing:** no

# Verification Strategy — Bookmarks

Local-only, single-user laptop app. No security boundary, no money, no
irreversible operations. The cost of mutation testing is not justified for a
greenfield CRUD-on-one-table app at this scale; default `no` applies.

## Harness

- **Primary:** Vitest (`npm test` from `app/`). Includes unit tests against
  the repo and integration tests against `buildApp(repo)` via `supertest`.
- **Secondary:** CLI smoke against `npm start` (background) using `curl` to
  validate same-origin serving (US-005 AC1) and persistence across a restart
  cycle (Constraints — persistence across restarts).
- **DOM-level tests:** `jsdom` (Vitest default environment for client files)
  for the small bits of client logic that need a DOM (form-error rendering,
  in-row delete toggle, empty-state branch).

## Test organisation

| Test file | Scope | Stories |
| --- | --- | --- |
| `app/test/db.test.ts` | Repo unit tests against `:memory:` SQLite — create / list / getById / deleteById, duplicate handling, canonicalisation, ordering | US-001, US-002, US-004 |
| `app/test/api.test.ts` | `supertest` integration against `buildApp(makeRepo(openDb(':memory:')))` — GET, POST, DELETE happy paths and error envelopes | US-001, US-002, US-004 |
| `app/test/client-render.test.ts` | jsdom unit tests for `render(list)` empty-state branch + populated branch + link safety (`target=_blank`, `rel=noopener`) | US-002, US-003 |
| `app/test/client-form.test.ts` | jsdom unit tests for save-form submit, inline validation errors, duplicate-URL error rendering | US-001 |
| `app/test/client-delete.test.ts` | jsdom unit tests for in-row two-step delete confirmation, timer cancel, post-delete refresh path | US-004 |
| `app/test/smoke.test.ts` (or shell gate) | Boot `npm start`, hit `GET /`, `GET /api/bookmarks`; POST a row, restart, GET again, assert row persists; cleanup `bookmarks.sqlite` between runs | US-005, Constraints |

## Acceptance gate mapping (story → assertions)

### US-001 Save a new bookmark
- AC1 (persist + display at top): `db.test.ts` asserts inserted row is first
  by `created_at DESC`; `api.test.ts` asserts `POST` returns `201` with the
  row; `client-form.test.ts` asserts the row appears at the top after a
  successful submit (re-fetch path); `client-render.test.ts` asserts ordering.
- AC2 (duplicate URL inline error): `db.test.ts` asserts repo throws
  `DuplicateUrlError`; `api.test.ts` asserts `409` with
  `error.code === 'duplicate_url'`; `client-form.test.ts` asserts the inline
  error renders under the URL field.
- AC3 (invalid URL inline error): `api.test.ts` covers missing/empty/garbage
  URL → `400 validation` with `field: 'url'`; `client-form.test.ts` asserts
  the field-level error message renders.
- AC4 (empty/whitespace title inline error): same pattern at the title field.

### US-002 List newest-first
- AC1 (chronological list): `db.test.ts` asserts `list()` returns rows
  ordered by `created_at DESC, id DESC`; `api.test.ts` asserts the same
  ordering through the HTTP boundary.
- AC2 (row shows title + URL): `client-render.test.ts` asserts each row's
  DOM contains the title text and URL string.
- AC3 (empty-state message): `client-render.test.ts` asserts the empty-state
  message renders when `bookmarks.length === 0` and the list element is
  absent.

### US-003 Open in a new tab
- AC1 (new tab): `client-render.test.ts` asserts the row's anchor has
  `target="_blank"`.
- AC2 (`rel="noopener"`): same test asserts `rel="noopener"` is present.

### US-004 Delete
- AC1 (confirm + remove): `client-delete.test.ts` simulates the two-step
  click, asserts the row is removed from DOM after refresh; `db.test.ts`
  asserts `deleteById` removes the row; `api.test.ts` asserts `204`.
- AC2 (404 on unknown id): `api.test.ts` asserts `DELETE /api/bookmarks/9999`
  returns `404` with `error.code === 'not_found'` and the list is unchanged.
- AC3 (same URL re-savable after delete): `db.test.ts` and `api.test.ts`
  both cover delete-then-create-with-same-URL succeeding.

### US-005 One-command boot, one-command test
- AC1 (`npm start` boots): smoke gate hits `http://localhost:3000` and
  `/api/bookmarks` and asserts `200` from both within a timeout.
- AC2 (`npm test` exits non-zero on failure): verified by the gate itself —
  Build runs `npm test` from `app/` and consumes the exit code; a deliberate
  failing assertion during T-009 dry-run confirms non-zero exit.

### Constraints
- **Workspace isolation**: T-009 gate greps the repo root and sibling
  directories after a full run to confirm no writes outside `app/`.
- **Persistence across restarts**: T-009 smoke posts a bookmark, kills the
  server, restarts via `npm start`, fetches `GET /api/bookmarks`, asserts
  the bookmark is still there.
- **Single-origin / no CORS**: `api.test.ts` asserts no `Access-Control-*`
  headers are emitted by `buildApp(repo)`.

## Test data conventions

- Repo unit tests open `:memory:` SQLite handles per test via `beforeEach`.
- API integration tests build a fresh `buildApp(makeRepo(openDb(':memory:')))`
  per test file (or per test, where state isolation matters).
- The smoke gate uses a temp directory under `node:os.tmpdir()` for the
  SQLite path, deleted on teardown, so it doesn't poison the real
  `app/bookmarks.sqlite`.

## Out of scope for tests

- No browser-driver tests (Playwright/Puppeteer). Link semantics asserted on
  rendered HTML.
- No performance / load tests. Single-user, tens-to-low-hundreds corpus.
- No mutation testing (see header).
- No telemetry, no analytics, no service worker tests — none exist.
