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


class QualityCountsTests(unittest.TestCase):
    def _tool_use(self, tool_use_id: str, name: str) -> dict:
        return {
            "type": "assistant",
            "timestamp": "2026-05-16T10:00:01Z",
            "message": {
                "content": [
                    {"type": "tool_use", "id": tool_use_id, "name": name, "input": {}}
                ],
                "usage": {
                    "input_tokens": 1, "output_tokens": 1,
                    "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
                },
            },
        }

    def _tool_result(self, tool_use_id: str, *, is_error: bool, text: str) -> dict:
        return {
            "type": "user",
            "timestamp": "2026-05-16T10:00:02Z",
            "message": {
                "content": [
                    {"type": "tool_result", "tool_use_id": tool_use_id,
                     "is_error": is_error, "content": text}
                ]
            },
        }

    def test_zero_counts_for_empty_rows(self) -> None:
        self.assertEqual(
            HARVEST.quality_counts([]),
            {"error_results": 0, "read_errors": 0, "bash_failures": 0},
        )

    def test_mixed_tool_errors_counted_per_tool(self) -> None:
        rows = [
            self._tool_use("u1", "Read"),
            self._tool_result("u1", is_error=True, text="File does not exist."),
            self._tool_use("u2", "Bash"),
            self._tool_result("u2", is_error=True, text="Exit code 1\nboom"),
            self._tool_use("u3", "Bash"),
            self._tool_result("u3", is_error=False, text="ok"),
            self._tool_use("u4", "Edit"),
            self._tool_result("u4", is_error=True, text="<tool_use_error>not found</tool_use_error>"),
            self._tool_use("u5", "Read"),
            self._tool_result("u5", is_error=True, text="permission denied"),
        ]
        self.assertEqual(
            HARVEST.quality_counts(rows),
            {"error_results": 4, "read_errors": 2, "bash_failures": 1},
        )

    def test_is_error_without_known_tool_still_counted_as_error(self) -> None:
        rows = [
            self._tool_result("missing-id", is_error=True, text="orphan"),
        ]
        self.assertEqual(
            HARVEST.quality_counts(rows),
            {"error_results": 1, "read_errors": 0, "bash_failures": 0},
        )


class HarvestQualityIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harvest-quality-"))
        self.projects_root = self.tmp / "projects"
        self.cwd = Path("/repo/loom")
        encoded = HARVEST.encode_cwd_for_projects_dir(self.cwd)
        self.session_id = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
        self.subagents_dir = self.projects_root / encoded / self.session_id / "subagents"
        self.subagents_dir.mkdir(parents=True)
        self.workspace = self.tmp / "workspace"
        self.workspace.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_full_transcript(self, transcript: Path) -> None:
        rows = [
            {"type": "user", "timestamp": "2026-05-16T10:00:00Z",
             "message": {"content": [{"type": "text", "text": "dispatch"}]}},
            {"type": "assistant", "timestamp": "2026-05-16T10:00:01Z",
             "message": {"content": [
                 {"type": "tool_use", "id": "u1", "name": "Bash", "input": {}}
             ], "usage": {
                 "input_tokens": 10, "output_tokens": 5,
                 "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
             }}},
            {"type": "user", "timestamp": "2026-05-16T10:00:02Z",
             "message": {"content": [
                 {"type": "tool_result", "tool_use_id": "u1",
                  "is_error": True, "content": "Exit code 1\nfail"}
             ]}},
        ]
        with transcript.open("w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")

    def test_ok_row_carries_quality_block(self) -> None:
        transcript = self.subagents_dir / "agent-1.jsonl"
        self._write_full_transcript(transcript)
        _write_phase_sidecar(transcript, phase="build")
        summary = HARVEST.harvest(
            project="any", workspace=self.workspace,
            projects_root=self.projects_root, cwd=self.cwd,
            dry_run=False, session_id=self.session_id,
        )
        row = summary["rows"][0]
        self.assertEqual(row["status"], "ok")
        self.assertEqual(row["quality"],
                         {"error_results": 1, "read_errors": 0, "bash_failures": 1})

        usage_path = self.workspace / "usage.jsonl"
        self.assertTrue(usage_path.exists())
        first_line = usage_path.read_text(encoding="utf-8").splitlines()[0]
        parsed = json.loads(first_line)
        self.assertIn("quality", parsed)
        self.assertEqual(parsed["quality"]["bash_failures"], 1)

    def test_untagged_row_still_carries_quality(self) -> None:
        transcript = self.subagents_dir / "agent-2.jsonl"
        self._write_full_transcript(transcript)
        summary = HARVEST.harvest(
            project="any", workspace=self.workspace,
            projects_root=self.projects_root, cwd=self.cwd,
            dry_run=True, session_id=self.session_id,
        )
        row = summary["rows"][0]
        self.assertEqual(row["status"], "untagged")
        self.assertEqual(row["quality"],
                         {"error_results": 1, "read_errors": 0, "bash_failures": 1})

    def test_crashed_row_has_quality_null(self) -> None:
        transcript = self.subagents_dir / "agent-3.jsonl"
        rows = [
            {"type": "user", "timestamp": "2026-05-16T10:00:00Z",
             "message": {"content": [{"type": "text", "text": "dispatch"}]}},
        ]
        with transcript.open("w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")
        _write_phase_sidecar(transcript, phase="build")
        summary = HARVEST.harvest(
            project="any", workspace=self.workspace,
            projects_root=self.projects_root, cwd=self.cwd,
            dry_run=True, session_id=self.session_id,
        )
        row = summary["rows"][0]
        self.assertEqual(row["status"], "crashed")
        self.assertIsNone(row["quality"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
