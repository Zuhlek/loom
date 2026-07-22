/**
 * T-029 / M8-step-4 — Cross-chat-isolation smoke gate.
 *
 * Drives the real bridge against a real `claude` binary inside real
 * tmux sessions, opens TWO concurrent chats in the same cwd, sends a
 * distinct prompt to each, and asserts the WS frame streams are
 * disjoint — each chat sees ONLY its own user prompt and assistant
 * reply.
 *
 * Closes `quality-review.md` M8 step 4: the M8 regression class is
 * "two loom chats in the same cwd converge on the same JSONL". The
 * T-027 single-chat gate cannot catch this — it needs two chats with
 * disjoint expected content. T-028 fixed the cause (bind each chat
 * to its persisted sessionId); this gate is the structural guard
 * against the same shape reappearing.
 *
 * Opt-in only — gated by `LOOM_SMOKE_LIVE=1`. Auto-skipped (with a
 * `console.warn`) when `tmux` or `claude` is not on the host.
 *
 *   LOOM_SMOKE_LIVE=1 pnpm vitest run \
 *     apps/server/test/integration/multi-chat-isolation.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, delimiter } from "node:path";

import { createJsonlTailBridge } from "../../src/process-manager/jsonl/bridge.ts";
import { createTmuxSession } from "../../src/process-manager/tmux-session.ts";
import { probeTmux } from "../../src/process-manager/tmux-availability.ts";
import { createSessionIdStore } from "../../src/process-manager/session-store.ts";

function findOnPath(name: string): string | null {
  const PATH = process.env.PATH ?? "";
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      const st = statSync(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      /* keep searching */
    }
  }
  return null;
}

async function decideGate(): Promise<{
  enabled: boolean;
  reason: string;
  claudeBin: string | null;
}> {
  if (process.env.LOOM_SMOKE_LIVE !== "1") {
    return {
      enabled: false,
      reason: "LOOM_SMOKE_LIVE is not '1' — skipping live multi-chat-isolation gate (set it to enable).",
      claudeBin: null,
    };
  }
  const tmuxOk = await probeTmux();
  if (!tmuxOk.available) {
    return {
      enabled: false,
      reason: "tmux is not available on this host — skipping live multi-chat-isolation gate.",
      claudeBin: null,
    };
  }
  const claudeBin = process.env.LOOM_CLAUDE_BIN ?? findOnPath("claude");
  if (!claudeBin || !existsSync(claudeBin)) {
    return {
      enabled: false,
      reason:
        "claude binary is not on PATH and LOOM_CLAUDE_BIN is unset — skipping live multi-chat-isolation gate.",
      claudeBin: null,
    };
  }
  return { enabled: true, reason: "live gate engaged", claudeBin };
}

const gatePromise = decideGate();
const gate = await gatePromise;
if (!gate.enabled) {
  // eslint-disable-next-line no-console
  console.warn(`[multi-chat-isolation] SKIP — ${gate.reason}`);
}

const describeIfLive = gate.enabled ? describe : describe.skip;

interface Frame {
  kind?: string;
  body?: {
    item?: {
      kind?: string;
      text?: string;
      blocks?: Array<{ type?: string; text?: string }>;
    };
  };
}

function userTextOf(f: Frame): string | null {
  if (f.kind !== "item-append") return null;
  const item = f.body?.item;
  if (!item || item.kind !== "user-message") return null;
  return typeof item.text === "string" ? item.text : null;
}

