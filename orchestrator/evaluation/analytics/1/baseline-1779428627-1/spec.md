---
project: baseline-1779428627-1
created: 2026-05-22
---

# Spec — baseline-1779428627-1

## What we're building

A tiny, local-only, single-user "Bookmarks" web app that runs on the user's
laptop. The user saves URLs with titles, sees them in a single
newest-first list, opens any of them in a new browser tab, and deletes
ones they no longer want. No auth, no deploy, no sync, no nice-to-haves
beyond the four features the seed names.

The app is delivered as a brand-new TypeScript codebase inside the
isolated workspace `./app/` (relative to this spec). The server is Node +
Express on `http://localhost:3000`, storage is SQLite via
`better-sqlite3` on disk next to the server, and the UI is plain HTML +
CSS + vanilla TypeScript compiled to a single bundle by `esbuild`. Tests
are Vitest. `npm start` boots the server and serves the UI from the same
origin; `npm test` runs the test suite.

## Users and value

- **Primary user:** the seed author — a single developer using the app on
  their own laptop to stash URLs they want to come back to later. There
  is no second persona; no auth, no multi-user, no sharing.
- **Value:** a small persistent place to save URLs that survives browser
  history clears, profile switches, and machine reboots. Faster and
  cleaner than browser bookmark folders for the "I'll read this later"
  use case at small scale.
- **Out-of-band success criterion:** `npm start` boots cleanly,
  `npm test` is green, and the four user stories below behave as
  specified end-to-end via a real browser pointed at
  `http://localhost:3000`.

## Scope

In scope (the four-feature surface from the seed):

- Save a bookmark — submit a title and URL via the UI; the system
  persists it to SQLite.
- List bookmarks — a single newest-first list rendered from a `GET`
  endpoint on page load.
- Open a bookmark — click a bookmark's link; the browser opens the URL
  in a new tab.
- Delete a bookmark — a per-row delete control removes the bookmark from
  storage and from the rendered list.

In scope for stack and shape (pinned by the seed):

- TypeScript everywhere (server source + client source).
- Node + Express, single process, same-origin server for API and UI.
- SQLite via `better-sqlite3`, file on disk colocated with the server
  process.
- Frontend is plain HTML + CSS + vanilla TypeScript, bundled by
  `esbuild` into one JS file. No React, Vue, or any framework.
- Vitest as the test runner.
- `npm start` boots `http://localhost:3000`; `npm test` runs Vitest;
  both runnable from `./app/`.
- Reject-on-duplicate at the storage layer (UNIQUE constraint on URL)
  surfaced as an inline error in the UI (Q02).

## Out of scope

Explicitly excluded — do not add silently:

- Tags or categories of any kind (Q01).
- A search box or any text-filtering UI (Q03).
- Editing a saved bookmark's title or URL after creation (Q04).
- Sort orders other than newest-first (Q05).
- Authentication, multi-user support, sharing, sync between machines.
- Deployment artifacts (Dockerfile, hosting config, reverse-proxy
  config, systemd unit, etc.).
- Telemetry, analytics, service worker, PWA manifest.
- Dark mode toggle — acceptable only if it falls out of CSS for free
  (e.g. `prefers-color-scheme` with no JS toggle); otherwise omit.
- Frontend frameworks (React, Vue, Svelte, etc.) and CSS frameworks
  beyond hand-written CSS.
- Placeholder UI for future extensions ("Tags (coming soon)") or stubbed
  endpoints for features that aren't shipped.

## User stories

### US-001: Save a Bookmark With a Title
<!-- loom:story id=US-001 status=active -->

**Story:** As a single-user laptop owner, I want to save a URL with a
title, so that I can find it again later in my personal bookmarks list.

**Supporting decisions:** Q02 (duplicate handling)

**Acceptance criteria:**
1. When the user submits the create form with a non-empty title and a syntactically valid URL, the system SHALL persist the bookmark to SQLite with a server-assigned id and a server-assigned creation timestamp.
2. When the bookmark is successfully persisted, the system SHALL render it at the top of the visible list without requiring a full page reload.
3. If the submitted URL matches a URL already present in storage, then the system SHALL reject the submission, leave storage unchanged, and display an inline error on the create form identifying it as a duplicate.
4. If the submitted title is empty or the submitted URL is not a syntactically valid URL, then the system SHALL reject the submission and display an inline validation error on the create form.

<!-- loom:story-end id=US-001 -->

### US-002: View All Saved Bookmarks
<!-- loom:story id=US-002 status=active -->

