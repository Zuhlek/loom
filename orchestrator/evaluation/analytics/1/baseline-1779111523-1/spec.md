---
project: baseline-1779111523-1
created: 2026-05-18
---

# Spec — baseline-1779111523-1

## What we're building

A tiny local-only "Bookmarks" web app, built from scratch for a single
user on their own laptop. The user runs `npm start`, opens
`http://localhost:3000`, and uses a small page to save URLs with a
title, see them in a chronological list, open them in a new tab, and
delete the ones they no longer want. The app is deliberately
four-feature: Save, List, Open, Delete. Everything (server, UI bundle,
SQLite file) lives inside a single workspace directory and runs in one
Node process. No auth, no deploy target, no telemetry, no analytics.

Stack is fixed by the seed:

- TypeScript everywhere.
- Backend: Node + Express, single process.
- Storage: SQLite via `better-sqlite3`, file on disk next to the
  server.
- Frontend: plain HTML + CSS + vanilla TypeScript, compiled to one JS
  bundle via `esbuild`. No React / Vue / framework.
- Tests: Vitest.
- Entrypoints: `npm start` (boots server on `http://localhost:3000`,
  serves UI from same origin) and `npm test` (runs Vitest).

## Users and value

**Primary user.** A single individual managing their own bookmark
collection on their own laptop. No multi-tenancy, no roles, no auth.

**Value.** A trusted, fast, no-cloud place to stash links they want to
come back to. Replaces an ever-growing browser bookmarks bar or a
notes-app dumping ground with a structured list they can search by
eye and prune as they go. The system never talks to the network at
runtime, so the user keeps their reading list private and offline.

## Scope

In scope — exactly four user-observable features:

1. **Save a URL with a title.** The user enters a URL and a title in
   a form and submits. The bookmark is persisted to SQLite and
   appears in the list.
2. **See all saved bookmarks in one list.** Rendered newest-first as a
   chronological flat list. No tags, no categories, no search, no
   alternative sort order.
3. **Open a saved bookmark in a new tab.** Clicking the bookmark's URL
   (or its title) opens it in a new browser tab.
4. **Delete a bookmark.** A per-row delete control removes the
   bookmark from SQLite and from the list view.

Supporting behaviour also in scope:

- **Duplicate URL handling.** Attempting to save a URL that is already
  bookmarked is rejected with an inline error next to the URL field;
  no merge, no silent overwrite, no duplicate row.
- **Local persistence.** All bookmarks survive `npm start` restarts
  via the SQLite file on disk.
- **Same-origin UI delivery.** The Express server serves the HTML,
  CSS, and bundled JS from `http://localhost:3000`.
- **Tests via Vitest** exercising the persistence and HTTP layers.

## Out of scope

Explicitly excluded by the seed or by Spec branching decisions:

- Authentication, multi-user, accounts, sessions.
- Deployment, hosting, containerisation, CI.
- Tags or categories (Q01).
- Merging or allowing duplicate URLs (Q02).
- In-app search / filter input (Q03).
- Editing a bookmark's title or URL after creation; edits happen via
  delete-then-recreate (Q04).
- Sort orders other than newest-first (Q05).
- Telemetry, analytics, error reporting, crash logging.
- Service worker, PWA manifest, offline-beyond-localhost behaviour.
- Dark mode toggle (unless it falls out of CSS for free).
- Any framework on the frontend (no React, no Vue, no Svelte).
- Any storage other than `better-sqlite3` against a local file.
- Any feature beyond the four enumerated and the supporting
  behaviours above.

## User stories

### US-001: Save a URL with a title
<!-- loom:story id=US-001 status=answered -->

**Story:** As the single user, I want to save a URL together with a
title, so that I can come back to it later without having to remember
the address.

**Supporting decisions:** Q02 (duplicate handling)

**Acceptance criteria:**
1. WHEN the user submits the save form with a non-empty URL and a non-empty title, the system SHALL persist a new bookmark row to SQLite and SHALL render it at the top of the list.
2. IF the submitted URL exactly matches an already-saved bookmark's URL, then the system SHALL reject the save with an inline error next to the URL field and SHALL NOT create a duplicate row.
3. IF the submitted URL or title is empty or whitespace-only, then the system SHALL reject the save with an inline validation error and SHALL NOT create a row.

<!-- loom:story-end id=US-001 -->

### US-002: See all saved bookmarks in one list
<!-- loom:story id=US-002 status=answered -->

**Story:** As the single user, I want to see every bookmark I have
saved in one chronological list, so that I can scan my collection
without navigating between views.

