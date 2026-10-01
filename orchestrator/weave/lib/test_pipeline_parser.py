#!/usr/bin/env python3
"""Lifecycle walk over the pipeline-parser CLI: init -> advance x4 -> block -> rerun -> goback -> complete."""
import importlib.util
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

    print("ok")


if __name__ == "__main__":
    run()
