# Loom

Phase-based development framework for AI-agent software work. Three subsystems:

| Path | What it is |
| --- | --- |
| `orchestrator/` | Claude Code skill that drives the lifecycle (`/weave` — Spec → Design → Plan → Build → Review). See `orchestrator/README.md`. |
| `ui/` | Dev stack — Fastify server + Vite/React web app for browsing `.loom/` projects. See `ui/README.md`. |
| `orchestrator/evaluation/` | Eval harness — drives baseline `/weave` runs and produces `analysis.html` from session transcripts. See `orchestrator/evaluation/README.md`. |

## Verbs

All scripts run from the repo root.

```bash
# UI dev stack (forwards into ui/)
pnpm dev               # server :3737 + vite :5173 (proxies /api, /ws)
pnpm dev:server        # server only
pnpm dev:web           # vite only
pnpm start             # production-mode server, no HMR
pnpm test              # vitest run
pnpm build:web         # vite production build
pnpm install-hooks     # install Claude Code hooks under ~/.claude/loom-hooks/
pnpm reset-state       # clear .loom workspaces

# Eval harness
pnpm eval:setup        # one-time deps for the harness
pnpm eval:run          # one /weave baseline run
pnpm eval:pool         # five /weave baseline runs
pnpm eval:analyse      # render analysis.html from filed runs
```

## Workspace

`.loom/<project>/` is where every `/weave` invocation puts its artifacts. `pipeline.md` is the canonical state file per project. The orchestrator's Phase Cycle reads it on every dispatch.
