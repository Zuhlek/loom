---
project: baseline-1779111523-1
phase: review
created: 2026-05-18
---

# Review — baseline-1779111523-1

**Verdict:** PASS.

The local-only Bookmarks app under `.loom/baseline-1779111523-1/app/`
satisfies every story (US-001..US-005), conforms to the design
(routes/repository/validation/client split per `design.md § System
shape`), and completes every planned task (T-001..T-005, all green
on first attempt). The smoke gate passes: `npm test` exits 0 with
40/40 assertions across 11 files, and the boot-and-curl probe
confirms `GET /` serves the bundled UI and `GET /api/bookmarks`
returns `{"bookmarks":[]}` on a fresh DB. No blockers. No major
findings. Three notes captured for posterity. The
`spec.md ## Constraints` workspace-isolation invariant is respected
(every file lives under `app/`; no writes outside).

## Intent satisfaction

| Story | Acceptance criteria | Evidence | Status |
| --- | --- | --- | --- |
| US-001 | save persists + tops list; duplicate rejected; empty/whitespace rejected | `tests/routes.create.test.ts` (6), `tests/validation.test.ts` (6), `tests/repository.create.test.ts` (3) | met |
| US-002 | newest-first list; title+URL per row; empty state | `tests/routes.list.test.ts`, `tests/repository.list.test.ts`, `tests/client.render.test.ts` | met |
| US-003 | open in new tab; original tab preserved | `tests/client.open.test.ts` (target=_blank + rel hardening, no JS handler) | met |
| US-004 | delete removes from DB and list; survives restart | `tests/routes.delete.test.ts`, `tests/repository.delete.test.ts`, `tests/client.delete.test.ts`, `tests/persistence.restart.test.ts` | met |
| US-005 | survives restart; single SQLite file canonical | `tests/persistence.restart.test.ts` (two-stage open/close/reopen + negative control) | met |

The three Design-level UX defaults (URL validation = WHATWG `URL`,
one-click delete, "Already bookmarked." copy on 409) are wired
verbatim into the implementation (`validation.ts` → `new URL()`;
`routes/bookmarks.ts` → 409 body `Already bookmarked.` with
`field: 'url'`; no confirmation modal in `client/main.ts`).

## Design conformance

- Layer separation (`design.md § Components and ownership`) is
  intact: only `db/bookmarks.ts` and `db/connection.ts` import
  `better-sqlite3`; routes call the repository; client never imports
  server modules.
- HTTP contract (`design.md § Interfaces`) is met:
  - `GET /api/bookmarks` → `200 {bookmarks: Bookmark[]}` newest-first.
  - `POST /api/bookmarks` → `201` on success; `400 invalid_input` on
    validation; `409 duplicate_url` with `field:'url'` and
    `message:'Already bookmarked.'` on UNIQUE conflict.
  - `DELETE /api/bookmarks/:id` → `204` / `404 not_found`. A `400
    invalid_input` extra case (non-integer id) was added in
    `routes/bookmarks.ts` — this matches the design's "uniform error
    body" pattern and is a strict superset of the documented
    behaviour, not a regression.
- Data model: schema matches `design.md § Data model` (UNIQUE(url),
  ISO-8601 ms `created_at`, `(created_at DESC, id DESC)` index).
  `DuplicateUrlError` mapped from `SQLITE_CONSTRAINT_UNIQUE` per
  ADR-003.
- TypeScript signatures match (`createApp(repo)`, `start(port?)`,
  repository interface, `normaliseInput`, client helpers).
- ADRs honoured: ADR-002 (synchronous repo, no async wrapper),
  ADR-003 (schema UNIQUE + caught constraint), ADR-004 (re-fetch
  after mutation), ADR-005 (ISO-8601 TEXT), ADR-006 (WHATWG URL),
  ADR-007 (one-click delete), ADR-008 (`innerHTML` rebuild + event
  delegation), ADR-009 (Vitest + temp SQLite via `BOOKMARKS_DB_PATH`).

