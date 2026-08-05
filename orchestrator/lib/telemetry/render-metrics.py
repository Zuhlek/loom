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
  four token buckets, cache hit rate, the three quality counters, and the
  unpriced-row count.

`unpriced` is what keeps the cost columns honest. A row whose model has no
pricing entry carries `cost_usd: null`, which contributes 0.0000 to the sum —
indistinguishable from a row that genuinely cost nothing. Counting those rows
turns a silently-wrong "this run was free" into a visible "this many rows
could not be priced", so cost reads as a lower bound rather than a fact.
- Tables and charts only. No sentences, so two runs differ in their numbers
  and nothing else.
- Every data table ends in a `**Total**` row. Cost, tokens and the quality
  counters are column sums; the two duration columns are not, because the
  orchestrator span encloses the subagent spans it dispatched — the totals
  row carries the same lifecycle-span / phase-agent-autonomous pair as
  `## Run totals`, so the two sections can never disagree.

Numbers are formatted for a reader, not for a parser: `$162.28` over
`162.2791`, `43h 11m` over `155518702`, `97.1%` over `0.9710`, thousands
separators on token counts. Exact ms and fractional cents live in
`usage.jsonl`, which is the machine-readable copy.

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
        "unpriced": 0,
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

def _usd(value: float) -> str:
    return f"${value:,.2f}"


def _num(value: int) -> str:
    return f"{value:,}"


def _pct(rate: float) -> str:
    return f"{rate * 100:.1f}%"


def _share(value: float, total: float) -> str:
    return _pct(value / total) if total > 0 else "0.0%"


def _dur(ms: int) -> str:
    """Human-scaled duration. A run's wall time is eight digits of raw ms —
    unreadable, and a column of them hides the one row that matters."""
    seconds = max(0, int(ms)) / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, seconds = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes:02d}m" if hours else f"{minutes}m {seconds:02d}s"


