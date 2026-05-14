/**
 * React hook owning the live-chat bridge-supplied catalogs that ride
 * dedicated frames (i.e. not `ChatSnapshot` body). For now this covers
 * the SDK-enumerated slash-command catalog delivered via
 * `slash-commands-update`. The hook holds `null` until the first frame
 * lands so consumers (`ComposerSlashMenu`) can render the ADR-D02
 * "Loading commands…" affordance.
 *
 * The hook is shape-agnostic about the WebSocket — the route layer
 * (`live-chat.tsx`) already owns the socket and message switch. The
 * hook exposes `handleServerFrame` so the existing switch can route
 * the relevant frames in one call; `reset` is fired on chat-id change
 * to clear the cached catalog between attaches.
 */
import { useCallback, useState } from "react";
import type { ServerFrame, WireSlashCommand } from "./chat-types";

export interface ChatBridge {
  /** Last `slash-commands-update` payload; `null` until first frame. */
  slashCommands: WireSlashCommand[] | null;
  /** Route a server frame through the bridge — no-ops on irrelevant kinds. */
  handleServerFrame: (frame: ServerFrame) => void;
  /** Drop cached state when the active chat-id changes. */
  reset: () => void;
}

export function useChatBridge(): ChatBridge {
  const [slashCommands, setSlashCommands] = useState<WireSlashCommand[] | null>(null);

  const handleServerFrame = useCallback((frame: ServerFrame) => {
    if (frame.kind === "slash-commands-update") {
      setSlashCommands(frame.body.commands);
    }
  }, []);

  const reset = useCallback(() => {
    setSlashCommands(null);
  }, []);

  return { slashCommands, handleServerFrame, reset };
}
