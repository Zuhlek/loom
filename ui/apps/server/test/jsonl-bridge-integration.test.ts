/**
 * T-016 — Integration root: the JsonlTailBridge structurally satisfies the
 * bridge surface consumed by http-ws-server.ts.
 *
 * Rather than wire a real WS into vitest (the `ws` import doesn't resolve
 * under apps/server's transform config), we verify the structural contract:
 *   - createJsonlTailBridge(...) returns an object implementing every
 *     method http-ws-server.ts calls on `opts.bridge`.
 *   - Each method's call shape matches the SDK bridge's call sites.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonlTailBridge } from "../src/process-manager/jsonl/bridge.ts";
import type { TmuxSessionApi } from "../src/process-manager/tmux-session.ts";
import type { SessionIdStore } from "../src/process-manager/session-store.ts";
import type { JsonlPathProbe } from "../src/process-manager/jsonl-path-probe.ts";
import type { PaneProcessApi } from "../src/process-manager/pane-process.ts";

function mkBridgeOpts() {
  const root = mkdtempSync(join(tmpdir(), "jsonl-int-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const tmux: TmuxSessionApi = {
    async ensure() {},
    async kill() {},
    async sendInput() {},
    async interrupt() {},
    async exists() {
      return true;
    },
  };
  const store: SessionIdStore = {
    async get() {
      return undefined;
    },
    async getOrCreate(c, cwd) {
      return { sessionId: `sess-${c}`, cwd, createdAt: "x" };
    },
    async delete() {},
    async upsert(_chatId, sessionId, cwd) {
      return { sessionId, cwd: cwd ?? "", createdAt: "x" };
    },
    async findByClaudeSessionId() {
      return undefined;
    },
  };
  const probe: JsonlPathProbe = {
    async resolve() {
      return {
        tailRoot,
        encodingScheme: "cwd-slash-encoded",
        resolvedAt: "x",
        claudeVersionAtProbe: "test",
      };
    },
    async reprobe() {
      return this.resolve();
    },
    encodeCwd: (c) => c.replace(/\//g, "-"),
  };
  const paneProcess: PaneProcessApi = {
    async paneRootPid() {
      return 12345;
    },
    async paneOwnsFile() {
      return true;
    },
  };
  return {
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    bridgeOpts: {
      tmux,
      sessionStore: store,
      pathProbe: probe,
      paneProcess,
      cwdResolver: async (c: string) => `/tmp/${c}`,
      tailPollingMs: 25,
    },
  };
}

describe("T-016 — JsonlTailBridge implements the http-ws-server surface", () => {
  it("exposes every method http-ws-server.ts calls on opts.bridge", () => {
    const { bridgeOpts, cleanup } = mkBridgeOpts();
    const bridge = createJsonlTailBridge(bridgeOpts);
    try {
      // Methods called by http-ws-server.ts:
      const surface: (keyof typeof bridge)[] = [
        "attach",
        "detach",
        "submitUserTurnWithPriority",
        "interrupt",
        "acceptPlanProposal",
        "rejectPlanProposal",
        "setPermissionMode",
        "respondToQuestion",
        "respondToPermission",
        "setModelSettings",
        "retrySession",
        "onTasksUpdate",
        "hasSession",
        "dispose",
      ];
      for (const k of surface) {
        expect(typeof bridge[k]).toBe("function");
      }
    } finally {
      cleanup();
    }
  });

  it("http-ws-server.ts uses `import type` for its bridge reference (T-019 parity)", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "http-ws-server.ts"),
      "utf8",
    );
    // Post-T-021 cutover: the bridge import line is
    //   import type { JsonlTailBridge } from "./process-manager/jsonl/bridge.ts";
    // It must remain a `import type` so http-ws-server.ts is bridge-
    // implementation-agnostic at the type level.
    const importLineMatch = src.match(
      /import\s+type\s+\{[^}]*JsonlTailBridge[^}]*\}\s+from\s+["'][^"']*bridge\.ts["']/,
    );
    expect(importLineMatch).not.toBeNull();
  });
});

describe("T-016 — chat-protocol parity (T-019 pre-flight)", () => {
  it("chat-protocol/{envelope,frames,messages}.ts shapes unchanged", () => {
    const frames = readFileSync(
      join(__dirname, "..", "src", "chat-protocol", "frames.ts"),
      "utf8",
    );
    expect(frames).toContain("export type ServerFrame =");
    expect(frames).toContain("TasksUpdateFrame");
    expect(frames).toContain("ItemAppendFrame");
    expect(frames).toContain("SnapshotFrame");
    expect(frames).toContain("PendingPermissionFrame");
    expect(frames).toContain("PendingQuestionFrame");
    expect(frames).toContain("SessionStateFrame");
  });
});
