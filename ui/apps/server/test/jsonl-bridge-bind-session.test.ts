/**
 * Bridge binds each chat to its persisted sessionId; rotation only
 * accepts candidates whose writer descends from this chat's tmux
 * pane PID (the M8 + N4 regression class).
 *
 * When claude is running outside loom's control in the same cwd (the
 * user's `/weave` session, a terminal `claude` invocation), its JSONL
 * file appears alongside the loom-spawned chat's JSONL. The bridge
 * MUST NOT adopt that bystander. The pane-PID file-ownership gate
 * (`paneProcess.paneOwnsFile`) is the single authoritative check —
 * tests stub it to control which candidate the bridge will adopt.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  appendFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createJsonlTailBridge,
  type JsonlTailBridgeOptions,
} from "../src/process-manager/jsonl/bridge.ts";
import type { TmuxSessionApi } from "../src/process-manager/tmux-session.ts";
import type {
  SessionIdStore,
  SessionEntry,
} from "../src/process-manager/session-store.ts";
import type {
  JsonlPathProbe,
  ResolvedTailRoot,
} from "../src/process-manager/jsonl-path-probe.ts";
import type { PaneProcessApi } from "../src/process-manager/pane-process.ts";

interface PaneStub extends PaneProcessApi {
  ownedPaths: Set<string>;
  paneRoot: number | null;
}

function mkPaneStub(): PaneStub {
  const stub: PaneStub = {
    ownedPaths: new Set<string>(),
    paneRoot: 12345,
    async paneRootPid() {
      return stub.paneRoot;
    },
    async paneOwnsFile(_pid, path) {
      return stub.ownedPaths.has(path);
    },
  };
  return stub;
}

function mkTmux(): TmuxSessionApi {
  return {
    async ensure() {},
    async kill() {},
    async sendInput() {},
    async interrupt() {},
    async exists() {
      return true;
    },
  };
}

function mkStore(initial: Record<string, SessionEntry> = {}): SessionIdStore & {
  __map: Record<string, SessionEntry>;
} {
  const map: Record<string, SessionEntry> = { ...initial };
  const store: SessionIdStore = {
    async get(chatId) {
      return map[chatId];
    },
    async getOrCreate(chatId, cwd) {
      const existing = map[chatId];
      if (existing) return existing;
      const e: SessionEntry = {
        sessionId: `persisted-${chatId}`,
        cwd,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      map[chatId] = e;
      return e;
    },
    async delete(chatId) {
      delete map[chatId];
    },
    async upsert(chatId, sessionId, cwd) {
      const prior = map[chatId];
      const e: SessionEntry = {
        sessionId,
        cwd: cwd ?? prior?.cwd ?? "",
        createdAt: prior?.createdAt ?? "2026-01-01T00:00:00.000Z",
      };
      map[chatId] = e;
      return e;
    },
    async findByClaudeSessionId(sessionId) {
      for (const [chatId, entry] of Object.entries(map)) {
        if (entry.sessionId === sessionId) return chatId;
      }
      return undefined;
    },
  };
  return Object.assign(store, { __map: map });
}

function mkProbe(tailRoot: string): JsonlPathProbe {
  const resolved: ResolvedTailRoot = {
    tailRoot,
    encodingScheme: "cwd-slash-encoded",
    resolvedAt: "2026-01-01T00:00:00.000Z",
    claudeVersionAtProbe: "test",
  };
  return {
    async resolve() {
      return resolved;
    },
    async reprobe() {
      return resolved;
    },
    encodeCwd(cwd) {
      return cwd.replace(/\//g, "-");
    },
  };
}

function makeWs() {
  return {
    sent: [] as string[],
    send(text: string) {
      this.sent.push(text);
    },
  };
}

interface TestEnv {
  bridge: ReturnType<typeof createJsonlTailBridge>;
  store: ReturnType<typeof mkStore>;
  tailRoot: string;
  encodedCwd: string;
  sessionDir: string;
  cleanup: () => void;
  pane: PaneStub;
}

function makeEnv(opts?: { rotationPollMs?: number }): TestEnv {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-bind-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const encodedCwd = "-tmp-cwd-bind";
  const sessionDir = join(tailRoot, encodedCwd);
  mkdirSync(sessionDir, { recursive: true });

  const tmux = mkTmux();
  const store = mkStore();
  const pane = mkPaneStub();

  const bridgeOpts: JsonlTailBridgeOptions = {
    tmux,
    sessionStore: store,
    pathProbe: mkProbe(tailRoot),
    paneProcess: pane,
    cwdResolver: async () => `/tmp/cwd-bind`,
    tailPollingMs: 25,
    rotationPollMs: opts?.rotationPollMs ?? 30,
  };
  const bridge = createJsonlTailBridge(bridgeOpts);
  return {
    bridge,
    store,
    tailRoot,
    encodedCwd,
    sessionDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    pane,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

function isAppendedUserText(s: string, expected: string): boolean {
  try {
    const f = JSON.parse(s);
    return (
      f.kind === "item-append" &&
      f.body?.item?.kind === "user-message" &&
      f.body?.item?.text === expected
    );
  } catch {
    return false;
  }
}

let env: TestEnv | undefined;
beforeEach(() => {
  env = undefined;
});
afterEach(() => {
  env?.cleanup();
});

describe("JsonlTailBridge — bind to persisted sessionId + pane-PID rotation gate", () => {
  it("bystander present before attach: bridge tails the bound path, ignores the bystander even when it gets new lines", async () => {
    env = makeEnv();

    // Bystander session: existed BEFORE this loom chat attached.
    // Models the user's `/weave` claude session writing to the same
    // encoded-cwd dir.
    const bystanderPath = join(env.sessionDir, "bystander-uuid.jsonl");
    writeFileSync(
      bystanderPath,
      JSON.stringify({
        type: "summary",
        sessionId: "bystander-uuid",
      }) + "\n",
      "utf8",
    );
    const past = new Date(Date.now() - 60_000);
    utimesSync(bystanderPath, past, past);

    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    // Bystander writes new content AFTER attach. The bridge must NOT
    // pick this up because the bystander filePath was already in the
    // dir at attach time.
    appendFileSync(
      bystanderPath,
      JSON.stringify({
        type: "user",
        uuid: "ev-bystander",
        timestamp: "2026-05-24T13:00:00.000Z",
        sessionId: "bystander-uuid",
        message: { role: "user", content: "BYSTANDER CONTENT" },
      }) + "\n",
      "utf8",
    );
    const newer = new Date(Date.now() + 10_000);
    utimesSync(bystanderPath, newer, newer);

    // Wait long enough for the rotation poller to have fired several times.
    await new Promise((r) => setTimeout(r, 200));

    const appended = ws.sent
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter((f) => f && f.kind === "item-append");
    expect(
      appended.some(
        (f) =>
          f.body?.item?.kind === "user-message" &&
          f.body?.item?.text === "BYSTANDER CONTENT",
      ),
    ).toBe(false);

    // Session-store was NOT mutated — it still holds the persisted id.
    expect(env.store.__map["chat-1"]!.sessionId).toBe("persisted-chat-1");

    // Now claude writes to the bound path (the persisted one). The
    // bridge picks it up because that's the bound tail target.
    const boundPath = join(env.sessionDir, "persisted-chat-1.jsonl");
    appendFileSync(
      boundPath,
      JSON.stringify({
        type: "user",
        uuid: "ev-bound",
        timestamp: "2026-05-24T13:00:01.000Z",
        sessionId: "persisted-chat-1",
        message: { role: "user", content: "BOUND CONTENT" },
      }) + "\n",
      "utf8",
    );
    await waitFor(() => ws.sent.some((s) => isAppendedUserText(s, "BOUND CONTENT")));
    expect(
      ws.sent.some((s) => isAppendedUserText(s, "BOUND CONTENT")),
    ).toBe(true);
    await env.bridge.dispose("chat-1");
  });

  it("rotation accept: a NEW jsonl file owned by our pane's process tree is adopted", async () => {
    env = makeEnv({ rotationPollMs: 30 });

    // Empty dir at attach: no bystander, no bound file yet.
    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    // After attach, claude writes to a DIFFERENT uuid than the
    // persisted one. This models real claude UUID rotation. The pane
    // stub reports this file as owned by our pane's process tree.
    const rotatedPath = join(env.sessionDir, "rotated-uuid.jsonl");
    env.pane.ownedPaths.add(rotatedPath);
    writeFileSync(
      rotatedPath,
      JSON.stringify({
        type: "summary",
        sessionId: "rotated-uuid",
      }) + "\n" +
        JSON.stringify({
          type: "user",
          uuid: "ev-rot",
          timestamp: "2026-05-24T13:00:00.000Z",
          sessionId: "rotated-uuid",
          message: { role: "user", content: "AFTER ROTATION" },
        }) +
        "\n",
      "utf8",
    );

    await waitFor(
      () => ws.sent.some((s) => isAppendedUserText(s, "AFTER ROTATION")),
      3000,
    );
    expect(
      ws.sent.some((s) => isAppendedUserText(s, "AFTER ROTATION")),
    ).toBe(true);

    // Session-store now reflects the rotated sessionId.
    expect(env.store.__map["chat-1"]!.sessionId).toBe("rotated-uuid");
    await env.bridge.dispose("chat-1");
  });

  it("bystander never adopted when its file is NOT owned by our pane's process tree, regardless of mtime bumps", async () => {
    env = makeEnv({ rotationPollMs: 30 });

    // Bystander pre-existing.
    const bystanderPath = join(env.sessionDir, "bystander-bump.jsonl");
    writeFileSync(
      bystanderPath,
      JSON.stringify({
        type: "summary",
        sessionId: "bystander-bump",
      }) + "\n",
      "utf8",
    );
    const past = new Date(Date.now() - 60_000);
    utimesSync(bystanderPath, past, past);

    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    // Bump bystander mtime far in the future AND append a user line.
    const future = new Date(Date.now() + 5 * 60_000);
    appendFileSync(
      bystanderPath,
      JSON.stringify({
        type: "user",
        uuid: "ev-bump",
        timestamp: "2026-05-24T13:00:00.000Z",
        sessionId: "bystander-bump",
        message: { role: "user", content: "BYSTANDER BUMP" },
      }) + "\n",
      "utf8",
    );
    utimesSync(bystanderPath, future, future);

    // Wait for several poll cycles.
    await new Promise((r) => setTimeout(r, 250));

    const appended = ws.sent
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter((f) => f && f.kind === "item-append");
    expect(
      appended.some(
        (f) =>
          f.body?.item?.kind === "user-message" &&
          f.body?.item?.text === "BYSTANDER BUMP",
      ),
    ).toBe(false);
    expect(env.store.__map["chat-1"]!.sessionId).toBe("persisted-chat-1");
    await env.bridge.dispose("chat-1");
  });

  it("bystander that starts AFTER attach (terminal `claude` race) is rejected by the pane-PID gate", async () => {
    env = makeEnv({ rotationPollMs: 30 });

    // Empty dir at attach — the previous heuristic gate's
    // `existingPathsAtAttach` snapshot would be empty.
    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    // A bystander claude appears AFTER attach (e.g. the user opens a
    // terminal and runs `claude` in the same cwd). Its file is not
    // owned by our pane's process tree — the pane-PID gate rejects it
    // even though it has a newer mtime than attachedAtMs and was not
    // present at attach.
    const bystanderPath = join(env.sessionDir, "post-attach-bystander.jsonl");
    writeFileSync(
      bystanderPath,
      JSON.stringify({
        type: "summary",
        sessionId: "post-attach-bystander",
      }) + "\n" +
        JSON.stringify({
          type: "user",
          uuid: "ev-post",
          timestamp: "2026-05-24T13:00:00.000Z",
          sessionId: "post-attach-bystander",
          message: { role: "user", content: "POST ATTACH BYSTANDER" },
        }) +
        "\n",
      "utf8",
    );

    await new Promise((r) => setTimeout(r, 250));

    const appended = ws.sent
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter((f) => f && f.kind === "item-append");
    expect(
      appended.some(
        (f) =>
          f.body?.item?.kind === "user-message" &&
          f.body?.item?.text === "POST ATTACH BYSTANDER",
      ),
    ).toBe(false);
    expect(env.store.__map["chat-1"]!.sessionId).toBe("persisted-chat-1");
    await env.bridge.dispose("chat-1");
  });

  it("rotation is skipped when paneRootPid returns null (no pane / chat already torn down)", async () => {
    env = makeEnv({ rotationPollMs: 30 });
    env.pane.paneRoot = null;

    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    // Even a file we would have marked "owned" cannot be adopted
    // because we can't establish a pane root to walk against.
    const candidatePath = join(env.sessionDir, "no-pane.jsonl");
    env.pane.ownedPaths.add(candidatePath);
    writeFileSync(
      candidatePath,
      JSON.stringify({
        type: "user",
        uuid: "ev-no-pane",
        timestamp: "2026-05-24T13:00:00.000Z",
        sessionId: "no-pane",
        message: { role: "user", content: "NO PANE" },
      }) + "\n",
      "utf8",
    );
    await new Promise((r) => setTimeout(r, 250));

    const appended = ws.sent
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter((f) => f && f.kind === "item-append");
    expect(
      appended.some((f) => f.body?.item?.text === "NO PANE"),
    ).toBe(false);
    await env.bridge.dispose("chat-1");
  });
});
