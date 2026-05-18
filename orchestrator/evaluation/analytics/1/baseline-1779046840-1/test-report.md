# Test Report — baseline-1779046840-1

## Summary

- 53 passed | 1 skipped | 0 failed across 10 active test files.
- Mutation testing: disabled per `tests.md` (`Mutation Testing: no`).
- Verification environment: `node-test` (Vitest 2.1.1 + supertest 7.0.0).

## Coverage by task

| Task | Tests | Status |
| --- | --- | --- |
| T-001 | n/a (scaffold) | green |
| T-002 | test/db.test.ts (5) | green |
| T-003 | test/api.test.ts GET (3) | green |
| T-004 | test/api.test.ts POST (5) | green |
| T-005 | test/api.test.ts DELETE (4) | green |
| T-006 | test/static.test.ts (4) | green |
| T-007 | test/client/api.test.ts (6) + test/client/dom.test.ts (6) | green |
| T-008 | test/client/main-list.test.ts (4) | green |
| T-009 | test/client/main-save.test.ts (5) | green |
| T-010 | test/client/main-open.test.ts (3) | green |
| T-011 | test/client/main-delete.test.ts (5) | green |
| T-012 | test/smoke.test.ts (3) | green |

## Story coverage

- US-001 save: T-004 (server), T-009 (client) → green
- US-002 list newest-first: T-003 (server), T-008 (client) → green
- US-003 open in new tab: T-010 (client) → green
- US-004 delete: T-005 (server), T-011 (client) → green
- All four user stories have at least one passing acceptance test.

## Anomalies

- Two recorded scope expansions:
  1. main.ts save-form submit handler landed under T-008 (declared
     scope: T-009). Recorded in `tasks/T-008.done.md`.
  2. main.ts delegated delete handler landed under T-008 (declared
     scope: T-011). Recorded in `tasks/T-008.done.md`.
  3. `prependItem` dom helper landed in T-007 (declared scope: T-009).
     Recorded in `tasks/T-007.done.md`.
  In all three cases the deferred-task subagent only added its
  behaviour-test files; no implementation diff bled across task
  boundaries beyond what is recorded.
- `tsconfig.server.json` originally emitted to `dist/server/server/`
  due to `rootDir: src` + a server file path of `src/server/index.ts`.
  Fixed in T-012 by setting `outDir: dist` so the emitted path is
  `dist/server/index.js` per `design.md § ADR-006`.

## Build artefacts

- dist/client/app.js (24.3 KB esbuild bundle)
- dist/client/index.html
- dist/client/styles.css
- dist/server/index.js + db.js + routes.js + static.js
