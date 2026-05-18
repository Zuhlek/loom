#!/usr/bin/env python3
"""PostToolUse hook for the Agent/Task tool. Writes an `agent-<uuid>.phase`
sidecar next to each dispatched subagent's transcript, tagging it with the
phase the `/weave` orchestrator is currently driving."""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


VALID_PHASES = {"spec", "design", "plan", "build", "review"}

CURRENT_PHASE_RE = re.compile(
    r"^## Current phase\s*\n```(?:text)?\n(.+?)\n```",
    re.MULTILINE | re.DOTALL,
)

DISPATCH_PHASE_RE = re.compile(
    r"<system-reminder>.*?Active phase:\s*([A-Za-z]+).*?</system-reminder>",
    re.DOTALL,
)


def encode_cwd(cwd: str) -> str:
    return cwd.replace("/", "-").replace(" ", "-")


def read_active_project(cwd: Path) -> str | None:
    marker = cwd / ".loom" / ".active"
    if not marker.is_file():
        return None
    raw = marker.read_text(encoding="utf-8").strip()
    return raw.splitlines()[0].strip() if raw else None


def read_current_phase(pipeline_file: Path) -> str | None:
    if not pipeline_file.is_file():
        return None
    match = CURRENT_PHASE_RE.search(pipeline_file.read_text(encoding="utf-8"))
    if match is None:
        return None
    phase = match.group(1).strip().lower()
    return phase if phase in VALID_PHASES else None


def read_dispatch_phase(payload: dict) -> str | None:
    """Extract `Active phase:` from the dispatched Task's user-turn prompt.

    Byte-faithful to what the subagent received, so attribution does not
    depend on `pipeline.md` write-discipline.
    """
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return None
    prompt = tool_input.get("prompt")
    if not isinstance(prompt, str):
        return None
    match = DISPATCH_PHASE_RE.search(prompt)
    if match is None:
        return None
    phase = match.group(1).strip().lower()
    return phase if phase in VALID_PHASES else None


def write_sidecar(target: Path, record: dict) -> None:
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(json.dumps(record) + "\n", encoding="utf-8")
    tmp.replace(target)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    if payload.get("tool_name") not in ("Agent", "Task"):
        return 0

    response = payload.get("tool_response") or {}
    agent_id = response.get("agentId")
    agent_type = response.get("agentType", "")
    session_id = payload.get("session_id")
    cwd = payload.get("cwd")
    if not (agent_id and session_id and cwd):
        return 0

    cwd_path = Path(cwd)
    project = read_active_project(cwd_path)
    if project is None:
        return 0

    phase = read_dispatch_phase(payload) or read_current_phase(
        cwd_path / ".loom" / project / "pipeline.md"
    )
    if phase is None:
        return 0

    subagents_dir = (
        Path.home() / ".claude" / "projects" / encode_cwd(cwd) / session_id / "subagents"
    )
    if not subagents_dir.is_dir():
        return 0

    write_sidecar(
        subagents_dir / f"agent-{agent_id}.phase",
        {
            "phase": phase,
            "project": project,
            "agent_type": agent_type,
            "dispatched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    )

    pointer_path = cwd_path / ".loom" / project / ".eval-orchestrator-pointer"
    if not pointer_path.exists():
        pointer_path.parent.mkdir(parents=True, exist_ok=True)
        pointer_path.write_text(session_id, encoding="utf-8")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        raise SystemExit(0)
