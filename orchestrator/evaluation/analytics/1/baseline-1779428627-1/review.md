---
project: baseline-1779428627-1
phase: review
created: 2026-05-22
---

# Review — baseline-1779428627-1

**Verdict: PASS.**

The local-only Bookmarks app satisfies every active user story in `spec.md`
(US-001..US-004), conforms to `design.md` (system shape, ADR-001..ADR-007,
HTTP contract, schema), and completes every task in `plan.md` (T-001..T-009).
All 85 Vitest specs across 11 files are green and re-verified during this
review (`npm test` exits 0); two `tsc --noEmit` projects (server +
client) also pass. The Build phase's smoke gate exercised the live
`node dist/server/index.js` process on `http://localhost:3000` end-to-end
against the documented status codes. No blockers and no major findings;
two minor / note items recorded below for transparency.

## Evidence index

- **Intent** — `spec.md` § User stories US-001..US-004, `## Constraints`.
- **Design** — `design.md` (system shape, HTTP API, repository interface,
  schema, ADR-001..ADR-007).
- **Plan** — `plan.md` (DAG T-001..T-009), `tests.md`, `board.md`
  (all 9 tasks in Done).
- **Build evidence** — `test-report.md` (85/85), `smoke-report.md` (live
  :3000 walkthrough), per-task `tasks/T-NNN.done.md` and
  `tasks/T-NNN.test-log.txt`.
- **Diff under review** — `.loom/baseline-1779428627-1/app/` (the entire
  Bookmarks workspace, created from scratch by T-001 and filled by
  T-002..T-009). The repo root `.gitignore` excludes `.loom/`, so the
  diff lives in the project workspace, not the parent repo tree.
- **Live re-verification (this review)** — `cd app && npm test` →
  `11 passed (11) / 85 passed (85)`; `npm run typecheck` → exit 0.

## Target-by-target findings

### Intent satisfaction — PASS

Every story's EARS clause has at least one passing behaviour spec.

| Story | Where behaviour is proven |
| --- | --- |
| US-001 Save | `test/server/routes.test.ts` POST 201/409/400; `test/server/repository.test.ts` create + duplicate; `test/server/validation.test.ts`; `test/client/form.test.ts` valid submit / 409 / 400 / inline validation. |
| US-002 View | `routes.test.ts` GET ordering; `repository.test.ts` newest-first + id tie-break; `render.test.ts` row shape, title + URL line; `shell.test.ts` empty-state node; `form.test.ts` empty-state toggle. |
| US-003 Open in new tab | `render.test.ts` asserts every `<a>` has `target="_blank"` and `rel="noopener noreferrer"`. |
| US-004 Delete | `routes.test.ts` DELETE 204/404/400; `repository.test.ts` returns true/false; `delete.test.ts` 204 removes row, 404 treated as success, unexpected error rolls back, in-flight disabled. |

Constraints (workspace isolation, stack pinning, runtime/origin, no
undeclared surface) hold: every file lives under `app/`, only the pinned
deps (`express`, `better-sqlite3`, `esbuild`, `tsx`, `typescript`,
`vitest`, `jsdom`, `@types/*`) are on the manifest, no React/Vue/CSS
framework, no telemetry/PWA/service worker, no dark-mode toggle (CSS-only
`prefers-color-scheme`).

### Design conformance — PASS

- File layout matches `design.md § System shape` exactly (`src/server/`,
  `src/client/`, `src/shared/`, `public/`, `scripts/build-client.ts`,
  `data/bookmarks.db`, `dist/`).
- Repository injection per ADR-002: `routes/bookmarks.ts` takes
  `BookmarkRepository`, never imports `db.ts` directly inside route
  bodies.
- Schema matches the ADR-003 spec (single transactional
  `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`); URL
  uniqueness is exact-string on the trimmed raw input (ADR-004).
- HTTP contract matches: paths (`GET/POST /api/bookmarks`,
  `DELETE /api/bookmarks/:id`), status codes (200/201/204/400/404/409),
  error body shape (`{code, message, field?}`), 16 KiB JSON limit.
- DOM hook ids in `public/index.html` (`#bookmark-form`,
  `#bookmark-title`, `#bookmark-url`, `#bookmark-submit`, `#form-error`,
  `#bookmark-list`, `#empty-state`) match the design contract; rendered
  rows follow `<li data-id="…">` with the documented child structure.
- Client `api.ts` exposes the three documented functions and `ApiError`
  carries `{status, code, message, field?}`.
- Build wiring (ADR-005): `scripts/build-client.ts` is a TS programmatic
  esbuild invocation. `npm start` runs build then `node dist/server/index.js`.

### Plan completion — PASS

All nine tasks closed green on first attempt (per per-task `done.md`).
`board.md § Done` lists T-001..T-009; backlog and in-progress are empty.
`tasks.md` story-to-task mapping is reflected in test-report coverage.

### Test evidence — PASS

`test-report.md` documents 85/85 specs across 11 files plus the smoke
test. Re-run during this review:

```
Test Files  11 passed (11)
     Tests  85 passed (85)
```

Typecheck (`tsc --noEmit` on both `tsconfig.json` and
`tsconfig.client.json`) exits zero. Smoke spec
(`test/server/smoke.test.ts`) boots `createApp` on an ephemeral port and
round-trips `POST → GET` via real `fetch`. `smoke-report.md` records a
live `node dist/server/index.js` walkthrough on `http://127.0.0.1:3000`
that exercised every documented status code (200/201/204/400/404/409),
including the duplicate-URL path and the malformed-id path.

### Code quality — PASS

- Modules are small, single-purpose, and respect the
  `shared`-only-shared boundary (server never imports from `src/client/`,
  client never imports from `src/server/`).
