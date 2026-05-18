---
project: baseline-1779117992-1
created: 2026-05-18
phase: plan
---

**Mutation Testing:** no

# Tests — Bookmarks

Phase-wide verification strategy for the Bookmarks app. Build executes
every gate listed here via `npm test` inside `.loom/baseline-1779117992-1/app/`.

Mutation testing is `no`: this app touches no money, no auth, no
irreversible operations, and no security boundary beyond same-origin
defaults. The cost of standing up Stryker for four routes against a
single-table SQLite database is not justified by the bug-impact ceiling.
Behaviour-level tests at the repo, api, and web layers are sufficient.

## Harness

- **Runner:** Vitest ^2, invoked by `npm test` → `vitest run`.
- **Environments:**
  - `tests/repo.test.ts` runs under Node, opens `better-sqlite3` with
    `:memory:` per test.
  - `tests/api.test.ts` runs under Node, uses `supertest` against
    `createApp(db)` with a `:memory:` SQLite handle. No port binding.
  - `tests/web.test.ts` runs under Vitest's `jsdom` environment; uses
    `vi.stubGlobal('fetch', ...)` to fake the JSON API.
- **No external services.** No real port, no real DB file, no network.
- **Locality of side effects.** Tests never touch the on-disk
  `bookmarks.sqlite` file used by `npm start`.

## Verification gates

| Gate | Runs | Scope | Owns assertions about |
| --- | --- | --- | --- |
| Smoke (boot) | `tests/api.test.ts` (one test) | `createApp(db)` returns an Express instance and `GET /api/bookmarks` responds `200 []` against a fresh `:memory:` DB | Migration ran; routes mounted; error envelope wired |
| Repo unit | `tests/repo.test.ts` | `listBookmarks`, `createBookmark`, `deleteBookmark` against in-memory SQLite | SQL contract, UNIQUE-constraint mapping, ordering, NotFoundError |
| API integration | `tests/api.test.ts` | HTTP shape end-to-end via supertest | Status codes, JSON envelope, error mapping, validation |
| Web smoke | `tests/web.test.ts` | `main.ts` against jsdom + stubbed fetch | renderList output, empty-state, form-submit happy + duplicate path, anchor attributes, delete reconcile |

## Acceptance criteria → test mapping

### US-001 — Save

- AC 1 (persist + prepend): `repo.test.ts` (`createBookmark` inserts +
  `listBookmarks` returns newest-first); `api.test.ts` (`POST` → `201`,
  body matches DTO; subsequent `GET` shows it first); `web.test.ts`
  (form submit fires `postBookmark`, list rerenders with new item on
  top).
- AC 2 (duplicate URL rejected): `repo.test.ts` (second `createBookmark`
  with same URL throws `DuplicateUrlError`); `api.test.ts` (`POST` →
  `409 duplicate_url`, no row inserted); `web.test.ts` (inline error
  shown under URL field on `409`, list unchanged).
- AC 3 (invalid URL / empty title client-side): `web.test.ts`
  asserts no `fetch` call when title is blank or URL is malformed,
  and inline error rendered; `api.test.ts` defensively confirms the
  server still returns `400 invalid_input` if the client check is
  bypassed.
- AC 4 (immutable rows): asserted structurally — no PATCH route exists.
  `api.test.ts` asserts `PATCH /api/bookmarks/1` returns `404 not_found`
  (Express default for unmounted route) so the API surface is provably
  GET/POST/DELETE only.

### US-002 — List

- AC 1 (chronological newest-first): `repo.test.ts` (insert three rows,
  assert `listBookmarks` returns them in `created_at DESC, id DESC`
  order); `api.test.ts` (`GET /api/bookmarks` returns the same order
  serialised as JSON).
- AC 2 (no filters/search/alt sort): structural — `web.test.ts` asserts
  the DOM contains no `input[type=search]`, no sort controls, and the
  page exposes no client-side filtering hooks.
- AC 3 (empty-state): `web.test.ts` asserts that `renderList([])` renders
  the empty-state element (visible, with the configured copy) and does
  not render an empty `<ul>` / `<ol>` list element.

### US-003 — Open

- AC 1 (opens in new tab): `web.test.ts` asserts each rendered row
  contains an `<a>` whose `href === bookmark.url`, `target === '_blank'`,
  and `rel === 'noopener noreferrer'`. (Real-tab opening is browser
  behaviour, which we assert via attributes — the contract the test
  owns.)
- AC 2 (list preserved in original tab): same-attribute proof — no
  `window.location` rewrite, no router; combined with `target=_blank`
  the original tab cannot be navigated.

### US-004 — Delete

- AC 1 (row removed from DB + list): `repo.test.ts` (`deleteBookmark`
  removes the row; subsequent `listBookmarks` does not include it);
  `api.test.ts` (`DELETE` → `204`, follow-up `GET` shows row gone);
  `web.test.ts` (click delete → row disappears from rendered list after
  `204`).
- AC 2 (stale id → 404 + refetch): `repo.test.ts` (`deleteBookmark`
  on missing id throws `NotFoundError`); `api.test.ts` (`DELETE` of
  missing id → `404 not_found`); `web.test.ts` (on `404`, the client
  triggers `fetchBookmarks()` again — assert via stubbed fetch spy).
- AC 3 (single-action, no confirm): structural — `web.test.ts` asserts
  a single delete click triggers a `DELETE` request immediately, with
  no intermediate confirmation modal in the DOM.

## Smoke gate

- Boot-shape smoke: `tests/api.test.ts` opens an in-memory DB, calls
  `createApp(db)`, hits `GET /api/bookmarks`, asserts `200 []`.
- Static smoke: `tests/api.test.ts` asserts `GET /` returns `200` with
  `text/html` (proves Express + static middleware wired). `GET
  /bundle.js` is asserted to return `200` after a build (see Build
  pre-flight in `plan.md`); if the bundle is missing, the smoke gate
  reports a clear failure.

## Mutation gate

Not applicable. `Mutation Testing: no` at the top of this file. Build
must not run a mutation harness.

## Coverage check (advisory, not gating)

`vitest run --coverage` is allowed but not required to pass any
threshold. The four behaviour-level test files above are the canonical
gate.
