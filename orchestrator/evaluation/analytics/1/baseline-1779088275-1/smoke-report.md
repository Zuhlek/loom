---
project: baseline-1779088275-1
phase: build
created: 2026-05-18
updated: 2026-05-18
---

# Smoke Report — baseline-1779088275-1

Coordinator-owned smoke verification. The smoke gates in `tests.md` § "Smoke gates (phase-wide)" are exercised after every Build coordinator pass: the canonical `SMOKE=1 vitest run` in-process smoke spec MUST pass, and the Coordinator additionally probes a live `npm start` for the documented surface contracts.

## Tasks covered

- `T-001` — workspace scaffold + run contracts (smoke evidence in the first pass below).
- `T-002` — list bookmarks end-to-end (US-002). Real `GET /api/bookmarks` replaces the T-001 placeholder 501 router; list-render path is wired client-side.
- `T-003` — save bookmark end-to-end with inline validation + dedupe (US-001). Adds `POST /api/bookmarks`, the `DuplicateUrlError` → 409 mapping, the central 500 error middleware, and the add-form submit pipeline (incl. `showFormError`/`clearFormErrors`).
- `T-004` — open-in-new-tab affordance (US-003). Render-only diff: anchors now carry `target="_blank"` and `rel="noopener noreferrer"`; smoke pass re-confirms the `npm start` / static-asset contracts are untouched.
- `T-005` — delete a bookmark end-to-end with idempotent no-op (US-004). Adds `DELETE /api/bookmarks/:id`, the per-row delete button + event-delegated click handler, and the 204-on-no-row idempotent contract.

## Pass — T-001 (workspace scaffold)

### 1. Build artifacts complete — PASS

- `app/dist/main.js` is produced by the `prestart` esbuild invocation (115 B IIFE bundle).
- `app/public/index.html` ships the `#bookmarks` mount node, the add-form placeholder, and a `<script src="/dist/main.js" defer>` tag.
- `app/public/style.css` is served at `/style.css` (775 B).

### 2. App starts successfully — PASS

