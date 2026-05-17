---
project: baseline-1778963742-1
phase: plan
created: 2026-05-16
---

# Tests — baseline-1778963742-1

**Mutation Testing:** no

Rationale: this is a four-feature local-only toy app. Vitest unit, integration,
and one E2E smoke already exercise every user-facing behaviour and every error
contract documented in `design.md`. The cost of standing up Stryker (or similar)
is not justified at this scope.

## Test layers

| Layer        | Runner                | Lives in                                       | Drives                                                |
| ------------ | --------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Unit         | Vitest                | `app/tests/validation.test.ts`                 | `validateUrl`, `validateTitle`                        |
| Unit         | Vitest                | `app/tests/repo.test.ts`                       | `createBookmarksRepo` against `new Database(':memory:')` |
| Integration  | Vitest + supertest    | `app/tests/api.bookmarks.test.ts`              | `createApp(inMemoryDb)` for all four endpoints + errors |
| E2E smoke    | Vitest + node:http    | `app/tests/e2e.smoke.test.ts`                  | Real server on ephemeral port: save → list → delete   |

## Coverage by acceptance criterion

### US-001 — Save a URL with a title

| AC  | Layer       | Test                                                                                  |
| --- | ----------- | ------------------------------------------------------------------------------------- |
| AC1 | Unit        | `repo.insert({url,title})` returns a row with id, url, title, created_at populated    |
| AC1 | Integration | `POST /api/bookmarks` with `{url,title}` → 201 + body shape `{id,url,title,created_at}` |
| AC2 | Integration | After POST 201, immediate `GET /api/bookmarks` → first array element is the new row  |
| AC2 | E2E         | After POST → GET shows the new row at index 0                                         |
| AC3 | Unit        | `repo.insert` twice with same URL → second call throws `DuplicateUrlError`            |
| AC3 | Integration | Second `POST /api/bookmarks` with same URL → 409 `{error:"duplicate_url"}`            |
| AC3 | Integration | URL normalisation: `https://example.com` and `https://example.com/` collide → 409     |
| AC4 | Unit        | `validateUrl("")` / `validateUrl("not a url")` → `{ok:false, reason:"invalid_url"}`   |
| AC4 | Unit        | `validateTitle("   ")` → `{ok:false, reason:"invalid_title"}`                          |
| AC4 | Integration | `POST` with empty url → 400 `invalid_url`; empty title → 400 `invalid_title`; non-object body → 400 `invalid_body` |

### US-002 — See all saved bookmarks in one list

| AC  | Layer       | Test                                                                                  |
| --- | ----------- | ------------------------------------------------------------------------------------- |
| AC1 | Integration | `GET /api/bookmarks` after N inserts returns N rows                                   |
| AC2 | Unit        | `repo.list()` after two inserts returns newest-first                                  |
| AC2 | Integration | `GET /api/bookmarks` order is `created_at DESC, id DESC` even when two rows share a ms |
| AC3 | Integration | `GET /api/bookmarks` on empty DB returns `[]` (client renders empty-state from this)  |

### US-003 — Open a saved bookmark in a new tab

| AC  | Layer | Test                                                                                                |
| --- | ----- | --------------------------------------------------------------------------------------------------- |
| AC1 | Unit (DOM-ish) | `renderList(bookmarks)` produces `<a target="_blank" rel="noopener noreferrer" href="<url>">` per row |
| AC1 | E2E smoke | Hit `/` → response HTML references `/static/main.js`; the rendered bundle markup is exercised by the unit DOM test above |
| AC2 | (implicit)     | `target="_blank"` semantics are browser-guaranteed; the unit DOM assertion is sufficient            |

### US-004 — Delete a bookmark

| AC  | Layer       | Test                                                                                  |
| --- | ----------- | ------------------------------------------------------------------------------------- |
| AC1 | Unit        | `repo.deleteById(id)` returns `true` and the row is gone from `repo.list()`           |
| AC1 | Integration | `DELETE /api/bookmarks/:id` → 204; subsequent `GET` omits that row                    |
| AC2 | E2E         | Post then delete then list — the deleted row is absent from the list                  |
| AC3 | Unit        | `repo.deleteById(<unknown>)` returns `false`                                          |
| AC3 | Integration | `DELETE /api/bookmarks/9999` → 404 `{error:"not_found"}`; further `GET` still 200    |
| AC3 | Integration | `DELETE /api/bookmarks/abc` → 400 `invalid_id`                                        |

## Conventions

- Each test file builds its own `new Database(':memory:')` and constructs the
  app via `createApp(db)` to keep test isolation explicit.
- HTTP tests use `supertest(app)` and never call `.listen()`.
- The single E2E test in T-005 calls `app.listen(0)` to get an ephemeral port,
  performs round-trips via `node:http`, and closes the server in `afterAll`.
- No real network egress is permitted from any test. Any test that would
  require it must instead be a unit test against the relevant pure function.
