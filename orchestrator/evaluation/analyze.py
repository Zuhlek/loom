#!/usr/bin/env python3
"""analyze — cross-version analysis renderer.

Reads every `usage.jsonl` under `<root>/<version>/<run>/usage.jsonl`,
computes per-version per-phase per-metric means (pooling all rows in a
version folder), writes `<out>` as a single static HTML referencing the
vendored Chart.js at `chartjs/chart.min.js`.

Adding a metric is a one-tuple edit to `METRICS` below. The render loop
is metric-agnostic.

Per design.md § Analysis renderer contract:
- `baseline` is always the first version (left-most data point).
- Other versions follow in directory-name lexical order.
- Crashed rows (`tokens: null` or `status: "crashed"`) are excluded from
  means but counted in `run_count`.
- Single-baseline tree renders a single data point per chart, no errors.
- No prose narrative in the rendered HTML (graphs + headings only).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from statistics import fmean
from typing import Any


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
    """baseline first, then lexical."""
    if "baseline" in versions:
        rest = sorted(v for v in versions if v != "baseline")
        return ["baseline"] + rest
    return sorted(versions)


def collect(root: Path) -> dict:
    """Walk the tree and compute the analyse-ready data block.

    Shape:
    {
      "versions": {
        "<version>": {
          "<phase>": {
            "<metric>": <mean across runs in this folder>,
            ...
          }
        }
      },
      "run_counts": { "<version>": <int> },
      "phases": [...],            # in stable known order
      "metrics": [...metric names...]
    }
    """
    versions_raw: dict[str, list[list[dict]]] = {}  # version → list of run row-lists
    all_phases: set[str] = set()

    if root.is_dir():
        for vdir in sorted(root.iterdir()):
            if not vdir.is_dir():
                continue
            runs_collected: list[list[dict]] = []
            for rdir in sorted(vdir.iterdir()):
                if not rdir.is_dir():
                    continue
                usage = rdir / "usage.jsonl"
                if not usage.exists():
                    continue
                rows = _read_jsonl(usage)
                runs_collected.append(rows)
                all_phases.update(_phases_present(rows))
            if runs_collected:
                versions_raw[vdir.name] = runs_collected

    ordered_versions = _version_order(list(versions_raw.keys()))
    KNOWN_PHASE_ORDER = ("spec", "design", "plan", "build", "review")
    ordered_phases = [p for p in KNOWN_PHASE_ORDER if p in all_phases] + \
        sorted(p for p in all_phases if p not in KNOWN_PHASE_ORDER)

    out_versions: dict[str, dict] = {}
    run_counts: dict[str, int] = {}
    for v in ordered_versions:
        runs = versions_raw[v]
        run_counts[v] = len(runs)
        per_phase: dict[str, dict] = {}
        for phase in ordered_phases:
            metric_block: dict[str, float] = {}
            for name, dotted, _rollup in METRICS:
                per_run_values: list[int] = []
                for run_rows in runs:
                    s = _per_run_metric_sum(run_rows, dotted, phase)
                    if s is not None:
                        per_run_values.append(s)
                metric_block[name] = float(fmean(per_run_values)) if per_run_values else 0.0
                # Coerce int-valued means back to int for clean rendering.
                if metric_block[name] == int(metric_block[name]):
                    metric_block[name] = int(metric_block[name])
            per_phase[phase] = metric_block
        out_versions[v] = per_phase

    return {
        "versions": out_versions,
        "run_counts": run_counts,
        "phases": ordered_phases,
        "metrics": [name for name, _, _ in METRICS],
    }


def render_html(data: dict) -> str:
    """Render a self-contained HTML page using the vendored Chart.js.

    Layout: a grid of <canvas> elements, one per metric × phase pair, plus
    a totals row. Inline JSON in `<script id="loom-data">` carries the
    per-version data; a small inline JS block instantiates the charts on
    page load.
    """
    data_json = json.dumps(data, separators=(",", ":"))
    # The canvas grid is generated client-side so adding a metric or phase
    # automatically grows the layout. No prose, no <p>.
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Loom — Cross-version analysis</title>
<script src="chartjs/chart.min.js" defer></script>
<style>
body {{ font-family: -apple-system, system-ui, sans-serif; margin: 16px; background: #fafafa; }}
h1 {{ font-size: 1.2rem; margin: 0 0 12px; }}
h2 {{ font-size: 0.95rem; margin: 16px 0 4px; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; }}
.cell {{ background: white; border: 1px solid #ddd; border-radius: 4px; padding: 8px; }}
.cell canvas {{ width: 100% !important; height: 220px !important; }}
.counts {{ font-size: 0.8rem; color: #555; margin-bottom: 8px; }}
</style>
</head>
<body>
<h1>Loom — cross-version analysis</h1>
<div class="counts" id="loom-counts"></div>
<script id="loom-data" type="application/json">{data_json}</script>
<div class="grid" id="loom-grid"></div>
<script>
(function() {{
  var data = JSON.parse(document.getElementById('loom-data').textContent);
  var counts = data.run_counts || {{}};
  var countsEl = document.getElementById('loom-counts');
  countsEl.textContent = 'Run counts: ' + Object.keys(counts).map(function(k) {{
    return k + '=' + counts[k];
  }}).join(', ');
  var versionList = Object.keys(data.versions);
  var phases = data.phases || [];
  var metrics = data.metrics || [];
  var grid = document.getElementById('loom-grid');
  function makeChart(canvas, title, perVersionValues) {{
    if (typeof Chart === 'undefined') return;
    new Chart(canvas.getContext('2d'), {{
      type: 'bar',
      data: {{
        labels: versionList,
        datasets: [{{ label: title, data: perVersionValues }}]
      }},
      options: {{
        plugins: {{ title: {{ display: true, text: title }}, legend: {{ display: false }} }},
        scales: {{ y: {{ beginAtZero: true }} }}
      }}
    }});
  }}
  metrics.forEach(function(metric) {{
    phases.forEach(function(phase) {{
      var cell = document.createElement('div'); cell.className = 'cell';
      var canvas = document.createElement('canvas');
      cell.appendChild(canvas);
      grid.appendChild(cell);
      var values = versionList.map(function(v) {{
        return ((data.versions[v] || {{}})[phase] || {{}})[metric] || 0;
      }});
      makeChart(canvas, metric + ' — ' + phase, values);
    }});
  }});
  // Totals chart per metric across phases (summed).
  metrics.forEach(function(metric) {{
    var cell = document.createElement('div'); cell.className = 'cell';
    var canvas = document.createElement('canvas');
    cell.appendChild(canvas);
    grid.appendChild(cell);
    var values = versionList.map(function(v) {{
      var sum = 0;
      phases.forEach(function(phase) {{
        sum += ((data.versions[v] || {{}})[phase] || {{}})[metric] || 0;
      }});
      return sum;
    }});
    makeChart(canvas, metric + ' — total', values);
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


DEFAULT_ROOT = Path("loom/orchestrator/evaluation")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Render cross-version analysis.html.")
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--out", default=None,
                    help="output HTML path; defaults to <root>/analysis.html")
    args = ap.parse_args(argv)

    root = Path(args.root)
    out = Path(args.out) if args.out else (root / "analysis.html")
    root.mkdir(parents=True, exist_ok=True)
    data = collect(root)
    html = render_html(data)
    atomic_write_text(out, html)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
