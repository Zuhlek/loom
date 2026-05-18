---
project: baseline-1779111523-1
phase: build
created: 2026-05-18
---

# Test report — baseline-1779111523-1

Aggregated verification evidence for the Build phase. Mutation testing
is `no` per `tests.md`; no mutation section.

## Per-task results

| Task | Status | Attempts | Red captured | Green captured | Test files added |
| --- | --- | --- | --- | --- | --- |
| T-001 | green | 1 | yes | yes | repository.list, routes.list, client.render |
| T-002 | green | 1 | yes | yes | validation, repository.create, routes.create |
| T-003 | green | 1 | yes | yes | client.open |
| T-004 | green | 1 | yes | yes | repository.delete, routes.delete, client.delete |
| T-005 | green | 1 | yes | yes | persistence.restart |

All five tasks reached green on the first attempt. No three-attempt
cap hits. No HITL blockers.

## Aggregate suite

```
 ✓ tests/routes.list.test.ts (3 tests)
 ✓ tests/routes.create.test.ts (6 tests)
 ✓ tests/persistence.restart.test.ts (2 tests)
 ✓ tests/validation.test.ts (6 tests)
 ✓ tests/repository.create.test.ts (3 tests)
 ✓ tests/routes.delete.test.ts (3 tests)
 ✓ tests/client.open.test.ts (4 tests)
 ✓ tests/repository.list.test.ts (2 tests)
 ✓ tests/client.render.test.ts (5 tests)
 ✓ tests/repository.delete.test.ts (2 tests)
 ✓ tests/client.delete.test.ts (4 tests)

 Test Files  11 passed (11)
      Tests  40 passed (40)
```

## Smoke

See `smoke-report.md`. `npm test` exits 0 and the boot-and-curl probe
confirms `GET /` returns 200 HTML and `GET /api/bookmarks` returns
`{"bookmarks":[]}` on a fresh DB. SIGTERM exits cleanly.

## Story coverage

| Story | EARS clause | Test home | Status |
| --- | --- | --- | --- |
| US-001 AC1 | persist + render at top | routes.create + routes.list | pass |
| US-001 AC2 | reject duplicate URL inline | routes.create (409) | pass |
| US-001 AC3 | reject empty/whitespace input | validation, routes.create | pass |
| US-002 AC1 | newest-first on `/` | routes.list, repository.list | pass |
| US-002 AC2 | title + URL per row | client.render, client.open | pass |
| US-002 AC3 | empty state | client.render | pass |
| US-003 AC1 | open in new tab | client.open (target=_blank, rel hardening) | pass |
| US-003 AC2 | original tab preserved | client.open (no JS handler) | pass |
| US-004 AC1 | delete removes from DB + list | repository.delete, routes.delete | pass |
| US-004 AC2 | delete persists across restart | persistence.restart | pass |
| US-005 AC1 | bookmarks survive restart | persistence.restart | pass |
| US-005 AC2 | single SQLite file canonical | persistence.restart (same dbPath) | pass |

## Mutation

Not applicable. `tests.md` declares `Mutation Testing: no`.

## Notes / out-of-scope-edits

`happy-dom` was added as a devDependency to enable DOM-based unit
tests for the delete delegation handler. This is recorded in
`T-004.done.md › out-of-scope-edits` and is the only file-touched
addition outside the per-task `files-likely-touched` lists.
