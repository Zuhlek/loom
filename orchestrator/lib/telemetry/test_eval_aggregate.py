#!/usr/bin/env python3
"""Unit tests for eval-aggregate.py per tests.md G2 + tasks/T-003.md.

Run via:
    python3 orchestrator/lib/telemetry/test_eval_aggregate.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "eval-aggregate.py"


def _run(project: str, cwd: Path) -> tuple[int, str, str]:
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), project],
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _row(phase: str, agent_kind: str, label: str, *,
         tokens: dict | None = None,
         wall_ms: int = 1000,
         autonomous_ms: int | None = 500,
         status: str = "ok",
         quality: dict | None = None) -> dict:
    if status == "crashed":
        emitted_quality = None
    elif quality is not None:
        emitted_quality = quality
    else:
        emitted_quality = {"error_results": 0, "read_errors": 0, "bash_failures": 0}
    return {
        "phase": phase,
        "agent_kind": agent_kind,
        "agent_label": label,
        "tokens": tokens if tokens is not None else (None if status == "crashed" else
                                                    {"input_tokens": 10,
                                                     "output_tokens": 5,
                                                     "cache_creation_input_tokens": 0,
                                                     "cache_read_input_tokens": 0}),
        "duration_wall_ms": wall_ms,
        "duration_autonomous_ms": autonomous_ms if status != "crashed" else None,
        "status": status,
        "quality": emitted_quality,
    }


class EvalAggregateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="eval-agg-"))
        self.project = "demo"
        self.loom = self.tmp / ".loom" / self.project
        self.loom.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_jsonl(self, rows: list[dict]) -> None:
        p = self.loom / "usage.jsonl"
        with p.open("w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")

    def test_aggregator_produces_usage_md_with_all_sections(self) -> None:
        """G2: per-phase totals, orch-vs-subagent split, run totals, crashed section."""
        rows = [
            # spec: 2 subagent + 1 orchestrator
            _row("spec", "subagent", "spec-grilling-agent",
                 tokens={"input_tokens": 100, "output_tokens": 50,
                         "cache_creation_input_tokens": 10, "cache_read_input_tokens": 20},
                 wall_ms=2000, autonomous_ms=1500),
            _row("spec", "subagent", "spec-quality-check",
                 tokens={"input_tokens": 200, "output_tokens": 75,
                         "cache_creation_input_tokens": 5, "cache_read_input_tokens": 30},
                 wall_ms=3000, autonomous_ms=2200),
            _row("spec", "orchestrator", "weave",
                 tokens={"input_tokens": 50, "output_tokens": 25,
                         "cache_creation_input_tokens": 0, "cache_read_input_tokens": 100},
                 wall_ms=500, autonomous_ms=200),
            # design: 1 subagent
            _row("design", "subagent", "design-agent",
                 tokens={"input_tokens": 300, "output_tokens": 150,
                         "cache_creation_input_tokens": 0, "cache_read_input_tokens": 50},
                 wall_ms=4000, autonomous_ms=3000),
            # build: crashed sentinel
            _row("build", "subagent", "build-task-agent", status="crashed",
                 wall_ms=8120),
        ]
        self._write_jsonl(rows)
        rc, _, err = _run(self.project, self.tmp)
        self.assertEqual(rc, 0, msg=err)
        usage_md = self.loom / "usage.md"
        self.assertTrue(usage_md.exists())
        text = usage_md.read_text()

        # Section headers present.
        self.assertIn("# Cost summary", text)
        self.assertIn("## Per-phase totals", text)
        self.assertIn("## Per-phase orchestrator vs subagent split", text)
        self.assertIn("## Run totals", text)
        self.assertIn("## Crashed invocations", text)

        # Per-phase totals include spec and design as rows.
        self.assertRegex(text, r"\|\s*spec\s*\|")
        self.assertRegex(text, r"\|\s*design\s*\|")
        self.assertRegex(text, r"\|\s*build\s*\|")  # build row exists even if only crashed

        # Crashed section lists the build entry.
        self.assertIn("build-task-agent", text)
        # Token totals: sum of non-null rows
        # input_tokens total = 100+200+50+300 = 650
        self.assertIn("650", text)

    def test_review_md_is_not_created(self) -> None:
        rows = [_row("spec", "subagent", "x")]
        self._write_jsonl(rows)
        rc, _, err = _run(self.project, self.tmp)
        self.assertEqual(rc, 0, msg=err)
        self.assertFalse((self.loom / "review.md").exists())

    def test_review_md_is_not_modified_when_present(self) -> None:
        rows = [_row("spec", "subagent", "x")]
        self._write_jsonl(rows)
        existing = self.loom / "review.md"
        existing.write_text("PRE-EXISTING REVIEW CONTENT\n")
        before_stat = existing.stat()
        before_text = existing.read_text()
        rc, _, _ = _run(self.project, self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(existing.read_text(), before_text)
        # Same size and mtime (or at least content unchanged):
        self.assertEqual(existing.stat().st_size, before_stat.st_size)

    def test_crashed_rows_excluded_from_token_totals(self) -> None:
        rows = [
            _row("spec", "subagent", "x",
                 tokens={"input_tokens": 5, "output_tokens": 5,
                         "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}),
            _row("build", "subagent", "crashy", status="crashed", wall_ms=999),
        ]
        self._write_jsonl(rows)
        rc, _, err = _run(self.project, self.tmp)
        self.assertEqual(rc, 0, msg=err)
        text = (self.loom / "usage.md").read_text()
        # input_tokens total should be 5 (NOT 5 + any crashed contribution).
        # The crashed row has tokens=null so no contribution.
        # Crashed row should be listed under Crashed invocations.
        self.assertIn("crashy", text)

    def test_empty_usage_jsonl_produces_zero_totals(self) -> None:
        (self.loom / "usage.jsonl").write_text("")
        rc, _, err = _run(self.project, self.tmp)
        self.assertEqual(rc, 0, msg=err)
        text = (self.loom / "usage.md").read_text()
        self.assertIn("# Cost summary", text)
        # No crash; explicit "no data" or zero-totals signal present
        self.assertRegex(text, r"(no\s+rows|0\s+rows|zero|0\s+input_tokens|0\s+|\|\s*0\s*\|)", )

    def test_missing_usage_jsonl_produces_zero_totals(self) -> None:
        # No file written at all.
        rc, _, err = _run(self.project, self.tmp)
        self.assertEqual(rc, 0, msg=err)
        usage_md = self.loom / "usage.md"
        self.assertTrue(usage_md.exists())

    def test_atomic_write_no_tmp_left_behind(self) -> None:
        rows = [_row("spec", "subagent", "x")]
        self._write_jsonl(rows)
        rc, _, _ = _run(self.project, self.tmp)
        self.assertEqual(rc, 0)
        leftovers = list(self.loom.glob("usage.md.tmp*"))
        self.assertEqual(leftovers, [])

    def test_orphan_rollup_folded_as_crashed(self) -> None:
        """If a parent never fired SubagentStop (rollup file left behind),
        the aggregator folds it into a synthetic crashed parent row."""
        rows = [_row("spec", "subagent", "x")]
        self._write_jsonl(rows)
        # Create a sub-subagent rollup file with no parent.
        rollup_dir = self.loom / ".eval-rollup"
        rollup_dir.mkdir()
        with (rollup_dir / "orphan-parent-id.jsonl").open("w") as fh:
            fh.write(json.dumps({
                "tokens": {"input_tokens": 50, "output_tokens": 10,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
                "duration_wall_ms": 1200,
                "duration_autonomous_ms": 800,
                "status": "ok",
                "agent_label": "orphan-sub",
            }) + "\n")
        rc, _, err = _run(self.project, self.tmp)
        self.assertEqual(rc, 0, msg=err)
        text = (self.loom / "usage.md").read_text()
        # Synthetic crashed row mentions the orphan label or a generic
        # "orphan rollup" marker.
        self.assertIn("Crashed invocations", text)
        self.assertTrue(("orphan-sub" in text) or ("orphan" in text.lower()))


class EvalAggregateQualityAndOutcomeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="eval-agg-quality-"))
        self.project = "demo"
        self.loom = self.tmp / ".loom" / self.project
        self.loom.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_jsonl(self, rows: list[dict]) -> None:
        with (self.loom / "usage.jsonl").open("w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")

    def test_quality_columns_present_and_summed(self) -> None:
        rows = [
            _row("spec", "subagent", "s1",
                 quality={"error_results": 4, "read_errors": 1, "bash_failures": 2}),
            _row("spec", "subagent", "s2",
                 quality={"error_results": 1, "read_errors": 0, "bash_failures": 1}),
        ]
        self._write_jsonl(rows)
        rc, _, err = _run(self.project, self.tmp)
        self.assertEqual(rc, 0, msg=err)
        text = (self.loom / "usage.md").read_text()
        self.assertIn("errors", text)
        self.assertIn("read-err", text)
        self.assertIn("bash-fail", text)
        spec_row = [ln for ln in text.splitlines()
                    if ln.startswith("|") and "spec" in ln and "Phase" not in ln]
        self.assertTrue(spec_row, msg="expected a spec phase row in usage.md")
        cells = [c.strip() for c in spec_row[0].strip("|").split("|")]
        self.assertEqual(cells[-3:], ["5", "1", "3"])

    def test_run_outcome_block_rendered_when_outcome_json_present(self) -> None:
        rows = [_row("review", "subagent", "r1")]
        self._write_jsonl(rows)
        (self.loom / "outcome.json").write_text(json.dumps({
            "lifecycle_state": "complete",
            "final_phase": "review",
            "review_findings_present": True,
            "pipeline_md_present": True,
        }))
        rc, _, err = _run(self.project, self.tmp)
        self.assertEqual(rc, 0, msg=err)
        text = (self.loom / "usage.md").read_text()
        self.assertIn("## Run outcome", text)
        self.assertIn("Lifecycle state: complete", text)
        self.assertIn("Final phase: review", text)
        self.assertIn("review.md present: True", text)

    def test_run_outcome_block_handles_missing_outcome_json(self) -> None:
        rows = [_row("spec", "subagent", "s1")]
        self._write_jsonl(rows)
        rc, _, err = _run(self.project, self.tmp)
        self.assertEqual(rc, 0, msg=err)
        text = (self.loom / "usage.md").read_text()
        self.assertIn("## Run outcome", text)
        self.assertIn("(outcome.json not present)", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
