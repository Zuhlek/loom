#!/usr/bin/env python3
"""Capture-subagent-eval hook.

Reads the Claude Code SubagentStop payload from stdin (`{transcript_path,
session_id, cwd}`), parses the Task transcript, and appends one JSON row
to `.loom/<project>/usage.jsonl`. Schema per `design.md § Capture hook
contract → Row schema`.

Sub-subagent invocations fold into a per-parent rollup file at
`.loom/<project>/.eval-rollup/<parent-session-id>.jsonl` (ADR-003). The
direct-subagent invocation sums in any pending rollup before writing its
own row and deletes the rollup file.

This hook is read-only with respect to Claude Code's decision surface and
returns 0 unconditionally. Errors go to stderr; the shim swallows the
Python exit code anyway.

`duration_autonomous_ms` is computed per the findings in
`AUTONOMOUS_DURATION.md` (timestamp-delta across assistant turns vs the
prior non-assistant anchor, with a defensive future-field check first).
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


TOKEN_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)


# --------------------------------------------------------------------------
# Timestamp parsing + duration math (per AUTONOMOUS_DURATION.md)
# --------------------------------------------------------------------------


_ISO_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z?$"
)


def _parse_iso(ts: str | None) -> _dt.datetime | None:
    if not ts or not isinstance(ts, str):
        return None
    m = _ISO_RE.match(ts.replace("+00:00", "Z"))
    if not m:
        # Fallback: try fromisoformat directly (handles offsets).
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


def autonomous_ms_from_rows(rows: list[dict]) -> int:
    """Sum (assistant.ts - prior-non-assistant.ts) deltas across assistant rows.

    Per `orchestrator/hooks/AUTONOMOUS_DURATION.md`. Defensive future-field
    check happens at the call site (sum_usage_and_durations).
    """
    total_ms = 0
    last_anchor: _dt.datetime | None = None
    for r in rows:
        ts = _parse_iso(r.get("timestamp"))
        if r.get("type") == "assistant":
            if last_anchor is not None and ts is not None:
                delta = _ms_between(last_anchor, ts)
                if delta > 0:
                    total_ms += delta
            # Consecutive assistant rows continue to anchor against the
            # last non-assistant timestamp (matches model-view).
        else:
            if ts is not None:
                last_anchor = ts
    return total_ms


def wall_ms_from_rows(rows: list[dict]) -> int:
    first_ts: _dt.datetime | None = None
    last_ts: _dt.datetime | None = None
    for r in rows:
        ts = _parse_iso(r.get("timestamp"))
        if ts is None:
            continue
        if first_ts is None:
            first_ts = ts
        last_ts = ts
    if first_ts is None or last_ts is None or last_ts < first_ts:
        return 0
    return _ms_between(first_ts, last_ts)


# --------------------------------------------------------------------------
# Token + duration sum (with defensive future-field check)
# --------------------------------------------------------------------------


def sum_usage_and_durations(rows: list[dict]) -> tuple[dict[str, int] | None, int, int | None]:
    """Return (tokens, wall_ms, autonomous_ms) for a transcript section.

    `tokens` is None if NO assistant row had a usage block (crash sentinel).
    `autonomous_ms` is None on the same condition.
    """
    have_any_usage = False
    explicit_server_time_ms = 0
    have_explicit_server_time = True  # only true if EVERY assistant turn had one
    totals = {k: 0 for k in TOKEN_KEYS}

    for r in rows:
        if r.get("type") != "assistant":
            continue
        msg = r.get("message") or {}
        usage = msg.get("usage") if isinstance(msg, dict) else None
        if not isinstance(usage, dict):
            # Assistant row missing usage block — treat as malformed turn,
            # do not contribute to totals.
            have_explicit_server_time = False
            continue
        have_any_usage = True
        for k in TOKEN_KEYS:
            v = usage.get(k, 0)
            if isinstance(v, (int, float)):
                totals[k] += int(v)
        # Defensive future-field check (per AUTONOMOUS_DURATION.md):
        explicit = None
        for field in ("server_time_ms", "latency_ms", "processing_time_ms"):
            if isinstance(usage.get(field), (int, float)):
                explicit = int(usage[field])
                break
        if explicit is None:
            have_explicit_server_time = False
        else:
            explicit_server_time_ms += explicit

    if not have_any_usage:
        wall = wall_ms_from_rows(rows)
        return None, wall, None

    wall = wall_ms_from_rows(rows)
    if have_explicit_server_time:
        autonomous = explicit_server_time_ms
    else:
        autonomous = autonomous_ms_from_rows(rows)
    return totals, wall, autonomous


# --------------------------------------------------------------------------
# Phase / agent_label extraction
# --------------------------------------------------------------------------


_PHASE_RE = re.compile(r"\[phase:\s*([a-z][a-z0-9_-]*)\s*\]", re.IGNORECASE)
_AGENT_RE = re.compile(r"\[agent:\s*([a-zA-Z0-9_./-]+)\s*\]")


def derive_phase_and_label(rows: list[dict]) -> tuple[str | None, str]:
    """Look at the transcript header for explicit `phase` / `agent_label`
    fields, then fall back to inline `[phase: …]` / `[agent: …]` markers in
    the first user message.

    Returns (phase | None, agent_label).
    """
    phase: str | None = None
    label: str | None = None

    for r in rows[:5]:
        if phase is None and isinstance(r.get("phase"), str):
            phase = r["phase"]
        if label is None and isinstance(r.get("agent_label"), str):
            label = r["agent_label"]
        if phase and label:
            break

    if phase is None or label is None:
        # Inline-marker fallback. Scan the first few user/system rows.
        for r in rows[:5]:
            text = _content_text(r)
            if not text:
                continue
            if phase is None:
                m = _PHASE_RE.search(text)
                if m:
                    phase = m.group(1)
            if label is None:
                m = _AGENT_RE.search(text)
                if m:
                    label = m.group(1)
            if phase and label:
                break

    return phase, (label or "unknown-agent")


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


# --------------------------------------------------------------------------
# Project resolution + parent-session detection
# --------------------------------------------------------------------------


def resolve_project(cwd: str) -> tuple[Path, str] | None:
    """Walk `cwd` to find a `.loom/<project>/` segment. Return (loom_dir, project)
    or None if not inside a Loom workspace.

    Mirrors the convention in `refresh-artifacts.sh`.
    """
    if not cwd:
        return None
    p = Path(cwd).resolve()
    parts = p.parts
    for i, part in enumerate(parts):
        if part == ".loom" and i + 1 < len(parts):
            project = parts[i + 1]
            loom_dir = Path(*parts[: i + 2])
            return loom_dir, project
    return None


def has_subagent_parent(rows: list[dict]) -> bool:
    """Detect whether the dispatched Task itself was dispatched by another
    subagent (i.e. this is a sub-subagent invocation).

    Heuristic: if every assistant row has `isSidechain: True` AND the
    transcript carries a `parentSessionId` (or equivalent) field that is
    itself a sidechain session, we treat it as a sub-subagent. In current
    Claude Code transcripts the explicit parent-session field is not always
    populated, so the conservative default is "no parent subagent" — direct
    rows are the common case. Sub-subagent rollup remains supported via the
    explicit field when present.
    """
    for r in rows[:3]:
        parent_field = r.get("parentSessionId") or r.get("parentSession")
        if isinstance(parent_field, str) and parent_field.startswith("sidechain:"):
            return True
        # Some transcripts may carry `parentAgentKind` directly.
        if r.get("parentAgentKind") == "subagent":
            return True
    return False


# --------------------------------------------------------------------------
# Row writers
# --------------------------------------------------------------------------


def build_row(phase: str | None, agent_label: str,
              tokens: dict | None, wall_ms: int, autonomous_ms: int | None,
              status: str) -> dict:
    return {
        "phase": phase,
        "agent_kind": "subagent",
        "agent_label": agent_label,
        "tokens": tokens,
        "duration_wall_ms": wall_ms,
        "duration_autonomous_ms": autonomous_ms,
        "status": status,
    }


def append_jsonl(path: Path, row: dict) -> None:
    """Append one JSON row. POSIX O_APPEND for line-atomicity on small writes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(row) + "\n"
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, line.encode("utf-8"))
    finally:
        os.close(fd)


