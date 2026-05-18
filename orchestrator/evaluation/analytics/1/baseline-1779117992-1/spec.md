---
project: baseline-1779117992-1
created: 2026-05-18
phase: spec
---

# Spec — Bookmarks

## What we're building

A tiny local-only Bookmarks web app for a single user on their own laptop.
Run with `npm start`, served at `http://localhost:3000`, UI on the same
origin. Four user-facing features: save a URL with a title, list saved
bookmarks, open one in a new tab, delete one. Storage is a SQLite file
on disk next to the server. No auth, no deploy, no telemetry, no
nice-to-haves beyond what the user explicitly asked for.

## Users and value

Single user — the person running the app on their laptop. Value is a
zero-friction personal stash for URLs they want to keep, viewable as a
chronological list and openable in a new tab. The list survives restarts
because it lives in SQLite. Trade-off: the user accepts that the app does
nothing for them across devices, has no auth, and has no search; in
exchange they get a four-feature surface that boots in one command and
never asks them to think about it.

## Scope

In scope:

- Save a bookmark consisting of a URL and a title.
- See every saved bookmark in a single chronological list, newest first.
- Open a saved bookmark in a new browser tab.
- Delete a saved bookmark.
- SQLite persistence to a file next to the server (`./bookmarks.sqlite`
  or similar — exact path is a Design decision, file MUST live inside
  `./app/`).
- One `npm start` command boots the server on `http://localhost:3000` and
  serves the UI from the same origin.
- One `npm test` command runs the Vitest suite.
- Reject saves whose URL matches an existing bookmark (inline error in
  the form).

Out of scope (explicit):

- Tags or categories on bookmarks.
- Search box of any kind.
- Editing a bookmark after creation (titles and URLs are immutable; fix
  typos via delete-then-readd).
- Any sort order other than newest-first.
- Auth, user accounts, multi-user, deploy targets.
- Telemetry, analytics, service workers, PWA manifest, dark-mode toggle
  (unless dark mode falls out of the chosen CSS for free).
- Any framework (React, Vue, etc.). UI is plain HTML + CSS + vanilla
  TypeScript bundled by `esbuild`.

## Out of scope

See "Out of scope (explicit)" in the Scope section above. Restated here
for the contract:

- No tags / categories / folders.
- No search.
- No edit-after-create.
- No sort controls beyond the default newest-first.
- No auth, no multi-user, no deploy.
- No telemetry, no analytics, no PWA features, no service worker.
- No frontend framework.

## User stories

### US-001: Save a URL with a title
<!-- loom:story id=US-001 status=answered -->

**Story:** As the single user of my local Bookmarks app, I want to save a URL together with a title, so that I can keep a personal stash of pages I want to come back to.

**Supporting decisions:** Q01 (flat list), Q02 (duplicate handling), Q04 (immutable after save)

**Acceptance criteria:**
1. When the user submits the new-bookmark form with a non-empty title and a syntactically valid URL, the system SHALL persist a new row to SQLite and append it to the visible list as the newest entry.
2. If the submitted URL matches the URL of an existing bookmark, then the system SHALL reject the submission with an inline error message under the URL field and SHALL NOT modify any existing row.
3. If the submitted URL is syntactically invalid or the title is empty, then the system SHALL reject the submission with an inline error and SHALL NOT call the server.
4. The system shall treat saved bookmarks as immutable; once created, a bookmark's title and URL are not editable.

<!-- loom:story-end id=US-001 -->

### US-002: See all saved bookmarks in one list
<!-- loom:story id=US-002 status=answered -->

**Story:** As the single user, I want to see every bookmark I have saved in one chronological list, so that I can find recent saves at a glance without thinking about navigation.

**Supporting decisions:** Q01 (flat list), Q03 (no search), Q05 (newest-first only)

**Acceptance criteria:**
1. When the user loads `http://localhost:3000/`, the system SHALL render every saved bookmark as a single flat list ordered newest-first by creation time.
2. The system shall not provide tag filters, category filters, search inputs, or alternate sort controls.
3. When the bookmarks table is empty, the system SHALL render an empty-state message instead of an empty list element.

<!-- loom:story-end id=US-002 -->

### US-003: Open a saved bookmark in a new tab
<!-- loom:story id=US-003 status=answered -->

**Story:** As the single user, I want to open a saved bookmark in a new browser tab, so that I can read it without leaving the Bookmarks list.

**Acceptance criteria:**
1. When the user activates a bookmark row's open affordance, the system SHALL open the bookmark's URL in a new browser tab.
2. The system shall preserve the Bookmarks list page in the original tab when an open action is invoked.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a bookmark I no longer want
<!-- loom:story id=US-004 status=answered -->

**Story:** As the single user, I want to delete a bookmark I no longer need, so that the list stays curated to URLs I still care about.

**Supporting decisions:** Q04 (no edit — delete-and-readd is the typo-fix path)

**Acceptance criteria:**
1. When the user activates a bookmark row's delete affordance, the system SHALL remove the row from SQLite and from the visible list.
2. If the deletion targets a bookmark id that no longer exists (race or stale UI), then the system SHALL return a 404 and the UI SHALL refresh the list to reflect the current state.
3. The system shall not require a multi-step confirmation; a single delete action is final.

<!-- loom:story-end id=US-004 -->

## Constraints

Universal envelope conditions — invariants that apply across stories and
do not fit a user-action-shaped story:

- **Workspace isolation (harness constraint, must not relax).** All
  deliverable files for this run — `package.json`, `tsconfig.json`,
  source code, tests, build output, `node_modules`, the SQLite file,
  anything `npm` writes — MUST be created inside `./app/` relative to
  the seed file's location, i.e. inside
  `.loom/baseline-1779117992-1/app/`. No files may be written to the
  repo root, to `orchestrator/`, or to any sibling workspace. `npm start`
  and `npm test` MUST be runnable from `./app/`.
- **Stack pin (from seed, no substitutions).** TypeScript everywhere;
  Node + Express single-process backend; SQLite via `better-sqlite3`
  with the database file on disk next to the server; frontend is plain
  HTML + CSS + vanilla TypeScript bundled into one JS file by `esbuild`;
  no frontend framework; Vitest for tests.
- **Run-command pin.** `npm start` boots the server on
  `http://localhost:3000` and serves the UI from the same origin.
  `npm test` runs Vitest.
- **Locality.** Single process, single user, single machine. No external
  network calls at runtime beyond what the UI does when the user opens a
  saved bookmark in a new tab.
- **No nice-to-haves.** No telemetry, no analytics, no service worker,
  no PWA manifest, no dark-mode toggle unless it falls out of the
  chosen CSS for free.

## Open ambiguity

None. The seed pinned stack, run commands, scope, and deployment
posture; the five branching questions (tags, duplicates, search, edit,
sort) are all resolved in `decisions.md`. Design can proceed without
redefining intent.
