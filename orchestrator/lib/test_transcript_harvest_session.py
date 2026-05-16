#!/usr/bin/env python3
"""Tests for the `--session UUID` bypass in transcript-harvest.py.

The session pointer is how analyse.py finds the right Claude Code session
for a filed run after the fabric has been moved. Without `--session`, the
harvester falls back to matching `<project>` against transcript dispatch
text — fine while the fabric still mentions `.loom/<project>` somewhere
nearby, but the explicit pointer is the reliable key.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
HARVEST_PATH = HERE / "transcript-harvest.py"


def _load_harvest_module():
    spec = importlib.util.spec_from_file_location("transcript_harvest", HARVEST_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


HARVEST = _load_harvest_module()


def _write_transcript(path: Path, *, mentions_project: str | None = None,
                      input_tokens: int = 100) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    user_text = f"dispatch for .loom/{mentions_project}" if mentions_project else "dispatch"
    rows = [
        {
            "type": "user",
            "timestamp": "2026-05-16T10:00:00Z",
            "message": {"content": [{"type": "text", "text": user_text}]},
        },
        {
            "type": "assistant",
            "timestamp": "2026-05-16T10:00:05Z",
            "message": {"usage": {
                "input_tokens": input_tokens, "output_tokens": 10,
                "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
            }},
        },
    ]
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")


class FindSubagentTranscriptsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harvest-"))
        self.projects_root = self.tmp / "projects"
        self.cwd = Path("/repo/loom")
        encoded = HARVEST.encode_cwd_for_projects_dir(self.cwd)
        self.base = self.projects_root / encoded
        self.session_a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        self.session_b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        _write_transcript(self.base / self.session_a / "subagents" / "agent-1.jsonl",
                          mentions_project="proj-x")
        _write_transcript(self.base / self.session_b / "subagents" / "agent-2.jsonl",
                          mentions_project="proj-y")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_session_none_returns_all_transcripts(self) -> None:
        found = HARVEST.find_subagent_transcripts(self.projects_root, self.cwd,
                                                  session_id=None)
        names = sorted(p.name for p in found)
        self.assertEqual(names, ["agent-1.jsonl", "agent-2.jsonl"])

    def test_session_id_restricts_to_one_session(self) -> None:
        found = HARVEST.find_subagent_transcripts(self.projects_root, self.cwd,
                                                  session_id=self.session_a)
        self.assertEqual([p.name for p in found], ["agent-1.jsonl"])

    def test_session_id_unknown_returns_empty(self) -> None:
        found = HARVEST.find_subagent_transcripts(self.projects_root, self.cwd,
                                                  session_id="ffffffff-ffff-ffff-ffff-ffffffffffff")
        self.assertEqual(found, [])


class HarvestSessionBypassTests(unittest.TestCase):
    """When --session is passed, harvest() must not require the transcript
    text to mention the project name. That's the whole point of the flag."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harvest-"))
        self.projects_root = self.tmp / "projects"
        self.cwd = Path("/repo/loom")
        encoded = HARVEST.encode_cwd_for_projects_dir(self.cwd)
        self.session_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
        _write_transcript(
            self.projects_root / encoded / self.session_id / "subagents" / "agent-99.jsonl",
            mentions_project=None,
        )
        self.workspace = self.tmp / "workspace"
        self.workspace.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_session_bypasses_project_name_match(self) -> None:
        summary = HARVEST.harvest(
            project="any-project-name-here",
            workspace=self.workspace,
            projects_root=self.projects_root,
            cwd=self.cwd,
            dry_run=False,
            session_id=self.session_id,
        )
        self.assertEqual(summary["matched"], 1,
                         msg="--session should skip the dispatch-text regex")
        self.assertTrue((self.workspace / "usage.jsonl").exists())

    def test_no_session_requires_project_mention(self) -> None:
        summary = HARVEST.harvest(
            project="any-project-name-here",
            workspace=self.workspace,
            projects_root=self.projects_root,
            cwd=self.cwd,
            dry_run=True,
            session_id=None,
        )
        self.assertEqual(summary["matched"], 0)


