---
project: baseline-1779088265-1
phase: spec
created: 2026-05-18
---

# Decisions — baseline-1779088265-1

Audit trail of Spec-phase grilling. Stack choices (TypeScript, Node + Express, `better-sqlite3`, vanilla TS frontend bundled by `esbuild`, Vitest) and workspace isolation (everything under `./app/`) come straight from the seed and are NOT branching questions — they appear under Spec's `## Constraints`. The five questions below are exactly the ones the seed asks Spec to put to the user.

## Foundation

The seed and `repo-context.md` cover Foundation completely: single-user local app, no auth, no deploy, four feature primitives (save, list, open in new tab, delete), explicit anti-scope list (no telemetry / analytics / service worker / PWA / dark-mode toggle), workspace-isolation harness constraint. No Foundation questions needed before Branching — the user has already painted the picture in the seed.

## Branching

### Q01 [Choice]: Should bookmarks support tags or categories, or remain a flat list?

<!-- loom:question version=1 id=Q01 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** none

What's the issue:
The seed lists four features (save / list / open / delete) and explicitly asks whether organisation primitives like tags or categories belong in v1. Adding either changes the data model, the create form, the list view, and the storage schema; leaving them out keeps the surface tiny.

Current behavior / what's causing it:
There is no current behavior — this is a greenfield app. With ~tens of bookmarks expected on a single laptop, the cost of scrolling a flat list is low. Tags or categories add a join table or an array column, a tag picker on create, and filter affordances on list — none of which the seed enumerated as features.

Options:
  (A) [S, Low]  Flat list — single `bookmarks` table, no organisation primitive, scroll to find.
  (B) [M, Med]  Tags — many-to-many tags; pick / create tags on save; filter by tag on list.
  (C) [L, Med]  Categories — single category per bookmark; create / manage category set; group list by category.

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Flat list | S | Low | Single `bookmarks` table; no extra UI; matches "keep surface small". |
| (B) Tags | M | Med | Tag picker on save, filter on list, join table in schema. |
| (C) Categories | L | Med | Category management UI, grouped list view, foreign key on bookmark. |

**Recommendation:** (A) — seed says keep surface small; flat list is the smallest organisation primitive
**Why not the others:** Tags / categories add data-model and UI surface area the seed explicitly tried to avoid.

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

### Q02 [Choice]: When the user saves a URL that already exists, what should happen?

<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** Q01

What's the issue:
The seed flags duplicate URLs as a real decision: reject, merge, or allow. Each option implies a different storage invariant (UNIQUE constraint or not), a different UI behaviour on submit, and a different definition of "the same" bookmark. With no edit feature (see Q04), "merge" loses meaning quickly.

Current behavior / what's causing it:
No current behavior — greenfield. Without a uniqueness rule, the list can grow with visually identical rows whose only difference is creation time. With a uniqueness rule, the user gets an immediate signal that the URL is already saved and can act on it.

Options:
  (A) [S, Low]  Reject duplicates — UNIQUE(url) constraint; on conflict, return an inline error.
  (B) [M, Med]  Merge — overwrite the title on the existing row and bump its created_at.
  (C) [S, Low]  Allow duplicates — no constraint; the list shows the URL N times.

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Reject | S | Low | UNIQUE(url) in SQLite; inline error on conflict. |
| (B) Merge | M | Med | Update title + bump created_at on conflict; mixes "save" and "edit". |
| (C) Allow | S | Low | No constraint; list bloats with dupes over time. |

**Recommendation:** (A) — gives the user a clear signal and keeps the data model honest
**Why not the others:** Merge confuses save with edit (and edit is out per Q04); Allow erodes the list's usefulness.

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

### Q03 [Y/N]: Should the v1 UI include a search box?

<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** Q01

What's the issue:
The seed asks whether a flat chronological list is enough at expected size or whether a search box is needed. Search adds an input, a debounced filter, and (at scale) a `LIKE` query — none of it hard, but all of it surface the seed asked to keep small.

Current behavior / what's causing it:
No current behavior — greenfield. Expected size is "tens" on a single laptop. A chronological list of that length is scannable in seconds without filtering; Ctrl-F in the browser already provides substring search over the rendered list for free.

Options:
  (YES) [M, Low]  Add a search box that filters by title / URL substring as the user types.
  (NO)  [S, Low]  Chronological list only; rely on visual scan (and the browser's native Ctrl-F).

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (YES) Search | M | Low | Input + debounced filter; visible feature surface. |
| (NO) No search | S | Low | One less control; Ctrl-F covers substring needs in-page. |

**Recommendation:** NO — at "tens" of bookmarks, the browser's Ctrl-F is the cheaper answer
**Why not the other:** Search is small but unnecessary at this size; adding it bloats the surface the seed asked to keep tiny.

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

### Q04 [Y/N]: Should the user be able to edit a bookmark's title or URL after creation?

<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** Q02

What's the issue:
The seed asks whether bookmarks are immutable after creation or editable. Edit means a second form (or inline edit), a PUT/PATCH route, a "last updated" timestamp, and conflict rules with the UNIQUE(url) constraint from Q02. Immutable means delete-then-recreate covers typo recovery.

Current behavior / what's causing it:
No current behavior — greenfield. The user's escape hatch for typos is to delete and re-add; given the four-feature scope, that round-trip is cheap. Edit doubles the write-surface of the API for marginal UX gain at this scale.

Options:
  (YES) [M, Med]  Editable — add a PUT route + UI edit form; re-check UNIQUE(url) on URL change.
  (NO)  [S, Low]  Immutable — bookmarks are append-only; delete + re-add to fix mistakes.

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (YES) Editable | M | Med | Extra route, extra UI, UNIQUE-constraint conflicts on URL change. |
| (NO) Immutable | S | Low | Append-only; recover from typos via delete + re-add. |

**Recommendation:** NO — keeps writes append-only and avoids the edit-vs-unique-URL conflict path
**Why not the other:** Editing doubles the write surface for a workflow the user can already do with delete + re-add.

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

### Q05 [Choice]: Should the list support any sort order other than newest-first?

<!-- loom:question version=1 id=Q05 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** Q03

What's the issue:
The seed asks whether newest-first is the only sort order needed. Adding a sort control means a dropdown / segmented control in the UI, a `?sort=` query parameter, and tested ordering for each new mode. Newest-first alone needs nothing beyond `ORDER BY created_at DESC`.

Current behavior / what's causing it:
No current behavior — greenfield. With no edit (Q04) and no tags (Q01), the only meaningful axes are creation time and title. Title sort is rarely useful when the user remembers what they recently saved; newest-first matches the "I just saved this" mental model.

Options:
  (A) [S, Low]  Newest-first only — fixed ORDER BY created_at DESC; no sort control.
  (B) [M, Med]  Newest-first + oldest-first toggle — single toggle, two orders.
  (C) [M, Med]  Multi-sort (newest, oldest, title A→Z) — dropdown with three modes.

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Newest-first only | S | Low | No sort control; one query path. |
| (B) +Oldest toggle | M | Med | One control, two orders; modest UI surface. |
| (C) Multi-sort | M | Med | Dropdown + three modes; more test paths. |

**Recommendation:** (A) — matches "I just saved this" mental model and keeps the surface tiny
**Why not the others:** Extra sort modes solve a problem the user has not stated and add UI + test surface.

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

_None._

## Deferred clarifications

_None._

## Revisit log

No consistency-pass triggers fired. Q01–Q05 are mutually reinforcing along the "keep the surface small" axis the seed established and each later answer strengthens (rather than flips) the prior recommendations.
