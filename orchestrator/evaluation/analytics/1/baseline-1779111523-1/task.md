---
project: baseline-1779111523-1
phase: plan
created: 2026-05-18
---

# Task Index — baseline-1779111523-1

Authoritative `T-NNN` → story mapping and dependency listing.
Per-task detail lives in `tasks/T-NNN.md`. The kanban view is
`board.md`.

## Mapping

| Task | Title | Type | Satisfies stories | Blocked by | Layers |
| --- | --- | --- | --- | --- | --- |
| T-001 | Bootstrap app workspace and serve empty bookmark list | AFK | US-002, US-005 | — | workspace-glue, server-entry, db-bootstrap, repository, http-routes, client-bundle, static-assets, tests |
| T-002 | Save a URL with title via POST and render newest-first | AFK | US-001 | T-001 | validation, http-routes, repository, client-bundle, tests |
| T-003 | Open bookmark in new tab from list row | AFK | US-003 | T-002 | client-bundle, static-assets, tests |
| T-004 | Delete a bookmark from list and DB | AFK | US-004 | T-002 | http-routes, repository, client-bundle, tests |
| T-005 | Restart persistence end-to-end gate | AFK | US-005 | T-004 | tests |

## Coverage

Every active story in `spec.md ## User stories` is covered:

- US-001 → T-002
- US-002 → T-001
- US-003 → T-003
- US-004 → T-004
- US-005 → T-001 (structural; on-disk SQLite file) + T-005 (acceptance gate)

No cycles. All `blocked-by` references resolve to existing tasks.

## Totals

- Total tasks: 5
- AFK: 5
- HITL: 0
