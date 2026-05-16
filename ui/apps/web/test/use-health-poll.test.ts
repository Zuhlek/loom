/**
 * T-011 — useHealthPoll FSM (US-005 / ADR-001).
 *
 * Pure-reducer tests for the offline state machine. The hook itself is
 * a thin scheduling shell; the FSM logic is factored into a pure
 * reducer the hook calls so we can test it without jsdom or
 * @testing-library/react (the project's vitest harness is node-only —
 * include = *.test.ts, environment = node).
 *
 * Asserts: online → probing on first failure, probing → offline after
 * graceMs, exponential backoff doubling up to maxBackoffMs, offline →
 * online on success, BackendOnlineEvent constant exported, retryNow
 * reduces to an explicit reset action, and the banner-component file
 * is wired correctly.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import {
  healthPollReducer,
  initialHealthState,
  BACKEND_ONLINE_EVENT,
  type HealthFsmState,
  type HealthFsmAction,
  type HealthPollOptions,
} from "../src/lib/useHealthPoll";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));

const OPTS: Required<HealthPollOptions> = {
  url: "/api/health",
  intervalMs: 5000,
  initialBackoffMs: 2000,
  maxBackoffMs: 30000,
  graceMs: 1500,
};

function reduce(
  state: HealthFsmState,
  actions: HealthFsmAction[],
  opts: Required<HealthPollOptions> = OPTS,
): HealthFsmState {
  let s = state;
  for (const a of actions) s = healthPollReducer(s, a, opts);
  return s;
}

describe("T-011 useHealthPoll FSM", () => {
  test("initial state is online with lastOnlineAt=now provided by the action layer", () => {
    expect(initialHealthState.kind).toBe("online");
  });

  test("one failed poll transitions online → probing", () => {
    const next = reduce(initialHealthState, [{ type: "poll-fail", t: 100 }]);
    expect(next.kind).toBe("probing");
  });

  test("probing → offline after another fail past graceMs", () => {
    const after1 = reduce(initialHealthState, [{ type: "poll-fail", t: 100 }]);
    expect(after1.kind).toBe("probing");
    // A second failure at t > sinceFailureAt + graceMs flips to offline.
    const after2 = healthPollReducer(after1, { type: "poll-fail", t: 100 + OPTS.graceMs + 50 }, OPTS);
    expect(after2.kind).toBe("offline");
  });

  test("offline backoff doubles per consecutive failure up to maxBackoffMs", () => {
    // Manually drive into offline.
    let s: HealthFsmState = reduce(initialHealthState, [
      { type: "poll-fail", t: 100 },
      { type: "poll-fail", t: 100 + OPTS.graceMs + 50 },
    ]);
    expect(s.kind).toBe("offline");
    const firstDelay = (s as Extract<HealthFsmState, { kind: "offline" }>).nextDelayMs;
    s = healthPollReducer(s, { type: "poll-fail", t: 9999 }, OPTS);
    const secondDelay = (s as Extract<HealthFsmState, { kind: "offline" }>).nextDelayMs;
    expect(secondDelay).toBe(Math.min(firstDelay * 2, OPTS.maxBackoffMs));

    // Drive consecutive failures until we hit the cap.
    for (let i = 0; i < 10; i++) {
      s = healthPollReducer(s, { type: "poll-fail", t: 9999 + i }, OPTS);
    }
    expect((s as Extract<HealthFsmState, { kind: "offline" }>).nextDelayMs).toBe(OPTS.maxBackoffMs);
  });

  test("offline → online on a successful poll", () => {
    let s: HealthFsmState = reduce(initialHealthState, [
      { type: "poll-fail", t: 100 },
      { type: "poll-fail", t: 100 + OPTS.graceMs + 50 },
    ]);
    expect(s.kind).toBe("offline");
    s = healthPollReducer(s, { type: "poll-ok", t: 9999 }, OPTS);
    expect(s.kind).toBe("online");
  });

  test("probing → online on a successful poll", () => {
    let s: HealthFsmState = reduce(initialHealthState, [{ type: "poll-fail", t: 100 }]);
    expect(s.kind).toBe("probing");
    s = healthPollReducer(s, { type: "poll-ok", t: 200 }, OPTS);
    expect(s.kind).toBe("online");
  });

  test("retry-now action resets backoff while in offline", () => {
    let s: HealthFsmState = reduce(initialHealthState, [
      { type: "poll-fail", t: 100 },
      { type: "poll-fail", t: 100 + OPTS.graceMs + 50 },
      { type: "poll-fail", t: 9999 },
      { type: "poll-fail", t: 10001 },
    ]);
    const beforeDelay = (s as Extract<HealthFsmState, { kind: "offline" }>).nextDelayMs;
    expect(beforeDelay).toBeGreaterThan(OPTS.initialBackoffMs);
    s = healthPollReducer(s, { type: "retry-now", t: 20000 }, OPTS);
    const afterDelay = (s as Extract<HealthFsmState, { kind: "offline" }>).nextDelayMs;
    expect(afterDelay).toBe(OPTS.initialBackoffMs);
  });

  test("BACKEND_ONLINE_EVENT is a stable string constant", () => {
    expect(typeof BACKEND_ONLINE_EVENT).toBe("string");
    expect(BACKEND_ONLINE_EVENT.length).toBeGreaterThan(0);
  });
});

describe("T-011 useHealthPoll hook contract", () => {
  test("module exports useHealthPoll and HealthPollState type symbols", async () => {
    const mod = await import("../src/lib/useHealthPoll");
    expect(typeof mod.useHealthPoll).toBe("function");
    expect(typeof mod.healthPollReducer).toBe("function");
  });
});

describe("T-011 BackendOfflineBanner component", () => {
  const bannerPath = webRoot + "src/components/BackendOfflineBanner.tsx";

  test("file exists", () => {
    expect(existsSync(bannerPath)).toBe(true);
  });

  test("returns null when offline=false (no DOM on the happy path)", () => {
    const src = readFileSync(bannerPath, "utf8");
    // Happy-path early-return: `if (!offline) return null;` or equivalent.
    const returnsNull =
      /if\s*\(\s*!\s*(?:p\.)?offline\s*\)\s*(?:return\s+null|\{\s*return\s+null)/.test(src) ||
      /!\s*offline\s*\?\s*null/.test(src);
    expect(returnsNull).toBe(true);
  });

  test("renders a Retry button that calls onRetry", () => {
    const src = readFileSync(bannerPath, "utf8");
    expect(/onRetry/.test(src)).toBe(true);
    // The button's onClick calls onRetry.
    expect(/onClick=\{[^}]*onRetry/.test(src)).toBe(true);
  });

  test("banner is pinned top-of-viewport (fixed/sticky position)", () => {
    const src = readFileSync(bannerPath, "utf8");
    // Either Tailwind class or inline style.
    const isPinned =
      /\b(fixed|sticky)\b/.test(src) &&
      /\btop-0\b|top:\s*0/.test(src);
    expect(isPinned).toBe(true);
  });
});
