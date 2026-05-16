## T-001 — Workspace scaffold (build-task) — 2026-05-16T11:50:33Z
- status: green, attempts: 1
- files: app/package.json, app/tsconfig.json, app/.gitignore, app/README.md, app/test/scaffold.test.ts
- All 5 scaffold tests pass. Locked stack installed.
## T-002 — SQLite repo (build-task) — 2026-05-16T11:53:58Z
- status: green, attempts: 1
- files: app/src/types.ts, app/src/db.ts, app/test/db.test.ts
- 14 tests green. Idempotent migration, URL canonicalisation, typed errors, prepared statements.
## T-005 — Client shell + esbuild (build-task) — 2026-05-16T11:56:45Z
- status: green, attempts: 1
- files: app/src/client/{index.html,styles.css,main.ts}, app/scripts/build-client.ts, app/test/build-client.test.ts
- esbuild bundle to dist/client/main.js; HTML + CSS copied. 3/3 tests green.
## T-003 — API router (build-task) — 2026-05-16T12:00:28Z
- status: green, attempts: 1
- files: app/src/routes/bookmarks.ts, app/src/server.ts, app/test/api.test.ts
- buildApp(repo) + bookmarksRouter. 14/14 supertest assertions green.
## T-004 — Server boot (build-task) — 2026-05-16T12:03:26Z
- status: green, attempts: 1
- files: app/src/server.ts, app/test/server-boot.test.ts
- startServer + static handler, 127.0.0.1 only, SIGINT/SIGTERM cleanup. 5/5 tests green.
## T-006 — Client API + render (build-task) — 2026-05-16T12:08:13Z
- status: green, attempts: 1
- files: app/src/client/{api.ts,render.ts,main.ts}, app/test/client-render.test.ts
- 13/13 tests green. jsdom added as devDep for client tests.
## T-007 — Save form (build-task) — 2026-05-16T12:14:29Z
- status: green, attempts: 1
- files: app/src/client/form.ts, app/src/client/main.ts, app/test/client-form.test.ts
- 5/5 tests green. Form dispatches field errors to url-error/title-error/form-error.

## T-008 — In-row delete (build-task) — 2026-05-16T12:14:29Z
- status: green, attempts: 1
- files: app/src/client/delete.ts, app/src/client/main.ts, app/test/client-delete.test.ts
- 5/5 tests green. Two-step in-row delete with 5s timeout, event delegation.
## T-009 — Smoke + persistence (build-task) — 2026-05-16T12:18:31Z
- status: green, attempts: 1
- files: app/test/smoke.test.ts, app/test/build-client.test.ts (race-fix)
- Full suite 67/67 green.

## 2026-05-16 - baseline-1778931123-1 - review audit
- 0 blockers, 0 major, 3 minor. Verdict: PASS — accepted with minor findings.
- F-001 (P5 minor): BookmarkRepo.getById is design-mandated (named in the
  design.md interface) but has no production consumer in this PR — only
  exercised by db.test.ts. Accepted-risk because the design contract names
  it; if the design ever drops it, remove the method in the same PR.
- F-002 (minor design conformance): the `body.url` non-string branch in the
  POST handler omits `field: 'url'` while every other validation branch
  sets it. Existing tests pass because they only assert on `error.code`.
  Tighten if/when the client wants field-level UX on this edge case.
- F-003 (minor stylistic): the POST handler runs the title-empty check
  before the url-empty check; design.md lists the order body-shape →
  title-trim → URL-parse. No observable difference; the resulting
  envelopes match the design.
- Workspace isolation held: `git status` outside `.loom/` is unchanged by
  the build; all writes landed under `.loom/baseline-1778931123-1/app/`.
- Two out-of-scope build-time edits were justified in test-report.md and
  the respective T-NNN.done.md entries (adding jsdom devDep for client
  tests; removing pre-rm of dist/client to break a parallel-test race).

## 2026-05-16 - baseline-1778931123-1 - process notes
- The Coordinator followed Lock → Red → Implement → Green → Done for each
  T-001..T-009 and preserved both red and green logs in
  `tasks/T-NNN.test-log.txt`. This made the review audit cheaper: every
  acceptance criterion has a paired failing-test artifact and a passing-test
  artifact, so the diff trace is explicit.
- Build's smoke gate was self-honest about the SKIPPED check (browser
  harness): rationale documented inline rather than hidden. Worth keeping
  as a pattern.
- P5 (no speculative scaffolding) interacts with design.md interfaces. When
  a design lists an interface method that no current consumer uses, the
  Task Builder honours the interface, and the Review Audit Agent should
  treat the unused method as a design-traceable note, not a violation. The
  cleaner fix is at the design phase (don't list methods without
  consumers).
