/**
 * permission-gate.ts — the bridge between Claude Code's *synchronous*
 * PreToolUse hook and loom's *asynchronous* web-UI permission popup.
 *
 * Why this exists
 * ───────────────
 * A `PreToolUse` hook command BLOCKS the agent: claude waits for the hook
 * process to exit and reads its stdout for a permission decision. loom's
 * hook is a `curl` that POSTs to `/hooks/event`; if the server answers
 * immediately the agent is NOT held — it proceeds (or falls to its own TUI
 * prompt), so the web popup is a non-authoritative mirror and answering it
 * later injects stray keystrokes into a pane that has moved on.
 *
 * The fix: for a gated tool the receiver registers a gate here and AWAITS
 * it, holding the HTTP response open. The held curl keeps the agent blocked.
 * When the user answers in the UI (WS `permission-response` → bridge
 * `respondToPermission`) we `resolve()` the gate; the receiver then returns
 * the curl a real `hookSpecificOutput.permissionDecision`, which claude
 * honours WITHOUT showing its own prompt. One surface, no keystroke racing.
 *
 * Timeout discipline
 * ──────────────────
 * Claude's default `command` hook timeout is 600s and a timed-out PreToolUse
 * is treated as `defer` → claude's own prompt. Since loom hides the TUI and
 * no longer injects permission keystrokes, that path would STRAND the agent
 * at an invisible prompt. So the gate resolves itself with an explicit
 * `deny` *before* the hook/curl timeout fires (`timeoutMs`, default 29min,
 * sits below the installer's 1800s curl `--max-time` / hook `timeout`).
 */

export type PermissionDecision = "allow" | "deny" | "ask" | "defer";

export interface GateResolution {
  decision: PermissionDecision;
  /** Surfaced to claude as `permissionDecisionReason`. */
  reason?: string;
}

export interface PermissionGate {
  /**
   * Register a pending gate and return a promise that settles when the gate
   * is resolved, swept by `rejectAll`, or auto-denied on timeout. Re-using a
   * live (chatId, id) resolves the prior registration with `defer` first so
   * its held curl is released rather than leaked.
   */
  register(chatId: string, id: string): Promise<GateResolution>;
  /**
   * Resolve a pending gate (from a WS `permission-response`). Returns false
   * when no such gate is registered (e.g. it already timed out).
   */
  resolve(chatId: string, id: string, resolution: GateResolution): boolean;
  /**
   * Settle every pending gate for a chat with one resolution. Used on
   * Stop / SubagentStop / dispose so held curls never dangle.
   */
  rejectAll(chatId: string, resolution: GateResolution): void;
  /** Count of currently-pending gates (optionally scoped to one chat). */
  pendingCount(chatId?: string): number;
}

export interface PermissionGateOptions {
  /**
   * Auto-resolve an unanswered gate after this many ms. Must stay below the
   * installed curl `--max-time` / hook `timeout` (1800s) so we always answer
   * the curl ourselves instead of letting it time out into `defer`.
   * Default 1_740_000 (29 min).
   */
  timeoutMs?: number;
  /** Resolution applied on timeout. Default `deny` with an explanatory reason. */
  onTimeout?: GateResolution;
}

interface GateEntry {
  resolve(resolution: GateResolution): void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_TIMEOUT_MS = 29 * 60 * 1000;
const DEFAULT_TIMEOUT_RESOLUTION: GateResolution = {
  decision: "deny",
  reason: "Loom: permission request timed out with no response from the UI.",
};

export function createPermissionGate(
  options: PermissionGateOptions = {},
): PermissionGate {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const onTimeout = options.onTimeout ?? DEFAULT_TIMEOUT_RESOLUTION;
  // chatId → (gateId → entry)
  const byChat = new Map<string, Map<string, GateEntry>>();

  function chatMap(chatId: string): Map<string, GateEntry> {
    let m = byChat.get(chatId);
    if (!m) {
      m = new Map();
      byChat.set(chatId, m);
    }
    return m;
  }

  function settle(
    chatId: string,
    id: string,
    entry: GateEntry,
    resolution: GateResolution,
  ): void {
    if (entry.timer) clearTimeout(entry.timer);
    const m = byChat.get(chatId);
    m?.delete(id);
    if (m && m.size === 0) byChat.delete(chatId);
    entry.resolve(resolution);
  }

  return {
    register(chatId, id) {
      // A re-registered (chatId, id) means the prior curl is still in flight;
      // release it with `defer` so claude falls back to normal evaluation
      // rather than leaving the old promise dangling. settle() may drop the
      // chat's now-empty map, so fetch a fresh map AFTERWARDS — otherwise the
      // new entry lands in an orphaned map and is never resolvable.
      const existing = byChat.get(chatId)?.get(id);
      if (existing) settle(chatId, id, existing, { decision: "defer" });
      const m = chatMap(chatId);

      return new Promise<GateResolution>((resolvePromise) => {
        const entry: GateEntry = { resolve: resolvePromise, timer: undefined };
        const timer = setTimeout(() => {
          // Re-fetch: the entry may have been resolved between scheduling and
          // firing. settle() is idempotent against a missing map entry.
          const cur = byChat.get(chatId)?.get(id);
          if (cur === entry) settle(chatId, id, entry, onTimeout);
        }, timeoutMs);
        // Never keep the process alive purely for a pending permission.
        (timer as { unref?: () => void }).unref?.();
        entry.timer = timer;
        m.set(id, entry);
      });
    },

    resolve(chatId, id, resolution) {
      const entry = byChat.get(chatId)?.get(id);
      if (!entry) return false;
      settle(chatId, id, entry, resolution);
      return true;
    },

    rejectAll(chatId, resolution) {
      const m = byChat.get(chatId);
      if (!m) return;
      // Snapshot entries first — settle() mutates the map.
      for (const [id, entry] of [...m]) settle(chatId, id, entry, resolution);
    },

    pendingCount(chatId) {
      if (chatId !== undefined) return byChat.get(chatId)?.size ?? 0;
      let total = 0;
      for (const m of byChat.values()) total += m.size;
      return total;
    },
  };
}
