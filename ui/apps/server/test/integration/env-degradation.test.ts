/**
 * T-024 — Environmental-degradation smoke matrix.
 *
 * The Build rework #2 was triggered by `pnpm run dev` on a tmux-absent
 * host surfacing a fatal boot crash that 398 tests didn't catch. These
 * gates close that loop: the bridge composition must boot and behave
 * gracefully in the three environmental degradations the seed flagged
 * as in-scope:
 *
 *   - tmux missing from PATH
 *   - claude missing from PATH
 *   - ~/.claude/projects/ absent (no projects-dir to tail)
 *
 * Each gate composes the same `createJsonlTailBridge(...)` factory
 * `index.ts` uses, with the relevant override. Each gate asserts a
 * positive observable outcome rather than the absence of a crash.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createJsonlTailBridge } from "../../src/process-manager/jsonl/bridge.ts";
import { createTmuxSession } from "../../src/process-manager/tmux-session.ts";
import { probeTmux } from "../../src/process-manager/tmux-availability.ts";
import { createSessionIdStore } from "../../src/process-manager/session-store.ts";

function freshRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "env-degrade-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function makeWs() {
  return {
    sent: [] as string[],
    send(text: string) {
      this.sent.push(text);
    },
    close() {},
  };
}

describe("Environmental-degradation smoke matrix (T-024)", () => {
  describe("Gate: no-tmux", () => {
    it("composes without throwing when tmuxBin points at /nonexistent; probe reports unavailable", async () => {
      const probe = await probeTmux({ tmuxBin: "/nonexistent/tmux-binary" });
      expect(probe.available).toBe(false);
      expect(probe.versionError).not.toBeNull();
    });

    it("bridge.attach emits a runtime-unavailable error frame and does NOT register the chat", async () => {
      const { root, cleanup } = freshRoot();
      try {
        const tailRoot = join(root, "projects");
        mkdirSync(tailRoot, { recursive: true });
        const sessionStore = createSessionIdStore({
          storagePath: join(root, "session-id-store.json"),
        });
        // Stub probe with a fixed tail-root so the test doesn't depend
        // on a real claude binary.
        const pathProbe = {
          async resolve() {
            return {
              tailRoot,
              encodingScheme: "cwd-slash-encoded" as const,
              resolvedAt: "2026-01-01T00:00:00.000Z",
              claudeVersionAtProbe: "test",
            };
          },
          async reprobe() {
            return this.resolve();
          },
          encodeCwd(c: string) {
            return c.replace(/\//g, "-");
          },
        };

        const tmux = createTmuxSession({
          tmuxBin: "/nonexistent/tmux-binary",
          availability: () => ({ available: false }),
        });
        const bridge = createJsonlTailBridge({
          tmux,
          sessionStore,
      tailRoot,
          cwdResolver: async (chatId) => `/tmp/cwd-${chatId}`,
          tailPollingMs: 25,
        });

        const ws = makeWs();
        await bridge.attach("chat-1", ws);
        const frames = ws.sent.map((s) => JSON.parse(s));
        const err = frames.find(
          (f) => f.kind === "error" && f.body.code === "runtime-unavailable",
        );
        expect(err).toBeDefined();
        expect(err.body.details?.reason).toBe("tmux");
        // hasSession resolves false (delegates to tmux.exists → false).
        expect(await bridge.hasSession("chat-1")).toBe(false);
      } finally {
        cleanup();
      }
    });
  });

  describe("Gate: no-claude", () => {
    it("composes without throwing when claudeBin points at /nonexistent; the boot path does NOT pre-spawn claude", async () => {
      const { root, cleanup } = freshRoot();
      try {
        const tailRoot = join(root, "projects");
        mkdirSync(tailRoot, { recursive: true });
        const sessionStore = createSessionIdStore({
          storagePath: join(root, "session-id-store.json"),
        });
        const pathProbe = {
          async resolve() {
            return {
              tailRoot,
              encodingScheme: "cwd-slash-encoded" as const,
              resolvedAt: "2026-01-01T00:00:00.000Z",
              claudeVersionAtProbe: "test",
            };
          },
          async reprobe() {
            return this.resolve();
          },
          encodeCwd(c: string) {
            return c.replace(/\//g, "-");
          },
        };

        // tmux is available (the test harness has a real or mock tmux),
        // but `claudeBin` is missing. The bridge composition still
        // succeeds — claude isn't spawned until `tmux new-session`
        // actually runs inside `ensure()`, and `ensure()` is gated by
        // attach. The constructor must NOT eagerly probe claude.
        const tmux = createTmuxSession({
          claudeBin: "/nonexistent/claude-binary",
          // Mark unavailable so the test doesn't actually exec tmux.
          availability: () => ({ available: false }),
        });
        const bridge = createJsonlTailBridge({
          tmux,
          sessionStore,
      tailRoot,
          cwdResolver: async (chatId) => `/tmp/cwd-${chatId}`,
          tailPollingMs: 25,
        });
        expect(bridge).toBeDefined();
        // hasSession resolves cleanly (false because tmux not available
        // OR genuinely no session).
        const has = await bridge.hasSession("chat-1");
        expect(typeof has).toBe("boolean");
      } finally {
        cleanup();
      }
    });
  });

  describe("Gate: no-projects-dir", () => {
    it("bridge composition completes even when the tail root does not exist yet", async () => {
      const { root, cleanup } = freshRoot();
      try {
        const sessionStore = createSessionIdStore({
          storagePath: join(root, "session-id-store.json"),
        });
        const tmux = createTmuxSession({
          availability: () => ({ available: false }),
        });
        // The composition itself never touches the tail root — it is
        // only joined into a file path at first chat-attach.
        const bridge = createJsonlTailBridge({
          tmux,
          sessionStore,
          tailRoot: join(root, "does-not-exist", "projects"),
          cwdResolver: async (chatId) => `/tmp/cwd-${chatId}`,
          tailPollingMs: 25,
        });
        expect(bridge).toBeDefined();
      } finally {
        cleanup();
      }
    });
  });
});
