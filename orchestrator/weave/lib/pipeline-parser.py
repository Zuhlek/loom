#!/usr/bin/env python3
"""pipeline.md CLI. The orchestrator mutates pipeline.md only through this tool."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


SECTION_ORDER = [
    "Project name",
    "Ticket ID",
    "Type hint",
    "Mode",
    "Current phase",
    "Phase status",
    "Lifecycle state",
    "Develop-log",
    "Pending user input",
    "History",
]

PHASES = ["spec", "design", "plan", "build", "review"]
QUICK_PHASES = ["quick"]
# Empty mode = pipeline.md written before the Mode field existed; treated as full.
VALID_MODES = {"", "full", "quick"}
VALID_STATUSES = {"Pending", "blocked", "failed", "complete"}
VALID_LIFECYCLE_STATES = {"active", "complete"}
VALID_DEVELOP_LOG = {"local", "global"}

# Artifacts each phase owns inside the workspace. goback and escalate archive
# these for every superseded phase.
PHASE_ARTIFACTS = {
    "spec": ["spec.md", "decisions.md"],
    "design": ["design.md", "mockup"],
    "plan": ["plan.md"],
    "build": ["build-report.md", "smoke-screenshots"],
    "review": ["review.md"],
    "quick": ["build-report.md", "smoke-screenshots"],
}


@dataclass
class Section:
    name: str
    start: int
    body_start: int
    end: int


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)


def split_sections(text: str) -> dict[str, Section]:
    matches = list(re.finditer(r"(?m)^## ([^\n]+)\n", text))
    sections: dict[str, Section] = {}
    for idx, match in enumerate(matches):
        name = match.group(1).strip()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        sections[name] = Section(name=name, start=match.start(), body_start=match.end(), end=end)
    return sections


def read_body(text: str, section: Section) -> str:
    return text[section.body_start : section.end].strip("\n")


def read_scalar(body: str) -> str:
    # Tolerates the legacy ```text fence around values.
    match = re.search(r"```(?:text)?\n(.*?)\n```", body, flags=re.S)
    return match.group(1).strip() if match else body.strip()


def read_history(body: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped.startswith("- "):
            continue
        parts = stripped[2:].split(None, 3)
        if len(parts) >= 3:
            rows.append({
                "timestamp": parts[0],
                "phase": parts[1],
                "status": parts[2],
                "note": parts[3] if len(parts) > 3 else "",
            })
    return rows


def parse(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    sections = split_sections(text)
    result: dict[str, object] = {}
    for name in SECTION_ORDER:
        section = sections.get(name)
        body = read_body(text, section) if section else ""
        result[name] = read_history(body) if name == "History" else read_scalar(body)
    return result


def replace_field(path: Path, name: str, value: str) -> None:
    text = path.read_text(encoding="utf-8")
    sections = split_sections(text)
    replacement = f"## {name}\n{str(value).strip()}\n"
    section = sections.get(name)
    if section:
        text = text[: section.start] + replacement + text[section.end :]
    else:
        text = text.rstrip() + "\n\n" + replacement
    atomic_write(path, text)


def append_history(path: Path, phase: str, status: str, note: str) -> None:
    text = path.read_text(encoding="utf-8")
    sections = split_sections(text)
    row = f"- {now_iso()} {phase} {status} {note}\n"
    section = sections.get("History")
    if not section:
        text = text.rstrip() + "\n\n## History\n" + row
    else:
        body = read_body(text, section)
        body = (body + "\n" if body else "") + row
        text = text[: section.body_start] + body + text[section.end :]
    atomic_write(path, text)


def initial_pipeline(project: str, ticket: str, type_hint: str, develop_log: str, mode: str) -> str:
    start_phase = QUICK_PHASES[0] if mode == "quick" else PHASES[0]
    return f"""# Pipeline - {project}

## Project name
{project}

## Ticket ID
{ticket}

## Type hint
{type_hint}

## Mode
{mode}

## Current phase
{start_phase}

## Phase status
Pending

## Lifecycle state
active

## Develop-log
{develop_log}

## Pending user input

