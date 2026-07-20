#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


VALID_STATUSES = {
    "spec": {"Pending", "blocked", "failed", "complete"},
    "design": {"Pending", "blocked", "failed", "complete"},
    "plan": {"Pending", "blocked", "failed", "complete"},
    "build": {"Pending", "blocked", "failed", "complete"},
    "review": {"Pending", "blocked", "failed", "complete"},
    "quality-check": {"passed", "findings"}
}

TASK_REQUIRED_FIELDS = (
    "id", "title", "type", "status", "blocked-by",
    "satisfies-stories", "touches-layers", "files-likely-touched",
)
BOARD_COLUMNS = ("Backlog", "In Progress", "Review", "Done")
PLAN_REQUIRED_SECTIONS = (
    "## Approach & sequencing", "## Plan decisions",
    "## Risks", "## Verification environment",
)
MAX_REPORTED_VIOLATIONS = 8


def block(reason: str) -> int:
    print(json.dumps({"decision": "block", "reason": reason}))
    return 0


def last_return_block(text: str) -> dict[str, str]:
    matches = list(re.finditer(r"(?im)^(phase|PHASE):\s*(.+)$", text))
    if not matches:
        return {}
    start = matches[-1].start()
    block_text = text[start:]
    out: dict[str, str] = {}
    for line in block_text.splitlines():
        match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$", line.strip())
        if match:
            out[match.group(1).lower()] = match.group(2).strip()
        elif out and line.strip() == "":
            break
    return out


def last_return_block_span(text: str) -> str:
    """Return the raw text of the last RETURN block, from the final `phase:`
    line to the first blank line that closes it. Used to recover the
    block-style `artifacts:` list, which `last_return_block` flattens away."""
    matches = list(re.finditer(r"(?im)^(phase|PHASE):\s*(.+)$", text))
    if not matches:
        return ""
    block = text[matches[-1].start():]
    lines: list[str] = []
    seen = False
    for line in block.splitlines():
        if re.match(r"^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$", line.strip()):
            seen = True
            lines.append(line)
        elif seen and line.strip() == "":
            break
        else:
            lines.append(line)
    return "\n".join(lines)


def artifact_paths(block_text: str) -> list[str]:
    """Extract the items of the `artifacts:` array from the RETURN block.
    Handles a block-style YAML list (`artifacts:` then `- path` lines) and an
    inline flow list (`artifacts: [a, b]`)."""
    out: list[str] = []
    lines = block_text.splitlines()
    for idx, line in enumerate(lines):
        m = re.match(r"^\s*artifacts:\s*(.*)$", line)
        if not m:
            continue
        inline = m.group(1).strip()
        if inline.startswith("[") and inline.endswith("]"):
            for part in inline[1:-1].split(","):
                item = part.strip().strip("'\"")
                if item:
                    out.append(item)
            return out
        for follow in lines[idx + 1:]:
            stripped = follow.strip()
            if stripped.startswith("- "):
                item = stripped[2:].strip().strip("'\"")
                if item:
                    out.append(item)
            elif stripped == "":
                continue
            else:
                break
        return out
    return out


def find_active(start: Path) -> tuple[Path, str] | None:
    """Walk up from `start` looking for `.loom/.active`. Return
    `(workspace_root, project_name)` on first hit, else None. Mirrors the
    resolver in `board-transition.py`."""
    cur = start.resolve()
    while True:
        marker = cur / ".loom" / ".active"
        if marker.is_file():
            try:
                raw = marker.read_text(encoding="utf-8").strip()
            except OSError:
                return None
            if not raw:
                return None
            project = raw.splitlines()[0].strip()
            if not project:
                return None
            return cur, project
        if cur.parent == cur:
            return None
        cur = cur.parent


def missing_artifacts(paths: list[str], workspace_root: Path, project: str) -> list[str]:
    """Return artifact paths from the RETURN block that exist under neither the
    `.loom/<project>/` workspace nor the workspace root (repo-relative Build
    writes). Skips absolute paths and `<...>` placeholder/template tokens."""
    project_dir = workspace_root / ".loom" / project
    missing: list[str] = []
    for raw in paths:
        path = raw.strip()
        if not path or "<" in path or ">" in path:
            continue
        if Path(path).is_absolute():
            if not Path(path).exists():
                missing.append(path)
            continue
        if (project_dir / path).exists() or (workspace_root / path).exists():
            continue
        missing.append(path)
    return missing


