---
project: baseline-1779002783-1
phase: review
created: 2026-05-17
---

# Review — Bookmarks (baseline-1779002783-1)

## Verdict

**PASS** — 0 Blockers, 0 Major, 4 Minor, 1 Note.

The 12-task build delivered the local-only Bookmarks app end-to-end inside
`.loom/baseline-1779002783-1/app/`. All four user stories (US-001..US-004)
are satisfied by code and by tests, every plan task is Done, the Vitest
suite is 48/48 green across 7 files (including durability, smoke, render,
bundle, web-api, api, validate, db), `tsc --noEmit` is clean, `npm start`
boots and serves both `/` and `/api/bookmarks` on the loopback, and
workspace isolation is verified — `git status` shows zero deliverable
writes outside the workspace (the only modified files belong to pre-existing
`orchestrator/` evaluation tooling, unrelated to this build).

The pinned stack is honored exactly (express, better-sqlite3, tsx, esbuild,
vitest, supertest, typescript, jsdom). No React/Vue/Vite/Fastify/ORM
substitutions. All five seed-flagged decisions (Q01 flat list, Q02 reject
duplicates with 409+inline error, Q03 no search, Q04 immutable, Q05
newest-first) are observable in the diff and exercised by tests.

## Inputs reviewed

- `spec.md` US-001..US-004 + Constraints
- `design.md` ADR-001..007
- `plan.md`, `task.md`, `board.md`, `tests.md`
- 12 × `tasks/T-NNN.done.md` + `tasks/T-NNN.test-log.txt`
- `test-report.md`, `smoke-report.md`
- Full source diff under `app/src/server/{db,validate,routes,app,index}.ts`,
  `app/src/web/{api,render,main}.ts`, `app/tests/*.test.ts`, `app/public/*`,
  `app/package.json`, `app/tsconfig.json`, `app/vitest.config.ts`
- `orchestrator/principles.md` P1–P7

## Story-by-story intent satisfaction

### US-001 — Save a URL with a title — SATISFIED

- AC1 (valid input → 2xx + persisted): `POST /api/bookmarks` →
  `validateBookmarkInput` → `repo.insert` → 201 + row in `selectAll`.
  Covered by `api.test.ts` "creates a bookmark and returns 201" and
  `web-api.test.ts` "createBookmark: 201 → parsed body".
- AC2 (duplicate URL → 4xx + no new row + inline error): SQLite `UNIQUE`
  on `url` raises `SQLITE_CONSTRAINT_UNIQUE`, caught in `db.ts` →
  `DuplicateUrlError` → error mapper → 409 `{error:"duplicate",...}`.
  Frontend `createBookmark` throws `{kind:"duplicate"}` → `main.ts`
  renders `renderInlineError(errorSlot, 'this URL is already saved')`.
  Covered end-to-end by `api.test.ts` "rejects duplicate URL with 409"
  and `web-api.test.ts` duplicate test.
- AC3 (empty/invalid URL → 4xx + no row): `validate.ts` rejects empty,
  unparseable, non-http(s) (including `javascript:`); error mapper → 400.
  Covered by `validate.test.ts` and `api.test.ts`.
- AC4 (empty title → 4xx + no row): `validate.ts` trims and rejects empty
  / whitespace-only / missing title. Covered identically.

### US-002 — View all in a list — SATISFIED

- AC1 (render every persisted bookmark on load): `main.ts boot()` →
  `fetchBookmarks()` → `renderList(root, items)`. Smoke test asserts the
  HTML page is served and the list endpoint returns the persisted set.
- AC2 (`created_at` DESC ordering): `selectAll = 'ORDER BY created_at DESC,
  id DESC'`. Asserted by `db.test.ts` "orders results newest-first with
  id DESC tie-break" and `api.test.ts` "returns all bookmarks newest-first".
- AC3 (empty-state when no rows): `main.ts refresh()` branches on
  `items.length === 0` → `renderEmptyState`. Asserted by `render.test.ts`
  "renders an empty-state message".

### US-003 — Open in new tab — SATISFIED

- AC1+AC2 (`target="_blank" rel="noopener noreferrer"`): `render.ts
  renderList` sets `a.target = '_blank'` and `a.rel = 'noopener noreferrer'`
  on each anchor. Asserted by `render.test.ts` "anchors carry target and
  rel"; reinforced by `bundle.test.ts` and `smoke.test.ts` GET /main.js
  string checks. XSS-safe: `a.textContent = item.title` (asserted by
  `render.test.ts` textContent escape test).

