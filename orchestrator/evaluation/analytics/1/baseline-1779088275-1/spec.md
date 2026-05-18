---
project: baseline-1779088275-1
created: 2026-05-18
phase: spec
---

# Spec — baseline-1779088275-1

## What we're building

A tiny local-only "Bookmarks" web app. One user, runs on the user's laptop, no auth, no deploy. The user can save a URL with a title, see all saved bookmarks as a flat newest-first list, open any bookmark in a new browser tab, and delete a bookmark they no longer want. The backend is Node + Express in a single TypeScript process, persisting to a local SQLite file via `better-sqlite3`. The frontend is plain HTML + CSS + vanilla TypeScript bundled to a single JS file via `esbuild`, served from the same origin. Tests run under Vitest. `npm start` boots the server on `http://localhost:3000`; `npm test` runs the test suite. Everything lives under `./app/` inside the workspace.

## Users and value

- **Primary user:** a single individual using the app on their own laptop to save and revisit URLs they care about. No multi-user model, no sharing, no accounts.
- **Value:** a friction-light place to stash a URL with a title, and to come back to it later in a list that is small enough to scan. Faster than browser bookmarks for ad-hoc saves the user wants out of their main bookmark bar; entirely under the user's control, on their own machine.
- **Success looks like:** running `npm start` from `./app/`, opening `http://localhost:3000`, adding a few bookmarks, opening them in new tabs, deleting one, and having `npm test` pass the test suite cleanly.

## Scope

- Save a bookmark: a title and a URL, persisted to SQLite, timestamped at creation.
- List all bookmarks: a single chronological list, newest-first, served from the same origin.
- Open a bookmark in a new browser tab from the list.
- Delete a bookmark from the list.
- Reject a save attempt whose URL exactly matches an already-saved URL, surfacing an inline error in the UI.
- Single-process Express server (TypeScript) serving both the JSON API and the static frontend bundle from `http://localhost:3000`.
- SQLite persistence via `better-sqlite3`, with the database file on disk inside `./app/`.
- Frontend built as one JS bundle by `esbuild` from vanilla TypeScript sources.
- Vitest test suite reachable via `npm test`.
- `npm start` and `npm test` runnable from `./app/`.

## Out of scope

- Tags, categories, or any grouping of bookmarks.
- Merging duplicates or allowing duplicate URLs.
- Editing a bookmark's title or URL after creation. Correction workflow is delete-and-recreate.
- Search box, filtering UI, or any list-narrowing input.
- Sort orders other than newest-first. No dropdown, no UI control for ordering.
- Authentication, authorization, multi-user, user accounts.
- Deployment, hosting, cloud, Docker, CI configuration beyond `npm test`.
- Telemetry, analytics, service worker, PWA manifest.
- Dark-mode toggle (unless it falls out of plain CSS `prefers-color-scheme` for free).
- Any frontend framework: React, Vue, Svelte, Preact, Lit, Solid, jQuery, htmx, etc.
- Any third-party storage: Postgres, MySQL, IndexedDB, file-system JSON dumps, remote KV.
- Import/export of bookmarks. Bookmark sync. Multi-device.
- Favicon scraping, OpenGraph title fetching, link health checks, URL preview rendering.

## User stories

### US-001: Save a URL with a title

<!-- loom:story id=US-001 status=active -->

**Story:** As the single user, I want to save a URL with a title, so that I can find it again later from a list on my laptop.

**Supporting decisions:** Q01 (flat list), Q02 (duplicate handling)

**Acceptance criteria:**
1. When the user submits a non-empty title and a syntactically valid URL via the add form, the system SHALL persist a new bookmark row with that title, URL, and a creation timestamp.
2. When the system persists a new bookmark, the system SHALL include the new bookmark in the list response on the next list fetch without requiring a page reload.
3. If the submitted URL exactly matches the URL of an existing bookmark, then the system SHALL reject the save with a 409-class API response and SHALL display an inline error in the add form.
4. If the submitted title is empty or whitespace-only, then the system SHALL reject the save and SHALL display an inline validation error in the add form.
5. If the submitted URL is not a syntactically valid `http://` or `https://` URL, then the system SHALL reject the save and SHALL display an inline validation error in the add form.

<!-- loom:story-end id=US-001 -->

### US-002: See all saved bookmarks in one list

<!-- loom:story id=US-002 status=active -->

**Story:** As the single user, I want to see all my saved bookmarks in one chronological list, so that I can scan everything I've saved without filters or paging.

**Supporting decisions:** Q01 (flat list), Q03 (no search), Q05 (newest-first only)

