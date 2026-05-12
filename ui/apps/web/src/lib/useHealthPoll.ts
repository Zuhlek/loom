/**
 * useHealthPoll — single-instance hook that polls /api/health and
 * exposes the global "is the backend reachable" signal as a stable
 * view. Per ADR-001: states are `online | probing | offline`. Only
 * `offline` shows the banner.
 *
 * The FSM is factored into a pure reducer so it's testable without
 * jsdom or fake timers. The hook itself is a thin scheduling shell
 * around the reducer + a stubbed `fetch`.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

export type HealthFsmState =
  | { kind: "online"; lastOnlineAt: number }
  | { kind: "probing"; sinceFailureAt: number; attempt: number; nextDelayMs: number }
  | { kind: "offline"; sinceFailureAt: number; attempt: number; nextDelayMs: number };

export interface HealthPollOptions {
  url?: string;
  intervalMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  graceMs?: number;
}

export type HealthFsmAction =
  | { type: "poll-ok"; t: number }
  | { type: "poll-fail"; t: number }
  | { type: "retry-now"; t: number };

export interface HealthPollState {
  isOffline: boolean;
  lastOnlineAt: number | null;
  offlineSince: number | null;
  retryNow(): void;
}

export const BACKEND_ONLINE_EVENT = "loom:backend-online";

const DEFAULTS: Required<HealthPollOptions> = {
  url: "/api/health",
  intervalMs: 5000,
  initialBackoffMs: 2000,
  maxBackoffMs: 30000,
  graceMs: 1500,
};

/**
 * Reducer-only FSM transitions. Time is passed in via the action so
 * the reducer is pure (no Date.now() inside).
 */
export function healthPollReducer(
  state: HealthFsmState,
  action: HealthFsmAction,
  opts: Required<HealthPollOptions>,
): HealthFsmState {
  switch (action.type) {
    case "poll-ok":
      return { kind: "online", lastOnlineAt: action.t };
    case "poll-fail": {
      if (state.kind === "online") {
        return {
          kind: "probing",
          sinceFailureAt: action.t,
          attempt: 1,
          nextDelayMs: opts.initialBackoffMs,
        };
      }
      const elapsed = action.t - state.sinceFailureAt;
      const nextAttempt = state.attempt + 1;
      const nextDelay = Math.min(opts.maxBackoffMs, state.nextDelayMs * 2);
      if (state.kind === "probing") {
        if (elapsed >= opts.graceMs) {
          return {
            kind: "offline",
            sinceFailureAt: state.sinceFailureAt,
            attempt: nextAttempt,
            nextDelayMs: nextDelay,
          };
        }
        return { ...state, attempt: nextAttempt };
      }
      // already offline — keep growing the backoff.
      return {
        ...state,
        attempt: nextAttempt,
        nextDelayMs: nextDelay,
      };
    }
    case "retry-now": {
      if (state.kind === "offline" || state.kind === "probing") {
        return { ...state, nextDelayMs: opts.initialBackoffMs };
      }
      return state;
    }
    default:
      return state;
  }
}

export const initialHealthState: HealthFsmState = {
  kind: "online",
  lastOnlineAt: 0,
};

/**
 * Mount once at the app shell. Polls /api/health and exposes the
 * offline signal + an imperative retry trigger.
 */
export function useHealthPoll(options: HealthPollOptions = {}): HealthPollState {
  const opts: Required<HealthPollOptions> = { ...DEFAULTS, ...options };
  // useReducer over the pure FSM.
  const [state, dispatchRaw] = useReducer(
    (s: HealthFsmState, a: HealthFsmAction) => healthPollReducer(s, a, opts),
    initialHealthState,
  );

  const aliveRef = useRef(true);
  const wasOfflineRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRequestRef = useRef(false);

  const dispatch = useCallback(
    (a: HealthFsmAction) => {
      if (!aliveRef.current) return;
      dispatchRaw(a);
    },
    [dispatchRaw],
  );

  const poll = useCallback(async () => {
    let ok = false;
    try {
      const res = await fetch(opts.url, { method: "GET" });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!aliveRef.current) return;
    const t = Date.now();
    if (ok) {
      const wasOffline = wasOfflineRef.current;
      wasOfflineRef.current = false;
      dispatch({ type: "poll-ok", t });
      if (wasOffline && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(BACKEND_ONLINE_EVENT));
      }
    } else {
      dispatch({ type: "poll-fail", t });
    }
  }, [opts.url, dispatch]);

  const retryNow = useCallback(() => {
    retryRequestRef.current = true;
    dispatch({ type: "retry-now", t: Date.now() });
    void poll();
  }, [dispatch, poll]);

  // Track whether we're currently offline for the recovery-event hook.
  useEffect(() => {
    if (state.kind === "offline") wasOfflineRef.current = true;
  }, [state.kind]);

  // Schedule the next poll based on the current state.
  useEffect(() => {
    if (!aliveRef.current) return;
    const delay =
      state.kind === "online"
        ? opts.intervalMs
        : state.kind === "probing"
          ? opts.initialBackoffMs
          : state.nextDelayMs;
    const handle = setTimeout(() => {
      void poll();
    }, delay);
    timerRef.current = handle;
    return () => {
      clearTimeout(handle);
      timerRef.current = null;
    };
  }, [state, opts.intervalMs, opts.initialBackoffMs, poll]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const isOffline = state.kind === "offline";
  const lastOnlineAt = state.kind === "online" ? state.lastOnlineAt : null;
  const offlineSince = state.kind === "offline" ? state.sinceFailureAt : null;

  return { isOffline, lastOnlineAt, offlineSince, retryNow };
}
