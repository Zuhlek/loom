#!/usr/bin/env python3
"""pipeline.md CLI. The orchestrator mutates pipeline.md only through this tool."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


SECTION_ORDER = [
    "Project name",
    "Ticket ID",
    "Type hint",
    "Current phase",
    "Phase status",
    "Lifecycle state",
    "Develop-log",
    "Pending user input",
    "History",
]

FENCED_FIELDS = {
    "Project name",
    "Ticket ID",
    "Type hint",
    "Current phase",
    "Phase status",
    "Lifecycle state",
    "Develop-log",
}

PHASES = ["spec", "design", "plan", "build", "review"]
VALID_STATUSES = {"Pending", "blocked", "failed", "complete"}
VALID_LIFECYCLE_STATES = {"active", "complete"}
VALID_DEVELOP_LOG = {"local", "global"}

# Artifacts each phase owns inside the workspace. goback archives these for
# every phase after the target.
PHASE_ARTIFACTS = {
    "spec": ["spec.md", "decisions.md"],
    "design": ["design.md", "mockup"],
    "plan": ["plan.md"],
    "build": ["build-report.md", "smoke-screenshots"],
    "review": ["review.md"],
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


def read_fenced(body: str) -> str:
    match = re.search(r"```(?:text)?\n(.*?)\n```", body, flags=re.S)
    if not match:
        return body.strip()
    return match.group(1).strip()


def read_history(body: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|") or "---" in stripped:
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if cells[:4] == ["timestamp", "phase", "status", "note"]:
            continue
        if len(cells) >= 4:
            rows.append({"timestamp": cells[0], "phase": cells[1], "status": cells[2], "note": cells[3]})
    return rows


def parse(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    sections = split_sections(text)
    result: dict[str, object] = {}
    for name in SECTION_ORDER:
        section = sections.get(name)
        body = read_body(text, section) if section else ""
        if name in FENCED_FIELDS:
            result[name] = read_fenced(body)
        elif name == "History":
            result[name] = read_history(body)
        else:
            result[name] = body.strip()
    return result


def render_field(name: str, value: str) -> str:
    if name in FENCED_FIELDS:
        return f"```text\n{str(value).strip()}\n```\n"
    if name == "History":
        return str(value).rstrip() + "\n"
    return str(value).strip("\n") + "\n"


def replace_field(path: Path, name: str, value: str) -> None:
    text = path.read_text(encoding="utf-8")
    sections = split_sections(text)
    replacement = f"## {name}\n{render_field(name, value)}"
    section = sections.get(name)
    if section:
        text = text[: section.start] + replacement + text[section.end :]
    else:
        text = text.rstrip() + "\n\n" + replacement
    atomic_write(path, text)


def append_history(path: Path, phase: str, status: str, note: str, timestamp: str | None = None) -> None:
    timestamp = timestamp or now_iso()
    text = path.read_text(encoding="utf-8")
    sections = split_sections(text)
    row = f"| {timestamp} | {phase} | {status} | {note.replace('|', '/')} |\n"
    section = sections.get("History")
    if not section:
        block = "## History\n\n| timestamp | phase | status | note |\n| --- | --- | --- | --- |\n" + row
        text = text.rstrip() + "\n\n" + block
    else:
        body = read_body(text, section)
        if "| timestamp | phase | status | note |" not in body:
            body = "| timestamp | phase | status | note |\n| --- | --- | --- | --- |\n"
        if not body.endswith("\n"):
            body += "\n"
        body += row
        text = text[: section.body_start] + body + text[section.end :]
    atomic_write(path, text)


def initial_pipeline(project: str, ticket: str, type_hint: str, develop_log: str) -> str:
    return f"""# Pipeline - {project}

## Project name
```text
{project}
```

## Ticket ID
```text
{ticket}
```

## Type hint
```text
{type_hint}
```

## Current phase
```text
spec
```

## Phase status
```text
Pending
```

## Lifecycle state
```text
active
```

## Develop-log
```text
{develop_log}
```

## Pending user input

## History

