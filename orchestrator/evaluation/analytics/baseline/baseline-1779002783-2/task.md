---
project: baseline-1779002783-2
phase: plan
---

# Task Index — baseline-1779002783-2

Index of the 10 planned tasks. Source of truth for each task is the
file at `tasks/T-NNN.md`. This file mirrors IDs, titles, dependencies,
and the story-coverage mapping for fast scanning.

## Tasks

| ID | Title | Type | Status | Blocked by | Satisfies |
| --- | --- | --- | --- | --- | --- |
| T-001 | Scaffold `app/` workspace | AFK | Backlog | — | US-005 |
| T-002 | SQLite storage + idempotent migration | AFK | Backlog | T-001 | US-005 |
| T-003 | List bookmarks slice (GET) | AFK | Backlog | T-002 | US-002 |
| T-004 | Create bookmark slice (POST + validation + duplicate) | AFK | Backlog | T-002 | US-001 |
| T-005 | Delete bookmark slice (DELETE + not-found) | AFK | Backlog | T-002 | US-004 |
| T-006 | Static shell + client bootstrap | AFK | Backlog | T-001, T-003 | US-002 |
| T-007 | Client create-form flow + inline errors | AFK | Backlog | T-004, T-006 | US-001 |
| T-008 | Client list render + open-in-new-tab | AFK | Backlog | T-003, T-006 | US-002, US-003 |
| T-009 | Client delete control + inline not-found | AFK | Backlog | T-005, T-006 | US-004 |
| T-010 | End-to-end smoke + restart persistence | AFK | Backlog | T-003, T-004, T-005 | US-005 |

## Story → task mapping (coverage)

| Story | Covering tasks |
| --- | --- |
| US-001 | T-004, T-007 |
| US-002 | T-003, T-006, T-008 |
| US-003 | T-008 |
| US-004 | T-005, T-009 |
| US-005 | T-001, T-002, T-010 |

## DAG (topological order)

```
T-001
├── T-002
│   ├── T-003 ─┬─→ T-006 ─┬─→ T-007
│   │         │           ├─→ T-008
│   │         │           └─→ T-009
│   │         └─→ T-008
│   ├── T-004 ─→ T-007 / T-010
│   └── T-005 ─→ T-009 / T-010
└── T-006 (also depends on T-001)
T-010 depends on T-003, T-004, T-005.
```

No cycles. T-010 is the only terminal node aside from the three client
leaves (T-007, T-008, T-009).

## Counts

- Total tasks: 10
- AFK: 10
- HITL: 0
