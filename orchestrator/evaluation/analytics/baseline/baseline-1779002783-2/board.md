# Board — baseline-1779002783-2

## Backlog

## In Progress

## Review

## Done
- T-001 Scaffold `app/` workspace (package.json, tsconfig, esbuild build script) — touches: build, config
- T-002 SQLite storage layer + idempotent migration — touches: storage
- T-003 List bookmarks slice — GET /api/bookmarks + repo.list — touches: http, domain, storage
- T-004 Create bookmark slice — POST /api/bookmarks + validation + duplicate handling — touches: http, domain, storage, validation
- T-005 Delete bookmark slice — DELETE /api/bookmarks/:id + not-found handling — touches: http, domain, storage
- T-006 Static shell + client bootstrap — touches: client, static, build
- T-007 Client create-form flow with inline validation + duplicate error — touches: client
- T-008 Client list render (newest-first, open-in-new-tab with rel="noopener noreferrer") — touches: client
- T-009 Client delete control + inline not-found error — touches: client
- T-010 End-to-end smoke: boot server, hit /api/bookmarks, restart persistence check — touches: smoke, integration
