#!/usr/bin/env python3
"""run-outcome — derive and write a run's `outcome.json` from its fabric.

Single source of truth for the outcome contract (SCHEMA.md § outcome.json):
lifecycle state and final phase from `pipeline.md`, review verdict from
`review-verdict.json` (falling back to the `**PASS|FAIL**` line in
`review.md`), and task counts from `board.md`.

Consumers:
- `analyze.py` imports this module (via importlib) at dashboard time,
- `run-baseline.sh` invokes the CLI after each eval iteration,
- `tag-subagent-phase.py` invokes the CLI after each subagent returns, so
  REGULAR `/weave` runs carry the same artifact as eval runs.

CLI:
  python3 orchestrator/lib/telemetry/run-outcome.py <run-dir>

Writes `<run-dir>/outcome.json` atomically and prints its path.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path


VALID_PHASES_FOR_OUTCOME = {"spec", "design", "plan", "build", "review"}
VALID_LIFECYCLE_STATES = {"active", "complete"}

REVIEW_VERDICT_INLINE_RE = re.compile(
    r"\*\*(PASS|FAIL)\*\*\s*[—–\-]+\s*"
    r"(\d+)\s+Blockers?\b[^0-9]*"
    r"(\d+)\s+Majors?\b[^0-9]*"
    r"(\d+)\s+Minors?\b[^0-9]*"
    r"(\d+)\s+Notes?",
    re.IGNORECASE,
)

REVIEW_STATUS_RE = re.compile(r"\*\*(PASS|FAIL)\*\*", re.IGNORECASE)

REVIEW_COUNT_RES = {
    "blockers": re.compile(r"\*\*Blockers?:?\*\*:?\s*[—–\-]?\s*(\d+)", re.IGNORECASE),
    "major":    re.compile(r"\*\*Majors?:?\*\*:?\s*[—–\-]?\s*(\d+)",   re.IGNORECASE),
    "minor":    re.compile(r"\*\*Minors?:?\*\*:?\s*[—–\-]?\s*(\d+)",   re.IGNORECASE),
    "note":     re.compile(r"\*\*Notes?:?\*\*:?\s*[—–\-]?\s*(\d+)",    re.IGNORECASE),
}

BOARD_SECTION_RE = re.compile(
    r"^## (Backlog|In Progress|Review|Done)\s*$",
    re.MULTILINE,
)

BOARD_TASK_BULLET_RE = re.compile(r"^- T-\d+\b", re.MULTILINE)


def _read_pipeline_block(pipeline_text: str, heading: str) -> str | None:
    """Return the first non-blank line inside the fenced block under
    `## <heading>`, or None if the heading or block is absent."""
    needle = f"## {heading}"
    index = pipeline_text.find(needle)
    if index < 0:
        return None
    rest = pipeline_text[index + len(needle):]
    open_fence = rest.find("```")
    if open_fence < 0:
        return None
    after_open = rest[open_fence + 3:]
    newline = after_open.find("\n")
    if newline < 0:
        return None
    body_start = newline + 1
    close_fence = after_open.find("```", body_start)
    if close_fence < 0:
        return None
    body = after_open[body_start:close_fence]
    for line in body.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return None


def _parse_review_verdict(review_text: str) -> dict | None:
    inline = REVIEW_VERDICT_INLINE_RE.search(review_text)
    if inline is not None:
        return {
            "status": inline.group(1).upper(),
            "blockers": int(inline.group(2)),
            "major": int(inline.group(3)),
            "minor": int(inline.group(4)),
            "note": int(inline.group(5)),
        }
    status_match = REVIEW_STATUS_RE.search(review_text)
    if status_match is None:
        return None
    counts: dict[str, int] = {}
    for name, pattern in REVIEW_COUNT_RES.items():
        match = pattern.search(review_text)
        if match is None:
            return None
        counts[name] = int(match.group(1))
    return {"status": status_match.group(1).upper(), **counts}


def _parse_board_tasks(board_text: str) -> dict | None:
    section_matches = list(BOARD_SECTION_RE.finditer(board_text))
    if not section_matches:
        return None
    counts: dict[str, int] = {}
    for index, match in enumerate(section_matches):
        name = match.group(1)
        section_start = match.end()
        section_end = (section_matches[index + 1].start()
                       if index + 1 < len(section_matches) else len(board_text))
        section_body = board_text[section_start:section_end]
        counts[name] = len(BOARD_TASK_BULLET_RE.findall(section_body))
    planned = sum(counts.values())
    if planned == 0:
        return None
    return {"planned": planned, "done": counts.get("Done", 0)}


def _read_text_or_empty(path: Path) -> str:
    if not path.is_file():
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def _normalise_review_verdict(data: dict) -> dict | None:
    status = data.get("verdict") or data.get("status")
    if not isinstance(status, str):
        return None
    status_upper = status.upper()
    if status_upper not in {"PASS", "FAIL"}:
        return None
    out = {"status": status_upper}
    for key in ("blockers", "major", "minor", "note"):
        value = data.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            return None
        out[key] = value
    return out


def _read_review_verdict(run_dir: Path) -> dict | None:
    sidecar = run_dir / "review-verdict.json"
    if sidecar.is_file():
        try:
            data = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = None
        if isinstance(data, dict):
            verdict = _normalise_review_verdict(data)
            if verdict is not None:
                return verdict
    review_text = _read_text_or_empty(run_dir / "review.md")
    return _parse_review_verdict(review_text) if review_text else None


def derive_outcome(run_dir: Path) -> dict:
    pipeline_path = run_dir / "pipeline.md"
    pipeline_present = pipeline_path.is_file()
    lifecycle_state = "active"
    final_phase: str | None = None
    if pipeline_present:
        text = _read_text_or_empty(pipeline_path)
        raw_lifecycle = _read_pipeline_block(text, "Lifecycle state")
        if isinstance(raw_lifecycle, str):
            candidate = raw_lifecycle.lower()
            if candidate in VALID_LIFECYCLE_STATES:
                lifecycle_state = candidate
        raw_phase = _read_pipeline_block(text, "Current phase")
        if isinstance(raw_phase, str):
            candidate = raw_phase.lower()
            if candidate in VALID_PHASES_FOR_OUTCOME:
                final_phase = candidate

    board_text = _read_text_or_empty(run_dir / "board.md")

    return {
        "lifecycle_state": lifecycle_state,
        "final_phase": final_phase,
        "review_findings_present": (run_dir / "review.md").is_file(),
        "pipeline_md_present": pipeline_present,
        "review_verdict": _read_review_verdict(run_dir),
        "tasks": _parse_board_tasks(board_text) if board_text else None,
    }


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_outcome(run_dir: Path) -> Path:
    payload = derive_outcome(run_dir)
    out_path = run_dir / "outcome.json"
    atomic_write_text(out_path, json.dumps(payload, indent=2) + "\n")
    return out_path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Derive and write <run-dir>/outcome.json")
    ap.add_argument("run_dir", help="Run directory (e.g. .loom/<project>/ or "
                                    "analytics/<version>/<run-id>/)")
    args = ap.parse_args(argv)
    run_dir = Path(args.run_dir)
    if not run_dir.is_dir():
        print(f"run-outcome: not a directory: {run_dir}")
        return 2
    out = write_outcome(run_dir)
    print(str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
