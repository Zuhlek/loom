---
project: baseline-1779428627-1
created: 2026-05-22
---

# Decisions — baseline-1779428627-1

Spec-phase grilling decisions for the local-only Bookmarks app. Each `## Q<n>`
block carries a `loom:question` marker, the briefing fields, the
recommendation, and the user's answer in a `loom:answer-slot` region.

The five branching questions below correspond 1:1 to the open decisions the
seed (`seed.md`) explicitly asked Spec to surface rather than silently choose.
The answers were resolved through the standard `AskUserQuestion` dispatch (the
non-interactive baseline harness staged them in `.answers.yaml`, consumed
FIFO by question id).

---

## Q01 [Y/N]: Should bookmarks have tags or categories instead of a flat list?
<!-- loom:question version=1 id=Q01 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed asks whether bookmarks need tags or categories, or whether a flat
list suffices. Adding tagging touches the schema (a join table or array
column), the create form (a tag input), and the list view (tag chips and
filtering). Decided once, hard to retrofit cleanly later.

Current behavior / what's causing it:
Nothing exists yet — this is a greenfield single-user laptop app with a
four-feature surface (save, list, open, delete). The seed explicitly says
"keep the surface small" and "I would rather you ship a clean four-feature
app than a sprawling one." No collaborators, no sharing, no scale pressure.

Options:
  (YES) [M, Med] Add tags or categories — richer organisation, extra schema and UI surface, harder to ship clean
  (NO)  [S, Low] Flat list — minimal schema, four-feature surface stays clean, organisation is by recency only

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (YES) Tags / categories | M | Med | Richer organisation; extra schema + UI; sprawl risk |
| (NO) Flat list | S | Low | Minimal schema; matches "keep the surface small" directive |

**Recommendation:** NO — the seed's small-surface directive outweighs nice-to-have organisation
**Why not the other:** Tags would be useful at scale but this is a single-user laptop app

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: How should the system handle a save when the URL already exists?
<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed flags duplicate URL handling as an explicit open question with
three named options: reject, merge, or allow duplicates. The choice
determines what happens at the database layer (UNIQUE constraint or not),
what the user sees in the UI (silent allow vs. inline error vs. merge
prompt), and how the create endpoint signals failure.

Current behavior / what's causing it:
There is no save endpoint yet. With a flat list (Q01) and no edit
capability (Q04), duplicates cannot be cleaned up after the fact except by
deleting one of the pair — so allowing duplicates would force the user to
do janitorial work the app should prevent.

Options:
  (A) [S, Low] Reject duplicate URLs with an inline error — UNIQUE constraint on url; create form shows "already saved" message
  (B) [M, Med] Merge — update the title of the existing bookmark and re-promote it to the top of the list
  (C) [S, Low] Allow duplicates — no constraint; two rows can share a URL

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Reject | S | Low | UNIQUE constraint; inline error; cleanest semantics |
| (B) Merge | M | Med | Title overwrite + re-promote; surprising for the user |
| (C) Allow | S | Low | Duplicates clutter the list with no way to dedupe |

**Recommendation:** (A) — UNIQUE constraint is one line of SQL and the failure mode is obvious to the user
**Why not the others:** Merge silently mutates existing rows; allow-duplicates pushes janitorial work to the user

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Do we need a search box, or is the chronological list enough?
<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01]

What's the issue:
The seed asks whether a search box is needed. Search means a text input
above the list, client-side filtering across title (and probably URL), and
empty-state messaging when filter matches nothing. Without search, the list
is purely a scroll-and-eyeball surface.

Current behavior / what's causing it:
This is a single-user laptop app. With a flat list (Q01) and immutable
titles (Q04), bookmark count grows slowly and recall is mostly by recency.
Search becomes useful at hundreds of rows; the seed explicitly says "is a
chronological list enough at this size" — i.e. small expected dataset.

Options:
  (YES) [S, Low] Add a search box — filters the list by case-insensitive substring match on title + url
  (NO)  [S, Low] Chronological list only — newest-first, no filter input; user scrolls to find

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (YES) Search | S | Low | Extra input + filter logic; useful at scale, premature now |
| (NO) No search | S | Low | Chronological scroll; matches the "small surface" directive |

**Recommendation:** NO — the dataset is small enough that recency-ordered scrolling beats premature filter UI
**Why not the other:** Search would be cheap to add but the seed asks Spec not to silently choose nice-to-haves

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Can the user edit a saved bookmark's title or URL after creation?
<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed asks whether bookmarks are editable post-creation or immutable.
Editing requires an `update` endpoint (PATCH /bookmarks/:id), an edit form
in the UI (inline or modal), and re-validation of the URL on edit.
Immutability means typos are fixed by delete + re-add.

Current behavior / what's causing it:
With reject-on-duplicate (Q02), a typo'd URL becomes a row that the user
must explicitly delete to re-add. The cost of immutability is one extra
click per typo, against the recurring cost of a second editable form, a
PATCH endpoint, and the schema question of whether URL is editable too
(which interacts with the UNIQUE constraint from Q02).

Options:
  (YES) [M, Med] Editable — PATCH endpoint, edit form, conflict handling when edited URL collides with another row
  (NO)  [S, Low] Immutable — fix typos via delete + re-add; no PATCH endpoint; no edit form

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (YES) Editable | M | Med | Extra endpoint + form + UNIQUE-on-edit conflict surface |
| (NO) Immutable | S | Low | Simpler surface; typo cost = one delete + one re-add |

**Recommendation:** NO — immutability keeps the surface to four features and avoids the edit-collides-with-existing case
**Why not the other:** Editing is a real ergonomic win but the seed favours small-surface over ergonomic polish

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Y/N]: Do we need any sort order other than newest-first?
<!-- loom:question version=1 id=Q05 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01, Q03]

What's the issue:
The seed asks whether sort orders other than newest-first are needed.
Multiple sort orders means a sort selector in the UI, a sort-key
parameter on the list endpoint, and additional indexes on the SQLite
table (or an `ORDER BY` over the chosen column).

Current behavior / what's causing it:
With a flat list (Q01), no search (Q03), and immutable rows (Q04), the
only meaningful sort keys would be by-title (alphabetical) or by-url. With
a small dataset and recency-dominated recall, alphabetical sorting is
mostly noise.

Options:
  (YES) [M, Low] Multiple sort orders — add a sort selector (newest, oldest, title A→Z) and a sort param on the list endpoint
  (NO)  [S, Low] Newest-first only — single ORDER BY created_at DESC; no sort selector

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (YES) Multiple orders | M | Low | Sort selector + endpoint param; UI complexity grows |
| (NO) Newest-first only | S | Low | Single ORDER BY; UI stays a plain list |

**Recommendation:** NO — newest-first matches the recency-dominated recall pattern for a personal bookmarks list
**Why not the other:** Multiple sort orders are easy to add but cost a selector that adds clutter for unclear benefit

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

*(none)*

## Deferred clarifications

*(none — all five seeded branching questions resolved)*
