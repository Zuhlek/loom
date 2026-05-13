import type { DiffFile, DiffLine } from "../components/diff/DiffPanel";

export interface SynthesizeEditInput {
  filePath: string;
  oldString: string;
  newString: string;
}

export interface SynthesizeWriteInput {
  filePath: string;
  content: string;
}

const MAX_LINES_PER_SIDE = 1000;
const OVER_CAP_META = "… (input too large for line-diff; showing replacement)";

function splitLines(s: string): string[] {
  if (s === "") return [];
  // Strip per-line CR before splitting.
  const cleaned = s.replace(/\r\n/g, "\n").replace(/\r$/gm, "");
  return cleaned.split("\n");
}

/**
 * Line-level LCS over old/new. Emits one hunk with `equal → context`,
 * `insert → add`, `delete → del`, `replace → del then add`. Caps each side
 * at 1000 lines; over-cap → all-del-then-all-add with the explanatory meta
 * line. Status is always "modified".
 */
export function synthesizeEditDiff(input: SynthesizeEditInput): DiffFile {
  const oldLines = splitLines(input.oldString);
  const newLines = splitLines(input.newString);

  if (oldLines.length > MAX_LINES_PER_SIDE || newLines.length > MAX_LINES_PER_SIDE) {
    return overCapReplacement("modified", input.filePath, oldLines, newLines);
  }

  const ops = diffLines(oldLines, newLines);
  const hunk: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "equal") {
      hunk.push({ kind: "context", text: op.text });
    } else if (op.kind === "del") {
      hunk.push({ kind: "del", text: op.text });
      removed++;
    } else {
      hunk.push({ kind: "add", text: op.text });
      added++;
    }
  }

  return {
    path: input.filePath,
    status: "modified",
    added,
    removed,
    hunks: [hunk],
  };
}

/**
 * Emits one hunk of all-add lines for a new file. Status is "added". Same
 * 1000-line cap behaviour as `synthesizeEditDiff`.
 */
export function synthesizeWriteDiff(input: SynthesizeWriteInput): DiffFile {
  const lines = splitLines(input.content);
  if (lines.length > MAX_LINES_PER_SIDE) {
    return overCapReplacement("added", input.filePath, [], lines);
  }
  const hunk: DiffLine[] = lines.map((text) => ({ kind: "add", text }));
  return {
    path: input.filePath,
    status: "added",
    added: lines.length,
    removed: 0,
    hunks: [hunk],
  };
}

function overCapReplacement(
  status: "modified" | "added",
  filePath: string,
  oldLines: string[],
  newLines: string[],
): DiffFile {
  const hunk: DiffLine[] = [{ kind: "meta", text: OVER_CAP_META }];
  for (const t of oldLines) hunk.push({ kind: "del", text: t });
  for (const t of newLines) hunk.push({ kind: "add", text: t });
  return {
    path: filePath,
    status,
    added: newLines.length,
    removed: oldLines.length,
    hunks: [hunk],
  };
}

type Op =
  | { kind: "equal"; text: string }
  | { kind: "add"; text: string }
  | { kind: "del"; text: string };

/**
 * Line-level LCS edit script. Walks the standard LCS table to emit
 * (del, add, equal) ops with dels-before-adds at each replace boundary
 * (matches unified-diff convention and the renderer's expectations).
 */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;

  // LCS length table sized (n+1) × (m+1).
  const dp: Uint32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk forward emitting ops. At a replace boundary we collect runs of
  // dels then adds so all dels precede all adds within the run.
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "equal", text: a[i] });
      i++;
      j++;
      continue;
    }
    // Collect a run of dels + adds spanning this divergence.
    const dels: Op[] = [];
    const adds: Op[] = [];
    while (i < n && j < m && a[i] !== b[j]) {
      if (dp[i + 1][j] >= dp[i][j + 1]) {
        dels.push({ kind: "del", text: a[i] });
        i++;
      } else {
        adds.push({ kind: "add", text: b[j] });
        j++;
      }
    }
    for (const op of dels) ops.push(op);
    for (const op of adds) ops.push(op);
  }
  while (i < n) {
    ops.push({ kind: "del", text: a[i] });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "add", text: b[j] });
    j++;
  }
  return ops;
}
