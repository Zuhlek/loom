import type { CheckpointStore } from "./checkpoint-store.ts";
import type {
  CheckpointCapturedFrame,
  ServerFrame,
} from "../chat-protocol/frames.ts";

export interface CheckpointReactorOptions {
  store: CheckpointStore;
  emit: (frame: ServerFrame) => void;
}

export interface CheckpointReactor {
  captureTurn(chatId: string, turn: number, cwd: string): Promise<void>;
}

export function createCheckpointReactor(opts: CheckpointReactorOptions): CheckpointReactor {
  return {
    async captureTurn(chatId, turn, cwd) {
      try {
        const result = await opts.store.captureTurn({ chatId, cwd, turn });
        if (!result) return;
        const frame: CheckpointCapturedFrame = {
          kind: "checkpoint-captured",
          "chat-id": chatId,
          body: { turn, ref: result.ref },
        };
        opts.emit(frame);
      } catch (err) {
        console.warn(
          `[loom] checkpoint capture failed for chat ${chatId} turn ${turn}: ${(err as Error).message}`,
        );
      }
    },
  };
}
