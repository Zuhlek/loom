#!/usr/bin/env python3
"""Tests for transcript-harvest.py: the `--session UUID` bypass, phase
attribution, quality counting, and orchestrator-row emission.

`.session-pointer` is how a refresh finds the right Claude Code sessions
for a project. Without `--session`, the harvester falls back to matching
`<project>` against transcript dispatch text — fine while the fabric still
mentions `.loom/<project>` somewhere nearby, but the explicit pointer is
the reliable key.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
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


class OrchestratorRowTests(unittest.TestCase):
    """The orchestrator's own session is the largest single cost in a run
    and was invisible until it got its own row. It lives beside the
    subagents dir as `<session>.jsonl`."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harvest-orch-"))
        self.projects_root = self.tmp / "projects"
        self.cwd = Path("/repo/loom")
        encoded = HARVEST.encode_cwd_for_projects_dir(self.cwd)
        self.base = self.projects_root / encoded
        self.session_id = "11111111-1111-1111-1111-111111111111"
        self.subagents_dir = self.base / self.session_id / "subagents"
        self.workspace = self.tmp / "workspace"
        self.workspace.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _harvest(self):
        return HARVEST.harvest(
            project="any", workspace=self.workspace,
            projects_root=self.projects_root, cwd=self.cwd,
            dry_run=True, session_id=self.session_id,
        )

    def test_maps_subagent_transcript_to_session_transcript(self) -> None:
        sub = self.base / self.session_id / "subagents" / "agent-1.jsonl"
        self.assertEqual(
            HARVEST.orchestrator_transcript_for(sub),
            self.base / f"{self.session_id}.jsonl",
        )

    def test_orchestrator_row_emitted_beside_subagent_rows(self) -> None:
        transcript = self.subagents_dir / "agent-1.jsonl"
        _write_transcript(transcript, input_tokens=100)
        _write_phase_sidecar(transcript, phase="build")
        _write_transcript(self.base / f"{self.session_id}.jsonl", input_tokens=900)

        rows = self._harvest()["rows"]
        self.assertEqual(len(rows), 2)
        orch = [r for r in rows if r["agent_kind"] == "orchestrator"]
        self.assertEqual(len(orch), 1)
        self.assertEqual(orch[0]["phase"], "orchestrator")
        self.assertEqual(orch[0]["phase_source"], "session")
        self.assertEqual(orch[0]["agent_label"], "Weave orchestrator")
        self.assertEqual(orch[0]["status"], "ok")
        self.assertEqual(orch[0]["tokens"]["input_tokens"], 900)

    def test_no_orchestrator_row_when_session_transcript_absent(self) -> None:
        transcript = self.subagents_dir / "agent-1.jsonl"
        _write_transcript(transcript)
        _write_phase_sidecar(transcript, phase="spec")

        rows = self._harvest()["rows"]
        self.assertEqual([r["agent_kind"] for r in rows], ["subagent"],
                         msg="a missing session transcript is skipped, not "
                             "emitted as a crash sentinel")

    def test_orchestrator_row_emitted_once_for_many_subagents(self) -> None:
        for name, phase in (("agent-1.jsonl", "spec"), ("agent-2.jsonl", "build"),
                            ("agent-3.jsonl", "review")):
            t = self.subagents_dir / name
            _write_transcript(t)
            _write_phase_sidecar(t, phase=phase)
        _write_transcript(self.base / f"{self.session_id}.jsonl")

        rows = self._harvest()["rows"]
        self.assertEqual(sum(1 for r in rows if r["agent_kind"] == "orchestrator"), 1)
        self.assertEqual(len(rows), 4)

    def test_row_count_reported_includes_orchestrator(self) -> None:
        transcript = self.subagents_dir / "agent-1.jsonl"
        _write_transcript(transcript)
        _write_phase_sidecar(transcript, phase="plan")
        _write_transcript(self.base / f"{self.session_id}.jsonl")

        summary = self._harvest()
        self.assertEqual(summary["matched"], 1, msg="matched counts subagents")
        self.assertEqual(summary["rows_written"], 2,
                         msg="rows_written counts what actually lands on disk")


