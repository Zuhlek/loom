#!/usr/bin/env python3
"""Unit tests for analyze.py per tests.md G4 + tasks/T-010.md.

Run via:
    python3 orchestrator/evaluation/test_analyze.py
"""
from __future__ import annotations

import json
import os
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
    }


def _crashed_row(phase: str) -> dict:
    return {
        "phase": phase, "agent_kind": "subagent", "agent_label": "crashed",
        "tokens": None, "duration_wall_ms": 999, "duration_autonomous_ms": None,
        "status": "crashed",
    }


class AnalyzeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="analyze-"))
        self.root = self.tmp / "eval"
        self.root.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_run(self, version: str, run: str, rows: list[dict]) -> None:
        d = self.root / version / run
        d.mkdir(parents=True)
        with (d / "usage.jsonl").open("w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")

    # ---- AC-1 + AC-2 + AC-3 + AC-4: basic shape -----------------------

    def test_multi_version_renders_with_baseline_first(self) -> None:
        # Two runs under baseline, one under version "1".
        self._write_run("baseline", "run-1", [
            _ok_row("spec", "subagent", wall_ms=1000, autonomous_ms=500),
            _ok_row("design", "subagent", wall_ms=2000, autonomous_ms=1500),
        ])
        self._write_run("baseline", "run-2", [
            _ok_row("spec", "subagent", wall_ms=3000, autonomous_ms=2500),
        ])
        self._write_run("1", "run-1", [
            _ok_row("spec", "subagent", wall_ms=5000, autonomous_ms=4000),
        ])
        out = self.root / "analysis.html"
        rc, _, err = _run(["--root", str(self.root), "--out", str(out)])
        self.assertEqual(rc, 0, msg=err)
        self.assertTrue(out.exists())
        text = out.read_text()
        # AC-6: vendored Chart.js reference
        self.assertIn('<script src="chartjs/chart.min.js"', text)
        # No CDN reference
        self.assertNotIn("cdn.jsdelivr.net", text)
        self.assertNotIn("cdnjs.cloudflare.com", text)
        # AC-3: baseline appears BEFORE "1" in the inline JSON.
        # Find the inline JSON block.
        m = re.search(r"<script id=\"loom-data\"[^>]*>(.*?)</script>", text, re.DOTALL)
        self.assertIsNotNone(m, msg="expected inline <script id=loom-data> block")
        data = json.loads(m.group(1))
        versions = list(data["versions"].keys())
        self.assertEqual(versions[0], "baseline")
        self.assertIn("1", versions)
        self.assertLess(versions.index("baseline"), versions.index("1"))

        # AC-4: pooling — baseline.spec.wall_ms mean = mean(1000, 3000) = 2000
        baseline_spec_wall = data["versions"]["baseline"]["spec"]["wall_ms"]
        self.assertEqual(baseline_spec_wall, 2000)

    # ---- AC-7: empty-tree behaviour ------------------------------------

    def test_only_baseline_present_no_errors(self) -> None:
        self._write_run("baseline", "run-1", [
            _ok_row("spec", "subagent", wall_ms=1234, autonomous_ms=999),
        ])
        out = self.root / "analysis.html"
        rc, _, err = _run(["--root", str(self.root), "--out", str(out)])
        self.assertEqual(rc, 0, msg=err)
        self.assertTrue(out.exists())
        text = out.read_text()
        m = re.search(r"<script id=\"loom-data\"[^>]*>(.*?)</script>", text, re.DOTALL)
        data = json.loads(m.group(1))
        self.assertEqual(list(data["versions"].keys()), ["baseline"])

    # ---- AC-5: metric registry round-trip ------------------------------

    def test_metric_registry_round_trip(self) -> None:
        # Read METRICS list and verify each metric shows up as a key in the
        # per-version per-phase data block.
        self._write_run("baseline", "run-1", [
            _ok_row("spec", "subagent"),
        ])
        out = self.root / "analysis.html"
        rc, _, _ = _run(["--root", str(self.root), "--out", str(out)])
        self.assertEqual(rc, 0)
        text = out.read_text()
        m = re.search(r"<script id=\"loom-data\"[^>]*>(.*?)</script>", text, re.DOTALL)
        data = json.loads(m.group(1))
        # Read METRICS from the source.
        src = SCRIPT.read_text()
        metric_names = re.findall(r"^\s*\(\s*\"([a-z_]+)\"", src, re.MULTILINE)
        self.assertGreaterEqual(len(metric_names), 6)
        # Every metric appears in the spec phase data:
        for name in metric_names:
            self.assertIn(name, data["versions"]["baseline"]["spec"],
                          msg=f"metric {name!r} missing from data")

    # ---- Crashed rows excluded from means -----------------------------

    def test_crashed_rows_excluded_from_mean(self) -> None:
        self._write_run("baseline", "run-1", [
            _ok_row("spec", "subagent", wall_ms=1000, autonomous_ms=500),
            _crashed_row("spec"),
        ])
        out = self.root / "analysis.html"
        rc, _, _ = _run(["--root", str(self.root), "--out", str(out)])
        self.assertEqual(rc, 0)
        text = out.read_text()
        m = re.search(r"<script id=\"loom-data\"[^>]*>(.*?)</script>", text, re.DOTALL)
        data = json.loads(m.group(1))
        # The crashed row should NOT contribute to wall_ms. Sum over the one
        # OK row only = 1000 (per-run pooled to a single value, then the
        # version mean over 1 run = 1000).
        self.assertEqual(data["versions"]["baseline"]["spec"]["wall_ms"], 1000)

    # ---- No prose narrative -------------------------------------------

    def test_no_prose_narrative_in_body(self) -> None:
        self._write_run("baseline", "run-1", [_ok_row("spec", "subagent")])
        out = self.root / "analysis.html"
        rc, _, _ = _run(["--root", str(self.root), "--out", str(out)])
        self.assertEqual(rc, 0)
        text = out.read_text()
        # Body should have no <p> tags (graphs only).
        self.assertNotRegex(text, r"<p[\s>]")

    # ---- Atomic write contract ----------------------------------------

    def test_no_tmp_files_left_behind(self) -> None:
        self._write_run("baseline", "run-1", [_ok_row("spec", "subagent")])
        out = self.root / "analysis.html"
        rc, _, _ = _run(["--root", str(self.root), "--out", str(out)])
        self.assertEqual(rc, 0)
        leftovers = list(self.root.glob("analysis.html.tmp*"))
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
