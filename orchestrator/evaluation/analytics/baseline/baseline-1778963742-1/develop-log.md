---
project: baseline-1778963742-1
phase: build
created: 2026-05-16
---

# Develop log — baseline-1778963742-1

## Run-level notes

- **Coordinator strategy.** Tasks executed inline by the Build Coordinator (eval-mode allowance; subagent nesting kept shallow). Lock → Red → Implement → Green → Done preserved per task.
- **Runtime.** `node v25.8.2` / `npm 11.11.1`. `npm install` took ~39s; `better-sqlite3` native build succeeded out of the box (no prebuild-from-source fallback needed).
- **Port choice for smoke.** `PORT=3001` to avoid collisions with adjacent baseline runs (the workspace defaults to 3000 only when the env var is unset).

## Per-task journal

### T-001 — tooling
- Scope: `package.json`, both tsconfigs, vitest config, `.gitignore`.
- Added `happy-dom` to devDeps proactively (anticipated by T-004 amendment note).
- `npm install` clean; `npm test` exit 0 via `passWithNoTests: true`.

### T-002 — db + repo + validation
- Implemented synchronous `better-sqlite3` repo; `Date.now()` for `created_at`.
- URL normalisation via `new URL(input.url).toString()` per ADR-009.
- DuplicateUrlError translation by regex-matching `UNIQUE constraint failed`.
- All 14 tests green on first impl pass.

### T-003 — express factory + routes + supertest
- One attempt fix: `text/plain` POSTs were silently leaving body as `{}`,
  which then failed validation as `invalid_url` instead of `invalid_body`.
  Added a Content-Type guard at the top of the POST handler. 25/25 green.
- `createApp` is constructable even when `dist/client/main.js` and `src/client/index.html`
  do not exist (the `GET /` handler 404s on sendFile error rather than crashing).

### T-004 — vanilla-TS client bundle + esbuild
- Implemented `renderList` as a pure helper exported from `main.ts`; bootstrap
  only runs when `#bookmarks` exists in the DOM (so the module is safe to import in tests).
- Two attempt-bumps:
  1. happy-dom's `innerHTML` getter returned raw `<b>A</b>` (not HTML-escaped)
     so the original test was asserting on implementation detail. Replaced
     with the actual security property: `a.querySelector('b') === null` and
     `a.children.length === 0`. This is stronger, not weaker — no real child
     element is created from the user-controlled string.
  2. `scripts/build-client.ts` CLI-guard `import.meta.url === \`file://${argv[1]}\``
     was failing because `argv[1]` contained literal spaces ("My Shared Files");
     swapped to `pathToFileURL(process.argv[1]).href`.
- `dist/client/main.js` produced (4.6kb), 29/29 green.

### T-005 — boot + e2e smoke
- `src/server/index.ts` resolves the DB path against `process.cwd()` (workspace-isolation
  contract: `npm start` is invoked from `app/`). PORT env override for smoke.
- `tests/e2e.smoke.test.ts` runs `buildClient()` in `beforeAll`, binds an ephemeral port,
  walks the full POST → GET → DELETE → GET cycle plus the UI-shell and bundle reachability.
- 32/32 green on first run.

## Smoke gate

- Started server on `PORT=3001`. Probed `GET /` (200 + HTML referencing
  `/static/main.js` + the form), `GET /static/main.js` (200, 4678 bytes),
  `POST /api/bookmarks` (201 + canonical url), `GET /api/bookmarks` (200 with
  the row), `POST` of the same URL (409 duplicate_url), `DELETE` (204),
  `GET` (200 + `[]`). Killed the server and removed the `bookmarks.db` file
  the smoke run created.
- Headless-browser screenshot check was substituted with the curl-based HTML
  check (documented in `smoke-report.md`); adding Puppeteer would have
  violated the stack-pinning constraint.

## 2026-05-16 - baseline-1778963742-1 - build-retries-T003-T004

Two of five tasks needed a second attempt; both fixes were small and
locally-scoped. Worth capturing as Build-agent playbook items:

- **T-003 — Content-Type guard before validation.** Initial impl let
  `text/plain` POSTs slip through `express.json()` with `body === {}`,
  which then failed the URL validator as `invalid_url` instead of the
  documented `invalid_body`. Fix: guard `req.headers["content-type"]`
  at the top of the POST handler (routes.ts:12-17). Lesson: when a
  contract names an `invalid_body` error for "not JSON", express.json's
  silent-noop behaviour on the wrong Content-Type is a trap — explicit
  guard, not implicit.
- **T-004 — happy-dom innerHTML semantics + path-with-spaces.** Two
  unrelated failures landed in the same red run. (1) happy-dom's
  `innerHTML` getter returns the raw stored text rather than an
  HTML-escaped form, so an assertion on `innerHTML === "&lt;b&gt;A&lt;/b&gt;"`
  fails even though the security property holds. Stronger test:
  assert `a.querySelector('b') === null` and `a.children.length === 0`
  (i.e. the user input did not become a real DOM element). (2) The
  build-client.ts CLI guard `import.meta.url === \`file://${argv[1]}\``
  fails on paths containing spaces (the workspace lives under
  "My Shared Files"). Fix: `pathToFileURL(process.argv[1]).href` for
  guaranteed correct encoding.

## 2026-05-16 - baseline-1778963742-1 - smoke-substitution-curl-for-puppeteer

Smoke check 4 (UI render) was satisfied via curl + the existing happy-dom
unit suite instead of a headless-browser screenshot. Adding Puppeteer
would have violated the stack-pinning constraint in `spec.md §Constraints`
(no deps beyond the locked set: express, better-sqlite3, esbuild + vitest,
supertest, typescript, tsx, happy-dom, @types/*). The substitution asserts
that `GET /` returns 200 + text/html + references `/static/main.js` +
contains `<form id="add-form">`, and that `GET /static/main.js` returns
200 with a non-empty body. The richer DOM render behaviour is covered by
`tests/client.render.test.ts` (4 happy-dom cases). Equivalent coverage
without a dep violation.

## 2026-05-16 - baseline-1778963742-1 - port-collision-avoidance-3001

Smoke harness used `PORT=3001` rather than the spec-pinned 3000 to avoid
collisions with adjacent baseline workspaces (multiple baselines may run
concurrently). The production default in `src/server/index.ts` stays
`Number(process.env.PORT ?? 3000)`, so the `:3000` invariant is unchanged
for `npm start`; only the smoke harness sets the env override. The e2e
Vitest test binds an ephemeral port via `app.listen(0)`, which is the
right hermetic pattern for test-suite runs.

## 2026-05-16 - baseline-1778963742-1 - review-pass-2-minor-2-note

Review verdict PASS with 0 Blockers, 0 Major, 2 Minor, 2 Notes. All four
US-001..US-004 acceptance criteria are evidenced by passing tests; all
five planned tasks are Done with red+green logs; 32/32 vitest + 5/5
smoke checks PASS. HARNESS-DIRECTIVE (workspace isolation) was honored —
`git status` at repo root shows no leakage from this baseline. The two
Minor findings are both accepted carve-outs: (a) the single-implementation
`BookmarksRepo` interface earns its keep as the route↔repo type contract;
(b) the `GET /` sendFile-error 404 swallow is intentional pre-T-004
defensiveness and the final error middleware still fires on
repo-thrown errors.