function assistantTextOf(f: Frame): string | null {
  if (f.kind !== "item-append") return null;
  const item = f.body?.item;
  if (!item || item.kind !== "assistant-message") return null;
  const blocks = Array.isArray(item.blocks) ? item.blocks : [];
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

describeIfLive(
  "multi-chat-isolation (M8 step 4) — two concurrent chats receive disjoint frame streams",
  () => {
    const timeoutMs = Number(
      process.env.LOOM_SMOKE_LIVE_TIMEOUT_MS ?? "60000",
    );

    it(
      "submits ALPHA to chatA and BRAVO to chatB; each WS sees only its own user/assistant content",
      async () => {
        const root = mkdtempSync(join(tmpdir(), "loom-multi-iso-"));
        const sessionStorePath = join(root, "session-id-store.json");
  
        const tmux = createTmuxSession({ claudeBin: gate.claudeBin! });
        const sessionStore = createSessionIdStore({
          storagePath: sessionStorePath,
        });
        const bridge = createJsonlTailBridge({
          tmux,
          sessionStore,
        tailRoot: join(homedir(), ".claude", "projects"),
          cwdResolver: () => process.cwd(),
        });

        const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const chatA = `c_iso_a_${stamp}`;
        const chatB = `c_iso_b_${stamp}`;

        const framesA: Frame[] = [];
        const framesB: Frame[] = [];
        const wsA = {
          send(text: string) {
            try {
              framesA.push(JSON.parse(text) as Frame);
            } catch {
              /* ignore */
            }
          },
        };
        const wsB = {
          send(text: string) {
            try {
              framesB.push(JSON.parse(text) as Frame);
            } catch {
              /* ignore */
            }
          },
        };

        try {
          await bridge.attach(chatA, wsA);
          await bridge.attach(chatB, wsB);

          const promptA =
            "Reply with exactly the word ALPHA and nothing else, no punctuation.";
          const promptB =
            "Reply with exactly the word BRAVO and nothing else, no punctuation.";

          await bridge.submitUserTurn(chatA, promptA);
          await bridge.submitUserTurn(chatB, promptB);

          const start = Date.now();
          let aUserSeen = false;
          let aAssistantSeen = false;
          let bUserSeen = false;
          let bAssistantSeen = false;

          while (Date.now() - start < timeoutMs) {
            for (const f of framesA) {
              const ut = userTextOf(f);
              if (ut && ut.includes("ALPHA")) aUserSeen = true;
              const at = assistantTextOf(f);
              if (at && /ALPHA/i.test(at)) aAssistantSeen = true;
            }
            for (const f of framesB) {
              const ut = userTextOf(f);
              if (ut && ut.includes("BRAVO")) bUserSeen = true;
              const at = assistantTextOf(f);
              if (at && /BRAVO/i.test(at)) bAssistantSeen = true;
            }
            if (aUserSeen && aAssistantSeen && bUserSeen && bAssistantSeen) break;
            await new Promise((r) => setTimeout(r, 250));
          }

          expect(
            aUserSeen,
            "chatA WS should have received a user-text frame containing ALPHA",
          ).toBe(true);
          expect(
            aAssistantSeen,
            "chatA WS should have received an assistant-text frame containing ALPHA",
          ).toBe(true);
          expect(
            bUserSeen,
            "chatB WS should have received a user-text frame containing BRAVO",
          ).toBe(true);
          expect(
            bAssistantSeen,
            "chatB WS should have received an assistant-text frame containing BRAVO",
          ).toBe(true);

          // Isolation: chatA must NOT see BRAVO; chatB must NOT see ALPHA.
          const aHasBravo = framesA.some((f) => {
            const ut = userTextOf(f);
            const at = assistantTextOf(f);
            return (ut && ut.includes("BRAVO")) || (at && /BRAVO/i.test(at));
          });
          const bHasAlpha = framesB.some((f) => {
            const ut = userTextOf(f);
            const at = assistantTextOf(f);
            return (ut && ut.includes("ALPHA")) || (at && /ALPHA/i.test(at));
          });
          expect(
            aHasBravo,
            "M8 regression: chatA WS must NOT receive BRAVO content (chatB's prompt/reply)",
          ).toBe(false);
          expect(
            bHasAlpha,
            "M8 regression: chatB WS must NOT receive ALPHA content (chatA's prompt/reply)",
          ).toBe(false);
        } finally {
          try {
            await bridge.dispose(chatA);
          } catch {
            /* best-effort cleanup */
          }
          try {
            await bridge.dispose(chatB);
          } catch {
            /* best-effort cleanup */
          }
          try {
            rmSync(root, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      },
      Number(process.env.LOOM_SMOKE_LIVE_TIMEOUT_MS ?? "60000") + 15000,
    );
  },
);
