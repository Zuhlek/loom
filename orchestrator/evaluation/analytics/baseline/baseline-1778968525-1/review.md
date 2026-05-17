---
project: baseline-1778968525-1
phase: review
created: 2026-05-17
---

# Review — baseline-1778968525-1

## Verdict

**Pass.** All four user stories are satisfied end-to-end. Every spec
constraint is honoured (workspace isolation under `app/`, stack pinning,
one-command run/test, localhost-only bind, all state in SQLite,
`UNIQUE(url)` at schema level, same-origin asset serving, minimum
surface). Plan executed 10/10 tasks; aggregated suite 48/48 green;
`tsc --noEmit` clean; live smoke probes exercised every API path. No
blockers found. Findings below are minor.

## Coverage of user stories

| Story | Status | Evidence |
| --- | --- | --- |
| US-001 Save | green | `tests/repository.test.ts` (create + duplicate), `tests/validation.test.ts` (INVALID_TITLE / INVALID_URL), `tests/routes.test.ts` (201/400/409), `tests/api.test.ts` (UI fetch wrapper), live POST → 201, dup → 409 |
| US-002 List newest-first | green | `tests/repository.test.ts` (`ORDER BY created_at DESC, id DESC`), `tests/routes.test.ts` (empty + ordered), `tests/dom.test.ts`, smoke `GET /api/bookmarks` |
| US-003 Open in new tab | green | `tests/dom.test.ts` asserts `target="_blank"` + `rel="noopener noreferrer"` on both anchors; structural review of `app/public/index.html` and `src/web/dom.ts` |
| US-004 Delete | green | `tests/repository.test.ts`, `tests/routes.test.ts` (204/404/400), `tests/api.test.ts`, smoke DELETE → 204 / 404 |

## Spec constraints conformance

| Constraint | Status | Notes |
| --- | --- | --- |
| Workspace isolation under `./app/` | OK | All deliverables under `.loom/baseline-1778968525-1/app/`; no writes to repo root, `orchestrator/`, or sibling workspaces. `git status` shows no app-tree changes in the parent repo working tree. |
| Stack pinning (TS / Node / Express / better-sqlite3 / esbuild / Vitest, no FE framework) | OK | `package.json` deps match; no React/Vue/Svelte/htmx/Alpine/jQuery; web bundle is vanilla TS. |
| `npm start` boots Express on `http://localhost:3000` | OK | `src/server/index.ts` binds `127.0.0.1:3000`; smoke report confirms live boot. |
| `npm test` runs Vitest | OK | `"test": "vitest run"`; 48 passing. |
| Local-only / no outbound HTTP | OK | Server binds `127.0.0.1`; code contains no `fetch`/`http.request` server-side. |
| All state in SQLite | OK | Repository is the sole writer; no in-memory state escapes process. |
| `UNIQUE(url)` at schema level | OK | `db/index.ts` schema declares `url TEXT NOT NULL UNIQUE`; repository catches `SQLITE_CONSTRAINT_UNIQUE`. |
| Same-origin UI serving | OK | `app.ts` mounts `express.static(public)` on the same listener as `/api/*`. |
| Minimum surface (only save/list/open/delete + inline validation) | OK | No telemetry, analytics, SW, PWA manifest, dark-mode toggle. System-driven dark mode emerges from CSS only. |

## Plan completion

10/10 tasks marked complete with `.done.md` + `.test-log.txt` per task.
Each test-log records a RED → GREEN transition (T-008 is explicitly
declared non-automated per `tests.md`, and that is consistent with the
plan). Board reflects empty Backlog/In Progress/Review; all in Done.

## Findings

### F-1 — `locallyValidate` duplicates server validation logic on the client (P3, P5)

- **Severity:** Minor
- **Evidence:** `app/src/web/main.ts:38-46` re-implements
  `validateNewBookmark` (trim-then-empty title check + `new URL(...)`
  try/catch) that already lives in `app/src/server/validation.ts`. The
  string copies (`'Title is required'`, `'Please enter a valid URL'`)
  duplicate server messages.
