# Loom

Chat-first Claude Code session manager + loom artifact viewer.
See `.loom/idea.md` for the full vision.

## Prerequisites

- [Node.js](https://nodejs.org) v20+ (v22+ recommended).
- [pnpm](https://pnpm.io) v10+. If you have Node v16.13+ with corepack
  available, just run `corepack enable` and pnpm will be installed
  on-demand from the version pinned in `package.json`.
- The `claude` binary on `PATH` (Claude Code v2+).

## Quick start

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:5173>.

What `pnpm dev` does:

- Launches `loom-server` (Fastify HTTP + `@fastify/websocket`) on port **3737**.
- Launches the Vite dev server on port **5173** with HMR.
- Vite proxies `/api/*` to the server, plus `/ws` for the chat WebSocket.

Stop with **Ctrl+C** in the dev terminal — both children receive SIGINT
and exit cleanly.

## Other scripts

```bash
pnpm dev:server   # Just the backend (tsx watch).
pnpm dev:web      # Just the Vite frontend.
pnpm start        # Backend without --watch (production-style, via tsx).
pnpm build:web    # Production build of the React app.
pnpm test         # Run all tests (server + web smoke) via Vitest.
pnpm install-hooks
                  # Optional: install Claude Code's user-scope hooks
                  # so loom can receive PostToolUse / SessionStart /
                  # Stop / SubagentStop / PermissionRequest events.
                  # Skipped on dev startup; opt-in only.
```

## State

- `~/.loom/metadata.db` — JSON-backed metadata store (chats, projects,
  pending-gates, hook registrations). Auto-created on first run.
- `~/.loom/.lock` — single-instance lockfile holding the running PID.
- `~/.loom/config.json` — workspace config (root, worktrees-root); written
  by the discover wizard.

To reset all state: `rm -rf ~/.loom/`.

To clear just the chats/projects metadata while keeping config: `pnpm
reset-state` (interactive confirm; does not kill running PTYs — stop
the server first).

### Migrating to the project-first flow

Recent builds promote Project to a first-class entity: chats are created
*inside* a project rather than auto-creating one from a free-form name. If
your `metadata.db` predates this change you have two options:

1. **Wipe and start clean.** `pnpm reset-state` (or
   `rm -rf ~/.loom/metadata.db`) — recommended when your existing chats
   are throwaway test rows.
2. **Keep them and migrate forward.** Existing chats with no
   `project_id` still appear in the sidebar's "Unassigned" bucket. Existing
   project-grouped chats are unchanged. New chats use the project-first
   flow: hover any project header in the sidebar to spawn a chat inside
   it, or click "+ New project" to create one.

## What works in this build

1. Spawn a chat via the in-app modal (cwd, permission preset, optional
   project name).
2. Live chat surface: connects via WebSocket, spawns a real `claude`
   PTY in the chosen cwd, streams TTY bytes to the browser, accepts
   keystrokes via Enter from the composer.
3. Sidebar reflects persisted chats and looms (read from the
   metadata store + `.loom/<project>/` directories).
4. Closing the browser tab triggers a 30 s drain timer; if no client
   reattaches we SIGTERM the PTY and mark the chat inert.
5. Restarting `pnpm dev` preserves chats and projects; clicking a
   row lazy-spawns a fresh `claude` PTY in the chat's cwd.

## Known limitations

These are intentionally deferred to follow-up tasks (see
`.loom/review.md` for the full list):

- **Worktree mode**: the spawn dialog has the checkbox and the field is
  recorded, but every chat currently runs in the bare cwd. The diff
  panel demo route shows hardcoded sample data only.
- **Multi-SCM**: `/scm/*` and `/worktree/*` routes are not mounted yet.
- **Loom artifact view**: the `/loom/<phase>` routes still show
  hardcoded sample state.
- **AskUserQuestion / PermissionRequest**: the visual components live
  on demo routes (`/chat-mock/askuserquestion`,
  `/chat-mock/permission`); they are not wired to live state.
- **Image attachments / @-file completion / slash-command autocomplete**:
  the live composer is a plain textarea + Send button.
- **First-run discover wizard**: the route exists but doesn't gate the
  empty home; defaulting to typing a cwd is enough for v1.
- **Handoff / fork-to-terminal menus**: demo route only.
- **Hook auto-install**: not run on dev startup. Use
  `pnpm install-hooks` to opt in. Hooks aren't required for the basic
  chat flow.
- **Terminal emulation**: chat output is rendered with xterm.js so
  Claude's TUI prompts, colors, and cursor work correctly. The
  textarea composer is gone — type directly into the terminal pane,
  exactly like a normal shell.
- **Persistent claude session resume**: the chat row tracks a
  `session_id` but we don't yet parse it from claude's startup banner,
  so each lazy-spawn starts a new claude session in the cwd (claude
  itself picks up its latest session for the cwd).

## PTY architecture

`node-pty` is owned by a tiny Node sidecar
(`apps/server/src/process-manager/pty-helper.cjs`) spawned per chat;
it exchanges JSON line frames with the parent over stdin/stdout. This
gives us crash isolation — if a PTY misbehaves, only its sidecar dies,
not the whole server. The sidecar uses the same Node binary that runs
the parent, so no additional runtime is required.

If `node` isn't reachable, the bridge falls back to
`child_process.spawn` — `claude` will detect the missing TTY and exit
immediately, but other shells / commands still work for testing.

## Repo layout

```
apps/
  server/         # Fastify HTTP + WS, routes, metadata-store, PTY bridge.
  web/            # React + Vite SPA.
scripts/
  dev.ts          # Concurrent dev runner.
  install-hooks.ts# Optional user-scope hook installer.
.loom/       # Loom artifacts: idea, plan, mockups, BOARD, etc.
```
