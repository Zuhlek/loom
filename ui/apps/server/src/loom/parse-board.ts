/**
 * Parse a board.md into kanban columns.
 *
 * Recognized headers (case-insensitive, in any order):
 *   ## Backlog
 *   ## In Progress (or Ready / Blocked → mapped to Backlog)
 *   ## Review
 *   ## Done
 *
 * Each line under a header that starts with `- T-NNN ...` becomes a
 * card. Tasks not under any of these headings (e.g. plain `## Ready`)
 * default to Backlog.
 */
export type Column = "Backlog" | "In Progress" | "Review" | "Done";

export interface BoardCard {
  id: string;
  title: string;
  raw: string;
}

export interface ParsedBoard {
  columns: Record<Column, BoardCard[]>;
}

const COLUMN_ALIASES: Record<string, Column> = {
  backlog: "Backlog",
  ready: "Backlog",
  blocked: "Backlog",
  "in progress": "In Progress",
  inprogress: "In Progress",
  doing: "In Progress",
  review: "Review",
  done: "Done",
};

const TASK_LINE = /^-\s*(?:\[[^\]]*\]\s*)?(T-\d+)\s+(?:\[[^\]]*\]\s*)?(.*?)\s*$/i;

export function parseBoard(md: string): ParsedBoard {
  const columns: Record<Column, BoardCard[]> = {
    Backlog: [],
    "In Progress": [],
    Review: [],
    Done: [],
  };
  let cur: Column = "Backlog";
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##+\s+(.*)$/);
    if (h) {
      const lc = h[1].trim().toLowerCase();
      cur = COLUMN_ALIASES[lc] ?? "Backlog";
      continue;
    }
    const m = line.match(TASK_LINE);
    if (m) {
      const [, id, rest] = m;
      // Pull title up to the first `(blocked by …)` if present.
      const title = rest.replace(/\s*\(blocked by[^\)]+\)\s*/i, "").trim();
      columns[cur].push({ id, title, raw: line.trim() });
    }
  }
  return { columns };
}
