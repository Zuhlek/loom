#!/usr/bin/env python3
"""Tests for render-metrics.py.

Two properties carry the weight here:

1. **Fixed shape.** `metrics.md` is meant to be diffable across runs, so
   two runs must differ only in their numbers — never in which sections or
   rows exist. Most of these tests assert on the zero-data render, because
   that is where a conditional would show itself.
2. **Valid mermaid.** A malformed fence renders as a red error box in the
   loom UI, and the degenerate inputs (empty run, all-zero costs) are
   exactly the ones a hand-written renderer gets wrong.
"""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RENDER = _load("render_metrics", "render-metrics.py")

SECTIONS = ["## Run totals", "## Cost by phase", "## Cost share",
            "## Cache efficiency", "## Per-phase detail", "## Outcome",
            "## Crashed invocations"]


def _row(phase: str, *, cost: float = 1.0, wall: int = 1000,
         autonomous: int = 900, agent_kind: str = "subagent",
         tokens: dict | None = None, status: str = "ok",
         quality: dict | None = None, model: str = "claude-opus-4-7") -> dict:
    return {
        "schema_version": 2,
        "phase": phase,
        "phase_source": "sidecar",
        "agent_kind": agent_kind,
        "agent_label": f"{phase} agent",
        "model": model,
        "tokens": tokens if tokens is not None else {
            "input_tokens": 10, "output_tokens": 100,
            "cache_creation_input_tokens": 50, "cache_read_input_tokens": 500,
        },
        "cost_usd": cost,
        "duration_wall_ms": wall,
        "duration_autonomous_ms": autonomous,
        "status": status,
        "quality": quality if quality is not None else {
            "error_results": 0, "read_errors": 0, "bash_failures": 0,
        },
    }


class RenderCaseMixin:
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="render-metrics-"))
        self.loom = self.tmp / ".loom"
        self.project_dir = self.loom / "proj"
        self.project_dir.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_rows(self, rows: list[dict]) -> None:
        (self.project_dir / "usage.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")

    def render(self) -> str:
        return RENDER.aggregate("proj", self.loom)

    def cells(self, prefix: str, md: str | None = None) -> list[str]:
        """Cells of the first table row starting with `prefix`. The rendered
        tables are horizontal now, so assertions read a row, not a label."""
        text = self.render() if md is None else md
        line = [l for l in text.splitlines() if l.startswith(prefix)][0]
        return [c.strip() for c in line.strip("|").split("|")]

    def totals(self, md: str | None = None) -> list[str]:
        return self.cells("| $", md)