def _reminder(project: str, phase: str) -> str:
    return ("<system-reminder>\n"
            f"Active project: {project}\n"
            f"Active phase: {phase}\n"
            "Current task: T-001\n"
            "</system-reminder>")


def _write_stamped_transcript(path: Path, *, project: str, phase: str,
                              input_tokens: int = 100,
                              model: str = "claude-opus-5") -> None:
    """A subagent transcript carrying the dispatch stamp /weave writes, and
    NO `.phase` sidecar — i.e. what a run the hook never saw looks like."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {"type": "user", "timestamp": "2026-05-16T10:00:00Z",
         "message": {"content": [
             {"type": "text", "text": f"# {phase} Phase Agent\n\n{_reminder(project, phase)}"}
         ]}},
        {"type": "assistant", "timestamp": "2026-05-16T10:00:05Z",
         "message": {"model": model, "id": "msg_1", "usage": {
             "input_tokens": input_tokens, "output_tokens": 10,
             "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}},
    ]
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")


class DispatchContextTests(unittest.TestCase):
    """`Active project:` / `Active phase:` land verbatim in the subagent's own
    first user row. Reading them is what makes a transcript self-describing,
    so measurement survives a session the PostToolUse hook never ran in."""

    def test_parses_project_and_phase(self) -> None:
        rows = [{"type": "user", "message": {"content": [
            {"type": "text", "text": "preamble\n" + _reminder("proj-x", "build")}]}}]
        self.assertEqual(HARVEST.read_dispatch_context(rows), ("proj-x", "build"))

    def test_returns_none_without_a_reminder(self) -> None:
        rows = [{"type": "user", "message": {"content": [
            {"type": "text", "text": "just a dispatch"}]}}]
        self.assertEqual(HARVEST.read_dispatch_context(rows), (None, None))

    def test_rejects_a_phase_outside_the_enum(self) -> None:
        rows = [{"type": "user", "message": {"content": [
            {"type": "text", "text": _reminder("proj-x", "deploy")}]}}]
        project, phase = HARVEST.read_dispatch_context(rows)
        self.assertEqual(project, "proj-x")
        self.assertIsNone(phase)


class HookLessSessionTests(unittest.TestCase):
    """The regression this whole path exists for: a /weave run whose session
    never executed the hook. No `.phase` sidecar, no `.session-pointer` entry
    — and before the dispatch stamp was read, no rows at all."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harvest-hookless-"))
        self.projects_root = self.tmp / "projects"
        self.cwd = Path("/repo/loom")
        encoded = HARVEST.encode_cwd_for_projects_dir(self.cwd)
        self.base = self.projects_root / encoded
        self.unseen = "99999999-9999-9999-9999-999999999999"
        self.workspace = self.tmp / "workspace"
        self.workspace.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _harvest(self, session_id=None):
        return HARVEST.harvest(
            project="proj-x", workspace=self.workspace,
            projects_root=self.projects_root, cwd=self.cwd,
            dry_run=True, session_id=session_id,
        )

    def test_stamped_transcript_matches_without_pointer_or_sidecar(self) -> None:
        _write_stamped_transcript(
            self.base / self.unseen / "subagents" / "agent-a1.jsonl",
            project="proj-x", phase="build")
        rows = self._harvest()["rows"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["phase"], "build")
        self.assertEqual(rows[0]["phase_source"], "dispatch")
        self.assertEqual(rows[0]["status"], "ok")

    def test_a_pointer_naming_another_session_does_not_hide_the_run(self) -> None:
        """A pointer that missed the real session must widen, never narrow."""
        _write_stamped_transcript(
            self.base / self.unseen / "subagents" / "agent-a1.jsonl",
            project="proj-x", phase="build")
        rows = self._harvest(session_id="00000000-0000-0000-0000-000000000000")
        self.assertEqual([r["phase"] for r in rows["rows"]], ["build"])

    def test_stamp_for_another_project_is_not_claimed(self) -> None:
        _write_stamped_transcript(
            self.base / self.unseen / "subagents" / "agent-a1.jsonl",
            project="some-other-project", phase="build")
        self.assertEqual(self._harvest()["matched"], 0)

    def test_sidecar_outranks_the_dispatch_stamp(self) -> None:
        t = self.base / self.unseen / "subagents" / "agent-a1.jsonl"
        _write_stamped_transcript(t, project="proj-x", phase="build")
        _write_phase_sidecar(t, phase="review", project="proj-x")
        row = self._harvest()["rows"][0]
        self.assertEqual(row["phase"], "review")
        self.assertEqual(row["phase_source"], "sidecar")

    def test_nested_agent_inherits_phase_from_its_parent(self) -> None:
        subagents = self.base / self.unseen / "subagents"
        _write_stamped_transcript(subagents / "agent-parent1.jsonl",
                                  project="proj-x", phase="spec")
        # A helper the Spec agent spawned: no stamp of its own, only a parent.
        _write_transcript(subagents / "agent-child1.jsonl", mentions_project=None)
        (subagents / "agent-child1.meta.json").write_text(json.dumps(
            {"description": "Research VAT rules", "parentAgentId": "parent1"}),
            encoding="utf-8")

        rows = self._harvest()["rows"]
        child = [r for r in rows if r["phase_source"] == "parent"]
        self.assertEqual(len(child), 1, msg="nested agent should inherit, not go untagged")
        self.assertEqual(child[0]["phase"], "spec")

    def test_parent_cycle_does_not_hang(self) -> None:
        subagents = self.base / self.unseen / "subagents"
        for name, parent in (("a", "b"), ("b", "a")):
            _write_transcript(subagents / f"agent-{name}.jsonl", mentions_project="proj-x")
            (subagents / f"agent-{name}.meta.json").write_text(
                json.dumps({"description": "x", "parentAgentId": parent}),
                encoding="utf-8")
        self.assertEqual(len(self._harvest()["rows"]), 2)


