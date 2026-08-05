#!/usr/bin/env python3
"""transcript-harvest — produce a workspace's usage.jsonl from Claude Code
session transcripts.

Walks every `agent-<uuid>.jsonl` under the session directories for this
cwd, reduces each transcript's per-turn SDK `usage` blocks into one
`agent_kind: subagent` row, tags the row's phase, and counts the row's
quality signals from its tool_result entries.

Phase attribution reads four sources, in order of authority:

    sidecar   `agent-<uuid>.phase`, written by the PostToolUse hook
    dispatch  the `Active phase:` stamp in the subagent's own prompt
    parent    inherited via `meta.json`'s `parentAgentId`
    meta      the dispatch description, pattern-matched

Only the first requires the hook to have run. The `dispatch` source is the
load-bearing one: `/weave` stamps `Active project:` and `Active phase:` into
every dispatch prompt, so the transcript describes itself. A run whose
session never executed the hook — started before install, or driven by a
harness that doesn't load the user's hook config — still measures correctly,
where before it was invisible and a bystander session could be measured in
its place.

The `/weave` orchestrator's OWN session is reduced the same way into one
`agent_kind: orchestrator` row per contributing session, so a run's totals
cover the whole lifecycle rather than dispatched subagents alone. That
transcript sits beside the subagents directory:

    <projects-root>/<encoded-cwd>/<session>.jsonl      orchestrator
    <projects-root>/<encoded-cwd>/<session>/subagents/ subagents

It spans every phase, so it carries `phase: "orchestrator"` rather than
being attributed to one. Two consequences worth knowing when reading the
numbers: the session is still open while the run is being measured, so the
orchestrator row misses its own trailing turns; and a session driving more
than one project in sequence attributes its whole cost to each project it
touched.

Measurement contract (schema_version 2):
- Claude Code writes ONE transcript row PER CONTENT BLOCK of the same API
  response; each row repeats that response's (cumulative) `usage`. Token
  sums therefore deduplicate by `message.id`, keeping the LAST row per id
  (the final checkpoint). Naive per-row summation over-counts 2-4x.
- `duration_autonomous_ms` partitions the transcript timeline: each
  timestamped row closes the segment since the previous timestamped row,
  and segments closed by an assistant row count as autonomous time. This
  guarantees autonomous <= wall.
- Each row records the dominant `model` and an estimated `cost_usd`
  derived from per-model pricing with exact 5m/1h cache-write multipliers
  (the SDK usage block carries the `cache_creation` TTL breakdown).

Usage:
  python3 orchestrator/lib/telemetry/transcript-harvest.py <project> [--workspace PATH]
                                                          [--projects-root PATH]
                                                          [--cwd PATH]
                                                          [--session UUID ...]
                                                          [--dry-run]

By default the workspace is `.loom/<project>/` relative to the repo root.
Pass `--session UUID` (repeatable) to vouch for a session whose transcripts
should be included regardless of their own project evidence.
`.session-pointer` holds one session UUID per line; pass every line.

`--session` WIDENS the match, it does not narrow the search: every session
under the cwd is scanned either way, and transcripts that carry the project
stamp are picked up whether or not the pointer knows about their session.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import tempfile
from pathlib import Path


# repo root: lib/telemetry/ -> lib -> orchestrator -> <repo>
REPO_ROOT = Path(__file__).resolve().parents[3]

SCHEMA_VERSION = 2


# --------------------------------------------------------------------------
# Pricing (USD per MTok). Longest-prefix match on the model id. Cache reads
# bill at 0.1x input; cache writes at 1.25x (5m TTL) / 2x (1h TTL). When the
# usage block carries no TTL breakdown, writes are priced at the 5m rate.
# --------------------------------------------------------------------------

PRICING_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-fable-5":   (10.0, 50.0),
    "claude-mythos-5":  (10.0, 50.0),
    "claude-opus-5":    (5.0, 25.0),
    "claude-opus-4":    (5.0, 25.0),
    "claude-sonnet-5":  (3.0, 15.0),
    "claude-sonnet-4":  (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}

# A model id may carry a context-window suffix (`claude-opus-5[1m]`). Prefix
# matching handles those without a table entry each. A model absent from the
# table yields cost_usd=None — which render-metrics.py must surface as
# "unpriced", never fold into a 0.00 that reads as free.

CACHE_READ_MULT = 0.10
CACHE_WRITE_5M_MULT = 1.25
CACHE_WRITE_1H_MULT = 2.00


def _pricing_for(model: str | None) -> tuple[float, float] | None:
    if not isinstance(model, str):
        return None
    best: tuple[float, float] | None = None
    best_len = -1
    for prefix, rates in PRICING_USD_PER_MTOK.items():
        if model.startswith(prefix) and len(prefix) > best_len:
            best, best_len = rates, len(prefix)
    return best


def _usage_cost_usd(usage: dict, model: str | None) -> float | None:
    """Estimated USD cost of one API message's usage block, or None when
    the model has no pricing entry."""
    rates = _pricing_for(model)
    if rates is None:
        return None
    in_rate, out_rate = rates

    def _n(key: str) -> int:
        v = usage.get(key, 0)
        return int(v) if isinstance(v, (int, float)) else 0

    cost = _n("input_tokens") * in_rate + _n("output_tokens") * out_rate
    breakdown = usage.get("cache_creation")
    if isinstance(breakdown, dict):
        five = breakdown.get("ephemeral_5m_input_tokens", 0)
        hour = breakdown.get("ephemeral_1h_input_tokens", 0)
        five = int(five) if isinstance(five, (int, float)) else 0
        hour = int(hour) if isinstance(hour, (int, float)) else 0
        cost += five * in_rate * CACHE_WRITE_5M_MULT
        cost += hour * in_rate * CACHE_WRITE_1H_MULT
    else:
        cost += _n("cache_creation_input_tokens") * in_rate * CACHE_WRITE_5M_MULT
    cost += _n("cache_read_input_tokens") * in_rate * CACHE_READ_MULT
    return cost / 1_000_000.0


# --------------------------------------------------------------------------
# Parser primitives — pure functions over a list of transcript-row dicts.
# --------------------------------------------------------------------------


TOKEN_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)


_ISO_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z?$"
)


def _parse_iso(ts: str | None) -> _dt.datetime | None:
    if not ts or not isinstance(ts, str):
        return None
    m = _ISO_RE.match(ts.replace("+00:00", "Z"))
    if not m:
        try:
            s = ts
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            return _dt.datetime.fromisoformat(s)
        except ValueError:
            return None
    y, mo, d, hh, mm, ss, frac = m.groups()
    micro = 0
    if frac:
        micro = int((frac + "000000")[:6])
    return _dt.datetime(int(y), int(mo), int(d), int(hh), int(mm), int(ss), micro,
                        tzinfo=_dt.timezone.utc)


def _ms_between(a: _dt.datetime, b: _dt.datetime) -> int:
    return int((b - a).total_seconds() * 1000)


def _content_text(row: dict) -> str:
    msg = row.get("message")
    if not isinstance(msg, dict):
        return ""
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for c in content:
        if isinstance(c, dict) and isinstance(c.get("text"), str):
            parts.append(c["text"])
    return "\n".join(parts)


def _wall_ms_from_rows(rows: list[dict]) -> int:
    """Span from the earliest to the latest timestamped row.

    Deliberately min/max rather than first/last: a transcript's rows are NOT
    guaranteed chronological. Sidechain interleaving and resumed sessions
    write rows out of order, and a first/last read of such a file understates
    the span — or returns 0 when the last row predates the first.
    """
    stamps = [ts for ts in (_parse_iso(r.get("timestamp")) for r in rows)
              if ts is not None]
    if not stamps:
        return 0
    return _ms_between(min(stamps), max(stamps))


def _autonomous_ms_from_rows(rows: list[dict]) -> int:
    """Partition the transcript timeline into segments between consecutive
    timestamped rows; segments closed by an assistant row count as time the
    model spent generating. The anchor advances past EVERY timestamped row
    (assistant rows included), so segments never overlap and the sum is
    guaranteed <= wall clock. (The previous algorithm re-used the same
    anchor for every assistant row of a multi-block response and could
    exceed wall by 2x.)

    Rows are sorted by timestamp first, because file order is not
    chronological in sidechained or resumed transcripts — partitioning the
    file as if it were would drop every segment that appears out of order.
    The sort is stable, so equal timestamps keep their file order.
    """
    stamped = sorted(
        ((ts, r) for ts, r in ((_parse_iso(r.get("timestamp")), r) for r in rows)
         if ts is not None),
        key=lambda pair: pair[0],
    )
    total_ms = 0
    anchor: _dt.datetime | None = None
    for ts, r in stamped:
        if r.get("type") == "assistant" and anchor is not None and ts > anchor:
            total_ms += _ms_between(anchor, ts)
        anchor = ts
    return total_ms


def _dedup_assistant_usage(rows: list[dict]) -> list[tuple[str | None, dict]]:
    """Return one (model, usage) pair per distinct API message.

    Claude Code writes one transcript row per content block of the same API
    response; each row carries that response's usage with cumulative
    `output_tokens`. Keep the LAST row per `message.id` (the final
    checkpoint). Rows without a message id are kept individually.
    """
    ordered: list[str] = []
    by_id: dict[str, tuple[str | None, dict]] = {}
    counter = 0
    for r in rows:
        if r.get("type") != "assistant":
            continue
        msg = r.get("message")
        if not isinstance(msg, dict):
            continue
        usage = msg.get("usage")
        if not isinstance(usage, dict):
            continue
        mid = msg.get("id")
        if not isinstance(mid, str) or not mid:
            counter += 1
            mid = f"__no_id_{counter}"
        if mid not in by_id:
            ordered.append(mid)
        model = msg.get("model") if isinstance(msg.get("model"), str) else None
        by_id[mid] = (model, usage)  # later rows overwrite -> last wins
    return [by_id[mid] for mid in ordered]


def sum_usage_and_durations(rows: list[dict]) -> tuple[dict[str, int] | None, int,
                                                       int | None, str | None,
                                                       float | None]:
    """Return (tokens, wall_ms, autonomous_ms, model, cost_usd).

    `tokens` is None if NO assistant row had a usage block (crash sentinel);
    `autonomous_ms`, `model`, and `cost_usd` are None on the same condition.
    Token sums deduplicate by API message id (see _dedup_assistant_usage).
    `model` is the dominant real model across messages (synthetic rows
    excluded). `cost_usd` is None when any token-bearing message's model
    lacks pricing.
    """
    messages = _dedup_assistant_usage(rows)
    wall = _wall_ms_from_rows(rows)
    if not messages:
        return None, wall, None, None, None

    totals = {k: 0 for k in TOKEN_KEYS}
    model_counts: dict[str, int] = {}
    cost = 0.0
    cost_known = True
    explicit_server_time_ms = 0
    have_explicit_server_time = True

    for model, usage in messages:
        for k in TOKEN_KEYS:
            v = usage.get(k, 0)
            if isinstance(v, (int, float)):
                totals[k] += int(v)
        if model and model != "<synthetic>":
            model_counts[model] = model_counts.get(model, 0) + 1
        msg_cost = _usage_cost_usd(usage, model)
        if msg_cost is None:
            # Unpriced messages with zero tokens cost nothing; token-bearing
            # ones make the total unknowable.
            if any(isinstance(usage.get(k), (int, float)) and usage.get(k)
                   for k in TOKEN_KEYS):
                cost_known = False
        else:
            cost += msg_cost
        explicit = None
        for field in ("server_time_ms", "latency_ms", "processing_time_ms"):
            if isinstance(usage.get(field), (int, float)):
                explicit = int(usage[field])
                break
        if explicit is None:
            have_explicit_server_time = False
        else:
            explicit_server_time_ms += explicit

    if have_explicit_server_time:
        autonomous = min(explicit_server_time_ms, wall)
    else:
        autonomous = _autonomous_ms_from_rows(rows)

    dominant = max(model_counts, key=model_counts.get) if model_counts else None
    return totals, wall, autonomous, dominant, (round(cost, 6) if cost_known else None)


VALID_PHASES = ("spec", "design", "plan", "build", "review")

# The orchestrator drives every phase, so its row is not attributable to
# one. It gets its own bucket, which render-metrics.py renders as a sixth
# row beside the five phases.
ORCHESTRATOR_PHASE = "orchestrator"
ORCHESTRATOR_LABEL = "Weave orchestrator"


def canonical_agent_label(phase: str | None) -> str:
    if phase in VALID_PHASES:
        return f"{phase.capitalize()} phase agent"
    return "unknown-agent"


def read_phase_sidecar(transcript_path: Path) -> str | None:
    """Read the `.phase` sidecar written by the PostToolUse hook.

    The hook in `orchestrator/lib/telemetry/tag-subagent-phase.py` writes one
    `agent-<uuid>.phase` file per dispatched subagent. Returns the
    phase string or None if the sidecar is missing or invalid.
    """
    sidecar = transcript_path.parent / (transcript_path.stem + ".phase")
    if not sidecar.is_file():
        return None
    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    phase = data.get("phase") if isinstance(data, dict) else None
    if isinstance(phase, str) and phase.lower() in VALID_PHASES:
        return phase.lower()
    return None


_REMINDER_RE = re.compile(r"<system-reminder>(.*?)</system-reminder>", re.DOTALL)
_ACTIVE_PROJECT_RE = re.compile(r"^Active project:[ \t]*(\S+)[ \t]*$", re.MULTILINE)
_ACTIVE_PHASE_RE = re.compile(r"^Active phase:[ \t]*([A-Za-z]+)[ \t]*$", re.MULTILINE)


def read_dispatch_context(rows: list[dict]) -> tuple[str | None, str | None]:
    """Return `(project, phase)` from the dispatch prompt's `<system-reminder>`.

    `/weave` stamps every dispatch with

        <system-reminder>
        Active project: <project>
        Active phase: <phase>
        ...
        </system-reminder>

    which lands verbatim in the subagent's own first user row. That makes the
    transcript self-describing: attribution does not depend on the PostToolUse
    hook having run, on `pipeline.md` write-discipline, or on the dispatch
    description wording.

    This matters because the hook is not guaranteed to fire. A session started
    before the hook was installed, or driven by a harness that does not load
    the user's hook config, produces subagent transcripts with no `.phase`
    sidecar and no `.session-pointer` entry — and the run would otherwise be
    invisible to measurement even though the evidence is sitting in the file.
    """
    text: list[str] = []
    for row in rows[:5]:
        if row.get("type") != "user":
            continue
        chunk = _content_text(row)
        if chunk:
            text.append(chunk)
    if not text:
        return None, None
    project = phase = None
    for block in _REMINDER_RE.findall("\n".join(text)):
        match_project = _ACTIVE_PROJECT_RE.search(block)
        match_phase = _ACTIVE_PHASE_RE.search(block)
        if match_project:
            project = match_project.group(1).strip().strip("`")
        if match_phase:
            candidate = match_phase.group(1).strip().lower()
            if candidate in VALID_PHASES:
                phase = candidate
    return project, phase


_META_PHASE_RE = re.compile(
    r"\b(spec|design|plan|build|review)\b[\s-]*phase|"
    r"phase[\s:-]*\b(spec|design|plan|build|review)\b",
    re.IGNORECASE,
)


def read_phase_from_meta(transcript_path: Path) -> str | None:
    """Fallback phase attribution from `agent-<uuid>.meta.json`.

    Claude Code writes the dispatch `description` (e.g. "Spec phase for
    bookmarks app") into the meta sidecar. Used only when the PostToolUse
    hook did not write a `.phase` sidecar, so hook misconfiguration
    degrades attribution to a heuristic instead of dropping the row from
    per-phase rollups entirely.
    """
    meta_path = transcript_path.parent / (transcript_path.stem + ".meta.json")
    if not meta_path.is_file():
        return None
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    description = data.get("description") if isinstance(data, dict) else None
    if not isinstance(description, str):
        return None
    match = _META_PHASE_RE.search(description)
    if match is None:
        return None
    phase = (match.group(1) or match.group(2) or "").lower()
    return phase if phase in VALID_PHASES else None


def agent_id_for(transcript_path: Path) -> str:
    """`.../agent-<uuid>.jsonl` -> `<uuid>`."""
    stem = transcript_path.stem
    return stem[len("agent-"):] if stem.startswith("agent-") else stem


def read_meta(transcript_path: Path) -> dict:
    """Parse `agent-<uuid>.meta.json`, or `{}` when absent or malformed."""
    meta_path = transcript_path.parent / (transcript_path.stem + ".meta.json")
    if not meta_path.is_file():
        return {}
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


MAX_PARENT_HOPS = 8


def resolve_via_parent(agent_id: str, by_agent_id: dict[str, dict]) -> dict | None:
    """Walk `parentAgentId` up to the nearest ancestor with its own attribution.

    A phase agent may itself dispatch helpers (a Spec agent spawning research
    agents). Those nested transcripts carry no dispatch stamp of their own —
    `/weave` never wrote one, their parent did — so on their own they are
    unattributable. Their `meta.json` does carry `parentAgentId`, which is
    enough to inherit both the project and the phase from the dispatch that
    ultimately caused them.

    Bounded by MAX_PARENT_HOPS and a visited set so a malformed or cyclic
    parent chain cannot hang the harvest.
    """
    seen: set[str] = {agent_id}
    current = by_agent_id.get(agent_id)
    for _ in range(MAX_PARENT_HOPS):
        if current is None:
            return None
        parent_id = current["meta"].get("parentAgentId")
        if not isinstance(parent_id, str) or parent_id in seen:
            return None
        seen.add(parent_id)
        parent = by_agent_id.get(parent_id)
        if parent is None:
            return None
        if parent["dispatch_project"] or parent["dispatch_phase"]:
            return parent
        current = parent
    return None


def quality_counts(rows: list[dict]) -> dict[str, int]:
    """Count error_results, read_errors, bash_failures over a transcript.

    Bash failures are detected as `is_error: true` tool_result rows whose
    originating tool_use (matched by `tool_use_id`) was the Bash tool.
    Read errors use the same id-correlation for the Read tool.
    """
    tool_name_by_id: dict[str, str] = {}
    error_results = 0
    read_errors = 0
    bash_failures = 0
    for row in rows:
        message = row.get("message")
        if not isinstance(message, dict):
            continue
        row_type = row.get("type")
        content = message.get("content")
        if row_type == "assistant" and isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "tool_use":
                    identifier = item.get("id")
                    name = item.get("name")
                    if isinstance(identifier, str) and isinstance(name, str):
                        tool_name_by_id[identifier] = name
        elif row_type == "user" and isinstance(content, list):
            for item in content:
                if not (isinstance(item, dict) and item.get("type") == "tool_result"):
                    continue
                if not item.get("is_error"):
                    continue
                error_results += 1
                tool_name = tool_name_by_id.get(item.get("tool_use_id"))
                if tool_name == "Read":
                    read_errors += 1
                elif tool_name == "Bash":
                    bash_failures += 1
    return {
        "error_results": error_results,
        "read_errors": read_errors,
        "bash_failures": bash_failures,
    }


def build_row(phase: str | None, phase_source: str | None, agent_label: str,
              tokens: dict | None, wall_ms: int, autonomous_ms: int | None,
              status: str, quality: dict | None,
              model: str | None, cost_usd: float | None,
              agent_kind: str = "subagent") -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "phase": phase,
        "phase_source": phase_source,
        "agent_kind": agent_kind,
        "agent_label": agent_label,
        "model": model,
        "tokens": tokens,
        "cost_usd": cost_usd,
        "duration_wall_ms": wall_ms,
        "duration_autonomous_ms": autonomous_ms,
        "status": status,
        "quality": quality,
    }


# --------------------------------------------------------------------------
# Harvester
# --------------------------------------------------------------------------


def encode_cwd_for_projects_dir(cwd: Path) -> str:
    """Claude Code encodes a session's cwd as the projects subdirectory name
    by replacing both path separators AND spaces with dashes. Verified
    empirically against `~/.claude/projects/`."""
    return str(cwd).replace("/", "-").replace(" ", "-")


def _normalize_session_ids(session_id) -> set[str] | None:
    if session_id is None:
        return None
    if isinstance(session_id, str):
        return {session_id}
    ids = {s for s in session_id if isinstance(s, str) and s}
    return ids or None


def find_subagent_transcripts(projects_root: Path, cwd: Path,
                              session_id=None) -> list[Path]:
    """`session_id` accepts a single UUID string, an iterable of UUIDs
    (the pointer file holds one per line), or None for all sessions."""
    wanted = _normalize_session_ids(session_id)
    encoded = encode_cwd_for_projects_dir(cwd)
    base = projects_root / encoded
    if not base.is_dir():
        return []
    transcripts: list[Path] = []
    for session_dir in base.iterdir():
        if not session_dir.is_dir():
            continue
        if wanted is not None and session_dir.name not in wanted:
            continue
        subdir = session_dir / "subagents"
        if not subdir.is_dir():
            continue
        for f in subdir.iterdir():
            if f.suffix == ".jsonl" and f.name.startswith("agent-"):
                transcripts.append(f)
    return transcripts


def orchestrator_transcript_for(subagent_transcript: Path) -> Path:
    """Map a subagent transcript to its parent session's own transcript.

        <base>/<session>/subagents/agent-<uuid>.jsonl   (in)
        <base>/<session>.jsonl                          (out)

    Deriving it from a MATCHED subagent — rather than scanning session dirs
    independently — is what keeps the orchestrator row scoped to sessions
    that actually drove this project.
    """
    session_dir = subagent_transcript.parent.parent
    return session_dir.parent / f"{session_dir.name}.jsonl"


def read_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    try:
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    except OSError:
        pass
    return rows


def transcript_mentions_project(rows: list[dict], project: str) -> bool:
    """Scan first 5 rows for the project name embedded in dispatch text."""
    for r in rows[:5]:
        text = _content_text(r)
        if not text:
            continue
        if f".loom/{project}" in text or f"`{project}`" in text:
            return True
    return False


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def orchestrator_rows(matched_subagents: list[Path]) -> list[dict]:
    """One row per session that contributed a matched subagent transcript.

    Reduced through the same path as a subagent row, so the token
    deduplication and duration contracts hold identically. A session whose
    own transcript is missing or unreadable is skipped rather than emitted
    as a crash sentinel — an absent orchestrator transcript means the
    harvest ran against a moved or pruned projects root, not that the
    orchestrator died.
    """
    seen: set[Path] = set()
    rows: list[dict] = []
    for sub in sorted(matched_subagents):
        transcript = orchestrator_transcript_for(sub)
        if transcript in seen or not transcript.is_file():
            continue
        seen.add(transcript)
        raw = read_rows(transcript)
        if not raw:
            continue
        tokens, wall_ms, autonomous_ms, model, cost_usd = sum_usage_and_durations(raw)
        if tokens is None:
            continue
        rows.append(build_row(
            phase=ORCHESTRATOR_PHASE,
            phase_source="session",
            agent_label=ORCHESTRATOR_LABEL,
            tokens=tokens,
            wall_ms=wall_ms,
            autonomous_ms=autonomous_ms,
            status="ok",
            quality=quality_counts(raw),
            model=model,
            cost_usd=cost_usd,
            agent_kind="orchestrator",
        ))
    return rows


def harvest(project: str, workspace: Path, projects_root: Path,
            cwd: Path, dry_run: bool = False,
            session_id=None) -> dict:
    """Reduce every transcript belonging to `project` into usage.jsonl rows.

    A transcript belongs to the project when ANY of these holds:

      1. its session is named in `session_id` (the `.session-pointer` bypass —
         the hook vouched for that session);
      2. its dispatch stamp says `Active project: <project>`;
      3. an ancestor transcript matched (nested helper agents);
      4. its dispatch text mentions `.loom/<project>` (legacy fallback).

    Rules 2 and 3 are what make measurement survive a run the PostToolUse hook
    never saw. Sessions are therefore always scanned in full, and `session_id`
    only WIDENS the match — it never narrows the search, because a pointer that
    is missing the session that actually drove the run would otherwise silence
    the whole run.
    """
    wanted_sessions = _normalize_session_ids(session_id)
    transcripts = find_subagent_transcripts(projects_root, cwd, None)
    if not transcripts:
        return {
            "project": project,
            "matched": 0,
            "candidates_scanned": 0,
            "rows": [],
            "dry_run": dry_run,
            "workspace": str(workspace),
            "note": f"no transcripts under {projects_root}/<cwd-encoding>",
        }

    # ---- Pass 1: reduce each transcript and collect its attribution evidence.
    records: list[dict] = []
    for t in sorted(transcripts):
        raw = read_rows(t)
        if not raw:
            continue
        dispatch_project, dispatch_phase = read_dispatch_context(raw)
        tokens, wall_ms, autonomous_ms, model, cost_usd = sum_usage_and_durations(raw)
        records.append({
            "path": t,
            "agent_id": agent_id_for(t),
            "session": t.parent.parent.name,
            "meta": read_meta(t),
            "sidecar_phase": read_phase_sidecar(t),
            "dispatch_project": dispatch_project,
            "dispatch_phase": dispatch_phase,
            "mentions_project": transcript_mentions_project(raw, project),
            "tokens": tokens,
            "wall_ms": wall_ms,
            "autonomous_ms": autonomous_ms,
            "model": model,
            "cost_usd": cost_usd,
            "quality": quality_counts(raw),
        })

    by_agent_id = {r["agent_id"]: r for r in records}

    # ---- Pass 2: resolve membership and phase, inheriting through parents.
    rows_out: list[dict] = []
    matched: list[Path] = []
    for rec in records:
        ancestor = resolve_via_parent(rec["agent_id"], by_agent_id)
        in_pointer = (wanted_sessions is not None
                      and rec["session"] in wanted_sessions)
        belongs = (
            in_pointer
            or rec["dispatch_project"] == project
            or (ancestor is not None and ancestor["dispatch_project"] == project)
            or rec["mentions_project"]
        )
        if not belongs:
            continue
        matched.append(rec["path"])

        phase, phase_source = rec["sidecar_phase"], "sidecar"
        if phase is None:
            phase, phase_source = rec["dispatch_phase"], "dispatch"
        if phase is None and ancestor is not None:
            phase, phase_source = ancestor["dispatch_phase"], "parent"
        if phase is None:
            phase, phase_source = read_phase_from_meta(rec["path"]), "meta"
        if phase is None:
            phase_source = None

        if rec["tokens"] is None:
            status = "crashed"
        elif phase is None:
            status = "untagged"
        else:
            status = "ok"
        rows_out.append(build_row(
            phase, phase_source, canonical_agent_label(phase),
            rec["tokens"], rec["wall_ms"],
            None if status == "crashed" else rec["autonomous_ms"],
            status, None if status == "crashed" else rec["quality"],
            rec["model"], rec["cost_usd"],
        ))

    rows_out.extend(orchestrator_rows(matched))

    if not dry_run and rows_out:
        out_path = workspace / "usage.jsonl"
        atomic_write_text(out_path, "".join(json.dumps(r) + "\n" for r in rows_out))

    return {
        "project": project,
        "matched": len(matched),
        "candidates_scanned": len(transcripts),
        "rows": rows_out,
        "matched_paths": [str(p) for p in matched],
        "rows_written": len(rows_out),
        "dry_run": dry_run,
        "workspace": str(workspace),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    ap.add_argument("project", help="Project name (e.g. baseline-1778870535-1)")
    ap.add_argument("--workspace", default=None,
                    help="Target dir to write usage.jsonl into. "
                         "Defaults to <repo>/.loom/<project>/.")
    ap.add_argument("--projects-root", default=str(Path.home() / ".claude" / "projects"),
                    help="Claude Code projects root (default: ~/.claude/projects).")
    ap.add_argument("--cwd", default=str(REPO_ROOT),
                    help="The cwd to look under in projects-root (default: repo root).")
    ap.add_argument("--session", action="append", default=None,
                    help="Claude Code session UUID; repeatable (the pointer "
                         "file holds one per line). Vouches for those sessions' "
                         "transcripts regardless of their own project evidence. "
                         "Widens the match only — every session under --cwd is "
                         "scanned either way.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Parse and report; do not write usage.jsonl.")
    args = ap.parse_args(argv)

    workspace = (Path(args.workspace).resolve()
                 if args.workspace
                 else (REPO_ROOT / ".loom" / args.project))
    summary = harvest(
        project=args.project,
        workspace=workspace,
        projects_root=Path(args.projects_root),
        cwd=Path(args.cwd),
        dry_run=args.dry_run,
        session_id=args.session,
    )

    print(f"project:    {summary['project']}")
    print(f"workspace:  {summary['workspace']}")
    print(f"scanned:    {summary['candidates_scanned']} subagent transcript(s)")
    print(f"matched:    {summary['matched']} for this project")
    if summary["matched"]:
        print("rows:")
        for r in summary["rows"]:
            ph = r["phase"] or "-"
            src = r["phase_source"] or "-"
            lbl = (r["agent_label"] or "-")[:32]
            cost = (f"${r['cost_usd']:.4f}"
                    if isinstance(r.get("cost_usd"), (int, float)) else "UNPRICED")
            print(f"  phase={ph!s:<13} via={src:<8} label={lbl:<32} "
                  f"status={r['status']:<9} cost={cost}")
        unpriced = [r for r in summary["rows"] if r.get("cost_usd") is None]
        if unpriced:
            models = sorted({r.get("model") or "unknown" for r in unpriced})
            print(f"warning:    {len(unpriced)} row(s) unpriced — no pricing entry "
                  f"for {', '.join(models)}")
    if summary.get("note"):
        print(f"note:       {summary['note']}")
    written = summary.get("rows_written", 0)
    if not args.dry_run and written:
        print(f"wrote:      {workspace / 'usage.jsonl'}  ({written} row(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
