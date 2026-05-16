# Bookmarks

Local-only bookmarks app. Single Node process serves both the JSON API and the
static UI from `http://localhost:3000`. Persists to `bookmarks.sqlite` next to
the server.

## Prerequisites

- Node 20.x or newer
- `better-sqlite3` builds a native module on `npm install`. On macOS / Linux
  this is automatic; if the prebuilt binary is unavailable for your platform a
  C++ toolchain (Xcode CLT, build-essential) is required.

## One-time setup

```bash
npm install
```

## Run the app

```bash
npm start
```

Builds the client bundle into `dist/client/`, then starts the server on
`http://localhost:3000`.

## Run the tests

```bash
npm test
```

Executes the full Vitest suite. Exits non-zero on any failure.
