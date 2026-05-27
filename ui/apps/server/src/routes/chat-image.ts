/**
 * GET /chat-image?chatId=<chatId>&id=<hex>
 *
 * Streams a durable per-chat image file staged by the image store, so the web
 * timeline can render past-turn images whose `dataB64` is absent on reattach
 * (design Open ambiguity #1 / ADR-002). chatId-scoped + traversal-guarded.
 */
import * as fs from "node:fs";

import type { ImageStore } from "../process-manager/jsonl/image-store.ts";

export function mountChatImageRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  imageStore: ImageStore,
): void {
  routes["/chat-image"] = (_req, url) => {
    const chatId = url.searchParams.get("chatId") ?? "";
    const id = url.searchParams.get("id") ?? "";
    if (!chatId || !id) {
      return new Response("missing chatId or id", { status: 400 });
    }
    // The store performs the traversal guard (single-segment chatId, hex id)
    // and resolves the on-disk path — the route never builds the path itself.
    const resolved = imageStore.resolveById(chatId, id);
    if (!resolved) {
      return new Response("not found", { status: 404 });
    }
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(resolved.absPath);
    } catch {
      return new Response("not found", { status: 404 });
    }
    return new Response(bytes, {
      status: 200,
      headers: { "content-type": resolved.mediaType },
    });
  };
}
