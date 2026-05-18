# Review — baseline-1779117992-1 (Bookmarks)

**Verdict:** PASS.

Build delivered a runnable local-only Bookmarks app under
`.loom/baseline-1779117992-1/app/` matching `spec.md`, `design.md`, and
`plan.md`. The four user stories US-001..US-004 each map cleanly to
implementation surface and tests. `npm test` runs 44 passing tests (+1
documented skip) in 1.0s against in-memory SQLite; the smoke report
records a full headless-browser pass over the save / list / open /
delete loop, including a real bug that was caught and fixed during
smoke. No blockers. Three minor findings below; none are release-gating.

## Verification re-run

Re-ran `npm test` from `./app/` during review:

```
Test Files  3 passed (3)
     Tests  44 passed | 1 skipped (45)
  Duration  1.05s
```

Matches `test-report.md` exactly. The forced-throw test prints a
[error-handler] stack to stderr, which is the intended path through the
central error handler — not a failure.

## Intent satisfaction

| Story | Implementation | Tests | Status |
| --- | --- | --- | --- |
| US-001 Save | `routes/bookmarks.ts POST`, `repo.createBookmark`, `web/main.ts handleSubmit` | api.test.ts (5 cases) + web.test.ts (4 cases) + repo.test.ts (3 cases) | satisfied |
| US-002 List | `routes/bookmarks.ts GET`, `repo.listBookmarks`, `web/main.ts renderList` + `#empty-state` | api.test.ts (4 cases) + web.test.ts (4 cases) | satisfied |
| US-003 Open | `web/main.ts renderRow` anchor with `target=_blank rel="noopener noreferrer"` | web.test.ts (3 cases) | satisfied |
| US-004 Delete | `routes/bookmarks.ts DELETE`, `repo.deleteBookmark`, `web/main.ts handleDelete` (404 → refetch) | api.test.ts (3 cases) + web.test.ts (3 cases) + repo.test.ts (3 cases) | satisfied |

Constraints (spec.md §Constraints):
- Workspace isolation: every deliverable file lives under
  `.loom/baseline-1779117992-1/app/`. No writes to repo root or
  sibling workspaces. **OK.**
- Stack pin: TypeScript everywhere, Express ^4, better-sqlite3 ^11,
  esbuild ^0.24, Vitest ^2, no frontend framework. `package.json`
  matches. **OK.**
- Run-command pin: `npm start` runs `npm run build && node
  --enable-source-maps dist/server.js`; `npm test` runs `vitest run
  --passWithNoTests`. **OK** (`--passWithNoTests` is a harmless override
  that does not change behaviour when tests exist).
- Locality / no nice-to-haves: no telemetry, no analytics, no service
  worker, no PWA manifest, no auth, no CORS middleware. **OK.** The
  CSS does include `@media (prefers-color-scheme: dark)` overrides,
  which spec.md §Constraints explicitly allows as "falls out of the
  chosen CSS for free".

## Design conformance

- File layout matches `design.md § System shape` exactly (`server.ts`,
  `app.ts`, `db.ts`, `routes/bookmarks.ts`, `repo/bookmarks-repo.ts`,
  `shared/types.ts`, `shared/validate.ts`, `web/{index.html,
  styles.css, main.ts}`).
- HTTP API matches the contract: `GET /api/bookmarks` → 200 `Bookmark[]`
  ordered `created_at DESC, id DESC`; `POST` → 201 / 400 / 409;
  `DELETE /:id` → 204 / 400 / 404. Error envelope shape
  `{ error: { code, message, field? } }` is consistent across routes,
  the 404 catch-all, and the central error handler.
- Schema, pragmas, and migration in `db.ts` match `design.md § Data
  model` byte-for-byte (table DDL, UNIQUE index, `created_at DESC, id
  DESC` index, WAL pragma).
- ADR-001 (route/repo split, no service): held — SQL lives only in
  `repo/bookmarks-repo.ts`; routes do HTTP shape only.
