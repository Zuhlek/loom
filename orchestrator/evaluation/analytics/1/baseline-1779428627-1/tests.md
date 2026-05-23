---
project: baseline-1779428627-1
phase: plan
created: 2026-05-22
---

# Tests — baseline-1779428627-1

**Mutation Testing:** no

This is a single-user laptop app with no money, no security boundary, no
irreversible operations, and no shared state. The UNIQUE constraint and
the validation rules are the only places a silent bug would corrupt
behaviour, and they're directly asserted by behaviour-level Vitest
specs. Mutation testing's cost (Stryker dependency, minutes-long runs)
does not pay back at this scope.

## Harness

- **Runner:** Vitest, declared in `app/package.json` `scripts.test`.
- **Server specs:** Vitest + an in-memory SQLite database
  (`new Database(':memory:')`) constructed per test via `openDatabase`.
  HTTP assertions go through the `createApp(repo)` factory using
  `supertest` (or `fetch` against a server bound to an ephemeral port —
  Build chooses, but the assertion surface is the same).
- **Client specs:** Vitest with the default `jsdom` environment for
  `render.ts`, `validation.ts`, and `api.ts` (the latter exercised
  against a `vi.fn()`-stubbed `fetch`).
- **Smoke gate:** one spec boots `createApp` against an in-memory DB on
  an ephemeral port and round-trips `POST /api/bookmarks` →
  `GET /api/bookmarks` via `fetch`.

## Phase-wide gates

| Gate | What passes it |
| --- | --- |
| `npm test` exits zero | All Vitest specs across server and client suites green. |
| Smoke | One spec proves the wired Express app accepts a POST and lists the result via the same process. |
| Lint/typecheck | `tsc --noEmit` for `tsconfig.json` and `tsconfig.client.json` exit zero (declared in T-001). |

## Story-level acceptance

Each story's EARS clauses from `spec.md` translate to behaviour specs
under the listed task. Specs live in `app/test/server/` or
`app/test/client/`.

### US-001 Save a Bookmark With a Title

Owned by T-004 (server side) and T-007 (client side).

- `POST /api/bookmarks` with valid title + URL persists a row and
  returns `201` with server-assigned `id` and `created_at`. (AC1)
- The created row is visible at the head of `GET /api/bookmarks`
  immediately. (AC2)
- A second `POST` with a URL already in storage returns `409`
  `duplicate_url` and does not mutate the table. (AC3)
- Empty title or non-`http(s)` URL returns `400` `validation_error` with
  the offending `field` set. (AC4)
- Client form, on submitting valid input, prepends the new row to
  `#bookmark-list` without a full page reload. (AC2)
- Client form, on `409`, renders the duplicate message in `#form-error`
  and leaves inputs intact. (AC3)
- Client form, on local validation failure (empty title or bad URL),
  shows the inline error without making the request. (AC4)

### US-002 View All Saved Bookmarks

Owned by T-004 (server), T-005 (DOM shell), T-006 (client render).

- `GET /api/bookmarks` returns rows ordered `created_at DESC, id DESC`.
  (AC1)
- Each rendered `<li>` exposes the bookmark title as the link text and
  shows the URL on a secondary line. (AC2)
- When the list is empty, `#empty-state` is visible and
  `#bookmark-list` is empty. When the list is non-empty, `#empty-state`
  is hidden. (AC3)

### US-003 Open a Bookmark in a New Tab

Owned by T-005 (HTML shell template) and T-006 (rendered rows).

- Every rendered bookmark link has `target="_blank"`. (AC1)
- Every rendered bookmark link has `rel="noopener noreferrer"`. (AC2)

### US-004 Delete a Bookmark

Owned by T-004 (server) and T-008 (client).

- `DELETE /api/bookmarks/:id` removes the row from SQLite and returns
  `204`. (AC1)
- `DELETE /api/bookmarks/:id` for an unknown id returns `404`
  `not_found` and leaves the table unchanged. (AC3)
- Client delete control removes the `<li data-id="...">` from
  `#bookmark-list` after the server responds `204`. (AC2)
- Client delete treats a `404` response as if it had succeeded (the row
  is already gone) and still removes the local `<li>`. (Aligns the
  client with eventual server truth; design § Row state.)

## Coverage assertion

Every `US-NNN` story above maps to at least one behaviour-level spec
owned by an explicit task. No story is left without an executable
assertion.
