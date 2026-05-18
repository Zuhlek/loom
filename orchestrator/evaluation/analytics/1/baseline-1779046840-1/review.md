# Review — baseline-1779046840-1

**Verdict:** PASS — 0 Blockers, 0 Major, 2 Minor, 3 Notes.

The local-only Bookmarks app at `.loom/baseline-1779046840-1/app/`
satisfies every user story US-001…US-004 with behaviour-level tests,
respects every Spec constraint (workspace isolation, stack pin,
SQLite-level URL uniqueness, one-process/one-origin), and ships in 12
green AFK tasks on first attempt. 53/54 active vitest tests pass; the
skipped one is a retained scaffolding placeholder. `npm install && npm
run build && npm test` is green end-to-end, with `dist/client/app.js`,
`dist/client/index.html`, `dist/client/styles.css`, and
`dist/server/index.js` all produced.

`git status` confirms zero deliverable writes outside the workspace
(`.loom/baseline-1779046840-1/app/`); only orchestrator log/eval
files are dirty at the repo level.

## Intent satisfaction

| Story | Acceptance criteria | Evidence |
| --- | --- | --- |
| US-001 save | AC1 persist + 201; AC2 list updates without reload; AC3 duplicate rejected; AC4 validation rejected | `test/api.test.ts` POST cases (5), `test/client/main-save.test.ts` (5), `test/db.test.ts` duplicate-throws case |
| US-002 list newest-first | AC1 newest-first; AC2 title+url+delete; AC3 empty-state | `test/api.test.ts` GET cases (3), `test/client/main-list.test.ts` (4), `test/db.test.ts` order case |
| US-003 open in new tab | AC1 target=_blank; AC2 page unchanged | `test/client/main-open.test.ts` (3) — covers target/rel/href contract and no-navigate behaviour |
| US-004 delete | AC1 row removed from SQLite; AC2 row removed from list without reload; AC3 non-fatal 404 banner | `test/api.test.ts` DELETE cases (4), `test/client/main-delete.test.ts` (5) |

## Design conformance

- Module layout matches `design.md § System shape` exactly:
  `src/server/{index,db,routes,static}.ts`, `src/client/{main,api,dom}.ts`,
  `src/shared/types.ts`, `test/{api,db,static,smoke}.test.ts`,
  `test/client/*`.
- REST contract matches the design table: `GET /api/bookmarks` →
  `200 { bookmarks }`, `POST` → `201 { bookmark }` or `400`/`409`,
  `DELETE /api/bookmarks/:id` → `204` or `404`.
- Error envelope `{ error: { code, message, field? } }` matches.
  Implementation adds a fourth code `internal` for the 500 path —
  see Note N-1.
- SQLite schema matches `design.md § Data model`: `id INTEGER PRIMARY
  KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime(...))`. UNIQUE constraint
  is the authoritative duplicate check per ADR-002. `ORDER BY id DESC`
  per ADR-003. `createApp(db, staticRoot)` factory separated from
  `listen()` per ADR-005.
- ADR-006 honoured: `npm start` chains `npm run build` (`tsc -p
  tsconfig.server.json && node esbuild.config.mjs`) before
  `node dist/server/index.js`.

## Plan completion

All 12 tasks Done on board.md. Coverage table in `test-report.md`
shows every task green. Two recorded plan-vs-board drifts (handlers
landed in T-008, `prependItem` landed in T-007) are noted in their
respective `.done.md` files — see Minor M-1.

## Test evidence

- 53 passed | 1 skipped | 0 failed across 10 active vitest files.
- Smoke gate (`test/smoke.test.ts`) exercises the full POST → GET →
  duplicate → DELETE → DELETE-missing → GET cycle against a real
  temp-file SQLite DB via `createApp()`, and asserts the HTML shell
  is served at `/`.
- Behaviour tests, not structural. Mocks are confined to either the
  global `fetch` (client `api.ts` tests) or an `api` deps object
  injected through `bootstrap(doc, { api })` — both are boundaries,
  not internal collaborators. P6 clean.

## Code quality / principle compliance walk