- ADR-002 (single shared DB handle): held — `server.ts` opens one
  handle, `createApp` accepts it and attaches it to `app.locals.db`.
- ADR-003 (UNIQUE index, no normalisation): held — URLs stored
  verbatim; `SQLITE_CONSTRAINT_UNIQUE` maps to `DuplicateUrlError`
  → 409.
- ADR-004 (esbuild one-shot): held — `npm run build` runs `tsc -p
  tsconfig.build.json` then `node esbuild.config.mjs`; `npm start`
  builds before launching.
- ADR-005 (no PATCH route): held — Express returns 404 for `PATCH
  /api/bookmarks/1` and a structural test asserts this.
- ADR-006 (ISO-8601 ms TEXT): held — `created_at TEXT DEFAULT
  (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`; tests assert the regex.
- ADR-007 (same-origin, no CORS): held — no `cors` package, no
  `Access-Control-*` headers.

One small divergence: `design.md` describes `resolveWebDir()` /
`resolvePublicDir()` as runtime path resolvers. `resolvePublicDir`
collapses to a single path (`../public` in both branches), so the
if/else is structurally dead. Logged as a P1 minor below; the function
still resolves correctly.

## Plan completion

Board: 7 / 7 tasks Done (T-001..T-007). Every task has a `.done.md`,
`.test-log.txt`, and an entry in `develop-log.md`. The two foundation
tasks (T-001 scaffold, T-003 app shell) and five behaviour slices
(T-002 repo, T-004 save, T-005 list, T-006 open, T-007 delete) map to
the slicing strategy in `plan.md` without drift.

## Test evidence

- Repo: 10 tests, `tests/repo.test.ts`. Behaviour-level — assert on
  return values and thrown error types, not internal methods.
- API: 19 tests + 1 skipped (`POST persists the row`), `tests/api.test.ts`.
  `supertest` against `createApp(:memory:)`. Validates status, body
  shape, envelope discriminator `field`.
- Web: 15 tests, `tests/web.test.ts`. jsdom + `vi.stubGlobal('fetch')`
  — fetch is an external boundary, mocking it is correct per P6.
- Smoke: 5 / 5 PASS (`smoke-report.md`), with screenshots of
  empty-state, save-and-list, duplicate-error, and after-delete.
- Mutation: declared `no` in `tests.md`; skipped intentionally.

Skipped test (`api.test.ts` line 135 `it.skip(...)`) — see the P4 minor
finding below.

## Code quality

- Layering is clean: web client never imports server modules except
  the shared types/validation modules under `src/shared/`.
- Validation is centralised in `src/shared/validate.ts` and used by
  both the POST route and the web form (P3-compliant — single source
  of truth, not duplicated).
- Output rendering uses `textContent` and attribute setters, never
  `innerHTML` — `web.test.ts` line 219 asserts this against an
  `<script>` payload.
- Anchors carry `rel="noopener noreferrer"` to satisfy the security
  envelope in `design.md § Constraints`.
- Strict ID parsing in the DELETE route (`/^\d+$/`) rejects malformed
  IDs at the boundary with a clear `field: 'id'` envelope.

## Principle compliance (P1–P7)

| Principle | Check | Result |
| --- | --- | --- |
| P1 Lean changes | Every file in the diff traces to a task / AC / Constraint | mostly — see minor below |
| P2 Existing patterns | New project; conventions internally consistent (camelCase, ESM, named exports) | OK |
| P3 Zero duplication | Validation shared in `shared/validate.ts`; SQL only in repo; envelope shape consistent | OK |
| P4 One clean impl | No `legacy*` / `*V2` / commented-out blocks | mostly — one `.skip` tombstone, see minor below |
| P5 No speculative scaffolding | Every new module has a current consumer | mostly — `__setBookmarks` / `__getBookmarks` unused, see minor below |
| P6 Tests describe behaviour | Tests assert on return values, status codes, DOM state. `fetch` is mocked (external boundary); no internal-collaborator mocking | OK |
| P7 Don't fight the framework | Uses `express.json`, `express.static`, the 4-arg error-handler signature, default routing | OK |