def parse_task_frontmatter(text: str) -> dict[str, object] | None:
    """Parse the YAML frontmatter of a tasks/T-NNN.md file into a dict.
    Handles scalar values, inline flow lists (`[a, b]`), and block lists
    (`- item` lines). Returns None when no frontmatter delimiters are found."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    out: dict[str, object] = {}
    key: str | None = None
    for line in lines[1:]:
        if line.strip() == "---":
            return out
        m = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$", line)
        if m:
            key = m.group(1)
            value = m.group(2).strip()
            if value.startswith("[") and value.endswith("]"):
                items = [p.strip().strip("'\"") for p in value[1:-1].split(",")]
                out[key] = [i for i in items if i]
            elif value == "":
                out[key] = []  # scalar may follow as block list
            else:
                out[key] = value
        elif key is not None:
            stripped = line.strip()
            if stripped.startswith("- "):
                item = stripped[2:].strip().strip("'\"")
                if isinstance(out.get(key), list) and item:
                    out[key].append(item)  # type: ignore[union-attr]
    return None


def has_cycle(edges: dict[str, list[str]]) -> bool:
    """Detect a cycle in the blocked-by graph (iterative three-color DFS)."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {node: WHITE for node in edges}
    for root in edges:
        if color[root] != WHITE:
            continue
        stack: list[tuple[str, int]] = [(root, 0)]
        color[root] = GRAY
        while stack:
            node, idx = stack.pop()
            deps = [d for d in edges.get(node, []) if d in color]
            if idx < len(deps):
                stack.append((node, idx + 1))
                dep = deps[idx]
                if color[dep] == GRAY:
                    return True
                if color[dep] == WHITE:
                    color[dep] = GRAY
                    stack.append((dep, 0))
            else:
                color[node] = BLACK
    return False


def active_story_ids(spec_text: str) -> set[str]:
    """Collect US-NNN IDs of `status=active` stories from spec.md's
    `loom:story` markers (see phases/spec/methods/stories.md)."""
    return {
        m.group(1)
        for m in re.finditer(
            r"<!--\s*loom:story\s+id=(US-\d+)\s+status=active\b", spec_text
        )
    }


def board_card_ids(board_text: str) -> tuple[list[str], list[str]]:
    """Return (card task IDs in column order, violations). Checks the
    four-column shape and the card-line regex from the Plan signature."""
    violations: list[str] = []
    columns = re.findall(r"(?m)^##\s+(.+?)\s*$", board_text)
    if tuple(columns) != BOARD_COLUMNS:
        violations.append(
            f"board.md columns are {columns!r}, expected {list(BOARD_COLUMNS)!r}"
        )
    ids: list[str] = []
    for line in board_text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("- ") or stripped == "- (none)":
            continue
        card = re.match(r"^-\s+(?:\[[^\]]+\]\s+)*?(T-\d+)\s+.+", stripped)
        if card:
            ids.append(card.group(1))
        elif re.search(r"T-\d+", stripped):
            violations.append(f"board.md card line malformed: {stripped[:60]!r}")
    return ids, violations