- `PORT=3458 npm start` boots inside ~1 s and logs `listening on http://localhost:3458`.
- The child process responds to `SIGTERM` cleanly (`server.close` → `process.exit(0)`; the 5 s force-kill timer is `.unref()`'d).

### 3. Key endpoints respond — PASS

| Probe | Status | Notes |
| --- | --- | --- |
| `GET /` | 200 | HTML body contains `id="bookmarks"`. |
| `GET /style.css` | 200 | 775 B; served by `express.static('public')`. |
| `GET /dist/main.js` | 200 | 115 B; `application/javascript`; served by `app.use('/dist', express.static('dist'))`. |
| `GET /api/bookmarks` | 501 | Placeholder router returned the documented `NOT_IMPLEMENTED` JSON shape — replaced wholesale in `T-002`. |

### 4. Affected UI screens render — SKIPPED (no UI feature yet)

`T-001` carries no `satisfies-stories` payload. The DOM exposes an empty `<ul id="bookmarks">` and an empty `<form id="add-form">` as wiring placeholders; there is no rendered user-visible feature to screenshot.

### 5. Test runs did not corrupt shared state — PASS

- No `data/` directory and no `*.db` file existed after the full test + smoke run (T-001's `db.ts` was a throwing stub, so `npm start` never opened a connection).
- The Vitest smoke spec (`tests/smoke/run.test.ts`) asserts the same invariant in-process.

## Pass — T-002 (list bookmarks end-to-end)

### 1. Build artifacts complete — PASS

- `app/dist/main.js` rebuilt by `prestart` esbuild (2136 B IIFE; grew from 115 B in T-001 because `main.ts` now wires `refresh()`, `fetchBookmarks`, and the render branch).
- `app/public/index.html` unchanged from T-001 (`#bookmarks` + `#add-form` mount nodes already in place; T-002 needed no markup changes).
- `app/public/style.css` 1259 B (grew from 775 B; T-002 added `.bookmark`, `.bookmark-title`, `.bookmark-url`, `.empty-state` rules).

### 2. App starts successfully — PASS

- `PORT=3459 npm start` boots cleanly and serves all probes below.
- `SIGTERM` shuts the server down via the graceful-shutdown path landed in T-001 (unchanged in T-002).

### 3. Key endpoints respond — PASS

| Probe | Status | Notes |
| --- | --- | --- |
| `GET /` | 200 | 421 B HTML body contains `id="bookmarks"`. |
| `GET /style.css` | 200 | 1259 B; updated stylesheet served. |
| `GET /dist/main.js` | 200 | 2136 B; bundled `main.ts` + `api.ts` + `render.ts` IIFE. |
| `GET /api/bookmarks` | 200 | `{"bookmarks":[]}` — real `createRouter(createRepo(createDb()))` mount; the T-001 placeholder 501 is gone. |

### 4. Affected UI screens render — PASS (asserted by happy-dom unit specs)

`T-002` is the first task with a `satisfies-stories` payload (US-002). The list/empty-state render is exercised by `tests/unit/render.test.ts` under `// @vitest-environment happy-dom`:

- `renderEmptyState` after `renderList(parent, [])` produces zero `<li>` rows and one `<p class="empty-state">` node.
- `renderList(parent, [b1, b2])` produces one `<li class="bookmark">` per bookmark with the title text in an `<a>` and the URL in a `<span>`; the anchor's `href` equals the bookmark URL.

The `node-test` harness intentionally does not simulate a real browser (`plan.md` § Verification environment); the happy-dom DOM assertions are the strongest proof the harness can produce.

### 5. Test runs did not corrupt shared state — PASS

- The in-process Vitest run (including `SMOKE=1`) creates no `data/` directory or `*.db` file — the smoke spec (`tests/smoke/run.test.ts`) asserts this invariant explicitly and passed.
- A live `npm start` probe does naturally create `app/data/bookmarks.db` because the production `createDb()` factory now resolves to the on-disk default path; that is the documented production behavior (design § Storage). The Coordinator removed `app/data/` after the live-boot probe so subsequent runs start clean.

## Pass — T-003 (save bookmark end-to-end with inline validation + dedupe)

### 1. Build artifacts complete — PASS

- `app/dist/main.js` rebuilt by `prestart` esbuild (5109 B IIFE; grew from 2136 B in T-002 because `main.ts` now wires the `#add-form` submit handler, the input-event error-clear pipeline, and `api.ts` now exports `createBookmark`).
- `app/public/index.html` now ships title + url inputs + submit button inside the previously-empty `<form id="add-form">` (the surrounding markup and mount IDs were already in place from T-001).
- `app/public/style.css` 1422 B (grew from 1259 B; T-003 added the `.form-error` rule and its dark-mode variant inside the existing `prefers-color-scheme: dark` block — no toggle, per the no-dark-mode-toggle constraint).

### 2. App starts successfully — PASS

- `PORT=3460 npm start` boots cleanly and logs `listening on http://localhost:3460`. esbuild rebuilds the bundle on `prestart` (5.0 KB output, ~1 ms).
- `SIGTERM` shuts the server down via the graceful-shutdown path landed in T-001 (exit status 143 = 128 + 15; no error output).

### 3. Key endpoints respond — PASS

| Probe | Status | Notes |
| --- | --- | --- |
| `GET /` | 200 | 738 B HTML body contains `id="bookmarks"`. |
| `GET /style.css` | 200 | 1422 B; updated stylesheet served. |
| `GET /dist/main.js` | 200 | 5109 B; bundled `main.ts` + `api.ts` + `render.ts` IIFE. |
| `GET /api/bookmarks` | 200 | `{"bookmarks":[]}` — same router as T-002. |
| `POST /api/bookmarks` happy-path | 201 | Body `{"title":"Hello","url":"http://example.com/"}` → `{"bookmark":{"id":1,"title":"Hello","url":"http://example.com/","created_at":"<ISO>"}}`. |
| `POST /api/bookmarks` duplicate URL | 409 | `{"error":{"code":"DUPLICATE_URL","field":"url","message":"This URL is already saved"}}`. |
| `POST /api/bookmarks` whitespace title | 400 | `{"error":{"code":"INVALID_TITLE","field":"title","message":"Title is required"}}`. |
| `POST /api/bookmarks` `javascript:` URL | 400 | `{"error":{"code":"INVALID_URL","field":"url","message":"Enter a valid http:// or https:// URL"}}`. |

All four error shapes match the envelope pinned in `decisions.md` and the EARS clauses in `spec.md`.

### 4. Affected UI screens render — PASS (asserted by happy-dom unit specs)

`T-003` satisfies `US-001` (save end-to-end with inline validation + dedupe). The form-error render seam is exercised by `tests/unit/render.test.ts` under `// @vitest-environment happy-dom`:

- `showFormError(form, "title", "Title is required")` inserts a `[data-error-for="title"]` node immediately after the `[name="title"]` input with the message text.
- A second `showFormError` call for the same field replaces the prior node (no duplicates).
- `clearFormErrors(form)` removes every `[data-error-for]` node.

The form-submit pipeline (`createBookmark` → success: `form.reset()` + `refresh()`; ApiError: `showFormError`; input event: clears the field's error) is exercised by `tests/http/bookmarks.test.ts` (end-to-end through the in-process Express app via supertest) and `tests/client/api.test.ts` (mocked `fetch` → 409 envelope maps to `ApiError{status:409, code:"DUPLICATE_URL", field:"url"}`; fetch rejection maps to `ApiError{status:0, code:"NETWORK"}`).

### 5. Test runs did not corrupt shared state — PASS

- The in-process Vitest run (including `SMOKE=1`) creates no `data/` directory or `*.db` file — the smoke spec (`tests/smoke/run.test.ts`) asserts this invariant explicitly and passed.
- The live `PORT=3460 npm start` probe naturally created `app/data/bookmarks.db` (the production on-disk path, same as the T-002 probe). The Coordinator removed `app/data/` after the probe so subsequent runs start clean.

## Pass — T-004 (open-in-new-tab affordance — US-003)

### 1. Build artifacts complete — PASS

- No bundle change required; T-004's diff is render-attribute-only inside `src/client/render.ts`. The existing `prestart` esbuild pipeline still produces `app/dist/main.js` unchanged in shape (it does not call into the modified render path until the runtime mounts the list, which the `SMOKE=1` boot spec exercises).

### 2. Type-check + unit suite — PASS

- `npm test` (`tsc --noEmit` then `vitest run`): tsc clean, 31 passed / 2 skipped (the 2 skipped are the `SMOKE=1` boot specs).

### 3. Smoke spec — PASS

- `SMOKE=1 vitest run`: 33 passed / 0 skipped. The boot-the-server spec confirms `npm start` is still green; the in-process invariant spec confirms no `data/` is created under the project root.

### 4. Anchor attribute regression — covered by unit tests

- `tests/unit/render.test.ts` adds four explicit assertions (`href` equals URL, `target === "_blank"`, `rel === "noopener noreferrer"`, default-tabbable anchor) inside the `renderList (new-tab affordance — US-003)` describe block. All pass in the green phase.

### 5. Test runs did not corrupt shared state — PASS

- `SMOKE=1 vitest run` naturally created `app/data/bookmarks.db` via the boot probe (the production on-disk path). The Coordinator removed `app/data/` after the run so subsequent attempts start clean.

## Pass — T-005 (delete a bookmark end-to-end with idempotent no-op — US-004)

### 1. Build artifacts complete — PASS

- `app/dist/main.js` rebuilt by `prestart` esbuild (7.5 KB IIFE; grew from the T-003 ~5.1 KB baseline because `main.ts` now wires the event-delegated delete handler + list-notice swap and `api.ts` exports `deleteBookmark`).
- `app/public/index.html` unchanged from T-003 (`#bookmarks` mount and `#add-form` were already in place; T-005 needed no markup changes).
- `app/public/style.css` unchanged in shape from T-003 (the delete button reuses the existing `.bookmark*` rule family).

### 2. App starts successfully — PASS

- `PORT=3461 npm start` boots cleanly and logs `listening on http://localhost:3461`. esbuild rebuilds the bundle on `prestart` (7.5 KB output, ~1 ms).
- `SIGTERM` shuts the server down via the graceful-shutdown path landed in T-001.

### 3. Key endpoints respond — PASS

| Probe | Status | Notes |
| --- | --- | --- |
| `GET /` | 200 | HTML body contains `id="bookmarks"`. |
| `GET /style.css` | 200 | unchanged from T-003 (1422 B). |
| `GET /dist/main.js` | 200 | 7.5 KB; bundled `main.ts` + `api.ts` + `render.ts` IIFE. |
| `POST /api/bookmarks` (seed) | 201 | Seeded `{"id":1,"title":"X","url":"http://example.com/x", …}`. |
| `GET /api/bookmarks` (pre-delete) | 200 | List includes the seeded row. |
| `DELETE /api/bookmarks/1` (exists) | 204 | AC-1: row removed. |
| `DELETE /api/bookmarks/1` (re-delete same id) | 204 | AC-3: idempotent no-op success. |
| `DELETE /api/bookmarks/9999` (never existed) | 204 | AC-3: idempotent no-op success. |
| `DELETE /api/bookmarks/abc` | 400 | `{"error":{"code":"INVALID_ID", …}}`. |
| `DELETE /api/bookmarks/-1` | 400 | `{"error":{"code":"INVALID_ID", …}}`. |
| `GET /api/bookmarks` (post-delete) | 200 | `{"bookmarks":[]}` — row excluded after delete. |

All shapes match the envelope pinned in `decisions.md`. The 204-on-no-row contract (AC-3, the load-bearing part of US-004) is verified for both the "row already deleted" and "row never existed" branches — there is no 404 path, per the task notes.

### 4. Affected UI screens render — PASS (asserted by happy-dom unit specs)

`T-005` satisfies `US-004` (delete a bookmark end-to-end). The per-row delete control is exercised by `tests/unit/render.test.ts` under `// @vitest-environment happy-dom`:

- Each `<li>` carries a `<button data-bookmark-id="<id>">` matching the row id.
- The button has an accessible label (`aria-label="Delete bookmark"` and visible "Delete" text).
- The button is initially enabled (`disabled === false`); toggling `disabled` does not throw and preserves the `data-bookmark-id` attribute.

The delete pipeline (`deleteBookmark` → success: `refresh()`; ApiError: re-enable + list notice) is exercised by `tests/http/bookmarks.test.ts` (in-process Express via supertest) and `tests/client/api.test.ts` (mocked `fetch` → 204 resolves, 400 envelope maps to `ApiError{status:400, code:"INVALID_ID"}`, fetch rejection maps to `ApiError{status:0, code:"NETWORK"}`).

### 5. Test runs did not corrupt shared state — PASS

- The in-process Vitest run (including `SMOKE=1`) creates no `data/` directory or `*.db` file — the smoke spec (`tests/smoke/run.test.ts`) asserts this invariant explicitly and passed.
- The live `PORT=3461 npm start` probe naturally created `app/data/bookmarks.db` (production on-disk path). The Coordinator removed `app/data/` after the probe so subsequent runs start clean.

## Phase-wide results

| Gate | T-001 | T-002 | T-003 | T-004 | T-005 |
| --- | --- | --- | --- | --- | --- |
| `npm install` | PASS | PASS (no new deps) | PASS (no new deps) | PASS (no new deps) | PASS (no new deps) |
| `tsc --noEmit` | PASS | PASS | PASS | PASS | PASS |
| `vitest run` (default) | PASS (1/1 + 2 skipped) | PASS (7/7 + 2 skipped) | PASS (27/27 + 2 skipped) | PASS (31/31 + 2 skipped) | PASS (45/45 + 2 skipped) |
| `SMOKE=1 vitest run` | PASS (3/3) | PASS (9/9) | PASS (29/29) | PASS (33/33) | PASS (47/47) |
| Live `npm start` probe | PASS (4 endpoints) | PASS (4 endpoints) | PASS (8 endpoints incl. POST happy / dup / invalid-title / invalid-url) | not re-run (T-004 is render-only; the in-process `SMOKE=1` boot spec re-asserts the static + mount-node contract) | PASS (11 endpoints incl. DELETE existing / re-delete / never-existed / invalid-id / negative-id) |
| No stray `data/` in project root or `app/` | PASS | PASS (in-process tests); production DB path cleaned post-probe | PASS (in-process tests); production DB path cleaned post-probe | PASS (`SMOKE=1` boot left `app/data/bookmarks.db`; Coordinator removed it) | PASS (live probe DB path cleaned post-probe) |

## Result

`T-001`, `T-002`, `T-003`, `T-004`, and `T-005` all pass every applicable smoke gate. The Coordinator promotes `T-005` from `In Progress` through `Review` to `Done`. Every active user story (`US-001`..`US-004`) is now satisfied end-to-end; the board has no remaining `Backlog` or `In Progress` cards. Build phase complete.
