---
project: baseline-1778963742-1
phase: review
created: 2026-05-16
---

# Review — baseline-1778963742-1 (Bookmarks, local-only)

## Verdict

**PASS** — 0 Blockers, 0 Major, 2 Minor, 2 Notes.

- All four active user stories (US-001..US-004) are evidenced by working code and passing tests.
- All five planned tasks (T-001..T-005) are in Done with red+green logs.
- Vitest suite: 32/32 across 5 test files; smoke gate 5/5 PASS.
- HARNESS-DIRECTIVE (workspace isolation) honored: `git status` at repo root shows no leakage from this baseline; `.loom/baseline-1778963742-1/` is gitignored and contains every deliverable under `./app/`.
- No git commits or pushes were performed.

## Inputs reviewed

- `spec.md` (4 active stories + 7 constraints) — `/Volumes/My Shared Files/repo/loom/.loom/baseline-1778963742-1/spec.md`
- `decisions.md` (Q01–Q05 all resolved)
- `design.md` (10 ADRs incl. ADR-009 URL normalisation, ADR-010 ordering)
- `plan.md` + `board.md` (5/5 tasks Done)
- `tests.md` (mutation: no)
- `tasks/T-001..T-005.done.md` + `*.test-log.txt`
- `test-report.md`, `smoke-report.md`, `develop-log.md`
- Source diff under `app/src/`, `app/tests/`, `app/scripts/`
- `orchestrator/principles.md` P1–P7

## Intent satisfaction (spec → code)

| Story  | AC coverage                                                                                          | Status |
| ------ | ----------------------------------------------------------------------------------------------------- | ------ |
| US-001 | Repo `insert` + POST 201 + duplicate→409 + URL-normalisation collision + 400 invalid_url/title/body | PASS   |
| US-002 | GET ordered `created_at DESC, id DESC`; empty `[]`; client renders `<p class="empty">No bookmarks yet.</p>` | PASS   |
| US-003 | `renderList` emits `<a target="_blank" rel="noopener noreferrer">`; verified by happy-dom unit test  | PASS   |
| US-004 | DELETE 204 / 404 not_found / 400 invalid_id; client banner on 404                                    | PASS   |

Every AC row in `tests.md §Coverage by acceptance criterion` resolves to a passing assertion in `app/tests/`.

## Design conformance

- HTTP shapes match `design.md §Interfaces` (POST/GET/DELETE bodies + status codes + error envelopes).
- SQLite schema (`db.ts:3-12`) matches `design.md §Data model` exactly (UNIQUE on url, INTEGER created_at, composite index).
- `createApp(db)` factory (ADR-007) wired as documented; tests use `:memory:`, prod boot uses file.
- ADR-009 (URL normalisation via `new URL(input).toString()`) honoured in `bookmarks.ts:42` and `validation.ts:11`.
- ADR-008 dual static mounts present in `app.ts:46-47`.
- ADR-010 ordering preserved in `bookmarks.ts:33` (`ORDER BY created_at DESC, id DESC`).

## Plan completion

- Board: 5/5 in Done; coverage matrix preserves story → task mapping.
- DAG honored: T-001 root, T-002/T-004 parallelizable, T-003 → T-005, T-004 → T-005.

## Test evidence

- T-001: tooling-only (`passWithNoTests` exit 0).
- T-002: red run failed because `db.js`/`validation.js` not yet created (expected red); green 14/14.
- T-003: red run failed because `app.js` not yet created (expected red); first impl 24/25 (content-type → invalid_url mis-route); fix 25/25.
- T-004: red run failed because `main.js` not yet created (expected red); first impl 28/29 (happy-dom innerHTML escape semantics + path-with-spaces); fix 29/29.
- T-005: 32/32 on first integrated run.

## Code quality / Principle compliance

Walked P1–P7 against all source under `app/src/`, `app/tests/`, `app/scripts/`:

