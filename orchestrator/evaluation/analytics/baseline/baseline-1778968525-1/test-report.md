# Test report — baseline-1778968525-1

## Final test run

`npm test` from `app/` — Vitest 2.1.9, single worker:

```
 ✓ tests/api.test.ts        (6 tests)   4ms
 ✓ tests/db.test.ts         (4 tests)   6ms
 ✓ tests/dom.test.ts        (5 tests)   6ms
 ✓ tests/errors.test.ts     (9 tests)  45ms
 ✓ tests/repository.test.ts (6 tests)  14ms
 ✓ tests/routes.test.ts     (9 tests)  51ms
 ✓ tests/smoke.test.ts      (3 tests)  18ms
 ✓ tests/validation.test.ts (6 tests)   2ms

 Test Files  8 passed (8)
      Tests  48 passed (48)
   Duration  ~1.5s
```

`npx tsc --noEmit` — clean.
`npm run build` — emits `public/app.js` (5.3 KiB) + sourcemap.

## Coverage by story

| Story | Tasks | Test files contributing | Status |
| --- | --- | --- | --- |
| US-001 Save | T-003, T-004, T-005, T-006, T-009 | repository, validation, errors, routes, api, dom | green |
| US-002 List newest-first | T-003, T-006, T-008, T-009 | repository, routes, smoke, dom | green |
| US-003 Open in new tab | T-008, T-009 | dom (anchors carry target+rel) | green |
| US-004 Delete | T-003, T-005, T-006, T-009 | repository, errors, routes, api | green |

Every active acceptance criterion is covered by at least one automated test or a smoke probe (see `smoke-report.md`).

## Task summary

| Task | Status | Attempts | Notes |
| --- | --- | --- | --- |
| T-001 | complete | 1 | scaffolding + `npm install` + tsc clean |
| T-002 | complete | 1 | 4/4 db tests |
| T-003 | complete | 1 | 6/6 repository tests |
| T-004 | complete | 1 | 6/6 validation tests |
| T-005 | complete | 1 | 9/9 errors/middleware tests |
| T-006 | complete | 1 | 9/9 routes tests |
| T-007 | complete | 1 | bootstrap glue; suite still green |
| T-008 | complete | 1 | HTML/CSS shell; structural review |
| T-009 | complete | 1 | 11/11 dom + api tests |
| T-010 | complete | 1 | 3/3 smoke tests; bundle built; `npm start` live-checked |

Total: 10 complete, 0 failed, 0 hitl-pending.

## Notes

- Two minor fixes during build (still within attempt 1 of each owning task): the better-sqlite3 unique-violation assertion was rewritten to check `err.code` rather than the message text (the message format is version-dependent), and `req.params.id` was narrowed via `typeof === 'string'` because Express 5 typings widen path params to `string | string[]`.
- One workspace-only quirk: `build.mjs`'s "am I being executed directly?" check originally compared `import.meta.url` against `file://${argv[1]}`, which failed when the absolute path contains a space (`%20` encoding mismatch). Switched to comparing resolved filesystem paths.
- The expected `console.error` stack from `errors.test.ts > "maps unknown errors to 500"` is the production behaviour exercised by that test — it appears in stderr but does not fail the run.
