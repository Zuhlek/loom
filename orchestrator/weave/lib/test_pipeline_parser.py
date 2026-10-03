#!/usr/bin/env python3
"""Lifecycle walks over the pipeline-parser CLI: full (init -> advance x4 -> block -> rerun -> goback -> complete), quick (init -> complete | escalate), legacy pipeline.md without Mode."""
import importlib.util
import re
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("pp", Path(__file__).parent / "pipeline-parser.py")
pp = importlib.util.module_from_spec(spec)
sys.modules["pp"] = pp
spec.loader.exec_module(pp)


def run() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        parent = Path(tmp)
        pp.init_workspace(parent, "demo", "a seed", "T-1", "core", "local")
        ws = parent / ".loom" / "demo"
        pipeline = ws / "pipeline.md"

        record = pp.parse(pipeline)
        assert pp.validate_record(record) == []
        assert record["Current phase"] == "spec"
        assert record["Develop-log"] == "local"
        assert record["Mode"] == "full"

        for expected in ("design", "plan", "build", "review"):
            pp.cmd_advance(pipeline)
            assert pp.parse(pipeline)["Current phase"] == expected

        pp.cmd_block(pipeline, "which env?")
        record = pp.parse(pipeline)
        assert record["Phase status"] == "blocked"
        assert record["Pending user input"] == "which env?"

        pp.cmd_rerun(pipeline)
        record = pp.parse(pipeline)
        assert record["Phase status"] == "Pending"
        assert record["Pending user input"] == ""

        (ws / "review.md").write_text("x", encoding="utf-8")
        (ws / "build-report.md").write_text("x", encoding="utf-8")
        (ws / "plan.md").write_text("x", encoding="utf-8")
        pp.cmd_goback(pipeline, "plan")
        record = pp.parse(pipeline)
        assert record["Current phase"] == "plan"
        archived = list((ws / "superseded").rglob("*.md"))
        assert sorted(p.name for p in archived) == ["build-report.md", "review.md"]
        assert (ws / "plan.md").exists()

        pp.cmd_advance(pipeline)
        pp.cmd_advance(pipeline)
        pp.cmd_complete(pipeline)
        record = pp.parse(pipeline)
        assert record["Lifecycle state"] == "complete"
        assert record["Phase status"] == "complete"
        assert pp.validate_record(record) == []

        try:
            pp.cmd_advance(pipeline)
            raise AssertionError("advance after complete must fail")
        except SystemExit:
            pass

        # Quick mode: single gateless phase, complete directly.
        pp.init_workspace(parent, "q1", "fix typo", "", "", "local", "quick")
        q1 = parent / ".loom" / "q1" / "pipeline.md"
        record = pp.parse(q1)
        assert pp.validate_record(record) == []
        assert record["Mode"] == "quick"
        assert record["Current phase"] == "quick"

        try:
            pp.cmd_advance(q1)
            raise AssertionError("advance in quick mode must fail")
        except SystemExit:
            pass

        pp.cmd_block(q1, "which file?")
        assert pp.parse(q1)["Phase status"] == "blocked"
        pp.cmd_rerun(q1)
        pp.cmd_complete(q1)
        record = pp.parse(q1)
        assert record["Lifecycle state"] == "complete"
        assert record["Current phase"] == "quick"

        # Escalate: quick -> full at spec, quick artifacts archived.
        pp.init_workspace(parent, "q2", "looked simple", "", "", "local", "quick")
        q2ws = parent / ".loom" / "q2"
        q2 = q2ws / "pipeline.md"
        (q2ws / "build-report.md").write_text("x", encoding="utf-8")

        try:
            pp.cmd_goback(q2, "spec")
            raise AssertionError("goback in quick mode must fail")
        except SystemExit:
            pass

        pp.cmd_escalate(q2)
        record = pp.parse(q2)
        assert pp.validate_record(record) == []
        assert record["Mode"] == "full"
        assert record["Current phase"] == "spec"
        assert not (q2ws / "build-report.md").exists()
        assert [p.name for p in (q2ws / "superseded").rglob("*.md")] == ["build-report.md"]

        try:
            pp.cmd_escalate(q2)
            raise AssertionError("escalate in full mode must fail")
        except SystemExit:
            pass

        # Legacy pipeline.md without a Mode section parses as full mode.
        legacy = q2ws / "legacy.md"
        text = q2.read_text(encoding="utf-8")
        legacy.write_text(re.sub(r"(?ms)^## Mode\n.*?(?=^## )", "", text), encoding="utf-8")
        record = pp.parse(legacy)
        assert record["Mode"] == ""
        assert pp.validate_record(record) == []
        assert pp.phase_sequence(record) == pp.PHASES

    print("ok")


if __name__ == "__main__":
    run()
