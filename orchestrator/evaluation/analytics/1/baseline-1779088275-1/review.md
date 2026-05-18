---
project: baseline-1779088275-1
phase: review
created: 2026-05-18
---

# Review — baseline-1779088275-1

## Verdict

**FAIL** — 1 Blocker, 2 Major, 2 Minor, 1 Note.

Build delivered a working four-feature Bookmarks app: every active user story (US-001..US-004) is satisfied end-to-end, `npm test` is green (45 passed / 2 skipped) and `SMOKE=1 npx vitest run` is green (47 passed / 0 skipped). However, the client API module triplicates the `ApiError(0, "NETWORK", …)` throw across three exported functions, which crosses the P3 duplication threshold. A second design-conformance gap — the list-level fetch-failure notice promised by `design.md` `## State and error handling > List` was deferred during T-002 and never landed in T-005, despite T-005 introducing the `showListNotice` mechanism that would satisfy it.

The blocker is mechanical to fix (extract one private helper inside `src/client/api.ts`); the design-conformance major is a 3-line change to `refresh()` to call the already-implemented `showListNotice`.

## Intent satisfaction

Cross-referenced `spec.md` `## User stories`, `## Scope`, and `## Constraints` against the working tree and the live-probe evidence in `smoke-report.md`.

| Spec element | Status | Evidence |
| --- | --- | --- |
| US-001 (save) all 5 ACs | PASS | `tests/http/bookmarks.test.ts` 4 POST specs (201 round-trip, 400 INVALID_TITLE, 400 INVALID_URL, 409 DUPLICATE_URL) + `tests/unit/render.test.ts` `showFormError`/`clearFormErrors` specs + `tests/unit/validation.test.ts` 10 specs + live POST probes in `smoke-report.md` § T-003. |
| US-002 (list) all 4 ACs | PASS | `tests/unit/repo.test.ts` `listAll` ordering specs (newer-first + id DESC tiebreak) + `tests/http/bookmarks.test.ts` GET ordering spec + `tests/unit/render.test.ts` empty-state + populated-list specs. |
| US-003 (open in new tab) AC-1, AC-2 | PASS (attribute-asserted) | `tests/unit/render.test.ts` `renderList (new-tab affordance — US-003)` block asserts `target="_blank"` + `rel="noopener noreferrer"` + default keyboard reachability; `tests.md` § "What is intentionally not tested" documents the attribute-only assertion under `node-test`. |
| US-004 (delete) all 3 ACs incl. idempotent no-op | PASS | `tests/http/bookmarks.test.ts` 5 DELETE specs (204 + GET-excludes, 204 non-existent id, 204 second-delete, 400 non-integer, 400 negative) + `tests/unit/render.test.ts` delete-button specs + live DELETE probe in `smoke-report.md` § T-005 covering all 11 branches. |
| Scope: save / list / open / delete / reject duplicate URL | PASS | Each verified above. |
| Constraint: Workspace isolation | PASS | `tests/smoke/run.test.ts` second `it` asserts no `data/` or `*.db` at the parent (`.loom/<project>/`) level after smoke run; verified `ls .loom/baseline-1779088275-1/` returns only the spec/design/plan/board/etc artifacts and `app/`. |
| Constraint: Stack lock (TS, Node+Express, better-sqlite3, esbuild, Vitest) | PASS | `package.json` deps match exactly; no React/Vue/Vite/Postgres etc. |
| Constraint: Run contract (`npm start` boots 3000, `npm test` runs tsc + vitest) | PASS | `package.json` scripts match; `SMOKE=1` smoke spec proves `npm start` → 200 on GET /. |
| Constraint: Single origin | PASS | `src/server/index.ts` mounts API + static from one app; no CORS middleware. |
| Constraint: No auth, telemetry, service worker, PWA manifest, dark-mode toggle | PASS | `public/index.html` ships no SW registration, no `<link rel="manifest">`, no toggle; `style.css` has `@media (prefers-color-scheme: dark)` only. |
| Constraint: URL validation via `URL` constructor + `http:`/`https:` only | PASS | `src/server/validation.ts:parseUrl` matches; `tests/unit/validation.test.ts` covers `ftp:`, `javascript:`, non-URL, non-string. |
| Constraint: Title trim + reject empty-after-trim | PASS | `parseTitle` matches; tests cover whitespace-only + non-string. |
| Constraint: Duplicate detection via exact string equality, no normalization | PASS | `parseUrl` returns `raw` un-normalized; UNIQUE on `url` enforces exact equality. |
| Constraint: Persistence durability | PASS | Synchronous `better-sqlite3` write completes before HTTP response (`repo.insert` returns the `selectById` result after `insertStmt.run`). |

