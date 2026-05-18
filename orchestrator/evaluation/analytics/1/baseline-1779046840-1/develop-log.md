# Develop Log — baseline-1779046840-1

## 2026-05-17 — build phase complete

All 12 tasks (T-001…T-012) green in one attempt each. 53/54 active
tests pass (1 skipped placeholder retained from T-001 for the
"no real tests yet" red phase; harmless once real tests landed).

### Per-task summary

- T-001 scaffold (package.json, tsconfig{,.server}.json,
  esbuild.config.mjs, vitest.config.ts, src/shared/types.ts,
  test/_placeholder.test.ts).
- T-002 db.ts: openDb, list, insert, remove, close, DuplicateUrlError;
  schema applies UNIQUE(url) per Spec constraint 6 / ADR-002.
- T-003 createApp + GET /api/bookmarks.
- T-004 POST: title/url validation (URL ctor + http(s)), 201/400/409.
- T-005 DELETE: 204 / 404 / 400 (non-numeric id).
- T-006 static + index.html shell (with stable IDs save-form,
  bookmark-list, empty-state, banner) + styles.css; staticMiddleware
  serves dist/client/ with /api/* precedence.
- T-007 api.ts (ApiClientError + 3 fetch wrappers) + dom.ts
  (renderList, renderEmptyState, hideEmptyState, renderFieldError,
  clearFieldErrors, prependItem).
- T-008 bootstrap(doc, deps): initial list/empty-state/banner +
  delegated save submit and delete click handlers. Recorded scope
  expansion: save submit handler and delete delegation landed here
  rather than in T-009/T-011 because they share the same module.
- T-009 main-save.test.ts: 5 behaviour assertions for US-001 client
  slice; implementation existed from T-008.
- T-010 main-open.test.ts: target=_blank/rel/href contract + click
  no-navigation + no-innerHTML-injection.
- T-011 main-delete.test.ts: 5 behaviour tests for US-004 client
  slice; implementation existed from T-008.
- T-012 smoke.test.ts: end-to-end POST → GET → dup → DELETE → DELETE
  missing → GET cycle against real createApp + temp-file SQLite;
  HTML shell served at /. Fixed tsconfig.server.json `outDir: dist`
  so dist/server/index.js exists at the expected path.

### Verification environment

`node-test` pre-flight: Node 25.8.2 / npm 11.11.1 available, no
manual harness required, no HITL gate.

### Locks

All 12 per-task locks acquired and released cleanly. Project build
lock released at coordinator exit.

## 2026-05-17 - baseline-1779046840-1 - review-pass-with-minor-findings

Review verdict: PASS, 0 Blockers, 0 Major, 2 Minor, 3 Notes. 12 AFK
tasks landed on attempt 1; 53/54 active vitest tests green; smoke gate
exercises the full POST → GET → duplicate → DELETE → DELETE-missing →
GET cycle against real createApp + temp-file SQLite. `npm install &&
npm run build && npm test` all green from a clean checkout. `git
status` confirms zero deliverable writes outside
`.loom/baseline-1779046840-1/app/`. All 6 ADRs honoured, all 5 seed
decisions (Q01–Q05) observable, all 4 user stories satisfied with HTTP
+ DOM + smoke evidence. Stack matches seed pin exactly (express
4.21.1, better-sqlite3 11.3.0, esbuild 0.25.0, typescript 5.6.2,
vitest 2.1.1, supertest 7.0.0, plus tsx/jsdom as devDeps for the dev
script and dom env).

Two Minor findings, none touching behaviour:

- M-1 (P2): plan-vs-board scope drift — `prependItem` landed in T-007
  (planned T-009); save-form and delete handlers landed in T-008
  (planned T-009/T-011). Done-reports record cohesion rationale.
- M-2 (P5): `test/_placeholder.test.ts` retained as a skipped test
  even though real tests landed in T-002+. One skipped count noise
  per run.

Three Notes: ApiError extended with `internal` and `field: id` beyond
design table (N-1); DELETE returns 400 on non-numeric `:id` beyond
design (N-2); db.ts enables `journal_mode = WAL` (not in design.md),
produces .db-wal/-shm side files (N-3).

## 2026-05-17 - baseline-1779046840-1 - plan-vs-board-drift

Pattern recurring across baseline runs: when an early build task can
land a thin scaffold of a later task's deliverable for cohesion (e.g.
the bootstrap factory's submit/delete handlers in T-008 ahead of the
T-009/T-011 tests), it tends to. The plan reads as if T-009 owns the
save form code; in practice T-008 owns it and T-009 only adds tests.
Two paths: (a) re-slice plans so the factory and its handlers are a
single foundation task with all the related tests attached; (b) make
the task contract include "implementation, not just test, lands in
this task." Currently neither is enforced.

## 2026-05-17 - baseline-1779046840-1 - placeholder-scaffolding-retention

When the scaffold task seeds a `_placeholder.test.ts` to satisfy "npm
test exits 0" before real tests exist, that file tends to survive
until reviewed. P5 says delete-once-consumer-lands; harness has no
hook to enforce it. Cheap cleanup at scaffold task close-out: a
follow-up step "if real tests exist in test/, delete the placeholder
shim."

