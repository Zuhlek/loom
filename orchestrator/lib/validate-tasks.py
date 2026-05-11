#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


REQUIRED = {
    "id",
    "title",
    "type",
    "status",
    "blocked-by",
    "covers",
    "touches-layers",
    "files-likely-touched",
}


def frontmatter(path: Path) -> dict[str, str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    out: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" in line:
            key, value = line.split(":", 1)
            out[key.strip()] = value.strip().strip("'\"")
    return out


def parse_list(value: str) -> list[str]:
    value = value.strip()
    if value in {"", "[]"}:
        return []
    if value.startswith("[") and value.endswith("]"):
        return [part.strip().strip("'\"") for part in value[1:-1].split(",") if part.strip()]
    return [value]


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate-tasks.py <project-dir>", file=sys.stderr)
        return 2

    root = Path(sys.argv[1])
    tasks = sorted((root / "tasks").glob("T-*.md"))
    errors: list[str] = []
    ids: set[str] = set()
    deps: dict[str, list[str]] = {}

    for task in tasks:
        data = frontmatter(task)
        missing = REQUIRED - set(data)
        if missing:
            errors.append(f"{task}: missing {', '.join(sorted(missing))}")
            continue
        tid = data["id"]
        if not re.fullmatch(r"T-[0-9]{3}", tid):
            errors.append(f"{task}: invalid id {tid}")
        if tid in ids:
            errors.append(f"{task}: duplicate id {tid}")
        ids.add(tid)
        deps[tid] = parse_list(data.get("blocked-by", ""))
        layers = parse_list(data.get("touches-layers", ""))
        if len(layers) < 2 and "single-layer-justification" not in data:
            errors.append(f"{task}: single-layer task lacks justification")

    for tid, blocked_by in deps.items():
        for dep in blocked_by:
            if dep not in ids:
                errors.append(f"{tid}: unknown dependency {dep}")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(tid: str) -> None:
        if tid in visited:
            return
        if tid in visiting:
            errors.append(f"{tid}: dependency cycle")
            return
        visiting.add(tid)
        for dep in deps.get(tid, []):
            if dep in ids:
                visit(dep)
        visiting.remove(tid)
        visited.add(tid)

    for tid in ids:
        visit(tid)

    if not (root / "board.md").exists():
        errors.append("missing board.md")
    if not (root / "task.md").exists():
        errors.append("missing task.md")
    if not (root / "tests.md").exists():
        errors.append("missing tests.md")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
