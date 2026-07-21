#!/usr/bin/env python3
"""PostToolUse hook for the Agent/Task tool.

Per dispatched subagent this hook:
1. writes an `agent-<uuid>.phase` sidecar next to the subagent's transcript,
   tagging it with the phase the `/weave` orchestrator is currently driving;
2. appends the parent session's UUID to `.loom/<project>/.eval-orchestrator-pointer`
   (one UUID per line — retries and multi-day sessions accumulate);
3. refreshes the project's usage artifacts — `usage.jsonl` (transcript
   harvest), `usage.md` (aggregate), `outcome.json` — so EVERY `/weave`
   run carries a live usage summary, not just eval-harness runs.

Failures are reported on stderr (visible with `claude --debug` and in hook
logs) but never fail the hook: telemetry must not break the run.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


VALID_PHASES = {"spec", "design", "plan", "build", "review"}

TELEMETRY_DIR = Path(__file__).resolve().parent

CURRENT_PHASE_RE = re.compile(
    r"^## Current phase\s*\n```(?:text)?\n(.+?)\n```",
    re.MULTILINE | re.DOTALL,
)

DISPATCH_PHASE_RE = re.compile(
    r"<system-reminder>.*?Active phase:\s*([A-Za-z]+).*?</system-reminder>",
    re.DOTALL,
)


def _warn(msg: str) -> None:
    print(f"[tag-subagent-phase] {msg}", file=sys.stderr)


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


def append_pointer(pointer_path: Path, session_id: str) -> list[str]:
    """Append the session UUID to the pointer file (one per line, unique).

    Retried eval attempts and resumed interactive sessions each get a line;
    the harvester reads every line. Returns the full list."""
    lines: list[str] = []
    if pointer_path.exists():
        try:
            lines = [l.strip() for l in
                     pointer_path.read_text(encoding="utf-8").splitlines()
                     if l.strip()]
        except OSError as exc:
            _warn(f"could not read pointer {pointer_path}: {exc}")
    if session_id not in lines:
        lines.append(session_id)
        try:
            pointer_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = pointer_path.with_name(pointer_path.name + ".tmp")
            tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
            tmp.replace(pointer_path)
        except OSError as exc:
            _warn(f"could not write pointer {pointer_path}: {exc}")
    return lines


def refresh_artifacts(cwd: Path, project: str, session_ids: list[str]) -> None:
    """Re-derive usage.jsonl / usage.md / outcome.json for the project.

    Runs after every subagent completes so the workspace always carries a
    current usage summary — for regular /weave runs and eval runs alike."""
    workspace = cwd / ".loom" / project
    harvest_cmd = [sys.executable, str(TELEMETRY_DIR / "transcript-harvest.py"),
                   project, "--workspace", str(workspace), "--cwd", str(cwd)]
    for sid in session_ids:
        harvest_cmd += ["--session", sid]
    steps = (
        ("harvest", harvest_cmd, 30),
        ("aggregate", [sys.executable, str(TELEMETRY_DIR / "eval-aggregate.py"),
                       project, "--loom-root", str(cwd / ".loom")], 15),
        ("outcome", [sys.executable, str(TELEMETRY_DIR / "run-outcome.py"),
                     str(workspace)], 15),
    )
    for label, cmd, timeout in steps:
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True,
                                  timeout=timeout)
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout or "").strip()[:300]
                _warn(f"{label} exit {proc.returncode}: {detail}")
        except Exception as exc:  # noqa: BLE001 — telemetry must not fail the run
            _warn(f"{label} failed: {exc}")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        _warn("could not parse hook payload from stdin")
        return 0

    if payload.get("tool_name") not in ("Agent", "Task"):
        return 0

    response = payload.get("tool_response") or {}
    agent_id = response.get("agentId")
    agent_type = response.get("agentType", "")
    session_id = payload.get("session_id")
    cwd = payload.get("cwd")
    if not (session_id and cwd):
        _warn(f"payload missing session_id/cwd (session_id={session_id!r})")
        return 0

    cwd_path = Path(cwd)
    project = read_active_project(cwd_path)
    if project is None:
        # No active loom project in this repo — nothing to tag.
        return 0

    pointer_path = cwd_path / ".loom" / project / ".eval-orchestrator-pointer"
    session_ids = append_pointer(pointer_path, session_id)

    phase = read_dispatch_phase(payload) or read_current_phase(
        cwd_path / ".loom" / project / "pipeline.md"
    )

    if agent_id:
        subagents_dir = (
            Path.home() / ".claude" / "projects" / encode_cwd(cwd)
            / session_id / "subagents"
        )
        if not subagents_dir.is_dir():
            _warn(f"subagents dir missing: {subagents_dir}")
        elif phase is None:
            _warn(f"phase unresolved for agent {agent_id} "
                  f"(no 'Active phase:' in dispatch, no Current phase in "
                  f"pipeline.md) — row will fall back to meta.json tagging")
        else:
            write_sidecar(
                subagents_dir / f"agent-{agent_id}.phase",
                {
                    "phase": phase,
                    "project": project,
                    "agent_type": agent_type,
                    "dispatched_at": datetime.now(timezone.utc)
                    .strftime("%Y-%m-%dT%H:%M:%SZ"),
                },
            )
    else:
        _warn("tool_response carried no agentId; skipping sidecar")

    refresh_artifacts(cwd_path, project, session_ids)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — never fail the dispatch
        _warn(f"unhandled: {exc.__class__.__name__}: {exc}")
        raise SystemExit(0)
