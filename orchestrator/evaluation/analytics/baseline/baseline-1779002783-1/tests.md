**Mutation Testing:** no

This is a tiny local single-user CRUD app — no security boundary, no
money, no irreversible operations beyond a single-user delete. Mutation
testing cost is not justified. Vitest line/branch coverage of the
behaviours below is sufficient.

---

# Tests — Bookmarks

## Verification environment

`node-test` (Vitest run from `./app/`). All tests are autonomous;
Build executes them without human input.

## Layout

```
./app/tests/
├── validate.test.ts   # pure-function unit tests for src/server/validate.ts
├── db.test.ts         # persistence tests against :memory: + one file round-trip
└── api.test.ts        # HTTP-level tests via supertest against buildApp(memDb)
```

A single optional smoke test in `tests/smoke.test.ts` boots the file-backed
process (`spawn('node', ['--import', 'tsx', 'src/server/index.ts'])`),
waits for the listener, curls `GET /api/bookmarks`, asserts 200 + `[]`,
then kills the process. This stays cheap because it is one round trip
on loopback. A DOM-level test is intentionally skipped — the spec
forbids a frontend framework and the rendering surface (one list,
one form, one error slot) is exercised end-to-end by `api.test.ts`
plus the manual contract that `target="_blank" rel="noopener noreferrer"`
is set by `render.ts` (asserted in unit-shaped tests inside the bundle
build step if cheap; otherwise verified by review of `render.ts`).

## EARS-derived behaviour matrix

Each acceptance criterion gets at least one Vitest assertion.

### US-001 — Save a URL with a title

| AC clause                                          | Test                                                                                      | File                  |
|----------------------------------------------------|-------------------------------------------------------------------------------------------|-----------------------|
| Valid title + valid URL → 2xx + row persisted      | `POST /api/bookmarks` with `{url, title}` → 201, body matches, `listAll()` returns it     | api.test.ts           |
| Duplicate URL → 4xx + no new row + inline error    | Two POSTs same url → second is 409 `{error:"duplicate", ...}`; `listAll().length === 1`   | api.test.ts           |
| Empty / invalid URL → 4xx + no row                 | POST with `url:""`, `url:"not-a-url"`, `url:"javascript:alert(1)"` → 400; `listAll()==[]` | api.test.ts, validate.test.ts |
| Empty title → 4xx + no row                         | POST with `title:""`, `title:"   "` → 400; `listAll()==[]`                                | api.test.ts, validate.test.ts |

### US-002 — View all saved bookmarks

| AC clause                                  | Test                                                                          | File         |
|--------------------------------------------|-------------------------------------------------------------------------------|--------------|
| All persisted bookmarks rendered           | `GET /api/bookmarks` after inserting N rows → array length N, contents match  | api.test.ts  |
| ORDER BY created_at DESC, id DESC          | Insert three rows, GET returns newest-first; same-ms inserts disambiguated by id DESC | db.test.ts   |
| Empty table → empty-state message          | `GET /api/bookmarks` on fresh DB → 200 `[]`; `renderEmptyState` writes the empty-state copy to root | api.test.ts, render covered by visual inspection in T-009 |

### US-003 — Open a saved bookmark in a new tab

| AC clause                                                    | Test                                                                       | File         |
|--------------------------------------------------------------|----------------------------------------------------------------------------|--------------|
| Anchor renders with `target="_blank" rel="noopener noreferrer"` | `render.ts` unit test (jsdom or DOMParser stub) over `renderList`        | render covered by T-009; assertion: bundle output contains `target="_blank"` and `rel="noopener noreferrer"` for each anchor |

### US-004 — Delete a bookmark

| AC clause                                          | Test                                                                                      | File         |
|----------------------------------------------------|-------------------------------------------------------------------------------------------|--------------|
| Delete control removes row + 2xx                   | Insert row, `DELETE /api/bookmarks/:id` → 204; `listAll()` no longer contains it          | api.test.ts  |
| Missing id → 4xx + table unchanged                 | `DELETE /api/bookmarks/999` on empty DB → 404; `listAll()` unchanged                      | api.test.ts  |

## Persistence durability (cross-cutting)

| Claim                                  | Test                                                                                          | File        |
|----------------------------------------|-----------------------------------------------------------------------------------------------|-------------|
| Survives restarts (US-001 acceptance)  | Open file-backed DB in tmpdir, insert, `close()`, reopen same path, `listAll()` returns row   | db.test.ts  |

## Validation unit coverage (T-003)

`validate.test.ts` exercises `validateBookmarkInput` directly:

- title: empty, whitespace-only, length > 500, length == 500 (boundary)
- url: empty, syntactically invalid, `javascript:` scheme, `ftp:` scheme,
  valid `http:`, valid `https:`, valid with path/query/fragment
- Trim semantics: leading/trailing whitespace stripped from title;
  canonical URL stored

## What we explicitly do NOT test (out of scope per spec)

- Tag/category behaviour (Q01 = flat list)
- Search/filter (Q03 = no search)
- Edit (Q04 = immutable)
- Alternate sort orders (Q05 = newest-first only)
- Auth, multi-user, CORS, telemetry, service worker, PWA
- Performance benchmarks beyond the O(thousands) envelope
