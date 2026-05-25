/**
 * HTTP + WS server built on Fastify + @fastify/websocket.
 *
 * Verifies Origin on every HTTP request and WS upgrade — only
 * localhost origins are allowed. Exposes /health, the hook-receiver
 * route mount, and a WS endpoint.
 *
 * Routes are passed in as a Fetch-style map (pathname → handler that
 * accepts a Web `Request` and returns a `Response`). A wildcard
 * catch-all bridges Fastify's request/reply to those handlers so the
 * existing mount* helpers in apps/server/src/routes/* don't need to
 * change.
 *
 * The WS endpoint understands two protocols:
 *   1. The legacy chat-protocol envelope `{ kind, "chat-id", body }`.
 *   2. The chat-PTY bridge frames: `{ kind: "attach", "chat-id" }`,
 *      `{ kind: "pty-in", "chat-id", body: { data } }`, etc.
 *
 * If a `bridge` instance is passed in, attach/pty-in frames are dispatched
 * through the bridge. Otherwise the optional `onWsMessage` callback is
 * invoked, falling back to an "unknown kind" error.
 */
import Fastify, { type FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "ws";
import { acquireLock } from "./lockfile.ts";
import { makeError, type ChatEnvelope } from "./chat-protocol/envelope.ts";
import { serializeServerFrame, type TasksUpdateFrame } from "./chat-protocol/frames.ts";
import { sanitizeUserTurnImages } from "./chat-protocol/sanitize-user-turn-images.ts";
import type { JsonlTailBridge } from "./process-manager/jsonl/bridge.ts";

export interface ServerOptions {
  port?: number;
  hostname?: string;
  origins?: string[];
  routes?: Record<string, (req: Request, url: URL) => Response | Promise<Response>>;
  onWsMessage?: (data: ChatEnvelope, send: (msg: ChatEnvelope) => void) => void;
  bridge?: JsonlTailBridge;
  acquireLock?: boolean;
  lockPath?: string;
  version?: string;
}

const DEFAULT_VERSION = "0.0.1";

/**
 * Pattern-route matcher. Falls through after the exact-match miss in
 * the fetch handler. Keys may contain `:param` segments — they match
 * any single non-empty segment. Returns the handler whose key matches
 * the pathname, or undefined.
 */
function matchPatternRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  pathname: string,
): ((req: Request, url: URL) => Response | Promise<Response>) | undefined {
  const segs = pathname.split("/");
  for (const key of Object.keys(routes)) {
    if (!key.includes(":")) continue;
    const keySegs = key.split("/");
    if (keySegs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < keySegs.length; i++) {
      const ks = keySegs[i] ?? "";
      const us = segs[i] ?? "";
      if (ks.startsWith(":")) {
        if (us.length === 0) {
          ok = false;
          break;
        }
        continue;
      }
      if (ks !== us) {
        ok = false;
        break;
      }
    }
    if (ok) return routes[key];
  }
  return undefined;
}

function isLocalhostOrigin(origin: string | null, allowed: string[]): boolean {
  if (!origin) {
    // Tools like curl don't send Origin; allow when not present.
    return true;
  }
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1") {
      return true;
    }
    if (allowed.includes(origin)) return true;
    if (allowed.includes(u.host)) return true;
    return false;
  } catch {
    return false;
  }
}

