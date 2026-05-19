/**
 * React hook owning the live-chat bridge-supplied catalogs that ride
 * dedicated frames (i.e. not `ChatSnapshot` body). Covers the
 * SDK-enumerated slash-command catalog delivered via
 * `slash-commands-update` and the per-turn context-window breakdown
 * delivered via `context-usage-update`. Each field holds `null` until
 * the first frame lands so consumers can render their loading
 * affordance ("Loading commands…" for the slash menu, `0%` for the
 * indicator).
 *
 * The hook is shape-agnostic about the WebSocket — the route layer
 * (`live-chat.tsx`) already owns the socket and message switch. The
 * hook exposes `handleServerFrame` so the existing switch can route
 * the relevant frames in one call; `reset` is fired on chat-id change
 * to clear the cached state between attaches.
 */
import { useCallback, useState } from "react";
import type { ServerFrame, WireSlashCommand } from "./chat-types";

/**
 * Per-chat context-window breakdown — mirror of the
 * `context-usage-update` frame body. Carried 1:1 from the bridge to
 * {@link ContextUsageIndicator}.
 */
export interface ContextUsageSnapshot {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
  model: string;
}

export interface ChatBridge {
  /** Last `slash-commands-update` payload; `null` until first frame. */
  slashCommands: WireSlashCommand[] | null;
  /** Last `context-usage-update` payload; `null` until first frame. */
  contextUsage: ContextUsageSnapshot | null;
  /** Route a server frame through the bridge — no-ops on irrelevant kinds. */
  handleServerFrame: (frame: ServerFrame) => void;
  /** Drop cached state when the active chat-id changes. */
  reset: () => void;
}

export function useChatBridge(): ChatBridge {
  const [slashCommands, setSlashCommands] = useState<WireSlashCommand[] | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsageSnapshot | null>(null);

  const handleServerFrame = useCallback((frame: ServerFrame) => {
    if (frame.kind === "slash-commands-update") {
      setSlashCommands(frame.body.commands);
    } else if (frame.kind === "context-usage-update") {
      setContextUsage(frame.body);
    }
  }, []);

  const reset = useCallback(() => {
    setSlashCommands(null);
    setContextUsage(null);
  }, []);

  return { slashCommands, contextUsage, handleServerFrame, reset };
}