### US-004 — Delete a bookmark — SATISFIED

- AC1 (delete control removes the row and the rendered list reflects it):
  `main.ts` delegated click handler on `#root` filters
  `data-action="delete"`, calls `deleteBookmark(id)` then re-fetches
  (ADR-007). Asserted by `api.test.ts` "204 on success and removes the
  row" and `smoke.test.ts` POST+DELETE round-trip.
- AC2 (2xx on success): `routes.ts` returns `204`.
- AC3 (4xx on missing id, table unchanged): `db.ts deleteById` throws
  `NotFoundError` when `info.changes === 0`; error mapper → 404. Path
  regex `^[1-9]\d*$` makes non-positive-integer ids fall through to the
  404 mapper. Asserted by 3 `api.test.ts` cases.

## Design conformance (ADRs)

| ADR     | Decision                                             | Evidence in diff                                                                  | Conform |
|---------|------------------------------------------------------|-----------------------------------------------------------------------------------|---------|
| ADR-001 | Single Express process, static + API same origin    | `app.ts` mounts `/api/bookmarks` + `express.static(PUBLIC_DIR)`                  | yes     |
| ADR-002 | Synchronous better-sqlite3 API, no async wrapper    | `db.ts` exposes synchronous methods called directly from handlers                | yes     |
| ADR-003 | Single esbuild IIFE bundle from `src/web/main.ts`   | `package.json` `build` script matches verbatim; `public/main.js` 4.6 kb          | yes     |
| ADR-004 | UNIQUE at SQLite layer → 409 with stable `"duplicate"` literal | `db.ts` schema + SQLITE_CONSTRAINT_UNIQUE handler; `app.ts` mapper        | yes     |
| ADR-005 | `:memory:` for fast tests + one file-backed round-trip | `db.test.ts` "openDb file-backed durability"                                  | yes     |
| ADR-006 | ISO-8601 string `created_at`, `id DESC` tie-break  | `db.ts` `created_at = new Date().toISOString()`; `ORDER BY created_at DESC, id DESC` | yes |
| ADR-007 | Re-fetch after every mutation, no optimistic update | `main.ts refresh(root)` called after every successful POST/DELETE                | yes     |

All seven ADRs are honored in code.

## Plan completion

12/12 tasks Done on the board. Coverage matrix in `task.md` matches what
is exercised in the diff:

- US-001 ← T-002, T-003, T-006, T-010, T-012
- US-002 ← T-002, T-005, T-009, T-012
- US-003 ← T-009, T-012
- US-004 ← T-002, T-007, T-011, T-012

## Test evidence quality

- 48/48 green, no skip, no flaky (`test-report.md`).
- File-backed durability test (`db.test.ts`) exercises the "survives
  restarts" claim in spec US-001 by close-and-reopen of the same DB path.
- `bundle.test.ts` rebuilds the IIFE in-suite and asserts `_blank` and
  `noopener noreferrer` are present in the compiled bytes (defence in
  depth against a future change to `render.ts` losing the attrs).
- `smoke.test.ts` boots `src/server/index.ts` via `tsx`, awaits the
  listening log, and exercises HTML, JS bundle, and CRUD round-trip on
  loopback.
- Tests assert through public interfaces (HTTP responses, repo public
  methods, DOM after render). Mocks are scoped to boundaries
  (`globalThis.fetch` in `web-api.test.ts`, `console.error` for the 500
  path).

## Safety

No commits, no pushes, no `git config`, no destructive ops attempted by
the build agent. `git status` is identical (modulo unrelated pre-existing
`orchestrator/` edits) to before the build wave.

## Principle compliance (P1–P7)

| # | Principle                          | Status | Notes |
|---|-------------------------------------|--------|-------|
| P1 | Lean changes                      | OK     | Every line in the diff traces to an AC or a stated constraint. The `selectById` prepared statement in `db.ts` is used to return the inserted row (insert returns `Bookmark`, contract from `design.md`). |
| P2 | Existing patterns / no new deps    | OK     | Stack matches the seed; only addition beyond the design list is `jsdom`, which is consumed by `render.test.ts` and `web-api.test.ts` and is recorded in T-008.done. |
| P3 | Zero duplication                   | Minor  | Two minors below. |
| P4 | One clean implementation           | OK     | No `legacy*`/`*V1`/`*Old` naming, no commented-out blocks, no parallel paths. |
| P5 | No speculative scaffolding         | OK     | Every helper has a consumer in the same diff. |
| P6 | Tests describe behaviour           | OK     | Public-interface assertions; mocks restricted to fetch / console / one broken-repo injection that exercises the 500 mapper. |
| P7 | Don't fight the framework          | OK     | `express.json`, `express.static`, Express error-middleware, Express `Router` used as-shipped; no wrappers. |

