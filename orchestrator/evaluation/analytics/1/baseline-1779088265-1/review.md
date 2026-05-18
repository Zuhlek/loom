---
project: baseline-1779088265-1
phase: review
created: 2026-05-18
verdict: PASS
---

# Review — baseline-1779088265-1 (Bookmarks)

The eight-task build delivers the local-only Bookmarks app described in `spec.md` / `design.md`. All four user stories (US-001 Save / US-002 List / US-003 Open / US-004 Delete) are covered by passing acceptance gates. The Vitest suite is **61 passed / 0 failed across 10 files** on re-run, the smoke gate is 8/8 PASS (`smoke-report.md`), `tsc --noEmit` strict is green for both `tsconfig.json` and `tsconfig.client.json`, and workspace isolation holds (only `app/data/` + `app/public/bundle.js` written).

No blocker- or major-severity findings against the engineering principles (P1–P7) or the project-level Constraints in `spec.md`. A handful of minor findings document deviations from the user's documented house-style preferences (`feedback_comment_style.md`, `feedback_naming_and_formatting.md`) that the project's `spec.md ## Constraints` does not pin. These are routed as recommendations, not blockers.

## Verdict

**PASS.** Build is complete; no work routed back to earlier phases.

## Reference index

- Intent: `spec.md` — US-001..US-004 + § Constraints (workspace isolation, stack, runtime, data model).
- Design: `design.md` — System shape, HTTP API table, ADR-001..008.
- Plan: `plan.md` — T-001..T-008 work graph, `node-test` + `cli-shell` verification env.
- Tests: `tests.md` — per-story acceptance gates, smoke gate, no-`innerHTML` rule, workspace isolation.
- Build evidence: `test-report.md` (61/61 PASS), `smoke-report.md` (8/8 PASS), `tasks/T-00{1..8}.{done.md,test-log.txt}`, `board.md` (all 8 cards in Done).

## Targets walked

### Intent satisfaction — PASS

Every Spec acceptance criterion maps to a test surface that the build exercises green:

- **US-001 AC1..AC4** — `routes-create.test.ts` (201 + body, 400 VALIDATION, 409 DUPLICATE_URL, createdAt window) + `repo.test.ts` (DuplicateUrlError, leaves original row unchanged) + `client-form.test.ts` (idle→submitting→idle/error).
- **US-002 AC1..AC3** — `routes-list.test.ts` + `repo.test.ts` (newest-first + id-tie-break) + `client-render.test.ts` (renderEmptyState).
- **US-003** — `client-render.test.ts` anchor block (href, `target=_blank`, `rel` contains noopener+noreferrer).
- **US-004 AC1..AC3 + negative** — `routes-delete.test.ts` (204 happy, 204 idempotent, 400 BAD_ID) + `client-render.test.ts` delete-control block.

Spec § Constraints — workspace isolation, single Node + Express + better-sqlite3 stack, no outbound calls, `target="_blank"` + `rel="noopener noreferrer"`, `UNIQUE(url)` constraint, append/delete-only data model, no UPDATE endpoint — all hold in `src/server/{db,bookmarks-repo,routes,app}.ts` and the public HTML/CSS. No update path is exposed.

### Design conformance — PASS

The directory tree under `app/` matches `design.md § System shape` 1:1 (`src/{server,client,shared}`, `public/`, `test/`, `data/`). All eight ADRs are honoured:

- ADR-001 four-file server split — present (`index.ts` boot, `app.ts` factory, `routes.ts`, `bookmarks-repo.ts`).
- ADR-002 integer PK — `id INTEGER PRIMARY KEY AUTOINCREMENT` in `db.ts`; `:id` path param in routes.
- ADR-003 epoch-ms `created_at` — `Date.now()` stamp in `bookmarks-repo.insert`, sort `(created_at DESC, id DESC)`.
- ADR-004 no optimistic UI — `client/render.ts` `loadAndRender` always refetches; `form.ts` does not pre-insert.
- ADR-005 idempotent DELETE — `routes.ts` returns 204 regardless of `repo.deleteById` outcome; only non-integer is 400.
- ADR-006 no `innerHTML` — verified by grep gate (`smoke.test.ts § no-innerHTML`) and confirmed by my own re-grep over `src/client/**`; zero matches.
- ADR-007 synchronous better-sqlite3 — no `Promise.resolve` wrappers in the repo; route handlers respond in the same tick.
- ADR-008 dual tsconfigs — `tsconfig.json` (Node) + `tsconfig.client.json` (browser bundle) both present and exit 0 under strict.