export interface ServerHandle {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

interface WsConnState {
  origin: string | null;
  attachedChatId: string | null;
}

export async function startServer(opts: ServerOptions = {}): Promise<ServerHandle> {
  const port = opts.port ?? 0; // 0 = random ephemeral
  const hostname = opts.hostname ?? "127.0.0.1";
  const origins = opts.origins ?? [];
  const routes = opts.routes ?? {};
  const version = opts.version ?? DEFAULT_VERSION;

  let lockRelease: (() => void) | undefined;
  if (opts.acquireLock !== false) {
    const result = acquireLock(opts.lockPath);
    if (!result.ok) {
      const err: any = new Error(result.message ?? "lockfile failed");
      err.code = "LOCK_FAILED";
      err.reason = result.reason;
      err.pid = result.pid;
      throw err;
    }
    lockRelease = result.release;
  }

  // Track which WS clients are attached to which chat so the bridge can
  // fan out `tasks-update` frames sourced from the transcript watcher.
  const attachedByChat = new Map<string, Set<WebSocket>>();
  const wsState = new WeakMap<WebSocket, WsConnState>();
  let unsubTasks: (() => void) | null = null;
  if (opts.bridge) {
    unsubTasks = opts.bridge.onTasksUpdate((chatId, tasks) => {
      const set = attachedByChat.get(chatId);
      if (!set) return;
      const frame: TasksUpdateFrame = {
        kind: "tasks-update",
        "chat-id": chatId,
        body: { tasks },
      };
      const payload = serializeServerFrame(frame);
      for (const ws of set) {
        try {
          ws.send(payload);
        } catch {}
      }
    });
  }

  const app: FastifyInstance = Fastify({ logger: false });

  // Hand every request body to handlers as a Buffer; routes call
  // new Request(...).json()/.formData()/.arrayBuffer() themselves.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  await app.register(websocketPlugin);

  // Origin gate. /ws is excluded here because @fastify/websocket attaches
  // its upgrade handler before this hook fires; the WS handler does its
  // own origin check.
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/ws" || request.url.startsWith("/ws?")) return;
    const origin = request.headers.origin ?? null;
    if (!isLocalhostOrigin(origin, origins)) {
      reply.code(403).type("text/plain").send("forbidden: origin");
    }
  });

  app.get("/health", async (request, reply) => {
    const origin = request.headers.origin ?? "*";
    reply.header("access-control-allow-origin", origin);
    reply.header("content-type", "application/json");
    return { ok: true, version };
  });

  // WS endpoint.
  app.get("/ws", { websocket: true }, (socket: WebSocket, request) => {
    const origin = request.headers.origin ?? null;
    if (!isLocalhostOrigin(origin, origins)) {
      socket.close();
      return;
    }
    wsState.set(socket, { origin, attachedChatId: null });

    socket.on("message", async (raw) => {
      let envelope: ChatEnvelope;
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        envelope = JSON.parse(text);
      } catch {
        socket.send(JSON.stringify(makeError(undefined, "invalid json")));
        return;
      }
      if (!envelope || typeof envelope.kind !== "string") {
        socket.send(JSON.stringify(makeError(undefined, "missing kind")));
        return;
      }
      const send = (msg: ChatEnvelope) => socket.send(JSON.stringify(msg));

      if (opts.bridge) {
        if (envelope.kind === "attach") {
          const chatId = envelope["chat-id"];
          if (!chatId) {
            send(makeError(undefined, "attach: missing chat-id"));
            return;
          }
          try {
            await opts.bridge.attach(chatId, makeWsClient(socket));
            const st = wsState.get(socket);
            if (st) st.attachedChatId = chatId;
            let set = attachedByChat.get(chatId);
            if (!set) {
              set = new Set();
              attachedByChat.set(chatId, set);
            }
            set.add(socket);
            send({
              kind: "attached",
              "chat-id": chatId,
              body: { ok: true },
            });
          } catch (err: any) {
            send(makeError(chatId, err?.message ?? "attach failed"));
          }
          return;
        }
        if (envelope.kind === "user-turn") {
          const chatId = envelope["chat-id"];
          const body = envelope.body as
            | {
                text?: string;
                priority?: "now" | "next" | "later";
                images?: unknown;
              }
            | undefined;
          const text = body?.text;
          if (!chatId || typeof text !== "string") {
            send(makeError(chatId, "user-turn: missing chat-id or body.text"));
            return;
          }
          const rawPriority = body?.priority;
          const priority: "now" | "next" | "later" =
            rawPriority === "now" || rawPriority === "next" || rawPriority === "later"
              ? rawPriority
              : "now";
          // Defence-in-depth: filter malformed `body.images` before
          // forwarding to the bridge.
          const images = sanitizeUserTurnImages(body?.images);
          opts.bridge.submitUserTurnWithPriority(chatId, text, priority, images);
          return;
        }
        if (envelope.kind === "interrupt") {
          const chatId = envelope["chat-id"];
          if (!chatId) {
            send(makeError(undefined, "interrupt: missing chat-id"));
            return;
          }
          opts.bridge.interrupt(chatId);
          return;
        }
        if (envelope.kind === "plan-accept") {
          const chatId = envelope["chat-id"];
          const body = envelope.body as { planId?: string } | undefined;
          const planId = body?.planId;
          if (!chatId || typeof planId !== "string" || planId === "") {
            send(makeError(chatId, "plan-accept: missing chat-id or body.planId"));
            return;
          }
          // Fire-and-forget per design-ADR; any SDK error is surfaced as a
          // session-scoped system-notice by the bridge.
          void opts.bridge.acceptPlanProposal(chatId, planId);
          return;
        }
        if (envelope.kind === "plan-reject") {
          const chatId = envelope["chat-id"];
          const body = envelope.body as { planId?: string } | undefined;
          const planId = body?.planId;
          if (!chatId || typeof planId !== "string" || planId === "") {
            send(makeError(chatId, "plan-reject: missing chat-id or body.planId"));
            return;
          }
          void opts.bridge.rejectPlanProposal(chatId, planId);
          return;
        }
        if (envelope.kind === "permission-mode-set") {
          const chatId = envelope["chat-id"];
          const body = envelope.body as { mode?: string } | undefined;
          const mode = body?.mode;
          if (
            !chatId ||
            (mode !== "default" &&
              mode !== "plan" &&
              mode !== "acceptEdits" &&
              mode !== "bypassPermissions")
          ) {
            send(makeError(chatId, "permission-mode-set: missing chat-id or invalid body.mode"));
            return;
          }
          // Fire-and-forget; per design-ADR the call is forwarded straight
          // to the SDK Query handle without coalescing/debouncing. Any
          // SDK rejection is surfaced as a session-scoped notice by the
          // bridge, so we do not propagate the promise here.
          void opts.bridge.setPermissionMode(chatId, mode);
          return;
        }
        if (envelope.kind === "question-response") {
          const chatId = envelope["chat-id"];
          const body = envelope.body as
            | { id?: string; answers?: unknown; otherText?: unknown }
            | undefined;
          const answers = Array.isArray(body?.answers)
            ? (body!.answers as unknown[]).filter((a): a is string => typeof a === "string")
            : null;
          if (!chatId || !body?.id || !answers) {
            send(
              makeError(
                chatId,
                "question-response: missing chat-id/id or invalid body.answers",
              ),
            );
            return;
          }
          const otherText = typeof body.otherText === "string" ? body.otherText : undefined;
          opts.bridge.respondToQuestion(chatId, body.id, { answers, otherText });
          return;
        }
        if (envelope.kind === "permission-response") {
          const chatId = envelope["chat-id"];
          const body = envelope.body as
            | { id?: string; behavior?: "allow" | "deny"; remember?: boolean; message?: string }
            | undefined;
          if (!chatId || !body?.id || (body.behavior !== "allow" && body.behavior !== "deny")) {
            send(makeError(chatId, "permission-response: missing chat-id/id/behavior"));
            return;
          }
          opts.bridge.respondToPermission(chatId, body.id, body.behavior, {
            remember: body.remember,
            message: body.message,
          });
          return;
        }
        if (envelope.kind === "model-settings-set") {
          const chatId = envelope["chat-id"];
          const body = envelope.body;
          if (!chatId || typeof body !== "object" || body === null) {
            send(makeError(chatId, "model-settings-set: missing chat-id or body"));
            return;
          }
          opts.bridge.setModelSettings(chatId, body as Record<string, unknown>);
          return;
        }
        if (envelope.kind === "retry-session") {
          const chatId = envelope["chat-id"];
          if (!chatId) {
            send(makeError(undefined, "retry-session: missing chat-id"));
            return;
          }
          opts.bridge.retrySession(chatId);
          return;
        }
        if (envelope.kind === "detach") {
          const chatId = envelope["chat-id"];
          if (chatId) {
            opts.bridge.detach(chatId, makeWsClient(socket));
            const st = wsState.get(socket);
            if (st) st.attachedChatId = null;
            const set = attachedByChat.get(chatId);
            if (set) {
              set.delete(socket);
              if (set.size === 0) attachedByChat.delete(chatId);
            }
          }
          return;
        }
      }

      if (opts.onWsMessage) {
        opts.onWsMessage(envelope, send);
      } else {
        send(makeError(envelope["chat-id"], `unknown kind: ${envelope.kind}`));
      }
    });

    socket.on("close", () => {
      const st = wsState.get(socket);
      const chatId = st?.attachedChatId ?? null;
      if (chatId && opts.bridge) {
        opts.bridge.detach(chatId, makeWsClient(socket));
      }
      if (chatId) {
        const set = attachedByChat.get(chatId);
        if (set) {
          set.delete(socket);
          if (set.size === 0) attachedByChat.delete(chatId);
        }
      }
      wsState.delete(socket);
    });
  });

  // Catch-all that dispatches through the Fetch-style routes map.
  app.setNotFoundHandler(async (request, reply) => {
    const base = `http://${hostname}`;
    const url = new URL(request.url, base);
    const handler = routes[url.pathname] ?? matchPatternRoute(routes, url.pathname);
    if (!handler) {
      reply.code(404).type("text/plain").send("not found");
      return;
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(request.headers)) {
      if (v == null) continue;
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(","));
    }

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody && request.body instanceof Buffer ? request.body : undefined;

    const webReq = new Request(url.toString(), {
      method: request.method,
      headers,
      body,
    });

    const res = await handler(webReq, url);

    // Always include CORS for localhost dev (Vite proxy preserves Origin).
    try {
      res.headers.set("access-control-allow-origin", request.headers.origin ?? "*");
    } catch {}

    reply.code(res.status);
    for (const [k, v] of res.headers.entries()) {
      reply.header(k, v);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    reply.send(buf);
  });

  await app.listen({ port, host: hostname });
  const addr = app.server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    port: actualPort,
    url: `http://${hostname}:${actualPort}`,
    async stop() {
      try {
        await app.close();
      } catch {}
      try {
        unsubTasks?.();
      } catch {}
      attachedByChat.clear();
      if (lockRelease) lockRelease();
    },
  };
}

function makeWsClient(ws: WebSocket) {
  return {
    send(text: string) {
      try {
        ws.send(text);
      } catch {}
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

export const __test__ = { isLocalhostOrigin };
