# `duration_autonomous_ms` — Computation findings

Probe target: pin down exactly how `capture-subagent-eval.py` (T-001) should
compute the `duration_autonomous_ms` field from a Claude Code transcript at
`SubagentStop` time.

## Transcript schema (verified by inspection of real transcripts)

Source inspected:
`~/.claude/projects/-Volumes-My-Shared-Files-repo-loom/278356c9-217d-417d-b25b-415b988acfc6.jsonl`
(plus four siblings; all share the same shape).

Each line is a JSON object with at least these top-level keys:

| key | type | notes |
| --- | --- | --- |
| `type` | `"user"` \| `"assistant"` \| `"system"` \| `"attachment"` \| `"queue-operation"` \| `"last-prompt"` | row kind |
| `uuid` | string | message id |
| `parentUuid` | string \| null | previous message in this chain |
| `sessionId` | string | top-level Claude Code session |
| `isSidechain` | bool | `true` for child Task subagent rows (single-file mode) |
| `timestamp` | ISO-8601 | server-side wall-clock when the row was emitted |
| `cwd` | string | repo root at time of message |

Assistant rows additionally carry `message`:

```jsonc
"message": {
  "model": "...",
  "id": "...",
  "type": "message",
  "role": "assistant",
  "content": [...],
  "stop_reason": "...",
  "usage": {
    "input_tokens": 6,
    "cache_creation_input_tokens": 2426,
    "cache_read_input_tokens": 14967,
    "output_tokens": 558,
    "server_tool_use": { ... },
    "service_tier": "standard",
    "cache_creation": { "ephemeral_1h_input_tokens": 2426,
                        "ephemeral_5m_input_tokens": 0 },
    "inference_geo": "",
    "iterations": [{...}],
    "speed": "standard"
  },
  "diagnostics": {...}
}
```

### Per-turn timing surfaces

**There is no explicit server-side per-turn duration field.** Concretely:

- `message.usage` does NOT contain `server_time_ms`, `latency_ms`,
  `processing_time_ms`, or any equivalent timing scalar.
- `message.diagnostics` and `message.stop_details` carry no timing data either.
- The `iterations` array is per-tool-call sub-billing — not per-turn timing.
- No top-level `durationMs` / `latency_ms` field exists on the row.

The only timing signal we have is the row-level `timestamp` (ISO-8601, server
wall clock).

## Computation chosen for T-001

**Option 1 (timestamp deltas across assistant turns) — adopted.**

`duration_autonomous_ms = Σ (assistant[i].timestamp − preceding_non_assistant.timestamp)`

over every `assistant` row in the Task subagent's transcript section. The
"preceding non-assistant" anchor is the immediately prior row whose `type` is
not `"assistant"` — i.e. a `"user"`, tool result, or `"system"` row. That row's
timestamp marks the moment the model started its turn (the server received the
request); the assistant row's timestamp marks when the model finished. Their
difference is the model's autonomous compute for that turn.

In Python pseudocode (the parser T-001 ships will be the canonical version):

```python
def autonomous_ms_from_rows(rows):
    total_ms = 0
    last_non_assistant_ts = None
    for r in rows:
        ts = _parse_iso(r.get("timestamp"))
        if r.get("type") == "assistant":
            if last_non_assistant_ts is not None and ts is not None:
                delta_ms = int((ts - last_non_assistant_ts).total_seconds() * 1000)
                if delta_ms >= 0:
                    total_ms += delta_ms
            # do NOT update last_non_assistant_ts here — consecutive
            # assistant rows (rare; agentic chains) anchor to the same
            # prior user/tool message, which matches the model's view.
        else:
            last_non_assistant_ts = ts
    return total_ms
```

### Why this and not wall-clock

Wall-clock (`last_ts - first_ts`) over-counts. It conflates user-think time
between turns and any sleep/wait the model was idle for. The Spec's reason for
keeping a distinct `duration_autonomous_ms` is to isolate model compute from
user latency; wall-clock defeats that.

### Why this and not "search for a server-time field"

Inspection of five real transcripts confirms no such field is emitted by the
SDK as observed by Claude Code at the time of writing (May 2026, version
strings observed in transcripts: `2.0.39`/`2.0.45`/`2.0.65`). T-001 should
still defensively check for a future field — pseudocode:

```python
# Future-proof: prefer an explicit server-time field if one ever appears.
for field in ("server_time_ms", "latency_ms", "processing_time_ms"):
    if field in usage:
        return int(usage[field])  # already in ms
```

…falling back to the timestamp-delta approach above. (Trivially additive in
the parser; costs nothing today.)

## Failure modes

| Case | Behaviour |
| --- | --- |
| Assistant row with no `timestamp` | Skip that turn's contribution (treat as 0 ms). Do NOT abort — partial counts are better than crash sentinel for a malformed-row edge. |
| First row in section is an assistant turn (no prior anchor) | Skip that turn's contribution (no `last_non_assistant_ts` yet). |
| Negative delta (clock skew, rare) | Clamp at 0 via `if delta_ms >= 0`. |
| Empty assistant-row set | Return 0. Caller (T-001) decides whether 0 is a crash sentinel or a no-op turn; usually it's the latter when the section is bounded by `isSidechain`-or-equivalent markers. |
| Whole transcript unreadable | T-001 writes the crash sentinel row per design.md §"Crash sentinel". `duration_autonomous_ms: null`. |

## Wall-clock duration (sibling field)

Provided here for symmetry. T-001 also computes `duration_wall_ms`:

```python
duration_wall_ms = int((last_row.timestamp - first_row.timestamp).total_seconds() * 1000)
```

…using the first and last rows of the Task subagent's section (filtered to
this Task — by `isSidechain` for single-file mode, or by reading the
child-session transcript file directly when `Task` opens a separate file).

## Adoption checklist for T-001

- [ ] Use `autonomous_ms_from_rows` shape above.
- [ ] Defensively check for `usage.server_time_ms` / `usage.latency_ms` /
  `usage.processing_time_ms` before falling back to deltas.
- [ ] Skip malformed-timestamp rows, do not crash the row over them.
- [ ] Sub-subagent rollup (per ADR-003) sums measurements arithmetically; the
  rollup is a sum of integer ms, so this computation composes naturally.

## Version pin

Findings collected: 2026-05-15.  Claude Code transcript versions verified:
`2.0.39`, `2.0.45`, `2.0.65`.  If the SDK adds an explicit per-turn server
timing field, T-001's defensive check picks it up without further code change.
