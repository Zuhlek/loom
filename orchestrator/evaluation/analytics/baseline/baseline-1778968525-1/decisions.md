---
project: baseline-1778968525-1
created: 2026-05-16
phase: spec
---

# Decisions — baseline-1778968525-1

Five branching decisions explicitly requested by the seed. Foundation
context is already pinned by the seed (greenfield, stack fixed, scope
tightly bounded, single-user local-only) and by `repo-context.md`, so no
Foundation questions were generated.

All answers below were resolved via the non-interactive answer queue
(`.answers.yaml`) staged by `/weave --answers`. The queue was consumed in
FIFO order per `phases/spec/methods/grilling.md` §4.

---

## Q01 [Choice]: Should bookmarks have tags / categories or be a flat list?
<!-- loom:question version=1 id=Q01 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed asks whether bookmarks need any organisational metadata beyond a
title + URL. This drives schema shape (one table vs. multiple), the UI
(does a sidebar / filter chip row exist?), and the surface area of the
CRUD API. Picking now avoids a schema migration later.

Current behavior / what's causing it:
Greenfield; no existing data model. The seed bias is explicitly "clean
four-feature app, no nice-to-haves I did not ask for." Tags add a
join table, a tag-CRUD surface, and a filter UI — non-trivial scope.
Categories collapse to a single nullable string column but still need a
picker and a "manage categories" flow.

Options:
  (A) [S, Low]  Flat list — one bookmarks table, no extra UI, smallest surface
  (B) [M, Med]  Tags (many-to-many) — `tags` + `bookmark_tags` tables, tag chips, filter bar
  (C) [S, Med]  Single category column — one nullable string, dropdown picker, simple filter

**Options at a glance**

| Letter | Effort | Risk | Result |
| --- | --- | --- | --- |
| A | S | Low | Flat list — minimal schema and UI |
| B | M | Med | Many-to-many tags — extra tables, chips, filter UI |
| C | S | Med | Single category column — dropdown + simple filter |

**Recommendation:** (A) — matches the seed's explicit "keep surface small" bias.
**Why not the others:** (B) and (C) introduce filter UI the seed did not ask for.

**Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: When the user saves a URL that already exists, what should happen?
<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01]

What's the issue:
A single-user bookmarks tool will routinely see "I already bookmarked
this." The save handler needs a defined behaviour for the collision. The
three reasonable shapes are reject, merge (update title on existing row),
or allow as a separate row. Each implies a different UI affordance and a
different uniqueness constraint at the SQLite layer.

Current behavior / what's causing it:
No prior schema. SQLite supports a `UNIQUE(url)` constraint cheaply, which
makes "reject" trivial (catch the constraint error, surface a message).
"Merge" requires an upsert plus a deterministic title-precedence rule.
"Allow duplicates" means no constraint at all, which feels wrong for a
single-user tool where two identical URLs serve no purpose.

Options:
  (A) [S, Low]  Reject duplicate URLs with an inline error — `UNIQUE(url)` + flash message
  (B) [M, Med]  Merge — upsert on URL, overwrite title with the new value
  (C) [S, Low]  Allow duplicates — no constraint, list shows both rows

**Options at a glance**

| Letter | Effort | Risk | Result |
| --- | --- | --- | --- |
| A | S | Low | Reject — UNIQUE(url) plus inline error |
| B | M | Med | Merge — upsert and overwrite title |
| C | S | Low | Allow — both rows live independently |

**Recommendation:** (A) — clearest UX feedback, simplest schema invariant.
**Why not the others:** (B) silently mutates user data; (C) clutters the list.

**Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Do you need a search box, or is a chronological list enough?
<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01]

What's the issue:
Search affects both UI (a text input + result-state handling) and the
server (a `LIKE %q%` route or a client-side filter). For a single-user
tool with a flat list, the right answer depends on how many rows you
expect to keep. Below ~50 bookmarks, ctrl-F on the page is sufficient.

Current behavior / what's causing it:
No data yet. The flat-list decision (Q01) removed the tag-filter affordance,
which makes "find a specific bookmark" rely either on visual scan,
browser-native find, or an in-app search box. Adding search is roughly a
half-day: input, GET `/api/bookmarks?q=`, client render. Skipping it keeps
the UI to a list + new-bookmark form.

Options:
  (YES) [M, Low] Add a search box — text input, server-side LIKE filter on title+URL
  (NO)  [S, Low] Chronological list only — ctrl-F or browser scroll suffices

**Options at a glance**

| Letter | Effort | Risk | Result |
| --- | --- | --- | --- |
| YES | M | Low | Search box — input + LIKE filter |
| NO | S | Low | List only — rely on browser find |

**Recommendation:** NO — matches the seed's "keep surface small" bias for now.
**Why not the other:** YES is cheap but adds a surface the user hasn't validated needing.

**Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Should the user be able to edit a saved bookmark's title or URL after creation?
<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
Edit-after-create adds an `UPDATE /api/bookmarks/:id` route, an
inline-edit affordance in the UI (or a separate edit view), and the
related state management. Immutable bookmarks remove that whole surface
— if a title is wrong, the user deletes + re-adds.

Current behavior / what's causing it:
No persisted rows. The four canonical operations the seed lists are
save, list, open, delete — `update` is conspicuously absent. Reading
"keep the surface small" together with that omission strongly suggests
immutability is the intended posture. Edit can be added in a follow-up
iteration if real usage demands it.

Options:
  (YES) [M, Med] Editable — add update endpoint + inline edit UI
  (NO)  [S, Low] Immutable — wrong entries are deleted and re-added

**Options at a glance**

| Letter | Effort | Risk | Result |
| --- | --- | --- | --- |
| YES | M | Med | Editable — adds UPDATE endpoint and edit UI |
| NO | S | Low | Immutable — delete-and-re-add |

**Recommendation:** NO — the seed lists four operations and edit is not one of them.
**Why not the other:** YES adds endpoint + UI for a workflow the seed did not call out.

**Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Choice]: Do you need any sort order other than newest-first?
<!-- loom:question version=1 id=Q05 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q03]

What's the issue:
Sort order drives the list's default `ORDER BY` clause and whether a
sort-toggle UI element exists. Newest-first is the obvious default for a
recency-driven save-and-recall workflow. Alternatives (alphabetical,
oldest-first, manual reorder) each carry a UI affordance cost.

Current behavior / what's causing it:
No rows yet. Newest-first is `ORDER BY created_at DESC`, single
implementation. A toggle (e.g. newest-first ↔ alphabetical) adds a dropdown
or button, persisted preference, and a second query path. Manual reorder
requires a `position` column and drag-and-drop, which is far outside the
"clean four-feature" envelope.

Options:
  (A) [S, Low]  Newest-first only — single ORDER BY, no UI affordance
  (B) [M, Low]  Newest-first + alphabetical toggle — dropdown, two ORDER BY paths
  (C) [L, Med]  Manual reorder — `position` column, drag handles, persistence

**Options at a glance**

| Letter | Effort | Risk | Result |
| --- | --- | --- | --- |
| A | S | Low | Newest-first only — single ORDER BY |
| B | M | Low | Toggle to alphabetical — dropdown and second path |
| C | L | Med | Manual drag-reorder — position column and DnD |

**Recommendation:** (A) — smallest surface, matches the seed's bias.
**Why not the others:** (B) and (C) add UI the seed did not request.

**Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

*(none captured)*

## Deferred clarifications

*(none — queue resolved every branching question cleanly)*
