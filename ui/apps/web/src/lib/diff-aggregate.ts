import type { DiffFile } from "../components/diff/DiffPanel";
import type { ApiDiffSection } from "./api";
import { parseUnifiedDiff } from "./diff-parse";

/**
 * Dedupes per-turn sections by `file.path`; later section wins (preserves
 * final post-conversation state). Returns a flat DiffFile[] suitable for
 * direct consumption by DiffPanel in whole-conversation scope.
 */
export function aggregateSectionsByFile(sections: ApiDiffSection[]): DiffFile[] {
  // Iterate sections in input order, parsing each into DiffFile[] and
  // letting later occurrences replace earlier ones by path.
  const byPath = new Map<string, DiffFile>();
  for (const section of sections) {
    const files = parseUnifiedDiff(section.diff);
    for (const file of files) {
      byPath.set(file.path, file);
    }
  }
  return Array.from(byPath.values());
}
