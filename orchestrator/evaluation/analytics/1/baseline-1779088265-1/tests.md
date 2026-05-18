---
project: baseline-1779088265-1
phase: plan
created: 2026-05-18
---

# Tests — baseline-1779088265-1

**Mutation Testing:** no

Rationale: this is a local, single-user, no-auth bookmarks app. No money, no security boundary, no irreversible operation, no data-integrity surface beyond a single `UNIQUE(url)` constraint. The bug-impact of a subtle logic mutation is "I lost a bookmark on my laptop" — not justified mutation cost. Tests live at the behaviour level and rely on the assertions called out per task.

## Verification environment

`node-test` (Vitest). Server-side tests use `supertest` against the exported `createApp` factory wired to an in-memory `better-sqlite3` (`:memory:`). Client-side tests run under Vitest's `jsdom` environment. A `cli-shell` smoke gate boots the real server with `npm start` and asserts `GET /api/bookmarks` returns `200`.

## Strategy

Three test surfaces, all under `./app/test/`:

1. **Repo tests** (`test/repo.test.ts`) — drive `bookmarks-repo.ts` directly against in-memory SQLite. Assert insert / list / delete behaviour, ordering, and that `DuplicateUrlError` is thrown on URL collisions.
2. **HTTP tests** (`test/routes.test.ts`) — drive the app factory via `supertest`. Assert status codes, body shapes, error envelope, idempotent DELETE, and `400` on malformed input.
3. **Client tests** (`test/client-render.test.ts` + `test/client-form.test.ts`) — drive `render.ts` and `form.ts` under jsdom with stubbed `api.ts`. Assert DOM shape (anchor attrs, empty state), form state transitions, and error display.

Each task file carries a behaviour-level test sketch derived from its `satisfies-stories` EARS clauses. The phase-wide acceptance gates below are the ones Build executes before flipping a task into `Review`.

## Smoke gate (explicit)

After T-008 is in `Review`, Build runs the following from `.loom/baseline-1779088265-1/app/`:

1. `npm install` (clean) — exits `0`.
2. `npm test` — exits `0`; every Vitest file above passes.
3. `npm start &` — background; wait for port `:3000` to accept TCP.
4. `curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/` — `200`.
5. `curl -sS http://localhost:3000/api/bookmarks` — JSON `{"bookmarks": []}` on a fresh `data/` directory.
6. `curl -sS -X POST -H 'content-type: application/json' --data '{"url":"https://example.com","title":"Example"}' http://localhost:3000/api/bookmarks` — `201` + body containing the new bookmark.
7. Kill the background server.
8. Assert no files were written outside `.loom/baseline-1779088265-1/app/` (compare `git status` against allowlist).

If any step fails, T-008 returns to `Backlog` with the failure reason; the offending upstream task is re-opened.

## Mutation gate (explicit)

Skipped — see `Mutation Testing: no` above.

## Per-story acceptance gates

Each story's gate is the conjunction of its EARS clauses. A task is `Done` when its `satisfies-stories` clauses all pass under the relevant test surface.

### US-001 — Save

- AC1 (happy path): HTTP `POST /api/bookmarks` with valid `{url, title}` → `201` + body; subsequent `GET /api/bookmarks` includes the new bookmark.
- AC2 (validation): missing / empty url, missing / empty title, or a string that `new URL(...)` rejects → `400` with `{error: {code: 'VALIDATION', ...}}`; no row in SQLite.
- AC3 (duplicate): a second `POST` with the same URL → `409` with `{error: {code: 'DUPLICATE_URL', ...}}`; the original row is unchanged.
- AC4 (timestamp): inserted row's `created_at` is a positive integer within ±2s of `Date.now()` at insert time.
- Client gate: `form.ts` transitions `idle → submitting → idle` on `201` and `idle → submitting → error` on `400`/`409`, with the inline error text reflecting the server `message`.

### US-002 — List newest-first

- AC1 (order): insert three rows with controlled `created_at`; `GET /api/bookmarks` returns them in descending `created_at` order; same-ms ties break by descending `id`.
- AC2 (fields): each list entry exposes `title` and `url`.
- AC3 (empty state): on an empty DB, the client renders the empty-state message, not an empty `<ul>`.

### US-003 — Open in new tab

- Each rendered bookmark is an `<a>` whose `href` equals the bookmark URL, whose `target === "_blank"`, and whose `rel` is exactly `noopener noreferrer`.

### US-004 — Delete

- AC1 (happy path): `DELETE /api/bookmarks/:id` returns `204`; the next `GET /api/bookmarks` omits the deleted row; clicking the delete control re-fetches and re-renders the list without the row.
- AC2 (re-add): after delete, `POST` of the same URL → `201` (no `DUPLICATE_URL`).
- AC3 (idempotent): `DELETE` of a missing id → `204`; remaining rows unchanged; no thrown error.
- Negative: `DELETE /api/bookmarks/not-an-int` → `400` `{error: {code: 'BAD_ID', ...}}`.

## Cross-cutting non-functional gates

- **No-`innerHTML` rule:** a static grep over `src/client/**/*.ts` must find zero `innerHTML` writes. Enforced as a `vitest` test that reads the source files and asserts the regex `\binnerHTML\s*=` returns no matches.
- **Workspace isolation:** during `npm test` and `npm start`, no file outside `./app/` is created or modified.
- **TypeScript strict:** `tsc --noEmit` exits `0` for both `tsconfig.json` and `tsconfig.client.json`.
