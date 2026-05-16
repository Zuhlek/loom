---
project: baseline-1778931123-1
created: 2026-05-16
---

# Bookmarks — Spec

## What we're building

A tiny local-only "Bookmarks" web app, built from scratch as a greenfield
fabric. A single user runs it on their laptop with one command (`npm start`),
opens `http://localhost:3000`, and saves / lists / opens / deletes URL +
title bookmarks. No auth, no deploy, no external services. SQLite (via
`better-sqlite3`) persists bookmarks to a file on disk next to the server.
The UI is plain HTML + CSS + vanilla TypeScript bundled with `esbuild` and
served from the same origin as the Express API.

## Users and value

- **User:** a single developer running the app on their own laptop for
  personal use.
- **Value:** a frictionless place to drop URLs with titles and find them
  again later — without depending on a browser's bookmark sync, a cloud
  service, or an account.

## Scope

- Save a new bookmark (URL + title) via a form in the UI.
- List all saved bookmarks in one chronological view (newest first).
- Open a saved bookmark in a new tab (target=_blank with rel=noopener).
- Delete a saved bookmark (with confirmation step appropriate to a
  single-user laptop app — design decides the exact UX).
- Persist bookmarks across server restarts via SQLite.
- Reject duplicate URLs at save time with an inline error.
- Boot the server and UI with one command: `npm start`.
- Run the test suite with one command: `npm test`.

## Out of scope

- Authentication, multi-user support, sharing.
- Deployment, hosting, sync, cloud storage.
- Tags, categories, folders, hierarchies, or any taxonomy beyond a flat list.
- Editing a bookmark's title or URL after creation. (To fix a mistake the
  user deletes and re-adds.)
- Search box / filter input. (User relies on the chronological list and
  browser Ctrl-F.)
- Sort orders other than newest-first.
- Telemetry, analytics, service worker, PWA manifest.
- Dark mode toggle (unless it falls out of CSS for free via
  `prefers-color-scheme`).
- React / Vue / any frontend framework.
- Anything outside `.loom/baseline-1778931123-1/app/` on disk.

## User stories

### US-001: Save a new bookmark
<!-- loom:story id=US-001 status=answered -->

**Story:** As the single user, I want to save a URL with a title, so that I
can find it again later without depending on browser sync.

**Supporting decisions:** Q02 (duplicate handling)

**Acceptance criteria:**
1. WHEN the user submits the save form with a valid URL and a non-empty title, the system SHALL persist the bookmark to SQLite and display it at the top of the list.
2. IF the submitted URL is already present in the database, then the system SHALL reject the submission and display an inline error identifying the duplicate.
3. IF the submitted URL is missing, empty, or fails URL parsing, then the system SHALL reject the submission and display an inline validation error.
4. IF the submitted title is empty or whitespace-only, then the system SHALL reject the submission and display an inline validation error.

<!-- loom:story-end id=US-001 -->

### US-002: View all bookmarks newest-first
<!-- loom:story id=US-002 status=answered -->

**Story:** As the single user, I want to see all my saved bookmarks in one
chronological list, so that the most recent saves are immediately visible.

**Supporting decisions:** Q01 (flat list), Q03 (no search), Q05 (newest-first only)

**Acceptance criteria:**
1. WHEN the user loads `http://localhost:3000`, the system SHALL render every saved bookmark in a single list ordered by creation time descending.
2. The system shall display each row with at minimum the bookmark's title and URL.
3. While the list is empty, the system SHALL display an empty-state message instead of an empty list element.

<!-- loom:story-end id=US-002 -->

### US-003: Open a bookmark in a new tab
<!-- loom:story id=US-003 status=answered -->

**Story:** As the single user, I want to open a saved bookmark in a new
browser tab, so that I can visit the link without leaving the bookmarks
view.

**Acceptance criteria:**
1. WHEN the user clicks a bookmark's open affordance, the system SHALL open the bookmark's URL in a new browser tab.
2. The system shall set `rel="noopener"` on every bookmark link to prevent the opened page from accessing the bookmarks tab.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a bookmark
<!-- loom:story id=US-004 status=answered -->

**Story:** As the single user, I want to delete a bookmark I no longer
want, so that my list reflects only links I still care about.

**Supporting decisions:** Q04 (immutable bookmarks — delete-and-readd is the fix path)

**Acceptance criteria:**
1. WHEN the user confirms deletion of a bookmark, the system SHALL remove the row from SQLite and from the rendered list.
2. IF a delete request targets a bookmark id that does not exist, then the system SHALL respond with a 404 and leave the list unchanged.
3. WHEN a bookmark has been deleted, the system SHALL allow the same URL to be saved again as a fresh bookmark.

<!-- loom:story-end id=US-004 -->

### US-005: One-command boot and one-command test
<!-- loom:story id=US-005 status=answered -->

**Story:** As the single user, I want `npm start` to boot the whole app
and `npm test` to run every test, so that I never have to remember a
sequence of commands.

**Acceptance criteria:**
1. WHEN the user runs `npm start` from `./app/`, the system SHALL build the client bundle (if needed) and serve the UI plus the API from `http://localhost:3000` on the same origin.
2. WHEN the user runs `npm test` from `./app/`, the system SHALL execute the Vitest suite and exit with a non-zero status if any test fails.

<!-- loom:story-end id=US-005 -->

## Constraints

These are envelope invariants for the whole app — universal acceptance
conditions that don't fit a single user-action-shaped story.

- **Workspace isolation (harness directive, do not relax).** All deliverable
  files — `package.json`, `tsconfig.json`, source code, tests, build output,
  `node_modules`, the SQLite file, anything `npm` writes — MUST be created
  inside `.loom/baseline-1778931123-1/app/`. Nothing is written to the repo
  root, to `orchestrator/`, or to any sibling workspace.
- **Stack lock (seed, no substitutions).**
  - TypeScript everywhere (server, client, tests).
  - Backend: Node + Express, single process.
  - Storage: SQLite via `better-sqlite3`, single file on disk next to the
    server.
  - Frontend: plain HTML + CSS + vanilla TypeScript, bundled to one JS file
    via `esbuild`. No React, no Vue, no framework.
  - Tests: Vitest.
- **Single-origin serving.** The Express server serves both the API and the
  static UI from `http://localhost:3000` — no separate dev server, no CORS
  surface.
- **Local-only, single-user.** No authentication layer; no network exposure
  beyond `localhost`; no telemetry, analytics, service worker, or PWA
  manifest.
- **One command to run, one command to test.** `npm start` boots the
  server-with-UI; `npm test` runs Vitest.
- **Persistence across restarts.** The SQLite file survives process restarts;
  bookmarks reappear after stopping and re-running `npm start`.
- **Minimal surface.** Only the four named features (save, list, open,
  delete) ship. No nice-to-haves not asked for in the seed.

## Open ambiguity

None at this time. The five seed-flagged ambiguities are resolved in
`decisions.md` (Q01–Q05). Open implementation details (exact route shapes,
HTTP verbs, schema columns beyond `id / url / title / created_at`, delete
confirmation UX) are deferred to the Design phase — they are not Spec-level
ambiguities.
