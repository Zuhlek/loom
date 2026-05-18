---
project: baseline-1779046840-1
phase: plan
created: 2026-05-17T21:50:00Z
---

# Tests — baseline-1779046840-1

**Mutation Testing:** no

Rationale: the deliverable is a single-user local bookmarks app. No
security boundary, no money, no irreversible operations, no data
integrity contract beyond the URL UNIQUE constraint (itself enforced
by SQLite, exercised directly by behaviour tests). Mutation cost is
not justified by bug impact at this scale.

## Verification environment

`node-test` (Vitest 2.x + supertest), run via `npm test` inside
`./app/`. See `plan.md § Verification environment` for the gate Build
pre-flights.

## Strategy

Behaviour-level tests, not implementation tests. Each test asserts
something a Spec acceptance criterion describes — round-trip via the
HTTP surface for server slices, round-trip via the DOM for client
slices. Helpers may be introduced in a `test/helpers/` directory but
their absence is fine.

Test categories:

1. **Server HTTP tests** (`test/api.test.ts`) — drive the Express app
   built by `createApp(db, staticRoot)` via `supertest`, against an
   in-memory SQLite database (`:memory:`). Covers GET, POST, DELETE
   contracts including validation, duplicate, and not-found paths.
2. **DB unit tests** (`test/db.test.ts`) — exercise `db.ts` directly
   against `:memory:` SQLite for duplicate-insert and remove-missing
   semantics. The UNIQUE constraint is the source of truth and is
   asserted at this layer.
3. **Client DOM tests** (`test/client/*.test.ts`) — Vitest with the
   `jsdom` environment. Exercise `dom.ts` render helpers and `main.ts`
   wiring against an in-test DOM, with `api.ts` either mocked via
   `vi.mock` or pointed at a `supertest`-style mock fetch. Covers list
   render, empty state, save-form prepend, save-form duplicate error,
   delete-row removal, delete-row 404 banner, and new-tab link
   attributes.
4. **End-to-end smoke gate** (`test/smoke.test.ts` or scripted in
   `T-012`) — boots `createApp()` with a temp-file SQLite DB, runs a
   full round-trip: POST a bookmark, GET shows it newest-first, POST a
   duplicate returns 409, DELETE returns 204, GET shows it gone. Also
   asserts `npm run build` produces `dist/client/app.js` and
   `dist/server/index.js`.

## Smoke gate

`T-012` is the explicit smoke gate. It requires:

- `npm install` succeeds from a clean checkout.
- `npm run build` produces `dist/client/app.js`, `dist/client/index.html`,
  `dist/client/styles.css`, and `dist/server/index.js`.
- `npm test` exits 0 with every described behaviour test green.
- The end-to-end smoke test exercises the full POST → GET → DELETE →
  GET path through `createApp` against a temp-file SQLite database.

If any of those fail, T-012 fails and the whole phase is incomplete.

## Per-task behaviour test sketches

Derived from EARS clauses of the stories each task satisfies. Per-task
detail lives in the task file; this section is the cross-task summary.

| Task | Test sketches |
| --- | --- |
| T-001 | `npm install`, `npm test`, `npm start --dry-run` style execution succeeds; the smoke gate later asserts the script names exist. Scaffold-only — no behaviour assertion of its own beyond "scripts present and runnable". |
| T-002 | Insert returns the row; second insert with same URL throws `DuplicateUrlError`; remove of an existing id returns true; remove of a missing id returns false; list returns inserted rows in `id DESC` order. |
| T-003 | GET on empty DB returns `200 { bookmarks: [] }`; after two inserts GET returns both rows, newest first (matches US-002 AC1). |
| T-004 | Valid POST returns `201` with the new row (US-001 AC1); POST with empty title returns `400 validation field=title` (AC4); POST with malformed URL returns `400 validation field=url` (AC4); POST with duplicate URL returns `409 duplicate` (AC3); the GET list reflects the inserted row. |
| T-005 | DELETE existing id returns `204`; subsequent GET no longer shows that row (US-004 AC1); DELETE missing id returns `404 not_found` (US-004 AC3). |
| T-006 | GET `/` returns 200 with the `index.html` body; GET `/app.js` returns 200 with the built bundle; GET `/api/bookmarks` still routes to the API (route precedence). |
| T-007 | `api.ts`: each function resolves on 2xx and rejects with `ApiClientError` carrying the parsed error body on 4xx. `dom.ts`: `renderList` produces one `<li>` per item with a title link and a delete button; `renderEmptyState` renders the empty-state node; `renderFieldError`/`clearFieldErrors` add/remove error nodes idempotently. |
| T-008 | On page load with a stubbed `listBookmarks` returning two items, the list renders both, newest first (US-002 AC1); each row shows title, URL, and a delete control (US-002 AC2); with `listBookmarks` returning `[]`, the empty-state node renders instead of an empty list (US-002 AC3). |
| T-009 | Submitting valid input calls `createBookmark` and prepends the returned row to the list without reload (US-001 AC1, AC2); empty title or invalid URL yields an inline validation error and no API call (US-001 AC4); a stubbed 409 surfaces an inline duplicate error under the URL field (US-001 AC3). |
| T-010 | Each rendered title link has `target="_blank"` and `rel="noopener noreferrer"` with `href` equal to the bookmark's URL (US-003 AC1); clicking the link does not navigate the page (US-003 AC2 — asserted by the absence of a same-frame navigation, e.g., `event.defaultPrevented` is not required but the link target is `_blank`). |
| T-011 | Clicking the delete control on a row calls `deleteBookmark(id)` and removes the row from the DOM on 204 (US-004 AC1, AC2); a stubbed 404 surfaces a non-fatal banner and still removes the row from the local list (US-004 AC3). |
| T-012 | End-to-end smoke — see § Smoke gate above. |

## Things explicitly not tested

- Cross-browser rendering (single-user local laptop, one origin).
- Concurrent writes (single-user constraint).
- Recovery from a corrupted SQLite file (out of scope).
- Performance (single-user, single-process, laptop scale).
- Build performance / bundle size (no targets set by spec).
