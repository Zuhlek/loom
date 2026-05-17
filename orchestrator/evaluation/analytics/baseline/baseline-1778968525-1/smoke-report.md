# Smoke report — baseline-1778968525-1

End-to-end smoke check after build, run from `app/` against a freshly initialised on-disk SQLite database.

## Environment
- Node v25.8.2, npm 11.11.1
- `npm install` produced 196 packages (clean run earlier in build).
- `npm run build` produced `public/app.js` (5.3 KiB) + `public/app.js.map` (10.5 KiB).
- `npm start` boots `node build.mjs && tsx src/server/index.ts`, binds to `http://127.0.0.1:3000`.

## Live probes (server running, fresh DB)

| Probe | Result |
| --- | --- |
| `GET /` | 200, `text/html; charset=UTF-8`, 950 B, contains `<title>Bookmarks</title>` |
| `GET /styles.css` | 200, `text/css; charset=UTF-8`, 2289 B |
| `GET /app.js` | 200, `application/javascript; charset=UTF-8`, 5300 B |
| `GET /api/bookmarks` (empty DB) | 200 `{"bookmarks":[]}` |
| `POST /api/bookmarks {title:"Smoke Example", url:"https://example.com"}` | 201 with `{bookmark:{id:1, title, url, createdAt:"2026-05-16T22:44:44.300Z"}}` |
| `POST /api/bookmarks {title:"Dup", url:"https://example.com"}` | 409 `{error:{code:"DUPLICATE_URL", message:"URL already saved"}}` (existing row preserved) |
| `POST /api/bookmarks {title:"Bad", url:"not a url"}` | 400 `{error:{code:"INVALID_URL", message:"URL must be a syntactically valid URL"}}` |
| `GET /api/bookmarks` (post-insert) | 200 `{bookmarks:[{id:1,...}]}` |
| `DELETE /api/bookmarks/1` | 204 (no body) |
| `DELETE /api/bookmarks/999` | 404 `{error:{code:"NOT_FOUND", message:"Bookmark not found"}}` |
| `GET /api/bookmarks` (post-delete) | 200 `{"bookmarks":[]}` |

## Story-level mapping

- **US-001 (save):** POST returned 201; row appeared in GET list. INVALID_URL and DUPLICATE_URL paths both honoured with the correct error code shapes.
- **US-002 (list newest-first):** Empty state returned `{bookmarks:[]}`; after insert the row appeared with `createdAt` in ISO-8601.
- **US-003 (open in new tab):** Inspecting `public/app.js` (and `dom.test.ts`) shows anchors emit `target="_blank" rel="noopener noreferrer"`; verified in DOM tests.
- **US-004 (delete):** 204 on success, 404 on missing id, list now empty.

## No regressions
- Full Vitest suite: `npm test` -> 8 files, 48 tests passing.
- `npx tsc --noEmit` clean.

## Shutdown
- `pkill -f "tsx src/server/index.ts"` cleanly tore down the server (exit 143 == SIGTERM as expected).
- SQLite file `app/data/bookmarks.sqlite` was created on first boot and remains on disk owned by the workspace.

No browser-level (Puppeteer) check was run; the HTML/CSS/JS are static and were exercised end-to-end via HTTP plus the happy-dom unit tests for the bundle code paths.
