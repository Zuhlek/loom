#!/usr/bin/env python3
"""check-usage-jsonl — validate a usage.jsonl file against SCHEMA.md.

Exit zero on conformance. Exit non-zero with the offending row(s)
printed to stderr on any violation.

Usage:
  python3 orchestrator/evaluation/check-usage-jsonl.py <path> [<path>...]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


VALID_PHASES = {"spec", "design", "plan", "build", "review"}
VALID_AGENT_KINDS = {"subagent"}
VALID_STATUSES = {"ok", "crashed", "untagged"}
VALID_LIFECYCLE_STATES = {"active", "complete"}
TOKEN_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)
QUALITY_KEYS = ("error_results", "read_errors", "bash_failures")
CANONICAL_LABEL = {phase: f"{phase.capitalize()} phase agent" for phase in VALID_PHASES}


def validate_row(row: dict) -> list[str]:
    violations: list[str] = []

    status = row.get("status")
    if status not in VALID_STATUSES:
        violations.append(
            f"status must be one of {sorted(VALID_STATUSES)}; got {status!r}"
        )

    phase = row.get("phase")
    if status == "untagged":
        if phase is not None:
            violations.append("phase must be null when status is untagged")
    else:
        if not isinstance(phase, str) or phase not in VALID_PHASES:
            violations.append(
                f"phase must be one of {sorted(VALID_PHASES)} when status is {status!r}; "
                f"got {phase!r}"
            )

    agent_kind = row.get("agent_kind")
    if agent_kind not in VALID_AGENT_KINDS:
        violations.append(
            f"agent_kind must be one of {sorted(VALID_AGENT_KINDS)}; got {agent_kind!r}"
        )

    agent_label = row.get("agent_label")
    if isinstance(phase, str) and phase in VALID_PHASES:
        expected_label = CANONICAL_LABEL[phase]
        if agent_label != expected_label:
            violations.append(
                f"agent_label must be {expected_label!r} for phase={phase!r}; "
                f"got {agent_label!r}"
            )
    elif status == "untagged":
        if agent_label != "unknown-agent":
            violations.append(
                f"agent_label must be 'unknown-agent' when status is untagged; got {agent_label!r}"
            )
    elif not isinstance(agent_label, str):
        violations.append(f"agent_label must be a string; got {agent_label!r}")

    tokens = row.get("tokens")
    if status == "crashed":
        if tokens is not None:
            violations.append("tokens must be null when status is crashed")
    else:
        if not isinstance(tokens, dict):
            violations.append(
                f"tokens must be an object when status is {status!r}; got {type(tokens).__name__}"
            )
        else:
            for token_key in TOKEN_KEYS:
                value = tokens.get(token_key)
                if not isinstance(value, int) or isinstance(value, bool):
                    violations.append(
                        f"tokens.{token_key} must be an int; got {value!r}"
                    )
                elif value < 0:
                    violations.append(f"tokens.{token_key} must be >= 0; got {value}")
            unexpected = set(tokens.keys()) - set(TOKEN_KEYS)
            if unexpected:
                violations.append(f"tokens has unexpected keys: {sorted(unexpected)}")

    wall = row.get("duration_wall_ms")
    if not isinstance(wall, int) or isinstance(wall, bool) or wall < 0:
        violations.append(f"duration_wall_ms must be an int >= 0; got {wall!r}")

    autonomous = row.get("duration_autonomous_ms")
    if status == "crashed":
        if autonomous is not None:
            violations.append("duration_autonomous_ms must be null when status is crashed")
    else:
        if not isinstance(autonomous, int) or isinstance(autonomous, bool) or autonomous < 0:
            violations.append(
                f"duration_autonomous_ms must be an int >= 0 when status is {status!r}; "
                f"got {autonomous!r}"
            )

    if "quality" not in row:
        violations.append("quality field is required")
    else:
        quality = row.get("quality")
        if status == "crashed":
            if quality is not None:
                violations.append("quality must be null when status is crashed")
        else:
            if not isinstance(quality, dict):
                violations.append(
                    f"quality must be an object when status is {status!r}; "
                    f"got {type(quality).__name__}"
                )
            else:
                for quality_key in QUALITY_KEYS:
                    value = quality.get(quality_key)
                    if not isinstance(value, int) or isinstance(value, bool):
                        violations.append(
                            f"quality.{quality_key} must be an int; got {value!r}"
                        )
                    elif value < 0:
                        violations.append(f"quality.{quality_key} must be >= 0; got {value}")
                unexpected = set(quality.keys()) - set(QUALITY_KEYS)
                if unexpected:
                    violations.append(f"quality has unexpected keys: {sorted(unexpected)}")

    return violations


def validate_outcome(payload: dict) -> list[str]:
    violations: list[str] = []
    expected_keys = {"lifecycle_state", "final_phase",
                     "review_findings_present", "pipeline_md_present"}
    unexpected = set(payload.keys()) - expected_keys
    if unexpected:
        violations.append(f"outcome has unexpected keys: {sorted(unexpected)}")

    lifecycle = payload.get("lifecycle_state")
    if lifecycle not in VALID_LIFECYCLE_STATES:
        violations.append(
            f"lifecycle_state must be one of {sorted(VALID_LIFECYCLE_STATES)}; "
            f"got {lifecycle!r}"
        )

    final_phase = payload.get("final_phase")
    if final_phase is not None and final_phase not in VALID_PHASES:
        violations.append(
            f"final_phase must be one of {sorted(VALID_PHASES)} or null; "
            f"got {final_phase!r}"
        )

    for flag in ("review_findings_present", "pipeline_md_present"):
        value = payload.get(flag)
        if not isinstance(value, bool):
            violations.append(f"{flag} must be a bool; got {value!r}")

    return violations


def validate_file(path: Path) -> list[tuple[int, dict | str, list[str]]]:
    failures: list[tuple[int, dict | str, list[str]]] = []
    if not path.exists():
        failures.append((0, str(path), [f"file does not exist: {path}"]))
        return failures
    text = path.read_text(encoding="utf-8", errors="replace")
    line_number = 0
    saw_any_row = False
    for line in text.splitlines():
        line_number += 1
        stripped = line.strip()
        if not stripped:
            continue
        try:
            row = json.loads(stripped)
        except json.JSONDecodeError as exc:
            failures.append((line_number, stripped, [f"invalid JSON: {exc}"]))
            continue
        if not isinstance(row, dict):
            failures.append((line_number, stripped, ["row is not a JSON object"]))
            continue
        saw_any_row = True
        violations = validate_row(row)
        if violations:
            failures.append((line_number, row, violations))
    if not saw_any_row:
        failures.append((0, str(path), ["no rows present"]))
    return failures


def validate_outcome_file(path: Path) -> list[str]:
    if not path.exists():
        return [f"file does not exist: {path}"]
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"could not parse JSON: {exc}"]
    if not isinstance(payload, dict):
        return ["outcome.json must be a JSON object"]
    return validate_outcome(payload)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate usage.jsonl against orchestrator/evaluation/SCHEMA.md."
    )
    parser.add_argument("paths", nargs="*", help="One or more usage.jsonl files.")
    parser.add_argument("--outcome", action="append", default=[],
                        help="Validate the given outcome.json file. "
                             "May be repeated.")
    args = parser.parse_args(argv)

    if not args.paths and not args.outcome:
        parser.error("provide at least one usage.jsonl path or --outcome <path>")

    total_failures = 0
    for raw_path in args.paths:
        path = Path(raw_path)
        failures = validate_file(path)
        if not failures:
            print(f"OK  {path}")
            continue
        total_failures += len(failures)
        print(f"FAIL {path}", file=sys.stderr)
        for line_number, row, violations in failures:
            print(f"  line {line_number}: {row!r}", file=sys.stderr)
            for violation in violations:
                print(f"    - {violation}", file=sys.stderr)

    for raw_path in args.outcome:
        path = Path(raw_path)
        outcome_violations = validate_outcome_file(path)
        if not outcome_violations:
            print(f"OK  {path}")
            continue
        total_failures += 1
        print(f"FAIL {path}", file=sys.stderr)
        for violation in outcome_violations:
            print(f"    - {violation}", file=sys.stderr)

    return 1 if total_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
