---
project: baseline-1779002783-2
phase: review
generated: 2026-05-17T10:30:00Z
---

# Review — baseline-1779002783-2

Project-level audit of the local-only Bookmarks app built under
`.loom/baseline-1779002783-2/app/`. Verdict: **PASS** with 0 blockers,
0 major, 3 minor, 1 note. The build is shippable as-is; the minors are
small hygiene items routed to follow-up build work, not gating.

## Verdict

| Bucket | Count |
| --- | --- |
| Blocker | 0 |
| Major | 0 |
| Minor | 3 |
| Note | 1 |

`verdict = PASS` (blockers == 0).

## Review-target walk

### Intent satisfaction — PASS

All five user stories (US-001..US-005) are implemented, traced through
the design, exercised by code, and asserted by tests:

- **US-001 (Save URL+title):** `POST /api/bookmarks` in
  `src/server/routes/bookmarks.ts:29-65` calls `validateUrl` →
  `validateTitle` → `createBookmark`, returns 201/400/409/415 per
  `design.md ## Per-request error mapping`. Asserted in
  `tests/integration/bookmarks.api.test.ts` (6 POST cases) and
  `tests/unit/validate.test.ts` (27 cases). All four ACs (persist,
  duplicate→409, invalid URL→400, empty title→400) green.
- **US-002 (Newest-first list):** `listBookmarks` orders by
  `created_at DESC, id DESC` (`src/server/repo/bookmarks.ts:71-76`).
  Empty-state copy in `src/client/render.ts:11`. AC-1/2/3 green via
  `repo.test.ts`, `bookmarks.api.test.ts`, `client/render.test.ts`.
- **US-003 (Open in new tab):** `renderItem` sets
  `target="_blank"` + `rel="noopener noreferrer"`
  (`src/client/render.ts:32-35`). Asserted in
  `client/render.test.ts`.
- **US-004 (Delete):** `DELETE /api/bookmarks/:id`
  (`routes/bookmarks.ts:67-83`) maps `NotFoundError` → 404. Client
  delete control wired in `main.ts:88-115` with re-sync on 404. Green
  via integration tests + `client/delete.test.ts`.
- **US-005 (Persist across restart):** `npm run smoke` boots the server
  twice against the same temp SQLite path, asserts the bookmark
  survives `SIGINT` + respawn (`scripts/smoke.mjs:96-106`). PASS.
  `db.test.ts` covers migration idempotence.

Constraints honored: every deliverable lives under
`.loom/baseline-1779002783-2/app/` (verified by file inventory; `git
status` confirms zero deliverable writes outside the workspace). Stack
matches the seed pin exactly — `express` 4.21, `better-sqlite3` 11.3,
`vitest` 2.1, `esbuild` 0.23, `tsx`, TypeScript, `supertest`,
`happy-dom`. No framework slipped in. Same-origin invariant held
(server `express.static` + `/api/*` on the same Express instance, port
3000). No outbound network calls at runtime.

### Design conformance — PASS

All 10 ADRs are observable in the code:

- ADR-001 (flat schema): single `bookmarks` table with
  `(id, url, title, created_at)`, no tag/category columns
  (`db.ts:46-54`).
- ADR-002 (UNIQUE + 409): `CREATE UNIQUE INDEX bookmarks_url_unique`
  + `SQLITE_CONSTRAINT_UNIQUE` → `DuplicateUrlError` →
  HTTP 409 (`repo/bookmarks.ts:55-63`, `routes/bookmarks.ts:56-62`).
- ADR-003 (immutable): no PATCH route; only GET / POST / DELETE.
- ADR-004 (byte-equal URL match): `validateUrl` trims and rejects
  non-`http(s)` but stores bytes verbatim
  (`validate.ts:11-28`). No canonicalisation.
- ADR-005 (no shared types): client declares its own `Bookmark`
  (`render.ts:4-9`), server declares `BookmarkRow` separately
  (`repo/bookmarks.ts:8-13`).
- ADR-006 (full re-fetch): `refresh` re-fetches the list after every
  successful POST/DELETE (`main.ts:19-31`).
- ADR-007 (synchronous repo calls): no `Promise.resolve` wrapping.
- ADR-008 (build client at start, idempotent): `buildClientIfStale` in
  `src/server/index.ts:29-40` and `scripts/build-client.mjs:42-48`.
- ADR-009 (Vitest + supertest + `:memory:` per file): all tests use
  the `fixture()`/`freshDb()` `:memory:` helper.
- ADR-010 (API at `/api`, static at `/`): `app.ts:18-20`.

