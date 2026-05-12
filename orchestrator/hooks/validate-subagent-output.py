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

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
