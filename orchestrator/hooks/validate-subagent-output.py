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
    "build-task": {"green", "failed", "hitl-block"},
    "smoke": {"complete", "failed", "skipped"},
    "mutate": {"complete", "failed", "skipped"},
    "review": {"Pending", "blocked", "failed", "complete"},
    "quality-check": {"passed", "findings"}
}


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

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
