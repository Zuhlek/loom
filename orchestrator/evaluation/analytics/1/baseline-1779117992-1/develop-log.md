# develop-log — baseline-1779117992-1

Dual-written with `orchestrator/log/build.md`. One entry per task and one
for the final smoke.

## T-001 — scaffold (green)
- Laid down `./app/` package metadata: package.json, tsconfig.json + a
  separate tsconfig.build.json for the server-only emit, esbuild config,
  vitest config with per-file environment match, .gitignore.
- `npm install` ok (232 packages). `npm test --passWithNoTests` ok. `tsc
  --noEmit` ok after adding a placeholder source file.
- Note: the placeholder was removed in T-002 once real modules landed.

## T-002 — repo + db (green)
- `src/db.ts` opens better-sqlite3, applies pragmas (WAL, foreign_keys
  ON, synchronous NORMAL), runs idempotent migration.
- `src/repo/bookmarks-repo.ts` implements list/create/delete with
  DuplicateUrlError / NotFoundError. Catches both SQLITE_CONSTRAINT_UNIQUE
  and SQLITE_CONSTRAINT codes and the "UNIQUE constraint failed"
  substring — the matrix that better-sqlite3 emits across versions.
- 10/10 repo tests green.

## T-003 — app shell + static + error envelope (green)
- `src/app.ts` wires JSON parser, static for src/web/ and public/,
  explicit GET / fallback, the /api/__throw test endpoint, the
  /api/bookmarks router (placeholder GET), 404 catch-all, central error
  handler emitting `{ error: { code, message } }`.
- `src/server.ts` boots openDb → createApp → listen(3000) with
  EADDRINUSE → exit 1.
- 5/5 boot-shape tests green.

## T-004 — POST + form submit + inline errors (green, attempt 2)
- Validation centralised in `src/shared/validate.ts` and imported by both
  the route and the web client.
- Route POST handler maps DuplicateUrlError → 409 and validation fail →
  400 invalid_input with the `field` discriminator.
- Web `main.ts` consolidated all client behaviour (form submit, render
  list, delete button, fetch/post/delete helpers) early — recorded as an
  out-of-scope edit on T-004 because it would otherwise force three
  successive rewrites by T-005/T-006/T-007. Each downstream task still
  owns its own assertion bundle.
- Two failures on first attempt: (1) module-level auto-init ran on import
  plus the test's explicit init() → duplicate submit handlers; fixed by
  skipping bootstrap when Vitest sets VITEST=true. (2) one api test
  depended on the not-yet-swapped placeholder GET; reframed to verify the
  DB row directly.
- 8 new tests green (5 api + 4 web minus the originally-skipped one).

## T-005 — GET + renderList + empty-state (green)
- Swapped placeholder GET for `listBookmarks(db)`.
- 4 api tests cover empty, three-row newest-first, id-DESC tiebreak,
  POST→GET ordering.
- 5 web tests cover renderList output, empty-state, structural absence
  of search/sort controls, textContent (no innerHTML for user data),
  initial fetch + render wiring.

## T-006 — open in new tab (green)
- Anchor attributes target=_blank rel="noopener noreferrer" per row.
- Red phase produced by temporarily stripping the attributes (assertion
  failure confirmed) and then restoring. 3 new web tests.

## T-007 — DELETE + 404 refetch reconcile (green)
- DELETE /:id with strict positive-integer parsing.
- 3 api tests (204, 404, 400) + 3 web tests (single DELETE on click,
  204 removes row, 404 → DELETE-then-GET refetch, no confirmation modal).

## Smoke
- `npm run build` produces dist/* and public/bundle.js cleanly (the
  esbuild warnings about import.meta inside the IIFE bundle were fixed
  by rewriting the test-env gate to use `typeof process` instead of
  `import.meta`).
- `node dist/server.js` boots on 3140 against a fresh :memory: DB.
- Every endpoint matches design.md: GET / (html), /styles.css (css),
  /bundle.js (js), /api/bookmarks GET/POST/DELETE with correct status
  codes + envelope. PATCH (US-001 AC4 immutability) and unknown paths
  both 404. Static and JSON envelopes co-exist via the catch-all.
- Puppeteer walked the empty → save → duplicate-error → delete loop
  end-to-end. Screenshots in `smoke-screenshots/`.
- Smoke caught a real bug pre-fix: the IIFE-bundled
  `typeof process?.env?.VITEST` threw ReferenceError in the browser
  (optional chaining doesn't make the leading identifier optional).
  Fixed by guarding the lookup behind `typeof process === 'undefined'`.
  Tests still 44 green.
- No tests touched the on-disk `bookmarks.sqlite`; all use :memory:.

## 2026-05-18 - baseline-1779117992-1 - review minor patterns

Review found three minor (no blocker, no major) issues. Two have the
same shape: small dead code that survived a refactor.

- `it.skip(...)` tombstones in test files leave a permanent "1 skipped"
  signal that future readers must re-derive context for. When a test
  is superseded by a different test, delete the old body — git holds
  the history. Develop-log already documented the migration; the skip
  is pure tooling noise (P4 cue: "no commented-out blocks", and a
  `.skip` with a "replaced by" comment is the same shape).
- Dead exports on a public module surface (`__setBookmarks`,
  `__getBookmarks` on `web/main.ts`) attract attention from grep-based
  reviewers and inflate the bundle for no consumer. If a helper is
  added "for tests" but no test imports it, delete it; reintroduce
  alongside the test that needs it. Reflects P5: every new export
  must have a current consumer in the same diff.
- `resolvePublicDir` shows a third pattern: helper functions that
  encode an intended branching distinction but compute the same value
  in both branches. If the distinction matters later, the function
  signature and the call site can be reintroduced then; today it just
  reads as a missing rebase fixup. Reflects P1: every line should
  trace to an acceptance criterion or constraint, and a dead branch
  doesn't.

No spec / design / plan rework needed — these all land as small
follow-up edits inside the existing build slice.

