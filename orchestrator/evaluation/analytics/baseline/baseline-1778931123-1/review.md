---
project: baseline-1778931123-1
phase: review
created: 2026-05-16
---

# Review — Bookmarks

Pass / fail / accepted-risk audit against `spec.md`, `design.md`, `plan.md`, and
Build evidence (`test-report.md`, `smoke-report.md`, `tasks/T-001..T-009.*`).

## Verdict

**PASS — accepted with minor findings.**

- Headline: 0 blockers, 0 major, 3 minor. All 5 user stories' acceptance
  criteria are verified by Vitest + supertest + jsdom + a CLI smoke probe.
  Workspace isolation, stack lock, single-origin serving, loopback-only
  binding, and persistence-across-restart all hold.
- `npm test`: 9 files / 67 tests green (per `test-report.md`).
- `npm start` smoke: 4 PASS, 1 SKIPPED with documented rationale (browser
  harness intentionally out of scope per `tests.md`; jsdom + HTML probes
  cover the same assertions).

## Intent satisfaction

All five seed-named features ship and trace to acceptance criteria:

| Story | Verified by |
| --- | --- |
| US-001 Save | `db.test.ts` (`DuplicateUrlError`, canonicalisation), `api.test.ts` (201/400/409 envelopes), `client-form.test.ts` (field-level error rendering) |
| US-002 List | `db.test.ts` (`created_at DESC, id DESC`), `api.test.ts`, `client-render.test.ts` (empty-state + row content + order) |
| US-003 Open | `client-render.test.ts` asserts `target="_blank"` + `rel="noopener"` on every anchor |
| US-004 Delete | `db.test.ts`, `api.test.ts` (204/404), `client-delete.test.ts` (two-step in-row confirm + 5 s timeout + post-delete refresh) |
| US-005 Boot/test | `server-boot.test.ts` (startServer + static handler), `smoke.test.ts` (double-boot persistence + npm start script shape), live CLI smoke probe |

## Design conformance

- File layout matches `design.md` 1:1 — `app/src/{types,db,server}.ts`,
  `app/src/routes/bookmarks.ts`, `app/src/client/{api,render,form,delete,main}.ts`,
  `app/src/client/{index.html,styles.css}`, `app/scripts/build-client.ts`.
- Layer boundaries are honoured: `routes/bookmarks.ts` imports `db.js` for
  the error classes but not `better-sqlite3`; `db.ts` does not import
  `express`; client never imports server modules.
- Architecture decisions implemented as specified:
  - ADR-001: single Express process serves API + static. ✓
  - ADR-002: three-layer split. ✓
  - ADR-003: synchronous `better-sqlite3`, prepared statements. ✓
  - ADR-004: server-side `new URL().toString()` canonicalisation, UNIQUE
    index on canonical URL, `SQLITE_CONSTRAINT_UNIQUE` re-thrown as
    `DuplicateUrlError`. ✓
  - ADR-005: client reload-on-write (`refresh()` after POST / DELETE). ✓
  - ADR-006: in-row two-step delete confirmation with 5 s timeout, no
    `window.confirm`, no modal. ✓
  - ADR-007: `npm start` runs build then server synchronously. ✓
- Error envelope `{ error: { code, message, field? } }` matches design.

## Plan completion

`board.md` shows all 9 tasks in **Done**, none in Backlog / In Progress /
Review. Story coverage matrix from `plan.md` lines up with the test evidence
matrix in `test-report.md`.

## Test evidence

- Repo: 14 tests covering idempotent migration, canonical URL rules
  (case + protocol + parse-failure), create / list / getById / deleteById,
  ordering, duplicate handling, URL re-saveability after delete.
- HTTP API: 14 supertest assertions covering all routes, all error envelope
  fields, and the no-CORS invariant (`Access-Control-*` not emitted).
