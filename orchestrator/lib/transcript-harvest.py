#!/usr/bin/env python3
"""transcript-harvest — reconstruct a workspace's usage.jsonl from Claude
Code's session transcripts on disk.

This is the SOLE source of performance figures for the eval harness. There
is no live SubagentStop hook anymore; everything we need is already in the
transcripts Claude Code persists under `~/.claude/projects/`.

Each assistant turn in a transcript carries an SDK `usage` block (the four
token buckets plus per-turn timing). We walk every subagent transcript
whose dispatch prompt names the project, parse it, and emit one
`agent_kind: subagent` row per agent into `<workspace>/usage.jsonl`.

Limitation (documented, may be lifted later): we do NOT currently emit
`agent_kind: orchestrator` rows. The orchestrator's own /weave session
runs Spec partly inline (answers-queue consumer) — that work would have
been captured by the live phase-boundary helper we removed. For
comparison across runs of the same seed using the same `--answers` file,
the orchestrator-side cost is roughly constant per phase and folding it
in is an enhancement rather than a correctness need. Subagent rows alone
cover the bulk of measured cost and the differences that actually move
across loom versions.

Usage:
  python3 orchestrator/lib/transcript-harvest.py <project> [--workspace PATH]
                                                          [--projects-root PATH]
                                                          [--cwd PATH]
                                                          [--session UUID]
                                                          [--dry-run]

By default the workspace is `.loom/<project>/` relative to the repo root.
Pass `--workspace` for a filed run (e.g. `analytics/<version>/<run-id>/`).
Pass `--session UUID` to bypass the dispatch-text project match and pull
transcripts out of exactly one Claude Code session dir — the reliable
key once the originating `.loom/<project>/` workspace has been discarded.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent.parent


# --------------------------------------------------------------------------
# Parser primitives — moved here from the deleted capture-subagent-eval.py.
# These are pure functions over a list of transcript-row dicts.
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
    first_ts = last_ts = None
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


def _autonomous_ms_from_rows(rows: list[dict]) -> int:
    """Sum (assistant_ts - prior-non-assistant_ts) deltas across assistant rows.
    Mirrors the algorithm documented in the prior AUTONOMOUS_DURATION.md."""
    total_ms = 0
    last_anchor: _dt.datetime | None = None
    for r in rows:
        ts = _parse_iso(r.get("timestamp"))
        if r.get("type") == "assistant":
            if last_anchor is not None and ts is not None:
                delta = _ms_between(last_anchor, ts)
                if delta > 0:
                    total_ms += delta
        else:
            if ts is not None:
                last_anchor = ts
    return total_ms


def sum_usage_and_durations(rows: list[dict]) -> tuple[dict[str, int] | None, int, int | None]:
    """Return (tokens, wall_ms, autonomous_ms) for a transcript section.

    `tokens` is None if NO assistant row had a usage block (crash sentinel).
    `autonomous_ms` is None on the same condition.
    """
    have_any_usage = False
    explicit_server_time_ms = 0
    have_explicit_server_time = True
    totals = {k: 0 for k in TOKEN_KEYS}

    for r in rows:
        if r.get("type") != "assistant":
            continue
        msg = r.get("message") or {}
        usage = msg.get("usage") if isinstance(msg, dict) else None
        if not isinstance(usage, dict):
            have_explicit_server_time = False
            continue
        have_any_usage = True
        for k in TOKEN_KEYS:
            v = usage.get(k, 0)
            if isinstance(v, (int, float)):
                totals[k] += int(v)
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
        return None, _wall_ms_from_rows(rows), None

    wall = _wall_ms_from_rows(rows)
    if have_explicit_server_time:
        autonomous = explicit_server_time_ms
    else:
        autonomous = _autonomous_ms_from_rows(rows)
    return totals, wall, autonomous


_PHASE_RE = re.compile(r"\[phase:\s*([a-z][a-z0-9_-]*)\s*\]", re.IGNORECASE)
_PHASE_KEYWORD_RE = re.compile(r"\b(spec|design|plan|build|review)\b", re.IGNORECASE)

VALID_PHASES = ("spec", "design", "plan", "build", "review")


def canonical_agent_label(phase: str | None) -> str:
    """Deterministic human-readable label keyed off phase.

    The label is derived solely from the phase so cross-run grouping is
    stable regardless of the dispatch description text the orchestrator
    LLM chose for its Task call.
    """
    if phase in VALID_PHASES:
        return f"{phase.capitalize()} phase agent"
    return "unknown-agent"


def derive_phase(rows: list[dict],
                 transcript_path: Path | None = None) -> str | None:
    """Resolve the phase for a subagent transcript.

    Tries (in order):
      1. Explicit `phase` field in the first 5 rows of the transcript.
      2. `[phase: …]` markers in early user message text.
      3. Sibling `<transcript-stem>.meta.json` `description` —
         /weave dispatch descriptions reliably contain the phase keyword.
    """
    for row in rows[:5]:
        candidate = row.get("phase")
        if isinstance(candidate, str) and candidate.lower() in VALID_PHASES:
            return candidate.lower()

    for row in rows[:5]:
        text = _content_text(row)
        if not text:
            continue
        match = _PHASE_RE.search(text)
        if match and match.group(1).lower() in VALID_PHASES:
            return match.group(1).lower()
        match = _PHASE_KEYWORD_RE.search(text)
        if match:
            return match.group(1).lower()

    if transcript_path is not None:
        meta_path = transcript_path.parent / (transcript_path.stem + ".meta.json")
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                description = meta.get("description")
                if isinstance(description, str):
                    match = _PHASE_KEYWORD_RE.search(description)
                    if match:
                        return match.group(1).lower()
            except (OSError, json.JSONDecodeError):
                pass

    return None


def derive_phase_and_label(rows: list[dict],
                           transcript_path: Path | None = None) -> tuple[str | None, str]:
    phase = derive_phase(rows, transcript_path)
    return phase, canonical_agent_label(phase)


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


# --------------------------------------------------------------------------
# Harvester
# --------------------------------------------------------------------------


def encode_cwd_for_projects_dir(cwd: Path) -> str:
    """Claude Code encodes a session's cwd as the projects subdirectory name
    by replacing both path separators AND spaces with dashes. Verified
    empirically against `~/.claude/projects/`."""
    return str(cwd).replace("/", "-").replace(" ", "-")


def find_subagent_transcripts(projects_root: Path, cwd: Path,
                              session_id: str | None = None) -> list[Path]:
    encoded = encode_cwd_for_projects_dir(cwd)
    base = projects_root / encoded
    if not base.is_dir():
        return []
    transcripts: list[Path] = []
    for session_dir in base.iterdir():
        if not session_dir.is_dir():
            continue
        if session_id is not None and session_dir.name != session_id:
            continue
        subdir = session_dir / "subagents"
        if not subdir.is_dir():
            continue
        for f in subdir.iterdir():
            if f.suffix == ".jsonl" and f.name.startswith("agent-"):
                transcripts.append(f)
    return transcripts


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


def harvest(project: str, workspace: Path, projects_root: Path,
            cwd: Path, dry_run: bool = False,
            session_id: str | None = None) -> dict:
    transcripts = find_subagent_transcripts(projects_root, cwd, session_id)
    if not transcripts:
        return {
            "project": project,
            "matched": 0,
            "candidates_scanned": 0,
            "rows": [],
            "dry_run": dry_run,
            "workspace": str(workspace),
            "note": (f"no transcripts under {projects_root}/<cwd-encoding>/{session_id}"
                     if session_id
                     else f"no transcripts under {projects_root}/<cwd-encoding>"),
        }

    rows_out: list[dict] = []
    matched: list[Path] = []
    for t in sorted(transcripts):
        raw = read_rows(t)
        if not raw:
            continue
        if session_id is None and not transcript_mentions_project(raw, project):
            continue
        matched.append(t)

        phase, agent_label = derive_phase_and_label(raw, t)
        tokens, wall_ms, autonomous_ms = sum_usage_and_durations(raw)
        status = "ok" if tokens is not None else "crashed"
        row = build_row(phase, agent_label, tokens, wall_ms, autonomous_ms, status)
        rows_out.append(row)

    if not dry_run and rows_out:
        out_path = workspace / "usage.jsonl"
        atomic_write_text(out_path, "".join(json.dumps(r) + "\n" for r in rows_out))

    return {
        "project": project,
        "matched": len(matched),
        "candidates_scanned": len(transcripts),
        "rows": rows_out,
        "matched_paths": [str(p) for p in matched],
        "dry_run": dry_run,
        "workspace": str(workspace),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    ap.add_argument("project", help="Project name (e.g. baseline-1778870535-1)")
    ap.add_argument("--workspace", default=None,
                    help="Target dir to write usage.jsonl into. "
                         "Defaults to <repo>/.loom/<project>/. Pass the filed "
                         "location when backfilling a moved workspace.")
    ap.add_argument("--projects-root", default=str(Path.home() / ".claude" / "projects"),
                    help="Claude Code projects root (default: ~/.claude/projects).")
    ap.add_argument("--cwd", default=str(REPO_ROOT),
                    help="The cwd to look under in projects-root (default: repo root).")
    ap.add_argument("--session", default=None,
                    help="Claude Code session UUID. When set, transcripts are "
                         "pulled from exactly that session dir and the "
                         "dispatch-text project match is bypassed.")
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
            lbl = (r["agent_label"] or "-")[:45]
            print(f"  phase={ph!s:<8} label={lbl:<45} status={r['status']}")
    if summary.get("note"):
        print(f"note:       {summary['note']}")
    if not args.dry_run and summary["matched"]:
        print(f"wrote:      {workspace / 'usage.jsonl'}  ({summary['matched']} row(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
