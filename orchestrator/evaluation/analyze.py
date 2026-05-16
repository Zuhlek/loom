#!/usr/bin/env python3
"""analyze — cross-version analysis renderer.

Idempotent end-to-end:

  for each analytics/<version>/<run>/:
      if no usage.jsonl     → harvest from .eval-orchestrator-pointer
      if no usage.md        → aggregate
  pool rows by <version>, render analysis.html, done.

The "skip if already analyzed" check is simply "usage.jsonl exists" —
no sentinel files, no manifest.

Layout: parent directory name = version label. `analytics/baseline/X/`
is in `baseline`, `analytics/1/Y/` is in `1`, etc.

Run dirs without usage.jsonl AND without a usable pointer are reported
as missing on stderr and in the data block — never silently dropped.
Local Claude transcripts are ephemeral; analyse soon after each run or
the pointer becomes a dangling reference.

Adding a metric is a one-tuple edit to `METRICS` below. The render loop
is metric-agnostic.

Per design.md § Analysis renderer contract:
- `baseline` is always the first version (left-most data point).
- Other versions follow in version-name lexical order.
- Crashed rows (`tokens: null` or `status: "crashed"`) are excluded from
  means but counted in `run_count`.
- Single-baseline pool renders a single data point per chart, no errors.
- No prose narrative in the rendered HTML (graphs + headings only).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from statistics import fmean
from typing import Any


_SCRIPT_DIR = Path(__file__).resolve().parent
HARVESTER = _SCRIPT_DIR.parent / "lib" / "transcript-harvest.py"
AGGREGATOR = _SCRIPT_DIR.parent / "lib" / "eval-aggregate.py"
REPO_ROOT = _SCRIPT_DIR.parent.parent


# Metric registry. Adding a new metric is one tuple.
# Tuple: (name, dotted-path-into-row, rollup-fn-name).
METRICS = [
    ("autonomous_ms",  "duration_autonomous_ms",            "sum"),
    ("wall_ms",        "duration_wall_ms",                  "sum"),
    ("input_tokens",   "tokens.input_tokens",               "sum"),
    ("output_tokens",  "tokens.output_tokens",              "sum"),
    ("cache_creation", "tokens.cache_creation_input_tokens","sum"),
    ("cache_read",     "tokens.cache_read_input_tokens",    "sum"),
]


def _get_dotted(row: dict, path: str) -> Any:
    cur: Any = row
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _is_crashed(row: dict) -> bool:
    return row.get("status") == "crashed" or row.get("tokens") is None


def _per_run_metric_sum(rows: list[dict], dotted: str, phase: str) -> int | None:
    """Sum the metric over all OK rows in this run, filtered by phase.

    Returns None if there were no contributing OK rows for this phase
    (used to skip empty per-run data points cleanly).
    """
    total = 0
    seen = False
    for r in rows:
        if r.get("phase") != phase:
            continue
        if _is_crashed(r):
            continue
        v = _get_dotted(r, dotted)
        if isinstance(v, (int, float)):
            total += int(v)
            seen = True
    return total if seen else None


def _phases_present(rows: list[dict]) -> set[str]:
    out = set()
    for r in rows:
        p = r.get("phase")
        if isinstance(p, str):
            out.add(p)
    return out


def _read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def _version_order(versions: list[str]) -> list[str]:
    """baseline first, then lexical. Note: `1`, `10`, `2` sorts as `1, 10, 2`
    — zero-pad version names (`01`, `02`, `10`) if you ever cross 9."""
    if "baseline" in versions:
        rest = sorted(v for v in versions if v != "baseline")
        return ["baseline"] + rest
    return sorted(versions)


def _read_pointer(run_dir: Path) -> str | None:
    p = run_dir / ".eval-orchestrator-pointer"
    if not p.exists():
        return None
    try:
        text = p.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text or None


def _harvest(run_dir: Path, cwd: Path) -> bool:
    """Run transcript-harvest.py for this run. Returns True iff usage.jsonl
    exists afterwards. Surfaces stderr on failure; quiet on success."""
    session_id = _read_pointer(run_dir)
    if not session_id:
        print(f"[analyse] {run_dir.name}: no .eval-orchestrator-pointer, "
              f"cannot harvest", file=sys.stderr)
        return False
    cmd = [sys.executable, str(HARVESTER), run_dir.name,
           "--workspace", str(run_dir),
           "--session", session_id,
           "--cwd", str(cwd)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"[analyse] {run_dir.name}: harvester exit {proc.returncode}\n"
              f"{(proc.stderr or proc.stdout).strip()}", file=sys.stderr)
        return False
    if not (run_dir / "usage.jsonl").exists():
        note = (proc.stdout or "").strip()
        if note:
            print(f"[analyse] {run_dir.name}: no rows harvested\n{note}",
                  file=sys.stderr)
        return False
    return True


def _aggregate(run_dir: Path) -> None:
    """Run eval-aggregate.py to (re)build usage.md. eval-aggregate reads
    `<loom-root>/<project>/usage.jsonl`, so loom-root = version dir."""
    cmd = [sys.executable, str(AGGREGATOR), run_dir.name,
           "--loom-root", str(run_dir.parent)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"[analyse] {run_dir.name}: aggregator exit {proc.returncode}\n"
              f"{(proc.stderr or proc.stdout).strip()}", file=sys.stderr)


def collect(analytics_dir: Path, cwd: Path = REPO_ROOT) -> dict:
    """Walk analytics/<version>/<run>/, harvest+aggregate what's new, pool rows.

    Shape:
    {
      "versions": { "<version>": { "<phase>": { "<metric>": <mean>, ... } } },
      "run_counts": { "<version>": <int> },
      "missing":    [ "<run-id>", ... ],
      "phases":     [...],
      "metrics":    [...]
    }
    """
    versions_raw: dict[str, list[list[dict]]] = {}
    missing: list[str] = []
    all_phases: set[str] = set()

    if analytics_dir.is_dir():
        for version_dir in sorted(analytics_dir.iterdir()):
            if not version_dir.is_dir():
                continue
            version = version_dir.name
            for run_dir in sorted(version_dir.iterdir()):
                if not run_dir.is_dir():
                    continue
                if (run_dir / "PRE_CANONICAL").exists():
                    continue
                usage = run_dir / "usage.jsonl"
                if not usage.exists():
                    print(f"[analyse] {version}/{run_dir.name}: harvesting…",
                          file=sys.stderr)
                    if not _harvest(run_dir, cwd):
                        missing.append(run_dir.name)
                        continue
                if not (run_dir / "usage.md").exists():
                    _aggregate(run_dir)
                rows = _read_jsonl(usage)
                versions_raw.setdefault(version, []).append(rows)
                all_phases.update(_phases_present(rows))

    ordered_versions = _version_order(list(versions_raw.keys()))
    KNOWN_PHASE_ORDER = ("spec", "design", "plan", "build", "review")
    ordered_phases = [p for p in KNOWN_PHASE_ORDER if p in all_phases] + \
        sorted(p for p in all_phases if p not in KNOWN_PHASE_ORDER)

    out_versions: dict[str, dict] = {}
    run_counts: dict[str, int] = {}
    for v in ordered_versions:
        rows_per_run = versions_raw[v]
        run_counts[v] = len(rows_per_run)
        per_phase: dict[str, dict] = {}
        for phase in ordered_phases:
            metric_block: dict[str, float] = {}
            for name, dotted, _rollup in METRICS:
                per_run_values: list[int] = []
                for run_rows in rows_per_run:
                    s = _per_run_metric_sum(run_rows, dotted, phase)
                    if s is not None:
                        per_run_values.append(s)
                metric_block[name] = float(fmean(per_run_values)) if per_run_values else 0.0
                if metric_block[name] == int(metric_block[name]):
                    metric_block[name] = int(metric_block[name])
            per_phase[phase] = metric_block
        out_versions[v] = per_phase

    return {
        "versions": out_versions,
        "version_order": ordered_versions,
        "run_counts": run_counts,
        "missing": missing,
        "phases": ordered_phases,
        "metrics": [name for name, _, _ in METRICS],
    }


# --------------------------------------------------------------------------
# Display registry. Maps raw metric field names to human-facing labels, the
# visual group they belong to, a stable color (used consistently across the
# whole page), and a one-line description shown in the glossary panel.
# Order within each group is the order metrics appear in tables / chart rows.
# --------------------------------------------------------------------------

METRICS_DISPLAY: dict[str, dict[str, str]] = {
    "autonomous_ms":  {
        "label": "Inference time",
        "group": "Time",
        "color": "#dc2626",
        "desc":  "Time the model spent generating, summed across assistant turns. The Anthropic-side bill driver.",
    },
    "wall_ms": {
        "label": "Elapsed time",
        "group": "Time",
        "color": "#f59e0b",
        "desc":  "Wall-clock from dispatch to return. Includes inference, tool execution, file I/O, and harness overhead.",
    },
    "input_tokens": {
        "label": "Input tokens",
        "group": "Tokens",
        "color": "#10b981",
        "desc":  "Fresh prompt bytes (not a cache hit). Billed at the full input rate.",
    },
    "output_tokens": {
        "label": "Output tokens",
        "group": "Tokens",
        "color": "#3b82f6",
        "desc":  "Bytes the model generated. Billed at the full output rate.",
    },
    "cache_creation": {
        "label": "Cache writes",
        "group": "Tokens",
        "color": "#8b5cf6",
        "desc":  "Prompt prefix bytes stored for later reuse. Billed at ~1.25× input rate (one-time cost).",
    },
    "cache_read": {
        "label": "Cache hits",
        "group": "Tokens",
        "color": "#06b6d4",
        "desc":  "Bytes read from the prefix cache. Billed at ~0.1× input rate; dominates input cost on long-context multi-turn runs.",
    },
}

GROUP_ORDER = ("Time", "Tokens")
PHASE_DISPLAY: dict[str, str] = {
    "spec":   "Spec",
    "design": "Design",
    "plan":   "Plan",
    "build":  "Build",
    "review": "Review",
}


def _metric_kind(name: str) -> str:
    return "duration" if name.endswith("_ms") else "tokens"


def _metric_meta(name: str) -> dict[str, str]:
    """Return the display dict for a metric, with safe fallbacks for unknown names."""
    fallback = {
        "label": name,
        "group": "Tokens" if _metric_kind(name) == "tokens" else "Time",
        "color": "#6b7280",
        "desc":  "(no description)",
    }
    return METRICS_DISPLAY.get(name, fallback)


def _metrics_in_group(group: str, metric_names: list[str]) -> list[str]:
    return [n for n in metric_names if _metric_meta(n)["group"] == group]


def _fmt_duration_ms(ms: float) -> str:
    if ms is None:
        return "—"
    ms = float(ms)
    if ms < 1000:
        return f"{int(ms)}ms"
    s = ms / 1000.0
    if s < 60:
        return f"{s:.1f}s"
    m = int(s // 60)
    rs = int(s - m * 60)
    return f"{m}m {rs:02d}s"


def _fmt_tokens(n: float) -> str:
    if n is None:
        return "—"
    return f"{int(n):,}"


def _fmt_value(name: str, val: float) -> str:
    return _fmt_duration_ms(val) if _metric_kind(name) == "duration" else _fmt_tokens(val)


def _html(s: str) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _value_for(data: dict, version: str, phase_or_total: str, metric: str,
               all_phases: list[str]) -> float:
    if phase_or_total == "total":
        return sum((data["versions"].get(version, {}).get(p, {}) or {}).get(metric, 0) or 0
                   for p in all_phases)
    return (data["versions"].get(version, {}).get(phase_or_total, {}) or {}).get(metric, 0)


def _phase_summary_chip(data: dict, phase_or_total: str, versions: list[str],
                       all_phases: list[str]) -> str:
    """Single-version: show the absolute number. Multi-version: show last / mean."""
    chips = []
    for metric in ("autonomous_ms", "wall_ms"):
        meta = _metric_meta(metric)
        if not versions:
            chips.append(f"<span class=\"chip\"><b>{_html(meta['label'])}:</b> —</span>")
            continue
        latest_v = versions[-1]
        val = _value_for(data, latest_v, phase_or_total, metric, all_phases)
        chips.append(
            f"<span class=\"chip\" style=\"--chip-c:{meta['color']}\">"
            f"<b>{_html(meta['label'])}:</b> {_html(_fmt_value(metric, val))}"
            f"</span>"
        )
    return " ".join(chips)


def _grouped_table(versions: list[str], metric_names: list[str], values_at: callable) -> str:
    """Render one table with column headers grouped by metric group.
    `values_at(version, metric)` returns the raw number."""
    grouped_metrics: list[tuple[str, list[str]]] = []
    for g in GROUP_ORDER:
        gm = _metrics_in_group(g, metric_names)
        if gm:
            grouped_metrics.append((g, gm))

    # Two-row header: group spans + metric names underneath.
    group_row = "".join(
        f"<th class=\"group-h\" colspan=\"{len(gm)}\">{_html(g)}</th>"
        for g, gm in grouped_metrics
    )
    metric_row = "".join(
        f"<th class=\"num\" title=\"{_html(_metric_meta(m)['desc'])}\">"
        f"<span class=\"sw\" style=\"background:{_metric_meta(m)['color']}\"></span>"
        f"{_html(_metric_meta(m)['label'])}"
        f"</th>"
        for _, gm in grouped_metrics for m in gm
    )
    flat_metrics = [m for _, gm in grouped_metrics for m in gm]

    body_rows = []
    for v in versions:
        cells = "".join(
            f"<td class=\"num\">{_html(_fmt_value(m, values_at(v, m)))}</td>"
            for m in flat_metrics
        )
        body_rows.append(f"<tr><th class=\"v\">{_html(v)}</th>{cells}</tr>")

    return (
        f"<table class=\"phase-table\">"
        f"<thead>"
        f"<tr><th rowspan=\"2\" class=\"v-h\">Version</th>{group_row}</tr>"
        f"<tr>{metric_row}</tr>"
        f"</thead>"
        f"<tbody>{''.join(body_rows)}</tbody>"
        f"</table>"
    )


def _phase_section(phase: str, anchor: str, versions: list[str],
                   metric_names: list[str], data: dict,
                   all_phases: list[str], total: bool = False) -> str:
    """Render one phase block: heading + summary chips + grouped chart strips + table."""
    label = "Total (all phases)" if total else PHASE_DISPLAY.get(phase, phase.title())
    summary_chips = _phase_summary_chip(data, anchor if not total else "total",
                                        versions, all_phases)

    # Two chart strips, one per metric group.
    chart_strips = []
    for g in GROUP_ORDER:
        gm = _metrics_in_group(g, metric_names)
        if not gm:
            continue
        canvases = "".join(
            f"<figure class=\"chart\">"
            f"<canvas data-phase=\"{anchor}\" data-metric=\"{name}\"></canvas>"
            f"</figure>"
            for name in gm
        )
        chart_strips.append(
            f"<div class=\"chart-strip\" data-group=\"{_html(g)}\">"
            f"<div class=\"strip-label\">{_html(g)}</div>"
            f"<div class=\"strip-charts\">{canvases}</div>"
            f"</div>"
        )

    def values_at(v: str, m: str) -> float:
        return _value_for(data, v, anchor if not total else "total", m, all_phases)

    table = _grouped_table(versions, metric_names, values_at)

    return (
        f"<section id=\"phase-{anchor}\" class=\"phase-block\">"
        f"<header class=\"phase-head\">"
        f"<h2>{_html(label)}</h2>"
        f"<div class=\"phase-chips\">{summary_chips}</div>"
        f"</header>"
        f"{''.join(chart_strips)}"
        f"{table}"
        f"</section>"
    )


def render_html(data: dict) -> str:
    """Render a self-contained HTML page using the vendored Chart.js.

    Layout (phase-first, with display names + glossary):
      - Header banner with run counts + total inference/elapsed-time chips
      - Glossary panel grouped by Time / Tokens
      - One block per phase + a Total block (each with chart strips + a grouped table)
      - One summary section: wide phase × version table

    Inline JSON in `<script id="loom-data">` remains the data source of truth.
    """
    data_json = json.dumps(data, separators=(",", ":"))
    phases = data.get("phases", [])
    versions = list(data.get("versions", {}).keys())
    counts = data.get("run_counts", {})
    metric_names = [name for name, _, _ in METRICS]

    # ----- Top-of-page hero -----
    if counts:
        counts_text = ", ".join(f"<b>{_html(k)}</b>: {v} run{'s' if v != 1 else ''}"
                                for k, v in counts.items())
    else:
        counts_text = "<i>no runs filed yet</i>"
    total_chips = _phase_summary_chip(data, "total", versions, phases)

    # ----- Glossary -----
    glossary_groups = []
    for g in GROUP_ORDER:
        gm = _metrics_in_group(g, metric_names)
        if not gm:
            continue
        items = "".join(
            f"<dt><span class=\"sw\" style=\"background:{_metric_meta(m)['color']}\"></span>"
            f"{_html(_metric_meta(m)['label'])}</dt>"
            f"<dd>{_html(_metric_meta(m)['desc'])}</dd>"
            for m in gm
        )
        glossary_groups.append(
            f"<div class=\"glossary-group\">"
            f"<h3>{_html(g)}</h3>"
            f"<dl>{items}</dl>"
            f"</div>"
        )
    glossary = (
        f"<section id=\"glossary\" class=\"glossary\">"
        f"<h2>What these metrics mean</h2>"
        f"<div class=\"glossary-grid\">{''.join(glossary_groups)}</div>"
        f"</section>"
    )

    # ----- Per-phase sections -----
    sections = [
        _phase_section(ph, ph, versions, metric_names, data, phases)
        for ph in phases
    ]
    sections.append(
        _phase_section("total", "total", versions, metric_names, data, phases, total=True)
    )

    # ----- Summary table -----
    def value_for_summary(ph: str, v: str, m: str) -> float:
        return _value_for(data, v, ph if ph != "total" else "total", m, phases)

    # Two-row header with group spans.
    grouped_metrics = [(g, _metrics_in_group(g, metric_names)) for g in GROUP_ORDER]
    grouped_metrics = [(g, gm) for g, gm in grouped_metrics if gm]
    sum_group_row = "".join(
        f"<th class=\"group-h\" colspan=\"{len(gm)}\">{_html(g)}</th>"
        for g, gm in grouped_metrics
    )
    sum_metric_row = "".join(
        f"<th class=\"num\" title=\"{_html(_metric_meta(m)['desc'])}\">"
        f"<span class=\"sw\" style=\"background:{_metric_meta(m)['color']}\"></span>"
        f"{_html(_metric_meta(m)['label'])}"
        f"</th>"
        for _, gm in grouped_metrics for m in gm
    )
    flat_metrics = [m for _, gm in grouped_metrics for m in gm]

    sum_rows = []
    for ph in phases + ["total"]:
        for i, v in enumerate(versions):
            cells = "".join(
                f"<td class=\"num\">{_html(_fmt_value(m, value_for_summary(ph, v, m)))}</td>"
                for m in flat_metrics
            )
            phase_label = "Total" if ph == "total" else PHASE_DISPLAY.get(ph, ph.title())
            phase_cell = (f"<th class=\"phase-cell\" rowspan=\"{len(versions)}\">{_html(phase_label)}</th>"
                          if i == 0 else "")
            sum_rows.append(f"<tr class=\"phase-{ph}{' total-row' if ph=='total' else ''}\">"
                           f"{phase_cell}<th class=\"v\">{_html(v)}</th>{cells}</tr>")

    summary_table = (
        f"<section id=\"summary\" class=\"summary\">"
        f"<h2>Summary — every phase × version</h2>"
        f"<table class=\"summary-table\">"
        f"<thead>"
        f"<tr><th rowspan=\"2\" class=\"phase-h\">Phase</th>"
        f"<th rowspan=\"2\" class=\"v-h\">Version</th>"
        f"{sum_group_row}</tr>"
        f"<tr>{sum_metric_row}</tr>"
        f"</thead>"
        f"<tbody>{''.join(sum_rows)}</tbody></table>"
        f"</section>"
    )

    # ----- Nav -----
    nav_items = " · ".join(
        [f"<a href=\"#glossary\">Glossary</a>"]
        + [f"<a href=\"#phase-{ph}\">{_html(PHASE_DISPLAY.get(ph, ph.title()))}</a>" for ph in phases]
        + ["<a href=\"#phase-total\">Total</a>", "<a href=\"#summary\">Summary</a>"]
    )

    # Push the display registry into the page so the chart JS can use it.
    metrics_display_json = json.dumps({
        m: _metric_meta(m) for m in metric_names
    }, separators=(",", ":"))

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Loom — Cross-version analysis</title>
<!-- Chart.js loaded synchronously: the inline render script below runs at body
     parse time and needs the Chart global already defined. -->
<script src="chartjs/chart.min.js"></script>
<style>
:root {{
  --fg: #0f172a; --muted: #64748b; --border: #e2e8f0; --bg: #f8fafc; --card: #ffffff;
  --accent: #2563eb; --hairline: #cbd5e1; --total-bg: #f1f5f9;
}}
* {{ box-sizing: border-box; }}
body {{ font-family: -apple-system, "Segoe UI", system-ui, sans-serif; margin: 0; padding: 24px;
       background: var(--bg); color: var(--fg);
       max-width: 1280px; margin-left: auto; margin-right: auto; }}
header.hero {{ margin-bottom: 24px; }}
h1 {{ font-size: 1.5rem; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }}
.subtitle {{ font-size: 0.9rem; color: var(--muted); margin-bottom: 12px; }}
.subtitle b {{ color: var(--fg); font-weight: 600; }}
.hero-chips {{ display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }}
.chip {{ display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
         font-size: 0.85rem; border: 1px solid var(--border); border-radius: 999px;
         background: var(--card); white-space: nowrap; }}
.chip b {{ color: var(--muted); font-weight: 500; }}
.chip::before {{ content: ""; width: 8px; height: 8px; border-radius: 50%;
                 background: var(--chip-c, var(--accent)); display: inline-block; }}
nav.toc {{ font-size: 0.85rem; margin-bottom: 24px; padding: 10px 12px;
           background: var(--card); border: 1px solid var(--border); border-radius: 6px; }}
nav.toc a {{ color: var(--accent); text-decoration: none; padding: 0 4px; }}
nav.toc a:hover {{ text-decoration: underline; }}
h2 {{ font-size: 1.05rem; font-weight: 600; margin: 0; letter-spacing: -0.005em; }}
section {{ background: var(--card); border: 1px solid var(--border); border-radius: 8px;
           padding: 16px 18px; margin-bottom: 16px; }}
.phase-head {{ display: flex; align-items: center; justify-content: space-between;
               gap: 12px; flex-wrap: wrap; margin-bottom: 12px;
               padding-bottom: 10px; border-bottom: 1px solid var(--border); }}
.phase-chips {{ display: flex; gap: 6px; flex-wrap: wrap; }}
.chart-strip {{ display: flex; gap: 12px; align-items: stretch; margin-bottom: 10px; }}
.chart-strip:last-of-type {{ margin-bottom: 16px; }}
.strip-label {{ font-size: 0.7rem; font-weight: 600; color: var(--muted);
                text-transform: uppercase; letter-spacing: 0.06em;
                writing-mode: vertical-rl; transform: rotate(180deg);
                padding: 6px 0; min-width: 18px; text-align: center; flex-shrink: 0; }}
.strip-charts {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                 gap: 8px; flex: 1; }}
figure.chart {{ background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
                padding: 6px; margin: 0; }}
figure.chart canvas {{ width: 100% !important; height: 130px !important; }}
table {{ width: 100%; border-collapse: collapse; font-size: 0.82rem;
         font-variant-numeric: tabular-nums; }}
th, td {{ padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--border); }}
thead th {{ font-weight: 600; font-size: 0.75rem; color: var(--muted);
            background: var(--bg); border-bottom: 1px solid var(--hairline); }}
.group-h {{ text-align: center; text-transform: uppercase; letter-spacing: 0.06em;
            border-bottom: 1px solid var(--hairline); }}
th.num, td.num {{ text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
th.num .sw, .glossary .sw, .phase-table .sw {{ display: inline-block; width: 8px; height: 8px;
            border-radius: 2px; vertical-align: middle; margin-right: 6px; }}
th.v, th.v-h {{ font-weight: 600; color: var(--fg); white-space: nowrap; }}
th.phase-h, th.phase-cell {{ font-weight: 600; color: var(--fg); white-space: nowrap;
                              vertical-align: top; border-right: 1px solid var(--hairline); }}
tbody th {{ font-weight: 500; }}
tr.total-row td, tr.total-row th {{ background: var(--total-bg); font-weight: 600; }}
.summary-table tbody tr:hover td {{ background: var(--bg); }}
.glossary-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
                  gap: 16px; }}
.glossary-group h3 {{ font-size: 0.8rem; font-weight: 600; margin: 0 0 6px;
                      text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }}
.glossary-group dl {{ margin: 0; }}
.glossary-group dt {{ font-weight: 500; margin: 8px 0 2px; font-size: 0.88rem; }}
.glossary-group dt:first-child {{ margin-top: 0; }}
.glossary-group dd {{ margin: 0 0 0 14px; font-size: 0.82rem; color: var(--muted); line-height: 1.4; }}
</style>
</head>
<body>
<header class="hero">
  <h1>Loom — cross-version cost analysis</h1>
  <div class="subtitle">Run counts: {counts_text}</div>
  <div class="hero-chips" id="loom-total-chips">{total_chips}</div>
</header>
<nav class="toc">{nav_items}</nav>
<script id="loom-data" type="application/json">{data_json}</script>
<script id="loom-display" type="application/json">{metrics_display_json}</script>
{glossary}
{''.join(sections)}
{summary_table}
<script>
(function() {{
  var data = JSON.parse(document.getElementById('loom-data').textContent);
  var meta = JSON.parse(document.getElementById('loom-display').textContent);
  var versionList = (data.version_order && data.version_order.length)
    ? data.version_order
    : Object.keys(data.versions);
  var phases = data.phases || [];

  function valuesFor(phase, metric) {{
    return versionList.map(function(v) {{
      if (phase === 'total') {{
        var sum = 0;
        phases.forEach(function(p) {{
          sum += ((data.versions[v] || {{}})[p] || {{}})[metric] || 0;
        }});
        return sum;
      }}
      return ((data.versions[v] || {{}})[phase] || {{}})[metric] || 0;
    }});
  }}
  function isDuration(metric) {{ return metric.endsWith('_ms'); }}
  function fmtDuration(ms) {{
    if (ms == null) return '—';
    if (ms < 1000) return Math.round(ms) + 'ms';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    var m = Math.floor(s / 60), rs = Math.round(s - m * 60);
    return m + 'm ' + (rs < 10 ? '0' + rs : rs) + 's';
  }}
  function fmtTokens(n) {{
    if (n == null) return '—';
    return Math.round(n).toLocaleString();
  }}
  function fmtAxis(metric) {{
    return function(v) {{
      var n = Number(v);
      if (!isFinite(n)) return v;
      if (isDuration(metric)) {{
        if (n < 1000) return n + 'ms';
        if (n < 60000) return (n / 1000).toFixed(0) + 's';
        return Math.round(n / 60000) + 'm';
      }}
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n;
    }};
  }}
  function fmtValue(metric, v) {{
    return isDuration(metric) ? fmtDuration(v) : fmtTokens(v);
  }}
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = '-apple-system, "Segoe UI", system-ui, sans-serif';
  Chart.defaults.color = '#475569';

  document.querySelectorAll('canvas[data-phase]').forEach(function(canvas) {{
    var phase = canvas.getAttribute('data-phase');
    var metric = canvas.getAttribute('data-metric');
    var info = meta[metric] || {{ label: metric, color: '#2563eb', desc: '' }};
    var color = info.color;
    var rgba = function(hex, a) {{
      var h = hex.replace('#', '');
      var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }};
    new Chart(canvas.getContext('2d'), {{
      type: 'line',
      data: {{
        labels: versionList,
        datasets: [{{
          label: info.label,
          data: valuesFor(phase, metric),
          borderColor: color,
          backgroundColor: rgba(color, 0.12),
          tension: 0.15,
          pointRadius: 3.5,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
          borderWidth: 2,
          fill: true
        }}]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        layout: {{ padding: {{ top: 4, right: 8, bottom: 0, left: 4 }} }},
        plugins: {{
          title: {{
            display: true,
            text: info.label,
            align: 'start',
            font: {{ size: 11, weight: '600' }},
            color: '#334155',
            padding: {{ bottom: 4 }}
          }},
          legend: {{ display: false }},
          tooltip: {{
            callbacks: {{
              title: function(items) {{ return 'Version: ' + items[0].label; }},
              label: function(ctx) {{ return info.label + ': ' + fmtValue(metric, ctx.parsed.y); }},
              afterLabel: function() {{ return info.desc || ''; }}
            }},
            displayColors: false,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            padding: 8,
            titleFont: {{ size: 11 }},
            bodyFont: {{ size: 11 }}
          }}
        }},
        scales: {{
          y: {{
            beginAtZero: true,
            ticks: {{ callback: fmtAxis(metric), font: {{ size: 9 }}, color: '#64748b', maxTicksLimit: 4 }},
            grid: {{ color: '#f1f5f9' }}
          }},
          x: {{
            ticks: {{ font: {{ size: 10 }}, color: '#475569' }},
            grid: {{ display: false }}
          }}
        }}
      }}
    }});
  }});
}})();
</script>
</body>
</html>
"""


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


