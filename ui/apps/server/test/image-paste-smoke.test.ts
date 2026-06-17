/**
 * T-007 — Production-wiring smoke (tests.md ## Smoke gate).
 *
 * Stitches the REAL units as constructed in production — a real temp-dir
 * createImageStore injected into a real bridge, and a real materializer fed the
 * store's lookupByPath resolver curried by chatId — with only tmux faked. This
 * is the cross-unit happy-path stitch for US-001 + US-003.
 *
 * (The live `claude` TUI @<path> round-trip and the cross-restart visual are the
 * HITL portion of T-007 and are NOT automatable here — see tests.md ## Manual /
 * live gate.)
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJsonlTailBridge,
  type JsonlTailBridgeOptions,
  type WsClient,
} from "../src/process-manager/jsonl/bridge.ts";
import { createImageStore } from "../src/process-manager/jsonl/image-store.ts";
import { createMaterializer } from "../src/process-manager/jsonl/materializer.ts";
import type { TmuxSessionApi } from "../src/process-manager/tmux-session.ts";
import type { SessionIdStore, SessionEntry } from "../src/process-manager/session-store.ts";
import type { JsonlPathProbe, ResolvedTailRoot } from "../src/process-manager/jsonl-path-probe.ts";
import type { ClaudeEvent } from "../src/process-manager/jsonl/schema.ts";
import type { UserMessageItem } from "../src/chat-protocol/messages.ts";
import { makeEnvelope } from "../src/chat-protocol/envelope.ts";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

function mkTmuxRec(): {
  api: TmuxSessionApi;
  calls: { sendInput: { chatId: string; text: string }[] };
} {
  const calls = { sendInput: [] as { chatId: string; text: string }[] };
  const api: TmuxSessionApi = {
    async ensure() {},
    async kill() {},
    async sendInput(chatId, text) {
      calls.sendInput.push({ chatId, text });
    },
    async sendKey() {},
    async interrupt() {},
    async exists() {
      return true;
    },
  };
  return { api, calls };
}

function makeWs(): WsClient & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send(text: string) {
      sent.push(text);
    },
  };
}

describe("T-007 — production-wiring smoke (real store + bridge + materializer)", () => {
  it("stages a PNG to disk, appends @<absPath>, records the manifest, then resolves it back on the timeline", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "image-smoke-"));
    const root = mkdtempSync(join(tmpdir(), "image-smoke-tail-"));
    const tailRoot = join(root, "projects");
    mkdirSync(tailRoot, { recursive: true });
    const { api, calls } = mkTmuxRec();

    // Real image store, exactly as index.ts constructs it (just a fixed dataDir).
    const imageStore = createImageStore({ dataDir });

    const sessionStore: SessionIdStore = {
      async get() {
        return undefined;
      },
      async getOrCreate(chatId, cwd): Promise<SessionEntry> {
        return { sessionId: `sess-${chatId}`, cwd, createdAt: "2026-01-01T00:00:00.000Z" };
      },
      async delete() {},
      async upsert(_chatId, sessionId, cwd): Promise<SessionEntry> {
        return { sessionId, cwd: cwd ?? "", createdAt: "2026-01-01T00:00:00.000Z" };
      },
      async findByClaudeSessionId() {
        return undefined;
      },
    };
    const pathProbe: JsonlPathProbe = {
      async resolve(): Promise<ResolvedTailRoot> {
        return {
          tailRoot,
          encodingScheme: "cwd-slash-encoded",
          resolvedAt: "2026-01-01T00:00:00.000Z",
          claudeVersionAtProbe: "test",
        };
      },
      async reprobe(): Promise<ResolvedTailRoot> {
        return this.resolve();
      },
      encodeCwd(cwd) {
        return cwd.replace(/\//g, "-");
      },
    };
    const opts: JsonlTailBridgeOptions = {
      tmux: api,
      sessionStore,
      pathProbe,
      imageStore,
      paneProcess: {
        async paneRootPid() {
          return 12345;
        },
        async paneOwnsFile() {
          return true;
        },
        gateDegraded() {
          return false;
        },
      },
      cwdResolver: async (chatId) => `/tmp/${chatId}`,
      tailPollingMs: 25,
    };

    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      // F1 cold-start gate: signal readiness so the turn sends immediately.
      bridge.routeHookEnvelope(makeEnvelope("session-start", "c-1", { sessionId: "s" }));
      await bridge.submitUserTurn("c-1", "what is in this image", [
        { mediaType: "image/png", dataB64: PNG_B64, filename: "shot.png" },
      ]);

      // (b) tmux text ends with a single @<absPath> token.
      expect(calls.sendInput).toHaveLength(1);
      const sentText = calls.sendInput[0].text;
      const m = sentText.match(/^what is in this image @(\S+)$/);
      expect(m, `sent text should end with one @<path>: ${sentText}`).not.toBeNull();
      const absPath = m![1];

      // (a) a file appears under <dataDir>/images/<chatId>/.
      expect(absPath).toContain(join(dataDir, "images", "c-1"));
      expect(existsSync(absPath)).toBe(true);

      // (c) manifest.json records the path.
      const manifest = JSON.parse(
        readFileSync(join(dataDir, "images", "c-1", "manifest.json"), "utf8"),
      );
      expect(manifest.entries[absPath]).toMatchObject({ mediaType: "image/png" });

      // Read-back: run the echoed user line through a materializer wired with
      // the SAME resolver currying the production lookupByPath, as the bridge does.
      const materializer = createMaterializer({
        chatId: "c-1",
        resolveImage: (p) => imageStore.lookupByPath("c-1", p),
      });
      const userEvent = {
        chatId: "c-1",
        sessionId: "sess-c-1",
        tsIso: "2026-01-01T00:00:00.000Z",
        kind: "text",
        id: "evt-1",
        role: "user",
        text: sentText,
      } as unknown as ClaudeEvent;
      materializer.ingest(userEvent);
      const userItem = materializer
        .snapshot()
        .items.find((i) => i.kind === "user-message") as UserMessageItem;
      expect(userItem.text).toBe("what is in this image");
      expect(userItem.images).toHaveLength(1);
      expect(userItem.images![0]).toMatchObject({
        mediaType: "image/png",
        filename: "shot.png",
      });
      expect(userItem.images![0].id).toMatch(/^[0-9a-f]{32}$/);

      await bridge.dispose("c-1");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