class FixedShapeTests(RenderCaseMixin, unittest.TestCase):
    def test_all_sections_present_with_no_data_at_all(self) -> None:
        md = self.render()
        for section in SECTIONS:
            self.assertIn(section, md, msg=f"{section} must render unconditionally")

    def test_section_order_is_identical_empty_vs_populated(self) -> None:
        empty_order = re.findall(r"^## .+$", self.render(), re.MULTILINE)
        self.write_rows([_row(p) for p in RENDER.BUCKETS])
        full_order = re.findall(r"^## .+$", self.render(), re.MULTILINE)
        self.assertEqual(empty_order, full_order)
        self.assertEqual(empty_order, SECTIONS)

    def test_all_six_buckets_render_as_rows_when_empty(self) -> None:
        md = self.render()
        detail = md.split("## Per-phase detail")[1].split("## Outcome")[0]
        for bucket in RENDER.BUCKETS:
            self.assertTrue(re.search(rf"^\| {bucket} \|", detail, re.MULTILINE),
                            msg=bucket)

    def test_zero_is_rendered_as_zero_not_a_dash(self) -> None:
        detail = self.render().split("## Per-phase detail")[1].split("## Outcome")[0]
        spec_row = [l for l in detail.splitlines() if l.startswith("| spec |")][0]
        self.assertNotIn("—", spec_row)
        self.assertIn("$0.00", spec_row)

    def test_row_count_is_stable_across_runs(self) -> None:
        def detail_rows(md: str) -> int:
            block = md.split("## Per-phase detail")[1].split("## Outcome")[0]
            return len([l for l in block.splitlines() if l.startswith("| ")])

        empty = detail_rows(self.render())
        self.write_rows([_row("build", cost=5.0)])
        partial = detail_rows(self.render())
        self.write_rows([_row(p) for p in RENDER.BUCKETS])
        full = detail_rows(self.render())
        self.assertEqual(empty, partial)
        self.assertEqual(partial, full)

    def test_unexpected_phase_appends_after_the_six(self) -> None:
        self.write_rows([_row("build"), _row("mystery")])
        detail = self.render().split("### Cost & time")[1].split("### Tokens")[0]
        rows = [l.split("|")[1].strip() for l in detail.splitlines()
                if l.startswith("| ") and not l.startswith("| ---")][1:]  # drop header
        self.assertEqual(rows[:6], list(RENDER.BUCKETS))
        self.assertEqual(rows[6], "mystery",
                         msg="attribution gaps must stay visible, not be folded away")
        self.assertEqual(rows[7], "**Total**")

    def test_every_data_table_ends_in_a_totals_row(self) -> None:
        self.write_rows([_row(p) for p in RENDER.BUCKETS])
        blocks = ["### Cost & time", "### Tokens & quality", "## Crashed invocations"]
        md = self.render()
        for block in blocks:
            rows = [l for l in md.split(block)[1].split("\n##")[0].splitlines()
                    if l.startswith("| ")]
            self.assertTrue(rows[-1].startswith("| **Total** |"), msg=block)

    def test_numbers_are_formatted_for_a_reader(self) -> None:
        self.write_rows([_row("build", cost=1234.5, wall=7_265_000,
                              autonomous=3_600_000, tokens={
                                  "input_tokens": 0, "output_tokens": 1234567,
                                  "cache_creation_input_tokens": 0,
                                  "cache_read_input_tokens": 0})])
        totals = self.totals()
        self.assertEqual(totals[0], "$1,234.50")
        self.assertEqual(totals[1], "2h 01m")
        self.assertEqual(totals[2], "1h 00m")
        self.assertEqual(totals[5], "1,234,567")

    def test_sub_minute_durations_keep_a_decimal(self) -> None:
        self.write_rows([_row("build", wall=2737)])
        self.assertEqual(self.totals()[1], "2.7s")

    def test_crashed_table_header_renders_with_no_crashes(self) -> None:
        block = self.render().split("## Crashed invocations")[1]
        self.assertIn("| Phase | Agent | Wall |", block)
        self.assertIn("| **Total** | 0 | 0.0s |", block)
        self.assertNotIn("none", block.lower())

    def test_crashed_row_excluded_from_phase_totals(self) -> None:
        self.write_rows([
            _row("build", cost=2.0),
            _row("build", cost=0.0, status="crashed", tokens=None, quality=None),
        ])
        md = self.render()
        crashed = md.split("## Crashed invocations")[1]
        self.assertIn("| build | build agent | 1.0s |", crashed)
        self.assertIn("| **Total** | 1 | 1.0s |", crashed)
        detail = md.split("## Per-phase detail")[1].split("## Outcome")[0]
        build_row = [l for l in detail.splitlines() if l.startswith("| build |")][0]
        self.assertIn("$2.00", build_row)

    def test_no_prose_lines_anywhere(self) -> None:
        """Every non-blank line is a heading, a table row, or inside a fence."""
        self.write_rows([_row(p) for p in RENDER.BUCKETS])
        in_fence = False
        for line in self.render().splitlines():
            if line.startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence or not line.strip():
                continue
            self.assertTrue(
                line.startswith("#") or line.startswith("|"),
                msg=f"prose line leaked into metrics.md: {line!r}",
            )


