# Board — baseline-1779046840-1

## Backlog
- (none)

## In Progress
- (none)

## Review
- (none)

## Done
- T-001 Scaffold app workspace with build/test/start scripts — touches: tooling
- T-002 SQLite schema and db module with UNIQUE(url) — touches: server-db
- T-003 GET /api/bookmarks returns newest-first list — touches: server-routes, server-app
- T-004 POST /api/bookmarks with validation and 409 duplicate — touches: server-routes
- T-005 DELETE /api/bookmarks/:id with 404 on missing — touches: server-routes
- T-006 Static file serving and index.html shell — touches: server-static, client-shell
- T-007 Client api wrapper and dom render helpers — touches: client-api, client-dom
- T-008 Render bookmarks list and empty state on page load — touches: client-main, client-dom
- T-009 Save form with inline validation, duplicate error, optimistic prepend — touches: client-main, client-dom
- T-010 Open bookmark in new tab via title link — touches: client-dom
- T-011 Delete control removes row with non-fatal 404 handling — touches: client-main, client-dom
- T-012 End-to-end smoke gate: install, build, npm test green — touches: tooling, server-app, client-main