class PricingTests(unittest.TestCase):
    def test_opus_5_is_priced(self) -> None:
        self.assertEqual(HARVEST._pricing_for("claude-opus-5"), (5.0, 25.0))

    def test_context_window_suffix_still_prices(self) -> None:
        """Model ids can carry a `[1m]` suffix; longest-prefix match covers it."""
        self.assertEqual(HARVEST._pricing_for("claude-opus-5[1m]"), (5.0, 25.0))

    def test_unknown_model_yields_none_not_zero(self) -> None:
        usage = {"input_tokens": 1000, "output_tokens": 1000}
        self.assertIsNone(HARVEST._usage_cost_usd(usage, "claude-unknown-9"))


class OutOfOrderTimestampTests(unittest.TestCase):
    """Sidechained and resumed transcripts are not written in timestamp
    order. Reading first/last instead of min/max understated the span — and
    returned 0 whenever the last row predated the first."""

    def _row(self, ts: str, kind: str = "assistant") -> dict:
        return {"type": kind, "timestamp": ts,
                "message": {"usage": {"input_tokens": 1, "output_tokens": 1}}}

    def test_wall_spans_min_to_max_regardless_of_file_order(self) -> None:
        rows = [
            self._row("2026-05-16T10:00:30Z"),
            self._row("2026-05-16T10:00:00Z"),   # earlier row, written later
            self._row("2026-05-16T10:00:10Z"),
        ]
        self.assertEqual(HARVEST._wall_ms_from_rows(rows), 30_000)

    def test_autonomous_never_exceeds_wall_on_shuffled_rows(self) -> None:
        rows = [
            self._row("2026-05-16T10:00:20Z"),
            self._row("2026-05-16T10:00:00Z", "user"),
            self._row("2026-05-16T10:00:10Z"),
        ]
        self.assertLessEqual(HARVEST._autonomous_ms_from_rows(rows),
                             HARVEST._wall_ms_from_rows(rows))


if __name__ == "__main__":
    unittest.main(verbosity=2)
