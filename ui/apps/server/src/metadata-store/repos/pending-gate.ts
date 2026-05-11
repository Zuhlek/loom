/**
 * PendingGate repository.
 *
 * Enforces ONE row per (chat_id, kind). Drives the awaiting-input badge.
 */
import type { InMemoryStorage } from "../index.ts";

export type GateKind = "askuserquestion" | "permissionrequest";

export interface PendingGateRow {
  chat_id: string;
  kind: GateKind;
  data: any;
  created_at: string;
}

export interface PendingGateRepo {
  upsert(g: { chatId: string; kind: GateKind; data: any }): PendingGateRow;
  get(chatId: string, kind: GateKind): PendingGateRow | null;
  list(): PendingGateRow[];
  listByChat(chatId: string): PendingGateRow[];
  delete(chatId: string, kind: GateKind): boolean;
  deleteByChat(chatId: string): number;
}

function key(c: string, k: string) {
  return `${c}|${k}`;
}

export function pendingGateRepo(storage: InMemoryStorage): PendingGateRepo {
  return {
    upsert({ chatId, kind, data }) {
      const row: PendingGateRow = {
        chat_id: chatId,
        kind,
        data,
        created_at: new Date().toISOString(),
      };
      storage.pendingGates.set(key(chatId, kind), row);
      return row;
    },
    get(chatId, kind) {
      return storage.pendingGates.get(key(chatId, kind)) ?? null;
    },
    list() {
      return Array.from(storage.pendingGates.values());
    },
    listByChat(chatId) {
      return Array.from(storage.pendingGates.values()).filter((g: any) => g.chat_id === chatId);
    },
    delete(chatId, kind) {
      return storage.pendingGates.delete(key(chatId, kind));
    },
    deleteByChat(chatId) {
      let count = 0;
      for (const k of Array.from(storage.pendingGates.keys())) {
        if ((k as string).startsWith(chatId + "|")) {
          storage.pendingGates.delete(k);
          count++;
        }
      }
      return count;
    },
  };
}
