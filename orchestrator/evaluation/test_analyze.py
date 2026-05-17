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

    # ---- cache-hit-rate derived metric ---------------------------------

    def test_cache_hit_rate_per_phase_and_total(self) -> None:
        # Two phases, known token totals. The derived rate per phase must
        # equal cache_read / (cache_read + cache_creation + input_tokens),
        # and the cross-phase "total" must re-derive from component sums
        # rather than sum the per-phase rates.
        self._add_run("baseline-1", "baseline", [
            _ok_row("spec", "subagent", tokens={
                "input_tokens": 100, "output_tokens": 0,
                "cache_creation_input_tokens": 0, "cache_read_input_tokens": 100,
            }),
            _ok_row("design", "subagent", tokens={
                "input_tokens": 300, "output_tokens": 0,
                "cache_creation_input_tokens": 0, "cache_read_input_tokens": 100,
            }),
        ])
        rc, _, err, out = self._render()
        self.assertEqual(rc, 0, msg=err)
        text = out.read_text()
        data = _extract_data(text)

        spec_rate = data["versions"]["baseline"]["spec"]["cache_hit_rate"]
        design_rate = data["versions"]["baseline"]["design"]["cache_hit_rate"]
        self.assertAlmostEqual(spec_rate, 100 / 200, places=6)   # 0.5
        self.assertAlmostEqual(design_rate, 100 / 400, places=6) # 0.25

        # Per-run block carries the same shape.
        run_block = data["runs"]["baseline"][0]["phases"]
        self.assertAlmostEqual(run_block["spec"]["cache_hit_rate"], 0.5, places=6)
        self.assertAlmostEqual(run_block["design"]["cache_hit_rate"], 0.25, places=6)

        # The dashboard must contain the formatted cell.
        self.assertIn("Cache hit-rate", text)
        # 200/600 = 33.3% → rate-bad class on the cell.
        self.assertRegex(text, r"rate-(bad|warn|good)")

    def test_cache_hit_rate_handles_zero_denominator(self) -> None:
        # Defensive: a crashed-only phase yields 0 cache_read + 0 input,
        # so the rate must fall to 0.0 (not divide-by-zero).
        self._add_run("baseline-1", "baseline", [
            _ok_row("spec", "subagent", tokens={
                "input_tokens": 0, "output_tokens": 0,
                "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
            }),
        ])
        rc, _, err, _ = self._render()
        self.assertEqual(rc, 0, msg=err)

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

    def test_review_verdict_parsed_from_review_md(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "pipeline.md").write_text(
            "## Current phase\n```text\nreview\n```\n"
            "## Lifecycle state\n```text\ncomplete\n```\n"
        )
        (run_dir / "review.md").write_text(
            "# Review\n\n## Verdict\n\n"
            "**PASS** — 0 Blockers, 0 Major, 2 Minor, 1 Note.\n"
        )
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertEqual(outcome["review_verdict"], {
            "status": "PASS", "blockers": 0, "major": 0, "minor": 2, "note": 1,
        })

    def test_review_verdict_fail_status_parsed(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "review.md").write_text(
            "**FAIL** — 2 Blockers, 1 Major, 3 Minor, 0 Notes.\n"
        )
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertEqual(outcome["review_verdict"]["status"], "FAIL")
        self.assertEqual(outcome["review_verdict"]["blockers"], 2)

    def test_review_verdict_null_when_review_missing(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertIsNone(outcome["review_verdict"])

    def test_review_verdict_null_when_verdict_line_absent(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "review.md").write_text("# Review\n\nNo verdict here.\n")
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertIsNone(outcome["review_verdict"])

    def test_tasks_counted_from_board_sections(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "board.md").write_text(
            "# Board\n\n"
            "## Backlog\n- (none)\n\n"
            "## In Progress\n- T-005 something\n\n"
            "## Review\n- (none)\n\n"
            "## Done\n- T-001 a\n- T-002 b\n- T-003 c\n- T-004 d\n"
        )
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertEqual(outcome["tasks"], {"planned": 5, "done": 4})

    def test_tasks_null_when_board_missing(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertIsNone(outcome["tasks"])

    def test_tasks_null_when_board_has_no_task_bullets(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "board.md").write_text(
            "# Board\n\n## Backlog\n- (none)\n\n## Done\n- (none)\n"
        )
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertIsNone(outcome["tasks"])

    def test_review_verdict_prefers_sidecar_over_prose(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "review.md").write_text(
            "**PASS** — 9 Blockers, 9 Major, 9 Minor, 9 Notes.\n"
        )
        (run_dir / "review-verdict.json").write_text(json.dumps({
            "verdict": "FAIL", "blockers": 1, "major": 0, "minor": 0, "note": 0,
        }))
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertEqual(outcome["review_verdict"], {
            "status": "FAIL", "blockers": 1, "major": 0, "minor": 0, "note": 0,
        })

    def test_review_verdict_falls_back_to_prose_when_sidecar_invalid(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "review.md").write_text(
            "**PASS** — 0 Blockers, 0 Major, 1 Minor, 0 Notes.\n"
        )
        (run_dir / "review-verdict.json").write_text("{not valid json")
        outcome = ANALYZE.derive_outcome(run_dir)
        self.assertEqual(outcome["review_verdict"]["status"], "PASS")
        self.assertEqual(outcome["review_verdict"]["minor"], 1)

    def test_write_outcome_includes_new_fields(self) -> None:
        run_dir = self.tmp / "run"
        run_dir.mkdir()
        (run_dir / "pipeline.md").write_text(
            "## Current phase\n```text\nreview\n```\n"
            "## Lifecycle state\n```text\ncomplete\n```\n"
        )
        (run_dir / "review.md").write_text(
            "**PASS** — 0 Blockers, 1 Major, 0 Minor, 0 Notes.\n"
        )
        (run_dir / "board.md").write_text(
            "## Done\n- T-001 done\n- T-002 done\n"
        )
        ANALYZE.write_outcome(run_dir)
        payload = json.loads((run_dir / "outcome.json").read_text())
        self.assertEqual(payload["review_verdict"]["major"], 1)
        self.assertEqual(payload["tasks"], {"planned": 2, "done": 2})


if __name__ == "__main__":
    unittest.main(verbosity=2)