class MermaidValidityTests(RenderCaseMixin, unittest.TestCase):
    def _fences(self, md: str) -> list[list[str]]:
        blocks, current = [], None
        for line in md.splitlines():
            if line.startswith("```mermaid"):
                current = []
            elif line.startswith("```") and current is not None:
                blocks.append(current)
                current = None
            elif current is not None:
                current.append(line)
        return blocks

    def test_three_fences_always_present(self) -> None:
        self.assertEqual(len(self._fences(self.render())), 3)
        self.write_rows([_row(p) for p in RENDER.BUCKETS])
        self.assertEqual(len(self._fences(self.render())), 3)

    def test_fences_are_balanced(self) -> None:
        self.assertEqual(self.render().count("```") % 2, 0)

    def test_bar_chart_axis_never_collapses_to_zero(self) -> None:
        """A `0 --> 0` y-axis is what mermaid chokes on."""
        for fence in self._fences(self.render()):
            axis = [l for l in fence if l.strip().startswith("y-axis")]
            if not axis:
                continue
            top = float(axis[0].strip().rsplit("-->", 1)[1])
            self.assertGreater(top, 0.0)

    def test_bar_series_length_matches_axis_length(self) -> None:
        self.write_rows([_row("build", cost=5.0)])
        for fence in self._fences(self.render()):
            xs = [l for l in fence if l.strip().startswith("x-axis")]
            bars = [l for l in fence if l.strip().startswith("bar")]
            if not xs or not bars:
                continue
            n_x = len(xs[0].split("[")[1].rstrip("]").split(","))
            n_bar = len(bars[0].split("[")[1].rstrip("]").split(","))
            self.assertEqual(n_x, n_bar)

    def test_pie_falls_back_to_placeholder_when_total_is_zero(self) -> None:
        """Mermaid divides by the slice total; all-zero would be a div/0."""
        pie = [f for f in self._fences(self.render()) if any("pie" in l for l in f)]
        pie += [f for f in self._fences(self.render())
                if any(l.strip().startswith('"') for l in f)]
        body = "\n".join(self._fences(self.render())[1])
        self.assertIn("no cost recorded", body)

    def test_pie_keeps_all_slices_when_any_cost_exists(self) -> None:
        self.write_rows([_row("build", cost=5.0)])
        body = "\n".join(self._fences(self.render())[1])
        for bucket in RENDER.BUCKETS:
            self.assertIn(f'"{bucket}"', body,
                          msg="legend must be the same six entries every run")


class TotalsTests(RenderCaseMixin, unittest.TestCase):
    def test_cost_and_tokens_add_across_buckets(self) -> None:
        self.write_rows([_row("build", cost=2.0), _row("review", cost=3.0)])
        totals = self.totals()
        self.assertEqual(totals[0], "$5.00")
        self.assertEqual(totals[5], "200")

    def test_run_totals_and_the_detail_totals_row_agree(self) -> None:
        """Two places print the same figures; a drift between them is the
        failure this file exists to prevent."""
        self.write_rows([_row("build", cost=2.0),
                         _row("orchestrator", cost=3.0, wall=9000,
                              agent_kind="orchestrator")])
        md = self.render()
        run = self.totals(md.split("## Cost by phase")[0])
        detail = self.cells("| **Total** |", md.split("### Cost & time")[1])
        self.assertEqual(detail[1], run[0])  # cost
        self.assertEqual(detail[3], run[1])  # wall
        self.assertEqual(detail[4], run[2])  # autonomous

    def test_wall_is_the_orchestrator_span_not_a_sum(self) -> None:
        """The orchestrator span encloses every subagent span it dispatched;
        adding them counts the run twice."""
        self.write_rows([
            _row("build", wall=1000),
            _row("review", wall=2000),
            _row("orchestrator", wall=5000, agent_kind="orchestrator"),
        ])
        self.assertEqual(self.totals()[1], "5.0s")

    def test_wall_falls_back_to_sum_without_an_orchestrator_row(self) -> None:
        self.write_rows([_row("build", wall=1000), _row("review", wall=2000)])
        self.assertEqual(self.totals()[1], "3.0s")

    def test_autonomous_excludes_the_orchestrator(self) -> None:
        self.write_rows([
            _row("build", autonomous=900),
            _row("orchestrator", autonomous=4000, agent_kind="orchestrator"),
        ])
        self.assertEqual(self.totals()[2], "0.9s")

    def test_coverage_reports_whether_the_orchestrator_was_measured(self) -> None:
        self.write_rows([_row("build")])
        self.assertIn("| phase agents only |", self.render())
        self.write_rows([_row("build"),
                         _row("orchestrator", agent_kind="orchestrator")])
        self.assertIn("| 5 phase agents + orchestrator |", self.render())

    def test_cache_hit_rate_is_read_over_all_context_entry(self) -> None:
        self.write_rows([_row("build", tokens={
            "input_tokens": 100, "output_tokens": 0,
            "cache_creation_input_tokens": 100, "cache_read_input_tokens": 800,
        })])
        self.assertEqual(self.totals()[3], "80.0%")