HTTP API table matches handlers exactly: `GET /api/bookmarks` (200, ordered DESC), `POST /api/bookmarks` (201 / 400 / 409), `DELETE /api/bookmarks/:id` (204 / 400 BAD_ID). Error envelope `{error: {code, message}}` is consistent across routes and middleware.

### Plan completion — PASS

`board.md` shows all eight cards (T-001..T-008) in **Done**. Per-task `tasks/T-NNN.done.md` reports and `T-NNN.test-log.txt` logs exist for each. Each red phase produced an assertion failure (not a compile error) before its green flip. Dispatch order in `plan.md § Dispatch order` was respected: T-001 → {T-002, T-003} → {T-004, T-005} → T-006 → T-007 → T-008.

### Test evidence — PASS

- 10 test files, 61 cases. Re-ran `npm test` from inside `app/` after the build was reported complete: **61 passed / 0 failed in 7.48s**.
- Smoke gate (`smoke.test.ts`, 6 cases): HTML shell + bundle + stylesheet, create→list→delete round trip, cross-restart persistence, exit-1 with stderr naming the bad path on unwritable DB, dark-mode media query in styles, no-`innerHTML` regex over `src/client/**` — all PASS.
- Cross-cutting gates per `tests.md § Cross-cutting non-functional gates`:
  - No-`innerHTML`: PASS (independently re-checked via `grep -RIn 'innerHTML' src/` → only comment references in `render.ts`, never an assignment).
  - Workspace isolation: PASS (smoke test pins `DATA_DIR` to `os.tmpdir()`; no writes outside `app/`).
  - `tsc --noEmit` strict (server + client): PASS.
- Mutation gate: skipped per `tests.md § Mutation gate (Mutation Testing: no)`. Rationale is recorded in `tests.md` and consistent with Spec (no money, no auth, no irreversible operation).

### Code quality — PASS with minor stylistic notes

Server and client modules are tight, single-purpose, and respect the layered boundary documented in `design.md`. Validation is at the system boundary only (`validateCreateInput` for the JSON body, `Number.isInteger` for the path param), consistent with P1's "validate only at system boundaries" rule. Repository is the only module that opens SQL strings; routes never touch the `Database` handle. The `createApp({ repo, staticDir })` factory is reused by `routes/app-factory` tests via `supertest` without binding a port. See findings below for minor stylistic deviations from documented house-style preferences.

### Principle compliance — walked P1–P7

- **P1 Lean changes** — PASS. Every file in the diff is named in either `design.md § System shape` or `plan.md § Task ladder § Layer key`. No drive-by refactors of adjacent code (the project is greenfield). Lines trace to acceptance criteria or to `spec.md ## Constraints` entries.
- **P2 Existing patterns** — PASS. Vitest is used per `tests.md`; `supertest` per `design.md`; better-sqlite3 synchronous API used directly per ADR-007. No new runtime dependencies beyond `express` and `better-sqlite3`. Test style is consistently `describe/it` Vitest BDD across all 10 files. Naming is camelCase TS / snake_case SQL per Design.
- **P3 Zero duplication** — PASS. The 4-line `clear(root) { while (root.firstChild) root.removeChild(...) }` helper is reused across `renderList`, `renderEmptyState`, and `renderRetry`. Error-envelope shape `{error: {code, message}}` is centralised in the error middleware and the route validation branch. SQL prepared statements are constructed once per `createBookmarksRepo` instance. No 3+ structural repeats spotted.
- **P4 One clean implementation** — PASS. No `legacy*` / `*V2` / `*Old` / `*Deprecated` names. No commented-out code. No "kept for X" comments. No dual-implementation feature flags.
- **P5 No speculative scaffolding** — PASS overall; **see Minor #3** for the `SHARED_TYPES_READY` sentinel constant that exists only to give the foundation test a runtime witness. Defensible (the spec's smoke-test concern wants a workspace-loads check), but borderline P5.
- **P6 Tests describe behaviour** — PASS. Tests assert on response bodies, DOM state, repository return values. The two `vi.spyOn(api, 'deleteBookmark')` / `vi.spyOn(api, 'listBookmarks')` mocks in `client-render.test.ts § delete control` mock the **api module that calls `fetch`** — an external boundary (HTTP), not an internal collaborator. Aligned with P6's "mocks are for external boundaries (HTTP, …)".
- **P7 Don't fight the framework** — PASS. Express built-ins are used (`express.json`, `express.static`, the error middleware). No custom routing layer, no wrapper around Express.