No spec gap identified. The intent is fully satisfied at the user-observable level.

## Design conformance

Walked `design.md` `## System shape`, `## Interfaces`, `## Data model`, `## State and error handling`, and `## Architecture decisions` against the diff.

| Design element | Status |
| --- | --- |
| Three-module server split (routes / repo / validation) + `db.ts` factory + `index.ts` wiring | PASS — every file present at the documented path with the documented responsibility. |
| ADR-002 (application-supplied `created_at` ISO-8601 ms) | PASS — `repo.insert` uses `new Date().toISOString()`. |
| ADR-003 (UNIQUE constraint on `url`, repo throws `DuplicateUrlError`, route maps to 409) | PASS — `db.ts` schema, `repo.ts` `SQLITE_CONSTRAINT_UNIQUE` rethrow, `routes.ts` 409 envelope. |
| ADR-004 (vanilla TS frontend with `api.ts` / `render.ts` / `main.ts`) | PASS — modules present, boundaries respected (`render.ts` does not `fetch`; `api.ts` does not touch DOM). |
| ADR-005 (refetch-on-mutate, no optimistic UI, no client cache) | PASS — `main.ts` `wireAddForm` and `wireDeleteDelegation` both call `await refresh()` on success. |
| ADR-006 (`idx_bookmarks_created_at`) | PASS — index created in `db.ts` schema bootstrap. |
| ADR-007 (single-port single-origin static serving) | PASS — `index.ts` mounts `public` + `dist` static dirs at port 3000. |
| Error pipeline step 4 (single Express error middleware → 500 `INTERNAL`) | PASS — wired in `index.ts`. |
| **Frontend `List` state machine: on fetch failure, render an inline non-blocking notice above the list** | **FAIL — see Finding F3** (Major). The `showListNotice`/`clearListNotice` mechanism landed in T-005 but is only wired to the delete-error path; `refresh()`'s catch arm still only `console.error`s. |
| `parseTitle`/`parseUrl` ParseResult shape | PASS — matches the `ParseResult<T>` discriminated union. |
| Bookmark interface (`id`, `title`, `url`, `created_at`) | PASS — identical between `repo.ts` and `client/api.ts`. |
| `BookmarkRepo` interface (`listAll`, `insert`, `deleteById`) | PASS — matches. |
| `ApiError` shape (`status`, `code`, `field?`) | PASS — matches. |
| HTTP envelope `{ error: { code, message, field? } }` | PASS — every error path in `routes.ts` matches. |

## Plan completion

Every task in `plan.md` is `Done` per `board.md`. The task DAG was honored: `T-001` shipped before `T-002`, `T-002` before `T-003`/`T-004`/`T-005`. Story coverage is complete: US-001..US-004 each map 1:1 to a Done task.

## Test evidence

Re-ran the harness during review:
- `npm test`: tsc clean, vitest 45 passed / 2 skipped (smoke-gated).
- `SMOKE=1 npx vitest run`: 47 passed / 0 skipped.

The test suite faithfully covers every story's acceptance criteria via behavior-level assertions over the public HTTP surface (`tests/http/bookmarks.test.ts`), the repo (`tests/unit/repo.test.ts`), pure validation (`tests/unit/validation.test.ts`), client DOM rendering under happy-dom (`tests/unit/render.test.ts`), the client API mapping (`tests/client/api.test.ts`), and the boot-the-process smoke contract (`tests/smoke/run.test.ts`). Mutation testing is correctly skipped per `tests.md` policy.

## Code quality

Module boundaries are honored. Type-checking is strict and clean. The repo prepares statements once at construction (good performance hygiene). Validation is pure. Routes are flat and small. The frontend respects the `render.ts` (DOM-only) / `api.ts` (fetch-only) / `main.ts` (wiring) split.

