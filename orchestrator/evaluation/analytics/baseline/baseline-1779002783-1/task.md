---
project: baseline-1779002783-1
phase: plan
created: 2026-05-17
---

# Task Index — Bookmarks

## T-NNN → US-NNN coverage map

| Task  | Title                                              | Satisfies stories             |
|-------|----------------------------------------------------|-------------------------------|
| T-001 | Bootstrap ./app/ workspace                         | (foundational — unblocks all) |
| T-002 | SQLite persistence layer                           | US-001, US-002, US-004        |
| T-003 | Validation helpers                                 | US-001                        |
| T-004 | Express skeleton + static + error mapper           | US-001, US-002, US-003, US-004 |
| T-005 | GET /api/bookmarks list                            | US-002                        |
| T-006 | POST /api/bookmarks create                         | US-001                        |
| T-007 | DELETE /api/bookmarks/:id                          | US-004                        |
| T-008 | Frontend bundle wiring                             | (foundational for UI)         |
| T-009 | Frontend list + empty state + open-in-new-tab      | US-002, US-003                |
| T-010 | Frontend create form + inline error                | US-001                        |
| T-011 | Frontend delete control + re-fetch                 | US-004                        |
| T-012 | npm start entrypoint + isolation smoke             | US-001, US-002, US-003, US-004 |

### Story-coverage cross-check

- **US-001 (save a URL with a title):** T-002, T-003, T-006, T-010, T-012
- **US-002 (view all in a list):** T-002, T-005, T-009, T-012
- **US-003 (open in a new tab):** T-009, T-012
- **US-004 (delete a bookmark):** T-002, T-007, T-011, T-012

Every active `US-NNN` has at least one delivering task.

## Blocked-by DAG

```
T-001 (no deps)
  ├── T-002, T-003, T-008
  │     │     │       │
  │     ├──── T-004 ──┤
  │     │     │       │
  │     ├── T-005 ────┤
  │     ├── T-006 ────┤
  │     └── T-007 ────┤
  │           │       │
  │           ├── T-009 (needs T-005 + T-008)
  │           ├── T-010 (needs T-006 + T-008 + T-009)
  │           └── T-011 (needs T-007 + T-009)
  │                 │
  └──────────────── T-012 (needs T-005..T-011)
```

Explicit `blocked-by` adjacency:

- T-001: []
- T-002: [T-001]
- T-003: [T-001]
- T-004: [T-001, T-002, T-003]
- T-005: [T-002, T-004]
- T-006: [T-002, T-003, T-004]
- T-007: [T-002, T-004]
- T-008: [T-001]
- T-009: [T-005, T-008]
- T-010: [T-006, T-008, T-009]
- T-011: [T-007, T-009]
- T-012: [T-005, T-006, T-007, T-008, T-009, T-010, T-011]

Validated: every dependency resolves to a declared task; no cycles
(strict ordinal layering by T-NNN).
