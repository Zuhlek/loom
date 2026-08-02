#!/usr/bin/env python3
"""render-metrics — reads `.loom/<project>/usage.jsonl`, writes `metrics.md`.

`metrics.md` is the run's measurement artifact: what the `/weave` lifecycle
cost, where it went, and how the run ended. It is machine-generated on every
refresh and owned by the Review phase by contract (see
`phases/review/phase.signature.md`). No agent edits it.

Fixed-shape contract — the reason this renderer has no conditional prose:

- The section order is constant. Every section renders on every run.
- The six buckets — spec, design, plan, build, review, orchestrator — each
  render a row whether or not they carry data. A zero is a `0`, never an
  omission and never an em dash. Unexpected phase keys append after the six
  rather than being folded away, so attribution gaps stay visible.
- The metric set is constant: estimated cost, wall ms, autonomous ms, the
  four token buckets, cache hit rate, and the three quality counters.
- Tables and charts only. No sentences, so two runs differ in their numbers
  and nothing else.

Charts are mermaid, which the loom UI renders natively (`MermaidBlock.tsx`)
and GitHub renders inline. Degenerate data — an all-zero run, a single
phase — must still emit a syntactically valid fence; see `_bar_chart` and
`_pie_chart`.

Atomic write via tempfile + os.replace.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path


TOKEN_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)

# The five lifecycle phases plus the orchestrator, which drives all of them
# and is therefore its own bucket rather than being attributed to one.
BUCKETS = ("spec", "design", "plan", "build", "review", "orchestrator")


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


def _phase_key(row: dict) -> str:
    p = row.get("phase")
    return p if isinstance(p, str) and p else "unknown"


def _is_crashed(row: dict) -> bool:
    return row.get("status") == "crashed" or row.get("tokens") is None


def _int(value) -> int:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _empty_bucket() -> dict:
    return {
        "tokens": _empty_tokens(),
        "wall_ms": 0,
        "autonomous_ms": 0,
        "error_results": 0,
        "read_errors": 0,
        "bash_failures": 0,
        "cost_usd": 0.0,
    }


def _cache_hit_rate(tokens: dict[str, int]) -> float:
    """Share of non-output input that came from cache. Denominator is every
    way a token can enter context, so the rate is comparable across phases
    with very different absolute sizes."""
    read = tokens["cache_read_input_tokens"]
    den = read + tokens["cache_creation_input_tokens"] + tokens["input_tokens"]
    return (read / den) if den else 0.0


# --------------------------------------------------------------------------
# Rendering primitives
# --------------------------------------------------------------------------

def _table(headers: list[str], rows: list[list[str]]) -> str:
    """Header and separator always render, even with zero data rows — an
    empty table is valid markdown and keeps the section shape constant."""
    out = ["| " + " | ".join(headers) + " |",
           "| " + " | ".join("---" for _ in headers) + " |"]
    for r in rows:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)


def _bar_chart(title: str, y_label: str, labels: list[str],
               values: list[float], decimals: int = 4) -> str:
    """A mermaid `xychart-beta` bar fence.

    Guards the two ways real data breaks the renderer: an empty series (no
    rows at all) and an all-zero series, where a zero-height y-axis makes
    mermaid emit a degenerate scale. The axis floor is 1 in both cases.
    """
    if not labels:
        labels, values = ["none"], [0.0]
    top = max(values) if values else 0.0
    if top <= 0:
        top = 1.0
    fmt = f"%.{decimals}f"
    return "\n".join([
        "```mermaid",
        "xychart-beta",
        f'    title "{title}"',
        "    x-axis [" + ", ".join(labels) + "]",
        f'    y-axis "{y_label}" 0 --> {fmt % top}',
        "    bar [" + ", ".join(fmt % v for v in values) + "]",
        "```",
    ])


def _pie_chart(title: str, labels: list[str], values: list[float]) -> str:
    """A mermaid `pie` fence.

    Mermaid derives percentages by dividing by the total, so an all-zero
    series would divide by zero. That case falls back to a single
    placeholder slice; every other case keeps all slices — including zero
    ones — so the legend is the same six entries on every run.
    """
    total = sum(values)
    lines = ["```mermaid", "pie showData", f'    title {title}']
    if total <= 0:
        lines.append('    "no cost recorded" : 1')
    else:
        for label, value in zip(labels, values):
            lines.append(f'    "{label}" : {value:.4f}')
    lines.append("```")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------

def aggregate(project: str, loom_root: Path) -> str:
    project_dir = loom_root / project
    rows = _read_jsonl(project_dir / "usage.jsonl")

    # Six fixed buckets first; unexpected phase keys append after them so an
    # attribution gap is visible rather than silently absorbed.
    per_bucket: dict[str, dict] = {b: _empty_bucket() for b in BUCKETS}
    ordered = list(BUCKETS)
    crashed: list[dict] = []

    for r in rows:
        if _is_crashed(r):
            crashed.append(r)
            continue
        key = _phase_key(r)
        if key not in per_bucket:
            per_bucket[key] = _empty_bucket()
            ordered.append(key)
        bucket = per_bucket[key]
        tok = r.get("tokens") or {}
        for k in TOKEN_KEYS:
            bucket["tokens"][k] += _int(tok.get(k))
        bucket["wall_ms"] += _int(r.get("duration_wall_ms"))
        bucket["autonomous_ms"] += _int(r.get("duration_autonomous_ms"))
        quality = r.get("quality")
        if isinstance(quality, dict):
            for key_q in ("error_results", "read_errors", "bash_failures"):
                bucket[key_q] += max(0, _int(quality.get(key_q)))
        cost = r.get("cost_usd")
        if isinstance(cost, (int, float)) and not isinstance(cost, bool):
            bucket["cost_usd"] += float(cost)

    # Cost and tokens are additive across buckets: each row's API calls are
    # distinct spend. Durations are NOT — the orchestrator's span encloses
    # every subagent span it dispatched, so summing them counts the run
    # twice. Wall is therefore the enclosing lifecycle span, and autonomous
    # generation time is summed over the phase agents only; the
    # orchestrator's own autonomous time stays visible in its detail row.
    run_tokens = _empty_tokens()
    run_autonomous = 0
    run_cost = 0.0
    for key in ordered:
        b = per_bucket[key]
        for k in TOKEN_KEYS:
            run_tokens[k] += b["tokens"][k]
        run_cost += b["cost_usd"]
        if key != "orchestrator":
            run_autonomous += b["autonomous_ms"]

    models = sorted({r["model"] for r in rows if isinstance(r.get("model"), str)})
    untagged = sum(1 for r in rows if r.get("status") == "untagged")
    has_orchestrator = any(r.get("agent_kind") == "orchestrator" for r in rows)
    if has_orchestrator:
        run_wall = per_bucket["orchestrator"]["wall_ms"]
    else:
        run_wall = sum(per_bucket[k]["wall_ms"] for k in ordered)

    costs = [per_bucket[k]["cost_usd"] for k in ordered]
    rates = [_cache_hit_rate(per_bucket[k]["tokens"]) for k in ordered]

    lines: list[str] = [f"# Metrics — {project}", ""]

    # ---- Run totals -------------------------------------------------------
    lines += ["## Run totals", ""]
    coverage = "5 phase agents + orchestrator" if has_orchestrator else "phase agents only"
    lines.append(_table(["Metric", "Value"], [
        ["Estimated cost (USD)", f"{run_cost:.4f}"],
        ["Wall ms (lifecycle span)", str(run_wall)],
        ["Autonomous ms (phase agents)", str(run_autonomous)],
        ["Input tokens", str(run_tokens["input_tokens"])],
        ["Output tokens", str(run_tokens["output_tokens"])],
        ["Cache creation tokens", str(run_tokens["cache_creation_input_tokens"])],
        ["Cache read tokens", str(run_tokens["cache_read_input_tokens"])],
        ["Cache hit rate", f"{_cache_hit_rate(run_tokens):.4f}"],
        ["Model(s)", ", ".join(models) if models else "—"],
        ["Measured rows", str(len(rows))],
        ["Untagged rows", str(untagged)],
        ["Coverage", coverage],
    ]))
    lines.append("")

    # ---- Charts -----------------------------------------------------------
    lines += ["## Cost by phase", "",
              _bar_chart("Estimated cost (USD) per phase", "USD", ordered, costs), ""]
    lines += ["## Cost share", "",
              _pie_chart("Share of estimated run cost", ordered, costs), ""]
    lines += ["## Cache efficiency", "",
              _bar_chart("Cache hit rate per phase", "rate", ordered, rates,
                         decimals=4), ""]

    # ---- Per-phase detail -------------------------------------------------
    lines += ["## Per-phase detail", ""]
    detail_rows = []
    for key in ordered:
        b = per_bucket[key]
        detail_rows.append([
            key,
            f"{b['cost_usd']:.4f}",
            str(b["wall_ms"]),
            str(b["autonomous_ms"]),
            str(b["tokens"]["input_tokens"]),
            str(b["tokens"]["output_tokens"]),
            str(b["tokens"]["cache_creation_input_tokens"]),
            str(b["tokens"]["cache_read_input_tokens"]),
            f"{_cache_hit_rate(b['tokens']):.4f}",
            str(b["error_results"]),
            str(b["read_errors"]),
            str(b["bash_failures"]),
        ])
    lines.append(_table(
        ["Phase", "Cost (USD)", "Wall ms", "Autonomous ms", "input", "output",
         "cache_create", "cache_read", "hit rate", "errors", "read-err",
         "bash-fail"],
        detail_rows))
    lines.append("")

    # ---- Outcome ----------------------------------------------------------
    lines += ["## Outcome", ""]
    outcome: dict | None = None
    outcome_path = project_dir / "outcome.json"
    if outcome_path.is_file():
        try:
            loaded = json.loads(outcome_path.read_text(encoding="utf-8"))
            outcome = loaded if isinstance(loaded, dict) else None
        except (OSError, json.JSONDecodeError):
            outcome = None
    verdict = outcome.get("review_verdict") if isinstance(outcome, dict) else None
    verdict = verdict if isinstance(verdict, dict) else {}
    tasks = outcome.get("tasks") if isinstance(outcome, dict) else None
    tasks = tasks if isinstance(tasks, dict) else {}

    def _o(key: str) -> str:
        value = outcome.get(key) if isinstance(outcome, dict) else None
        return "—" if value is None else str(value)

    lines.append(_table(["Field", "Value"], [
        ["Lifecycle state", _o("lifecycle_state")],
        ["Final phase", _o("final_phase")],
        ["Review verdict", str(verdict.get("status", "—"))],
        ["Blockers", str(verdict.get("blockers", "—"))],
        ["Major", str(verdict.get("major", "—"))],
        ["Minor", str(verdict.get("minor", "—"))],
        ["Note", str(verdict.get("note", "—"))],
        ["Tasks planned", str(tasks.get("planned", "—"))],
        ["Tasks done", str(tasks.get("done", "—"))],
    ]))
    lines.append("")

    # ---- Crashed invocations ---------------------------------------------
    lines += ["## Crashed invocations", ""]
    lines.append(_table(["Phase", "Agent", "Wall ms"], [
        [str(r.get("phase") or "—"),
         str(r.get("agent_label") or "—"),
         str(_int(r.get("duration_wall_ms")))]
        for r in crashed
    ]))
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
    ap = argparse.ArgumentParser(description="Render usage.jsonl → metrics.md")
    ap.add_argument("project", help="Loom project name (under .loom/<project>/)")
    ap.add_argument("--loom-root", default=os.environ.get("LOOM_ROOT", ".loom"))
    args = ap.parse_args(argv)

    loom_root = Path(args.loom_root)
    project_dir = loom_root / args.project
    project_dir.mkdir(parents=True, exist_ok=True)

    atomic_write_text(project_dir / "metrics.md", aggregate(args.project, loom_root))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