- Client: 13 render/api tests + 5 form tests + 5 delete tests covering
  empty-state, link safety (`target=_blank`, `rel=noopener`),
  XSS-via-`textContent`, field-error routing (`url-error` / `title-error` /
  `form-error`), two-step confirm with fake timers, 404 still triggers
  refresh.
- Server boot: 5 tests asserting 127.0.0.1 bind, HTML shell, API endpoint,
  static asset, clean shutdown.
- Smoke: 3 tests — persistence-across-restart on a real temp SQLite file,
  loopback-only bind, `npm start` script shape.
- Build-client: 3 tests confirming esbuild emits `dist/client/{main.js,
  index.html, styles.css}` and the shell references the bundled assets.
- Scaffold: 5 tests confirming locked-stack dependencies and required
  `scripts.start` / `scripts.test`.

Mutation testing: `no` per `tests.md` — local-only single-user CRUD app;
cost not justified.

## Code quality

- All modules are strictly typed (TypeScript `strict: true` in
  `tsconfig.json`).
- Repo uses prepared statements throughout; no string-concatenated SQL.
- Client uses `textContent` / `setAttribute` (never `innerHTML`) when
  rendering user data.
- No commented-out code, no `legacy*` / `*V2` / `*Old` naming, no parallel
  old/new code paths.

## Principle compliance (P1–P7)

Per `orchestrator/principles.md ## Review checklist`.

- **P1 Lean changes.** Two out-of-scope edits recorded in `test-report.md`:
  (a) adding `jsdom` to devDependencies (required by Vitest jsdom env used
  across T-006/T-007/T-008 client tests — single install, three consumers);
  (b) removing `rmSync(dist/client)` from `build-client.test.ts` to
  eliminate a race against parallel test files reading the same directory.
  Both are justified in `tasks/T-006.done.md` and `tasks/T-009.done.md`.
  No blocker.
- **P2 Existing patterns.** Greenfield workspace — no prior in-repo art to
  match. Stack lock (`express`, `better-sqlite3`, `esbuild`, `vitest`,
  `supertest`, `tsx`, `typescript`, `jsdom` for tests) is respected; no
  additional runtime dependencies. ✓
- **P3 Zero duplication.** `errorEnvelope` helper centralises the error
  shape in the router. `jsonRequest` wraps `fetch` in the client API.
  Validation branches in the POST handler are distinct (title-empty vs
  url-empty vs duplicate vs parse-failure vs unsupported-protocol) and not
  duplicative. ✓
- **P4 One clean implementation.** No `legacy*` / `*V2` / `*Old` symbols.
  No commented-out blocks. No feature-flag dual paths. ✓
- **P5 No speculative scaffolding.** *Minor.* `BookmarkRepo.getById` is
  declared in the interface and exported from `db.ts` but is **not called by
  any HTTP route, client, or smoke test** in this PR — only by `db.test.ts`,
  which tests the repo's own surface. Design.md does name `getById` in the
  `BookmarkRepo` signature, so it's a design-mandated surface, not a
  freelance addition. Severity: minor.
- **P6 Tests describe behaviour.** Client tests mock `globalThis.fetch` —
  this is an external boundary (network), which is the explicitly allowed
  case in P6. No internal collaborators are mocked. The delete-handler
  test uses `vi.useFakeTimers()` to drive the 5 s timeout deterministically,
  which is a time-boundary mock, not a structural one. ✓
- **P7 Don't fight the framework.** Server uses Express built-ins
  (`express.json()`, `express.static()`, `Router()`) without wrappers. No
  custom router, no custom body parser, no custom middleware stack. ✓

Constraint precedence: no `spec.md ## Constraints` entry conflicts with a
principle for this project.

## Findings

### F-001 — `BookmarkRepo.getById` has no in-PR consumer outside its own unit tests
- **Severity:** Minor (P5)
- **Evidence:** `app/src/db.ts` exposes `getById` on `BookmarkRepo`; only
  `app/test/db.test.ts` calls it.