| timestamp | phase | status | note |
| --- | --- | --- | --- |
| {now_iso()} | spec | Pending | project created |
"""


def init_workspace(parent_dir: Path, project: str, seed: str, ticket: str, type_hint: str, develop_log: str) -> None:
    workspace = parent_dir / ".loom" / project
    if (workspace / "seed.md").exists():
        raise SystemExit(
            f"refusing to init: {workspace / 'seed.md'} already exists. "
            "the workspace is already bootstrapped - resolve manually or use a different project name."
        )
    workspace.mkdir(parents=True, exist_ok=True)
    atomic_write(workspace / "pipeline.md", initial_pipeline(project, ticket, type_hint, develop_log))
    atomic_write(workspace / "seed.md", seed.rstrip() + "\n")


def validate_record(record: dict[str, object]) -> list[str]:
    errors: list[str] = []
    phase = str(record.get("Current phase", ""))
    status = str(record.get("Phase status", ""))
    lifecycle = str(record.get("Lifecycle state", ""))
    develop_log = str(record.get("Develop-log", ""))
    if phase and phase not in PHASES:
        errors.append(f"invalid phase: {phase}")
    if status and status not in VALID_STATUSES:
        errors.append(f"invalid status: {status}")
    if lifecycle and lifecycle not in VALID_LIFECYCLE_STATES:
        errors.append(f"invalid lifecycle state: {lifecycle}")
    if develop_log and develop_log not in VALID_DEVELOP_LOG:
        errors.append(f"invalid develop-log: {develop_log}")
    missing = [name for name in SECTION_ORDER if name not in record]
    for name in missing:
        errors.append(f"missing section: {name}")
    return errors


def require(path: Path, condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"{path}: {message}")


def current_phase(path: Path) -> str:
    record = parse(path)
    phase = str(record.get("Current phase", ""))
    require(path, phase in PHASES, f"invalid current phase: {phase!r}")
    require(path, str(record.get("Lifecycle state", "")) == "active", "lifecycle is not active")
    return phase


def cmd_advance(path: Path) -> None:
    phase = current_phase(path)
    require(path, phase != "review", "review is the last phase - use complete")
    next_phase = PHASES[PHASES.index(phase) + 1]
    replace_field(path, "Phase status", "complete")
    append_history(path, phase, "complete", "phase accepted")
    replace_field(path, "Current phase", next_phase)
    replace_field(path, "Phase status", "Pending")
    replace_field(path, "Pending user input", "")
    append_history(path, next_phase, "Pending", "advanced")
    print(next_phase)


def cmd_rerun(path: Path) -> None:
    phase = current_phase(path)
    replace_field(path, "Phase status", "Pending")
    replace_field(path, "Pending user input", "")
    append_history(path, phase, "Pending", "rerun requested")
    print(phase)


def cmd_goback(path: Path, target: str) -> None:
    phase = current_phase(path)
    require(path, target in PHASES, f"invalid target phase: {target!r}")
    require(path, PHASES.index(target) < PHASES.index(phase), f"target {target} is not before {phase}")
    workspace = path.parent
    stamp = now_iso().replace(":", "-")
    archive = workspace / "superseded" / stamp
    moved = []
    for later in PHASES[PHASES.index(target) + 1 :]:
        for name in PHASE_ARTIFACTS[later]:
            source = workspace / name
            if source.exists():
                archive.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source), str(archive / name))
                moved.append(name)
    replace_field(path, "Current phase", target)
    replace_field(path, "Phase status", "Pending")
    replace_field(path, "Pending user input", "")
    append_history(path, target, "Pending", f"went back from {phase}; archived: {', '.join(moved) or 'nothing'}")
    print(target)


def cmd_complete(path: Path) -> None:
    phase = current_phase(path)
    require(path, phase == "review", f"complete only from review, not {phase}")
    replace_field(path, "Phase status", "complete")
    replace_field(path, "Lifecycle state", "complete")
    append_history(path, "review", "complete", "lifecycle complete")
    print("complete")


def cmd_block(path: Path, question: str) -> None:
    phase = current_phase(path)
    replace_field(path, "Phase status", "blocked")
    replace_field(path, "Pending user input", question)
    append_history(path, phase, "blocked", "waiting for user input")
    print(phase)


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    for name in ("read", "field", "update", "validate", "advance", "rerun", "goback", "complete", "block", "append-history"):
        p = sub.add_parser(name)
        p.add_argument("path")
        if name == "field":
            p.add_argument("name")
        elif name == "update":
            p.add_argument("name")
            p.add_argument("value", nargs="?")
            p.add_argument("--stdin", action="store_true")
        elif name == "goback":
            p.add_argument("target")
        elif name == "block":
            p.add_argument("question")
        elif name == "append-history":
            p.add_argument("phase")
            p.add_argument("status")
            p.add_argument("note")
            p.add_argument("--timestamp")

    p_init = sub.add_parser("init")
    p_init.add_argument("parent_dir")
    p_init.add_argument("project")
    p_init.add_argument("--seed", default="")
    p_init.add_argument("--ticket", default="")
    p_init.add_argument("--type-hint", default="")
    p_init.add_argument("--develop-log", default="local", choices=sorted(VALID_DEVELOP_LOG))

    args = parser.parse_args()

    if args.cmd == "read":
        print(json.dumps(parse(Path(args.path)), indent=2))
    elif args.cmd == "field":
        value = parse(Path(args.path)).get(args.name, "")
        print(value if isinstance(value, str) else json.dumps(value))
    elif args.cmd == "update":
        value = sys.stdin.read() if args.stdin else (args.value or "")
        replace_field(Path(args.path), args.name, value)
    elif args.cmd == "append-history":
        append_history(Path(args.path), args.phase, args.status, args.note, args.timestamp)
    elif args.cmd == "init":
        init_workspace(Path(args.parent_dir), args.project, args.seed, args.ticket, args.type_hint, args.develop_log)
    elif args.cmd == "validate":
        errors = validate_record(parse(Path(args.path)))
        if errors:
            print("\n".join(errors), file=sys.stderr)
            return 1
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
    else:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
