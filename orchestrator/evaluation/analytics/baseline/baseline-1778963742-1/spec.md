---
project: baseline-1778963742-1
created: 2026-05-16
---

# Spec — Bookmarks (local-only)

## What we're building

A tiny local-only "Bookmarks" web app, built from scratch, that runs on a single
user's laptop. The app exposes exactly four features against a single bookmark
list: **save a URL with a title**, **list all saved bookmarks**, **open a saved
bookmark in a new tab**, and **delete a bookmark**. A single-process Node +
Express server persists bookmarks to a SQLite file on disk via `better-sqlite3`
and serves a vanilla-TypeScript UI (compiled to one `esbuild` bundle) on
`http://localhost:3000`. The whole app is greenfield and is sandboxed inside
this workspace's `./app/` directory.

## Users and value

- **Role:** a single laptop user keeping a personal list of URLs.
- **Value:** save and re-open URLs locally without a cloud account, without
  signing in, without a deploy step, and without inviting feature creep that
  the user did not ask for.
- **Success:** `npm start` boots the server on `http://localhost:3000`; the four
  features work end-to-end; `npm test` runs the Vitest suite; no telemetry, no
  analytics, no PWA / service-worker scaffolding, no auth.

## Scope

In scope:

1. **Save** — POST a `{ url, title }` pair; persist to SQLite with a generated
   id and a `created_at` timestamp.
2. **List** — render all saved bookmarks in newest-first order on the single
   UI view.
3. **Open** — clicking a bookmark in the list opens its URL in a new browser
   tab.
4. **Delete** — DELETE a bookmark by id; the row vanishes from the list.
5. **Duplicate guard** — POST of a URL that already exists is rejected with an
   inline error (Q02).
6. **Single-page UI** — one HTML page, one CSS file, one bundled TS entry,
   served from the Express same-origin.
7. **Vitest test suite** — runnable via `npm test`.

## Out of scope

- Authentication, user accounts, multi-user, sharing.
- Tags, categories, folders, or any organisational layer beyond the flat list
  (Q01).
- Search / filter UI; any sort order other than newest-first (Q03, Q05).
- Editing a bookmark after creation; bookmarks are immutable (Q04).
- Deploy targets, hosting, reverse proxy, HTTPS.
- Telemetry, analytics, service worker, PWA manifest.
- Dark-mode toggle (a CSS-media-query dark-mode that "falls out for free" is
  fine; an explicit toggle is not).
- React, Vue, or any frontend framework. Vanilla TypeScript only.
- Any deliverable file written outside `./app/` (see Constraints).

## User stories

### US-001: Save a URL with a title
<!-- loom:story id=US-001 status=active -->

**Story:** As a laptop user, I want to save a URL together with a title, so that I can find it later in my list without retyping it.

**Supporting decisions:** Q02 (duplicate handling)

**Acceptance criteria:**
1. When the user submits a non-empty URL and a non-empty title, the system SHALL persist a new bookmark row with a generated id, the submitted URL, the submitted title, and a `created_at` timestamp.
2. When the bookmark is persisted, the system SHALL surface the new bookmark at the top of the list without a full page reload.
3. If the submitted URL exactly matches an already-saved URL, then the system SHALL reject the save and SHALL display an inline error indicating the URL is already saved.
4. If the submitted URL is empty, malformed, or the title is empty, then the system SHALL reject the save and SHALL display an inline validation error.

<!-- loom:story-end id=US-001 -->

### US-002: See all saved bookmarks in one list
<!-- loom:story id=US-002 status=active -->

**Story:** As a laptop user, I want to see every saved bookmark in a single list, so that I can scan my collection without navigating between views.

**Supporting decisions:** Q01 (flat list), Q03 (no search), Q05 (newest-first)

**Acceptance criteria:**
1. When the user loads `http://localhost:3000`, the system SHALL render every saved bookmark on a single page.
2. The system SHALL order the rendered list by `created_at` descending (newest first).
3. While zero bookmarks are saved, the system SHALL display an empty-state message in place of the list.

<!-- loom:story-end id=US-002 -->

### US-003: Open a saved bookmark in a new tab
<!-- loom:story id=US-003 status=active -->

**Story:** As a laptop user, I want to open a saved bookmark in a new browser tab, so that I can keep my list visible while I read the link.

**Acceptance criteria:**
1. When the user clicks the title of a bookmark in the list, the system SHALL open the bookmark's URL in a new browser tab.
2. The system SHALL leave the bookmarks list view intact in the original tab after the click.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a bookmark
<!-- loom:story id=US-004 status=active -->

**Story:** As a laptop user, I want to delete a bookmark I no longer want, so that my list stays focused on URLs I actually intend to revisit.

**Supporting decisions:** Q04 (immutable — delete is the only mutation path)

**Acceptance criteria:**
1. When the user triggers the delete action on a bookmark row, the system SHALL remove the corresponding row from the SQLite store.
2. When the delete completes, the system SHALL remove the bookmark from the visible list without a full page reload.
3. If the delete target no longer exists (e.g. already deleted in another tab), then the system SHALL surface a non-fatal error and SHALL leave the rest of the list intact.

<!-- loom:story-end id=US-004 -->

## Constraints

These are envelope conditions and universal invariants; they hold regardless of
user action.

- **Workspace isolation (harness constraint, do not relax).** Every deliverable
  file — `package.json`, `tsconfig.json`, source code, tests, build output,
  `node_modules`, the SQLite database file, anything `npm` writes — MUST be
  written inside `./app/` relative to this workspace
  (`/Volumes/My Shared Files/repo/loom/.loom/baseline-1778963742-1/app/`). No
  deliverable file may be written to the repo root, to `orchestrator/`, or to
  any sibling `.loom/<project>/` workspace. Multiple baseline runs execute in
  adjacent workspaces and will overwrite each other if this is violated.
- **Run command.** `npm start`, invoked from `./app/`, SHALL boot a single
  Node + Express process listening on `http://localhost:3000` and serve both
  the API and the UI from that same origin.
- **Test command.** `npm test`, invoked from `./app/`, SHALL execute the Vitest
  suite.
- **Stack pinning (no substitutions).** Backend: Node + Express, single
  process. Storage: SQLite via `better-sqlite3`, file on disk inside `./app/`.
  Frontend: plain HTML + CSS + vanilla TypeScript, compiled to one JS bundle
  via `esbuild`. Tests: Vitest. Language: TypeScript everywhere. No React, no
  Vue, no other framework.
- **Local-only.** The app SHALL NOT make outbound network calls at runtime
  (no telemetry, no analytics, no fonts/CDN fetches required for core
  functionality).
- **No auth.** The app SHALL NOT implement authentication, sessions, or
  multi-user separation. It assumes a single trusted local user.
- **Minimal surface.** The app SHALL NOT include features beyond the four
  named (save, list, open, delete) plus the duplicate-rejection guard. No
  search, no sort selector, no edit, no tags/categories, no PWA manifest, no
  service worker, no explicit dark-mode toggle.
- **Same-origin UI delivery.** The Express server SHALL serve the bundled
  client (HTML, CSS, JS) from the same origin as the API to avoid CORS
  considerations.

## Open ambiguity

*(none — all five seed-listed branching questions are resolved, the stack is
pinned by the seed, and the harness constraint is captured under Constraints.)*
