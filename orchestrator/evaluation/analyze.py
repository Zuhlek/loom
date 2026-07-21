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
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from statistics import fmean, median, stdev
from typing import Any


_SCRIPT_DIR = Path(__file__).resolve().parent
HARVESTER = _SCRIPT_DIR.parent / "lib" / "telemetry" / "transcript-harvest.py"
AGGREGATOR = _SCRIPT_DIR.parent / "lib" / "telemetry" / "eval-aggregate.py"
REPO_ROOT = _SCRIPT_DIR.parent.parent


# --------------------------------------------------------------------------
# Outcome derivation lives in orchestrator/lib/telemetry/run-outcome.py so
# regular /weave runs (via the tag-subagent-phase.py hook) and eval runs
# (via run-baseline.sh) produce the same outcome.json without importing the
# dashboard. Re-exported here for callers and tests.
# --------------------------------------------------------------------------

def _load_run_outcome_module():
    import importlib.util
    path = _SCRIPT_DIR.parent / "lib" / "telemetry" / "run-outcome.py"
    spec = importlib.util.spec_from_file_location("run_outcome", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_RUN_OUTCOME = _load_run_outcome_module()
derive_outcome = _RUN_OUTCOME.derive_outcome
write_outcome = _RUN_OUTCOME.write_outcome


# Metric registry. Adding a new metric is one tuple.
# Tuple: (name, dotted-path-into-row, rollup-fn-name).
# `cost_usd` is the headline: a per-model-priced estimate that stays
# comparable when a skill change shifts the token mix between buckets that
# differ ~12x in price.
METRICS = [
    ("cost_usd",       "cost_usd",                          "sum"),
    ("autonomous_ms",  "duration_autonomous_ms",            "sum"),
    ("wall_ms",        "duration_wall_ms",                  "sum"),
    ("output_tokens",  "tokens.output_tokens",              "sum"),
    ("input_tokens",   "tokens.input_tokens",               "sum"),
    ("cache_creation", "tokens.cache_creation_input_tokens","sum"),
    ("cache_read",     "tokens.cache_read_input_tokens",    "sum"),
]

# Derived rate metrics. Computed from already-summed METRICS components;
# not summable themselves (ratios don't add). Each entry:
#   (name, numerator-keys, denominator-keys) — both keys reference METRICS names.
# For the "total" rollup the rate is re-derived from component totals.
RATE_METRICS = [
    ("cache_hit_rate", ("cache_read",), ("cache_read", "cache_creation", "input_tokens")),
]

# Rate thresholds for dashboard cell colouring. >= GOOD is green,
# >= WARN is amber, below is red. 60% matches the prefix-drift alarm
# threshold.
RATE_THRESHOLD_GOOD = 0.80
RATE_THRESHOLD_WARN = 0.60


def _derive_rate(block: dict, num_keys: tuple, den_keys: tuple) -> float:
    num = sum(block.get(k, 0) or 0 for k in num_keys)
    den = sum(block.get(k, 0) or 0 for k in den_keys)
    return (num / den) if den else 0.0


def _value_total_from_phases(per_phase: dict, metric: str,
                             all_phases: list[str]) -> float:
    """Aggregate a metric across phases. Sums for plain metrics;
    re-derives from component totals for RATE_METRICS (ratios don't add)."""
    for rname, num_keys, den_keys in RATE_METRICS:
        if metric == rname:
            num = sum((per_phase.get(ph, {}) or {}).get(k, 0) or 0
                      for ph in all_phases for k in num_keys)
            den = sum((per_phase.get(ph, {}) or {}).get(k, 0) or 0
                      for ph in all_phases for k in den_keys)
            return (num / den) if den else 0.0
    return sum((per_phase.get(ph, {}) or {}).get(metric, 0) or 0
               for ph in all_phases)


def _rate_cell_class(metric: str, val: float | None) -> str:
    """Threshold class for a rate-metric cell. Empty string for non-rates."""
    is_rate = any(metric == rn for rn, _, _ in RATE_METRICS)
    if not is_rate or val is None:
        return ""
    try:
        v = float(val)
    except (TypeError, ValueError):
        return ""
    if v >= RATE_THRESHOLD_GOOD:
        return "rate-good"
    if v >= RATE_THRESHOLD_WARN:
        return "rate-warn"
    return "rate-bad"


def _get_dotted(row: dict, path: str) -> Any:
    cur: Any = row
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _is_crashed(row: dict) -> bool:
    return row.get("status") == "crashed" or row.get("tokens") is None


def _per_run_metric_sum(rows: list[dict], dotted: str, phase: str) -> float | None:
    """Sum the metric over all OK rows in this run, filtered by phase.

    Returns None if there were no contributing OK rows for this phase
    (used to skip empty per-run data points cleanly). Floats are preserved
    (cost_usd is fractional); integer metrics collapse to int at pooling.
    """
    total = 0.0
    seen = False
    for r in rows:
        if r.get("phase") != phase:
            continue
        if _is_crashed(r):
            continue
        v = _get_dotted(r, dotted)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            total += float(v)
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


def _read_pointer(run_dir: Path) -> list[str]:
    """Return every session UUID in `.eval-orchestrator-pointer` (one per
    line — retries and resumed sessions accumulate). Empty list if absent."""
    p = run_dir / ".eval-orchestrator-pointer"
    if not p.exists():
        return []
    try:
        text = p.read_text(encoding="utf-8")
    except OSError:
        return []
    return [line.strip() for line in text.splitlines() if line.strip()]


def _harvest(run_dir: Path, cwd: Path) -> bool:
    """Run transcript-harvest.py for this run. Returns True iff usage.jsonl
    exists afterwards. Surfaces stderr on failure; quiet on success."""
    session_ids = _read_pointer(run_dir)
    if not session_ids:
        print(f"[analyse] {run_dir.name}: no .eval-orchestrator-pointer, "
              f"cannot harvest", file=sys.stderr)
        return False
    cmd = [sys.executable, str(HARVESTER), run_dir.name,
           "--workspace", str(run_dir),
           "--cwd", str(cwd)]
    for sid in session_ids:
        cmd += ["--session", sid]
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
    versions_raw: dict[str, list[tuple[str, list[dict]]]] = {}
    outcomes_per_version: dict[str, list[dict]] = {}
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
                write_outcome(run_dir)
                rows = _read_jsonl(usage)
                versions_raw.setdefault(version, []).append((run_dir.name, rows))
                all_phases.update(_phases_present(rows))
                outcome_path = run_dir / "outcome.json"
                if outcome_path.is_file():
                    try:
                        outcome_payload = json.loads(outcome_path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        outcome_payload = None
                    if isinstance(outcome_payload, dict):
                        outcomes_per_version.setdefault(version, []).append({
                            "run_id": run_dir.name,
                            **outcome_payload,
                        })

    ordered_versions = _version_order(list(versions_raw.keys()))
    KNOWN_PHASE_ORDER = ("spec", "design", "plan", "build", "review")
    ordered_phases = [p for p in KNOWN_PHASE_ORDER if p in all_phases] + \
        sorted(p for p in all_phases if p not in KNOWN_PHASE_ORDER)

    out_versions: dict[str, dict] = {}
    out_runs: dict[str, list[dict]] = {}
    run_counts: dict[str, int] = {}
    for v in ordered_versions:
        per_run_pairs = versions_raw[v]
        run_counts[v] = len(per_run_pairs)
        per_phase: dict[str, dict] = {}
        for phase in ordered_phases:
            metric_block: dict[str, float] = {}
            for name, dotted, _rollup in METRICS:
                per_run_values: list[float] = []
                for _run_id, run_rows in per_run_pairs:
                    summed = _per_run_metric_sum(run_rows, dotted, phase)
                    if summed is not None:
                        per_run_values.append(summed)
                # Median is the pooled central stat — robust to a single
                # tail-latency run in a small pool, where the mean is not.
                central = float(median(per_run_values)) if per_run_values else 0.0
                if name != "cost_usd" and central == int(central):
                    central = int(central)
                elif name == "cost_usd":
                    central = round(central, 4)
                metric_block[name] = central
            # Derive rate metrics from the summed components for this phase.
            for rname, num_keys, den_keys in RATE_METRICS:
                metric_block[rname] = _derive_rate(metric_block, num_keys, den_keys)
            per_phase[phase] = metric_block
        out_versions[v] = per_phase

        run_blocks: list[dict] = []
        for run_id, run_rows in per_run_pairs:
            phase_map: dict[str, dict[str, float]] = {}
            for phase in ordered_phases:
                phase_metrics: dict[str, float] = {}
                for name, dotted, _rollup in METRICS:
                    summed = _per_run_metric_sum(run_rows, dotted, phase)
                    if summed is not None:
                        if name == "cost_usd":
                            phase_metrics[name] = round(summed, 4)
                        else:
                            phase_metrics[name] = int(summed)
                if phase_metrics:
                    for rname, num_keys, den_keys in RATE_METRICS:
                        phase_metrics[rname] = _derive_rate(phase_metrics, num_keys, den_keys)
                    phase_map[phase] = phase_metrics
            run_blocks.append({"run_id": run_id, "phases": phase_map})
        out_runs[v] = run_blocks

    warnings = _collect_warnings(analytics_dir, ordered_versions,
                                 versions_raw, outcomes_per_version)

    return {
        "versions": out_versions,
        "version_order": ordered_versions,
        "run_counts": run_counts,
        "missing": missing,
        "phases": ordered_phases,
        "metrics": [name for name, _, _ in METRICS]
                   + [name for name, _, _ in RATE_METRICS],
        "runs": out_runs,
        "outcomes": outcomes_per_version,
        "warnings": warnings,
    }


def _collect_warnings(analytics_dir: Path, ordered_versions: list[str],
                      versions_raw: dict, outcomes_per_version: dict) -> list[str]:
    """Cross-run hygiene checks. A pool that mixes models or CLI versions, or
    contains untagged/incomplete runs, is not trend-comparable — surface it
    loudly rather than letting a confounded delta read as a real change."""
    warnings: list[str] = []
    for version in ordered_versions:
        pairs = versions_raw.get(version, [])
        # Models actually used, from the rows.
        models: set[str] = set()
        untagged_runs = 0
        for _run_id, rows in pairs:
            row_models = {r.get("model") for r in rows
                          if isinstance(r.get("model"), str)}
            models |= row_models
            if any(r.get("status") == "untagged" for r in rows):
                untagged_runs += 1
        if len(models) > 1:
            warnings.append(
                f"version '{version}' pools runs across {len(models)} models "
                f"({', '.join(sorted(models))}) — token/cost deltas are not "
                f"comparable across a model switch.")
        if untagged_runs:
            warnings.append(
                f"version '{version}' has {untagged_runs} run(s) with untagged "
                f"subagents (phase hook missing) — those rows are dropped from "
                f"per-phase rollups.")
        # CLI versions + git SHAs, from run-meta.json.
        cli_versions: set[str] = set()
        git_shas: set[str] = set()
        incomplete = 0
        version_dir = analytics_dir / version
        for run_id, _rows in pairs:
            meta_path = version_dir / run_id / "run-meta.json"
            if not meta_path.is_file():
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(meta.get("claude_version"), str):
                cli_versions.add(meta["claude_version"])
            if isinstance(meta.get("loom_git_sha"), str):
                git_shas.add(meta["loom_git_sha"])
            if meta.get("failed"):
                incomplete += 1
        if len(cli_versions) > 1:
            warnings.append(
                f"version '{version}' pools runs across {len(cli_versions)} "
                f"claude CLI versions — harness overhead may differ.")
        if len(git_shas) > 1:
            warnings.append(
                f"version '{version}' pools runs across {len(git_shas)} loom "
                f"git SHAs ({', '.join(sorted(git_shas))}) — the 'version' "
                f"label mixes more than one build.")
        if incomplete:
            warnings.append(
                f"version '{version}' has {incomplete} run(s) that did not reach "
                f"Lifecycle complete — partial runs skew totals downward.")
    return warnings


# --------------------------------------------------------------------------
# Display registry. Maps raw metric field names to human-facing labels, the
# visual group they belong to, a stable color (used consistently across the
# whole page), and a one-line description shown in the glossary panel.
# Order within each group is the order metrics appear in tables / chart rows.
# --------------------------------------------------------------------------

METRICS_DISPLAY: dict[str, dict[str, str]] = {
    "cost_usd": {
        "label": "Est. cost (USD)",
        "group": "Cost",
        "color": "#0f766e",
        "desc":  "Per-model-priced estimate: input + output + cache writes (1.25×/2× by TTL) + cache reads (0.1×), summed across this run's subagents. The headline trend metric — comparable even when a change shifts the token mix between buckets. Whole-run cost incl. orchestrator is in run-meta.json.",
    },
    "autonomous_ms":  {
        "label": "Inference time",
        "group": "Time",
        "color": "#dc2626",
        "desc":  "Wall-clock the model spent generating (timeline partition; always ≤ elapsed). A latency signal, not the bill driver — cost is.",
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
    "cache_hit_rate": {
        "label": "Cache hit-rate",
        "group": "Cache",
        "color": "#10b981",
        "desc":  "cache_read / (cache_read + cache_creation + input_tokens). Healthy ≥ 80%; warn ≥ 60%; below 60% means prefix drift — something upstream is mutating the cached bytes.",
    },
}

GROUP_ORDER = ("Cost", "Time", "Tokens", "Cache")
PHASE_DISPLAY: dict[str, str] = {
    "spec":   "Spec",
    "design": "Design",
    "plan":   "Plan",
    "build":  "Build",
    "review": "Review",
}


def _metric_kind(name: str) -> str:
    if name == "cost_usd":
        return "cost"
    if name.endswith("_ms"):
        return "duration"
    if any(name == rn for rn, _, _ in RATE_METRICS):
        return "rate"
    return "tokens"


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


def _fmt_rate(v: float) -> str:
    if v is None:
        return "—"
    return f"{float(v) * 100:.1f}%"


def _fmt_cost(v: float) -> str:
    if v is None:
        return "—"
    return f"${float(v):.4f}"


def _fmt_value(name: str, val: float) -> str:
    kind = _metric_kind(name)
    if kind == "cost":
        return _fmt_cost(val)
    if kind == "duration":
        return _fmt_duration_ms(val)
    if kind == "rate":
        return _fmt_rate(val)
    return _fmt_tokens(val)


def _html(s: str) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _value_for(data: dict, version: str, phase_or_total: str, metric: str,
               all_phases: list[str]) -> float:
    if phase_or_total == "total":
        return _value_total_from_phases(
            data["versions"].get(version, {}) or {}, metric, all_phases)
    return (data["versions"].get(version, {}).get(phase_or_total, {}) or {}).get(metric, 0)


def _phase_summary_chip(data: dict, phase_or_total: str, versions: list[str],
                       all_phases: list[str]) -> str:
    """Single-version: show the absolute number. Multi-version: show last / mean."""
    chips = []
    for metric in ("cost_usd", "wall_ms"):
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


def _grouped_table(versions: list[str], metric_names: list[str], values_at: callable,
                   runs_per_version: dict | None = None,
                   run_value_at: callable | None = None) -> str:
    """Render one table with column headers grouped by metric group.

    `values_at(version, metric)` returns the pooled mean.
    When `runs_per_version` and `run_value_at` are both provided AND a version
    has more than one run, the version row becomes clickable and per-run rows
    appear collapsed beneath it. `run_value_at(version, run_id, metric)`
    returns that run's value for the metric.
    """
    grouped_metrics: list[tuple[str, list[str]]] = []
    for group in GROUP_ORDER:
        members = _metrics_in_group(group, metric_names)
        if members:
            grouped_metrics.append((group, members))

    group_row = "".join(
        f"<th class=\"group-h\" colspan=\"{len(members)}\">{_html(group)}</th>"
        for group, members in grouped_metrics
    )
    metric_row = "".join(
        f"<th class=\"num\" title=\"{_html(_metric_meta(m)['desc'])}\">"
        f"<span class=\"sw\" style=\"background:{_metric_meta(m)['color']}\"></span>"
        f"{_html(_metric_meta(m)['label'])}"
        f"</th>"
        for _, members in grouped_metrics for m in members
    )
    flat_metrics = [m for _, members in grouped_metrics for m in members]

    def _num_cell(metric: str, val) -> str:
        cls = _rate_cell_class(metric, val)
        cls_attr = f" {cls}" if cls else ""
        return f"<td class=\"num{cls_attr}\">{_html(_fmt_value(metric, val))}</td>"

    body_rows = []
    for version in versions:
        cells = "".join(_num_cell(m, values_at(version, m)) for m in flat_metrics)
        runs = (runs_per_version or {}).get(version, [])
        has_runs = run_value_at is not None and len(runs) > 1
        version_label = _html(version)
        if has_runs:
            label_cell = (
                f"<th class=\"v v-toggle-cell\">"
                f"<span class=\"v-toggle\" aria-hidden=\"true\">▸</span> {version_label}"
                f"</th>"
            )
            body_rows.append(
                f"<tr class=\"v-row has-runs\" data-version=\"{version_label}\">"
                f"{label_cell}{cells}</tr>"
            )
            for run in runs:
                run_id = run["run_id"]
                run_cells = "".join(
                    _num_cell(m, run_value_at(version, run_id, m)) for m in flat_metrics
                )
                body_rows.append(
                    f"<tr class=\"run-row\" data-version=\"{version_label}\">"
                    f"<th class=\"v run-label\">{_html(run_id)}</th>"
                    f"{run_cells}</tr>"
                )
        else:
            body_rows.append(
                f"<tr class=\"v-row\"><th class=\"v\">{version_label}</th>{cells}</tr>"
            )

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

    target_phase = anchor if not total else "total"

    def values_at(v: str, m: str) -> float:
        return _value_for(data, v, target_phase, m, all_phases)

    runs_per_version = data.get("runs", {})

    def run_value_at(v: str, run_id: str, m: str) -> float:
        for run in runs_per_version.get(v, []):
            if run["run_id"] != run_id:
                continue
            if total:
                return _value_total_from_phases(run["phases"], m, all_phases)
            return (run["phases"].get(anchor, {}) or {}).get(m, 0)
        return 0

    table = _grouped_table(versions, metric_names, values_at,
                           runs_per_version=runs_per_version,
                           run_value_at=run_value_at)

    return (
        f"<section id=\"phase-{anchor}\" class=\"phase-block phase-pane\" "
        f"data-phase=\"{anchor}\">"
        f"<header class=\"phase-head\">"
        f"<h2>{_html(label)}</h2>"
        f"<div class=\"phase-chips\">{summary_chips}</div>"
        f"</header>"
        f"{''.join(chart_strips)}"
        f"{table}"
        f"</section>"
    )


def _render_outcomes(data: dict) -> str:
    """Render per-version outcome summary + collapsible per-run table."""
    outcomes = data.get("outcomes") or {}
    if not any(outcomes.values()):
        return ""
    version_order = data.get("version_order") or list(outcomes.keys())

    def fmt_number(value: float) -> str:
        return f"{int(value)}" if value == int(value) else f"{value:.1f}"

    def stat_chip(label: str, values: list[int]) -> str:
        if not values:
            return f"<span class=\"chip chip-outcome\"><b>{_html(label)}:</b> —</span>"
        mean_text = f"μ {fmt_number(fmean(values))}"
        suffix = ""
        if len(values) >= 2:
            sigma = stdev(values)
            if sigma > 0:
                suffix = f" <span class=\"sigma\">σ {fmt_number(sigma)}</span>"
        return (f"<span class=\"chip chip-outcome\">"
                f"<b>{_html(label)}:</b> {mean_text}{suffix}</span>")

    blocks: list[str] = []
    for version in version_order:
        run_outcomes = outcomes.get(version) or []
        if not run_outcomes:
            continue
        total_runs = len(run_outcomes)
        complete = sum(1 for r in run_outcomes if r.get("lifecycle_state") == "complete")
        verdicts = [r.get("review_verdict") for r in run_outcomes]
        non_null = [v for v in verdicts if isinstance(v, dict)]
        pass_count = sum(1 for v in non_null if v.get("status") == "PASS")

        blockers_vals = [v.get("blockers", 0) for v in non_null]
        major_vals = [v.get("major", 0) for v in non_null]
        minor_vals = [v.get("minor", 0) for v in non_null]
        note_vals = [v.get("note", 0) for v in non_null]
        task_dicts = [r.get("tasks") for r in run_outcomes if isinstance(r.get("tasks"), dict)]
        planned_vals = [t.get("planned", 0) for t in task_dicts]
        done_vals = [t.get("done", 0) for t in task_dicts]

        chips = (
            f"<span class=\"chip chip-outcome\"><b>Lifecycle:</b> "
            f"{complete}/{total_runs} complete</span>"
            f"<span class=\"chip chip-outcome\"><b>Verdict:</b> "
            f"{pass_count}/{len(non_null)} PASS</span>"
            + stat_chip("Blockers", blockers_vals)
            + stat_chip("Major", major_vals)
            + stat_chip("Minor", minor_vals)
            + stat_chip("Note", note_vals)
            + stat_chip("Tasks planned", planned_vals)
            + stat_chip("Tasks done", done_vals)
        )

        rows: list[str] = []
        for run in run_outcomes:
            verdict = run.get("review_verdict") if isinstance(run.get("review_verdict"), dict) else None
            tasks = run.get("tasks") if isinstance(run.get("tasks"), dict) else None
            verdict_status = (verdict or {}).get("status", "—")
            status_cls = ("ok" if verdict_status == "PASS"
                          else ("fail" if verdict_status == "FAIL" else "muted"))
            rows.append(
                "<tr>"
                f"<th class=\"v run-label\">{_html(run.get('run_id', ''))}</th>"
                f"<td>{_html(run.get('lifecycle_state', '—'))}</td>"
                f"<td class=\"verdict-{status_cls}\">{_html(verdict_status)}</td>"
                f"<td class=\"num\">{(verdict or {}).get('blockers', '—')}</td>"
                f"<td class=\"num\">{(verdict or {}).get('major', '—')}</td>"
                f"<td class=\"num\">{(verdict or {}).get('minor', '—')}</td>"
                f"<td class=\"num\">{(verdict or {}).get('note', '—')}</td>"
                f"<td class=\"num\">"
                f"{(tasks or {}).get('done', '—')}/{(tasks or {}).get('planned', '—')}"
                f"</td>"
                "</tr>"
            )
        table = (
            "<table class=\"outcomes-table\">"
            "<thead><tr>"
            "<th class=\"v-h\">Run</th>"
            "<th>Lifecycle</th><th>Verdict</th>"
            "<th class=\"num\">Blockers</th><th class=\"num\">Major</th>"
            "<th class=\"num\">Minor</th><th class=\"num\">Note</th>"
            "<th class=\"num\">Tasks</th>"
            "</tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table>"
        )
        blocks.append(
            f"<div class=\"outcome-version\">"
            f"<div class=\"outcome-version-head\">"
            f"<h3>{_html(version)}</h3>"
            f"<div class=\"phase-chips\">{chips}</div>"
            f"</div>"
            f"{table}"
            f"</div>"
        )

    if not blocks:
        return ""
    return (
        "<section id=\"outcomes\" class=\"outcomes-section\">"
        "<header class=\"phase-head\"><h2>Outcomes</h2></header>"
        f"{''.join(blocks)}"
        "</section>"
    )


def _render_phase_tabs(phases: list[str]) -> str:
    """Tab bar that controls which phase-pane is visible. Total is default."""
    tab_specs = [("total", "Total")] + [
        (ph, PHASE_DISPLAY.get(ph, ph.title())) for ph in phases
    ]
    buttons = "".join(
        f"<button class=\"phase-tab{' active' if anchor == 'total' else ''}\" "
        f"data-phase=\"{anchor}\">{_html(label)}</button>"
        for anchor, label in tab_specs
    )
    return f"<nav class=\"phase-tabs\" aria-label=\"phase view\">{buttons}</nav>"


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
    metric_names = ([name for name, _, _ in METRICS]
                    + [name for name, _, _ in RATE_METRICS])

    # ----- Top-of-page hero -----
    if counts:
        counts_text = ", ".join(f"<b>{_html(k)}</b>: {v} run{'s' if v != 1 else ''}"
                                for k, v in counts.items())
    else:
        counts_text = "<i>no runs filed yet</i>"
    total_chips = _phase_summary_chip(data, "total", versions, phases)

    # ----- Comparability warnings banner -----
    warnings = data.get("warnings") or []
    if warnings:
        items = "".join(f"<li>{_html(w)}</li>" for w in warnings)
        warning_banner = (
            f"<section id=\"warnings\" class=\"warn-banner\">"
            f"<h2>⚠ Comparability warnings</h2>"
            f"<ul>{items}</ul>"
            f"</section>"
        )
    else:
        warning_banner = ""

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

    def _summary_cell(metric: str, val) -> str:
        cls = _rate_cell_class(metric, val)
        cls_attr = f" {cls}" if cls else ""
        return f"<td class=\"num{cls_attr}\">{_html(_fmt_value(metric, val))}</td>"

    sum_rows = []
    for ph in phases + ["total"]:
        for i, v in enumerate(versions):
            cells = "".join(
                _summary_cell(m, value_for_summary(ph, v, m))
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

    phase_tabs = _render_phase_tabs(phases)
    outcomes_section = _render_outcomes(data)

    # Push the display registry into the page so the chart JS can use it.
    metrics_display_json = json.dumps({
        m: _metric_meta(m) for m in metric_names
    }, separators=(",", ":"))
    # Rate-metric specs so the chart JS can re-derive totals from components.
    rate_metrics_json = json.dumps([
        {"name": n, "num": list(num), "den": list(den)}
        for n, num, den in RATE_METRICS
    ], separators=(",", ":"))

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
td.num.rate-good {{ color: #047857; font-weight: 600; }}
td.num.rate-warn {{ color: #b45309; font-weight: 600; }}
td.num.rate-bad  {{ color: #b91c1c; font-weight: 600; }}
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
.phase-tabs {{ display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px;
                padding: 6px; background: var(--card); border: 1px solid var(--border);
                border-radius: 8px; }}
.phase-tab {{ font: inherit; font-size: 0.85rem; padding: 6px 14px; border-radius: 999px;
              border: 1px solid transparent; background: transparent; color: var(--muted);
              cursor: pointer; }}
.phase-tab:hover {{ background: var(--bg); color: var(--fg); }}
.phase-tab.active {{ background: var(--accent); border-color: var(--accent);
                      color: #fff; font-weight: 600; }}
.warn-banner {{ border-color: #fca5a5; background: #fef2f2; }}
.warn-banner h2 {{ color: #b91c1c; margin-bottom: 8px; }}
.warn-banner ul {{ margin: 0; padding-left: 20px; }}
.warn-banner li {{ font-size: 0.85rem; color: #7f1d1d; line-height: 1.5; }}
.phase-pane {{ display: none; }}
.phase-pane.active {{ display: block; }}
.outcomes-section .outcome-version {{ padding: 10px 0; border-top: 1px solid var(--border); }}
.outcomes-section .outcome-version:first-of-type {{ border-top: 0; padding-top: 4px; }}
.outcomes-section .outcome-version-head {{ display: flex; align-items: center;
                gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }}
.outcomes-section h3 {{ font-size: 0.95rem; font-weight: 600; margin: 0; }}
.chip-outcome b {{ font-weight: 500; }}
.chip-outcome .sigma {{ color: var(--muted); font-size: 0.78rem; margin-left: 2px; }}
.outcomes-table th, .outcomes-table td {{ padding: 5px 10px; }}
.outcomes-table th.v-h {{ font-size: 0.7rem; color: var(--muted); text-transform: uppercase;
                           letter-spacing: 0.05em; }}
.outcomes-table th.run-label {{ font-weight: 400; font-size: 0.78rem; color: var(--muted); }}
.verdict-ok {{ color: #15803d; font-weight: 600; }}
.verdict-fail {{ color: #b91c1c; font-weight: 600; }}
.verdict-muted {{ color: var(--muted); }}
tr.v-row.has-runs {{ cursor: pointer; user-select: none; }}
tr.v-row.has-runs:hover td, tr.v-row.has-runs:hover th {{ background: var(--bg); }}
tr.run-row {{ display: none; }}
tr.v-row.expanded + tr.run-row, tr.run-row.expanded {{ display: table-row; }}
tr.run-row th.run-label {{ font-weight: 400; font-size: 0.72rem;
                            color: var(--muted); padding-left: 22px; }}
tr.run-row td {{ color: var(--muted); }}
.v-toggle {{ display: inline-block; width: 0.9em; color: var(--muted);
              font-size: 0.7rem; transition: transform 0.1s; }}
tr.v-row.expanded .v-toggle {{ transform: rotate(90deg); color: var(--fg); }}
</style>
</head>
<body>
<header class="hero">
  <h1>Loom — cross-version cost analysis</h1>
  <div class="subtitle">Run counts: {counts_text}</div>
  <div class="hero-chips" id="loom-total-chips">{total_chips}</div>
</header>
<script id="loom-data" type="application/json">{data_json}</script>
<script id="loom-display" type="application/json">{metrics_display_json}</script>
<script id="loom-rates" type="application/json">{rate_metrics_json}</script>
{warning_banner}
{outcomes_section}
{phase_tabs}
{''.join(sections)}
{glossary}
{summary_table}
<script>
(function() {{
  var data = JSON.parse(document.getElementById('loom-data').textContent);
  var meta = JSON.parse(document.getElementById('loom-display').textContent);
  var rateSpecs = JSON.parse(document.getElementById('loom-rates').textContent);
  var versionList = (data.version_order && data.version_order.length)
    ? data.version_order
    : Object.keys(data.versions);
  var phases = data.phases || [];

  function rateSpec(metric) {{
    for (var i = 0; i < rateSpecs.length; i++) {{
      if (rateSpecs[i].name === metric) return rateSpecs[i];
    }}
    return null;
  }}
  function isRate(metric) {{ return rateSpec(metric) !== null; }}

  function valuesFor(phase, metric) {{
    var rspec = rateSpec(metric);
    return versionList.map(function(v) {{
      if (phase === 'total') {{
        if (rspec) {{
          var num = 0, den = 0;
          phases.forEach(function(p) {{
            var block = (data.versions[v] || {{}})[p] || {{}};
            rspec.num.forEach(function(k) {{ num += block[k] || 0; }});
            rspec.den.forEach(function(k) {{ den += block[k] || 0; }});
          }});
          return den ? num / den : 0;
        }}
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
  function isCost(metric) {{ return metric === 'cost_usd'; }}
  function fmtCost(v) {{
    if (v == null) return '—';
    return '$' + Number(v).toFixed(4);
  }}
  // Per-run values for a (phase, metric): one array per version, in
  // version order. Rate metrics are re-derived per run from components.
  function runValuesFor(phase, metric) {{
    var rspec = rateSpec(metric);
    return versionList.map(function(v) {{
      var runs = (data.runs && data.runs[v]) || [];
      return runs.map(function(run) {{
        var ph = run.phases || {{}};
        if (phase === 'total') {{
          if (rspec) {{
            var num = 0, den = 0;
            phases.forEach(function(p) {{
              var block = ph[p] || {{}};
              rspec.num.forEach(function(k) {{ num += block[k] || 0; }});
              rspec.den.forEach(function(k) {{ den += block[k] || 0; }});
            }});
            return den ? num / den : null;
          }}
          var sum = 0, seen = false;
          phases.forEach(function(p) {{
            if (ph[p] && ph[p][metric] != null) {{ sum += ph[p][metric]; seen = true; }}
          }});
          return seen ? sum : null;
        }}
        return (ph[phase] && ph[phase][metric] != null) ? ph[phase][metric] : null;
      }}).filter(function(x) {{ return x != null; }});
    }});
  }}
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
  function fmtRate(v) {{
    if (v == null) return '—';
    return (Number(v) * 100).toFixed(1) + '%';
  }}
  function fmtAxis(metric) {{
    if (isRate(metric)) {{
      return function(v) {{
        var n = Number(v);
        if (!isFinite(n)) return v;
        return (n * 100).toFixed(0) + '%';
      }};
    }}
    return function(v) {{
      var n = Number(v);
      if (!isFinite(n)) return v;
      if (isCost(metric)) return '$' + n.toFixed(n < 1 ? 2 : 1);
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
    if (isRate(metric)) return fmtRate(v);
    if (isCost(metric)) return fmtCost(v);
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
    // Per-run dots overlaid on the median line, so a small pool's spread is
    // visible rather than hidden behind a single central value.
    var runVals = runValuesFor(phase, metric);
    var scatterPoints = [];
    versionList.forEach(function(v, idx) {{
      runVals[idx].forEach(function(y) {{ scatterPoints.push({{ x: idx, y: y }}); }});
    }});
    var multiRun = scatterPoints.length > versionList.length;
    new Chart(canvas.getContext('2d'), {{
      data: {{
        labels: versionList,
        datasets: [{{
          type: 'line',
          label: info.label + ' (median)',
          data: valuesFor(phase, metric),
          borderColor: color,
          backgroundColor: rgba(color, 0.12),
          tension: 0.15,
          pointRadius: 3.5,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
          borderWidth: 2,
          fill: true,
          order: 2
        }}, {{
          type: 'scatter',
          label: 'per-run',
          data: multiRun ? scatterPoints : [],
          parsing: false,
          borderColor: rgba(color, 0.55),
          backgroundColor: rgba(color, 0.35),
          pointRadius: 2.5,
          pointHoverRadius: 4,
          order: 1
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
<script>
(function() {{
  document.querySelectorAll('tr.v-row.has-runs').forEach(function(row) {{
    row.addEventListener('click', function() {{
      var version = row.getAttribute('data-version');
      var expanded = row.classList.toggle('expanded');
      var tbody = row.closest('tbody');
      tbody.querySelectorAll('tr.run-row[data-version="' + CSS.escape(version) + '"]')
        .forEach(function(detail) {{ detail.classList.toggle('expanded', expanded); }});
    }});
  }});

  var tabs = document.querySelectorAll('.phase-tab');
  function selectPhase(target) {{
    tabs.forEach(function(tab) {{
      tab.classList.toggle('active', tab.getAttribute('data-phase') === target);
    }});
    document.querySelectorAll('.phase-pane').forEach(function(pane) {{
      var match = pane.getAttribute('data-phase') === target;
      pane.classList.toggle('active', match);
      if (match) {{
        pane.querySelectorAll('canvas[data-phase]').forEach(function(canvas) {{
          var chart = window.Chart && window.Chart.getChart && window.Chart.getChart(canvas);
          if (chart) chart.resize();
        }});
      }}
    }});
  }}
  var initial = document.querySelector('.phase-tab.active');
  selectPhase(initial ? initial.getAttribute('data-phase') : 'total');
  tabs.forEach(function(tab) {{
    tab.addEventListener('click', function() {{
      selectPhase(tab.getAttribute('data-phase'));
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