# Layout: `analytics/<version>/<run-id>/` holds the moved-in `.loom/`
# fabric. The folder structure is the mapping: parent dir name = version.
DEFAULT_ANALYTICS = _SCRIPT_DIR / "analytics"
DEFAULT_OUT = _SCRIPT_DIR / "analysis.html"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Harvest pending runs and render the analysis dashboard."
    )
    ap.add_argument("--analytics", default=str(DEFAULT_ANALYTICS),
                    help="root holding analytics/<version>/<run-id>/ "
                         "(default: orchestrator/evaluation/analytics/)")
    ap.add_argument("--out", default=None,
                    help="output HTML path (default: orchestrator/evaluation/analysis.html)")
    ap.add_argument("--cwd", default=str(REPO_ROOT),
                    help="repo root passed to the harvester for session lookup")
    args = ap.parse_args(argv)

    out = Path(args.out) if args.out else DEFAULT_OUT
    analytics_dir = Path(args.analytics)
    analytics_dir.mkdir(parents=True, exist_ok=True)
    data = collect(analytics_dir, Path(args.cwd))
    if data.get("missing"):
        msg = ", ".join(data["missing"])
        print(f"[analyse] warning: no usage rows for run(s): {msg}",
              file=sys.stderr)
    html = render_html(data)
    atomic_write_text(out, html)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
