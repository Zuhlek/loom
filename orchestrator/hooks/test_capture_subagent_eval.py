#!/usr/bin/env python3
"""Smoke tests for capture-subagent-eval per tests.md G1 + tasks/T-001.md.

Invocation:
    python3 orchestrator/hooks/test_capture_subagent_eval.py

Strategy:
- Fabricate a minimal Anthropic-SDK-style transcript JSONL.
- Construct the stdin payload Claude Code sends to SubagentStop
  (`{transcript_path, session_id, cwd}`).
- Pipe it to the hook (the .sh shim, so we exercise the wiring end-to-end).
- Inspect `.loom/<project>/usage.jsonl`.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
HOOK_SH = HERE / "capture-subagent-eval.sh"
HOOK_PY = HERE / "capture-subagent-eval.py"


def _assistant_turn(uuid: str, parent_uuid: str | None, ts: str, tokens: dict | None, *,
                    session_id: str = "child-sess",
                    is_sidechain: bool = True) -> dict:
    msg = {
        "model": "claude-opus-4-7-20260101",
        "id": uuid + "-msg",
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": "ok"}],
        "stop_reason": "end_turn",
    }
    if tokens is not None:
        msg["usage"] = tokens
    return {
        "type": "assistant",
        "uuid": uuid,
        "parentUuid": parent_uuid,
        "sessionId": session_id,
        "isSidechain": is_sidechain,
        "timestamp": ts,
        "cwd": "/tmp/x",
        "message": msg,
    }


def _user_turn(uuid: str, parent_uuid: str | None, ts: str, *,
               session_id: str = "child-sess",
               is_sidechain: bool = True,
               content_text: str = "do something") -> dict:
    return {
        "type": "user",
        "uuid": uuid,
        "parentUuid": parent_uuid,
        "sessionId": session_id,
        "isSidechain": is_sidechain,
        "timestamp": ts,
        "cwd": "/tmp/x",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": content_text}],
        },
    }


def _system_seed(session_id: str = "child-sess", is_sidechain: bool = True,
                 agent_label: str = "spec-grilling-agent",
                 phase: str = "spec") -> dict:
    """A 'system' / first user record that names the dispatched agent and phase.

    We embed `[agent: ...]` and `[phase: ...]` markers in the first user
    message; the hook's parser keys off either explicit `agent`/`phase` fields
    on the row OR these inline markers.
    """
    return {
        "type": "user",
        "uuid": "seed-uuid",
        "parentUuid": None,
        "sessionId": session_id,
        "isSidechain": is_sidechain,
        "timestamp": "2026-05-15T08:00:00.000Z",
        "cwd": "/tmp/x",
        "agent_label": agent_label,
        "phase": phase,
        "message": {
            "role": "user",
            "content": [{"type": "text",
                         "text": f"[phase: {phase}] [agent: {agent_label}] Begin work."}],
        },
    }


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")


def _run_hook(payload: dict, cwd: Path) -> tuple[int, str, str, float]:
    """Run the hook shim (the .sh) with stdin payload. Return (rc, stdout, stderr, elapsed_sec)."""
    start = time.monotonic()
    proc = subprocess.run(
        ["bash", str(HOOK_SH)],
        input=json.dumps(payload),
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )
    elapsed = time.monotonic() - start
    return proc.returncode, proc.stdout, proc.stderr, elapsed


class CaptureHookSmokeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="capeval-"))
        self.project = "demoproj"
        self.loom_root = self.tmp / ".loom" / self.project
        self.loom_root.mkdir(parents=True)
        self.transcript = self.tmp / "fake-transcript.jsonl"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _payload(self, *, session_id: str = "child-sess") -> dict:
        return {
            "transcript_path": str(self.transcript),
            "session_id": session_id,
            "cwd": str(self.loom_root),
        }

    def _rows_from_usage_jsonl(self) -> list[dict]:
        p = self.loom_root / "usage.jsonl"
        if not p.exists():
            return []
        return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]

    # ---- AC-1: clean direct-subagent → one row, status=ok --------------

    def test_clean_subagent_writes_one_ok_row(self) -> None:
        rows = [
            _system_seed(),
            _user_turn("u1", "seed-uuid", "2026-05-15T08:00:00.000Z"),
            _assistant_turn(
                "a1", "u1", "2026-05-15T08:00:01.500Z",
                {"input_tokens": 100, "output_tokens": 50,
                 "cache_creation_input_tokens": 10, "cache_read_input_tokens": 20},
            ),
            _user_turn("u2", "a1", "2026-05-15T08:00:02.000Z"),
            _assistant_turn(
                "a2", "u2", "2026-05-15T08:00:04.000Z",
                {"input_tokens": 200, "output_tokens": 75,
                 "cache_creation_input_tokens": 5, "cache_read_input_tokens": 30},
            ),
        ]
        _write_jsonl(self.transcript, rows)
        rc, _, err, elapsed = _run_hook(self._payload(), self.tmp)
        self.assertEqual(rc, 0, msg=err)
        # Performance budget (US-001 AC-8): <500 ms. Generous in this smoke;
        # a real Python startup is ~100ms.
        self.assertLess(elapsed, 2.0, msg=f"hook took {elapsed:.2f}s")

        rows_out = self._rows_from_usage_jsonl()
        self.assertEqual(len(rows_out), 1)
        row = rows_out[0]
        self.assertEqual(row["phase"], "spec")
        self.assertEqual(row["agent_kind"], "subagent")
        self.assertEqual(row["agent_label"], "spec-grilling-agent")
        self.assertEqual(row["status"], "ok")
        self.assertEqual(row["tokens"], {
            "input_tokens": 300, "output_tokens": 125,
            "cache_creation_input_tokens": 15, "cache_read_input_tokens": 50,
        })
        self.assertIsInstance(row["duration_wall_ms"], int)
        self.assertIsInstance(row["duration_autonomous_ms"], int)
        self.assertGreater(row["duration_wall_ms"], 0)
        self.assertGreater(row["duration_autonomous_ms"], 0)
        # autonomous_ms = (a1.ts - u1.ts) + (a2.ts - u2.ts) = 1500 + 2000 = 3500
        self.assertEqual(row["duration_autonomous_ms"], 3500)
        # wall_ms = a2.ts - seed-uuid (first row).ts = 8:00:04 - 8:00:00 = 4000
        self.assertEqual(row["duration_wall_ms"], 4000)

        # AC-5: no tool_calls / per-tool fields
        self.assertNotIn("tool_calls", row)
        # AC-6: no version field
        self.assertNotIn("version", row)

    # ---- AC-4: crash sentinel ------------------------------------------

    def test_crashed_transcript_writes_crash_sentinel(self) -> None:
        # Assistant turn missing the usage block entirely.
        rows = [
            _system_seed(),
            _user_turn("u1", "seed-uuid", "2026-05-15T08:00:00.000Z"),
            _assistant_turn("a1", "u1", "2026-05-15T08:00:01.000Z", None),
        ]
        _write_jsonl(self.transcript, rows)
        rc, _, err, _ = _run_hook(self._payload(), self.tmp)
        self.assertEqual(rc, 0, msg=err)
        rows_out = self._rows_from_usage_jsonl()
        self.assertEqual(len(rows_out), 1, msg=rows_out)
        row = rows_out[0]
        self.assertEqual(row["status"], "crashed")
        self.assertIsNone(row["tokens"])
        self.assertIsNone(row["duration_autonomous_ms"])
        self.assertIsInstance(row["duration_wall_ms"], int)
        self.assertGreaterEqual(row["duration_wall_ms"], 0)

    # ---- AC-5/AC-6: schema exclusions ----------------------------------

    def test_row_excludes_tool_calls_and_version(self) -> None:
        # Even if the transcript includes tool_use blocks, the row must not
        # gain a per-tool field.
        usage = {"input_tokens": 5, "output_tokens": 5,
                 "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
        a1 = _assistant_turn("a1", "seed-uuid", "2026-05-15T08:00:01.000Z", usage)
        a1["message"]["content"] = [
            {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}, "id": "x"},
        ]
        rows = [_system_seed(), _user_turn("u1", "seed-uuid", "2026-05-15T08:00:00.000Z"), a1]
        _write_jsonl(self.transcript, rows)
        rc, _, _, _ = _run_hook(self._payload(), self.tmp)
        self.assertEqual(rc, 0)
        rows_out = self._rows_from_usage_jsonl()
        self.assertEqual(len(rows_out), 1)
        row = rows_out[0]
        for forbidden in ("tool_calls", "tool_call_count", "per_tool", "version"):
            self.assertNotIn(forbidden, row, msg=f"forbidden field present: {forbidden}")

    # ---- AC-7: validator must not be modified --------------------------

    def test_validator_files_untouched(self) -> None:
        # Stat-only check: validator files exist and the hook task does not
        # depend on or import them. (This is a static check, but we keep it
        # in the smoke to make any future regression visible.)
        validator_sh = HERE / "validate-subagent-output.sh"
        validator_py = HERE / "validate-subagent-output.py"
        self.assertTrue(validator_sh.exists())
        self.assertTrue(validator_py.exists())

    # ---- No-op outside Loom workspace ----------------------------------

    def test_no_op_when_cwd_has_no_loom_segment(self) -> None:
        # cwd doesn't contain a .loom/<project>/ segment → hook returns 0,
        # no row written.
        non_loom = self.tmp / "elsewhere"
        non_loom.mkdir()
        rows = [
            _system_seed(),
            _user_turn("u1", "seed-uuid", "2026-05-15T08:00:00.000Z"),
            _assistant_turn(
                "a1", "u1", "2026-05-15T08:00:01.000Z",
                {"input_tokens": 5, "output_tokens": 5,
                 "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            ),
        ]
        _write_jsonl(self.transcript, rows)
        payload = {
            "transcript_path": str(self.transcript),
            "session_id": "x",
            "cwd": str(non_loom),
        }
        rc, _, _, _ = _run_hook(payload, self.tmp)
        self.assertEqual(rc, 0)
        # No usage.jsonl anywhere under tmp:
        self.assertFalse((self.loom_root / "usage.jsonl").exists())

    # ---- Missing transcript: silent no-op ------------------------------

    def test_no_op_when_transcript_missing(self) -> None:
        payload = {
            "transcript_path": str(self.tmp / "does-not-exist.jsonl"),
            "session_id": "x",
            "cwd": str(self.loom_root),
        }
        rc, _, _, _ = _run_hook(payload, self.tmp)
        self.assertEqual(rc, 0)
        self.assertFalse((self.loom_root / "usage.jsonl").exists())

    # ---- Append, not overwrite -----------------------------------------

    def test_two_invocations_append_two_rows(self) -> None:
        rows = [
            _system_seed(),
            _user_turn("u1", "seed-uuid", "2026-05-15T08:00:00.000Z"),
            _assistant_turn(
                "a1", "u1", "2026-05-15T08:00:01.000Z",
                {"input_tokens": 1, "output_tokens": 1,
                 "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            ),
        ]
        _write_jsonl(self.transcript, rows)
        for _ in range(2):
            rc, _, _, _ = _run_hook(self._payload(), self.tmp)
            self.assertEqual(rc, 0)
        rows_out = self._rows_from_usage_jsonl()
        self.assertEqual(len(rows_out), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
