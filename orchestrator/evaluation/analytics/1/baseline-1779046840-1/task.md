---
project: baseline-1779046840-1
phase: plan
created: 2026-05-17T21:50:00Z
---

# Task index — baseline-1779046840-1

Stable task IDs, their dependencies, the user stories they satisfy,
and their layer scope. Mirrors `tasks/T-*.md`. Read this for an
at-a-glance map of the work graph; read the per-task file for the
behaviour-level test sketch and full acceptance criteria.

## Tasks

| ID | Title | Type | Blocked by | Satisfies stories | Touches layers |
| --- | --- | --- | --- | --- | --- |
| T-001 | Scaffold app workspace with build/test/start scripts | AFK | — | US-001, US-002, US-003, US-004 | tooling |
| T-002 | SQLite schema and db module with UNIQUE(url) | AFK | T-001 | US-001, US-002, US-004 | server-db |
| T-003 | GET /api/bookmarks returns newest-first list | AFK | T-002 | US-002 | server-routes, server-app |
| T-004 | POST /api/bookmarks with validation and 409 duplicate | AFK | T-003 | US-001 | server-routes |
| T-005 | DELETE /api/bookmarks/:id with 404 on missing | AFK | T-003 | US-004 | server-routes |
| T-006 | Static file serving and index.html shell | AFK | T-001 | US-002, US-003 | server-static, client-shell |
| T-007 | Client api wrapper and dom render helpers | AFK | T-006 | US-001, US-002, US-003, US-004 | client-api, client-dom |
| T-008 | Render bookmarks list and empty state on page load | AFK | T-003, T-007 | US-002 | client-main, client-dom |
| T-009 | Save form with inline validation, duplicate error, optimistic prepend | AFK | T-004, T-008 | US-001 | client-main, client-dom |
| T-010 | Open bookmark in new tab via title link | AFK | T-008 | US-003 | client-dom |
| T-011 | Delete control removes row with non-fatal 404 handling | AFK | T-005, T-008 | US-004 | client-main, client-dom |
| T-012 | End-to-end smoke gate: install, build, npm test green | AFK | T-002, T-003, T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011 | US-001, US-002, US-003, US-004 | tooling, server-app, client-main |

## Story coverage

- US-001 (save) → T-004, T-009 (foundations T-001, T-002, T-006, T-007 unblock)
- US-002 (list newest-first) → T-003, T-008
- US-003 (open in new tab) → T-010
- US-004 (delete) → T-005, T-011

Every active story has at least one task. Foundation tasks (T-001,
T-002, T-006, T-007) carry every story they enable in their
`satisfies-stories` field because their absence would block delivery
of those stories' acceptance criteria; their behaviour-level test
sketches assert this enabling property, not the user-visible
acceptance criterion (which is asserted by the slice that consumes
them).

## DAG validation

- All `blocked-by` references resolve to existing tasks.
- The graph is acyclic (a topological order is T-001, T-002, T-003,
  T-004, T-005, T-006, T-007, T-008, T-010, T-009, T-011, T-012).
- T-012 is the terminal node and depends on every other task.
