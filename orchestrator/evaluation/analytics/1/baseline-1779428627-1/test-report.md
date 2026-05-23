---
project: baseline-1779428627-1
phase: build
created: 2026-05-22
---

# Test Report — baseline-1779428627-1

Aggregated verification across the nine Build tasks plus the
phase-wide smoke gate. Mutation testing is disabled per `tests.md`.

## Per-task evidence

| Task | Status | Spec files | Specs passing | Test log |
| --- | --- | --- | --- | --- |
| T-001 | green | `test/smoke.test.ts` | 1/1 | `tasks/T-001.test-log.txt` |
| T-002 | green | `test/server/repository.test.ts` | 8/8 | `tasks/T-002.test-log.txt` |
| T-003 | green | `test/server/validation.test.ts` | 20/20 | `tasks/T-003.test-log.txt` |
| T-004 | green | `test/server/routes.test.ts` | 11/11 | `tasks/T-004.test-log.txt` |
| T-005 | green | `test/client/shell.test.ts` | 7/7 | `tasks/T-005.test-log.txt` |
| T-006 | green | `test/client/render.test.ts`, `test/client/api.test.ts` | 15/15 | `tasks/T-006.test-log.txt` |
| T-007 | green | `test/client/form.test.ts`, `test/client/validation.client.test.ts` | 16/16 | `tasks/T-007.test-log.txt` |
| T-008 | green | `test/client/delete.test.ts` | 5/5 | `tasks/T-008.test-log.txt` |
| T-009 | green | `test/server/smoke.test.ts` | 2/2 | `tasks/T-009.test-log.txt` |

**Total: 85/85 vitest specs passing across 11 files.**

```
$ npx vitest run
 ✓ test/server/validation.test.ts (20 tests) 3ms
 ✓ test/server/repository.test.ts (8 tests) 21ms
 ✓ test/smoke.test.ts (1 test) 1ms
 ✓ test/server/routes.test.ts (11 tests) 116ms
 ✓ test/server/smoke.test.ts (2 tests) 42ms
 ✓ test/client/api.test.ts (7 tests) 6ms
 ✓ test/client/delete.test.ts (5 tests) 103ms
 ✓ test/client/form.test.ts (8 tests) 117ms
 ✓ test/client/validation.client.test.ts (8 tests) 3ms
 ✓ test/client/render.test.ts (8 tests) 17ms
 ✓ test/client/shell.test.ts (7 tests) 34ms
 Test Files  11 passed (11)
      Tests  85 passed (85)
```

## Typecheck

```
$ npx tsc --noEmit -p tsconfig.json
(exit 0)
$ npx tsc --noEmit -p tsconfig.client.json
(exit 0)
```

## Story coverage

Every US-NNN in `spec.md` has at least one passing behaviour-level
spec, per the `satisfies-stories` mapping in `task.md`:

| Story | Behaviour specs covering it |
| --- | --- |
| US-001 Save a Bookmark | server: `routes.test.ts` POST cases (201/409/400). repo: `repository.test.ts` create + duplicate. validation: `validation.test.ts`. client: `form.test.ts` valid submit, 409, 400 cases. |
| US-002 View All Saved Bookmarks | server: `routes.test.ts` GET ordering, `repository.test.ts` list ordering, tie-breaker by id. client: `render.test.ts` list rendering + replacement, `shell.test.ts` empty-state node, `form.test.ts` empty-state toggle. |
| US-003 Open in New Tab | client: `render.test.ts` asserts every `<a>` has `target="_blank"` and `rel="noopener noreferrer"`; `shell.test.ts` documents the contract in the static template. |
| US-004 Delete a Bookmark | server: `routes.test.ts` DELETE 204/404/400; `repository.test.ts` delete returns true/false. client: `delete.test.ts` 204 removes row, 404 treated as success, unexpected error rolls back, in-flight disabled guard. |

## Smoke

See `smoke-report.md`. Live `node dist/server/index.js` bound to
`http://localhost:3000`, served the HTML shell, the 7543-byte
bundled JS, and the full JSON API (200/201/204/400/404/409 paths all
exercised via curl). Bundle size is far under the 30 KiB unminified
budget declared in design.

## Mutation testing

Disabled — `tests.md.Mutation Testing: no`.

## Notes / minor in-scope adjustments

- During T-007 implementation, the initial `main.ts` auto-init used
  `queueMicrotask` to defer init when `document.readyState !==
  "loading"`. That double-fired alongside the test-side `initApp`
  call (the test reset modules and imported fresh). Fix: keep only
  the `DOMContentLoaded` auto-init branch; tests own init timing
  under jsdom. This was a single in-task adjustment, recorded in
  `T-007.test-log.txt`, no out-of-scope edits.

No tests were weakened. No destructive commands were run. No commits
were created.
