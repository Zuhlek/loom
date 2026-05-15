#!/usr/bin/env python3
"""eval-orchestrator-row — emit one `agent_kind: orchestrator` row per
phase boundary.

Called by /weave at phase-cycle step 3e (per design.md § Orchestrator-row
capture + ADR-004). Reads the current Claude Code session transcript,
sums usage / duration figures across the orchestrator's own assistant
turns since the last orchestrator-row write, subtracts the sum of all
subagent rows already written for this phase, and appends one row with
`agent_kind: "orchestrator"`, `agent_label: "weave"`,
`phase: <just-completed-phase>` to `usage.jsonl`.

Idempotency: tracks the last-emitted message uuid in
`.loom/<project>/.eval-orchestrator-pointer`. Re-invocation with no new
turns is a no-op (no row appended, pointer unchanged).

Transcript path resolution: uses `CLAUDE_CODE_SESSION_ID` + cwd-encoding
per `ORCHESTRATOR_TRANSCRIPT.md` (T-006 findings). May be overridden via
`--transcript <path>` for testing.

If the transcript cannot be located OR cannot be read, write a synthetic
crashed orchestrator row (tokens=null, autonomous=null) so US-001 AC-3
is honoured even when the session is unhealthy.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


# Re-use the parser pieces from capture-subagent-eval.py without forcing a
# shared module import (keeps each script self-contained for hook-style
# deployment). Small, focused duplicates only.


_ISO_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z?$"
)
TOKEN_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)


def _parse_iso(ts: str | None):
    import datetime as _dt
    if not ts or not isinstance(ts, str):
        return None
    m = _ISO_RE.match(ts.replace("+00:00", "Z"))
    if m:
        y, mo, d, hh, mm, ss, frac = m.groups()
        micro = int((frac + "000000")[:6]) if frac else 0
        return _dt.datetime(int(y), int(mo), int(d), int(hh), int(mm), int(ss), micro,
                            tzinfo=_dt.timezone.utc)
    try:
        s = ts[:-1] + "+00:00" if ts.endswith("Z") else ts
        return _dt.datetime.fromisoformat(s)
    except ValueError:
        return None


def _resolve_transcript(cwd: str) -> Path | None:
    """Per ORCHESTRATOR_TRANSCRIPT.md."""
    session_id = os.environ.get("CLAUDE_CODE_SESSION_ID")
    if not session_id:
        return None
    encoded = re.sub(r"[ /]", "-", str(cwd))
    candidate = Path.home() / ".claude" / "projects" / encoded / f"{session_id}.jsonl"
    return candidate if candidate.exists() else None


def _read_rows(transcript: Path) -> list[dict]:
    rows: list[dict] = []
    for line in transcript.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def _sum_orchestrator_section(rows: list[dict]) -> tuple[dict[str, int], int, int, str | None]:
    """Sum tokens / wall / autonomous over rows whose isSidechain is False
    (i.e. the orchestrator's own assistant turns, not dispatched-Task
    subagent turns).

    Returns (tokens, wall_ms, autonomous_ms, last_uuid). last_uuid is the
    uuid of the final orchestrator assistant row, used as the pointer.
    """
    tokens = {k: 0 for k in TOKEN_KEYS}
    wall_first = None
    wall_last = None
    autonomous_ms = 0
    last_anchor = None
    last_uuid: str | None = None
    for r in rows:
        if r.get("isSidechain"):
            continue  # Subagent turn — not the orchestrator's.
        ts = _parse_iso(r.get("timestamp"))
        if r.get("type") == "assistant":
            msg = r.get("message") or {}
            usage = msg.get("usage") if isinstance(msg, dict) else None
            if isinstance(usage, dict):
                for k in TOKEN_KEYS:
                    v = usage.get(k, 0)
                    if isinstance(v, (int, float)):
                        tokens[k] += int(v)
            if ts is not None:
                if wall_first is None:
                    wall_first = ts
                wall_last = ts
                if last_anchor is not None:
                    delta = int((ts - last_anchor).total_seconds() * 1000)
                    if delta > 0:
                        autonomous_ms += delta
            if isinstance(r.get("uuid"), str):
                last_uuid = r["uuid"]
        else:
            if ts is not None:
                last_anchor = ts
                if wall_first is None:
                    wall_first = ts
                wall_last = ts

    wall_ms = 0
    if wall_first is not None and wall_last is not None and wall_last >= wall_first:
        wall_ms = int((wall_last - wall_first).total_seconds() * 1000)
    return tokens, wall_ms, autonomous_ms, last_uuid


def _phase_subagent_sums(usage_jsonl: Path, phase: str) -> tuple[dict[str, int], int, int]:
    tokens = {k: 0 for k in TOKEN_KEYS}
    wall = 0
    autonomous = 0
    if not usage_jsonl.exists():
        return tokens, wall, autonomous
    for line in usage_jsonl.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("phase") != phase:
            continue
        if r.get("agent_kind") != "subagent":
            continue
        tok = r.get("tokens") or {}
        if isinstance(tok, dict):
            for k in TOKEN_KEYS:
                v = tok.get(k, 0)
                if isinstance(v, (int, float)):
                    tokens[k] += int(v)
        wm = r.get("duration_wall_ms")
        am = r.get("duration_autonomous_ms")
        if isinstance(wm, (int, float)):
            wall += int(wm)
        if isinstance(am, (int, float)):
            autonomous += int(am)
    return tokens, wall, autonomous


def _append_jsonl(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(row) + "\n"
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, line.encode("utf-8"))
    finally:
        os.close(fd)


def _atomic_write(path: Path, text: str) -> None:
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


def _read_pointer(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def _slice_after_pointer(rows: list[dict], pointer: str | None) -> list[dict]:
    """Return the suffix of rows AFTER the row whose uuid == pointer.

    If pointer is None or not found, return all rows.
    """
    if not pointer:
        return rows
    for i, r in enumerate(rows):
        if r.get("uuid") == pointer:
            return rows[i + 1:]
    # Pointer not found — sessions may have changed; return all.
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Emit one orchestrator row at phase boundary.")
    ap.add_argument("--project", required=True)
    ap.add_argument("--phase", required=True)
    ap.add_argument("--transcript", default=None,
                    help="Override transcript path (testing). Otherwise resolved "
                         "via CLAUDE_CODE_SESSION_ID + cwd.")
    ap.add_argument("--loom-root", default=os.environ.get("LOOM_ROOT", ".loom"))
    args = ap.parse_args(argv)

    loom_root = Path(args.loom_root)
    project_dir = loom_root / args.project
    project_dir.mkdir(parents=True, exist_ok=True)
    usage_jsonl = project_dir / "usage.jsonl"
    pointer_path = project_dir / ".eval-orchestrator-pointer"

    # Resolve transcript.
    if args.transcript:
        transcript_path: Path | None = Path(args.transcript)
        if not transcript_path.exists():
            transcript_path = None
    else:
        transcript_path = _resolve_transcript(os.getcwd())

    if transcript_path is None:
        # Synthetic crashed row per ORCHESTRATOR_TRANSCRIPT.md fallback 2.
        row = {
            "phase": args.phase,
            "agent_kind": "orchestrator",
            "agent_label": "weave",
            "tokens": None,
            "duration_wall_ms": 0,
            "duration_autonomous_ms": None,
            "status": "crashed",
        }
        _append_jsonl(usage_jsonl, row)
        return 0

    rows = _read_rows(transcript_path)
    pointer = _read_pointer(pointer_path)
    sliced = _slice_after_pointer(rows, pointer)

    if not sliced:
        # No new turns since the last orchestrator-row write — idempotent
        # no-op. Pointer stays where it is.
        return 0

    session_tokens, session_wall_ms, session_autonomous_ms, last_uuid = \
        _sum_orchestrator_section(sliced)

    sub_tokens, sub_wall_ms, sub_autonomous_ms = _phase_subagent_sums(
        usage_jsonl, args.phase,
    )

    # Orchestrator-only delta (clamped at 0 to handle pointer edge cases).
    orch_tokens = {k: max(0, session_tokens[k] - sub_tokens[k]) for k in TOKEN_KEYS}
    orch_wall_ms = max(0, session_wall_ms - sub_wall_ms)
    orch_autonomous_ms = max(0, session_autonomous_ms - sub_autonomous_ms)

    row = {
        "phase": args.phase,
        "agent_kind": "orchestrator",
        "agent_label": "weave",
        "tokens": orch_tokens,
        "duration_wall_ms": orch_wall_ms,
        "duration_autonomous_ms": orch_autonomous_ms,
        "status": "ok",
    }
    _append_jsonl(usage_jsonl, row)

    if last_uuid:
        _atomic_write(pointer_path, last_uuid + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
