import type { DiffFile, DiffLine, DiffStatus } from "../components/diff/DiffPanel";

/**
 * Walks `diff --git` boundaries and converts unified-diff text into DiffFile[].
 * Caps emitted hunks per file at 200 (truncated with a synthetic meta line).
 * Strips trailing `\r` from every line. Emits an empty-hunks DiffFile for
 * binary files (status derived from chunk headers).
 */
const MAX_HUNKS_PER_FILE = 200;
const TRUNCATED_META = "… (truncated)";

export function parseUnifiedDiff(input: string): DiffFile[] {
  if (!input) return [];

  // Strip trailing CR per line up front, then split. Empty trailing newline
  // yields an empty final element which we drop.
  const lines = input.replace(/\r$/gm, "").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  // Locate the file-block boundaries.
  const headerIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("diff --git ")) headerIdxs.push(i);
  }
  if (headerIdxs.length === 0) return [];

  const out: DiffFile[] = [];
  for (let h = 0; h < headerIdxs.length; h++) {
    const start = headerIdxs[h];
    const end = h + 1 < headerIdxs.length ? headerIdxs[h + 1] : lines.length;
    const block = lines.slice(start, end);
    const file = parseFileBlock(block);
    if (file) out.push(file);
  }
  return out;
}

function parseFileBlock(block: string[]): DiffFile | null {
  // First line is `diff --git a/<path> b/<path>` (paths may be quoted; we
  // ignore the header paths and prefer the `+++ b/...` / `rename to` markers).
  const header = block[0] ?? "";
  if (!header.startsWith("diff --git ")) return null;

  let status: DiffStatus = "modified";
  let postRenamePath: string | null = null;
  let plusPath: string | null = null;
  let isBinary = false;
  let renameSeen = false;

  // Scan pre-hunk metadata until the first `@@ ` or `Binary files` line.
  let bodyStart = block.length;
  for (let i = 1; i < block.length; i++) {
    const line = block[i];
    if (line.startsWith("@@ ")) {
      bodyStart = i;
      break;
    }
    if (line.startsWith("new file mode")) status = "added";
    else if (line.startsWith("deleted file mode")) status = "deleted";
    else if (line.startsWith("rename from ")) renameSeen = true;
    else if (line.startsWith("rename to ")) {
      renameSeen = true;
      postRenamePath = line.slice("rename to ".length);
    } else if (line.startsWith("+++ ")) {
      // `+++ b/<path>` or `+++ /dev/null`.
      const rest = line.slice(4).trim();
      plusPath = rest === "/dev/null" ? null : stripABPrefix(rest);
    } else if (line.startsWith("Binary files ")) {
      isBinary = true;
      bodyStart = i + 1;
      break;
    }
  }

  if (renameSeen && status === "modified") status = "renamed";

  // Determine the canonical path for the file.
  let path: string;
  if (postRenamePath) {
    path = postRenamePath;
  } else if (plusPath) {
    path = plusPath;
  } else if (status === "deleted") {
    // For deletes, +++ is /dev/null; recover the path from `--- a/<path>`.
    path = recoverDeletedPath(block);
  } else {
    path = recoverHeaderPath(header);
  }

  if (isBinary) {
    return {
      path,
      status,
      added: 0,
      removed: 0,
      hunks: [],
    };
  }

  // Parse the body into hunks. `bodyStart` points at the first `@@ ` line
  // (or past the block if no hunks).
  const hunks: DiffLine[][] = [];
  let added = 0;
  let removed = 0;
  let truncated = false;
  let current: DiffLine[] | null = null;

  const pushCurrent = () => {
    if (current) hunks.push(current);
    current = null;
  };

  for (let i = bodyStart; i < block.length; i++) {
    const line = block[i];
    if (line.startsWith("@@ ")) {
      pushCurrent();
      if (hunks.length >= MAX_HUNKS_PER_FILE) {
        truncated = true;
        break;
      }
      // Start a new hunk; the @@ subject (text after the second @@) is
      // available but the design uses meta lines only for truncation, so
      // we omit it here.
      current = [];
      continue;
    }
    if (current === null) {
      // Body content outside any hunk — ignore (e.g., stray index lines).
      continue;
    }
    if (line.startsWith("+")) {
      current.push({ kind: "add", text: line.slice(1) });
      added++;
    } else if (line.startsWith("-")) {
      current.push({ kind: "del", text: line.slice(1) });
      removed++;
    } else if (line.startsWith(" ")) {
      current.push({ kind: "context", text: line.slice(1) });
    } else if (line === "") {
      // Treat an empty line as a context line with empty text.
      current.push({ kind: "context", text: "" });
    } else if (line.startsWith("\\ ")) {
      // "\ No newline at end of file" — surface as meta.
      current.push({ kind: "meta", text: line });
    } else {
      // Unknown content; skip.
    }
  }
  if (!truncated) pushCurrent();
  if (truncated) {
    hunks.push([{ kind: "meta", text: TRUNCATED_META }]);
  }

  return { path, status, added, removed, hunks };
}

function stripABPrefix(raw: string): string {
  // Drop tab-suffixed timestamps emitted by some git configs.
  const tabIdx = raw.indexOf("\t");
  const head = tabIdx === -1 ? raw : raw.slice(0, tabIdx);
  if (head.startsWith("a/") || head.startsWith("b/")) return head.slice(2);
  return head;
}

function recoverDeletedPath(block: string[]): string {
  for (const line of block) {
    if (line.startsWith("--- ")) {
      const rest = line.slice(4).trim();
      if (rest === "/dev/null") continue;
      return stripABPrefix(rest);
    }
  }
  return recoverHeaderPath(block[0] ?? "");
}

function recoverHeaderPath(header: string): string {
  // `diff --git a/<path> b/<path>` — extract the b-path. Paths may contain
  // spaces; we naively grab everything after the last ` b/` token.
  const idx = header.lastIndexOf(" b/");
  if (idx === -1) return "";
  return header.slice(idx + 3);
}