# --------------------------------------------------------------------------
# Sub-subagent rollup (ADR-003)
# --------------------------------------------------------------------------


def fold_rollup_into_totals(rollup_path: Path,
                            tokens: dict | None,
                            wall_ms: int,
                            autonomous_ms: int | None) -> tuple[dict | None, int, int | None]:
    """Sum any pending rollup file entries into this parent's totals.

    Returns the updated (tokens, wall_ms, autonomous_ms). Crash sentinel
    semantics: if the parent has tokens=None it stays None (crash); rollup
    is only added when the parent itself is healthy.
    """
    if not rollup_path.exists():
        return tokens, wall_ms, autonomous_ms

    try:
        rollup_rows = [
            json.loads(line)
            for line in rollup_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    except Exception:
        rollup_rows = []

    if tokens is None:
        # Parent crashed — leave rollup file for aggregator orphan sweep.
        return tokens, wall_ms, autonomous_ms

    for rr in rollup_rows:
        t = rr.get("tokens")
        if isinstance(t, dict):
            for k in TOKEN_KEYS:
                v = t.get(k, 0)
                if isinstance(v, (int, float)):
                    tokens[k] = tokens.get(k, 0) + int(v)
        wm = rr.get("duration_wall_ms")
        if isinstance(wm, (int, float)):
            wall_ms += int(wm)
        am = rr.get("duration_autonomous_ms")
        if isinstance(am, (int, float)) and autonomous_ms is not None:
            autonomous_ms += int(am)

    try:
        rollup_path.unlink()
    except OSError:
        pass
    return tokens, wall_ms, autonomous_ms


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        print(f"capture-subagent-eval: cannot parse stdin payload: {exc}", file=sys.stderr)
        return 0

    transcript_path = payload.get("transcript_path")
    cwd = payload.get("cwd") or ""
    session_id = payload.get("session_id") or ""

    if not transcript_path:
        return 0
    tpath = Path(transcript_path)
    if not tpath.exists():
        return 0

    resolved = resolve_project(cwd)
    if resolved is None:
        return 0
    loom_dir, _project = resolved

    # Load transcript.
    rows: list[dict] = []
    try:
        for line in tpath.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    except Exception as exc:
        print(f"capture-subagent-eval: cannot read transcript: {exc}", file=sys.stderr)
        # Best-effort crash sentinel with no measurements.
        sentinel = build_row(None, "unknown-agent", None, 0, None, "crashed")
        append_jsonl(loom_dir / "usage.jsonl", sentinel)
        return 0

    if not rows:
        sentinel = build_row(None, "unknown-agent", None, 0, None, "crashed")
        append_jsonl(loom_dir / "usage.jsonl", sentinel)
        return 0

    phase, agent_label = derive_phase_and_label(rows)
    tokens, wall_ms, autonomous_ms = sum_usage_and_durations(rows)

    # ADR-003: sub-subagent rollup. If this Task has a non-/weave parent,
    # append its measurement to the parent's rollup file instead of writing
    # a top-level row.
    is_sub_sub = has_subagent_parent(rows)
    if is_sub_sub:
        parent = next((r.get("parentSessionId") or r.get("parentSession") for r in rows[:3]
                       if isinstance(r.get("parentSessionId") or r.get("parentSession"), str)),
                      None)
        if parent:
            rollup_path = loom_dir / ".eval-rollup" / f"{parent}.jsonl"
            entry = {
                "tokens": tokens,
                "duration_wall_ms": wall_ms,
                "duration_autonomous_ms": autonomous_ms,
                "status": "ok" if tokens is not None else "crashed",
                "agent_label": agent_label,
            }
            append_jsonl(rollup_path, entry)
            return 0
        # Couldn't determine parent — fall through and write a top-level row.

    # Fold in any pending sub-subagent rollup for THIS session.
    rollup_path = loom_dir / ".eval-rollup" / f"{session_id}.jsonl"
    tokens, wall_ms, autonomous_ms = fold_rollup_into_totals(
        rollup_path, tokens, wall_ms, autonomous_ms,
    )

    status = "ok" if tokens is not None else "crashed"
    row = build_row(phase, agent_label, tokens, wall_ms, autonomous_ms, status)
    append_jsonl(loom_dir / "usage.jsonl", row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
