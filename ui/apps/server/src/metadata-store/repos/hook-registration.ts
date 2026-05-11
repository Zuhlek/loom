/**
 * HookRegistration repository.
 */
import type { InMemoryStorage } from "../index.ts";

export interface HookRegistrationRow {
  marker: string;
  port: number;
  scope: "user";
  installed_at: string;
}

export interface HookRegistrationRepo {
  upsert(h: { marker: string; port: number; scope?: "user" }): HookRegistrationRow;
  get(marker: string): HookRegistrationRow | null;
  list(): HookRegistrationRow[];
  delete(marker: string): boolean;
}

export function hookRegistrationRepo(storage: InMemoryStorage): HookRegistrationRepo {
  return {
    upsert({ marker, port, scope }) {
      const row: HookRegistrationRow = {
        marker,
        port,
        scope: scope ?? "user",
        installed_at: new Date().toISOString(),
      };
      storage.hookRegistrations.set(marker, row);
      return row;
    },
    get(marker) {
      return storage.hookRegistrations.get(marker) ?? null;
    },
    list() {
      return Array.from(storage.hookRegistrations.values());
    },
    delete(marker) {
      return storage.hookRegistrations.delete(marker);
    },
  };
}
