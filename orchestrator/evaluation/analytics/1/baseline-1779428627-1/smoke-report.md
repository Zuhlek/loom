---
project: baseline-1779428627-1
phase: build
created: 2026-05-22
---

# Smoke Report — baseline-1779428627-1

End-to-end verification of the runnable artifact. Same-origin
Express process started via `node dist/server/index.js` (production
equivalent of `npm start`'s `build && node dist/server/index.js`).

## Build artifacts

| Artifact | Path | Result |
| --- | --- | --- |
| esbuild client bundle | `app/dist/client/main.js` | 7543 bytes (≪ 30 KiB budget) |
| Copied CSS | `app/dist/client/styles.css` | present |
| Server JS | `app/dist/server/*.js` | tsc emits index.js, app.ts, db.ts, errors.ts, routes/, validation.ts |
| SQLite DB | `app/data/bookmarks.db` | created on first run |

## App start

```
$ node dist/server/index.js
Bookmarks listening on http://localhost:3000
```

Bind: `0.0.0.0:3000`. No outbound network calls on startup (confirmed
by reviewing index.ts — only DB + Express, no http(s) client).

## Key endpoints

All called against `http://127.0.0.1:3000`:

| Method | URL | Status | Body / notes |
| --- | --- | --- | --- |
| GET | `/` | 200 | `text/html; charset=UTF-8`; HTML shell with required hook ids |
| GET | `/assets/main.js` | 200 | `application/javascript; charset=UTF-8`; 7543 bytes |
| GET | `/assets/styles.css` | 200 | `text/css; charset=UTF-8`; 2418 bytes |
| GET | `/api/bookmarks` | 200 | `[]` (empty DB) |
| POST | `/api/bookmarks` `{title:"Hello", url:"https://example.com"}` | 201 | `{id:1, title, url, created_at}` |
| GET | `/api/bookmarks` | 200 | `[<created row>]` |
| POST | `/api/bookmarks` (same URL) | 409 | `{code:"duplicate_url"}` |
| POST | `/api/bookmarks` `{title:"", url:"https://example.com"}` | 400 | `{code:"validation_error", field:"title"}` |
| POST | `/api/bookmarks` `{title:"X", url:"ftp://x"}` | 400 | `{code:"validation_error", field:"url"}` |
| DELETE | `/api/bookmarks/abc` | 400 | `{code:"validation_error"}` |
| DELETE | `/api/bookmarks/9999` | 404 | `{code:"not_found"}` |
| DELETE | `/api/bookmarks/1` | 204 | empty body |
| GET | `/api/bookmarks` | 200 | `[]` |

## HTML shell hooks (live response)

`id="bookmark-form"`, `id="bookmark-list"`, `id="bookmark-submit"`,
`id="bookmark-title"`, `id="bookmark-url"`, `id="empty-state"`,
`id="form-error"` all present.

## Shared-state integrity

- Repository UNIQUE constraint enforced (live 409).
- Repository delete returns false → mapped to 404 (live).
- Post-delete GET shows empty list — write went to SQLite, not just
  an in-memory cache.

## UI screenshot

Out of scope for the declared verification environment (`node-test`,
not `headless-browser`). The HTML shell, the bundle, and the API
contract are all verified; the in-browser DOM walkthrough is the
human-gate success criterion declared in `spec.md § What we're
building` and `plan.md § Verification environment`.

## Result

Pass. The deliverable boots cleanly on `http://localhost:3000`,
serves the HTML shell from `public/`, the bundled JS + CSS from
`dist/client/` + `public/` at `/assets`, and the JSON API at
`/api/bookmarks` with the documented status codes for every path.
85/85 vitest specs green. Two typecheck projects (server + client)
exit zero.