## Plan completion

All five planned tasks shipped green on first attempt:

- T-001 spine: workspace, DB bootstrap, GET list, static UI, client
  bundle (10 tests).
- T-002 save: validation + POST + duplicate handling (15 tests).
- T-003 open: anchor markup with `target="_blank"`/rel hardening
  (4 tests).
- T-004 delete: DELETE route, button delegation, re-fetch (9 tests).
- T-005 restart-persistence gate: two-stage Vitest spec on disk
  (2 tests).

Coverage matrix (`tests.md`) is fully met. No tasks in `board.md ##
Backlog` or `## In Progress`. `pipeline.md` history is consistent:
all phases advanced cleanly to review.

## Test evidence

40/40 Vitest assertions pass across 11 files (`test-report.md`,
`smoke-report.md`). Tests exercise the real Express handle via
`supertest` against real `better-sqlite3` on temp files (`ADR-009`)
— no internal mocking. Client-side delegation tests use `happy-dom`
(declared out-of-scope-edit in `T-004.done.md`). Smoke boot/curl:
`GET /` → 200 HTML referencing `/public/app.js`; `GET /api/bookmarks`
→ `200 {"bookmarks":[]}`; SIGTERM clean.

## Code quality / principle compliance

Walked P1–P7 against the diff under `app/`:

- **P1 (lean changes).** Every line ties to an acceptance criterion
  or a Design ADR. No drive-by refactors. One small addition over
  the documented contract: `DELETE /api/bookmarks/:id` rejects
  non-integer ids with `400 invalid_input` before consulting the
  repository. The design only enumerated `204 / 404 not_found` for
  this route. The 400 is a defensive parse guard for a route param
  the design treats as untyped — see Note 1 below.
- **P2 (existing patterns).** No new framework dependencies; stack
  matches the seed lock. Naming follows TypeScript camelCase
  consistently; SQL stays snake_case at the boundary as designed.
- **P3 (zero duplication).** No three-instance repeats. The two
  render-paths (`renderListHtml` and `render`) are flagged in
  Note 2.
- **P4 (one clean implementation).** No `legacy*`, no `*V1`/`*V2`,
  no commented-out code, no parallel old/new paths. Stubbed
  `create`/`delete` from T-001 were replaced in place by T-002/T-004
  (no compatibility wrapper left behind).
- **P5 (no speculative scaffolding).** Every export has a consumer.
  See Note 2 about `renderListHtml`.
- **P6 (tests describe behaviour).** Tests assert on HTTP status,
  bodies, rendered HTML strings, and DB observable state. No
  internal-method-call assertions. No mocks of repository or DB
  modules.