- **Expected:** Either reuse the validation module from the web bundle
  (it's pure TS, importable) or rely solely on the server's 400 +
  `code`-keyed UI message (the existing `messageForCode` path already
  handles `INVALID_TITLE` / `INVALID_URL`).
- **Actual:** Two source-of-truth checks for the same invariants. If
  the server's rules ever drift (e.g., adding a length cap), the
  client's pre-flight check will diverge silently.
- **Impact:** Low — current rules are simple and identical. But P3
  (zero duplication) is violated for a small UX win (no round-trip for
  empty fields) that is not called out by any acceptance criterion.
- **Recommendation:** Drop `locallyValidate` and let the server-driven
  error path handle empty/invalid input. The form already shows the
  `code`-keyed message on submit failure.
- **Owner phase:** Build (post-baseline follow-up; not blocking
  acceptance).

### F-2 — `INVALID_BODY` declared in `ValidationCode` union but never produced by `ValidationError` (P5)

- **Severity:** Minor
- **Evidence:** `app/src/server/errors.ts:4` lists `'INVALID_BODY'` in
  `ValidationCode`, but `INVALID_BODY` is only ever emitted directly
  from the middleware (`middleware/error.ts:24-26`) without
  constructing a `ValidationError`. No code path narrows the union via
  this code.
- **Expected:** Either construct `new ValidationError('INVALID_BODY', ...)`
  in the malformed-JSON branch (so the type narrowing matters) or drop
  `'INVALID_BODY'` from the union and keep it a free-standing code
  string in the middleware.
- **Actual:** Speculative type membership with no consumer.
- **Impact:** Negligible; documentation-of-intent only.
- **Recommendation:** Trim the union to the three codes actually
  carried by `ValidationError` instances (`INVALID_TITLE`,
  `INVALID_URL`, `INVALID_ID`).
- **Owner phase:** Build (post-baseline follow-up).

### F-3 — `build.mjs` self-run guard is harder to read than necessary (P7-adjacent)

- **Severity:** Minor (stylistic)
- **Evidence:** `app/build.mjs:24-25`:
  ```js
  const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) : null;
  if (invokedPath === resolve(process.argv[1] ?? '')) { ... }
  ```
  The ternary's predicate doesn't influence the resolved value of
  `fileURLToPath(import.meta.url)`; the null branch protects against a
  missing `argv[1]` but the resolved-path equality already does. The
  rationale for the resolved-path compare (paths containing spaces) is
  captured in `test-report.md` and `develop-log.md`, but the code
  itself reads oddly.
- **Expected:** Direct path comparison:
  ```js
  const here = fileURLToPath(import.meta.url);
  if (process.argv[1] && resolve(process.argv[1]) === here) { ... }
  ```
- **Actual:** Working but indirect logic.
- **Impact:** None at runtime (confirmed by build/smoke logs).
- **Recommendation:** Rewrite for clarity in a follow-up.
- **Owner phase:** Build (post-baseline follow-up).

### F-4 — `httpStatusFor` exported with only test consumers in the production tree (P5, low confidence)

- **Severity:** Minor
- **Evidence:** `app/src/server/errors.ts:32-37` exports
  `httpStatusFor`. The middleware (`middleware/error.ts`) imports it
  but only calls it after an `instanceof` chain that has already
  narrowed the type — the function is then strictly redundant inside
  the middleware. The remaining consumer is `tests/errors.test.ts`.
- **Expected:** Either drop the helper (the middleware can return the
  status literal per branch) or fold the branching into the helper and
  remove the middleware-side `instanceof` chain.
- **Actual:** Two parallel mappings of error class → status (one in
  `httpStatusFor`, one inline in the middleware).
- **Impact:** Mild — keeps a tested invariant, but the inline branch
  in the middleware is the load-bearing path.
- **Recommendation:** Collapse to a single mapping. Lowest-risk option:
  middleware switches on `instanceof`, helper deleted, test updated.
- **Owner phase:** Build (post-baseline follow-up).

## Principle compliance walk

| Principle | Finding | Notes |
| --- | --- | --- |
| P1 Lean changes | OK | Diff lines each trace to a documented AC or a constraint. |
| P2 Existing patterns first | OK | No prior art existed in this fresh workspace; design pins all conventions and code follows them (snake_case in SQL, camelCase in TS API, ESM throughout, ADR-006 factory pattern). No new dependencies beyond what design specified. |
| P3 Zero duplication | Minor — F-1 | Client-side mirror of server validation. Two instances, not three; below the 3+ extraction threshold but worth recording. |
| P4 One clean implementation | OK | No `legacy*` / `V2` / `Old` naming; no commented-out blocks; no parallel old/new paths. |
| P5 No speculative scaffolding | Minor — F-2, F-4 | One unused union member; one helper with weak consumer. No unused files, no unread config knobs. |
| P6 Tests describe behaviour | OK | Tests assert on HTTP status + body shape, DOM attributes (`target` / `rel`), DB state. No internal-collaborator mocking; only the external `fetch` boundary is mocked in `tests/api.test.ts`. Test names are behaviour-shaped ("returns 400 INVALID_TITLE on empty title and does not write"). |
| P7 Don't fight the framework | OK | Uses `express.Router`, `express.json`, `express.static`, Express error middleware (4-arg signature), `supertest` for in-process tests, `better-sqlite3` prepared statements, esbuild's Node API. No hand-rolled framework wrappers. |

## Safety check

- **No commits, no pushes, no destructive ops.** `git log` is unchanged
  from pre-build; build phase produced no commits.
- **No files outside `app/`.** Confirmed via tree inspection;
  `git status` shows only orchestrator-evaluation diffs unrelated to
  this run.
- **No outbound network from server.** Code inspection of
  `src/server/**` shows zero `fetch`/`http.request` calls; design and
  smoke report consistent.

## Test evidence summary

- Per-task `tasks/T-NNN.test-log.txt` files capture RED + GREEN
  transitions for every task that has automated coverage (T-002
  through T-007, T-009, T-010). T-001 is scaffolding-only; T-008 is
  declared non-automated by `tests.md` and exercised via T-009/T-010.
- Final aggregate from `test-report.md`: 8 files, 48 tests, all green;
  `tsc --noEmit` clean; bundle built (5.3 KiB + sourcemap).
- Live smoke (`smoke-report.md`) probes every documented HTTP path
  including dark paths (INVALID_URL → 400, DUPLICATE_URL → 409,
  NOT_FOUND → 404) with the correct response shapes.

## Process learning observations

1. **Subagent-pull worked clean this run.** Every task landed on
   attempt 1; the per-task RED → Implement → GREEN loop produced
   identical artifact shapes (`.done.md` + `.test-log.txt`) without
   coordinator intervention.
2. **Two design "open ambiguity" items collapsed to no-ops at build
   time.** Both the SQLite file location (`app/data/bookmarks.sqlite`
   vs. `app/bookmarks.sqlite`) and the server execution choice (`tsx`
   vs. compiled `dist/`) were flagged as flexible; Build picked one of
   each and neither downstream task noticed. This validates the
   "design notes flex points, plan pins one, build executes" handoff
   shape.
3. **Whitespace-in-path is a real hazard for esbuild-style self-run
   guards.** The workspace path contains "My Shared Files" with a
   space; the original `file://${argv[1]}` compare encoding-mismatched
   on the space (`%20`). Build hit and fixed this; review confirms the
   fix is in place. Worth landing in build-agent guidance.
4. **`better-sqlite3` unique-violation tests should assert on
   `err.code === 'SQLITE_CONSTRAINT_UNIQUE'`** rather than message
   text. Build internalised this; the assertion is in `db.test.ts:31`.
5. **Express 5 widens `req.params[name]` to `string | string[]`.** The
   delete route uses a `typeof === 'string'` guard before regex —
   needed for `tsc --noEmit` to pass. Worth a sticky note for any
   future Express-5 task.

## Open ambiguity

None.

## Outcome

- **Blockers:** 0
- **Major:** 0
- **Minor:** 4

Pipeline can advance.