### Safety — PASS

- **XSS**: All user-supplied strings reach the DOM via `textContent` or `setAttribute('href', ...)`. `render.ts` exercises this on a `<script>alert(1)</script>` title and asserts no `<script>` materialises. The no-`innerHTML` regex gate enforces this at the file level.
- **Tabnabbing**: All bookmark anchors carry `rel="noopener noreferrer"` per Spec § Constraints § Security; verified by `client-render.test.ts`.
- **Body size**: Express body parser is bound to `10kb` per Spec; oversize triggers the 413 PAYLOAD_TOO_LARGE branch in `app.ts`'s error middleware.
- **Path traversal / workspace escape**: `index.ts` resolves `dataDir` from `process.env.DATA_DIR` (smoke test uses tmpdir) or `appRoot/data` (default). All writes are inside the resolved directory; no path concatenation from request data.
- **Outbound network**: server and client make no outbound HTTP calls. The client `fetch` targets only `/api/bookmarks`.

One pre-existing notable: `client-render.test.ts § anchor attributes` explicitly asserts that a `javascript:alert(1)` URL passes through to `href` verbatim ("no sanitisation in render"). Combined with `target="_blank"` + `rel="noopener noreferrer"`, this is consistent with the spec — the single trusted local user supplies the URL, and modern browsers neutralise `javascript:` in `target=_blank` anchors. Not a finding for this project; flagged as a Note for any future multi-user fork.

### User feedback — N/A this run

`/weave` did not surface a user-feedback request; `feedback.md` is not produced.

### Process learning — observations recorded

Build phase wrote 10 dual-written learning entries to `develop-log.md` and to `orchestrator/log/build.md` (T-001..T-008 done reports + Build Coordinator pre-flight + phase complete). Cross-checked: every `## YYYY-MM-DD — baseline-1779088265-1 — …` heading in `develop-log.md` has a matching heading in `orchestrator/log/build.md`. Dual-write contract satisfied.

This review appends one additional learning entry below (Review-phase observation) and dual-writes it to `orchestrator/log/audit.md`.

## Findings

### Note 1 — Spec, design, plan, and tests are unusually well-aligned for a baseline harness run

- **Evidence:** Every `T-NNN.satisfies-stories` field, every ADR, every `tests.md` per-story gate, and every test file maps cleanly to a Spec acceptance criterion with no orphans. T-001..T-008 each landed green on the first attempt (per `test-report.md`); the only red-phase wobble was T-008's port-bind, which the smoke test's `killServer` helper now handles.
- **Expected:** PASS-able build with at most one or two re-runs typical of greenfield agent builds.
- **Actual:** 8/8 tasks green on attempt 1, 61/61 tests, 8/8 smoke.
- **Impact:** Useful baseline data point for `/tune` calibration — this seed + this Spec/Design/Plan template can be treated as a "clean signal" run when scoring evaluation deltas.
- **Recommendation:** Capture this as a baseline reference run in the eval harness.
- **Owner phase:** none (informational).

### Note 2 — Source comments reference Forge artifacts (`T-NNN`, `ADR-NNN`, `US-NNN`, `Spec §`)

- **Evidence:** `grep -RIn -E "ADR-|Design §|Spec §|T-00|US-00" app/src/` returns 13 hits across `bookmarks-repo.ts`, `app.ts`, `routes.ts`, `index.ts`, `client/form.ts`, `client/main.ts`, `client/render.ts`. Examples:
  - `bookmarks-repo.ts:21` — `// 'created_at' (Design § Shared TypeScript types).`
  - `routes.ts:55` — `// DELETE /bookmarks/:id — idempotent per ADR-005: any integer id yields…`
  - `index.ts:12` — `// log the offending path to stderr and exit 1 (T-008 AC5).`
- **Expected:** Per the user-memory rule `feedback_comment_style.md`: "NEVER reference Forge artifacts in code (task IDs, plan/audit sections, ticket numbers, US-N)." Architectural one-liners only; cross-refs via `{@link …}` Javadoc.
- **Actual:** 13 such references in comments.
- **Impact:** Code carries process metadata that becomes stale once `.forge/` / `.loom/` artifacts move or rename. Violates the user's documented code-style preference.
- **Recommendation:** Strip the task / ADR / story / section references from comments. Keep only the architectural one-liners (e.g. `// idempotent delete: 204 regardless of whether a row was removed`). If a cross-ref is genuinely needed, use a Javadoc `{@link …}` to a stable in-repo file path, not to a `.loom/` artifact.
- **Owner phase:** none for this project — `spec.md ## Constraints` does not pin the user-memory style preference, so the principle that applies (P-style/minor) does not raise severity. Routed as a recommendation for the future `/tune build` curation cycle.

