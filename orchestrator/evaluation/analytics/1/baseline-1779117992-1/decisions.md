---
project: baseline-1779117992-1
created: 2026-05-18
phase: spec
---

# Decisions — Bookmarks

Five branching decisions, all enumerated explicitly in the seed. Foundation
sub-phase was minimal: the seed already pins stack, run surface, scope, and
deployment posture (local-only, single user, no auth). No Foundation
questions surfaced above the G1 ("would change the plan") bar.

---

## Q01 [Choice]: Tags/categories or flat list?
<!-- loom:question version=1 id=Q01 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The user explicitly asked whether bookmarks should carry tags or categories
or just live in one flat list. This decision sets the data model shape and
the UI surface (filter chips, sidebar, none) before any code is written.

Current behavior / what's causing it:
Nothing exists yet. The seed asks for a small, clean four-feature app and
warns against sprawling additions. Tags add a join table, a tag-management
UI, and a filter surface; categories add a single foreign key but still
need a category-management UI. A flat list keeps the schema to one table
and the UI to one list.

Options:
  (A) [S, Low]  Flat list — one `bookmarks` table, no tagging surface, matches the "keep surface small" steer
  (B) [M, Med]  Single category per bookmark — one extra table + a category picker in the form
  (C) [L, Med]  Many-to-many tags — join table, tag manager, filter chips on the list view

**Options at a glance**

| Option | Effort | Risk | Result |
|---|---|---|---|
| (A) Flat list | S | Low | One table, no categorisation UI |
| (B) Single category | M | Med | Two tables, category picker, single-select filter |
| (C) Many-to-many tags | L | Med | Three tables, tag manager, multi-select filter |

**Recommendation:** (A) — flat list keeps the surface small and matches the seed's explicit anti-sprawl steer.
**Why not the others:** (B)/(C) add a management UI the seed did not ask for; can be added later if needed.
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: How should duplicate URLs be handled?
<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The user asked what should happen when they try to save a URL that is
already in the list. The three viable behaviours are reject, merge (update
the existing row's title / timestamp), or just allow duplicates. The
decision shapes the POST endpoint contract and the form's error surface.

Current behavior / what's causing it:
With a flat-list schema (Q01 = A), a URL uniqueness constraint is one
`UNIQUE` index on the `url` column. Rejecting is a 409 with an inline form
error. Merging needs a "do you want to update the title?" path. Allowing
duplicates means no uniqueness constraint and the list grows with near-dupes.

Options:
  (A) [S, Low]  Reject with inline error — UNIQUE constraint, 409 from server, message under the URL field
  (B) [M, Med]  Merge: update the existing row's title, bump its timestamp — no new row, surface a "updated existing bookmark" toast
  (C) [S, Low]  Allow duplicates — no constraint, list can contain the same URL multiple times

**Options at a glance**

| Option | Effort | Risk | Result |
|---|---|---|---|
| (A) Reject | S | Low | UNIQUE index, inline error, no surprise mutations |
| (B) Merge | M | Med | Silent overwrite of titles, harder to undo |
| (C) Allow dupes | S | Low | List clutters with near-identical rows |

**Recommendation:** (A) — reject is the least surprising and the only option that preserves user intent without asking.
**Why not the others:** (B) silently mutates existing data; (C) clutters the list and undermines the "save once" mental model.
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Add a search box?
<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The user asked whether a search box is needed or whether a chronological
list is enough at this size. Search adds an input field, client-side
filtering (or a server query), and a "no matches" state. At single-user
scale on a laptop the list is unlikely to exceed a few hundred rows.

Current behavior / what's causing it:
Nothing exists. A chronological list with newest-first ordering (see Q05)
makes recent saves trivially findable. A search box becomes useful past
maybe 100-200 rows when scroll-and-scan stops working; the seed gives no
signal the user is at that scale.

Options:
  (YES) [M, Low]  Add a search box — text input, debounced client-side filter on title and URL, "no matches" empty state
  (NO)  [S, Low]  Chronological list only — newest-first list, browser Ctrl-F covers any ad-hoc search

**Options at a glance**

| Option | Effort | Risk | Result |
|---|---|---|---|
| (YES) Search box | M | Low | Filter input + empty state + debounce |
| (NO) No search | S | Low | Newest-first list only; user can Ctrl-F |

**Recommendation:** NO — chronological list is enough at this scale and matches the "keep the surface small" steer.
**Why not the other:** YES is cheap but the seed explicitly warns against features the user didn't ask for.
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Allow editing a bookmark after creation?
<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The user asked whether bookmarks should be editable (title / URL) after
creation or immutable. Editing adds a PATCH endpoint, an edit form, and an
"unsaved changes" state. Immutability collapses correction to delete-and-
re-add.

Current behavior / what's causing it:
Nothing exists. With duplicate rejection (Q02 = A), correcting a URL
typo means deleting the wrong row first then adding the right one — two
clicks instead of one edit. The seed's four features (save, list, open,
delete) do not include edit; adding it would expand the surface.

Options:
  (YES) [M, Low]  Editable — PATCH endpoint, edit affordance per row, edit form with cancel
  (NO)  [S, Low]  Immutable — fix typos via delete-then-readd, smaller surface

**Options at a glance**

| Option | Effort | Risk | Result |
|---|---|---|---|
| (YES) Editable | M | Low | PATCH route + edit form + cancel handling |
| (NO) Immutable | S | Low | Delete-then-readd to fix typos |

**Recommendation:** NO — the seed enumerates four features and edit is not one of them; immutability shrinks the surface.
**Why not the other:** YES is mildly nicer for typo fixes but expands the API and UI past the seed's stated four features.
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Choice]: What sort order beyond newest-first?
<!-- loom:question version=1 id=Q05 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The user asked whether any sort order other than newest-first is needed.
Adding alternate sorts (alphabetical, oldest-first, by domain) means a
sort-control widget and either client-side resorts or per-sort SQL ORDER
BY. The default already serves the "find what I just saved" path.

Current behavior / what's causing it:
With chronological-only viewing (Q03 = NO) and immutable rows (Q04 = NO),
the list is a pure append-and-delete log. Newest-first matches how the
user thinks about recent saves. Adding sort controls would add UI surface
the seed already warned against.

Options:
  (A) [S, Low]  Newest-first only — single ORDER BY created_at DESC, no sort widget
  (B) [M, Low]  Newest-first + alphabetical toggle — one sort control, two ORDER BY queries
  (C) [M, Low]  Newest-first + multiple sorts (alpha, oldest, domain) — full sort dropdown

**Options at a glance**

| Option | Effort | Risk | Result |
|---|---|---|---|
| (A) Newest only | S | Low | One ORDER BY, no widget |
| (B) Newest + alpha | M | Low | Two-state toggle |
| (C) Multi-sort | M | Low | Full sort dropdown |

**Recommendation:** (A) — newest-first matches the user's mental model and avoids unrequested UI.
**Why not the others:** (B)/(C) add a sort widget the seed did not ask for; can be added later if needed.
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

None.

## Deferred clarifications

None.
