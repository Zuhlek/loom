# Nora

Chat-first Claude Code session manager + loom artifact viewer.
See `.loom/nora/idea.md` for the full vision.

## Prerequisites

- [Bun](https://bun.sh) v1.3+ (tested on 1.3.13)
- [Node.js](https://nodejs.org) v20+ on `PATH` (used as a sidecar for the
  PTY bridge — see "PTY architecture" below)
- The `claude` binary on `PATH` (Claude Code v2+).

## Quick start

```bash
bun install
bun run dev
```

Then open <http://localhost:5173>.

What `bun run dev` does:

- Launches `nora-server` (Bun.serve HTTP+WS) on port **3737**.
- Launches the Vite dev server on port **5173** with HMR.
- Vite proxies `/api/*` to the server, plus `/ws` for the chat WebSocket.

Stop with **Ctrl+C** in the dev terminal — both children receive SIGINT
and exit cleanly.

## Other scripts

```bash
bun run dev:server   # Just the backend (--watch).
bun run dev:web      # Just the Vite frontend.
bun run start        # Backend without --watch (production-style).
bun run build:web    # Production build of the React app.
bun run test         # Run all tests (server + web smoke).
bun run install-hooks
                     # Optional: install Claude Code's user-scope hooks
                     # so nora can receive PostToolUse / SessionStart /
                     # Stop / SubagentStop / PermissionRequest events.
                     # Skipped on dev startup; opt-in only.
```

## State

- `~/.nora/metadata.db` — JSON-backed metadata store (chats, projects,
  pending-gates, hook registrations). Auto-created on first run.
- `~/.nora/.lock` — single-instance lockfile holding the running PID.
- `~/.nora/config.json` — workspace config (root, worktrees-root); written
  by the discover wizard.

To reset all state: `rm -rf ~/.nora/`.

To clear just the chats/projects metadata while keeping config: `bun run
reset-state` (interactive confirm; does not kill running PTYs — stop
the server first).

### Migrating to the project-first flow

Recent builds promote Project to a first-class entity: chats are created
*inside* a project rather than auto-creating one from a free-form name. If
your `metadata.db` predates this change you have two options:

1. **Wipe and start clean.** `bun run reset-state` (or
   `rm -rf ~/.nora/metadata.db`) — recommended when your existing chats
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
5. Restarting `bun run dev` preserves chats and projects; clicking a
   row lazy-spawns a fresh `claude` PTY in the chat's cwd.

## Known limitations

These are intentionally deferred to follow-up tasks (see
`.loom/nora/review.md` for the full list):

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
  `bun run install-hooks` to opt in. Hooks aren't required for the basic
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

Bun's runtime currently has a libuv async-hook bug that prevents
`node-pty`'s data events from firing in-process. To work around this we
spawn a tiny Node sidecar
(`apps/server/src/process-manager/pty-helper.cjs`) per chat that owns
`node-pty` and exchanges JSON line frames with the Bun parent over
stdin/stdout. The sidecar requires Node.js on `PATH`.

If `node` is unavailable, the bridge falls back to
`child_process.spawn` — `claude` will detect the missing TTY and exit
immediately, but other shells / commands still work for testing.

## Repo layout

```
apps/
  server/         # Bun.serve HTTP+WS, routes, metadata-store, PTY bridge.
  web/            # React + Vite SPA.
scripts/
  dev.ts          # Concurrent dev runner.
  install-hooks.ts# Optional user-scope hook installer.
.loom/nora/       # Loom artifacts: idea, plan, mockups, BOARD, etc.
```
