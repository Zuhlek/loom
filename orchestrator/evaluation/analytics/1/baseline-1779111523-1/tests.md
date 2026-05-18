---
project: baseline-1779111523-1
phase: plan
created: 2026-05-18
---

# Tests — baseline-1779111523-1

**Mutation Testing:** no

Verification strategy for the local-only Bookmarks app. All tests run
via Vitest from `.loom/baseline-1779111523-1/app/` with
`npm test`. Tests exercise the same code paths `npm start` runs (no
mocks of the DB or HTTP layers), per ADR-009.

## Test harness

- Runner: Vitest (1.x or 2.x), invoked as `npm test` from `app/`.
- Express app under test: built in-process via
  `createApp(repo)` from `src/server/index.ts`.
- HTTP exerciser: `supertest`-style against a `listen(0)` handle, or
  Node's built-in `fetch` against the bound ephemeral port.
- Storage under test: real `better-sqlite3` against a temp SQLite file
  per test file (`fs.mkdtempSync` + `BOOKMARKS_DB_PATH`); torn down in
  `afterAll`.
- No mocks of the repository. No mocks of the DB.

## Coverage strategy

Per the agent's contract, every task carries a behaviour-level test
sketch derived from the EARS clauses of the stories it satisfies. The
per-task sketches live in `tasks/T-NNN.md`. The aggregate matrix:

| Story | EARS clauses | Test home |
| --- | --- | --- |
| US-001 AC1 | persist new bookmark; render at top | T-002 HTTP round-trip + list-order assertion |
| US-001 AC2 | reject duplicate URL inline | T-002 duplicate-URL test (409) |
| US-001 AC3 | reject empty/whitespace URL or title | T-002 validation test (400) |
| US-002 AC1 | render every bookmark newest-first on `/` | T-001 GET-list test + T-002 ordering assertion |
| US-002 AC2 | display title and URL per row | T-001 (list shape) + T-003 (render-helper unit) |
| US-002 AC3 | empty-state message when list empty | T-001 empty-state render-helper unit |
| US-003 AC1 | clicking title/URL opens in new tab | T-003 render-helper unit: anchor `target="_blank"` and `rel="noopener noreferrer"` present |
| US-003 AC2 | original tab preserves list view | T-003 render-helper unit: anchor does not navigate the current document (default browser semantics; assert markup) |
| US-004 AC1 | delete control removes row from DB and list | T-004 DELETE round-trip + list re-fetch shape |
| US-004 AC2 | deletion persists across restart | T-004 + T-005 (cross-task gate) |
| US-005 AC1 | bookmarks survive `npm start` restart | T-005 process-recreate gate |
| US-005 AC2 | single SQLite file is canonical store | T-001 + T-005 (file-path assertion) |

## Gates

### Smoke

After every Build dispatch, the smoke gate runs:

1. `npm ci` (or `npm install` on first run) inside `app/` exits 0.
2. `npm test` inside `app/` exits 0 with at least one test reporting
   from each of: `tests/repository.*`, `tests/routes.*`,
   `tests/client.*`.
3. A `npm start` boot-and-curl probe: spawn the server on port 3000,
   `curl -fsS http://localhost:3000/` returns 200 with `text/html`,
   then send `SIGTERM` and confirm clean exit. (This is the
   build-time smoke, not part of `npm test`.)

### Story acceptance

The Story acceptance gate is the set of Vitest specs declared per-task
in `tasks/T-NNN.md`. Build cannot mark a task `Done` unless its
declared specs pass.

### Mutation

Not applicable for this plan (`Mutation Testing: no` above). Re-evaluate
if the scope ever grows to include irreversible operations, security
boundaries, or money.

## Out of scope for the test suite

- Visual regression / pixel-diff of the UI.
- End-to-end browser automation (Playwright / Puppeteer). The vanilla-TS
  client surface is small and pure-function tests cover its render
  contract; the seed's minimal-surface directive does not justify a
  browser harness.
- Load / performance benchmarks. Single-user laptop scale; out of scope
  per `design.md § Constraints`.
- Network-resilience tests. The app makes no outbound calls
  (`spec.md ## Constraints § Local-only`).