- Error mapping centralised in one Express error-handler in
  `src/server/app.ts`.
- Client rendering uses `textContent` / `createElement` for every piece
  of user input (`render.test.ts` exercises an HTML-injection title
  string and asserts no `<img>` materialises).
- `rel="noopener noreferrer"` and `target="_blank"` set programmatically
  on every row; both also asserted by tests.
- No `any` leaking into public types; `unknown` is used at JSON
  boundaries with explicit narrowing.

### Principle compliance — PASS

Walked P1..P7 from `orchestrator/principles.md`:

- **P1 Lean changes** — every file in the diff traces to a task and
  acceptance criterion. No drive-by refactors; the diff is constrained
  to `app/` and nothing outside the project workspace was touched
  (verified via `git status` at repo root — only unrelated
  `orchestrator/develop-log.md` and `orchestrator/evaluation/answer-queue.py`
  show as modified, both pre-existing in the workspace and unrelated to
  this review).
- **P2 Existing patterns first** — TypeScript naming follows camelCase
  for code, snake_case only for SQL columns (`created_at`) matching
  better-sqlite3 row shape. No new deps beyond the seed-pinned set.
  Test style is `describe/it` Vitest throughout.
- **P3 Zero duplication** — the only intentional duplication is the
  validation rule pair (`src/server/validation.ts` and
  `src/client/validation.ts`, plus `MAX_TITLE_LENGTH = 2048` in each).
  This is exactly 2 occurrences and is explicitly justified by ADR-006;
  P3 permits two occurrences in genuinely different contexts.
- **P4 One clean implementation** — no `legacy*` / `*V2` / `*Old`
  symbols, no commented-out blocks, no parallel old/new paths. (`grep`
  across the diff: zero matches for those patterns.)
- **P5 No speculative scaffolding** — every module has at least one
  consumer in the same workspace. `BookmarkRepository` is consumed by
  `routes/bookmarks.ts` and by tests; `ApiError` is consumed by
  `main.ts` form / delete handlers and tests. No unused exports.
- **P6 Tests describe behaviour, not structure** — server tests assert
  HTTP status, body shape, and persisted state; repository tests assert
  return values and observable list state; client tests stub `fetch`
  (the external HTTP boundary) and assert DOM outcomes, not internal
  call structure. No internal mocks.
- **P7 Don't fight the framework** — Express built-ins (`express.json`,
  `express.static`, Router, error-handler middleware), `better-sqlite3`
  prepared statements, esbuild programmatic API, Vitest defaults. No
  custom wrappers around the framework.

### Safety — PASS

- No outbound network calls at runtime (spec § Constraints invariant
  upheld; confirmed by reading `index.ts` and `app.ts`).
- 16 KiB JSON body cap.
- `rel="noopener noreferrer"` on every link.
- URL validation rejects non-`http(s)` schemes server-side, blocking
  `javascript:` URLs at the validation boundary (`form.test.ts`
  exercises the client guard).
- SQLite file lives in `app/data/`, .gitignored.
- No secrets, no auth surface, no PII.

### User feedback — N/A (no review feedback requested in this run)

No `feedback.md` was authored — the Review Audit Agent did not solicit
user approval / change / risk-acceptance during this autonomous run.
The default RETURN behaviour is to surface the verdict in `review.md`
and `review-verdict.json`; an explicit user gate happens out-of-band
when the orchestrator surfaces the verdict.

### Process learning

Captured in `~/.claude/skills/develop-log.md` per Review Audit Agent
operating spec.

## Findings

### Note 1 — `internal_error` quietly added to `ApiErrorCode` union

- **Severity:** Note.
- **Evidence:** `src/shared/types.ts:13-17` declares the union as
  `"validation_error" | "duplicate_url" | "not_found" | "internal_error"`,
  whereas `design.md § Shared types` lists only the first three.
- **Expected:** Design enumerates the public error codes; new ones
  should be added to the design contract first.
- **Actual:** Implementation added `"internal_error"` so the typed
  `jsonError(..., code: ApiErrorCode, ...)` helper compiles on the 500
  fallback path.
- **Impact:** None functionally — the 500 fallback was specified in the
  design table; only the union type's literal list lagged. No client
  code branches on this value (the client treats anything outside
  `validation_error`/`duplicate_url`/`not_found` as generic).
- **Recommendation:** Either (a) propagate the union update back to
  design as an editorial fix, or (b) accept as in-scope drift; no
  follow-up task needed.
- **Owner phase:** Design (editorial, optional).

### Note 2 — Validation rule pair is intentional duplication (ADR-006)

- **Severity:** Note.
- **Evidence:** `src/server/validation.ts` and `src/client/validation.ts`
  both implement the same rules (non-empty trimmed title; `new URL`
  parses; scheme is `http:` or `https:`).
- **Expected (per ADR-006):** Both layers validate independently; no
  shared validator module.
- **Actual:** Matches ADR-006.
- **Impact:** None — this is the explicitly chosen design.
- **Recommendation:** No action. Surfaced here so the duplication is
  not mistaken for a P3 violation in future reviews.
- **Owner phase:** None.

## Routing of unresolved work

None. The two notes above are informational; nothing requires a
re-dispatch of Spec, Design, Plan, or Build.

## Blockers

None.

## Major

None.

## Minor

None.

## Accepted risks

None.

## Conclusion

Build delivered a runnable, fully-tested, design-conformant
implementation of the four-feature Bookmarks app inside the isolated
`app/` workspace. The verdict is **PASS** with `blockers: 0`,
`major: 0`, `minor: 0`, `note: 2`.