- **P1 (Lean changes):** every line traces to an AC or constraint. No drive-by refactors.
- **P2 (Existing patterns first):** greenfield project; pinned stack respected verbatim (express, better-sqlite3, esbuild, vitest, supertest, happy-dom). No new deps beyond the locked manifest.
- **P3 (Zero duplication):** no 3+ structural repeats found. Two `express.static` mounts (`app.ts:46-47`) are the ADR-008 contract, not duplication.
- **P4 (One clean implementation):** no `legacy*`, no `V2`, no commented-out blocks, no parallel old/new paths.
- **P5 (No speculative scaffolding):** see Minor-1 below — the `BookmarksRepo` interface ships with one implementation, but is consumed via DI by routes.ts and tests — borderline (not flagged). Otherwise clean.
- **P6 (Behavioural tests):** tests assert on HTTP shapes, DOM state, return values; no internal mocking; `supertest` exercises real Express, real in-memory SQLite.
- **P7 (Don't fight the framework):** uses `express.json()`, `express.static()`, `Router`, `res.sendFile`, `res.status().json()`. No custom routing wrappers.

## Safety

- HARNESS-DIRECTIVE honored — `git status` at repo root from this session: only `orchestrator/log/build.md` is modified (carryover from a prior baseline). All baseline deliverables sit under `.loom/baseline-1778963742-1/app/` and are gitignored.
- No commits, no pushes, no remote operations.
- Smoke used `PORT=3001` to avoid 3000 collisions with sibling baselines.

## Findings

### Minor-1 (P5 / readability): `BookmarksRepo` interface + factory pair has only one concrete implementation
- **Severity:** Minor (note-leaning).
- **Evidence:** `app/src/server/bookmarks.ts:19-67`.
- **Expected:** Per P5, interfaces with a single implementation are flagged unless justified by an in-PR consumer of the abstraction.
- **Actual:** The `BookmarksRepo` interface is consumed by `routes.ts:8` (param type) and by tests that construct the repo over `:memory:` vs file-backed DB. The DI is real (tests substitute the DB, not the repo), so the interface is borderline — kept since it documents the route↔repo contract clearly.
- **Impact:** None observable. The interface is one tiny block and aids type readability at the route boundary.
- **Recommendation:** Accept as-is. If a future task introduces a second repo (e.g. tags), this earns its keep; otherwise inlining the type is a one-liner.
- **Owner phase:** none (accepted carve-out).

### Minor-2 (P1 / robustness): final error middleware after static mounts is unreachable for the `GET /` 404
- **Severity:** Minor.
- **Evidence:** `app/src/server/app.ts:50-59` (`/` handler) plus `app.ts:62-69` (final error middleware).
- **Expected:** The final 4-arg error middleware catches uncaught errors and 500s them with the documented `{error:"internal"}` shape.
- **Actual:** The `GET /` handler swallows `res.sendFile` errors and returns 404 inline instead of forwarding via `next(err)`. This is intentional per the T-003 done note ("404s on sendFile error rather than crashing") and is harmless — `index.html` always exists after T-004. The result is the final error middleware has no exercised code path in the current diff (handlers throw → express default handler 500s, which `routes.ts:52` re-throws into).
- **Impact:** None to behaviour; design.md §Error handling lists `500 internal` for "Unexpected DB write failure" — that path goes through the final middleware via thrown errors in route handlers (e.g., `routes.ts:52` re-throw of non-Duplicate errors).
- **Recommendation:** Accept; the middleware will fire on any non-DuplicateUrlError thrown from the repo layer. No change needed.
- **Owner phase:** none.

### Note-1: smoke check 4 (UI render) was satisfied via curl + happy-dom unit test instead of a headless browser
- **Severity:** Note.
- **Evidence:** `smoke-report.md` §Substitution note.
- **Expected:** The smoke recipe nominally calls for a headless-browser screenshot.
- **Actual:** Puppeteer is not on the dep manifest and adding it would have violated stack pinning (`spec.md §Constraints — Stack pinning`). Build substituted a curl assertion that `GET /` returns 200 + text/html + references `/static/main.js` + contains the `add-form` element. Richer DOM behaviour is covered by 4 happy-dom unit cases in `client.render.test.ts`.
- **Impact:** Equivalent coverage for the four-feature surface at this scope.
- **Recommendation:** Continue this substitution pattern when stack pinning forbids a smoke-only dep; document it in the global build shard so future runs find the precedent.
- **Owner phase:** none (documented and accepted).

### Note-2: PORT collision avoidance via `PORT=3001` for smoke (3000 reserved for sibling baselines)
- **Severity:** Note.
- **Evidence:** `smoke-report.md` row 2; `develop-log.md` "Port choice for smoke".
- **Expected:** Smoke binds the spec-pinned `:3000` to verify the production boot path.
- **Actual:** Smoke set `PORT=3001` per the build-coordinator brief to avoid collisions with concurrent baseline workspaces. The production boot still defaults to 3000 (`index.ts:6`); the env override is only used by the smoke harness.
- **Impact:** The `:3000` default is exercised by the e2e Vitest test (binds an ephemeral port via `app.listen(0)`); the production-bind path is implicit but minimal (single `app.listen(PORT, ...)` call).
- **Recommendation:** Accept; collision avoidance is the right call in a shared eval harness.
- **Owner phase:** none.

## User feedback

Non-interactive eval — no user pushback was solicited. See `feedback.md`.

## Routing

- No unresolved work — every finding above is accepted at the Review boundary.
- No blockers escalated to Build, Plan, Design, or Spec.

## Process learning (captured to develop-log + global shards)

- Build retries (T-003 Content-Type guard, T-004 happy-dom innerHTML + path-with-spaces) → `develop-log.md` + `orchestrator/log/build.md`.
- Smoke harness substitution (curl in lieu of Puppeteer) → `develop-log.md` + `orchestrator/log/build.md`.
- Port collision avoidance via `PORT=3001` → `develop-log.md` + `orchestrator/log/build.md`.
- Review-time cross-phase observation (eval-mode coordinator deviations producing equivalent artifacts) → `orchestrator/log/audit.md`.
