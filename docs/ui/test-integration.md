# `ui/apps/server/test/integration/` — gated smoke tests

This directory holds tests that exercise multiple modules end-to-end.
Most run unconditionally in the default suite. A few are
**live** — they shell out to the real `claude` binary and the real
tmux server — and are gated by environment so they stay out of CI:

| File | Default | Opt-in env | Notes |
| --- | --- | --- | --- |
| `shadow-run.test.ts` | runs | (none) | Fixture-based parity diff between bridges. Fast. |
| `env-degradation.test.ts` | runs | (none) | Boot-survival matrix when tmux / claude / projects-dir are absent. Uses test doubles. |
| `happy-path-live.test.ts` | **skipped** | `LOOM_SMOKE_LIVE=1` | T-027 / M7. Drives a real claude inside a real tmux and asserts user-text + assistant-text frames round-trip. |
| `multi-chat-isolation.test.ts` | **skipped** | `LOOM_SMOKE_LIVE=1` | T-029 / M8 step 4. Opens two concurrent chats in the same cwd; asserts each chat's WS receives only its own prompt + reply. Structural guard against the M8 cross-chat-collision regression class. |

## Running the live gates

```bash
# happy-path-live (single-chat, ~15s budget on a healthy host):
LOOM_SMOKE_LIVE=1 pnpm vitest run \
  apps/server/test/integration/happy-path-live.test.ts

# multi-chat-isolation (two chats, ~60s budget on a healthy host):
LOOM_SMOKE_LIVE=1 pnpm vitest run \
  apps/server/test/integration/multi-chat-isolation.test.ts
```

Both gates auto-skip with a `console.warn` if `tmux` or the `claude`
binary is missing on the host. To point at a non-PATH claude binary:

```bash
LOOM_SMOKE_LIVE=1 LOOM_CLAUDE_BIN=/path/to/claude \
  pnpm vitest run apps/server/test/integration/multi-chat-isolation.test.ts
```

Timing budgets are overridable via `LOOM_SMOKE_LIVE_TIMEOUT_MS`.

## When to run

- Before merging any change touching `process-manager/jsonl/bridge.ts`,
  `tmux-session.ts`, `session-store.ts`, or `jsonl-path-probe.ts`.
- Before cutting a release.
- When the user reports a return-path / cross-chat issue: the live
  gates have been the primary mechanism for catching M6 / M8 in the
  past.
