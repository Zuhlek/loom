/**
 * Project repository.
 */
import type { InMemoryStorage } from "../index.ts";

export interface ProjectRow {
  id: string;
  name: string;
  paths: string[];
  created_at: string;
}

export interface ProjectCreate {
  id?: string;
  name: string;
  paths: string[];
}

export interface ProjectRepo {
  create(p: ProjectCreate): ProjectRow;
  get(id: string): ProjectRow | null;
  getByName(name: string): ProjectRow | null;
  list(): ProjectRow[];
  addPath(id: string, p: string): ProjectRow | null;
  removePath(id: string, p: string): ProjectRow | null;
  update(id: string, patch: Partial<ProjectRow>): ProjectRow | null;
  delete(id: string): boolean;
}

function uuidish(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function projectRepo(storage: InMemoryStorage): ProjectRepo {
  return {
    create(p) {
      if (!p.paths || p.paths.length === 0) {
        throw new Error("Project requires at least one path");
      }
      const id = p.id ?? uuidish();
      const row: ProjectRow = {
        id,
        name: p.name,
        paths: Array.from(new Set(p.paths)),
        created_at: new Date().toISOString(),
      };
      storage.projects.set(id, row);
      return row;
    },
    get(id) {
      return storage.projects.get(id) ?? null;
    },
    getByName(name) {
      for (const r of storage.projects.values()) {
        if (r.name === name) return r;
      }
      return null;
    },
    list() {
      return Array.from(storage.projects.values());
    },
    addPath(id, p) {
      const r = storage.projects.get(id);
      if (!r) return null;
      if (!r.paths.includes(p)) r.paths = [...r.paths, p];
      return r;
    },
    removePath(id, p) {
      const r = storage.projects.get(id);
      if (!r) return null;
      r.paths = r.paths.filter((x: string) => x !== p);
      return r;
    },
    update(id, patch) {
      const r = storage.projects.get(id);
      if (!r) return null;
      const next = { ...r, ...patch };
      storage.projects.set(id, next);
      return next;
    },
    delete(id) {
      return storage.projects.delete(id);
    },
  };
}
