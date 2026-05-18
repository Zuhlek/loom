# Smoke report — baseline-1779117992-1

Whole-project verification per `methods/smoke.md`. Project type:
`node-test` (runnable HTTP service + static web shell).

### Build artifacts complete
**Result:** PASS
**Reason:** `npm run build` produces both `dist/server.js` (server-side TS
compiled via tsconfig.build.json) and `public/bundle.js` (web client
bundled via esbuild IIFE target). `src/web/index.html` and
`src/web/styles.css` are not copied to `dist/` — by design, `app.ts`
mounts the source-tree `src/web/` and the build-output `public/` as
static dirs, with a path-resolver that adapts whether the module loads
from `src/` (vitest) or `dist/` (npm start).
**Evidence:**
```
public/bundle.js       6.4kb
public/bundle.js.map  14.1kb
dist/{app,db,server}.js + dist/repo/, dist/routes/, dist/shared/
```

### App starts successfully
**Result:** PASS
**Reason:** `PORT=3140 DB_PATH=:memory: node dist/server.js` logs
"Bookmarks listening on http://localhost:3140" and a TCP listener
appears on the port. No EADDRINUSE, no migration error.
**Evidence:**
```
$ cat /tmp/smoke-boot4.log
Bookmarks listening on http://localhost:3140

$ lsof -i :3140
node  PID  user  12u  IPv6 ... TCP *:3140 (LISTEN)
```

### Key changed endpoints respond
**Result:** PASS
**Reason:** Curled every behaviour endpoint against a fresh in-memory
DB. Every response matches the design.md contract: status code,
Content-Type, and JSON body shape including the error envelope
discriminator `field`. Static assets `GET /`, `GET /styles.css`, and
`GET /bundle.js` all serve with the correct Content-Type. The
catch-all returns `404 not_found`.
**Evidence:**
```
GET  /                          → 200 text/html (<!doctype html>...)
GET  /styles.css                → 200 text/css
GET  /bundle.js                 → 200 application/javascript (6625 bytes)
GET  /api/bookmarks             → 200 []
POST /api/bookmarks (valid)     → 201 { id, title, url, created_at }
POST /api/bookmarks (duplicate) → 409 error.code=duplicate_url field=url
POST /api/bookmarks (empty title) → 400 error.code=invalid_input field=title
GET  /api/bookmarks (after POST)→ 200 [<the new row>]
DEL  /api/bookmarks/1           → 204 (empty body)
DEL  /api/bookmarks/999         → 404 error.code=not_found
DEL  /api/bookmarks/abc         → 400 error.code=invalid_input field=id
GET  /not-a-real-path           → 404 error.code=not_found
```

### Affected UI screens render
**Result:** PASS
**Reason:** Headless Chrome via puppeteer loaded the app and exercised
US-001 (save), US-002 (list + empty state), US-003 (open in new tab
anchor attributes), and US-004 (delete + state reconciliation).
Screenshots saved to `smoke-screenshots/`. The save flow visibly
prepends a row whose `<a target=_blank rel="noopener noreferrer">`
contains the bookmark title. A duplicate POST renders the inline URL
error and leaves the list intact. Clicking delete removes the row
and shows the empty state.

Smoke caught a real bug during this step: the initial bundle's
test-environment gate read `typeof process?.env?.VITEST`, which in
strict mode throws `ReferenceError: process is not defined` when
`process` is an undeclared global (i.e. the browser). The init() path
never ran, so the empty-state never rendered. Fixed by guarding the
`process.env` access with a leading `typeof process === 'undefined'`
short-circuit; tests still pass and the bundle now runs cleanly in the
browser. The fix is in `src/web/main.ts`.
**Evidence:**
```
.loom/baseline-1779117992-1/smoke-screenshots/empty-state.png
.loom/baseline-1779117992-1/smoke-screenshots/save-and-list.png
.loom/baseline-1779117992-1/smoke-screenshots/duplicate-error.png
.loom/baseline-1779117992-1/smoke-screenshots/after-delete.png
```

### Test runs did not corrupt shared state
**Result:** PASS
**Reason:** All Vitest suites open `better-sqlite3` with `:memory:`
(see `vitest.config.ts` env match + per-test `openDb(':memory:')`).
The on-disk `./bookmarks.sqlite` is gitignored and not created by any
test path. No environment files or fixtures were modified.
**Evidence:**
```
$ grep -n ":memory:" tests/*.test.ts
tests/api.test.ts:  function freshDb(): DatabaseType { return openDb(':memory:'); }
tests/repo.test.ts: function freshDb(): DatabaseType { return openDb(':memory:'); }
$ ls bookmarks.sqlite* 2>&1
ls: bookmarks.sqlite*: No such file or directory
```

## Outcome

All checks PASS. Promote all seven task cards from `Review` to `Done`.
