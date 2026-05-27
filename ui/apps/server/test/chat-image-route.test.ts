/**
 * T-005 — GET /chat-image streams a durable per-chat image file, scoped to the
 * chat and traversal-guarded (US-003 read-back leg).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mountChatImageRoute } from "../src/routes/chat-image.ts";
import { createImageStore } from "../src/process-manager/jsonl/image-store.ts";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

function mountRoutes(dataDir: string) {
  const routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>> = {};
  const store = createImageStore({ dataDir });
  mountChatImageRoute(routes, store);
  const handler = routes["/chat-image"];
  return {
    store,
    call: (qs: string) => {
      const url = new URL(`http://localhost/chat-image?${qs}`);
      return Promise.resolve(handler(new Request(url), url));
    },
  };
}

describe("GET /chat-image (T-005)", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "chat-image-route-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns 200 with the manifest content-type and the decoded bytes for a known id", async () => {
    const { store, call } = mountRoutes(dataDir);
    const [staged] = await store.stageTurnImages("c-1", [
      { mediaType: "image/png", dataB64: PNG_B64 },
    ]);
    const id = staged.absPath.match(/([0-9a-f]{32})\./)![1];
    const res = await call(`chatId=c-1&id=${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(readFileSync(staged.absPath))).toBe(true);
  });

  it("returns 404 for an unknown id with no path leak in the body", async () => {
    const { call } = mountRoutes(dataDir);
    const res = await call("chatId=c-1&id=" + "a".repeat(32));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain(dataDir);
  });

  it("rejects path-traversal in id (400/404) and never reads outside the chat dir", async () => {
    const { call } = mountRoutes(dataDir);
    const res = await call("chatId=c-1&id=" + encodeURIComponent("../../etc/passwd"));
    expect([400, 404]).toContain(res.status);
    const body = await res.text();
    expect(body).not.toContain("root:");
  });

  it("rejects path-traversal in chatId", async () => {
    const { call } = mountRoutes(dataDir);
    const res = await call(
      "chatId=" + encodeURIComponent("../../..") + "&id=" + "a".repeat(32),
    );
    expect([400, 404]).toContain(res.status);
  });

  it("returns 400 when required params are missing", async () => {
    const { call } = mountRoutes(dataDir);
    const res = await call("chatId=c-1");
    expect(res.status).toBe(400);
  });
});
