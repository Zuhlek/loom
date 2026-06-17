/**
 * WorkingChip — sibling timeline row showing three pulsing dots and a
 * live "Working for Xs" elapsed counter. Rendered by MessagesTimeline
 * at the bottom of the scroll container whenever the current turn's
 * `turnState === "running"` and the reducer has captured an
 * `activeTurnStartedAt`.
 *
 * Self-ticks every 1 s via `setInterval` — mirrors t3code's
 * WorkingTimer pattern at
 * docs/t3code-main/apps/web/src/components/chat/MessagesTimeline.tsx:528-536
 * — so the elapsed label updates at a regular 1 Hz cadence regardless
 * of parent re-render bursts (ADR-005). The `formatElapsed` helper
 * mirrors t3code's `formatWorkingTimer` (`:840-861`) verbatim:
 *
 *   • <60s              →  "Xs"
 *   • <1h, no seconds   →  "Xm"
 *   • <1h, with seconds →  "Xm Ys"
 *   • ≥1h, no minutes   →  "Xh"
 *   • ≥1h, with minutes →  "Xh Ym"
 *
 * No enter/exit animation (ADR-002) — the three dots' `animate-pulse`
 * is the chip's alive indicator, not a mount transition.
 */
import { useEffect, useState } from "react";

interface WorkingChipProps {
  /**
   * Millisecond epoch when the active turn entered the `running`
   * state. Owner: live-chat.tsx reducer's `activeTurnStartedAt`
   * field (ADR-005).
   */
  startedAtMs: number;
}

export function WorkingChip({ startedAtMs }: WorkingChipProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAtMs]);
  const label = formatElapsed(startedAtMs, nowMs);
  return (
    <div
      className="flex text-[11px]"
      style={{ color: "var(--muted-foreground)" }}
      data-testid="working-chip"
    >
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-[3px]">
          <span
            className="size-1 rounded-full animate-pulse"
            style={{ background: "var(--info)" }}
          />
          <span
            className="size-1 rounded-full animate-pulse [animation-delay:200ms]"
            style={{ background: "var(--info)" }}
          />
          <span
            className="size-1 rounded-full animate-pulse [animation-delay:400ms]"
            style={{ background: "var(--info)" }}
          />
        </span>
        <span>Working for {label}</span>
      </div>
    </div>
  );
}

/**
 * Pure elapsed formatter mirroring t3code's `formatWorkingTimer`
 * (`docs/t3code-main/apps/web/src/components/chat/MessagesTimeline.tsx:840-861`).
 * Returns "Xs" under a minute, "Xm Ys" / "Xm" under an hour,
 * "Xh Ym" / "Xh" above.
 */
function formatElapsed(startedAtMs: number, nowMs: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