## History
- {now_iso()} {start_phase} Pending project-created
"""


def init_workspace(parent_dir: Path, project: str, seed: str, ticket: str, type_hint: str, develop_log: str, mode: str = "full") -> None:
    workspace = parent_dir / ".loom" / project
    if (workspace / "seed.md").exists():
        raise SystemExit(
            f"refusing to init: {workspace / 'seed.md'} already exists. "
            "the workspace is already bootstrapped - resolve manually or use a different project name."
        )
    workspace.mkdir(parents=True, exist_ok=True)
    atomic_write(workspace / "pipeline.md", initial_pipeline(project, ticket, type_hint, develop_log, mode))
    atomic_write(workspace / "seed.md", seed.rstrip() + "\n")


def validate_record(record: dict[str, object]) -> list[str]:
    errors: list[str] = []
    phase = str(record.get("Current phase", ""))
    status = str(record.get("Phase status", ""))
    lifecycle = str(record.get("Lifecycle state", ""))
    develop_log = str(record.get("Develop-log", ""))
    mode = str(record.get("Mode", ""))
    if phase and phase not in PHASES + QUICK_PHASES:
        errors.append(f"invalid phase: {phase}")
    if mode not in VALID_MODES:
        errors.append(f"invalid mode: {mode}")
    if status and status not in VALID_STATUSES:
        errors.append(f"invalid status: {status}")
    if lifecycle and lifecycle not in VALID_LIFECYCLE_STATES:
        errors.append(f"invalid lifecycle state: {lifecycle}")
    if develop_log and develop_log not in VALID_DEVELOP_LOG:
        errors.append(f"invalid develop-log: {develop_log}")
    return errors


def require(path: Path, condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"{path}: {message}")


def phase_sequence(record: dict[str, object]) -> list[str]:
    return QUICK_PHASES if str(record.get("Mode", "")) == "quick" else PHASES


def load_active(path: Path) -> tuple[str, list[str]]:
    record = parse(path)
    seq = phase_sequence(record)
    phase = str(record.get("Current phase", ""))
    require(path, phase in seq, f"invalid current phase for this mode: {phase!r}")
    require(path, str(record.get("Lifecycle state", "")) == "active", "lifecycle is not active")
    return phase, seq


def archive_artifacts(workspace: Path, phases: list[str]) -> list[str]:
    archive = workspace / "superseded" / now_iso().replace(":", "-")
    moved = []
    for ph in phases:
        for name in PHASE_ARTIFACTS[ph]:
            source = workspace / name
            if source.exists():
                archive.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source), str(archive / name))
                moved.append(name)
    return moved


def cmd_advance(path: Path) -> None:
    phase, seq = load_active(path)
    require(path, phase != seq[-1], f"{phase} is the last phase - use complete")
    next_phase = seq[seq.index(phase) + 1]
    replace_field(path, "Phase status", "complete")
    append_history(path, phase, "complete", "phase accepted")
    replace_field(path, "Current phase", next_phase)
    replace_field(path, "Phase status", "Pending")
    replace_field(path, "Pending user input", "")
    append_history(path, next_phase, "Pending", "advanced")
    print(next_phase)


def cmd_rerun(path: Path) -> None:
    phase, _ = load_active(path)
    replace_field(path, "Phase status", "Pending")
    replace_field(path, "Pending user input", "")
    append_history(path, phase, "Pending", "rerun requested")
    print(phase)


def cmd_goback(path: Path, target: str) -> None:
    phase, seq = load_active(path)
    require(path, target in seq, f"invalid target phase: {target!r}")
    require(path, seq.index(target) < seq.index(phase), f"target {target} is not before {phase}")
    moved = archive_artifacts(path.parent, seq[seq.index(target) + 1 :])
    replace_field(path, "Current phase", target)
    replace_field(path, "Phase status", "Pending")
    replace_field(path, "Pending user input", "")
    append_history(path, target, "Pending", f"went back from {phase}; archived: {', '.join(moved) or 'nothing'}")
    print(target)


def cmd_complete(path: Path) -> None:
    phase, seq = load_active(path)
    require(path, phase == seq[-1], f"complete only from {seq[-1]}, not {phase}")
    replace_field(path, "Phase status", "complete")
    replace_field(path, "Lifecycle state", "complete")
    append_history(path, phase, "complete", "lifecycle complete")
    print("complete")


def cmd_escalate(path: Path) -> None:
    phase, seq = load_active(path)
    require(path, seq == QUICK_PHASES, f"escalate only from quick mode, not from {phase}")
    moved = archive_artifacts(path.parent, QUICK_PHASES)
    replace_field(path, "Mode", "full")
    replace_field(path, "Current phase", PHASES[0])
    replace_field(path, "Phase status", "Pending")
    replace_field(path, "Pending user input", "")
    append_history(path, PHASES[0], "Pending", f"escalated from quick; archived: {', '.join(moved) or 'nothing'}")
    print(PHASES[0])


def cmd_block(path: Path, question: str) -> None:
    phase, _ = load_active(path)
    replace_field(path, "Phase status", "blocked")
    replace_field(path, "Pending user input", question)
    append_history(path, phase, "blocked", "waiting for user input")
    print(phase)


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    for name in ("field", "advance", "rerun", "goback", "complete", "block", "escalate"):
        p = sub.add_parser(name)
        p.add_argument("path")
        if name == "field":
            p.add_argument("name")
        elif name == "goback":
            p.add_argument("target")
        elif name == "block":
            p.add_argument("question")

    p_init = sub.add_parser("init")
    p_init.add_argument("parent_dir")
    p_init.add_argument("project")
    p_init.add_argument("--seed", default="")
    p_init.add_argument("--ticket", default="")
    p_init.add_argument("--type-hint", default="")
    p_init.add_argument("--develop-log", default="local", choices=sorted(VALID_DEVELOP_LOG))
    p_init.add_argument("--mode", default="full", choices=["full", "quick"])

    args = parser.parse_args()

    if args.cmd == "field":
        value = parse(Path(args.path)).get(args.name, "")
        print(value if isinstance(value, str) else json.dumps(value))
    elif args.cmd == "init":
        init_workspace(Path(args.parent_dir), args.project, args.seed, args.ticket, args.type_hint, args.develop_log, args.mode)
    elif args.cmd == "advance":
        cmd_advance(Path(args.path))
    elif args.cmd == "rerun":
        cmd_rerun(Path(args.path))
    elif args.cmd == "goback":
        cmd_goback(Path(args.path), args.target)
    elif args.cmd == "complete":
        cmd_complete(Path(args.path))
    elif args.cmd == "block":
        cmd_block(Path(args.path), args.question)
    elif args.cmd == "escalate":
        cmd_escalate(Path(args.path))
    else:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