Function signatures match `design.md ## Server-side function
signatures` (`openDatabase`, `migrate`, `createBookmark`, `listBookmarks`,
`deleteBookmark`, `bookmarksRouter`, `createApp`, `validateUrl`,
`validateTitle`, `parseId`). Client function signatures match (`fetchBookmarks`,
`createBookmark`, `deleteBookmark`, `ApiError`, `renderList`,
`renderError`, `clearError`).

### Plan completion — PASS

10/10 tasks reached `green` on attempt 1. `board.md` shows all 10
tasks in `Done`. Coverage matrix in `plan.md` matches actual test
coverage in `test-report.md`. No HITL-pending tasks. T-010 (smoke)
green. No tasks reached the three-attempt cap.

### Test evidence — PASS

- 76 vitest assertions across 9 files green.
- 1 smoke run green (cold + restart + delete cycle).
- Per-task `test-log.txt` files capture **both** red and green
  phases (verified on T-001, T-002, T-005, T-008, T-010). This is an
  improvement over baseline-1779002783-1 (which lost red-phase
  evidence after T-002 — recorded as M-3 there).
- Mutation testing opted out per `tests.md` (justified — local-only,
  no money/auth/PII flow).
- Story → AC → test mapping in `test-report.md ## Story coverage`
  reconciles cleanly against the spec's ACs.

### Code quality — PASS

Code is readable, layered cleanly (HTTP → domain → storage), and
matches the design's component-ownership table. Strict TypeScript,
no `any`-leaks in production paths (only test files use `any` for
captured-error narrowing). Prepared statements re-created per call
in `createBookmark` and `deleteBookmark` — acceptable for this scale
but see Note N-1.

### Principle compliance (P1–P7)

- **P1 (Lean):** Diff scope confined to the task's intent. No
  drive-by refactors. Functions stay at their stated responsibilities.
  One small smell: see M-1 (ApiError url-monkey-patch).
- **P2 (Existing patterns):** No comparable Loom codebase exists for
  prior art; conventions are internally consistent (snake_case for
  SQL columns, camelCase in TS, ES2022 target). No new deps beyond
  the seed-frozen list.
- **P3 (Zero duplication):** No 3+-occurrence duplication detected.
  `freshDb()` (in `repo.test.ts`) and `fixture()` (in
  `bookmarks.api.test.ts`) are two parallel `:memory:` setup helpers
  with different fixtures (one closes db, one returns app+db) — 2
  occurrences in genuinely different test contexts, within the P3
  "2 allowed" allowance.
- **P4 (One clean implementation):** No `legacy*`, no `*V1`/`*V2`,
  no commented-out blocks, no parallel old/new paths. Two
  eslint-disable comments (`no-new` in validate.ts, `no-console` in
  app.ts/index.ts) — these are deliberate, not dead code.
- **P5 (No speculative scaffolding):** See M-2 (foreign_keys pragma
  with no FKs in schema) and Note N-1.
