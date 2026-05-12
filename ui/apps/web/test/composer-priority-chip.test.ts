/**
 * T-013 — Composer priority chip relabel (US-007).
 *
 * Static-source scan style (matches existing apps/web/test harness —
 * Vitest include = *.test.ts, environment = node).
 *
 * Covers US-007 AC1 (tooltip names per-turn semantics explicitly),
 * AC2 (select is NOT rendered when turnState === "idle"), and
 * AC3 (option labels read as one-shot scheduling actions, not as a
 * persistent mode).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";

/**
 * Slice out the `data-testid="queue-priority-select"` <select> element
 * and surrounding render gate. We brace-match from the opening `<select`
 * up to its closing `</select>` to get the full block including
 * children. The gate condition is the nearest enclosing `&& (` or
 * `?` expression — we pull a generous prefix around the opening tag.
 */
function extractPrioritySelect(src: string): { gateAndBlock: string; block: string } {
  const sel = src.indexOf('data-testid="queue-priority-select"');
  expect(sel).toBeGreaterThan(-1);
  // Walk back to the nearest `<select` opening.
  const openIdx = src.lastIndexOf("<select", sel);
  // And walk back ~200 chars to capture the render gate (e.g. `{isRunning && (`).
  const gateStart = Math.max(0, openIdx - 200);
  // Walk forward to the matching `</select>`.
  const closeIdx = src.indexOf("</select>", sel);
  expect(closeIdx).toBeGreaterThan(openIdx);
  const block = src.slice(openIdx, closeIdx + "</select>".length);
  const gateAndBlock = src.slice(gateStart, closeIdx + "</select>".length);
  return { gateAndBlock, block };
}

describe("T-013 priority chip tooltip names per-turn semantics (US-007 AC1)", () => {
  test("tooltip no longer reads 'Queue priority' (the original persistent-mode wording)", () => {
    const src = readFileSync(composerPath, "utf8");
    const { block } = extractPrioritySelect(src);
    // The original literal `title="Queue priority"` is replaced; if it
    // remains, the relabel hasn't happened.
    expect(block).not.toMatch(/title="Queue priority"/);
  });

  test("tooltip / title attribute names per-turn semantics explicitly", () => {
    const src = readFileSync(composerPath, "utf8");
    const { block } = extractPrioritySelect(src);
    // Find the title="..." attr value; assert it mentions the next
    // message / one-shot framing. We accept either "next message" or
    // "applies once" since the spec leaves final wording to Build
    // within these constraints.
    const titleMatch = /title="([^"]+)"/.exec(block);
    expect(titleMatch).toBeTruthy();
    const title = titleMatch![1].toLowerCase();
    const namesPerTurn =
      title.includes("next message") ||
      title.includes("applies once") ||
      title.includes("one-shot") ||
      title.includes("per-turn");
    expect(namesPerTurn).toBe(true);
  });
});

describe("T-013 priority chip is not rendered when turnState is idle (US-007 AC2)", () => {
  test("the select render is gated on a 'running'-shaped condition (NOT idle)", () => {
    const src = readFileSync(composerPath, "utf8");
    const { gateAndBlock } = extractPrioritySelect(src);
    // The select must sit inside a JSX conditional whose predicate
    // names `isRunning`, `turnState === "running"`, or equivalent. We
    // verify by checking that the immediate prefix region contains
    // one of these idioms.
    const hasRunningGate =
      /\bisRunning\b/.test(gateAndBlock) ||
      /turnState\s*===\s*["']running["']/.test(gateAndBlock);
    expect(hasRunningGate).toBe(true);
  });
});

describe("T-013 option labels read as one-shot scheduling actions (US-007 AC3)", () => {
  test("the option labels no longer read as a persistent mode", () => {
    const src = readFileSync(composerPath, "utf8");
    const { block } = extractPrioritySelect(src);
    // Pull every <option value="...">label</option> entry.
    const options = Array.from(block.matchAll(/<option\s+value="([^"]+)"[^>]*>([^<]+)<\/option>/g));
    expect(options.length).toBeGreaterThanOrEqual(2);
    // Each visible label must not equal a bare mode noun like "normal"
    // or "next" — those read as persistent modes. The relabel makes
    // the labels read as actions on the next message.
    const labels = options.map((m) => m[2].trim().toLowerCase());
    for (const label of labels) {
      // A one-shot label phrases the action. We accept any of:
      // - it contains "next" as a relative-time reference
      //   alongside a verb like "send" / "schedule" / "queue"
      // - or it contains "as " (e.g. "Send next as high-priority")
      // The previous literal "normal" / "next" bare nouns must be
      // gone.
      expect(label).not.toBe("normal");
      expect(label).not.toBe("next");
    }
  });

  test("each option label reads as a scheduling action (contains a verb / 'as ' / 'send')", () => {
    const src = readFileSync(composerPath, "utf8");
    const { block } = extractPrioritySelect(src);
    const options = Array.from(block.matchAll(/<option\s+value="([^"]+)"[^>]*>([^<]+)<\/option>/g));
    for (const m of options) {
      const label = m[2].toLowerCase();
      const looksLikeAction =
        label.includes("send") ||
        label.includes("schedule") ||
        label.includes("queue") ||
        label.includes(" as ") ||
        label.includes("next message");
      expect(looksLikeAction).toBe(true);
    }
  });
});
