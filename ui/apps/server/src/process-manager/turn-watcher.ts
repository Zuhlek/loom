export interface TurnWatcherEvent {
  chatId: string;
  kind: "assistant-turn-complete" | string;
}

export interface TurnWatcherOptions {
  onAssistantTurnComplete: (chatId: string, turn: number, cwd: string) => void | Promise<void>;
}

export interface TurnSubscription {
  stop(): void;
}

export interface TurnWatcher {
  start(chatId: string, cwd: string): TurnSubscription;
  observeEvent(event: TurnWatcherEvent): void;
}

export function createTurnWatcher(opts: TurnWatcherOptions): TurnWatcher {
  const tracked = new Map<string, { cwd: string; lastTurn: number }>();

  return {
    start(chatId, cwd) {
      tracked.set(chatId, { cwd, lastTurn: 0 });
      return {
        stop() {
          tracked.delete(chatId);
        },
      };
    },
    observeEvent(event) {
      if (!event || typeof event !== "object") return;
      if (event.kind !== "assistant-turn-complete") return;
      if (typeof event.chatId !== "string") return;
      const state = tracked.get(event.chatId);
      if (!state) return;
      state.lastTurn += 1;
      void Promise.resolve(opts.onAssistantTurnComplete(event.chatId, state.lastTurn, state.cwd));
    },
  };
}
