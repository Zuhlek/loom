#!/usr/bin/env python3
"""Tests for tag-subagent-phase.py — specifically the gate that keeps a
bystander session out of a project's telemetry.

`.loom/.active` is repo-global, so this PostToolUse hook fires for every
Agent dispatch in the repo, including ones from an unrelated conversation
in the same directory. Registering those pollutes `.session-pointer` and
tags their agents with whatever phase `pipeline.md` names — which is how a
run's metrics.md ends up measuring a different conversation entirely.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
HOOK = HERE / "tag-subagent-phase.py"

WEAVE_DISPATCH = (
    "# Build Phase Agent\n\n"
    "<system-reminder>\n"
    "Active project: proj-x\n"
    "Active phase: build\n"
    "</system-reminder>"
)


class PointerGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="tag-hook-"))
        self.project_dir = self.tmp / ".loom" / "proj-x"
        self.project_dir.mkdir(parents=True)
        (self.tmp / ".loom" / ".active").write_text("proj-x\n", encoding="utf-8")
        # A phase is nameable from pipeline.md — the fallback that used to
        # tag bystander agents with a phase they had nothing to do with.
        (self.project_dir / "pipeline.md").write_text(
            "## Current phase\n```text\nbuild\n```\n", encoding="utf-8")
        self.pointer = self.project_dir / ".session-pointer"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, *, prompt: str, session_id: str) -> subprocess.CompletedProcess:
        payload = {
            "tool_name": "Agent",
            "session_id": session_id,
            "cwd": str(self.tmp),
            "tool_input": {"prompt": prompt},
            "tool_response": {"agentId": "abc123", "agentType": "general-purpose"},
        }
        return subprocess.run(
            [sys.executable, str(HOOK)], input=json.dumps(payload),
            capture_output=True, text=True, timeout=60,
        )

    def test_bystander_dispatch_is_not_registered(self) -> None:
        result = self._run(prompt="Go refute some claims for me",
                           session_id="bystander-session")
        self.assertEqual(result.returncode, 0)
        self.assertFalse(
            self.pointer.exists(),
            msg="a dispatch with no `Active phase:` must not claim the project")

    def test_weave_dispatch_is_registered(self) -> None:
        result = self._run(prompt=WEAVE_DISPATCH, session_id="weave-session")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(self.pointer.exists())
        self.assertEqual(self.pointer.read_text(encoding="utf-8").split(),
                         ["weave-session"])

    def test_ad_hoc_dispatch_in_a_known_session_still_counts(self) -> None:
        """Once a session has proven itself a /weave orchestrator, its own
        helper agents belong to the run even without a phase stamp."""
        self._run(prompt=WEAVE_DISPATCH, session_id="weave-session")
        self._run(prompt="quick helper, no stamp", session_id="weave-session")
        self.assertEqual(self.pointer.read_text(encoding="utf-8").split(),
                         ["weave-session"])

    def test_bystander_never_joins_an_established_pointer(self) -> None:
        self._run(prompt=WEAVE_DISPATCH, session_id="weave-session")
        self._run(prompt="unrelated work", session_id="bystander-session")
        self.assertEqual(self.pointer.read_text(encoding="utf-8").split(),
                         ["weave-session"],
                         msg="bystander session must stay out of the pointer")


if __name__ == "__main__":
    unittest.main(verbosity=2)