### Note 3 — `_`-prefixed unused parameters in route / middleware signatures

- **Evidence:** `app.ts:48` — `(err: unknown, _req: Request, res: Response, _next: NextFunction) => …`; `routes.ts:32` — `(_req: Request, res: Response) =>`.
- **Expected:** Per `feedback_naming_and_formatting.md`: "No `_`-prefix vars (even unused params)."
- **Actual:** Two `_req` / one `_next` signatures.
- **Impact:** Stylistic divergence from documented preference; no functional consequence (Express's error middleware *requires* the four-arg arity).
- **Recommendation:** Rename to `req`, `next` and rely on the linter's `argsIgnorePattern: '^_'` removal (or add an `// noinspection`-style hint) — or, since Express needs the four-arg signature regardless, accept the existing names as the unavoidable framework cost. The user can decide.
- **Owner phase:** none.

### Note 4 — Workspace-witness sentinel `SHARED_TYPES_READY` is test-only

- **Evidence:** `app/src/shared/types.ts:21` exports `SHARED_TYPES_READY = true`; the only consumer is `app/test/shared-types.test.ts`. Comment at line 2: "the SHARED_TYPES_READY sentinel exists so the workspace smoke test has a runtime witness that this module loaded."
- **Expected:** P5: "Every new file, abstraction, config knob, or utility must be exercised by code that exists in this PR. … Don't expose helpers from a module unless someone outside the module calls them."
- **Actual:** Exported only because the foundation test imports it. The shared types it lives next to (`Bookmark`, `CreateBookmarkInput`) are consumed by both server and client; the boolean sentinel is not.
- **Impact:** Trivial — one runtime constant carries one runtime witness. The "did the shared module compile and load?" signal can be supplied equivalently by importing one of the real types and asserting on its shape via `satisfies`.
- **Recommendation:** In a follow-up tidy, drop `SHARED_TYPES_READY` and replace the runtime witness with a type-only `satisfies Bookmark` test. Not worth blocking the run.
- **Owner phase:** none.

### Note 5 — Pre-existing orphan server on `:3000` before smoke (already self-recovered)

- **Evidence:** `smoke-report.md § Findings` — "One pre-existing orphaned `node dist/server/index.js` (PID 78948, parented to init) was bound to `:3000` before this run from a prior T-008 task run; killed before re-running the suite."
- **Expected:** Smoke test should not depend on the runner's host being free of stale processes.
- **Actual:** The current `smoke.test.ts § killServer` escalates `SIGTERM → SIGKILL` and waits for the port to free; it is robust *within* a run. The prior orphan was outside that lifecycle.
- **Impact:** Could cause a spurious EADDRINUSE on the first port-bind step of a fresh run against a dirty host.
- **Recommendation:** Add a `beforeAll` step that opportunistically frees `:3000` if it is bound (or randomises the port for smoke). Not required for spec compliance.
- **Owner phase:** none — would land as a smoke-test hardening in a follow-up Build slice.

## Blockers and major issues

**None.**

## Routing

No work routed to an earlier phase. Build is closed at PASS.

## Learning observation (this review)

Recorded in `develop-log.md` and dual-written to `orchestrator/log/audit.md`:

> Greenfield baseline run with a tight Spec / Design / Plan triangle produced 8/8 tasks green on attempt 1, 61/61 tests, 8/8 smoke gate. No Blocker- or Major-severity P1..P7 findings. Five Notes documenting (a) the strong template alignment, (b) Forge-artifact references in code comments vs. user-memory style, (c) `_`-prefix unused params vs. user-memory style, (d) the `SHARED_TYPES_READY` test-only sentinel as borderline P5, (e) a pre-existing orphan server on `:3000` outside the smoke-test lifecycle. Useful as a clean-signal reference run for `/tune` calibration.

## Artifacts produced this phase

- `.loom/baseline-1779088265-1/review.md` (this file)
- `.loom/baseline-1779088265-1/review-verdict.json`
- `.loom/baseline-1779088265-1/develop-log.md` (append, learning entry below)
- `orchestrator/log/audit.md` (append, dual-write)

## Open ambiguity

None.
