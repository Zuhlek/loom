---
project: baseline-1779002783-1
phase: build
created: 2026-05-17
---

# Test Report — Bookmarks

## Command

```
cd .loom/baseline-1779002783-1/app && npm test
```

## Result

```
 RUN  v2.1.9
 ✓ tests/db.test.ts (6 tests) 51ms
 ✓ tests/validate.test.ts (8 tests) 4ms
 ✓ tests/api.test.ts (12 tests) 150ms
 ✓ tests/smoke.test.ts (5 tests) 919ms
 ✓ tests/bundle.test.ts (1 test) 486ms
 ✓ tests/web-api.test.ts (9 tests) 10ms
 ✓ tests/render.test.ts (7 tests) 18ms

 Test Files  7 passed (7)
      Tests  48 passed (48)
   Duration  3.03s
```

48 / 48 passed. No skipped, no flaky.

## Coverage by user story

| Story  | Covered by (tests)                                                                    |
|--------|---------------------------------------------------------------------------------------|
| US-001 | `validate.test.ts` (8), `db.test.ts` duplicate (1), `api.test.ts` POST suite (4), `web-api.test.ts` createBookmark (4), `smoke.test.ts` round-trip (1) |
| US-002 | `db.test.ts` ordering (1), `api.test.ts` GET suite (2), `render.test.ts` renderList (4) + renderEmptyState (1), `smoke.test.ts` GET (1) |
| US-003 | `render.test.ts` target/rel attrs (1) + textContent escape (1), `bundle.test.ts` (1), `smoke.test.ts` bundle bytes (1) |
| US-004 | `db.test.ts` delete (2), `api.test.ts` DELETE suite (3), `web-api.test.ts` deleteBookmark (3), `smoke.test.ts` round-trip (1) |

## Typecheck

```
$ npx tsc --noEmit
(no output, exit 0)
```

## Bundle

```
$ npm run build
  public/main.js  4.6kb
  ⚡ Done in 10ms
```
