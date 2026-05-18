# Smoke Report — baseline-1779046840-1

Environment: `node-test` (Vitest 2.1.1 + supertest 7.0.0, Node 25.8.2).
Workspace: `.loom/baseline-1779046840-1/app/`.

Gate: `npm install && npm run build && npm test`.

## install

```
added 235 packages, audited 236 packages in 32s
(re-run on already-installed tree: added 1 package, audited 237 in 1s)
```

## build

```
> bookmarks-app@0.1.0 build
> tsc -p tsconfig.server.json && node esbuild.config.mjs

  dist/client/app.js  24.3kb
⚡ Done in 8ms
client bundle written to dist/client
```

Artefacts emitted:
- dist/client/app.js
- dist/client/index.html
- dist/client/styles.css
- dist/server/index.js (+ db.js, routes.js, static.js)

## test

```
 ✓ test/api.test.ts  (12 tests) 51ms
 ✓ test/smoke.test.ts  (3 tests) 919ms
 ✓ test/static.test.ts  (4 tests) 99ms
 ✓ test/db.test.ts  (5 tests) 2ms
 ↓ test/_placeholder.test.ts  (1 skipped)
 ✓ test/client/main-save.test.ts  (5 tests) 59ms
 ✓ test/client/main-delete.test.ts  (5 tests) 41ms
 ✓ test/client/main-list.test.ts  (4 tests) 7ms
 ✓ test/client/dom.test.ts  (6 tests) 4ms
 ✓ test/client/api.test.ts  (6 tests) 4ms
 ✓ test/client/main-open.test.ts  (3 tests) 3ms

 Test Files  10 passed | 1 skipped (11)
      Tests  53 passed | 1 skipped (54)
   Duration  2.46s
```

## verdict

green — all 53 active tests pass, build produces every expected artefact,
end-to-end smoke (POST → GET → POST dup → DELETE → DELETE 404 → GET []) is
exercised against the real `createApp(openDb(tempPath), distClientPath)`.
