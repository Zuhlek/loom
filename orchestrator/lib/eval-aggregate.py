#!/usr/bin/env python3
"""eval-aggregate — reads `.loom/<project>/usage.jsonl`, writes `usage.md`.

Output schema follows `design.md § Aggregator contract → Output schema`:
- Per-phase totals (four token buckets + autonomous + wall)
- Per-phase orchestrator-vs-subagent split (wall + autonomous)
- Overall run totals
- Optional "Crashed invocations" section (crash sentinel rows excluded
  from token totals)

`review.md` is never written, modified, or read.

Includes orphan-rollup sweep per ADR-003: scan `.eval-rollup/` once,
fold any leftover sub-subagent rollup files into synthetic crashed
parent rows before rendering.

Atomic write via tempfile + os.replace, matching the pattern in
`orchestrator/lib/atomic-write.sh`.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any


TOKEN_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)


def _empty_tokens() -> dict[str, int]:
    return {k: 0 for k in TOKEN_KEYS}


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out: list[dict] = []
    text = path.read_text(encoding="utf-8", errors="ignore")
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            # Skip malformed line; keep the rest of the run usable.
            continue
    return out


def _read_rollup_orphans(rollup_dir: Path) -> list[dict]:
    """Fold each remaining .eval-rollup/*.jsonl into a synthetic crashed
    parent row. Returns the list of synthetic rows.

    Each rollup file is one sub-subagent's measurement per line; the
    synthetic row sums them and is marked `status: crashed` (because the
    parent never wrote its own row, so the rollup was orphaned).
    """
    if not rollup_dir.is_dir():
        return []
    synthesized: list[dict] = []
    for f in sorted(rollup_dir.glob("*.jsonl")):
        sums = _empty_tokens()
        wall_ms = 0
        autonomous_ms: int | None = 0
        any_null_autonomous = False
        sub_labels: list[str] = []
        try:
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                tok = e.get("tokens")
                if isinstance(tok, dict):
                    for k in TOKEN_KEYS:
                        v = tok.get(k, 0)
                        if isinstance(v, (int, float)):
                            sums[k] += int(v)
                wm = e.get("duration_wall_ms")
                if isinstance(wm, (int, float)):
                    wall_ms += int(wm)
                am = e.get("duration_autonomous_ms")
                if isinstance(am, (int, float)):
                    if autonomous_ms is not None:
                        autonomous_ms += int(am)
                else:
                    any_null_autonomous = True
                if isinstance(e.get("agent_label"), str):
                    sub_labels.append(e["agent_label"])
        except Exception:
            continue
        # The orphan represents a crashed parent. Per design.md, crash
        # sentinels carry tokens=null and autonomous=null. But to keep
        # signal we emit the synthesized totals as the body of the
        # crashed-invocation listing rather than the token totals.
        synthesized.append({
            "phase": None,
            "agent_kind": "subagent",
            "agent_label": "orphan-rollup:" + (",".join(sub_labels) or f.stem),
            "tokens": None,
            "duration_wall_ms": wall_ms,
            "duration_autonomous_ms": None if any_null_autonomous else autonomous_ms,
            "status": "crashed",
        })
    return synthesized


def _phase_key(row: dict) -> str:
    p = row.get("phase")
    return p if isinstance(p, str) and p else "unknown"


def _is_crashed(row: dict) -> bool:
    return row.get("status") == "crashed" or row.get("tokens") is None


def _render_table(headers: list[str], rows: list[list[str]]) -> str:
    if not rows:
        return ""
    out = []
    out.append("| " + " | ".join(headers) + " |")
    out.append("| " + " | ".join("---" for _ in headers) + " |")
    for r in rows:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)


def aggregate(project: str, loom_root: Path) -> str:
    project_dir = loom_root / project
    usage_jsonl = project_dir / "usage.jsonl"
    rollup_dir = project_dir / ".eval-rollup"

    rows = _read_jsonl(usage_jsonl)
    orphans = _read_rollup_orphans(rollup_dir)

    # Phase ordering: stable known order first, then anything else alpha.
    KNOWN_PHASES = ("spec", "design", "plan", "build", "review")
    phases_seen: list[str] = []
    seen_set: set[str] = set()
    for r in rows:
        p = _phase_key(r)
        if p not in seen_set:
            seen_set.add(p)
            phases_seen.append(p)
    ordered_phases = (
        [p for p in KNOWN_PHASES if p in seen_set]
        + sorted(p for p in phases_seen if p not in KNOWN_PHASES)
    )

    # Per-phase totals (excluding crashed rows).
    per_phase: dict[str, dict] = {}
    for p in ordered_phases:
        per_phase[p] = {
            "tokens": _empty_tokens(),
            "wall_ms": 0,
            "autonomous_ms": 0,
            # subagent-vs-orchestrator split:
            "orch_wall_ms": 0,
            "orch_autonomous_ms": 0,
            "sub_wall_ms": 0,
            "sub_autonomous_ms": 0,
        }
    crashed_rows: list[dict] = []

    for r in rows:
        if _is_crashed(r):
            crashed_rows.append(r)
            continue
        p = _phase_key(r)
        bucket = per_phase.setdefault(p, {
            "tokens": _empty_tokens(),
            "wall_ms": 0,
            "autonomous_ms": 0,
            "orch_wall_ms": 0,
            "orch_autonomous_ms": 0,
            "sub_wall_ms": 0,
            "sub_autonomous_ms": 0,
        })
        tok = r.get("tokens") or {}
        for k in TOKEN_KEYS:
            v = tok.get(k, 0)
            if isinstance(v, (int, float)):
                bucket["tokens"][k] += int(v)
        wm = r.get("duration_wall_ms")
        if isinstance(wm, (int, float)):
            bucket["wall_ms"] += int(wm)
        am = r.get("duration_autonomous_ms")
        if isinstance(am, (int, float)):
            bucket["autonomous_ms"] += int(am)
        if r.get("agent_kind") == "orchestrator":
            if isinstance(wm, (int, float)):
                bucket["orch_wall_ms"] += int(wm)
            if isinstance(am, (int, float)):
                bucket["orch_autonomous_ms"] += int(am)
        else:
            if isinstance(wm, (int, float)):
                bucket["sub_wall_ms"] += int(wm)
            if isinstance(am, (int, float)):
                bucket["sub_autonomous_ms"] += int(am)
        # Ensure ordered_phases reflects insertion order for unknowns.
        if p not in ordered_phases:
            ordered_phases.append(p)

    # Run totals.
    run = _empty_tokens()
    run_wall = 0
    run_autonomous = 0
    for p in ordered_phases:
        b = per_phase[p]
        for k in TOKEN_KEYS:
            run[k] += b["tokens"][k]
        run_wall += b["wall_ms"]
        run_autonomous += b["autonomous_ms"]

    # Render markdown.
    lines: list[str] = []
    lines.append(f"# Cost summary — {project}")
    lines.append("")
    lines.append("## Per-phase totals")
    lines.append("")
    if ordered_phases:
        headers = ["Phase", "Wall ms", "Autonomous ms",
                   "input", "output", "cache_create", "cache_read"]
        body = []
        for p in ordered_phases:
            b = per_phase[p]
            body.append([
                p,
                str(b["wall_ms"]),
                str(b["autonomous_ms"]),
                str(b["tokens"]["input_tokens"]),
                str(b["tokens"]["output_tokens"]),
                str(b["tokens"]["cache_creation_input_tokens"]),
                str(b["tokens"]["cache_read_input_tokens"]),
            ])
        lines.append(_render_table(headers, body))
    else:
        lines.append("_no rows captured (zero invocations)_")
    lines.append("")
    lines.append("## Per-phase orchestrator vs subagent split")
    lines.append("")
    if ordered_phases:
        headers = ["Phase", "Orch wall", "Orch autonomous", "Sub wall", "Sub autonomous"]
        body = []
        for p in ordered_phases:
            b = per_phase[p]
            body.append([
                p,
                str(b["orch_wall_ms"]),
                str(b["orch_autonomous_ms"]),
                str(b["sub_wall_ms"]),
                str(b["sub_autonomous_ms"]),
            ])
        lines.append(_render_table(headers, body))
    else:
        lines.append("_no rows captured_")
    lines.append("")
    lines.append("## Run totals")
    lines.append("")
    lines.append(f"- Wall ms: {run_wall}")
    lines.append(f"- Autonomous ms: {run_autonomous}")
    lines.append(
        f"- Tokens: input={run['input_tokens']}, output={run['output_tokens']}, "
        f"cache_create={run['cache_creation_input_tokens']}, "
        f"cache_read={run['cache_read_input_tokens']}"
    )
    lines.append("")
    lines.append("## Crashed invocations")
    lines.append("")
    combined_crashed = crashed_rows + orphans
    if not combined_crashed:
        lines.append("_(none)_")
    else:
        for r in combined_crashed:
            phase = r.get("phase") or "?"
            label = r.get("agent_label") or "?"
            wm = r.get("duration_wall_ms")
            wm_s = f"{wm} ms" if isinstance(wm, (int, float)) else "no wall captured"
            lines.append(f"- ({phase}, {label}) — wall {wm_s}, no tokens captured")
    lines.append("")

    return "\n".join(lines)


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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Aggregate usage.jsonl → usage.md")
    ap.add_argument("project", help="Loom project name (under .loom/<project>/)")
    ap.add_argument("--loom-root", default=os.environ.get("LOOM_ROOT", ".loom"))
    args = ap.parse_args(argv)

    loom_root = Path(args.loom_root)
    project_dir = loom_root / args.project
    project_dir.mkdir(parents=True, exist_ok=True)

    md = aggregate(args.project, loom_root)
    atomic_write_text(project_dir / "usage.md", md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
