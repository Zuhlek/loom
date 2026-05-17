---
project: baseline-1779002783-2
created: 2026-05-17T08:23:09Z
phase: spec
---

# Spec — baseline-1779002783-2

## What we're building

A tiny, local-only "Bookmarks" web app the user runs on their own
laptop. Single user, no auth, no deploy, no telemetry. The user can
save a URL with a title, see all saved bookmarks in one list, open
one in a new tab, and delete one. That is the entire feature surface.

The app is a single Node + Express process that serves both an HTTP
JSON API and a vanilla TypeScript single-page UI from the same origin
on `http://localhost:3000`. Persistence is a `better-sqlite3` database
file on disk next to the server. `npm start` boots it; `npm test` runs
the Vitest suite. The frontend is one esbuild-bundled JS file plus
plain HTML + CSS — no React, Vue, or framework.

## Users and value

- **Primary user:** the developer running this on their own machine. A
  single human, no multi-tenancy.
- **Value:** a frictionless place to stash URLs the user wants to come
  back to, without depending on a browser's built-in bookmarks UI or
  any cloud service. Local-only means privacy, offline operability, and
  zero account setup.
- **Success criterion:** the user can save a URL, see it in the list,
  click to open it in a new tab, and delete it — all from
  `http://localhost:3000` after running `npm start`, with state that
  survives a server restart.

## Scope

- Save a bookmark with a URL and a title.
- List all bookmarks, newest-first by creation time.
- Open a bookmark in a new tab from the list (target=_blank).
- Delete a bookmark from the list.
- Reject save attempts for a URL already in the store, with an inline
  UI error (Q02).
- Persist all bookmarks in a `better-sqlite3` SQLite file on disk.
- One-command boot (`npm start`) on `http://localhost:3000`.
- One-command test (`npm test`) running Vitest.

## Out of scope

- Tags, categories, folders, or any grouping mechanism (Q01).
- Search box, full-text search, or any filter UI (Q03).
- Editing a bookmark's title or URL after creation; corrections are
  delete-and-recreate (Q04).
- Sort orders other than newest-first (Q05).
- Authentication, multi-user, sharing, sync, or any network egress.
- Deployment, hosting, Docker, CI, telemetry, analytics, service
  workers, PWA manifest, dark-mode toggle (unless it falls out of CSS
  for free), or any other nice-to-have.
- Browser extension or bookmarklet integration.
- Import / export of bookmarks (e.g. from `bookmarks.html`).

## User stories

### US-001: Save a URL with a title
<!-- loom:story id=US-001 status=answered -->

**Story:** As the single user, I want to save a URL with a title, so that I can come back to it later from the bookmarks list.

**Supporting decisions:** Q02 (duplicate URL handling)

**Acceptance criteria:**
1. When the user submits the new-bookmark form with a non-empty URL and a non-empty title, the system SHALL persist the bookmark to SQLite and return it in the next list response.
2. If the submitted URL already exists in the store, then the system SHALL reject the submission with a 409 response and the UI SHALL surface an inline error naming the duplicate.
3. If the submitted URL is empty or not a syntactically valid `http://` or `https://` URL, then the system SHALL reject the submission with a 400 response and the UI SHALL surface an inline validation error.
4. If the submitted title is empty or whitespace-only, then the system SHALL reject the submission with a 400 response and the UI SHALL surface an inline validation error.

<!-- loom:story-end id=US-001 -->

### US-002: View all bookmarks newest-first
<!-- loom:story id=US-002 status=answered -->

**Story:** As the single user, I want to see all my saved bookmarks in one list ordered by recency, so that the most recent additions are at the top without me having to sort.

**Supporting decisions:** Q01 (flat list), Q03 (no search), Q05 (newest-first only)

**Acceptance criteria:**
1. When the user loads `http://localhost:3000`, the system SHALL render every persisted bookmark in a single flat list, ordered by creation time descending.
2. Where no bookmarks exist, the system SHALL render an empty-state message instead of an empty list.
3. The system shall display each bookmark's title and URL.

<!-- loom:story-end id=US-002 -->

### US-003: Open a saved bookmark in a new tab
<!-- loom:story id=US-003 status=answered -->

**Story:** As the single user, I want to click a bookmark and open it in a new browser tab, so that I keep the bookmarks UI open while I read.

**Acceptance criteria:**
1. When the user clicks a bookmark's title link in the list, the system SHALL open the bookmark's URL in a new browser tab.
2. The system shall set `rel="noopener noreferrer"` on every bookmark link.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a bookmark
<!-- loom:story id=US-004 status=answered -->

**Story:** As the single user, I want to delete a bookmark I no longer want, so that the list only shows what I still care about.

**Acceptance criteria:**
1. When the user clicks the delete control for a bookmark, the system SHALL remove the bookmark from SQLite and the row SHALL disappear from the list on next render.
2. If the deletion request references an id that does not exist, then the system SHALL return a 404 response and the UI SHALL surface an inline error.

<!-- loom:story-end id=US-004 -->

### US-005: Bookmarks persist across server restarts
<!-- loom:story id=US-005 status=answered -->

**Story:** As the single user, I want my saved bookmarks to survive restarting the server, so that I do not lose what I have collected when I reboot my laptop.

**Acceptance criteria:**
1. When the server is stopped and `npm start` is run again, the system SHALL read the existing SQLite file and render all previously saved bookmarks in the next list response.
2. If the SQLite file does not yet exist on first boot, then the system SHALL create it with the bookmarks schema before serving the first request.

<!-- loom:story-end id=US-005 -->

## Constraints

### Workspace isolation (harness directive — do not relax)

All deliverable files for this run — `package.json`, `tsconfig.json`,
source code, tests, build output, `node_modules`, the SQLite file,
anything `npm` writes — MUST be created inside `./app/` **relative to
the seed file's location** (i.e. inside the
`.loom/baseline-1779002783-2/app/` directory). Never write deliverable
files to the repo root, to `orchestrator/`, or to any sibling
workspace. The `npm start` and `npm test` commands declared by the seed
MUST be runnable from `./app/`. Multiple baseline runs execute in
adjacent workspaces and will overwrite each other if this is violated.

### Stack invariants (frozen by the seed — no substitutions)

- TypeScript everywhere (server and client).
- Backend: Node + Express, single process.
- Storage: SQLite via `better-sqlite3`, file on disk next to the server.
- Frontend: plain HTML + CSS + vanilla TypeScript compiled to one JS
  bundle via `esbuild`. No React / Vue / other framework.
- Tests: Vitest.
- `npm start` boots the server on `http://localhost:3000` and serves
  the UI from the same origin.
- `npm test` runs the Vitest suite.

### Operational invariants

- The system SHALL serve the UI and the JSON API from the same origin
  (`http://localhost:3000`) so the client never makes a cross-origin
  request.
- The system SHALL NOT make outbound network calls at runtime (no
  telemetry, analytics, service worker, PWA manifest, or external
  asset fetch).
- The system SHALL persist all state in the on-disk SQLite file; no
  in-memory-only state survives process exit.
- The system SHALL validate every API request payload before persisting
  it.

## Open ambiguity

None. All five seed-named undecideds are resolved via Q01–Q05; the
stack, transport, and entry-point commands are frozen by the seed
directly; the workspace-isolation directive is fixed by the harness.
Design can proceed without redefining intent.
