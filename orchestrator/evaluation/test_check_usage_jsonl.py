#!/usr/bin/env python3
"""Unit tests for check-usage-jsonl.py covering the quality block and
the outcome.json validator path."""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "check-usage-jsonl.py"


def _load_validator_module():
    spec = importlib.util.spec_from_file_location("check_usage_jsonl", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


VALIDATOR = _load_validator_module()


def _ok_row(**overrides) -> dict:
    row = {
        "phase": "spec",
        "agent_kind": "subagent",
        "agent_label": "Spec phase agent",
        "tokens": {
            "input_tokens": 1, "output_tokens": 1,
            "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
        },
        "duration_wall_ms": 100,
        "duration_autonomous_ms": 50,
        "status": "ok",
        "quality": {"error_results": 0, "read_errors": 0, "bash_failures": 0},
    }
    row.update(overrides)
    return row


def _run_cli(*args: str) -> tuple[int, str, str]:
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True, text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


class RowQualityValidationTests(unittest.TestCase):
    def test_ok_row_with_quality_passes(self) -> None:
        self.assertEqual(VALIDATOR.validate_row(_ok_row()), [])

    def test_missing_quality_field_rejected(self) -> None:
        row = _ok_row()
        del row["quality"]
        violations = VALIDATOR.validate_row(row)
        self.assertTrue(any("quality" in violation for violation in violations))

    def test_quality_must_be_object_when_ok(self) -> None:
        row = _ok_row(quality=None)
        violations = VALIDATOR.validate_row(row)
        self.assertTrue(any("quality must be an object" in violation
                            for violation in violations))

    def test_quality_must_be_null_when_crashed(self) -> None:
        row = _ok_row(
            status="crashed", tokens=None, duration_autonomous_ms=None,
            quality={"error_results": 0, "read_errors": 0, "bash_failures": 0},
        )
        violations = VALIDATOR.validate_row(row)
        self.assertTrue(any("quality must be null when status is crashed" in violation
                            for violation in violations))

    def test_quality_counts_must_be_non_negative(self) -> None:
        row = _ok_row(quality={"error_results": -1, "read_errors": 0,
                               "bash_failures": 0})
        violations = VALIDATOR.validate_row(row)
        self.assertTrue(any(">= 0" in violation for violation in violations))

    def test_quality_unexpected_keys_rejected(self) -> None:
        row = _ok_row(quality={"error_results": 0, "read_errors": 0,
                               "bash_failures": 0, "extra": 1})
        violations = VALIDATOR.validate_row(row)
        self.assertTrue(any("unexpected keys" in violation for violation in violations))

    def test_untagged_row_carries_quality(self) -> None:
        row = _ok_row(
            phase=None, status="untagged", agent_label="unknown-agent",
            quality={"error_results": 2, "read_errors": 1, "bash_failures": 0},
        )
        self.assertEqual(VALIDATOR.validate_row(row), [])


def _outcome(**overrides) -> dict:
    base = {
        "lifecycle_state": "complete",
        "final_phase": "review",
        "review_findings_present": True,
        "pipeline_md_present": True,
        "review_verdict": None,
        "tasks": None,
    }
    base.update(overrides)
    return base


class OutcomeValidationTests(unittest.TestCase):
    def test_well_formed_outcome_passes(self) -> None:
        self.assertEqual(VALIDATOR.validate_outcome(_outcome(
            review_verdict={"status": "PASS", "blockers": 0, "major": 0,
                            "minor": 2, "note": 1},
            tasks={"planned": 5, "done": 5},
        )), [])

    def test_active_with_null_final_phase_passes(self) -> None:
        self.assertEqual(VALIDATOR.validate_outcome(_outcome(
            lifecycle_state="active", final_phase=None,
            review_findings_present=False, pipeline_md_present=False,
        )), [])

    def test_invalid_lifecycle_state_rejected(self) -> None:
        violations = VALIDATOR.validate_outcome(_outcome(
            lifecycle_state="halfway", final_phase="spec",
            review_findings_present=False,
        ))
        self.assertTrue(any("lifecycle_state" in violation for violation in violations))

    def test_invalid_final_phase_rejected(self) -> None:
        violations = VALIDATOR.validate_outcome(_outcome(
            lifecycle_state="active", final_phase="bogus",
            review_findings_present=False,
        ))
        self.assertTrue(any("final_phase" in violation for violation in violations))

    def test_non_bool_flags_rejected(self) -> None:
        violations = VALIDATOR.validate_outcome(_outcome(
            lifecycle_state="active", final_phase="spec",
            review_findings_present="yes", pipeline_md_present=1,
        ))
        self.assertTrue(any("review_findings_present" in violation for violation in violations))
        self.assertTrue(any("pipeline_md_present" in violation for violation in violations))

    def test_review_verdict_invalid_status_rejected(self) -> None:
        violations = VALIDATOR.validate_outcome(_outcome(
            review_verdict={"status": "ALMOST", "blockers": 0, "major": 0,
                            "minor": 0, "note": 0},
        ))
        self.assertTrue(any("review_verdict.status" in v for v in violations))

    def test_review_verdict_negative_count_rejected(self) -> None:
        violations = VALIDATOR.validate_outcome(_outcome(
            review_verdict={"status": "PASS", "blockers": -1, "major": 0,
                            "minor": 0, "note": 0},
        ))
        self.assertTrue(any("review_verdict.blockers" in v for v in violations))

    def test_review_verdict_unexpected_key_rejected(self) -> None:
        violations = VALIDATOR.validate_outcome(_outcome(
            review_verdict={"status": "PASS", "blockers": 0, "major": 0,
                            "minor": 0, "note": 0, "stray": 1},
        ))
        self.assertTrue(any("unexpected keys" in v for v in violations))

    def test_tasks_done_exceeds_planned_rejected(self) -> None:
        violations = VALIDATOR.validate_outcome(_outcome(
            tasks={"planned": 3, "done": 5},
        ))
        self.assertTrue(any("exceed" in v for v in violations))

    def test_tasks_negative_rejected(self) -> None:
        violations = VALIDATOR.validate_outcome(_outcome(
            tasks={"planned": -1, "done": 0},
        ))
        self.assertTrue(any("tasks.planned" in v for v in violations))


class CliRoundTripTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="check-usage-cli-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_cli_validates_usage_and_outcome(self) -> None:
        usage_path = self.tmp / "usage.jsonl"
        with usage_path.open("w") as fh:
            fh.write(json.dumps(_ok_row()) + "\n")
        outcome_path = self.tmp / "outcome.json"
        outcome_path.write_text(json.dumps({
            "lifecycle_state": "complete",
            "final_phase": "review",
            "review_findings_present": True,
            "pipeline_md_present": True,
            "review_verdict": {"status": "PASS", "blockers": 0, "major": 0,
                               "minor": 2, "note": 1},
            "tasks": {"planned": 5, "done": 5},
        }))
        rc, _, err = _run_cli(str(usage_path), "--outcome", str(outcome_path))
        self.assertEqual(rc, 0, msg=err)

    def test_cli_rejects_bad_outcome(self) -> None:
        outcome_path = self.tmp / "outcome.json"
        outcome_path.write_text(json.dumps({
            "lifecycle_state": "active",
            "final_phase": "bogus",
            "review_findings_present": True,
            "pipeline_md_present": True,
            "review_verdict": None,
            "tasks": None,
        }))
        rc, _, _ = _run_cli("--outcome", str(outcome_path))
        self.assertNotEqual(rc, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
