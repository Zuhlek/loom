#!/usr/bin/env python3
"""Re-tag `agent-<uuid>.phase` sidecars from the dispatched prompt itself.

Walks every `agent-<uuid>.jsonl` under a Claude Code session's `subagents/`
directory, parses `Active phase:` out of the first user turn's
`<system-reminder>` tail, and rewrites the sibling `.phase` sidecar to
match. Use this to heal completed runs whose sidecars were tagged from
stale `pipeline.md` state instead of the byte-faithful dispatch prompt.

Usage:
  python3 orchestrator/lib/telemetry/retag-sidecars.py <session-dir> [--dry-run]

Where <session-dir> is the Claude Code session directory, e.g.
`~/.claude/projects/<encoded-cwd>/<session-uuid>/`. The script writes
sidecars under `<session-dir>/subagents/`.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


VALID_PHASES = {"spec", "design", "plan", "build", "review"}

DISPATCH_PHASE_RE = re.compile(
    r"<system-reminder>.*?Active phase:\s*([A-Za-z]+).*?</system-reminder>",
    re.DOTALL,
)


def first_user_turn_text(transcript: Path) -> str | None:
    with transcript.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("type") != "user":
                continue
            msg = row.get("message") or {}
            content = msg.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = [c.get("text", "") for c in content
                         if isinstance(c, dict) and isinstance(c.get("text"), str)]
                return "\n".join(parts)
            return None
    return None


def extract_phase(turn_text: str | None) -> str | None:
    if not turn_text:
        return None
    match = DISPATCH_PHASE_RE.search(turn_text)
    if match is None:
        return None
    phase = match.group(1).strip().lower()
    return phase if phase in VALID_PHASES else None


def load_sidecar(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def write_sidecar(target: Path, record: dict) -> None:
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(json.dumps(record) + "\n", encoding="utf-8")
    tmp.replace(target)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    parser.add_argument("session_dir", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    subagents = args.session_dir / "subagents"
    if not subagents.is_dir():
        print(f"error: no subagents dir at {subagents}", file=sys.stderr)
        return 2

    changed = 0
    matched = 0
    skipped = 0
    for transcript in sorted(subagents.glob("agent-*.jsonl")):
        matched += 1
        phase = extract_phase(first_user_turn_text(transcript))
        sidecar = transcript.with_name(transcript.stem + ".phase")
        existing = load_sidecar(sidecar)
        existing_phase = existing.get("phase") if existing else None

        if phase is None:
            print(f"  skip   {transcript.name}: no <system-reminder> phase in dispatch")
            skipped += 1
            continue

        if existing_phase == phase:
            print(f"  ok     {transcript.name}: phase={phase} (no change)")
            continue

        record = dict(existing) if existing else {}
        record["phase"] = phase
        record["retagged_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if existing_phase is not None:
            record["retagged_from"] = existing_phase

        if args.dry_run:
            print(f"  WOULD  {transcript.name}: {existing_phase} -> {phase}")
        else:
            write_sidecar(sidecar, record)
            print(f"  fix    {transcript.name}: {existing_phase} -> {phase}")
        changed += 1

    print(f"\nmatched={matched} changed={changed} skipped={skipped} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