Outstanding code-quality issues are captured below as principle-compliance findings (P3 duplication in `api.ts`, P5 ESLint comments without an installed linter, P1 stale comment in `main.ts`).

## Principle compliance

Walked P1–P7 from `orchestrator/principles.md`.

| Principle | Status | Notes |
| --- | --- | --- |
| P1 Lean changes | Minor (F5) — stale T-002-era comment in `main.ts:refresh()` no longer reflects state of the codebase. |
| P2 Existing patterns | PASS — naming, test style, error handling all consistent within the project. |
| P3 Zero duplication | **Blocker (F1)** + **Major (F2)** — see findings. |
| P4 One clean implementation | PASS — no `legacy*`, no `*V1`/`*V2`, no commented-out code blocks. |
| P5 No speculative scaffolding | Minor (F4) — `eslint-disable-next-line no-console` markers without an ESLint config. |
| P6 Tests describe behaviour | PASS — assertions are on response status / body / DOM attributes; no internal mocking of repo or routes; `fetch` is the only thing mocked (legitimate external boundary). |
| P7 Don't fight the framework | PASS — Express `Router`, `express.static`, `express.json` are used as built-ins. |

## Safety

- No outbound network calls from the server. The browser's bookmark navigation is the only external network event (user-initiated, handled by the platform).
- No auth / no session / no PII handling — single-user local app, by spec.
- SQL: all statements use `?` parameter binding via `better-sqlite3` prepared statements. No string concatenation, no injection surface.
- `target="_blank"` anchors carry `rel="noopener noreferrer"` (US-003 task scope flagged this explicitly).
- Workspace isolation invariant holds: no writes outside `.loom/<project>/app/`.

No safety issues found.

## User feedback

The user has not been prompted for feedback during this Review run; the open-ambiguity surface is empty (`spec.md` and `design.md` both report "Open ambiguity: None"). The blockers / majors below are mechanical; surfacing them to the user is the orchestrator's job after Review returns FAIL.

## Process learning

Three observations worth landing on the global shards (appended below to `develop-log.md` and `orchestrator/log/audit.md`):

1. P3 enforcement gap when consecutive build tasks each add one occurrence — the Task Builder for T-005 added the third `ApiError(0, "NETWORK", …)` throw without surfacing the duplication, even though Build's `Reads first` directive points at `principles.md`. Worth a curation pass.
2. Design-conformance regression where a deferred concern is forgotten — `main.ts:refresh()`'s "lands with the mutation tasks that need it" comment was a marker that the design's list-level notice still needed to land. T-005 added `showListNotice` but only wired it to the delete path, not to the list-fetch path. Design called this out explicitly under `## State and error handling > List`. A "deferred-concern checklist" in the design phase output, or a Build pre-flight that scans for `// T-NNN` comments in code that's now past T-NNN, would catch this.
3. Speculative tooling markers (`eslint-disable-…`) without the tool installed — the agent reached for a familiar idiom from larger codebases. Worth surfacing as a P5 reminder.

---

## Findings

### Finding F1 — `ApiError(0, "NETWORK", …)` triplicated in `src/client/api.ts` (Blocker)

- **Severity:** Blocker
- **Principle:** P3 (Zero duplication, 3+ instances).
- **Evidence:** `src/client/api.ts:27`, `src/client/api.ts:49`, `src/client/api.ts:73` — three call sites:
  ```ts
  } catch (_err) {
    throw new ApiError(0, "NETWORK", "Network request failed");
  }
  ```
  The catch block surrounds the `await fetch(…)` call in each of `fetchBookmarks`, `deleteBookmark`, and `createBookmark`.
