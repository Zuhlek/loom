# Hooks

Claude Code hooks keep Loom workspaces resumable and observable.

| Hook | Event | Purpose |
| --- | --- | --- |
| `pin-on-weave.sh` | UserPromptSubmit | Pins the firing session to the project it engages via `/weave <project>`; records a weave-intent marker when the name still needs resolving. Primary writer of the session-ownership store |
| `resume-on-start.sh` | SessionStart | Surfaces the pinned workspace's `pipeline.md` status to its owning session — silent for unpinned sessions |
| `validate-subagent-output.sh` | SubagentStop | Validates phase RETURN blocks; on a Plan `complete` return additionally enforces the deterministic work-graph invariants (`phases/plan/phase.signature.md § Deterministic validation`) |
| `auto-advance.sh` | Stop | Nudges the owning session when its pinned workspace is unblocked; also converts this session's weave-intent marker into a pin once `.loom/.active` resolves. Silent for unpinned sessions |
| `refresh-artifacts.sh` | PostToolUse (Write/Edit/MultiEdit) | Rebuilds the workspace `artifacts.json` index after a file write |
| `board-transition.py` | PostToolUse (Write/Edit/MultiEdit) | Live board mirror during Build — best-effort; the orchestrator's end-of-Build reconciliation stays authoritative |
| `lib/telemetry/tag-subagent-phase.py` | PostToolUse (Agent/Task) | Telemetry: tags each dispatched subagent's transcript with the active phase |

## Session ownership

`lib/telemetry/session-store.sh` records which session is pinned to which project (`.loom/.sessions/<session_id>.txt`). The contract, amending ADR-002:

- **Writes**: `pin-on-weave.sh` is the primary writer; `auto-advance.sh` performs one narrow write (intent→pin adoption, below). A session is engaged the moment the user submits `/weave` in it — explicit engagement, never inference.
  - `/weave <name>` where `<name>` is an existing workspace → immediate pin. A bare `/weave` with exactly one workspace → immediate pin.
  - `/weave <ticket-id | free text | new project>`, or an ambiguous bare `/weave`, → a **weave-intent marker** (`<session_id>.weave-intent`) instead of a pin, because the real project name is derived by the orchestrator (`methods/create-project.md`) and isn't known at submit time. On the next Stop, `auto-advance.sh` reads the resolved name from `.loom/.active`, converts the marker into a pin, and removes it. This closes the gap where pinning the raw token (e.g. `Add` from "Add user auth") would never match the created directory `add-user-auth`.
  - The session id is validated as a bare filename (no `/`, `..`, or leading `.`) before it is ever used as a store path; the project arg rejects slashes, dots, and leading dashes. Write failures (unwritable cwd, `.loom` occupied by a file) degrade to an `LOOM_PIN_WRITE_FAILED` stderr marker and exit 0 — never a hook error, and never stdout (UserPromptSubmit stdout is injected into the model's context).
  - (ADR-002 originally placed all writes in the Stop hook, which opportunistically claimed the sole pending workspace for whichever session stopped first — that leaked nudges about unrelated projects into unrelated sessions and is retired.)
- **Reads**: `resume-on-start.sh` and `auto-advance.sh`. Both speak **only** to a session pinned to an existing workspace. Unpinned sessions, intent-only sessions (marker present, not yet adopted), unidentifiable payloads (no `session_id`), and stale pins all resolve to silence — diagnostics go to stderr markers (`LOOM_SESSION_FALLBACK`, `LOOM_SESSION_STALE`, `LOOM_SESSION_STORE_MISSING`, `LOOM_PIN_REJECTED_SID`), never to the model's context. A pinned workspace mid-creation (dir exists, `pipeline.md` not yet written) or already `complete` also resolves to silence rather than a misleading line.

Consequence: a Claude Code session that never runs `/weave` never hears about Loom workspaces, builds, or pipelines — regardless of what is pending in `.loom/`. Discovery is pull-based: run `/weave` and the orchestrator's `find-project` method lists resumable workspaces.

The `.loom` root is resolved by walking up from the payload `cwd` to the first ancestor containing a `.loom/` directory (consistent across `pin-on-weave.sh`, `resume-on-start.sh`, and `auto-advance.sh`), then `LOOM_ROOT`, then the creation-flow default of `cwd/.loom`.

## Installer

Install through `orchestrator/setup-loom.sh`. It merges the loom hook wiring into `~/.claude/settings.json` idempotently:

- Scrubbing is **anchored** to path segments only loom owns (`/loom-hooks/`, `/orchestrator/hooks/`, `tag-subagent-phase.py`) so it never deletes an unrelated user hook whose path merely contains a substring like `heirloom/hooks/`.
- Scrubbing operates at the **individual-hook** level, not the matcher-group level: a group that mixes a user hook with a loom hook keeps the user hook; only groups left empty are dropped.
- Empty event arrays are pruned so re-runs don't accumulate cosmetic `"PreToolUse": []` entries.

`hooks/settings.example.json` mirrors the wiring `setup-loom.sh` merges.