def validate_plan_workspace(project_dir: Path) -> list[str]:
    """Deterministic work-graph validation for a Plan `complete` return.
    Enforces the invariants in phases/plan/phase.signature.md
    § Deterministic validation. Returns a list of violations (empty = pass)."""
    violations: list[str] = []

    tasks_dir = project_dir / "tasks"
    task_files = sorted(tasks_dir.glob("T-*.md")) if tasks_dir.is_dir() else []
    task_files = [
        p for p in task_files
        if re.fullmatch(r"T-\d+\.md", p.name)
    ]
    if not task_files:
        violations.append("no tasks/T-NNN.md files found")

    tasks: dict[str, dict[str, object]] = {}
    for path in task_files:
        try:
            fm = parse_task_frontmatter(path.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            fm = None
        if fm is None:
            violations.append(f"{path.name}: missing or unterminated frontmatter")
            continue
        missing = [f for f in TASK_REQUIRED_FIELDS if f not in fm]
        if missing:
            violations.append(f"{path.name}: missing frontmatter fields {missing}")
        task_id = str(fm.get("id", path.stem))
        if task_id != path.stem:
            violations.append(f"{path.name}: id {task_id!r} does not match filename")
        if "type" in fm and fm["type"] not in ("AFK", "HITL"):
            violations.append(f"{path.name}: type must be AFK or HITL, got {fm['type']!r}")
        stories = fm.get("satisfies-stories")
        if "satisfies-stories" in fm and (not isinstance(stories, list) or not stories):
            violations.append(f"{path.name}: satisfies-stories must list at least one US-NNN")
        tasks[path.stem] = fm

    edges: dict[str, list[str]] = {}
    for task_id, fm in tasks.items():
        blockers = fm.get("blocked-by")
        blockers = blockers if isinstance(blockers, list) else []
        for blocker in blockers:
            if blocker not in tasks:
                violations.append(f"{task_id}: blocked-by references missing task {blocker}")
        edges[task_id] = [b for b in blockers if b in tasks]
    if has_cycle(edges):
        violations.append("blocked-by graph contains a cycle")

    spec_path = project_dir / "spec.md"
    if spec_path.is_file():
        covered: set[str] = set()
        for fm in tasks.values():
            stories = fm.get("satisfies-stories")
            if isinstance(stories, list):
                covered.update(stories)
        uncovered = sorted(active_story_ids(
            spec_path.read_text(encoding="utf-8", errors="ignore")) - covered)
        if uncovered:
            violations.append(f"active stories with no covering task: {', '.join(uncovered)}")
    else:
        violations.append("spec.md not found")

    board_path = project_dir / "board.md"
    if board_path.is_file():
        card_ids, board_violations = board_card_ids(
            board_path.read_text(encoding="utf-8", errors="ignore"))
        violations.extend(board_violations)
        for task_id in tasks:
            count = card_ids.count(task_id)
            if count != 1:
                violations.append(
                    f"{task_id} appears on {count} board cards, expected exactly 1")
    else:
        violations.append("board.md not found")

    plan_path = project_dir / "plan.md"
    if plan_path.is_file():
        plan_text = plan_path.read_text(encoding="utf-8", errors="ignore")
        for section in PLAN_REQUIRED_SECTIONS:
            if not re.search(rf"(?m)^{re.escape(section)}\s*$", plan_text):
                violations.append(f"plan.md missing required section {section!r}")
    else:
        violations.append("plan.md not found")

    tests_path = project_dir / "tests.md"
    if tests_path.is_file():
        tests_text = tests_path.read_text(encoding="utf-8", errors="ignore")
        if not re.search(r"\*\*Mutation Testing:\*\*\s*(yes|no)\b", tests_text):
            violations.append("tests.md missing '**Mutation Testing:** yes|no' declaration")
    else:
        violations.append("tests.md not found")

    return violations


def main() -> int:
    payload = json.load(sys.stdin)
    transcript_path = payload.get("transcript_path")
    if not transcript_path:
        return 0
    path = Path(transcript_path)
    if not path.exists():
        return 0
    text = path.read_text(encoding="utf-8", errors="ignore")
    ret = last_return_block(text)
    if not ret:
        return 0

    phase = ret.get("phase")
    status = ret.get("status")
    if not phase or phase not in VALID_STATUSES:
        return 0
    if not status or status not in VALID_STATUSES[phase]:
        return block(f"invalid status for {phase}: {status!r}")

    if phase in {"spec", "design", "plan", "build", "review"}:
        if "artifacts" not in ret and "output" not in ret:
            return block(f"{phase} RETURN must include artifacts or output")
        if "summary" not in ret:
            return block(f"{phase} RETURN must include summary")

        # Artifact-existence check: a phase reporting `complete` with declared
        # file artifacts must have actually produced them on disk.
        if status == "complete":
            cwd = payload.get("cwd")
            if isinstance(cwd, str) and cwd:
                active = find_active(Path(cwd))
                if active:
                    workspace_root, project = active
                    paths = artifact_paths(last_return_block_span(text))
                    missing = missing_artifacts(paths, workspace_root, project)
                    if missing:
                        return block(
                            f"{phase} RETURN reports complete but these artifacts "
                            f"do not exist under the workspace: {', '.join(missing)}"
                        )

                    # Deterministic work-graph validation on Plan completion
                    # (phases/plan/phase.signature.md § Deterministic validation).
                    if phase == "plan":
                        violations = validate_plan_workspace(
                            workspace_root / ".loom" / project)
                        if violations:
                            shown = violations[:MAX_REPORTED_VIOLATIONS]
                            more = len(violations) - len(shown)
                            suffix = f" (+{more} more)" if more > 0 else ""
                            return block(
                                "plan RETURN reports complete but the work graph "
                                "fails deterministic validation: "
                                + "; ".join(shown) + suffix
                            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
