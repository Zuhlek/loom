# Test report — baseline-1779117992-1

Aggregated verification evidence for the Bookmarks build phase.

## Summary

| Layer | Suite | Tests | Status |
| --- | --- | --- | --- |
| Repo | `tests/repo.test.ts` (Node + in-mem SQLite) | 10 | PASS |
| API | `tests/api.test.ts` (supertest + createApp) | 19 (+1 skipped) | PASS |
| Web | `tests/web.test.ts` (Vitest jsdom + stubbed fetch) | 15 | PASS |
| **Total** | | **44 (+1 skipped)** | **PASS** |
| Smoke | `methods/smoke.md` (build / boot / endpoints / UI / state) | 5 | PASS |
| Mutation | `tests.md: Mutation Testing: no` | — | N/A |

Skipped test: an originally-T-004 api case (`POST persists the row`)
was reframed under T-005 once `GET` was wired to `listBookmarks`. The
T-005 test `POST then GET — newer row is first` carries the assertion.

## Per-task acceptance gates → evidence

### T-001 — Scaffold

| Gate | Evidence | Result |
| --- | --- | --- |
| `npm install` succeeds | 232 packages added | PASS |
| `npm test --passWithNoTests` exits 0 | (see `tasks/T-001.test-log.txt`) | PASS |
| `npx tsc --noEmit` exits 0 | placeholder source ensures tsc has inputs | PASS |

### T-002 — Repo + DB (US-001 AC1/AC2, US-002 AC1/AC3, US-004 AC1/AC2)

| Assertion | Test | Result |
| --- | --- | --- |
| `createBookmark` returns positive id + ISO-8601 created_at | `repo.test.ts` line 22 | PASS |
| `listBookmarks` returns newest-first by `created_at DESC, id DESC` | line 50 + 60 | PASS |
| empty DB → `[]` | line 45 | PASS |
| Duplicate URL → `DuplicateUrlError`; no second row inserted | line 70 + 78 | PASS |
| `deleteBookmark` removes row; `NotFoundError` on missing id | line 89 + 95 + 100 | PASS |

10 tests, all green.

### T-003 — App shell + static + error envelope

| Assertion | Test | Result |
| --- | --- | --- |
| `createApp` returns an Express instance | `api.test.ts` line 18 | PASS |
| `GET /api/bookmarks` → 200 [] (boot smoke) | line 22 | PASS |
| `GET /` → 200 text/html with form | line 31 | PASS |
| `GET /unknown` → 404 envelope | line 40 | PASS |
| Forced-throw → 500 envelope | line 49 | PASS |

5 tests, all green.

### T-004 — Save end-to-end (US-001 AC1/AC2/AC3/AC4)

| Assertion | Test | Result |
| --- | --- | --- |
| `POST` valid → 201 + Bookmark | api line 70 | PASS |
| Duplicate URL → 409 + field=url | api line 80 | PASS |
| Empty title → 400 + field=title | api line 91 | PASS |
| `not-a-url` → 400 + field=url | api line 105 | PASS |
| `ftp://...` → 400 + field=url | api line 115 | PASS |
| PATCH unmounted route → 404 (immutability) | api line 125 | PASS |
| Web form submit fires one POST + prepends row | web line 75 | PASS |
| Empty title → inline error, no POST | web line 107 | PASS |
| Bad URL → inline error, no POST | web line 124 | PASS |
| 409 response → inline url-error, list unchanged | web line 142 | PASS |

10 tests, all green.

### T-005 — List end-to-end (US-002 AC1/AC2/AC3)

| Assertion | Test | Result |
| --- | --- | --- |
| `GET` empty DB → 200 [] | api line 161 | PASS |
| Three rows return newest-first | api line 168 | PASS |
| Ties on `created_at` broken by id DESC | api line 184 | PASS |
| POST then GET — newer is first | api line 197 | PASS |
| `renderList([])` shows empty state + no rows | web line 191 | PASS |
| `renderList(items)` renders in input order | web line 199 | PASS |
| No search/sort/filter controls in DOM | web line 213 | PASS |
| Titles render via `textContent` (XSS-safe) | web line 219 | PASS |
| Initial fetch + render on init() | web line 230 | PASS |

9 tests, all green.

### T-006 — Open in new tab (US-003 AC1/AC2)

| Assertion | Test | Result |
| --- | --- | --- |
| Every row anchor: target=_blank rel="noopener noreferrer" | web line 246 | PASS |
| href preserves tricky URL characters | web line 263 | PASS |
| Source contains no `window.location =`, no router | web line 273 | PASS |

3 tests, all green.

### T-007 — Delete end-to-end (US-004 AC1/AC2/AC3)

| Assertion | Test | Result |
| --- | --- | --- |
| `DELETE` 204 on success; row gone from GET | api line 218 | PASS |
| Missing id → 404 envelope | api line 229 | PASS |
| Non-numeric id → 400 field=id | api line 237 | PASS |
| Click delete fires one DELETE; row removed | web line 297 | PASS |
| 404 on delete → DELETE → GET refetch; list reconciled | web line 333 | PASS |
| No confirmation modal between click and DELETE | web line 369 | PASS |

6 tests, all green.

## Smoke evidence

See `smoke-report.md`. Five checks, all PASS. Headless browser walked
the empty → save → duplicate-error → delete loop; screenshots saved to
`smoke-screenshots/`.

A real bug was caught and fixed during smoke: the bundled IIFE's
`typeof process?.env?.VITEST` threw ReferenceError in the browser
because optional chaining does not protect the leading identifier.
Fixed by guarding behind `typeof process === 'undefined'`. All 44
tests still green after the fix.

## Mutation gate

`tests.md` declares `**Mutation Testing:** no` — same-origin localhost
app with no money / auth / irreversible operations. Mutation gate
intentionally not run.
