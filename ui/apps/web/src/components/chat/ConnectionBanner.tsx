/**
 * ConnectionBanner — surfaces a degraded RAW browser↔loom-server
 * WebSocket so a transport outage isn't only knowable from the ~6px
 * `conn-status-dot` in the far bottom-right rail.
 *
 * LAYERING — this is the transport socket the route owns, a DIFFERENT
 * layer from `SessionLifecycle` ("active" | "recovering" | "failed"):
 *
 *   • `SessionRecoveryBanner` owns the claude-session respawn window
 *     (lifecycle != "active"). To avoid stacking two banners in the
 *     same region, THIS component yields entirely while a recovery is
 *     in flight — it returns null unless `lifecycle === "active"`.
 *   • The route auto-reconnects the socket (~1s, up to ~10 attempts)
 *     on a non-user close, so there is no manual reconnect button here.
 *
 * Copy by `conn` (once shown):
 *   • `closed`               → RED (hard): "Connection lost" /
 *     "Reconnecting…" — the socket dropped; the route is retrying.
 *   • `connecting` / `idle`  → YELLOW (soft): "Reconnecting…" /
 *     "Trying to restore the live connection."
 *   • `open`                 → null (nothing to surface).
 *
 * GRACE DELAY — the fast initial connect (idle→connecting→open,
 * typically <500ms) and sub-second blips must not flash a banner. So a
 * degraded `conn` is held behind a {@link CONN_BANNER_GRACE_MS} timer
 * before it shows; a return to `open` resets immediately. Only a
 * genuine ≥1s degradation renders. Mirrors F6's bounded-timer effect
 * pattern (see `ComposerSlashMenu`).
 *
 * Styling deliberately mirrors `SessionRecoveryBanner` so it reads as
 * native: same `mx-5 mb-2 …` shell, same yellow / red palettes.
 */
import { useEffect, useState } from "react";

import type { ConnState, SessionLifecycle } from "../../lib/chat-types";

/**
 * How long a degraded connection must persist before the banner is
 * shown. Swallows the fast initial connect and sub-second reconnect
 * blips so they never flash.
 */
export const CONN_BANNER_GRACE_MS = 1_000;

export interface ConnectionBannerProps {
  conn: ConnState;
  lifecycle: SessionLifecycle;
}

export function ConnectionBanner({ conn, lifecycle }: ConnectionBannerProps) {
  // Gate: while a session recovery is in flight SessionRecoveryBanner
  // owns the region; never stack. Open socket has nothing to surface.
  const suppressed = lifecycle !== "active" || conn === "open";

  // Grace timer: only flip `armed` true once the connection has been
  // CONTINUOUSLY degraded past CONN_BANNER_GRACE_MS. Resets immediately
  // when the banner is suppressed (open / recovering).
  //
  // Keyed on `suppressed` ONLY — deliberately NOT on `conn`. During a
  // real outage the route's reconnect loop flaps `conn` between
  // "connecting" and "closed" roughly every second (onclose → "closed",
  // retry after 1s → "connecting", immediate close → "closed", …). If we
  // re-armed on every `conn` change the grace timer would be cleared and
  // restarted before it could ever fire, so the banner would never
  // appear during the exact outage it exists to surface. `suppressed`
  // only flips when degradation STARTS or ENDS, so the timer runs once
  // across the whole degraded window; the red/yellow copy still tracks
  // the live `conn` because it's read at render, not in this effect.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (suppressed) {
      setArmed(false);
      return;
    }
    const timer = setTimeout(() => setArmed(true), CONN_BANNER_GRACE_MS);
    return () => clearTimeout(timer);
  }, [suppressed]);

  if (suppressed || !armed) return null;

  const isHard = conn === "closed";
  const headline = isHard ? "Connection lost" : "Reconnecting…";
  const subLine = isHard
    ? "Reconnecting…"
    : "Trying to restore the live connection.";

  return (
    <div
      role="alert"
      data-testid="connection-banner"
      data-conn={conn}
      className="mx-5 mb-2 px-3 py-2 rounded-md text-[12px] flex items-start gap-3"
      style={{
        background: isHard ? "rgba(239,68,68,0.10)" : "rgba(234,179,8,0.10)",
        color: "var(--foreground)",
        border: isHard
          ? "1px solid rgba(239,68,68,0.25)"
          : "1px solid rgba(234,179,8,0.25)",
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium">{headline}</div>
        <div className="opacity-70 mt-0.5">{subLine}</div>
      </div>
    </div>
  );
}
