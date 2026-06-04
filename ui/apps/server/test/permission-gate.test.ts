/**
 * permission-gate — the async bridge that lets a synchronous PreToolUse hook
 * block until the web UI answers. See src/hook-receiver/permission-gate.ts.
 */
import { describe, expect, it } from "vitest";
import { createPermissionGate } from "../src/hook-receiver/permission-gate.ts";

describe("createPermissionGate", () => {
  it("resolve() settles the pending register() promise with the given decision", async () => {
    const gate = createPermissionGate();
    const pending = gate.register("c-1", "perm-1");
    expect(gate.pendingCount("c-1")).toBe(1);

    const ok = gate.resolve("c-1", "perm-1", { decision: "allow", reason: "user said yes" });
    expect(ok).toBe(true);

    await expect(pending).resolves.toEqual({ decision: "allow", reason: "user said yes" });
    expect(gate.pendingCount("c-1")).toBe(0);
  });

  it("resolve() returns false when no gate is registered under that id", () => {
    const gate = createPermissionGate();
    expect(gate.resolve("c-1", "missing", { decision: "deny" })).toBe(false);
  });

  it("auto-resolves with the timeout resolution when unanswered", async () => {
    const gate = createPermissionGate({
      timeoutMs: 5,
      onTimeout: { decision: "deny", reason: "timed out" },
    });
    const pending = gate.register("c-1", "perm-1");
    await expect(pending).resolves.toEqual({ decision: "deny", reason: "timed out" });
    expect(gate.pendingCount()).toBe(0);
  });

  it("defaults to a deny-with-reason timeout resolution", async () => {
    const gate = createPermissionGate({ timeoutMs: 5 });
    const resolution = await gate.register("c-1", "perm-1");
    expect(resolution.decision).toBe("deny");
    expect(typeof resolution.reason).toBe("string");
  });

  it("rejectAll() settles every pending gate for a chat and leaves other chats untouched", async () => {
    const gate = createPermissionGate();
    const a = gate.register("c-1", "perm-1");
    const b = gate.register("c-1", "perm-2");
    const other = gate.register("c-2", "perm-3");

    gate.rejectAll("c-1", { decision: "defer", reason: "turn ended" });

    await expect(a).resolves.toEqual({ decision: "defer", reason: "turn ended" });
    await expect(b).resolves.toEqual({ decision: "defer", reason: "turn ended" });
    expect(gate.pendingCount("c-1")).toBe(0);
    expect(gate.pendingCount("c-2")).toBe(1);

    gate.resolve("c-2", "perm-3", { decision: "allow" });
    await expect(other).resolves.toEqual({ decision: "allow" });
  });

  it("re-registering a live (chatId,id) releases the prior promise with defer", async () => {
    const gate = createPermissionGate();
    const first = gate.register("c-1", "perm-1");
    const second = gate.register("c-1", "perm-1");

    // The stale curl is released so it doesn't dangle.
    await expect(first).resolves.toEqual({ decision: "defer" });
    expect(gate.pendingCount("c-1")).toBe(1);

    gate.resolve("c-1", "perm-1", { decision: "allow" });
    await expect(second).resolves.toEqual({ decision: "allow" });
  });

  it("pendingCount() with no chat argument totals across chats", () => {
    const gate = createPermissionGate();
    gate.register("c-1", "perm-1");
    gate.register("c-1", "perm-2");
    gate.register("c-2", "perm-3");
    expect(gate.pendingCount()).toBe(3);
    expect(gate.pendingCount("c-1")).toBe(2);
  });
});
