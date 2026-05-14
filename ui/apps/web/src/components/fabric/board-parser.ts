/**
 * Parse `board.md` into the {@link KanbanColumn} shape consumed by
 * {@link KanbanView}. Tolerant of the four heading variants in use
 * across the project (`Backlog`/`Pending`, `In Progress`/`In progress`,
 * `Review`, `Done`) and the four bullet shapes (bare id, linked id,
 * bold id, tag-prefixed id). Sub-bullets, trailing `## Notes` sections,
 * and `(none)` markers are dropped.
 */
import type { KanbanCard, KanbanColumn, Lane } from "./KanbanView";

const LANE_BY_HEADING: Record<string, Lane> = {
  backlog: "backlog",
  pending: "backlog",
  "in progress": "in-progress",
  review: "review",
  done: "done",
};

const LANE_ORDER: readonly Lane[] = ["backlog", "in-progress", "review", "done"];

const LANE_LABEL: Record<Lane, string> = {
  backlog: "Backlog",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
};

const NOISE_TAG = /^(commit\b|US-|AFK\b)/i;

export function parseBoardMarkdown(source: string): KanbanColumn[] {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const cards: Record<Lane, KanbanCard[]> = {
    backlog: [],
    "in-progress": [],
    review: [],
    done: [],
  };
  let lane: Lane | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      const key = heading[1].toLowerCase();
      lane = LANE_BY_HEADING[key] ?? null;
      continue;
    }
    if (lane === null) continue;
    const bullet = /^-\s+(.*)$/.exec(raw);
    if (!bullet) continue;
    const content = bullet[1].trim();
    if (/^\(?\s*none\s*\)?$/i.test(content)) continue;
    const card = parseCard(content, lane);
    if (card) cards[lane].push(card);
  }
  return LANE_ORDER.map((id) => ({ id, label: LANE_LABEL[id], cards: cards[id] }));
}

function parseCard(raw: string, lane: Lane): KanbanCard | null {
  const unwrapped = raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1");
  const idMatch = /T-\d[\w-]*/.exec(unwrapped);
  if (!idMatch) return null;
  const id = idMatch[0];
  const tags: string[] = [];
  for (const m of unwrapped.matchAll(/\[([^\]]+)\]/g)) {
    const inner = m[1].trim();
    if (NOISE_TAG.test(inner)) continue;
    tags.push(inner);
  }
  let after = unwrapped.slice(idMatch.index + id.length);
  after = after.replace(/\[[^\]]+\]/g, "");
  after = after.replace(/\([^)]*\)/g, "");
  after = after.replace(/^\s*[—–-]\s*/, "");
  const title = after.replace(/\s+/g, " ").trim();
  return {
    id,
    title: title.length > 0 ? title : id,
    tags: tags.length > 0 ? tags : undefined,
    done: lane === "done" ? true : undefined,
  };
}