**Acceptance criteria:**
1. When the user loads `http://localhost:3000`, the system SHALL render every saved bookmark in a single flat list.
2. The system SHALL order the bookmarks by creation timestamp, newest first.
3. The system SHALL render each list entry with its title (as the visible link text) and its URL (visible or accessible to the user).
4. While there are zero bookmarks saved, the system SHALL render an empty-state message in place of the list.

<!-- loom:story-end id=US-002 -->

### US-003: Open a saved bookmark in a new tab

<!-- loom:story id=US-003 status=active -->

**Story:** As the single user, I want to open a saved bookmark in a new browser tab, so that I can visit the page without losing the bookmarks list.

**Supporting decisions:** —

**Acceptance criteria:**
1. When the user clicks (or activates via keyboard) the title of a bookmark in the list, the system SHALL navigate the browser to the bookmark's URL in a new browser tab.
2. The system SHALL preserve the bookmarks list view in the originating tab — the originating tab SHALL NOT navigate away.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a saved bookmark

<!-- loom:story id=US-004 status=active -->

**Story:** As the single user, I want to delete a bookmark I no longer want, so that the list stays representative of what I actually care about.

**Supporting decisions:** Q04 (immutable — delete is the correction path too)

**Acceptance criteria:**
1. When the user activates the delete control on a bookmark, the system SHALL remove the corresponding row from SQLite.
2. When the system has removed a bookmark, the system SHALL update the visible list to exclude that bookmark without requiring a page reload.
3. If the user activates the delete control for a bookmark that no longer exists server-side (e.g. already deleted in another tab), then the system SHALL treat the delete as a no-op success and SHALL still update the visible list to exclude that bookmark.

<!-- loom:story-end id=US-004 -->

## Constraints

Workspace and runtime envelope conditions that apply universally and are NOT user-action-shaped:

- **Workspace isolation (harness directive, do not relax).** All deliverable files for this run — `package.json`, `tsconfig.json`, source code, tests, build output, `node_modules`, the SQLite database file, anything `npm` writes — MUST be created inside `./app/` relative to the seed file's location, i.e. `.loom/baseline-1779088275-1/app/`. No files outside that directory. No writes to the repo root, to `orchestrator/`, or to any sibling workspace.
- **Stack lock (seed directive, no substitutions).** TypeScript for both server and client sources. Backend: Node + Express in a single process. Storage: SQLite via `better-sqlite3`, with the database file on disk next to the server entry inside `./app/`. Frontend: plain HTML + CSS + vanilla TypeScript, compiled to one JS bundle via `esbuild`. Tests: Vitest. No frontend framework, no alternate storage layer, no alternate bundler.
- **Run contract.** `npm start` (runnable from `./app/`) SHALL boot the Express server on `http://localhost:3000` and SHALL serve the frontend UI from the same origin as the JSON API. `npm test` (runnable from `./app/`) SHALL run the Vitest test suite.
- **Single origin.** The frontend SHALL be served from `http://localhost:3000`, the same origin as the JSON API. No cross-origin requests at runtime.
- **No auth, no deploy, no multi-user.** The app SHALL NOT implement authentication, authorization, user identity, sessions, or any deploy-target configuration. The app runs only on the user's laptop.
- **No telemetry surface.** The system SHALL NOT emit telemetry, analytics, crash reports, or any outbound network request other than the user-initiated navigation that opens a bookmark URL (which happens in the browser, not the server).
- **No service worker, no PWA manifest.** The frontend SHALL NOT register a service worker and SHALL NOT ship a PWA manifest.
- **No dark-mode toggle.** The frontend SHALL NOT include a dark-mode toggle control. Dark styling is acceptable only if it falls out of plain CSS `prefers-color-scheme` rules without a user-facing toggle.
- **URL validation.** The system SHALL treat a syntactically valid URL as one parseable by the platform `URL` constructor with an `http:` or `https:` protocol. Any other input SHALL be rejected as invalid.
- **Title validation.** The system SHALL trim leading and trailing whitespace from a submitted title before persisting and SHALL reject a title that is empty after trimming.
- **Duplicate detection key.** The system SHALL detect duplicate URLs by exact string equality on the submitted URL after the same parsing pass used for validation (no normalization beyond what the platform `URL` constructor performs).
- **Persistence durability.** The system SHALL persist every accepted save and every accepted delete to the SQLite file on disk before responding success; bookmarks SHALL survive a server restart.
- **Same-origin static serving.** The Express server SHALL serve the compiled JS bundle, the HTML entry, and the CSS file from the same origin as the JSON API.

## Open ambiguity

None. The seed plus the resolved branching decisions (Q01–Q05) fully define user-facing behaviour; remaining choices (HTTP status codes, error-message wording, schema column types, the exact location of the SQLite file inside `./app/`, the precise `esbuild` invocation) are implementation details for Design and Build.
