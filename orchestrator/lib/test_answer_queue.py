#!/usr/bin/env python3
"""Unit tests for answer-queue.py per tests.md G3 + tasks/T-005.md.

Runs under stdlib unittest. Invoked by Build via:
    python3 orchestrator/lib/test_answer_queue.py
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
SCRIPT = HERE / "answer-queue.py"


def _run(args: list[str], cwd: Path) -> tuple[int, str, str]:
    """Invoke the CLI; return (returncode, stdout, stderr)."""
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _write_yaml(p: Path, body: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body, encoding="utf-8")


SAMPLE_YAML = """\
# baseline answers
answers:
  - q_id: Q01
    answer: "B"
  - q_id: Q02
    answer: "YES"
  - answer: "(A)"
"""


class AnswerQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="aq-test-"))
        self.project = "demo"
        self.loom_root = self.tmp / ".loom" / self.project
        self.loom_root.mkdir(parents=True)
        self.yaml_path = self.loom_root / ".answers.yaml"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---- peek -----------------------------------------------------------

    def test_peek_returns_first_entry_without_mutating_file(self) -> None:
        _write_yaml(self.yaml_path, SAMPLE_YAML)
        original = self.yaml_path.read_text()
        rc, out, err = _run(["peek", self.project], self.tmp)
        self.assertEqual(rc, 0, msg=f"stderr: {err}")
        payload = json.loads(out)
        self.assertEqual(payload, {"q_id": "Q01", "answer": "B"})
        self.assertEqual(self.yaml_path.read_text(), original)

    def test_peek_empty_returns_empty_object(self) -> None:
        # Either: absent file, or file with empty answers list.
        rc, out, _ = _run(["peek", self.project], self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {})

        _write_yaml(self.yaml_path, "answers: []\n")
        rc, out, _ = _run(["peek", self.project], self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {})

    # ---- pop ------------------------------------------------------------

    def test_pop_by_qid_removes_matching_entry(self) -> None:
        _write_yaml(self.yaml_path, SAMPLE_YAML)
        rc, out, err = _run(["pop", self.project, "--q-id", "Q02"], self.tmp)
        self.assertEqual(rc, 0, msg=f"stderr: {err}")
        self.assertEqual(json.loads(out), {"q_id": "Q02", "answer": "YES"})

        remaining = self.yaml_path.read_text()
        self.assertNotIn("Q02", remaining)
        # other entries still present
        self.assertIn("Q01", remaining)
        self.assertIn("(A)", remaining)

    def test_pop_fifo_removes_head(self) -> None:
        _write_yaml(self.yaml_path, SAMPLE_YAML)
        rc, out, err = _run(["pop", self.project], self.tmp)
        self.assertEqual(rc, 0, msg=f"stderr: {err}")
        self.assertEqual(json.loads(out), {"q_id": "Q01", "answer": "B"})
        remaining = self.yaml_path.read_text()
        self.assertNotIn("Q01", remaining)
        self.assertIn("Q02", remaining)

    def test_pop_sequence_then_empty(self) -> None:
        _write_yaml(self.yaml_path, SAMPLE_YAML)
        # by q_id
        rc, out, _ = _run(["pop", self.project, "--q-id", "Q02"], self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {"q_id": "Q02", "answer": "YES"})
        # FIFO
        rc, out, _ = _run(["pop", self.project], self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {"q_id": "Q01", "answer": "B"})
        # FIFO (the no-q_id entry)
        rc, out, _ = _run(["pop", self.project], self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {"answer": "(A)"})
        # exhausted
        rc, out, _ = _run(["pop", self.project], self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {})

    def test_pop_empty_returns_empty_object(self) -> None:
        _write_yaml(self.yaml_path, "answers: []\n")
        rc, out, err = _run(["pop", self.project], self.tmp)
        self.assertEqual(rc, 0, msg=f"stderr: {err}")
        self.assertEqual(json.loads(out), {})

    def test_pop_absent_file_returns_empty_object(self) -> None:
        # File never created.
        rc, out, _ = _run(["pop", self.project], self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {})

    def test_pop_qid_no_match_returns_empty_object(self) -> None:
        _write_yaml(self.yaml_path, SAMPLE_YAML)
        rc, out, _ = _run(["pop", self.project, "--q-id", "Q99"], self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {})
        # file unchanged
        self.assertIn("Q01", self.yaml_path.read_text())
        self.assertIn("Q02", self.yaml_path.read_text())

    def test_pop_is_atomic_file_always_readable_between_pops(self) -> None:
        """Atomic write semantics: at no point is the file left empty/broken.

        The real contract is: after each pop, the file is parseable by the
        same parser the consumer uses. Header comments authored by the user
        may be preserved through the rewrite (and indeed should be —
        otherwise a `# canned answers for baseline run X` would vanish on
        the first pop).
        """
        _write_yaml(self.yaml_path, SAMPLE_YAML)
        # Pop and confirm readable, repeat
        for _ in range(3):
            rc, _, _ = _run(["pop", self.project], self.tmp)
            self.assertEqual(rc, 0)
            # Parse-don't-prefix-match — the file may carry a comment header.
            rc2, _, err = _run(["peek", self.project], self.tmp)
            self.assertEqual(rc2, 0, msg=f"file not parseable after pop: {err}")

    # ---- grammar errors -------------------------------------------------

    def test_invalid_yaml_emits_clear_error_with_line_number(self) -> None:
        bad = "answers:\n  - q_id Q01\n    answer: B\n"  # missing colon after q_id
        _write_yaml(self.yaml_path, bad)
        rc, _, err = _run(["peek", self.project], self.tmp)
        self.assertNotEqual(rc, 0)
        self.assertIn("line", err.lower())
        # Offending line is line 2 (1-indexed).
        self.assertIn("2", err)

    def test_invalid_top_level_emits_error(self) -> None:
        bad = "not_answers:\n  - answer: x\n"
        _write_yaml(self.yaml_path, bad)
        rc, _, err = _run(["peek", self.project], self.tmp)
        self.assertNotEqual(rc, 0)
        # Error should mention `answers` (the expected top-level key) somewhere
        self.assertIn("answers", err.lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