- **Expected:** Per `principles.md` P3, "3+ occurrences require extraction. No exceptions." Either a small private helper (e.g. `async function safeFetch(input, init): Promise<Response>` that wraps `fetch` and converts a rejection to `ApiError(0, "NETWORK", …)`), or a shared catch helper.
- **Actual:** The throw is hand-rolled at three call sites with identical args.
- **Impact:** The error contract is duplicated, so a future change to the NETWORK error shape (e.g. adding a `cause` chain, swapping the message, introducing a `field`) requires three coordinated edits. Per `principles.md` § "Review checklist": "Blocker: … P3 duplication at 3+ instances."
- **Recommendation:** Extract a private `async function fetchOrThrow(input: RequestInfo, init?: RequestInit): Promise<Response>` inside `src/client/api.ts` that wraps the `try { return await fetch(…); } catch { throw new ApiError(0, "NETWORK", …); }` pattern. All three call sites become a single line.
- **Owner phase:** Build (small re-emit of `src/client/api.ts`; tests in `tests/client/api.test.ts` continue to pass unchanged because they assert against the public `createBookmark`/`deleteBookmark` surface, not the internal helper).

### Finding F2 — Error-envelope parsing block duplicated in `createBookmark` and `deleteBookmark` (Major)

- **Severity:** Major
- **Principle:** P3 (Zero duplication, 2 occurrences in non-genuinely-different contexts).
- **Evidence:** `src/client/api.ts:52–61` (inside `deleteBookmark`) and `src/client/api.ts:76–85` (inside `createBookmark`) — both blocks are 9 lines of identical code that parse the error envelope and construct the `ApiError`:
  ```ts
  let envelope: ApiErrorEnvelope = {};
  try {
    envelope = (await response.json()) as ApiErrorEnvelope;
  } catch {
    // body wasn't JSON; fall back to generic message below
  }
  const code = envelope.error?.code ?? "HTTP_ERROR";
  const message = envelope.error?.message ?? `Request failed with status ${response.status}`;
  const field = envelope.error?.field;
  throw new ApiError(response.status, code, message, field);
  ```
- **Expected:** Per P3, "2 occurrences allowed if contexts genuinely differ." Both call sites are handling a non-2xx response from an `/api/bookmarks*` endpoint with the same documented error envelope shape (`decisions.md` and `design.md` § HTTP API). The contexts do not genuinely differ; the canonical answer is a single helper.
- **Actual:** The block is hand-rolled twice. `fetchBookmarks` arguably needs a third near-instance for symmetry — it currently uses a shortcut path that does not parse the envelope at all.
- **Impact:** Same shape of fragility as F1. Also: `fetchBookmarks`'s shortcut and the other two functions' fuller parsing are now subtly inconsistent (a 5xx from `GET /api/bookmarks` would surface as `ApiError(500, "HTTP_ERROR", "Request failed with status 500")` rather than honoring the documented envelope code/message). Adding a third occurrence to bring `fetchBookmarks` in line would push this to Blocker.
- **Recommendation:** Extract `async function throwFromEnvelope(response: Response): Promise<never>` that parses the envelope and throws the typed `ApiError`. Use it in all three response-error paths. If `fetchBookmarks` is brought into the helper, the inconsistency vanishes too.
- **Owner phase:** Build.

### Finding F3 — `refresh()` list-fetch failure path does not surface the design's inline notice (Major)

- **Severity:** Major
- **Principle:** Design conformance.
- **Evidence:** `design.md` § "Frontend state machine (per UI interaction) > List" specifies:
  > On fetch failure, render an inline non-blocking notice above the list ("Couldn't refresh the list — check the server"); the previously-rendered list stays in place.

  `src/client/main.ts:10–18`:
  ```ts
  try {
    bookmarks = await fetchBookmarks();
  } catch (_err) {
    // T-002 surfaces the list-level error path only as console output; the
    // dedicated inline notice lands with the mutation tasks that need it.
    // eslint-disable-next-line no-console
    console.error("Failed to fetch bookmarks");
    return;
  }
  ```

  T-005 added `showListNotice` / `clearListNotice` (lines 72–90) that satisfy the design's notice contract, but `refresh()` never calls them on its catch branch. The notice is wired only for the delete-error path in `wireDeleteDelegation`.