def _table(headers: list[str], rows: list[list[str]], align: str = "") -> str:
    """Header and separator always render, even with zero data rows — an
    empty table is valid markdown and keeps the section shape constant.

    `align` is one character per column, `r` for right, anything else left.
    Numeric columns right-align so magnitudes stack and a 10× difference is
    visible without reading the digits."""
    align = align.ljust(len(headers), "l")
    out = ["| " + " | ".join(headers) + " |",
           "| " + " | ".join("---:" if a == "r" else "---"
                             for a in align[:len(headers)]) + " |"]
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
        else:
            # `cost_usd: null` means the row's model has no pricing entry —
            # NOT that it was free. Counting it here keeps the money columns
            # numeric (the fixed-shape contract) while making the gap visible;
            # without this an unpriced run renders a confident 0.0000 and the
            # file silently reports the run as costless.
            bucket["unpriced"] += 1

    # Cost and tokens are additive across buckets: each row's API calls are
    # distinct spend. Durations are NOT — the orchestrator's span encloses
    # every subagent span it dispatched, so summing them counts the run
    # twice. Wall is therefore the enclosing lifecycle span, and autonomous
    # generation time is summed over the phase agents only; the
    # orchestrator's own autonomous time stays visible in its detail row.
    run_tokens = _empty_tokens()
    run_autonomous = 0
    run_cost = 0.0
    run_unpriced = 0
    for key in ordered:
        b = per_bucket[key]
        for k in TOKEN_KEYS:
            run_tokens[k] += b["tokens"][k]
        run_cost += b["cost_usd"]
        run_unpriced += b["unpriced"]
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
    lines.append(_table(
        ["Cost (est.)", "Wall", "Autonomous", "Cache hit", "Input", "Output",
         "Cache write", "Cache read"],
        [[_usd(run_cost), _dur(run_wall), _dur(run_autonomous),
          _pct(_cache_hit_rate(run_tokens)),
          _num(run_tokens["input_tokens"]), _num(run_tokens["output_tokens"]),
          _num(run_tokens["cache_creation_input_tokens"]),
          _num(run_tokens["cache_read_input_tokens"])]],
        align="rrrrrrrr"))
    lines.append("")
    lines.append(_table(
        ["Model(s)", "Coverage", "Measured rows", "Untagged rows", "Unpriced rows"],
        [[", ".join(models) if models else "—", coverage,
          _num(len(rows)), _num(untagged), _num(run_unpriced)]],
        align="llrrr"))
    lines.append("")

    # ---- Charts -----------------------------------------------------------
    lines += ["## Cost by phase", "",
              _bar_chart("Estimated cost (USD) per phase", "USD", ordered, costs,
                         decimals=2), ""]
    lines += ["## Cost share", "",
              _pie_chart("Share of estimated run cost", ordered, costs), ""]
    lines += ["## Cache efficiency", "",
              _bar_chart("Cache hit rate per phase", "%", ordered,
                         [r * 100 for r in rates], decimals=1), ""]

    # ---- Per-phase detail -------------------------------------------------
    # Split in two: thirteen columns in one table wraps into an unreadable
    # smear in every renderer that has to fit a terminal or a sidebar.
    lines += ["## Per-phase detail", "", "### Cost & time", ""]
    lines.append(_table(
        ["Phase", "Cost", "Share", "Wall", "Autonomous"],
        [[key,
          _usd(per_bucket[key]["cost_usd"]),
          _share(per_bucket[key]["cost_usd"], run_cost),
          _dur(per_bucket[key]["wall_ms"]),
          _dur(per_bucket[key]["autonomous_ms"])] for key in ordered]
        # Durations are not column sums — see the module docstring; these are
        # the lifecycle span and the phase-agent autonomous total.
        + [["**Total**", _usd(run_cost), _share(run_cost, run_cost),
            _dur(run_wall), _dur(run_autonomous)]],
        align="lrrrr"))
    lines += ["", "### Tokens & quality", ""]
    lines.append(_table(
        ["Phase", "Input", "Output", "Cache write", "Cache read", "Hit rate",
         "Errors", "Read fails", "Bash fails", "Unpriced"],
        [[key,
          _num(per_bucket[key]["tokens"]["input_tokens"]),
          _num(per_bucket[key]["tokens"]["output_tokens"]),
          _num(per_bucket[key]["tokens"]["cache_creation_input_tokens"]),
          _num(per_bucket[key]["tokens"]["cache_read_input_tokens"]),
          _pct(_cache_hit_rate(per_bucket[key]["tokens"])),
          _num(per_bucket[key]["error_results"]),
          _num(per_bucket[key]["read_errors"]),
          _num(per_bucket[key]["bash_failures"]),
          _num(per_bucket[key]["unpriced"])] for key in ordered]
        + [["**Total**",
            _num(run_tokens["input_tokens"]),
            _num(run_tokens["output_tokens"]),
            _num(run_tokens["cache_creation_input_tokens"]),
            _num(run_tokens["cache_read_input_tokens"]),
            _pct(_cache_hit_rate(run_tokens)),
            _num(sum(per_bucket[k]["error_results"] for k in ordered)),
            _num(sum(per_bucket[k]["read_errors"] for k in ordered)),
            _num(sum(per_bucket[k]["bash_failures"] for k in ordered)),
            _num(run_unpriced)]],
        align="lrrrrrrrrr"))
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

    lines.append(_table(
        ["Lifecycle state", "Final phase", "Verdict", "Tasks done"],
        [[_o("lifecycle_state"), _o("final_phase"),
          str(verdict.get("status", "—")),
          f"{tasks.get('done', '—')} / {tasks.get('planned', '—')}"]],
        align="lllr"))
    lines.append("")
    lines.append(_table(
        ["Blockers", "Major", "Minor", "Note"],
        [[str(verdict.get("blockers", "—")), str(verdict.get("major", "—")),
          str(verdict.get("minor", "—")), str(verdict.get("note", "—"))]],
        align="rrrr"))
    lines.append("")

    # ---- Crashed invocations ---------------------------------------------
    lines += ["## Crashed invocations", ""]
    lines.append(_table(
        ["Phase", "Agent", "Wall"],
        [[str(r.get("phase") or "—"),
          str(r.get("agent_label") or "—"),
          _dur(_int(r.get("duration_wall_ms")))] for r in crashed]
        + [["**Total**", _num(len(crashed)),
            _dur(sum(_int(r.get("duration_wall_ms")) for r in crashed))]],
        align="llr"))
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
