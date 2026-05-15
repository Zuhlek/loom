#!/usr/bin/env python3
"""Unit tests for eval-orchestrator-row.py per tests.md G5 + tasks/T-007.md.

Run via:
    python3 orchestrator/lib/test_eval_orchestrator_row.py
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
SCRIPT = HERE / "eval-orchestrator-row.py"


def _run(args: list[str], cwd: Path, env: dict | None = None) -> tuple[int, str, str]:
    full_env = os.environ.copy()
    if env:
        full_env.update(env)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env=full_env,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _user(uuid: str, parent: str | None, ts: str, *, session_id: str = "sess",
          is_sidechain: bool = False) -> dict:
    return {
        "type": "user",
        "uuid": uuid,
        "parentUuid": parent,
        "sessionId": session_id,
        "isSidechain": is_sidechain,
        "timestamp": ts,
        "message": {"role": "user", "content": [{"type": "text", "text": "go"}]},
    }


def _assistant(uuid: str, parent: str, ts: str, tokens: dict, *,
               session_id: str = "sess", is_sidechain: bool = False) -> dict:
    return {
        "type": "assistant",
        "uuid": uuid,
        "parentUuid": parent,
        "sessionId": session_id,
        "isSidechain": is_sidechain,
        "timestamp": ts,
        "message": {
            "model": "claude-opus",
            "id": uuid + "-m",
            "role": "assistant",
            "type": "message",
            "content": [{"type": "text", "text": "ok"}],
            "usage": tokens,
        },
    }


class OrchestratorRowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="orow-"))
        self.project = "demo"
        self.loom = self.tmp / ".loom" / self.project
        self.loom.mkdir(parents=True)
        # Fabricate a "Claude Code transcript" file path under
        # ~/.claude/projects/<encoded>/<sid>.jsonl-equivalent — but for
        # testability, the script accepts an explicit --transcript override.
        self.transcript = self.tmp / "sess.jsonl"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_transcript(self, rows: list[dict]) -> None:
        with self.transcript.open("w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")

    def _seed_subagent_rows(self, *, phase: str = "spec") -> None:
        """Pre-populate usage.jsonl with two subagent rows for `phase`."""
        sub = {
            "phase": phase, "agent_kind": "subagent", "agent_label": "x",
            "tokens": {"input_tokens": 100, "output_tokens": 50,
                       "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            "duration_wall_ms": 1000, "duration_autonomous_ms": 700, "status": "ok",
        }
        sub2 = dict(sub)
        sub2["tokens"] = {"input_tokens": 50, "output_tokens": 25,
                          "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
        sub2["duration_autonomous_ms"] = 300
        sub2["duration_wall_ms"] = 500
        with (self.loom / "usage.jsonl").open("w") as fh:
            fh.write(json.dumps(sub) + "\n")
            fh.write(json.dumps(sub2) + "\n")

    def _read_usage_rows(self) -> list[dict]:
        p = self.loom / "usage.jsonl"
        if not p.exists():
            return []
        return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]

    # ---- AC-3: appends one orchestrator row ----------------------------

    def test_emits_one_orchestrator_row_for_phase(self) -> None:
        # Session totals: input=400, output=200, autonomous=2000, wall=3000
        rows = [
            _user("u1", None, "2026-05-15T08:00:00.000Z"),
            _assistant("a1", "u1", "2026-05-15T08:00:01.000Z",
                       {"input_tokens": 200, "output_tokens": 100,
                        "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}),
            _user("u2", "a1", "2026-05-15T08:00:02.000Z"),
            _assistant("a2", "u2", "2026-05-15T08:00:03.000Z",
                       {"input_tokens": 200, "output_tokens": 100,
                        "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}),
        ]
        self._write_transcript(rows)
        self._seed_subagent_rows(phase="spec")
        # Subagent totals already in usage.jsonl: input=150, output=75,
        # autonomous=1000, wall=1500
        rc, _, err = _run(
            ["--project", self.project, "--phase", "spec",
             "--transcript", str(self.transcript),
             "--loom-root", str(self.tmp / ".loom")],
            self.tmp,
        )
        self.assertEqual(rc, 0, msg=err)
        rows_out = self._read_usage_rows()
        # 2 subagent + 1 new orchestrator = 3
        self.assertEqual(len(rows_out), 3)
        new_row = rows_out[-1]
        self.assertEqual(new_row["agent_kind"], "orchestrator")
        self.assertEqual(new_row["agent_label"], "weave")
        self.assertEqual(new_row["phase"], "spec")
        # Token delta: session(400,200) - subagents(150,75) = (250,125)
        self.assertEqual(new_row["tokens"]["input_tokens"], 250)
        self.assertEqual(new_row["tokens"]["output_tokens"], 125)
        # Autonomous delta: session-autonomous (1000+1000 = 2000) -
        # subagents-autonomous (1000) = 1000. Wall delta: session-wall
        # (3000) - subagents-wall (1500) = 1500. (Clamped at 0 if negative.)
        self.assertGreaterEqual(new_row["duration_autonomous_ms"], 0)
        self.assertGreaterEqual(new_row["duration_wall_ms"], 0)
        self.assertEqual(new_row["status"], "ok")

    # ---- Idempotency: second invocation doesn't double-count -----------

    def test_second_invocation_does_not_double_count(self) -> None:
        rows = [
            _user("u1", None, "2026-05-15T08:00:00.000Z"),
            _assistant("a1", "u1", "2026-05-15T08:00:01.000Z",
                       {"input_tokens": 50, "output_tokens": 25,
                        "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}),
        ]
        self._write_transcript(rows)
        # First call
        rc, _, _ = _run(
            ["--project", self.project, "--phase", "spec",
             "--transcript", str(self.transcript),
             "--loom-root", str(self.tmp / ".loom")],
            self.tmp,
        )
        self.assertEqual(rc, 0)
        # Second call WITHOUT new transcript turns — should be a no-op
        # (zero-delta row) OR no row added at all. We accept "no new row".
        rows_after_first = self._read_usage_rows()
        rc, _, _ = _run(
            ["--project", self.project, "--phase", "spec",
             "--transcript", str(self.transcript),
             "--loom-root", str(self.tmp / ".loom")],
            self.tmp,
        )
        self.assertEqual(rc, 0)
        rows_after_second = self._read_usage_rows()
        self.assertEqual(len(rows_after_second), len(rows_after_first),
                         msg="re-invocation double-counted")

    # ---- Pointer file written ------------------------------------------

    def test_pointer_file_written(self) -> None:
        rows = [
            _user("u1", None, "2026-05-15T08:00:00.000Z"),
            _assistant("a1", "u1", "2026-05-15T08:00:01.000Z",
                       {"input_tokens": 5, "output_tokens": 5,
                        "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}),
        ]
        self._write_transcript(rows)
        rc, _, err = _run(
            ["--project", self.project, "--phase", "spec",
             "--transcript", str(self.transcript),
             "--loom-root", str(self.tmp / ".loom")],
            self.tmp,
        )
        self.assertEqual(rc, 0, msg=err)
        self.assertTrue((self.loom / ".eval-orchestrator-pointer").exists())

    # ---- Missing transcript falls back to crash sentinel -------------

    def test_missing_transcript_writes_crashed_orchestrator_row(self) -> None:
        # Don't write the transcript file.
        rc, _, err = _run(
            ["--project", self.project, "--phase", "spec",
             "--transcript", str(self.tmp / "missing.jsonl"),
             "--loom-root", str(self.tmp / ".loom")],
            self.tmp,
        )
        self.assertEqual(rc, 0, msg=err)
        rows_out = self._read_usage_rows()
        # One synthetic crashed orchestrator row.
        self.assertEqual(len(rows_out), 1)
        self.assertEqual(rows_out[0]["agent_kind"], "orchestrator")
        self.assertEqual(rows_out[0]["status"], "crashed")
        self.assertIsNone(rows_out[0]["tokens"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