class UnpricedRowTests(RenderCaseMixin, unittest.TestCase):
    """`cost_usd: null` means "no pricing entry for this model", not "free".
    Folded silently into the sum it renders as a confident 0.0000 and the
    file reports the whole run as costless."""

    def test_unpriced_rows_are_counted_in_run_totals(self) -> None:
        self.write_rows([
            _row("spec", cost=None, model="claude-unknown-9"),
            _row("build", cost=2.5),
        ])
        self.assertEqual(self.cells("| claude-")[-1], "1")

    def test_unpriced_count_appears_per_phase(self) -> None:
        self.write_rows([_row("spec", cost=None, model="claude-unknown-9")])
        tokens = self.render().split("### Tokens & quality")[1]
        detail = [l for l in tokens.splitlines() if l.startswith("| spec |")][0]
        self.assertTrue(detail.rstrip().endswith("| 1 |"),
                        msg=f"spec row should carry unpriced=1: {detail}")

    def test_zero_when_everything_is_priced(self) -> None:
        self.write_rows([_row("spec", cost=1.0), _row("build", cost=2.0)])
        self.assertEqual(self.cells("| claude-")[-1], "0")
        self.assertEqual(self.totals()[0], "$3.00")


class OutcomeSectionTests(RenderCaseMixin, unittest.TestCase):
    def test_outcome_fields_render_as_dashes_when_file_missing(self) -> None:
        block = self.render().split("## Outcome")[1]
        self.assertIn("| — | — | — | — / — |", block)

    def test_outcome_fields_populate_from_outcome_json(self) -> None:
        (self.project_dir / "outcome.json").write_text(json.dumps({
            "lifecycle_state": "complete",
            "final_phase": "review",
            "review_verdict": {"status": "PASS", "blockers": 0, "major": 1,
                               "minor": 2, "note": 1},
            "tasks": {"planned": 7, "done": 7},
        }), encoding="utf-8")
        block = self.render().split("## Outcome")[1]
        self.assertIn("| complete | review | PASS | 7 / 7 |", block)
        self.assertIn("| 0 | 1 | 2 | 1 |", block)

    def test_corrupt_outcome_json_degrades_to_dashes(self) -> None:
        (self.project_dir / "outcome.json").write_text("{broken", encoding="utf-8")
        self.assertIn("| — | — | — | — / — |", self.render().split("## Outcome")[1])


class WriteTests(RenderCaseMixin, unittest.TestCase):
    def test_main_writes_metrics_md(self) -> None:
        self.write_rows([_row("build", cost=1.5)])
        RENDER.main(["proj", "--loom-root", str(self.loom)])
        written = (self.project_dir / "metrics.md").read_text(encoding="utf-8")
        self.assertTrue(written.startswith("# Metrics — proj"))
        self.assertEqual(self.totals(written)[0], "$1.50")

    def test_malformed_usage_line_does_not_lose_the_rest(self) -> None:
        (self.project_dir / "usage.jsonl").write_text(
            json.dumps(_row("build", cost=2.0)) + "\n"
            + "{not json\n"
            + json.dumps(_row("review", cost=1.0)) + "\n",
            encoding="utf-8")
        self.assertEqual(self.totals()[0], "$3.00")


if __name__ == "__main__":
    unittest.main(verbosity=2)