**Supporting decisions:** Q01 (flat list), Q03 (no search), Q05 (newest-first only)

**Acceptance criteria:**
1. WHEN the user loads `http://localhost:3000/`, the system SHALL render every saved bookmark in a single flat list ordered newest-first by creation time.
2. The system shall display each bookmark's title and URL on its row.
3. While the list is empty, the system SHALL display an empty-state message rather than an empty list.

<!-- loom:story-end id=US-002 -->

### US-003: Open a saved bookmark in a new tab
<!-- loom:story id=US-003 status=answered -->

**Story:** As the single user, I want to click a bookmark and have it
open in a new browser tab, so that I do not lose my place in the
bookmarks app.

**Acceptance criteria:**
1. WHEN the user clicks a bookmark's title or URL, the system SHALL open the bookmark's URL in a new browser tab.
2. The system shall preserve the bookmarks list view in the original tab after the click.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a bookmark
<!-- loom:story id=US-004 status=answered -->

**Story:** As the single user, I want to delete a bookmark I no longer
want, so that my list stays focused on the links I still care about.

**Supporting decisions:** Q04 (immutable — delete + re-add is the only edit path)

**Acceptance criteria:**
1. WHEN the user activates the delete control on a bookmark row, the system SHALL remove the corresponding row from SQLite and SHALL remove it from the rendered list.
2. The system shall persist the deletion so the bookmark does not reappear after `npm start` is restarted.

<!-- loom:story-end id=US-004 -->

### US-005: Bookmarks survive server restart
<!-- loom:story id=US-005 status=answered -->

**Story:** As the single user, I want my saved bookmarks to be there
the next time I start the app, so that the list outlives a process
restart or laptop reboot.

**Acceptance criteria:**
1. WHEN the user stops the server and runs `npm start` again, the system SHALL render every bookmark that existed before the stop, in the same newest-first order.
2. The system shall use a single SQLite file on disk as the canonical store for bookmarks.

<!-- loom:story-end id=US-005 -->

## Constraints

Envelope conditions and universal invariants. These are NOT
user-action-shaped and therefore live here, not as stories.

- **Workspace isolation (harness directive — do not relax).** Every
  deliverable file (`package.json`, `tsconfig.json`, source code,
  tests, build output, `node_modules`, the SQLite file, anything
  `npm` writes) MUST be created inside `./app/` relative to
  `seed.md`, i.e. inside
  `.loom/baseline-1779111523-1/app/`. Nothing is written to the repo
  root, to `orchestrator/`, or to any sibling workspace. `npm start`
  and `npm test` MUST be runnable from `./app/`.
- **Stack lock.** TypeScript everywhere. Backend = Node + Express
  single process. Storage = SQLite via `better-sqlite3`. Frontend =
  plain HTML + CSS + vanilla TypeScript, bundled to one JS file via
  `esbuild`; no React / Vue / framework. Tests = Vitest. No
  substitutions.
- **One-command boot.** `npm start` SHALL launch the server on
  `http://localhost:3000` and serve the UI from the same origin.
- **One-command test.** `npm test` SHALL run the Vitest suite to a
  clean exit code from `./app/`.
- **Local-only.** The running system SHALL NOT make outbound network
  calls. No telemetry, no analytics, no remote error reporting, no
  external assets fetched at runtime.
- **Single user, no auth.** The system SHALL NOT implement
  authentication, sessions, or user identity; the listening server
  is intended for `localhost` use only.
- **Minimal surface discipline.** Only the four enumerated features
  and their listed supporting behaviours are implemented. No
  nice-to-haves, no service worker, no PWA manifest, no dark-mode
  toggle (unless it falls out of CSS for free).

## Open ambiguity

The Spec phase resolved every decision the seed flagged for grilling.
A few minor UX details remain that Design / Build can settle locally
without re-entering Spec:

- **URL validation strictness.** The seed does not specify whether
  invalid-looking URLs (e.g. `not a url`) should be rejected at save
  time. Recommended default: minimal validation — non-empty and
  parseable by the WHATWG `URL` constructor; otherwise inline error.
- **Delete confirmation.** The seed does not say whether delete
  should require a confirmation step. Recommended default: one-click
  delete, no confirmation modal, matching the minimal-surface intent.
- **Inline error wording.** The exact copy for the duplicate-URL
  rejection message is unspecified. Recommended default: a short,
  literal message such as "Already bookmarked." next to the URL
  field.

None of these are blockers for Design; each can be locked as a small
Design or Build decision without re-opening Spec.
