---
project: baseline-1779002783-1
created: 2026-05-17
---

# Decisions — baseline-1779002783-1

The five branching decisions the seed explicitly flagged for grilling.
Foundation was trivial: the seed is fully self-contained (stack pinned,
scope pinned, value bar pinned, isolation pinned by harness), so the
Foundation sub-phase added nothing beyond reading the seed itself.

---

## Q01 [Choice]: How should bookmarks be organised?
<!-- loom:question version=1 id=Q01 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** []

What's the issue:
The seed explicitly asks whether bookmarks should be grouped by tags,
categories, or kept as a flat list. The choice changes the data model
(one table vs. two), the API surface (extra endpoints for tag CRUD),
and the UI (filter controls vs. plain list). Flipping later is a
schema migration plus rework.

Current behavior / what's causing it:
Nothing exists yet — greenfield app. The seed bias is "rather ship a
clean four-feature app than a sprawling one." The four named features
do not reference tags or categories, so any organising scheme is
additive surface area beyond what the user asked for.

Options:
  (A) [S, Low]  Flat list (no tags / no categories) — single table, single list view, four-feature surface stays clean
  (B) [M, Med]  Flat tags (many-to-many) — bookmarks table + tags table + join; UI filter chips
  (C) [L, Med]  Hierarchical categories — categories table with parent_id; sidebar tree UI

**Options at a glance**

| Letter | Effort | Risk | Option | Result |
|---|---|---|---|---|
| A | S | Low | Flat list | One table, one list, smallest surface |
| B | M | Med | Flat tags | Two tables, filter UI, modest surface growth |
| C | L | Med | Hierarchical categories | Tree UI, parent_id schema, biggest surface |

**Recommendation:** (A) — keeps the four-feature surface minimal per seed
**Why not the others:** (B) and (C) add organising surface the seed did not request

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: What happens when the user saves a URL that already exists?
<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01]

What's the issue:
If the user submits a URL that matches one already in the bookmarks
table, the system needs a defined behaviour. The seed lists three
candidate behaviours — reject, merge, or allow — and asks the user
to pick. The choice affects the POST endpoint's response shape, the
UI's inline feedback, and the uniqueness constraint on the URL column.

Current behavior / what's causing it:
No table exists yet. With a flat list (Q01=A), URL is the only stable
key for "same bookmark." Merging would require deciding whose title
wins; allowing duplicates would create visual clutter in a list whose
whole purpose is one-glance navigation.

Options:
  (A) [S, Low]  Reject duplicate URLs with an inline error — UNIQUE constraint on url, 4xx response, friendly UI message
  (B) [M, Med]  Merge by keeping the newer title — UPDATE existing row's title + created_at on dup insert
  (C) [S, Low]  Allow duplicates freely — no UNIQUE constraint, list can show the same URL multiple times

**Options at a glance**

| Letter | Effort | Risk | Option | Result |
|---|---|---|---|---|
| A | S | Low | Reject with inline error | Clear feedback, simple constraint, no silent overwrites |
| B | M | Med | Merge keeping newer title | Implicit overwrite, hides user mistakes |
| C | S | Low | Allow duplicates | List clutter, defeats one-glance navigation |

**Recommendation:** (A) — explicit feedback, no silent data mutation, simple to implement
**Why not the others:** (B) silently overwrites user data; (C) clutters the only list view

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Should the UI include a search box?
<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01]

What's the issue:
The seed asks whether a search box is needed or whether a chronological
list is enough at the expected scale. Search adds an input element, a
client-side or server-side filter pipeline, and tests for the filter
edge cases. The seed bias is to keep the surface small.

Current behavior / what's causing it:
This is a single-user local app on the user's laptop. The user is the
only writer, so the list size is bounded by their own attention. The
list is already chronological (Q05 confirms newest-first); ctrl-F in
the browser scans the page in zero engineering effort.

Options:
  (YES) [M, Med]  Add a search box filtering by title or URL substring
  (NO)  [S, Low]  Chronological list only (no search) — rely on browser ctrl-F for ad-hoc lookup

**Options at a glance**

| Letter | Effort | Risk | Option | Result |
|---|---|---|---|---|
| YES | M | Med | Add search box | Filter pipeline + tests; surface growth |
| NO | S | Low | Chronological only | Smallest surface, ctrl-F handles ad-hoc lookup |

**Recommendation:** NO — matches "rather ship clean four-feature app" guidance from the seed
**Why not the other:** YES is nice-to-have but not in the four named features

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Should bookmarks be editable after creation?
<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** []

What's the issue:
The seed asks whether the title and URL of a saved bookmark can be
edited later, or whether bookmarks are immutable once added. Edit
support means a PUT/PATCH endpoint, an edit form (modal or inline),
and tests for the partial-update path. Immutability collapses the
mutation surface to create + delete only.

Current behavior / what's causing it:
Nothing exists yet. The seed names exactly four features: save, list,
open, delete. "Edit" is not in that list. With Q02=A (reject duplicates),
a user who mistyped a URL can simply delete and re-add — a two-click
workaround.

Options:
  (YES) [M, Med]  Editable after creation — adds PUT endpoint, edit form, partial-update tests
  (NO)  [S, Low]  Immutable once added (no edit) — create + delete only; mistype = delete-and-re-add

**Options at a glance**

| Letter | Effort | Risk | Option | Result |
|---|---|---|---|---|
| YES | M | Med | Editable | Adds mutation surface beyond the four named features |
| NO | S | Low | Immutable | Keeps mutation surface at create + delete |

**Recommendation:** NO — sticks to the four named features; delete + re-add covers mistypes
**Why not the other:** YES doubles the mutation surface for a workflow the user can do in two clicks

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Choice]: What sort order should the list use?
<!-- loom:question version=1 id=Q05 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q03]

What's the issue:
The seed asks whether any sort order beyond newest-first is needed.
Multiple sort modes add a sort selector, a stateful sort preference
(in URL or localStorage), and ORDER BY variants on the list endpoint.
Without search (Q03=NO) and without tags (Q01=A), sort is the only
remaining way to reorganise the list.

Current behavior / what's causing it:
With no edit (Q04=NO) and reject-on-duplicate (Q02=A), `created_at`
is monotonic and immutable per row. Newest-first matches a typical
"recent links" reading mental model. Alphabetic or oldest-first are
edge-case preferences not named in the four features.

Options:
  (A) [S, Low]  Newest-first only — single ORDER BY created_at DESC, no UI control
  (B) [M, Med]  Newest-first default, with toggle to oldest-first — adds a sort button + state
  (C) [L, Med]  Newest, oldest, title A→Z, title Z→A — dropdown selector + four ORDER BY branches

**Options at a glance**

| Letter | Effort | Risk | Option | Result |
|---|---|---|---|---|
| A | S | Low | Newest-first only | One ORDER BY, no UI control |
| B | M | Med | Toggle newest/oldest | Adds sort button + state |
| C | L | Med | Four sort modes | Selector + four query branches |

**Recommendation:** (A) — smallest surface, matches the "recent links" mental model
**Why not the others:** (B) and (C) add sort surface the seed did not request

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

*(none)*

## Deferred clarifications

*(none — all five seed-flagged questions resolved)*
