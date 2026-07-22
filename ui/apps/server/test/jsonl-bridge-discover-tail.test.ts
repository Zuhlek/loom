/**
 * T-026 — Bridge structured logging + rotation discovery.
 *
 * Note on history: the rotation gate has evolved across three contracts.
 * Most recent: pane-PID file-ownership identity check (`paneProcess`).
 * The bridge tails the bound `<persisted>.jsonl` at attach, and the
 * rotation poller adopts a candidate only when the file's writer
 * descends from this chat's tmux pane PID. Tests below stub
 * `paneProcess.paneOwnsFile` to control adoption.
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
import type { PaneProcessApi } from "../src/process-manager/pane-process.ts";
import {
  createBridgeLog,
  type BridgeLogEvent,
} from "../src/process-manager/jsonl/bridge-log.ts";

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
    gateDegraded() {
      return false;
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
  logRecord: BridgeLogEvent[];
  pane: PaneStub;
}

function makeEnv(opts?: { logLevel?: "silent" | "info" | "trace"; rotationPollMs?: number }): TestEnv {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-disc-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  // chat cwd = `/tmp/cwd-chat-1`, encoded with the / → - scheme.
  const encodedCwd = "-tmp-cwd-chat-1";
  const sessionDir = join(tailRoot, encodedCwd);
  mkdirSync(sessionDir, { recursive: true });

  const tmux = mkTmux();
  const store = mkStore();

  const logRecord: BridgeLogEvent[] = [];
  const log = createBridgeLog({
    level: opts?.logLevel ?? "trace",
    sink: (e) => logRecord.push(e),
  });

  const pane = mkPaneStub();

  const bridgeOpts: JsonlTailBridgeOptions = {
    tmux,
    sessionStore: store,
    tailRoot,
    paneProcess: pane,
    cwdResolver: async () => `/tmp/cwd-chat-1`,
    tailPollingMs: 25,
    rotationPollMs: opts?.rotationPollMs ?? 30,
    log,
  };
  const bridge = createJsonlTailBridge(bridgeOpts);
  return {
    bridge,
    store,
    tailRoot,
    encodedCwd,
    sessionDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    logRecord,
    pane,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

let env: TestEnv | undefined;
beforeEach(() => {
  env = undefined;
});
afterEach(() => {
  env?.cleanup();
});

describe("JsonlTailBridge — directory-scan discovery (rotation via pane-PID file-ownership)", () => {
  it("[T-028 / M9 contract] bystander present at attach with a different inner sessionId is NOT adopted; bridge stays bound to the persisted path", async () => {
    env = makeEnv();
    // On disk before attach: a JSONL whose inner sessionId differs
    // from the persisted store entry. Pre-T-028 the bridge adopted
    // this file (the M8 defect). Post-T-028 the bridge stays on the
    // bound path (`persisted-chat-1.jsonl`).
    const bystanderName = "ec847f04-actually-active.jsonl";
    const bystanderPath = join(env.sessionDir, bystanderName);
    writeFileSync(
      bystanderPath,
      JSON.stringify({
        type: "summary",
        sessionId: "ec847f04-actually-active",
      }) + "\n",
      "utf8",
    );
    const past = new Date(Date.now() - 60_000);
    utimesSync(bystanderPath, past, past);

    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    appendFileSync(
      bystanderPath,
      JSON.stringify({
        type: "user",
        uuid: "ev-1",
        timestamp: "2026-05-24T13:00:00.000Z",
        sessionId: "ec847f04-actually-active",
        message: { role: "user", content: "hi from bystander" },
      }) + "\n",
      "utf8",
    );

    // Wait several poll cycles; bridge MUST NOT pick up the bystander.
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
          f.body?.item?.text === "hi from bystander",
      ),
    ).toBe(false);
    // Store remains pointed at the persisted id.
    expect(env.store.__map["chat-1"]!.sessionId).toBe("persisted-chat-1");
    await env.bridge.dispose("chat-1");
  });

  it("[T-028 / M9 contract] session-store is NOT mutated at attach by a pre-existing bystander's inner sessionId", async () => {
    env = makeEnv();
    const bystanderPath = join(env.sessionDir, "ec847f04.jsonl");
    writeFileSync(
      bystanderPath,
      JSON.stringify({
        type: "summary",
        sessionId: "ec847f04",
      }) + "\n",
      "utf8",
    );
    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);
    // Pre-T-028 behaviour: store.__map['chat-1'].sessionId === 'ec847f04'.
    // Post-T-028 contract: the bound persisted id wins; no upsert at attach.
    const entry = env.store.__map["chat-1"];
    expect(entry).toBeDefined();
    expect(entry!.sessionId).toBe("persisted-chat-1");
    await env.bridge.dispose("chat-1");
  });

  it("falls back to the persisted-sessionId path when the directory is empty", async () => {
    env = makeEnv();
    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    // No file on disk yet. Claude eventually writes to the persisted
    // path. Append there and confirm the bridge tails it.
    const persistedPath = join(env.sessionDir, "persisted-chat-1.jsonl");
    appendFileSync(
      persistedPath,
      JSON.stringify({
        type: "user",
        uuid: "ev-fresh",
        timestamp: "2026-05-24T13:00:00.000Z",
        sessionId: "persisted-chat-1",
        message: { role: "user", content: "fresh chat" },
      }) + "\n",
      "utf8",
    );
    await waitFor(() =>
      ws.sent.some((s) => {
        try {
          const f = JSON.parse(s);
          return (
            f.kind === "item-append" &&
            f.body?.item?.text === "fresh chat"
          );
        } catch {
          return false;
        }
      }),
    );
    const appended = ws.sent
      .map((s) => JSON.parse(s))
      .filter((f) => f.kind === "item-append");
    expect(appended.length).toBeGreaterThanOrEqual(1);
    await env.bridge.dispose("chat-1");
  });

  it("emits a [bridge:attach] log line with chatId + jsonlPath (post-T-028: bound to persisted sessionId, not discovered)", async () => {
    env = makeEnv({ logLevel: "info" });
    // A bystander file present in the dir at attach time must NOT
    // affect the logged jsonlPath — that path is `<persisted>.jsonl`.
    const bystanderPath = join(env.sessionDir, "abc.jsonl");
    writeFileSync(
      bystanderPath,
      JSON.stringify({ type: "summary", sessionId: "abc" }) + "\n",
      "utf8",
    );
    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);
    const attachEvents = env.logRecord.filter(
      (e) => e.stage === "bridge:attach",
    );
    expect(attachEvents).toHaveLength(1);
    expect(attachEvents[0]!.chatId).toBe("chat-1");
    expect(String(attachEvents[0]!.data.jsonlPath)).toContain(
      "persisted-chat-1.jsonl",
    );
    expect(attachEvents[0]!.data.strategy).toBe("bound");
    await env.bridge.dispose("chat-1");
  });

  it("rotation: when a newer .jsonl file appears mid-conversation, the bridge swaps the tail to it (M7 root cause)", async () => {
    env = makeEnv({ rotationPollMs: 30 });
    // Initial attach: one file present.
    const firstPath = join(env.sessionDir, "first.jsonl");
    writeFileSync(
      firstPath,
      JSON.stringify({
        type: "summary",
        sessionId: "first",
      }) + "\n",
      "utf8",
    );
    const past = new Date(Date.now() - 60_000);
    utimesSync(firstPath, past, past);

    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    // Now claude "rotates": a new .jsonl file appears written by our
    // pane's process tree. The bridge should swap tails and emit
    // frames for content in the new file.
    const rotatedPath = join(env.sessionDir, "rotated.jsonl");
    env.pane.ownedPaths.add(rotatedPath);
    writeFileSync(
      rotatedPath,
      JSON.stringify({
        type: "user",
        uuid: "ev-rot-1",
        timestamp: "2026-05-24T13:00:00.000Z",
        sessionId: "rotated",
        message: { role: "user", content: "after rotation" },
      }) + "\n",
      "utf8",
    );

    await waitFor(
      () =>
        ws.sent.some((s) => {
          try {
            const f = JSON.parse(s);
            return (
              f.kind === "item-append" &&
              f.body?.item?.kind === "user-message" &&
              f.body?.item?.text === "after rotation"
            );
          } catch {
            return false;
          }
        }),
      3000,
    );

    const appended = ws.sent
      .map((s) => JSON.parse(s))
      .filter((f) => f.kind === "item-append");
    expect(appended.length).toBeGreaterThanOrEqual(1);
    expect(appended.some((f) => f.body.item.text === "after rotation")).toBe(true);

    // Session-store was updated to the rotated sessionId.
    expect(env.store.__map["chat-1"]!.sessionId).toBe("rotated");

    await env.bridge.dispose("chat-1");
  });

  it("rotation refused when the pane-pid gate is degraded (no lsof) and the newer file's inner sessionId does not confirm ownership", async () => {
    env = makeEnv({ rotationPollMs: 30 });
    // Gate degraded ⇒ paneOwnsFile would answer allow-all. Without the
    // fail-closed guard the poller would adopt any bystander that becomes
    // the most-recent entry — the lsof-less cross-session-mixing bug.
    env.pane.gateDegraded = () => true;
    env.pane.paneOwnsFile = async () => true; // allow-all, as the real gate degrades to

    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    // A bystander session (different inner sessionId) becomes the newest
    // file in the same encoded-cwd directory.
    const bystanderPath = join(env.sessionDir, "bystander.jsonl");
    writeFileSync(
      bystanderPath,
      JSON.stringify({
        type: "user",
        uuid: "ev-bystander",
        timestamp: "2026-05-24T13:00:00.000Z",
        sessionId: "someone-else",
        message: { role: "user", content: "content from another session" },
      }) + "\n",
      "utf8",
    );

    // Several poll cycles pass; the bystander MUST NOT be adopted.
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
      appended.some((f) => f.body?.item?.text === "content from another session"),
    ).toBe(false);
    // Store stays on the bound persisted id — no cross-session upsert.
    expect(env.store.__map["chat-1"]!.sessionId).toBe("persisted-chat-1");
    // The refusal is surfaced once for observability.
    expect(
      env.logRecord.some(
        (e) =>
          e.stage === "bridge:attach" &&
          e.data.strategy === "rotation-refused-gate-degraded",
      ),
    ).toBe(true);
    await env.bridge.dispose("chat-1");
  });

  it("rotation still adopted under a degraded gate when the newer file's inner sessionId matches the bound one", async () => {
    env = makeEnv({ rotationPollMs: 30 });
    env.pane.gateDegraded = () => true;

    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);

    // Same session, differently-named file (inner sessionId confirms it is
    // ours). This is the only rotation we can prove ownership of without lsof.
    const ownPath = join(env.sessionDir, "renamed-but-ours.jsonl");
    writeFileSync(
      ownPath,
      JSON.stringify({
        type: "user",
        uuid: "ev-own",
        timestamp: "2026-05-24T13:00:00.000Z",
        sessionId: "persisted-chat-1",
        message: { role: "user", content: "still my session" },
      }) + "\n",
      "utf8",
    );

    await waitFor(() =>
      ws.sent.some((s) => {
        try {
          const f = JSON.parse(s);
          return f.kind === "item-append" && f.body?.item?.text === "still my session";
        } catch {
          return false;
        }
      }),
    );
    const appended = ws.sent
      .map((s) => JSON.parse(s))
      .filter((f) => f.kind === "item-append");
    expect(appended.some((f) => f.body.item.text === "still my session")).toBe(true);
    await env.bridge.dispose("chat-1");
  });

  it("emits trace-level [tail:line], [translator:event], [bridge:emit] for each JSONL line", async () => {
    env = makeEnv({ logLevel: "trace" });
    // Post-T-028: the bridge tails the bound `persisted-chat-1.jsonl`
    // path. Write the trace event there so the tail observes it.
    const boundPath = join(env.sessionDir, "persisted-chat-1.jsonl");
    const ws = makeWs();
    await env.bridge.attach("chat-1", ws);
    appendFileSync(
      boundPath,
      JSON.stringify({
        type: "user",
        uuid: "ev-trace",
        timestamp: "2026-05-24T13:00:00.000Z",
        sessionId: "persisted-chat-1",
        message: { role: "user", content: "trace me" },
      }) + "\n",
      "utf8",
    );
    await waitFor(() =>
      env!.logRecord.some((e) => e.stage === "bridge:emit"),
    );
    const stages = env.logRecord.map((e) => e.stage);
    expect(stages).toContain("tail:line");
    expect(stages).toContain("translator:event");
    expect(stages).toContain("bridge:emit");
    await env.bridge.dispose("chat-1");
  });
});