- **P7 (don't fight the framework).** Uses `express.Router`,
  `express.static`, `express.json` directly. No wrappers.

## Safety

- Local-only invariant holds: no outbound `fetch` / `http.request` in
  server code; client `fetch` calls hit same-origin
  `/api/bookmarks` only.
- No auth (intentional, single-user laptop). Server is `localhost`
  by default via `listen(port)`; `process.env.PORT` override is
  bounded to numeric in `start()`.
- XSS surface: title and URL pass through `escapeHtml` before being
  injected into the row template. Anchor `href` is escaped; click
  attributes (`onclick`, `javascript:` schemes) are absent and
  explicitly asserted against in `tests/client.open.test.ts`.
- `noopener noreferrer` on all bookmark anchors prevents
  reverse-tabnabbing.
- SQL: all writes use prepared statements with bound parameters; no
  string interpolation into SQL.
- File system: `mkdirSync` in `connection.ts` is bounded to the
  resolved DB path's directory; `BOOKMARKS_DB_PATH` is the only
  user-controllable input and it is resolved (no traversal beyond
  the supplied absolute path).

## User feedback

None solicited or recorded for this review pass — Spec, Design, and
Plan all converged with `complete` and no open HITL items. No
follow-up feedback writeback to `feedback.md` required.

## Findings

### Note 1 — DELETE returns 400 for non-integer ids beyond design enumeration

- **Severity:** note
- **Evidence:** `src/server/routes/bookmarks.ts:48-58` returns
  `400 invalid_input` when `:id` is not a non-negative integer.
  `design.md § Interfaces` lists only `204` and `404 not_found` for
  this route.
- **Expected:** A documented response set covering 400 explicitly,
  or the parse guard removed.
- **Actual:** Code emits a defensive 400 with the uniform error
  envelope. The 400 is correct behaviour (`Number("not-a-number")`
  → `NaN`; passing `NaN` to `repo.delete` would silently return
  `false` and surface as a misleading 404), and the asserted
  envelope shape matches `ApiError`.
- **Impact:** None — clients only ever send numeric ids generated
  by the server, and the catch is defensive. Future API
  documentation should list 400 alongside 404.
- **Recommendation:** When `design.md § Interfaces` next gets edited
  (a follow-up plan item), enumerate 400 for the DELETE row.
- **Owner phase:** design (cosmetic doc update).

### Note 2 — `renderListHtml` is consumed only by tests, not by the production `render()` path

- **Severity:** note (P5 boundary case — has a consumer, but only
  in tests).
- **Evidence:** `src/client/main.ts:27-33` defines `renderListHtml`.
  Production `render()` at `:68-77` builds the rows itself via
  `state.bookmarks.map((b) => renderRowHtml(b)).join('')` — the
  same composition `renderListHtml` performs (except for the empty
  state). `renderListHtml` is imported only by
  `tests/client.render.test.ts` and `tests/client.open.test.ts`.
- **Expected:** A single render path used by both runtime and
  tests (or an explicit "test-only" annotation).
- **Actual:** Two near-identical compositions exist; runtime calls
  the inline form, tests call `renderListHtml`. Both go through
  the same `renderRowHtml`, so the rendered output is consistent in
  practice.
- **Impact:** Minimal — the duplication is two lines and both paths
  share the row helper. A future change to row ordering or wrapper
  markup must be made in two places.
- **Recommendation:** In a follow-up tidy, have `render()` delegate
  to `renderListHtml` and let `innerHTML` consume its return value.
  Not worth bouncing this build.
- **Owner phase:** build (follow-up).

### Note 3 — `happy-dom` devDep was an out-of-scope addition

- **Severity:** note (already disclosed; not a violation).
- **Evidence:** `T-004.done.md › out-of-scope-edits` records the
  addition; `test-report.md` and `smoke-report.md` both flag it.
- **Expected:** All deps listed in `files-likely-touched` per
  task spec.
- **Actual:** `happy-dom` was added to enable the
  `@vitest-environment happy-dom`-annotated DOM delegation test in
  `client.delete.test.ts`. Disclosure is correct; the package is a
  devDep only and is not bundled into the runtime or the client
  output (`public/app.js`).
- **Impact:** None — it is a test-only dependency, properly scoped.
- **Recommendation:** Plan phase could call out DOM-test deps
  pre-emptively next time; not a blocker.
- **Owner phase:** plan (process tweak).

## Process learning (project-local)

See `develop-log.md` for the build-phase observations and the new
review-phase entry below. Build-phase entries were dual-written to
`orchestrator/log/build.md` at build time (verified). No
spec/design/plan or audit observations were captured in
`develop-log.md`, so no missing global appends to flag.

## Open ambiguity

None remaining. The three Spec-level open items were settled at
Design and are honoured in code. No items to defer to a later
phase.

## Routing of unresolved work

- Note 1 → Design doc tweak (non-blocking).
- Note 2 → Build follow-up (non-blocking).
- Note 3 → Plan/process tweak (non-blocking).

No work routed back to Spec, Design, Plan, or Build for this
project.