## Findings

### Minor

#### M-1 (P5) — Dead test-helper exports in `web/main.ts`

- **Evidence:** `src/web/main.ts:227-230` exports `__setBookmarks` and
  `__getBookmarks` "for Vitest to seed module state for renderList-only
  assertions"; `grep -r '__setBookmarks\|__getBookmarks'` finds zero
  importers under `tests/`.
- **Expected:** every new export has a current consumer in the same PR
  (P5).
- **Actual:** both helpers are unreachable. The web tests reset module
  state via `vi.resetModules()` + `await import(...)` (line 47–48),
  which is the actual mechanism used.
- **Impact:** Three lines of unused public surface in the bundle.
  Cosmetic — the bundle is still 6.4kb.
- **Recommendation:** Delete both exports and the surrounding comment
  block. If a future test needs them, reintroduce alongside the test.
- **Owner phase:** spec-tweak / future build follow-up. Not blocking.

#### M-2 (P4) — `it.skip(...)` tombstone in `api.test.ts`

- **Evidence:** `tests/api.test.ts:135-149` contains a 15-line
  `it.skip('POST persists the row (replaced by T-005 …)', …)` block
  with a "replaced by" comment.
- **Expected:** P4 — no commented-out / dead code lands; git remembers.
- **Actual:** The skipped body still encodes its old assertion path
  plus a comment explaining why it was superseded. Test-report and
  develop-log already document the migration; the body is a tombstone.
- **Impact:** Tooling reports `1 skipped` forever; readers must decide
  whether the skip is intentional or accidental.
- **Recommendation:** Delete the `it.skip` block entirely. The T-005
  `POST then GET — newer row is first` test already carries the
  assertion.
- **Owner phase:** future build follow-up.

#### M-3 (P1) — Dead branch in `app.ts resolvePublicDir`

- **Evidence:** `src/app.ts:29-35` defines `resolvePublicDir()` with an
  if/else where both branches compute the same path
  (`path.resolve(__dirname, '../public')`).
- **Expected:** P1 — the smallest diff; no impossible-case error
  handling and no dead branches.
- **Actual:** The function reduces to a constant; the `if
  (existsSync(fromSrc))` is structurally unreachable as a discriminator
  because both arms are identical.
- **Impact:** Cosmetic. Reader confusion when scanning for the dist-vs-
  src distinction (the `resolveWebDir` sibling does have a real
  distinction).
- **Recommendation:** Replace with `path.resolve(__dirname,
  '../public')` directly, drop the helper, or — if a future
  `dist/public` layout is intended — make the two branches actually
  differ. Today's code doesn't justify the wrapper.
- **Owner phase:** future build follow-up.

### Note

#### N-1 — `/api/__throw` is registered in all environments

`src/app.ts:62-64` mounts an `/api/__throw` route that always exists,
so that `tests/api.test.ts` can verify the central error handler emits
the `500 internal_error` envelope. The route is namespaced under
`/api/__throw` (double underscore), unmounted in production by
convention only. This is documented inline. Acceptable for a
single-user localhost app; the alternative (env-gated registration)
would diverge test-vs-prod wiring which is worse per P6/P7. Logged as
a note, not a finding.

### Blockers

None.

### Major

None.

## Safety

- Same-origin only; no CORS headers emitted.
- Output uses `textContent` / `setAttribute` for all user data — XSS
  surface is closed.
- Anchors use `rel="noopener noreferrer"` so opened bookmarks cannot
  reach back into the opener (US-003).
- DB path defaults to `./bookmarks.sqlite`; `bookmarks.sqlite` is
  gitignored (smoke confirmed it does not appear after a test run).
- No outbound network calls from the server.

## User feedback

Not solicited this cycle (no Pending user input on `pipeline.md`).
`feedback.md` left absent — append on next cycle if the user surfaces
anything.

## Process learning

See `develop-log.md` for project-local entries. Two
audit-cycle-specific observations recorded as a new project entry
below; the matching shard append lives in `orchestrator/log/audit.md`.
