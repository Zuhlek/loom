#!/usr/bin/env python3
"""Unit tests for analyze.py.

The renderer walks `analytics/<version>/<run-id>/usage.jsonl`. Version
assignment comes from the parent dir name; no runs.json. Each test
builds a throwaway dir tree, points analyze.py at it via `--analytics`,
and inspects the inline `<script id="loom-data">` JSON block.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "analyze.py"


def _run(args: list[str]) -> tuple[int, str, str]:
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _ok_row(phase: str, agent_kind: str, *, wall_ms: int = 1000,
            autonomous_ms: int = 500,
            tokens: dict | None = None) -> dict:
    return {
        "phase": phase,
        "agent_kind": agent_kind,
        "agent_label": "x",
        "tokens": tokens or {
            "input_tokens": 100, "output_tokens": 50,
            "cache_creation_input_tokens": 10, "cache_read_input_tokens": 20,
        },
        "duration_wall_ms": wall_ms,
        "duration_autonomous_ms": autonomous_ms,
        "status": "ok",
        "quality": {"error_results": 0, "read_errors": 0, "bash_failures": 0},
    }


def _crashed_row(phase: str) -> dict:
    return {
        "phase": phase, "agent_kind": "subagent", "agent_label": "crashed",
        "tokens": None, "duration_wall_ms": 999, "duration_autonomous_ms": None,
        "status": "crashed",
        "quality": None,
    }


def _extract_data(html: str) -> dict:
    m = re.search(r"<script id=\"loom-data\"[^>]*>(.*?)</script>", html, re.DOTALL)
    assert m, "expected inline <script id=loom-data> block"
    return json.loads(m.group(1))


def _load_analyze_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location("analyze_module", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ANALYZE = _load_analyze_module()


class AnalyzeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="analyze-"))
        self.analytics = self.tmp / "analytics"
        self.analytics.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _add_run(self, run_id: str, version: str, rows: list[dict]) -> None:
        d = self.analytics / version / run_id
        d.mkdir(parents=True, exist_ok=True)
        with (d / "usage.jsonl").open("w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")

    def _render(self) -> tuple[int, str, str, Path]:
        out = self.tmp / "analysis.html"
        rc, so, se = _run([
            "--analytics", str(self.analytics),
            "--out", str(out),
        ])
        return rc, so, se, out

    # ---- baseline-first ordering, pooling, vendored Chart.js ----------

    def test_multi_version_renders_with_baseline_first(self) -> None:
        self._add_run("baseline-1", "baseline", [
            _ok_row("spec", "subagent", wall_ms=1000, autonomous_ms=500),
            _ok_row("design", "subagent", wall_ms=2000, autonomous_ms=1500),
        ])
        self._add_run("baseline-2", "baseline", [
            _ok_row("spec", "subagent", wall_ms=3000, autonomous_ms=2500),
        ])
        self._add_run("v1-1", "1", [
            _ok_row("spec", "subagent", wall_ms=5000, autonomous_ms=4000),
        ])

        rc, _, err, out = self._render()
        self.assertEqual(rc, 0, msg=err)
        self.assertTrue(out.exists())
        text = out.read_text()
        self.assertIn('<script src="chartjs/chart.min.js"', text)
        self.assertNotIn("cdn.jsdelivr.net", text)
        self.assertNotIn("cdnjs.cloudflare.com", text)

        data = _extract_data(text)
        versions = list(data["versions"].keys())
        self.assertEqual(versions[0], "baseline")
        self.assertIn("1", versions)
        self.assertLess(versions.index("baseline"), versions.index("1"))

        self.assertEqual(data["versions"]["baseline"]["spec"]["wall_ms"], 2000)
        self.assertEqual(data["run_counts"]["baseline"], 2)
        self.assertEqual(data["run_counts"]["1"], 1)

    # ---- single-baseline pool renders cleanly --------------------------

    def test_only_baseline_present_no_errors(self) -> None:
        self._add_run("baseline-1", "baseline", [
            _ok_row("spec", "subagent", wall_ms=1234, autonomous_ms=999),
        ])
        rc, _, err, out = self._render()
        self.assertEqual(rc, 0, msg=err)
        data = _extract_data(out.read_text())
        self.assertEqual(list(data["versions"].keys()), ["baseline"])

    # ---- metric registry round-trip ------------------------------------

    def test_metric_registry_round_trip(self) -> None:
        self._add_run("baseline-1", "baseline", [_ok_row("spec", "subagent")])
        rc, _, err, out = self._render()
        self.assertEqual(rc, 0, msg=err)
        data = _extract_data(out.read_text())
        src = SCRIPT.read_text()
        metric_names = re.findall(r"^\s*\(\s*\"([a-z_]+)\"", src, re.MULTILINE)
        self.assertGreaterEqual(len(metric_names), 6)
        for name in metric_names:
            self.assertIn(name, data["versions"]["baseline"]["spec"],
                          msg=f"metric {name!r} missing from data")

    # ---- crashed rows excluded from means ------------------------------

    def test_crashed_rows_excluded_from_mean(self) -> None:
        self._add_run("baseline-1", "baseline", [
            _ok_row("spec", "subagent", wall_ms=1000, autonomous_ms=500),
            _crashed_row("spec"),
        ])
        rc, _, err, out = self._render()
        self.assertEqual(rc, 0, msg=err)
        data = _extract_data(out.read_text())
        self.assertEqual(data["versions"]["baseline"]["spec"]["wall_ms"], 1000)

    # ---- no prose narrative --------------------------------------------

    def test_no_prose_narrative_in_body(self) -> None:
        self._add_run("baseline-1", "baseline", [_ok_row("spec", "subagent")])
        rc, _, err, out = self._render()
        self.assertEqual(rc, 0, msg=err)
        text = out.read_text()
        self.assertNotRegex(text, r"<p[\s>]")

    # ---- atomic write contract -----------------------------------------

    def test_no_tmp_files_left_behind(self) -> None:
        self._add_run("baseline-1", "baseline", [_ok_row("spec", "subagent")])
        rc, _, err, out = self._render()
        self.assertEqual(rc, 0, msg=err)
        leftovers = list(out.parent.glob("analysis.html.tmp*"))
        self.assertEqual(leftovers, [])

    # ---- missing run dir is reported, not silently dropped -------------

    def test_run_dir_without_usage_or_pointer_is_reported_missing(self) -> None:
        # Run dir present but holds neither usage.jsonl nor an
        # .eval-orchestrator-pointer — analyse can't harvest, must report.
        self._add_run("baseline-1", "baseline", [
            _ok_row("spec", "subagent", wall_ms=1000, autonomous_ms=500),
        ])
        (self.analytics / "baseline" / "baseline-2-orphaned").mkdir(parents=True)

        rc, _, err, out = self._render()
        self.assertEqual(rc, 0, msg=err)
        data = _extract_data(out.read_text())
        self.assertEqual(data["run_counts"]["baseline"], 1)
        self.assertIn("baseline-2-orphaned", data["missing"])
        self.assertIn("baseline-2-orphaned", err)

    # ---- analysed runs are skipped, not re-harvested -------------------

    def test_existing_usage_is_not_reharvested(self) -> None:
        # If usage.jsonl is present, analyse must not touch the harvester
        # (no stderr noise about harvesting, no modification time change).
        self._add_run("baseline-1", "baseline", [
            _ok_row("spec", "subagent", wall_ms=1000, autonomous_ms=500),
        ])
        usage_path = self.analytics / "baseline" / "baseline-1" / "usage.jsonl"
        original_mtime = usage_path.stat().st_mtime

        rc, _, err, _ = self._render()
        self.assertEqual(rc, 0, msg=err)
        self.assertNotIn("harvesting", err)
        self.assertEqual(usage_path.stat().st_mtime, original_mtime)


class OutcomeWriterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="analyze-outcome-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_derive_outcome_reads_pipeline_blocks(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "pipeline.md").write_text(
            "## Current phase\n```text\nreview\n```\n"
            "## Lifecycle state\n```text\ncomplete\n```\n"
        )
        (run_dir / "review.md").write_text("findings")
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertEqual(outcome["lifecycle_state"], "complete")
        self.assertEqual(outcome["final_phase"], "review")
        self.assertTrue(outcome["review_findings_present"])
        self.assertTrue(outcome["pipeline_md_present"])

    def test_derive_outcome_missing_pipeline(self) -> None:
        run_dir = self.tmp / "no-pipeline"
        run_dir.mkdir()
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertEqual(outcome["lifecycle_state"], "active")
        self.assertIsNone(outcome["final_phase"])
        self.assertFalse(outcome["review_findings_present"])
        self.assertFalse(outcome["pipeline_md_present"])

    def test_write_outcome_creates_file(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "pipeline.md").write_text(
            "## Current phase\n```text\nbuild\n```\n"
            "## Lifecycle state\n```text\nactive\n```\n"
        )
        out_path = ANALYZE.write_outcome(run_dir)
        self.assertEqual(out_path, run_dir / "outcome.json")
        self.assertTrue(out_path.is_file())
        payload = json.loads(out_path.read_text())
        self.assertEqual(payload["final_phase"], "build")
        self.assertEqual(payload["lifecycle_state"], "active")

    def test_derive_outcome_unknown_phase_falls_to_null(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "pipeline.md").write_text(
            "## Current phase\n```text\nnonsense\n```\n"
            "## Lifecycle state\n```text\nactive\n```\n"
        )
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertIsNone(outcome["final_phase"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
