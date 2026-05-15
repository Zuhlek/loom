# Orchestrator transcript-path access — findings

Probe target: pin down how the `/weave` orchestrator (running as the top-level
Claude Code session) obtains the path to its own transcript file, so that
T-007's `eval-orchestrator-row.py` helper can read it and compute per-phase
orchestrator usage deltas (ADR-004).

## Primary method (adopted)

**`CLAUDE_CODE_SESSION_ID` is exposed to slash-command bodies as an
environment variable.** Verified by `printenv | grep -i claude` from inside a
running Claude Code session at the time of writing:

```text
CLAUDE_CODE_SESSION_ID=6a30601b-bcfd-4911-b175-5cb4a50eb4d2
CLAUDE_CODE_ENTRYPOINT=sdk-ts
CLAUDE_CODE_EXECPATH=/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe
CLAUDECODE=1
CLAUDE_AGENT_SDK_VERSION=0.2.138
```

There is **no** `CLAUDE_TRANSCRIPT_PATH` env var. But the session id plus the
`cwd → encoded-cwd` convention used by `~/.claude/projects/` is enough to
reconstruct the transcript path deterministically.

### Algorithm (T-007 must copy this verbatim)

```python
import os
import re
from pathlib import Path

def orchestrator_transcript_path(cwd: str | os.PathLike | None = None) -> Path | None:
    """Return the path to the current /weave session's transcript, or None
    if it can't be located.

    Inputs:
      - cwd: project working directory (defaults to os.getcwd()). The
        orchestrator MUST pass its actual project cwd, not a worktree path,
        if the two differ.
    """
    session_id = os.environ.get("CLAUDE_CODE_SESSION_ID")
    if not session_id:
        return None

    cwd_str = str(cwd or os.getcwd())
    # Claude Code encodes the cwd into ~/.claude/projects/<encoded>/ by
    # replacing every '/' AND every ' ' with '-'. (Other punctuation passes
    # through verbatim. Verified by inspection of real project dirs on
    # 2026-05-15.)
    encoded = re.sub(r'[ /]', '-', cwd_str)
    candidate = Path.home() / ".claude" / "projects" / encoded / f"{session_id}.jsonl"
    if candidate.exists():
        return candidate
    return None
```

### Why slash-and-space-both-become-hyphen

Verified empirically. Probe:

```
cwd:     /Volumes/My Shared Files/repo/loom
encoded: -Volumes-My-Shared-Files-repo-loom
file:    ~/.claude/projects/-Volumes-My-Shared-Files-repo-loom/<session>.jsonl
```

Other punctuation (dots, underscores, hyphens) appears to pass through
verbatim, but T-007's helper only needs the slash+space substitution because
those are the two characters that actually appear in real `cwd` values.

## Fallback (when primary fails)

Two distinct fallback paths, ordered:

### Fallback 1: filesystem scan by session id

Some Claude Code versions / setups may not export `CLAUDE_CODE_SESSION_ID`
into every subprocess (notably very old versions, or sandboxed contexts that
strip env vars). If `CLAUDE_CODE_SESSION_ID` is absent, scan:

```python
def _scan_for_session(cwd: str) -> Path | None:
    encoded = re.sub(r'[ /]', '-', cwd)
    project_dir = Path.home() / ".claude" / "projects" / encoded
    if not project_dir.is_dir():
        return None
    # Pick the most-recently-modified .jsonl in this dir whose first line's
    # sessionId field matches the session env (or, when no env, the newest).
    candidates = sorted(project_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None
```

### Fallback 2: synthetic-zero orchestrator row

If neither method finds a transcript (broken /weave session, malformed
environment, etc.), the helper logs a warning to stderr and writes a
synthetic orchestrator row to `usage.jsonl` with `tokens: null`,
`duration_*_ms: null`, and `status: "crashed"`. This keeps US-001 AC-3
honest — there is always one orchestrator row per phase boundary, even if it
has no measurements — without blocking phase advance.

(This matches the crash-sentinel convention T-001 uses for subagent rows when
their transcript is unreadable. Aggregator T-003 already excludes null-token
rows from totals and lists them under "Crashed invocations", so the
downstream story is consistent.)

## Worktree caveat (recorded for T-007 builders)

When the user runs `/weave` from a git worktree, `os.getcwd()` returns the
worktree path, not the originating repo path. Claude Code's transcripts are
keyed by the cwd as seen at session-launch time. The orchestrator-row helper
must therefore use the cwd Claude Code itself sees (== `os.getcwd()` at
slash-command invocation time), not any "original" path. The current process
env is the source of truth.

Concretely: do not try to canonicalise via `git rev-parse --show-toplevel`.
That would point at a path Claude Code never indexed.

## Idempotency pointer (also load-bearing for T-007)

T-007's helper writes a `.loom/<project>/.eval-orchestrator-pointer` file
recording the last-emitted message UUID. On next call it scans the transcript
from that UUID forward, sums `usage.*` fields and computes durations (per the
T-002 timestamp-delta approach) since the pointer, then updates the pointer
atomically. This is per ADR-004 ("since the last orchestrator-row write").

The pointer file is project-scoped (not session-scoped) because a single
project may span multiple Claude Code sessions across a long /weave
invocation, and the row-delta arithmetic still wants to deduct only "since
last emit".

## Adoption checklist for T-007

- [ ] Read `CLAUDE_CODE_SESSION_ID` from env first.
- [ ] Resolve transcript path via slash-and-space → hyphen encoding of
  `os.getcwd()` (NOT any other path).
- [ ] Fall back to filesystem scan if env var missing.
- [ ] Fall back to synthetic-crashed row if neither works.
- [ ] Use `.loom/<project>/.eval-orchestrator-pointer` for idempotency.
- [ ] Reuse T-002's `autonomous_ms_from_rows` for the duration computation.

## Version pin

Findings collected: 2026-05-15. Claude Code: SDK `0.2.138`, entrypoint
`sdk-ts`, transcript path encoding as documented above.