def _write_phase_sidecar(transcript_path: Path, *, phase: str | None = "spec",
                         project: str = "test-project",
                         agent_type: str = "claude") -> None:
    sidecar = transcript_path.parent / (transcript_path.stem + ".phase")
    payload = {
        "phase": phase,
        "project": project,
        "agent_type": agent_type,
        "dispatched_at": "2026-05-16T10:00:00Z",
    }
    sidecar.write_text(json.dumps(payload) + "\n", encoding="utf-8")


class PhaseSidecarTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="phase-sidecar-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_returns_phase_when_sidecar_present(self) -> None:
        transcript = self.tmp / "agent-x.jsonl"
        _write_transcript(transcript)
        _write_phase_sidecar(transcript, phase="design")
        self.assertEqual(HARVEST.read_phase_sidecar(transcript), "design")

    def test_returns_none_when_sidecar_missing(self) -> None:
        transcript = self.tmp / "agent-y.jsonl"
        _write_transcript(transcript)
        self.assertIsNone(HARVEST.read_phase_sidecar(transcript))

    def test_returns_none_when_phase_not_in_enum(self) -> None:
        transcript = self.tmp / "agent-z.jsonl"
        _write_transcript(transcript)
        _write_phase_sidecar(transcript, phase="bogus")
        self.assertIsNone(HARVEST.read_phase_sidecar(transcript))

    def test_returns_none_when_sidecar_corrupt(self) -> None:
        transcript = self.tmp / "agent-w.jsonl"
        _write_transcript(transcript)
        sidecar = transcript.parent / (transcript.stem + ".phase")
        sidecar.write_text("{not valid json", encoding="utf-8")
        self.assertIsNone(HARVEST.read_phase_sidecar(transcript))

    def test_phase_is_lowercased(self) -> None:
        transcript = self.tmp / "agent-u.jsonl"
        _write_transcript(transcript)
        _write_phase_sidecar(transcript, phase="REVIEW")
        self.assertEqual(HARVEST.read_phase_sidecar(transcript), "review")


class HarvestStatusTaggingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harvest-status-"))
        self.projects_root = self.tmp / "projects"
        self.cwd = Path("/repo/loom")
        encoded = HARVEST.encode_cwd_for_projects_dir(self.cwd)
        self.session_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
        self.subagents_dir = self.projects_root / encoded / self.session_id / "subagents"
        self.workspace = self.tmp / "workspace"
        self.workspace.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_row_untagged_when_sidecar_missing(self) -> None:
        _write_transcript(self.subagents_dir / "agent-1.jsonl", mentions_project=None)
        summary = HARVEST.harvest(
            project="any", workspace=self.workspace,
            projects_root=self.projects_root, cwd=self.cwd,
            dry_run=True, session_id=self.session_id,
        )
        self.assertEqual(len(summary["rows"]), 1)
        row = summary["rows"][0]
        self.assertEqual(row["status"], "untagged")
        self.assertIsNone(row["phase"])
        self.assertEqual(row["agent_label"], "unknown-agent")

    def test_row_ok_when_sidecar_present(self) -> None:
        transcript = self.subagents_dir / "agent-2.jsonl"
        _write_transcript(transcript, mentions_project=None)
        _write_phase_sidecar(transcript, phase="build")
        summary = HARVEST.harvest(
            project="any", workspace=self.workspace,
            projects_root=self.projects_root, cwd=self.cwd,
            dry_run=True, session_id=self.session_id,
        )
        self.assertEqual(len(summary["rows"]), 1)
        row = summary["rows"][0]
        self.assertEqual(row["status"], "ok")
        self.assertEqual(row["phase"], "build")
        self.assertEqual(row["agent_label"], "Build phase agent")


if __name__ == "__main__":
    unittest.main(verbosity=2)