- **Expected:** Either a route or a smoke path consumes it, or the design
  drops it from the interface.
- **Actual:** Declared and tested in isolation; no production caller.
- **Impact:** Minor — adds one prepared statement and one interface method
  with no current consumer. Easy to remove if the design ever drops it.
- **Recommendation:** Accepted risk — the design names `getById` explicitly
  in the `BookmarkRepo` signature, so the implementation matches the
  contract. If a future design pass removes it, delete in the same PR.
- **Owner phase:** none (no action required this run).

### F-002 — `400 validation` for malformed `url` field type omits `field: 'url'`
- **Severity:** Minor (design conformance, not a principle violation)
- **Evidence:** In `app/src/routes/bookmarks.ts` lines 30–34, when `body.url`
  is not a string (`url: 123` test in `api.test.ts`) the response omits
  `field`. Other validation branches in the same handler set `field`.
- **Expected:** Per `design.md ## State and error handling`, the validation
  envelope may carry `field?: 'url' | 'title'`, and the offending input is
  the `url` field.
- **Actual:** Returns `{ error: { code: 'validation', message: '…' } }` with
  no `field`.
- **Impact:** Minor — the client falls back to `form-error` rather than the
  field-specific slot; existing tests pass because the test only asserts
  `error.code === 'validation'`.
- **Recommendation:** Add `'url'` (or distinguish title-missing vs
  url-missing in the shape check) if/when the form needs field-level UX for
  this path. Not blocking now.
- **Owner phase:** future Build (small follow-up if user feedback requires).

### F-003 — POST handler order: title-empty check runs before URL emptiness check
- **Severity:** Minor (design conformance — stylistic)
- **Evidence:** `app/src/routes/bookmarks.ts` checks `title.trim().length`
  before `rawUrl.length`. `design.md` lists the validation order as:
  body-shape → title-trim → URL-parse.
- **Expected:** Same sequence in code; treating empty url through
  `canonicaliseUrl` would surface `field: 'url'` consistently.
- **Actual:** Empty-string url is special-cased before reaching
  `canonicaliseUrl`, which still produces `field: 'url'` — just via a
  different branch.
- **Impact:** None observable; all `api.test.ts` cases pass.
- **Recommendation:** Note only; the observable behaviour and the response
  envelope match the design.
- **Owner phase:** none.

## Safety

- **Network exposure:** `app.listen(3000, '127.0.0.1')` — loopback only,
  asserted in `server-boot.test.ts` and `smoke.test.ts`.
- **Link safety:** every rendered anchor carries `rel="noopener"` and
  `target="_blank"`, asserted in `client-render.test.ts`.
- **XSS:** all user data rendered via `textContent` / `setAttribute('href',
  …)`; `render` test confirms no `<script>` element is materialised from
  hostile titles/urls.
- **SQL injection:** repo uses prepared statements exclusively.
- **CORS / cross-origin:** none — same-origin by construction; `api.test.ts`
  asserts no `Access-Control-*` headers are emitted.
- **Persistence safety:** the SQLite file is created next to the server,
  excluded by `.gitignore` (`*.sqlite`).
- **Process safety:** SIGINT/SIGTERM handlers installed; `close()` is
  idempotent and verified by `server-boot.test.ts`.

No security concerns. No money, no auth, no PII, no irreversible operations
beyond the local SQLite delete.

## User feedback

Not collected (baseline eval run — no human user is available; the dispatch
context disables `AskUserQuestion`). See `feedback.md`.

## Process learnings

See `develop-log.md` (this workspace) and `orchestrator/log/{audit,build}.md`
for the cross-shard entries.

## Open ambiguity

None. All Spec-phase questions are answered in `decisions.md` (Q01–Q05).
All design-time tactical questions are settled in `design.md`. No follow-up
HITL is required.

## Routing

No findings route to a phase. All three minor findings are notes /
accepted-risk; none block ship.
