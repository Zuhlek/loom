#!/usr/bin/env python3
"""PostToolUse hook (Write|Edit|MultiEdit) that mirrors Build's per-task file
writes onto `.loom/<project>/board.md` in near-real-time so the Loom UI sees
columns mutate during a Build session. The orchestrator's end-of-Build
reconciliation from the RETURN block (`task-outcomes` + `smoke`) remains
authoritative; this hook is a best-effort live mirror of the same mapping.

Watched paths under `.loom/<project>/`:

  tasks/T-NNN.test-log.txt   first write with red-phase content → Backlog → In Progress
  tasks/T-NNN.done.md        write/edit → transition per front-matter `status:`
  smoke-report.md            write/edit, no FAIL lines → Review → Done (all cards)

The hook is idempotent: it does not rewrite `board.md` when the card is
already in the target column with the correct annotation. Any failure
(stdin not JSON, board.md unparseable, IO error, etc.) results in a silent
exit-0; the hook never blocks the tool call.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


TOOL_WHITELIST = ("Write", "Edit", "MultiEdit")
COLUMNS = ("Backlog", "In Progress", "Review", "Done")
SECTION_HEADERS = tuple(f"## {c}" for c in COLUMNS)

# Card line: optional single bracketed annotation, then T-NNN, then rest.
CARD_RE = re.compile(r"^-\s+(?:\[(?P<ann>[^\]]+)\]\s+)?(?P<id>T-\d+)\s+(?P<rest>.+)$")
TEST_LOG_RE = re.compile(r"^tasks/(T-\d+)\.test-log\.txt$")
DONE_RE = re.compile(r"^tasks/(T-\d+)\.done\.md$")

# Annotations the orchestrator applies as transition state (strip on move).
# Structural annotations (HITL, stale) are Plan-applied and preserved.
TRANSITION_ANN_RE = re.compile(r"^(failed|HITL-blocked:.*)$")


# --------------------------------------------------------------------------- #
# active project lookup
# --------------------------------------------------------------------------- #
def find_active(start: Path) -> tuple[Path, str] | None:
    """Walk up from `start` looking for `.loom/.active`. Return
    `(workspace_root, project_name)` on first hit, else None."""
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


# --------------------------------------------------------------------------- #
# board.md parsing
# --------------------------------------------------------------------------- #
def parse_board(text: str) -> tuple[list[str], dict[str, list[str]], dict[str, tuple[int, int]]] | None:
    """Split board.md into (lines, columns, ranges).

    - lines: raw file as list of lines (no trailing newline per element).
    - columns: column name → list of card line strings (in order).
    - ranges: column name → (first_card_line_idx, end_idx_exclusive). The
      range covers ONLY the card-list region (after the `## <column>` header,
      skipping the immediate blank line, up to the next `## ` header or EOF,
      trimmed of trailing blank lines).

    Returns None if the four sections are not all present in order.
    """
    lines = text.splitlines()
    header_idx: dict[str, int] = {}
    for i, line in enumerate(lines):
        for col, header in zip(COLUMNS, SECTION_HEADERS):
            if line.strip() == header:
                if col in header_idx:
                    return None  # duplicate header
                header_idx[col] = i

    if len(header_idx) != 4:
        return None
    ordered = [header_idx[c] for c in COLUMNS]
    if ordered != sorted(ordered):
        return None

    columns: dict[str, list[str]] = {}
    ranges: dict[str, tuple[int, int]] = {}
    for i, col in enumerate(COLUMNS):
        start = header_idx[col] + 1
        # Skip a single blank line immediately after the header, if present.
        if start < len(lines) and lines[start].strip() == "":
            start += 1
        end = header_idx[COLUMNS[i + 1]] if i + 1 < len(COLUMNS) else len(lines)
        # Trim trailing blank lines from the column region.
        trim = end
        while trim > start and lines[trim - 1].strip() == "":
            trim -= 1
        cards = [lines[j] for j in range(start, trim)]
        # Drop the `- (none)` placeholder so we operate on real cards only.
        cards_real = [c for c in cards if c.strip() != "- (none)"]
        columns[col] = cards_real
        ranges[col] = (start, trim)
    return lines, columns, ranges


def render_board(original_lines: list[str], columns: dict[str, list[str]], ranges: dict[str, tuple[int, int]]) -> str:
    """Rebuild board.md text, splicing new column contents into the original
    line ranges. Preserves header/trailer text outside the card regions."""
    out: list[str] = []
    cursor = 0
    for col in COLUMNS:
        start, end = ranges[col]
        # Emit everything up to (not including) the column's card region.
        out.extend(original_lines[cursor:start])
        cards = columns[col]
        if cards:
            out.extend(cards)
        else:
            out.append("- (none)")
        cursor = end
    # Trailer after the last column's region.
    out.extend(original_lines[cursor:])
    text = "\n".join(out)
    # Preserve trailing newline if the original had one.
    return text + ("\n" if not text.endswith("\n") else "")


# --------------------------------------------------------------------------- #
# card mutation
# --------------------------------------------------------------------------- #
def find_card(columns: dict[str, list[str]], task_id: str) -> tuple[str, int, re.Match] | None:
    for col in COLUMNS:
        for idx, line in enumerate(columns[col]):
            m = CARD_RE.match(line)
            if m and m.group("id") == task_id:
                return col, idx, m
    return None


def rebuild_card_line(match: re.Match, new_annotation: str | None) -> str:
    """Rebuild the card line, keeping any structural annotation (HITL, stale)
    or replacing a transition annotation (failed, HITL-blocked) with the new
    one. `new_annotation` is the bracket text without brackets, or None to
    leave no transition annotation."""
    existing = match.group("ann")
    task_id = match.group("id")
    rest = match.group("rest")

    # Determine if existing annotation is structural (keep) or transition (drop).
    keep_ann: str | None = None
    if existing is not None and not TRANSITION_ANN_RE.match(existing):
        keep_ann = existing

    # Compose final annotation: prefer new_annotation (transition); else keep structural.
    final_ann = new_annotation if new_annotation is not None else keep_ann

    if final_ann is None:
        return f"- {task_id} {rest}"
    return f"- [{final_ann}] {task_id} {rest}"


def move_card(
    columns: dict[str, list[str]],
    task_id: str,
    target_col: str,
    new_annotation: str | None,
) -> bool:
    """Move card to `target_col` with `new_annotation` (None for no transition
    annotation). Returns True iff anything changed."""
    located = find_card(columns, task_id)
    if located is None:
        return False
    src_col, idx, match = located
    new_line = rebuild_card_line(match, new_annotation)
    if src_col == target_col and columns[src_col][idx] == new_line:
        return False
    # Remove from source.
    columns[src_col].pop(idx)
    # Append to target.
    columns[target_col].append(new_line)
    return True


# --------------------------------------------------------------------------- #
# trigger handlers
# --------------------------------------------------------------------------- #
def handle_test_log(columns: dict[str, list[str]], task_id: str, content: str) -> bool:
    """First write with any non-empty content moves Backlog → In Progress.
    No-op if the card is already in In Progress, Review, or Done."""
    if not content.strip():
        return False
    located = find_card(columns, task_id)
    if located is None:
        return False
    src_col, _, _ = located
    if src_col != "Backlog":
        return False
    return move_card(columns, task_id, "In Progress", None)


def parse_done_md(text: str) -> tuple[str | None, str | None]:
    """Extract `status:` and (for hitl-block) the first non-empty line of
    `notes:` from a done.md file. The file is expected to start with a YAML
    front-matter block; we tolerate a leading block-only file as well."""
    # Try YAML front matter delimited by `---` lines.
    lines = text.splitlines()
    fm_lines: list[str]
    if lines and lines[0].strip() == "---":
        end = None
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                end = i
                break
        fm_lines = lines[1:end] if end is not None else lines[1:]
    else:
        fm_lines = lines

    status: str | None = None
    notes_first: str | None = None
    i = 0
    while i < len(fm_lines):
        line = fm_lines[i]
        m = re.match(r"^status:\s*(.+?)\s*$", line)
        if m and status is None:
            status = m.group(1).strip().strip('"').strip("'")
        m = re.match(r"^notes:\s*(.*)$", line)
        if m and notes_first is None:
            inline = m.group(1).strip()
            # Strip quotes and surrounding YAML pipe/folded markers.
            inline_clean = inline.lstrip("|>").strip().strip('"').strip("'")
            if inline_clean:
                notes_first = inline_clean
            else:
                # Look at subsequent indented / list lines.
                j = i + 1
                while j < len(fm_lines):
                    sub = fm_lines[j]
                    if not sub.strip():
                        j += 1
                        continue
                    if sub.startswith((" ", "\t", "-")):
                        text_val = sub.strip()
                        if text_val.startswith("- "):
                            text_val = text_val[2:].strip()
                        text_val = text_val.strip('"').strip("'")
                        if text_val:
                            notes_first = text_val
                            break
                        j += 1
                        continue
                    break
        i += 1
    return status, notes_first


def handle_done(columns: dict[str, list[str]], task_id: str, text: str) -> bool:
    status, notes = parse_done_md(text)
    if status is None:
        return False
    status = status.lower()
    if status == "green":
        return move_card(columns, task_id, "Review", None)
    if status == "failed":
        return move_card(columns, task_id, "In Progress", "failed")
    if status == "hitl-block":
        reason = notes if notes else "see done.md"
        return move_card(columns, task_id, "Backlog", f"HITL-blocked: {reason}")
    return False


def handle_smoke(columns: dict[str, list[str]], text: str) -> bool:
    """Promote every card in Review to Done iff the report has no FAIL lines."""
    if not text.strip():
        return False
    if re.search(r"\*\*Result:\*\*\s*FAIL\b", text):
        return False
    if not columns["Review"]:
        return False
    changed = False
    # Iterate over a snapshot since move_card mutates columns.
    for line in list(columns["Review"]):
        m = CARD_RE.match(line)
        if not m:
            continue
        if move_card(columns, m.group("id"), "Done", None):
            changed = True
    return changed


# --------------------------------------------------------------------------- #
# atomic write
# --------------------------------------------------------------------------- #
def atomic_write(path: Path, content: str) -> None:
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError, OSError):
        return 0
    if not isinstance(payload, dict):
        return 0

    if payload.get("tool_name") not in TOOL_WHITELIST:
        return 0

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return 0
    file_path = tool_input.get("file_path")
    if not isinstance(file_path, str) or not file_path:
        return 0

    cwd = payload.get("cwd")
    if not isinstance(cwd, str) or not cwd:
        return 0

    active = find_active(Path(cwd))
    if active is None:
        return 0
    workspace_root, project = active

    project_dir = (workspace_root / ".loom" / project).resolve()
    try:
        target = Path(file_path).resolve()
        rel = target.relative_to(project_dir)
    except (ValueError, OSError):
        return 0
    rel_str = rel.as_posix()

    # Match against watched patterns; bail fast otherwise.
    test_log_m = TEST_LOG_RE.match(rel_str)
    done_m = DONE_RE.match(rel_str)
    is_smoke = rel_str == "smoke-report.md"
    if not (test_log_m or done_m or is_smoke):
        return 0

    board_path = project_dir / "board.md"
    if not board_path.is_file():
        return 0

    try:
        board_text = board_path.read_text(encoding="utf-8")
    except OSError:
        return 0
    parsed = parse_board(board_text)
    if parsed is None:
        return 0
    original_lines, columns, ranges = parsed

    # Read the triggering file (may have been just-written; tolerate missing).
    try:
        trigger_text = target.read_text(encoding="utf-8") if target.is_file() else ""
    except OSError:
        trigger_text = ""

    changed = False
    if test_log_m is not None:
        changed = handle_test_log(columns, test_log_m.group(1), trigger_text)
    elif done_m is not None:
        changed = handle_done(columns, done_m.group(1), trigger_text)
    elif is_smoke:
        changed = handle_smoke(columns, trigger_text)

    if not changed:
        return 0

    new_text = render_board(original_lines, columns, ranges)
    if new_text == board_text:
        return 0
    try:
        atomic_write(board_path, new_text)
    except OSError:
        return 0
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        raise SystemExit(0)