- **Expected:** `refresh()` catches a fetch failure → calls `showListNotice("Couldn't refresh the list — check the server")` and preserves the previously-rendered list (i.e. does **not** clear the mount). Currently both happen accidentally (the early `return` leaves the previous list intact), but the user-visible notice does not.
- **Actual:** Console-only logging; the user sees nothing on a fetch failure.
- **Impact:** A user whose server crashes between mutations sees a silent stale list. Spec ACs don't strictly require this path (the list-failure surface isn't a story AC), but `design.md` documents it explicitly and the mechanism is already implemented for the sibling delete-failure case — leaving this half-wired is the kind of design drift P1's spirit warns against.
- **Recommendation:** In `refresh()`, replace the `console.error` block with `showListNotice("Couldn't refresh the list — check the server");` and clear the notice on the next successful refresh. Delete the stale T-002 comment as part of the same change. Two-line behavior change; the existing happy-dom render-spec environment supports a regression test against the notice DOM if Build wants to add one.
- **Owner phase:** Build (deferred fix during a follow-up Build pass) — alternatively, accepted as a known risk by the user if the silent failure is acceptable for the local-only single-user envelope.

### Finding F4 — `eslint-disable-next-line` comments without an installed ESLint config (Minor)

- **Severity:** Minor
- **Principle:** P5 (No speculative scaffolding).
- **Evidence:** Four `// eslint-disable-next-line no-console` markers (`src/client/main.ts:15`, `src/server/index.ts:22`, `:33`, `:38`). The project has no `.eslintrc*`, no `eslint.config.*`, and no `eslint` dependency in `package.json`.
- **Expected:** Per P5, "every new file, abstraction, config knob, or utility must be exercised by code that exists in this PR." The markers presume an ESLint config that doesn't exist.
- **Actual:** Inert directive comments that are pure noise to the project as it stands.
- **Impact:** Cosmetic; harmless at runtime, but they reference a tool the project has not opted into and they will mislead a future reader into thinking ESLint runs here.
- **Recommendation:** Either delete the four `eslint-disable-…` comments, or accept them as a forward-looking placeholder. Delete is the cleaner P5-aligned answer.
- **Owner phase:** Build.

### Finding F5 — Stale "T-002 / mutation tasks" comment in `main.ts:refresh()` (Minor)

- **Severity:** Minor
- **Principle:** P1 (spirit — lean, no process-historical baggage) / P4 (spirit — no "kept for X" comments).
- **Evidence:** `src/client/main.ts:13–14`:
  ```ts
  // T-002 surfaces the list-level error path only as console output; the
  // dedicated inline notice lands with the mutation tasks that need it.
  ```
- **Expected:** Comments explain why the current code is the way it is, not which task originally landed it. The mutation tasks (T-003, T-005) have shipped; the comment's forward reference is stale.
- **Actual:** A historical-process comment that names tasks. Per P4's spirit ("Delete it. Git remembers."), task references in code are a code smell.
- **Impact:** Minor confusion for future readers. Tightly coupled to F3 — once F3 is fixed, the comment goes away naturally.
- **Recommendation:** Remove as part of the F3 fix.
- **Owner phase:** Build.

### Note — `.eslintrc` / `eslint.config.*` is intentionally absent

- **Severity:** Note
- **Evidence:** No ESLint mention in `spec.md` `## Constraints` nor in `tests.md` `## Harness`. The Build harness is `tsc --noEmit && vitest run` only.
- **Expected:** Either install ESLint (out of scope per `spec.md`'s "no nice-to-haves") or delete the four `eslint-disable-…` markers (Finding F4). Documenting here so a future Build pass doesn't reach for an ESLint installation just to silence the markers.
- **Impact:** Documentation only. The Constraints already say "no telemetry, no PWA, no toggle" — by spirit the same minimum-surface rule applies to ESLint.
- **Recommendation:** Treat as a Note. F4's "delete the markers" is the canonical resolution.
- **Owner phase:** Build (paired with F4).

---

## Routing

- **Build:** F1 (Blocker), F2 (Major), F3 (Major), F4 (Minor), F5 (Minor) — one re-emit of `src/client/api.ts` + one small edit of `src/client/main.ts` clears every Build-owned finding. No spec / design / plan re-entry is necessary; the design says what should happen, the spec is unambiguous, the plan's tasks are all Done — Build just needs a small follow-up pass.
- **User:** the Blocker (F1) and the design-conformance Major (F3) should be surfaced; the user may accept F3 as a known risk for the local-only single-user envelope (the silent-failure path is annoying but not security-relevant). The user's call.

## Open ambiguity

None. Every finding has a documented Expected/Actual/Recommendation.