## Findings

### Minor

**M-1 (P3) — Duplicated network-error branch in delete handler**

- **Evidence:** `src/web/main.ts` lines ~88–94. The delete `catch` does:
  ```ts
  if (isApiError(err) && err.kind === 'network') {
    renderInlineError(errorSlot, 'network error');
  } else {
    renderInlineError(errorSlot, 'network error');
  }
  ```
  Both branches call the same thing with the same argument.
- **Expected:** A single `renderInlineError(errorSlot, 'network error')`
  (no conditional) — the branch contributes nothing observable.
- **Actual:** Dead structural duplication; ~5 wasted lines.
- **Impact:** Cosmetic; no behavioural difference. Mildly misleads a
  reader into looking for an asymmetry that does not exist.
- **Recommendation:** Replace the if/else with the single call. Trivial
  cleanup.
- **Owner phase:** Build (follow-up).

**M-2 (P3) — `Bookmark` / `BookmarkInput` defined twice**

- **Evidence:** `src/server/db.ts` exports `Bookmark` and `BookmarkInput`;
  `src/web/api.ts` re-declares both interfaces identically. Design's
  function-signatures section noted "`src/web/main.ts` plus its imports
  (`api.ts`, `render.ts`, shared types from `src/server/db.ts`)".
- **Expected:** Single source of truth — `src/web/api.ts` imports the
  types from `src/server/db.ts` (the `tsconfig` already permits it via
  `Bundler` resolution and `allowImportingTsExtensions`).
- **Actual:** Two declarations to keep in sync.
- **Impact:** Drift risk if the row shape changes (e.g. adding a column).
  No current observable harm; the shapes are equal.
- **Recommendation:** `import type { Bookmark, BookmarkInput } from
  '../server/db.ts'` in `src/web/api.ts`, delete the local copies.
- **Owner phase:** Build (follow-up).

**M-3 (process) — Per-task test logs are summary-only after T-002**

- **Evidence:** `tasks/T-004.test-log.txt` through `tasks/T-011.test-log.txt`
  show only the green-phase list; no captured red output. T-002 records
  a "module-not-found" red substitute but T-003+ omit even that.
- **Expected:** Per `weave/phases/review/phase.md`, each task log should
  carry red+green evidence so a reviewer can verify the test was not
  weakened to pass.
- **Actual:** Reviewer must infer red from the absence of the
  implementation rather than read it in the log.
- **Impact:** Audit trail is thinner than the spec calls for. No
  behavioural defect; tests themselves are strong and visibly assert the
  ACs.
- **Recommendation:** In future waves capture at least one failing assertion
  message per task before the green run, or document a substitute red
  (module-not-found / import-resolution failure).
- **Owner phase:** Build process.

**M-4 (P1, minor) — `app.listen` error path is not captured**

- **Evidence:** `src/server/index.ts` wraps `openDb` + `buildApp` +
  `app.listen` in a try/catch, but `app.listen` errors (e.g. EADDRINUSE)
  emit asynchronously on the server's `'error'` event and are not caught
  by the synchronous try/catch.
- **Expected:** Either attach `.on('error', err => { console.error(err);
  process.exit(1); })` to the server, or accept that listen errors
  surface as uncaught — and remove the try/catch wrap that implies they
  are handled.
- **Actual:** Best-effort wrap that does not cover the most likely real
  failure (port collision).
- **Impact:** Local single-user app; port collision is the practical
  failure mode and would crash with an unhelpful default trace instead of
  the wrapped `console.error` path.
- **Recommendation:** Add a one-line `.on('error', ...)` or drop the
  try/catch around `listen`.
- **Owner phase:** Build (follow-up).

### Note

**N-1 — `db.ts` enables WAL journal mode**

- **Evidence:** `db.ts` calls `db.pragma('journal_mode = WAL')`. Not
  named in the design.
- **Impact:** None. WAL is the better-sqlite3 recommended default for
  concurrent reads, and is harmless for a single-user app. The
  `.gitignore` already excludes `bookmarks.db-wal` / `-shm`.
- **Recommendation:** Worth recording in design / develop-log as an
  implementation choice the next reviewer will see in the on-disk
  artefacts.

## Blockers

None.

## Majors

None.

## RETURN counts

- Blockers: 0
- Major: 0
- Minor: 4
- Note: 1
