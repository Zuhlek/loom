---
project: baseline-1779002783-2
phase: build
generated: 2026-05-17T09:30:00Z
---

# Smoke report — baseline-1779002783-2

`node-test` capability. No browser dependency. The HTTP API and the
static-shell delivery were probed against a live `npm start` process
listening on `http://localhost:3000`. The restart-persistence check was
covered by `npm run smoke` (T-010's deliverable).

## 1. Build artifacts complete — PASS

`public/` after the production client build contains every static
asset the runtime serves:

| Path                       | Present | Notes                                  |
| -------------------------- | ------- | -------------------------------------- |
| `public/index.html`        | yes     | 754 B — minimal shell + form          |
| `public/styles.css`        | yes     | hand-written CSS                       |
| `public/bundle.js`         | yes     | 21.6 KB esbuild bundle                 |

The esbuild idempotence gate works — `scripts/build-client.mjs` is a
no-op on the second invocation when inputs are unchanged.

## 2. App starts successfully — PASS

`BOOKMARKS_DB=:memory: node --import tsx src/server/index.ts` boots
the Express app and logs `bookmarks listening on http://localhost:3000`
within ~1 s. `SIGINT` produces `received SIGINT, shutting down`
followed by a clean exit. No crash within the first 3 s.

`npm run smoke` boots the server twice (cold + restart) against a temp
SQLite path and passed end-to-end:

```
smoke: PASS
```

## 3. Key endpoints respond — PASS

Live probes against `http://localhost:3000`:

| Probe                                            | Expected            | Actual            | Result |
| ------------------------------------------------ | ------------------- | ----------------- | ------ |
| `GET /api/bookmarks` empty                       | 200, `{bookmarks:[]}` | 200, `{bookmarks:[]}` | PASS |
| `POST /api/bookmarks` valid                      | 201 + bookmark      | 201               | PASS |
| `GET` after create                               | row visible         | row visible       | PASS |
| `POST` duplicate URL                             | 409 duplicate_url   | 409 duplicate_url | PASS |
| `POST` with `url: "ftp://x"`                     | 400 invalid_input url | 400 invalid_input url | PASS |
| `POST` non-JSON Content-Type                     | 415                 | 415               | PASS |
| `DELETE /api/bookmarks/:id` existing             | 204                 | 204               | PASS |
| `DELETE /api/bookmarks/99999`                    | 404 not_found       | 404 not_found     | PASS |
| `GET /` (index.html)                             | 200 HTML            | 200, 754 B        | PASS |
| `GET /bundle.js`                                 | 200 JS              | 200, 22.1 KB      | PASS |

US-005 AC-1 + AC-2 (restart persistence + cold-start file creation)
were verified by `npm run smoke`'s two-spawn cycle against the same
on-disk DB path. The bookmark inserted on the first spawn was still
present after `SIGINT` + respawn.

## 4. Affected UI screens render — SKIPPED (with reason)

The project's verification environment is `node-test`; the plan
explicitly states no `manual-browser-desktop` or `headless-browser`
gate is required. UI behaviours that would otherwise be screenshotted
(empty-state copy, populated list with `target=_blank`+rel attrs, the
form's three error states, and the delete control's 404 message) are
asserted by DOM-level tests under `happy-dom`:

- `tests/unit/client/render.test.ts` — empty state, populated state,
  textContent-only insertion (`<img onerror>` injection produces zero
  `<img>` elements), anchor `target="_blank"` + `rel="noopener
  noreferrer"`, `span.url`, `button[data-id]`.
- `tests/unit/client/form.test.ts` — submit success, 409 duplicate
  error rendering, 400 url/title validation rendering, network failure.
- `tests/unit/client/delete.test.ts` — 204 success path, 404 recovery
  message + re-sync, network failure.

All 17 DOM-layer assertions pass.

## 5. Test runs did not corrupt shared state — PASS

The vitest suite uses `:memory:` SQLite only; no on-disk files are
created by `npm test`. The smoke script uses a `mkdtemp` directory and
deletes it on exit. No pre-existing `bookmarks.sqlite` exists at the
app root after `npm test` + `npm run smoke`.

## Overall

- Checks PASS: 4 (build artifacts, app starts, endpoints respond,
  shared state intact).
- Checks SKIPPED with reason: 1 (UI screens — `node-test` capability
  by plan declaration; happy-dom unit tests cover the behaviour).
- Checks FAIL: 0.
