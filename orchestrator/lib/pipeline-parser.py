#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
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
    "Produced artifacts",
    "Pending user input",
    "Quality findings",
    "Next valid action",
    "Resume point",
    "History",
]

FENCED_FIELDS = {
    "Project name",
    "Ticket ID",
    "Type hint",
    "Current phase",
    "Phase status",
    "Lifecycle state",
    "Next valid action",
    "Resume point",
}

VALID_PHASES = {"spec", "design", "plan", "build", "review"}
VALID_STATUSES = {"Pending", "blocked", "failed", "complete"}
VALID_LIFECYCLE_STATES = {"active", "complete"}


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


def read_list(body: str) -> list[str]:
    out: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            out.append(stripped[2:].strip())
    return out


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
        elif name == "Produced artifacts":
            result[name] = read_list(body)
        elif name == "History":
            result[name] = read_history(body)
        else:
            result[name] = body.strip()
    return result


def render_field(name: str, value: str | list[str]) -> str:
    if name in FENCED_FIELDS:
        return f"```text\n{str(value).strip()}\n```\n"
    if name == "Produced artifacts":
        items = value if isinstance(value, list) else [line.strip() for line in str(value).splitlines() if line.strip()]
        return "".join(f"- {item}\n" for item in items)
    if name == "History":
        return str(value).rstrip() + "\n"
    return str(value).strip("\n") + "\n"


def replace_field(path: Path, name: str, value: str | list[str]) -> None:
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


def initial_pipeline(project: str, ticket: str, type_hint: str) -> str:
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

## Produced artifacts

## Pending user input

## Quality findings

## Next valid action
```text
Run /weave to advance
```

## Resume point
```text
spec:foundation
```

## History

| timestamp | phase | status | note |
| --- | --- | --- | --- |
| {now_iso()} | spec | Pending | project created |
"""


def init_workspace(parent_dir: Path, project: str, seed: str, ticket: str, type_hint: str) -> None:
    workspace = parent_dir / ".loom" / project
    if (workspace / "seed.md").exists():
        raise SystemExit(
            f"refusing to init: {workspace / 'seed.md'} already exists. "
            "the workspace is already bootstrapped — resolve manually or use a different project name."
        )
    workspace.mkdir(parents=True, exist_ok=True)
    atomic_write(workspace / "pipeline.md", initial_pipeline(project, ticket, type_hint))
    atomic_write(workspace / "seed.md", seed.rstrip() + "\n")
    if not (workspace / "events.jsonl").exists():
        atomic_write(workspace / "events.jsonl", "")


def validate_record(record: dict[str, object]) -> list[str]:
    errors: list[str] = []
    phase = str(record.get("Current phase", ""))
    status = str(record.get("Phase status", ""))
    lifecycle = str(record.get("Lifecycle state", ""))
    if phase and phase not in VALID_PHASES:
        errors.append(f"invalid phase: {phase}")
    if status and status not in VALID_STATUSES:
        errors.append(f"invalid status: {status}")
    if lifecycle and lifecycle not in VALID_LIFECYCLE_STATES:
        errors.append(f"invalid lifecycle state: {lifecycle}")
    missing = [name for name in SECTION_ORDER if name not in record]
    for name in missing:
        errors.append(f"missing section: {name}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_read = sub.add_parser("read")
    p_read.add_argument("path")

    p_field = sub.add_parser("field")
    p_field.add_argument("path")
    p_field.add_argument("name")

    p_update = sub.add_parser("update")
    p_update.add_argument("path")
    p_update.add_argument("name")
    p_update.add_argument("value", nargs="?")
    p_update.add_argument("--stdin", action="store_true")

    p_history = sub.add_parser("append-history")
    p_history.add_argument("path")
    p_history.add_argument("phase")
    p_history.add_argument("status")
    p_history.add_argument("note")
    p_history.add_argument("--timestamp")

    p_init = sub.add_parser("init")
    p_init.add_argument("parent_dir")
    p_init.add_argument("project")
    p_init.add_argument("--seed", default="")
    p_init.add_argument("--ticket", default="")
    p_init.add_argument("--type-hint", default="")

    p_validate = sub.add_parser("validate")
    p_validate.add_argument("path")

    args = parser.parse_args()

    if args.cmd == "read":
        print(json.dumps(parse(Path(args.path)), indent=2))
        return 0
    if args.cmd == "field":
        value = parse(Path(args.path)).get(args.name, "")
        if isinstance(value, list):
            print("\n".join(value))
        else:
            print(value)
        return 0
    if args.cmd == "update":
        value = sys.stdin.read() if args.stdin else (args.value or "")
        replace_field(Path(args.path), args.name, value)
        return 0
    if args.cmd == "append-history":
        append_history(Path(args.path), args.phase, args.status, args.note, args.timestamp)
        return 0
    if args.cmd == "init":
        init_workspace(Path(args.parent_dir), args.project, args.seed, args.ticket, args.type_hint)
        return 0
    if args.cmd == "validate":
        errors = validate_record(parse(Path(args.path)))
        if errors:
            print("\n".join(errors), file=sys.stderr)
            return 1
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