**Story:** As a single-user laptop owner, I want to see all my saved
bookmarks in one chronological list, so that I can scan them by recency
without filtering or sorting controls.

**Supporting decisions:** Q01 (flat list), Q03 (no search), Q05 (newest-first)

**Acceptance criteria:**
1. When the user loads the app at `http://localhost:3000`, the system SHALL render every persisted bookmark in a single list ordered by creation time, newest first.
2. The system shall render each list row with the bookmark's title (as the visible link text) and its URL (visible to the user, either inline or as a secondary line).
3. While the list is empty, the system SHALL render an explicit empty-state message instead of an empty container.

<!-- loom:story-end id=US-002 -->

### US-003: Open a Bookmark in a New Tab
<!-- loom:story id=US-003 status=active -->

**Story:** As a single-user laptop owner, I want to click a saved
bookmark and open it in a new browser tab, so that I do not lose my
place in the bookmarks app.

**Acceptance criteria:**
1. When the user clicks the title link of a bookmark row, the system SHALL open that bookmark's URL in a new browser tab (`target="_blank"`).
2. The system shall set `rel="noopener noreferrer"` on every bookmark link so the opened tab does not retain a reference to the bookmarks app window.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a Bookmark
<!-- loom:story id=US-004 status=active -->

**Story:** As a single-user laptop owner, I want to delete a bookmark I
no longer want, so that my list stays small and relevant.

**Supporting decisions:** Q04 (immutable; deletion is the only mutation after create)

**Acceptance criteria:**
1. When the user activates the delete control on a bookmark row, the system SHALL remove that bookmark from SQLite by id.
2. When the bookmark is successfully removed, the system SHALL remove the corresponding row from the rendered list without requiring a full page reload.
3. If the targeted bookmark id does not exist in storage at delete time, then the system SHALL respond with a not-found status and leave storage unchanged.

<!-- loom:story-end id=US-004 -->

## Constraints

Universal envelope conditions that apply to every story above and to the
deliverable as a whole. These are invariants, not user-action-shaped
behaviours — they live here instead of inside a `loom:story` block.

**Workspace isolation (harness constraint, do not relax).**
- All deliverable files for this project — `package.json`,
  `tsconfig.json`, source code, tests, build output, `node_modules`,
  the SQLite file, anything `npm` writes — MUST be created inside
  `./app/` **relative to this spec's location**, i.e. inside
  `.loom/baseline-1779428627-1/app/`.
- The system shall not write deliverable files to the repo root, to
  `orchestrator/`, to `ui/`, or to any sibling `.loom/` workspace.
- The `npm start` and `npm test` commands declared in
  `app/package.json` MUST be runnable from `app/` (i.e. `cd app && npm
  start` works).

**Stack pinning (seed constraint, no substitutions).**
- The system shall use TypeScript for all first-party source code
  (server and client).
- The system shall use Node + Express for the HTTP server, running as
  a single process.
- The system shall use SQLite via `better-sqlite3` for persistent
  storage, with the database file on disk next to the server entry
  point.
- The system shall use plain HTML, hand-written CSS, and vanilla
  TypeScript on the client, compiled to one JS bundle via `esbuild`.
- The system shall NOT introduce any frontend framework (React, Vue,
  Svelte, Solid, etc.) or any UI component library.
- The system shall use Vitest for tests.

**Runtime and origin.**
- When the user runs `npm start` from `app/`, the system SHALL bind the
  Express server to `http://localhost:3000`.
- The system shall serve the compiled UI bundle and the JSON API from
  the same Express process on the same origin (no CORS surface).
- The system shall not make any outbound network calls at runtime; the
  app is local-only by construction.

**No undeclared surface area.**
- The system shall not ship telemetry, analytics, service workers, or
  PWA manifests.
- The system shall not ship a dark-mode toggle; CSS-only respect for
  `prefers-color-scheme` is acceptable if it costs no JS.
- The system shall not ship placeholder UI for features deferred to a
  later iteration (no "Tags — coming soon", no disabled edit button).

**Validation envelope.**
- The system shall validate all user-submitted input on the server
  before persistence (title non-empty, URL syntactically valid),
  independent of any client-side validation.

## Open ambiguity

None. All five seed-declared open questions (tags/categories,
duplicate handling, search, edit, sort) were resolved through Q01–Q05 in
`decisions.md`. The remaining design and implementation details
(table schema, exact endpoint paths, exact HTML structure) are
deliberately left to the Design phase — they are not ambiguity in
intent.