| Principle | Status | Notes |
| --- | --- | --- |
| P1 Lean changes | OK | No drive-by refactors; every file traces to a task / design module. The defensive non-numeric-id 400 in `routes.ts` DELETE is mentioned as N-2 (a small expansion past the design's stated 404-only path). |
| P2 Existing patterns | OK | No prior repo patterns to defer to — this is a greenfield workspace. Conventions used (express + better-sqlite3 + esbuild + vitest) are the stack the seed pinned. Minor M-1 records cross-task scope drift. |
| P3 Zero duplication | OK | No 3+ repeated structures. `buildItem` in `dom.ts` is the single source for row construction, shared by `renderList` and `prependItem`. |
| P4 One clean implementation | OK | No `legacy*` / `*V2` / `*Old` / `*Deprecated` naming. No commented-out blocks. The only `//` comments are eslint-disable-next-line annotations and section markers in `main.ts`. No parallel old/new paths. |
| P5 No speculative scaffolding | One Minor (M-2) | `test/_placeholder.test.ts` retained even though real tests landed — no consumer remains. Every other new file/abstraction has a consumer in the diff. |
| P6 Tests verify behaviour | OK | Tests assert on return values, DOM state, and HTTP status. Mocking is at boundaries (global `fetch`, injected `api` deps). No internal-method-call assertions. Test names describe behaviour. |
| P7 Don't fight the framework | OK | Express routing, `express.json`, `express.static`, `express.Router` used as designed; no wrappers. better-sqlite3 prepared statements with `@named` params, no hand-rolled escaping. |

## Findings

### Minor

#### M-1 (P2) — Scope drift between plan and board

- **Evidence.** `tasks/T-007.done.md` records that `prependItem` landed
  in T-007 even though the plan placed it under T-009. `tasks/T-008.done.md`
  records that the save-form submit handler and the delegated delete
  handler landed in T-008 even though the plan placed them under T-009
  and T-011 respectively. `test-report.md` § Anomalies confirms the
  same three drifts.
- **Expected.** Per `plan.md § Dependency graph`, T-009 owns the save
  form including any new dom helper it needs; T-011 owns the delete
  control click handler.
- **Actual.** All three pieces of implementation landed in T-007/T-008.
  T-009 and T-011 then only added their behaviour test files.
- **Impact.** No behaviour gap. Tests still pass and acceptance criteria
  are still verified by the task that owns the user story. The drift
  weakens the per-task contract — a reader of the plan cannot find the
  save-form code in T-009.
- **Recommendation.** Either (a) re-slice the plan to land the bootstrap
  factory and its handlers together as a single foundation task, or
  (b) enforce that the plan-named task owns the implementation and the
  test, not just the test.
- **Owner phase.** plan (next project) or build coordinator policy.

#### M-2 (P5) — Skipped placeholder test retained

- **Evidence.** `app/test/_placeholder.test.ts` exists with a single
  `it.skip(...)`. `develop-log.md` records it as "harmless once real
  tests landed". Smoke report shows it as 1 skipped of 54.
- **Expected.** Per principle P5, every new file must have a consumer.
  Once real tests landed (T-002+), the placeholder file has no consumer
  and no signal value.
- **Actual.** File retained, contributes a skipped count to every test
  run.
- **Impact.** Cosmetic — slightly muddies test summaries with a stale
  "1 skipped" line.
- **Recommendation.** Delete `test/_placeholder.test.ts` in any
  follow-up that touches `test/`.
- **Owner phase.** Build (follow-up task) or accepted-as-is.

### Note

#### N-1 — Error envelope extended beyond design

- `src/shared/types.ts` declares `ApiError` with four codes
  (`validation | duplicate | not_found | internal`) and allows
  `field` on `validation` (with `id` as a third value), `duplicate`,
  and `validation`. `design.md § REST API` declared only the first
  three codes and only `title | url` for `field`.
- Used by: `routes.ts` errorHandler (500 → `internal`), DELETE
  non-numeric id (400 → `validation field=id`), 409 duplicate
  (`field: url`).
- All extensions trace to real handler paths in the same diff. No
  consumer-side breakage.

#### N-2 — DELETE 400-on-non-numeric-id beyond design

- `design.md § Server error mapping` lists DELETE's failure modes as
  `404 not_found` only. `routes.ts` adds a `400 validation` response
  when the `:id` path segment is non-numeric, asserted by a test in
  `test/api.test.ts`.
- Impact: defensive, no behavioural regression — the 404 path still
  exists for missing rows.

#### N-3 — `db.ts` enables WAL journal mode

- `src/server/db.ts` line 40: `db.pragma('journal_mode = WAL');` —
  not declared in `design.md`. Produces `bookmarks.db-wal` and
  `-shm` side files at runtime.
- Impact: none for the single-user, single-process model the spec
  assumes. Worth recording so an operator isn't surprised by the
  extra files.

## Safety

- No auth surface, no network calls beyond localhost — matches Spec
  constraint #5.
- Anchor tags use `rel="noopener noreferrer"` per design `§ Security`.
- DOM rendering uses `textContent` / attribute setters, no `innerHTML`.
  `main-open.test.ts` asserts the no-injection contract against a
  malicious-looking title/url pair.
- SQLite UNIQUE(url) enforces duplicate detection atomically per Spec
  constraint #6 / ADR-002.

## User feedback

Not solicited this cycle (AFK plan, no HITL gates). No
`feedback.md` written — there is nothing to capture.

## Process learning

See `develop-log.md` for project-local notes. Cross-phase observations
(M-1 plan-vs-board drift, M-2 placeholder retention) are dual-written
to `orchestrator/log/audit.md`.

## Unresolved work

None blocking. Two Minor findings routed to follow-up build cleanup or
plan policy refinement; both are acceptable to defer.