- **P6 (Tests describe behaviour):** Tests assert on response shape,
  status codes, DOM state, and storage results — no internal mocks
  beyond the `fetch` boundary in client tests. Test names describe
  user-facing behaviour ("on 409 duplicate_url: shows error
  containing the URL", "preserves the caller-provided order without
  re-sorting"). Two structural-flavoured names exist
  (`migrate is idempotent`, `openDatabase(":memory:") returns a
  usable Database handle`) but assert on observable schema state, so
  they are behaviour-shaped under the hood.
- **P7 (Don't fight the framework):** Express built-ins used as
  designed (`express.json`, `express.static`, `Router`,
  error-middleware signature). No hand-rolled routing, no custom
  body-parsing. `better-sqlite3` used synchronously per its API.

### Safety — PASS

- Same-origin (loopback :3000 only); no CORS; no auth required by
  spec.
- `target="_blank"` always paired with `rel="noopener noreferrer"`
  (US-003 AC-2 enforced in code + tests).
- DOM rendering uses `textContent` exclusively; the
  `<img onerror=alert(1)>` XSS-style payload test confirms zero
  `<img>` children get attached (`render.test.ts:46-55`).
- No outbound network calls (no telemetry, no analytics, no service
  worker, no PWA manifest, no CDN asset).
- Request body cap at 32 KB (`app.ts:18`).
- Validation runs on every write before SQLite is touched.
- SQLite file path resolution accepts `:memory:` verbatim and
  doesn't traverse via `BOOKMARKS_DB` outside `process.cwd()` by
  default — acceptable for local-only single-user scope.

### User feedback — auto-accepted

Non-interactive review (no AskUserQuestion). No user approval,
requested change, rejection, or risk acceptance was captured this
run. See `feedback.md`.

### Process learning — PASS

Recorded in `develop-log.md` and dual-written to
`orchestrator/log/{audit,build}.md`. Notable observation: per-task
red+green logs are present for all 10 tasks, addressing the M-3 gap
flagged in the previous baseline's review. Also worth recording: the
form-submit micro-tasking pattern in `tests/unit/client/form.test.ts`
(double `await Promise.resolve` drain) is a clean way to flush the
awaited-fetch chain in happy-dom without `vi.runAllTimersAsync`.

---

## Findings

### M-1 — ApiError monkey-patches `url` for messaging

**Severity:** Minor (P1 lean / P2 conventions — narrowly violates
class contract)

**Evidence:** `src/client/main.ts:69-71`:

```ts
if (err instanceof ApiError && err.code === 'duplicate_url') {
  (err as ApiError & { url?: string }).url = url;
}
return formErrorMessage(err);
```

and `src/client/main.ts:35-38`:

```ts
if (err.code === 'duplicate_url') {
  const url = (err as ApiError & { url?: string }).url;
  return `That URL is already saved: ${url ?? err.message}`;
}
```

**Expected:** `ApiError`'s declared shape should cover every field
the codebase relies on. Either add `url?: string` to the
constructor + class declaration (server already sends
`error.url` for `duplicate_url`), or use `err.message`/the
form-input value directly without the cast.

**Actual:** The class declares `status`, `code`, `field?` but not
`url`; the calling site narrows via an inline intersection cast and
mutates the instance.

**Impact:** Low. Behaviour is correct; readers must trace the
attached property across two files. The server already includes
`url` in the 409 body (`routes/bookmarks.ts:58-60`) and
`toApiError` could parse it directly.

**Recommendation:** Either (a) extend `ApiError` constructor to read
`err.url` from the body in `toApiError`, or (b) drop the
monkey-patch and use the form's `url` variable directly in the
duplicate-message path (it's already in scope at the call site).

**Owner phase:** Build (follow-up minor cleanup; not gating).

### M-2 — `foreign_keys = ON` pragma with no foreign keys in schema

**Severity:** Minor (P5 — speculative configuration with no current
consumer)

**Evidence:** `src/server/db.ts:35` runs `db.pragma('foreign_keys =
ON')` on every open. The schema (`db.ts:46-54`) has a single table
with no `REFERENCES` clauses anywhere in the project, now or in
`design.md`.

**Expected:** Per P5, every config knob must be exercised by code
that exists in this PR. The pragma is defensive scaffolding for a
schema that doesn't exist.

**Actual:** The pragma is set; no FK exists; the pragma has no
runtime effect.

**Impact:** Negligible runtime cost. Cognitive noise — a reader
inferring the schema shape from `db.ts` would expect FKs that aren't
there.

**Recommendation:** Drop the line, or move it inside the migration
behind a comment that explains when it would matter.

**Owner phase:** Build (one-line cleanup).

### M-3 — `tests/_init.test.ts` placeholder remains after real tests landed

**Severity:** Minor (P5 — abstraction with no consumer; P1 — line
no longer traces to an acceptance criterion)

**Evidence:** `tests/_init.test.ts:1-8` is an `expect(true).toBe(true)`
harness-wiring sanity check from T-001. After T-002..T-010 added
the real test files, the placeholder no longer serves its purpose;
the real test files prove the harness works.

**Expected:** Per P5 self-check ("what concrete thing in this PR
uses this new thing?"), the placeholder should have been removed in
T-002 once `tests/unit/db.test.ts` provided the same evidence.

**Actual:** Still present; `_init.test.ts` is one of the nine test
files in the final report.

**Impact:** Trivial. One redundant assertion in the suite.

**Recommendation:** Delete `tests/_init.test.ts` in a follow-up.

**Owner phase:** Build (delete a 7-line file).

### Note

#### N-1 — `WAL` journal mode is on by default; not in `design.md`

`src/server/db.ts:33` enables `journal_mode = WAL` for non-`:memory:`
databases. This isn't called out in `design.md ## Constraints` or
the ADRs, but it's a sensible local-database default (also adopted
in baseline-1779002783-1, recorded as Note there). Worth a one-line
mention in design next time so the `.sqlite-wal` / `.sqlite-shm`
sidecar files on disk are expected behaviour rather than surprise.

---

## Risk acceptance

None — no major or blocker findings to accept.

## Routing summary

| Finding | Severity | Owner phase |
| --- | --- | --- |
| M-1 ApiError url monkey-patch | Minor | Build (follow-up) |
| M-2 foreign_keys pragma without FKs | Minor | Build (follow-up) |
| M-3 `_init.test.ts` placeholder lingers | Minor | Build (follow-up) |
| N-1 WAL not in design | Note | Design (next baseline) |

All three minors are one-line edits suitable for a single follow-up
build task; none is a behavioural defect.
