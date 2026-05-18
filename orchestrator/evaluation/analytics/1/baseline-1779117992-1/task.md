---
project: baseline-1779117992-1
created: 2026-05-18
phase: plan
---

# Task index — Bookmarks

Mirrors `tasks/T-*.md` and the `T-NNN` → `US-NNN` story mapping. Build
consumes `board.md` to pick ready work; this file is the audit view.

## Tasks

| ID | Title | Type | Status | Blocked by | Satisfies | Touches |
| --- | --- | --- | --- | --- | --- | --- |
| T-001 | Scaffold `./app/` package, tsconfig, esbuild, Vitest config | AFK | Backlog | — | — (foundation) | scaffold |
| T-002 | Open SQLite + run schema migration + implement bookmarks repo | AFK | Backlog | T-001 | US-001, US-002, US-004 | db, repo, tests |
| T-003 | Express app shell, static asset serving, central error envelope | AFK | Backlog | T-001 | — (foundation) | app, web-html, tests |
| T-004 | Save bookmark end-to-end: POST route + form submit + duplicate/invalid inline errors | AFK | Backlog | T-002, T-003 | US-001 | route, web-ts, tests |
| T-005 | List bookmarks end-to-end: GET route + renderList + empty-state | AFK | Backlog | T-002, T-003 | US-002 | route, web-ts, tests |
| T-006 | Open bookmark in new tab via anchor `target=_blank rel=noopener noreferrer` | AFK | Backlog | T-005 | US-003 | web-ts, web-html, tests |
| T-007 | Delete bookmark end-to-end: DELETE route + client handler + 404 refetch reconcile | AFK | Backlog | T-002, T-003, T-005 | US-004 | route, web-ts, tests |

## Story coverage

| Story | Tasks |
| --- | --- |
| US-001 (save) | T-002, T-004 |
| US-002 (list) | T-002, T-005 |
| US-003 (open) | T-006 |
| US-004 (delete) | T-002, T-007 |

Every active story has at least one task. T-001 and T-003 are foundation
enablers and intentionally satisfy no story directly — they are
prerequisites for the slices that do.

## Counts

- Total: 7
- AFK: 7
- HITL: 0

## Foundation-task justification

`T-001` and `T-003` have no `satisfies-stories`. They are the minimum
scaffolding that lets later vertical slices ship behaviour: project
metadata + Vitest harness (T-001) and the Express shell + static
serving + error envelope (T-003). Splitting them out of the first
behavioural slice avoids hiding generic setup inside a story-tagged task
and lets Build run each slice without re-doing scaffolding work.
