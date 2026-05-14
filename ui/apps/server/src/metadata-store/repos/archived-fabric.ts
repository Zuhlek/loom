/**
 * Archived fabric repository.
 *
 * Stable id matches what the sidebar generates for a fabric entry:
 * `${projectId}__${fabricName}__${shortHash(cwd)}`. The on-disk
 * `.loom/<name>/` directory is left untouched; archiving is a UI
 * concern only.
 */
import type { InMemoryStorage } from "../index.ts";

export interface ArchivedFabricRow {
  id: string;
  projectId: string;
  fabricName: string;
  cwd: string;
  archived_at: string;
}

export interface ArchivedFabricRepo {
  archive(input: { id: string; projectId: string; fabricName: string; cwd: string }): ArchivedFabricRow;
  unarchive(id: string): boolean;
  list(): ArchivedFabricRow[];
  isArchived(id: string): boolean;
}

export function archivedFabricRepo(storage: InMemoryStorage): ArchivedFabricRepo {
  return {
    archive({ id, projectId, fabricName, cwd }) {
      const row: ArchivedFabricRow = {
        id,
        projectId,
        fabricName,
        cwd,
        archived_at: new Date().toISOString(),
      };
      storage.archivedFabrics.set(id, row);
      return row;
    },
    unarchive(id) {
      return storage.archivedFabrics.delete(id);
    },
    list() {
      return Array.from(storage.archivedFabrics.values());
    },
    isArchived(id) {
      return storage.archivedFabrics.has(id);
    },
  };
}
