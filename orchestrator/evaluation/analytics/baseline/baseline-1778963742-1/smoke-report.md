---
project: baseline-1778963742-1
phase: build
created: 2026-05-16
---

# Smoke report — baseline-1778963742-1

| # | Check | Result | Notes |
| - | ----- | ------ | ----- |
| 1 | `cd app && npm run build:client` produces `app/dist/client/main.js` | PASS | esbuild output: `main.js` 4.6kb + sourcemap |
| 2 | Server boots and stays up | PASS | Started on PORT=3001 (avoided 3000 collision per directive); responded for ~10s of probes before being killed |
| 3 | HTTP smoke: POST → GET → POST dup → DELETE → GET | PASS | 201 / 200 (item present) / 409 duplicate_url / 204 / 200 (empty `[]`) |
| 4 | UI rendering (substituted curl-based HTML check; no Puppeteer dep) | PASS | `GET /` 200 text/html, body references `/static/main.js` and contains `<form id="add-form">`; `GET /static/main.js` 200 with 4678-byte body |
| 5 | Cleanup (kill server, remove `app/bookmarks.db`) | PASS | Process killed, port released, db + wal/shm removed |

## Substitution note (smoke check 4)

The smoke recipe normally calls for a headless-browser screenshot. The
workspace does not declare Puppeteer as a dependency (and adding one would
violate stack pinning), so this check is satisfied via `curl` against the
running server: HTML shell at `/` is asserted to reference the bundled JS
and to contain the form element. The richer DOM-rendering behaviour is
covered by `tests/client.render.test.ts` (happy-dom, 4 cases).

## Port choice

Used `PORT=3001` rather than 3000 to avoid collisions with any concurrent
baseline run, per the build-coordinator brief.
