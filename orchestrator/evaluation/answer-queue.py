#!/usr/bin/env python3
"""Answer queue CLI for non-interactive /weave runs.

Reads (and optionally mutates) `.loom/<project>/.answers.yaml` — a strict
subset of YAML defined by ADR-006 in `design.md`. Two subcommands:

    peek <project>           — emit JSON for the next entry; do not mutate.
    pop  <project> [--q-id Q]
                             — same, but remove the consumed entry. With
                               --q-id, pops the first match for that id;
                               without, pops FIFO.

JSON shape on stdout:
    {"q_id": "Q01", "answer": "B"}     # full entry
    {"answer": "(A)"}                  # FIFO entry without a q_id
    {}                                 # empty queue / no match / no file

All file mutations go through tmp + os.replace for POSIX-atomic rename.

Strict-subset YAML grammar (ADR-006):

    answers:
      - q_id: <id>            # optional
        answer: <scalar>
      - answer: <scalar>      # FIFO entry, no q_id

Scalar values may be bare (B, YES, 12) or single-or-double-quoted (the parser
strips one layer of matching quotes). No anchors, no flow style, no nested
mappings, no multiline scalars. Comments (lines starting with #, optionally
indented) are skipped; trailing inline comments are NOT supported (kept out
of grammar deliberately).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


# --------------------------------------------------------------------------
# Strict-subset YAML parser
# --------------------------------------------------------------------------


class YamlSubsetError(ValueError):
    """Raised when input violates the strict-subset grammar.

    The error message always includes the offending 1-indexed line number
    so the user can find and fix the issue without a stack trace.
    """


def _strip_quotes(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        return s[1:-1]
    return s


def parse_answers_yaml(text: str) -> list[dict[str, str]]:
    """Parse a strict-subset YAML answer queue.

    Returns a list of `{q_id?: str, answer: str}` dicts. `q_id` is omitted
    (NOT None) when the entry has no q_id binding.

    Raises YamlSubsetError on any out-of-grammar input.
    """
    lines = text.splitlines()
    i = 0
    n = len(lines)

    # Skip blank / comment lines until we hit the top-level `answers:` key.
    while i < n:
        raw = lines[i]
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        break

    if i >= n:
        # Empty document (only whitespace/comments). Per design, treat as no
        # top-level key — reject to surface a clear error rather than
        # silently returning [].
        raise YamlSubsetError(
            "missing required top-level key `answers:` (file has no content)"
        )

    # Expect `answers:` at column 0.
    line = lines[i]
    if not line.startswith("answers:"):
        raise YamlSubsetError(
            f"line {i + 1}: expected top-level key `answers:` at column 0, got {line!r}"
        )
    # Allow `answers:` followed by nothing, or `answers: []` (empty inline list).
    after = line[len("answers:"):].strip()
    i += 1
    if after == "[]":
        # Empty inline list. Reject any further non-blank lines.
        while i < n:
            rest = lines[i].strip()
            if rest and not rest.startswith("#"):
                raise YamlSubsetError(
                    f"line {i + 1}: unexpected content after `answers: []`: {lines[i]!r}"
                )
            i += 1
        return []
    if after:
        raise YamlSubsetError(
            f"line {i}: unexpected content after `answers:`: {after!r}"
            " (expected newline or `[]`)"
        )

    entries: list[dict[str, str]] = []
    current: dict[str, str] | None = None

    # Each entry: a `- key: value` line followed by zero or more `  key: value`
    # continuation lines (indented further than the `-`). We accept any
    # consistent indent (2 or 4 spaces) for entry openings, but every entry
    # opener must use the SAME indent across the document.
    entry_indent: int | None = None
    cont_indent: int | None = None

    def _flush() -> None:
        nonlocal current
        if current is not None:
            if "answer" not in current:
                raise YamlSubsetError(
                    f"entry ending at line {i}: missing required key `answer:`"
                )
            entries.append(current)
            current = None

    while i < n:
        raw = lines[i]
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue

        # Determine indent (count of leading spaces; tabs not allowed in the
        # subset grammar).
        if "\t" in raw[: len(raw) - len(raw.lstrip())]:
            raise YamlSubsetError(
                f"line {i + 1}: tabs are not allowed for indentation"
            )
        indent = len(raw) - len(raw.lstrip(" "))
        content = raw[indent:]

        if content.startswith("- "):
            # Entry opener.
            if entry_indent is None:
                entry_indent = indent
            elif indent != entry_indent:
                raise YamlSubsetError(
                    f"line {i + 1}: inconsistent indentation for entry opener"
                    f" (expected {entry_indent} spaces, got {indent})"
                )
            _flush()
            current = {}
            key_value = content[2:]  # after "- "
            key, value = _parse_key_value(key_value, i + 1)
            current[key] = value
            # Continuation indent must be entry_indent + 2 (the column under
            # the first char of the key).
            cont_indent = entry_indent + 2
            i += 1
            continue

        if current is None:
            raise YamlSubsetError(
                f"line {i + 1}: unexpected content {content!r}"
                " (expected an entry starting with `- `)"
            )
        # Continuation line.
        if cont_indent is not None and indent != cont_indent:
            raise YamlSubsetError(
                f"line {i + 1}: inconsistent continuation indent"
                f" (expected {cont_indent} spaces, got {indent})"
            )
        key, value = _parse_key_value(content, i + 1)
        if key in current:
            raise YamlSubsetError(
                f"line {i + 1}: duplicate key {key!r} in entry"
            )
        current[key] = value
        i += 1

    _flush()
    return entries


def _parse_key_value(text: str, lineno: int) -> tuple[str, str]:
    """Split `key: value` once. Raise on malformed input."""
    if ":" not in text:
        raise YamlSubsetError(
            f"line {lineno}: expected `key: value`, got {text!r}"
        )
    key_part, value_part = text.split(":", 1)
    key = key_part.strip()
    if not key:
        raise YamlSubsetError(
            f"line {lineno}: empty key in {text!r}"
        )
    if key not in ("q_id", "answer"):
        raise YamlSubsetError(
            f"line {lineno}: unknown key {key!r} (allowed: q_id, answer)"
        )
    value = _strip_quotes(value_part.strip())
    if not value:
        raise YamlSubsetError(
            f"line {lineno}: empty value for key {key!r}"
        )
    return key, value


# --------------------------------------------------------------------------
# Serialiser (round-trip via parsed form)
# --------------------------------------------------------------------------


def serialize_answers(entries: list[dict[str, str]], *, header: str | None = None) -> str:
    """Render entries back to strict-subset YAML.

    Quotes the `answer` value in double quotes if it would otherwise be
    ambiguous (contains punctuation, starts with `(`, etc.). q_id is always
    rendered bare since it matches `Q\\d+`-style ids.
    """
    out: list[str] = []
    if header:
        for h in header.splitlines():
            out.append(h)
    if not entries:
        out.append("answers: []")
        return "\n".join(out) + "\n"
    out.append("answers:")
    for entry in entries:
        first = True
        if "q_id" in entry:
            out.append(f"  - q_id: {entry['q_id']}")
            out.append(f"    answer: {_quote(entry['answer'])}")
            first = False
        else:
            out.append(f"  - answer: {_quote(entry['answer'])}")
            first = False
        # `first` left as a marker; flake silenced.
        del first
    return "\n".join(out) + "\n"


def _quote(s: str) -> str:
    # If the value would be ambiguous unquoted, wrap in double quotes.
    # Bare ok: ASCII letters/digits/underscore/dash, length >= 1, no leading
    # special char.
    safe = (
        s
        and all(c.isalnum() or c in "_-" for c in s)
        and not s[0].isdigit() is False  # purely alnum is fine
    )
    # Always quote to keep round-tripping simple and unambiguous. Avoid the
    # subtle bare-string edge cases.
    return '"' + s.replace('"', '\\"') + '"'


# --------------------------------------------------------------------------
# Atomic write helper
# --------------------------------------------------------------------------


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # NamedTemporaryFile in the same directory so os.replace is on the same fs.
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _answers_path(project: str) -> Path:
    root = Path(os.environ.get("LOOM_ROOT", ".loom"))
    return root / project / ".answers.yaml"


def _load(project: str) -> tuple[list[dict[str, str]], str | None, Path]:
    """Return (entries, header, path). header is the comment-only prologue,
    preserved across pop mutations so user-authored notes survive."""
    path = _answers_path(project)
    if not path.exists():
        return [], None, path
    text = path.read_text(encoding="utf-8")
    # Preserve a comment-only header prologue.
    header_lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            header_lines.append(line)
        else:
            break
    header = "\n".join(header_lines) if header_lines else None
    entries = parse_answers_yaml(text)
    return entries, header, path


def _emit(entry: dict[str, str] | None) -> None:
    if entry is None:
        sys.stdout.write("{}\n")
    else:
        sys.stdout.write(json.dumps(entry) + "\n")


def cmd_peek(project: str) -> int:
    entries, _, _ = _load(project)
    _emit(entries[0] if entries else None)
    return 0


def cmd_pop(project: str, q_id: str | None) -> int:
    entries, header, path = _load(project)
    if not entries:
        _emit(None)
        return 0

    idx = -1
    if q_id is not None:
        for i, e in enumerate(entries):
            if e.get("q_id") == q_id:
                idx = i
                break
        if idx < 0:
            _emit(None)
            return 0
    else:
        idx = 0

    popped = entries.pop(idx)
    atomic_write_text(path, serialize_answers(entries, header=header))
    _emit(popped)
    return 0


def cmd_validate(path: str) -> int:
    p = Path(path)
    if not p.exists():
        print(f"answer-queue: file not found: {path}", file=sys.stderr)
        return 2
    parse_answers_yaml(p.read_text(encoding="utf-8"))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Peek/pop/validate the .answers.yaml queue for a Loom project."
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_peek = sub.add_parser("peek", help="emit the next entry as JSON; do not mutate")
    p_peek.add_argument("project")

    p_pop = sub.add_parser("pop", help="emit and remove the next entry")
    p_pop.add_argument("project")
    p_pop.add_argument("--q-id", dest="q_id", default=None,
                       help="match the first entry with this q_id (else FIFO)")

    p_validate = sub.add_parser("validate", help="parse a queue file; exit 0 if valid, 2 otherwise")
    p_validate.add_argument("path")

    args = parser.parse_args(argv)

    try:
        if args.cmd == "peek":
            return cmd_peek(args.project)
        if args.cmd == "pop":
            return cmd_pop(args.project, args.q_id)
        if args.cmd == "validate":
            return cmd_validate(args.path)
    except YamlSubsetError as exc:
        print(f"answer-queue: {exc}", file=sys.stderr)
        return 2

    parser.error(f"unknown command: {args.cmd!r}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
