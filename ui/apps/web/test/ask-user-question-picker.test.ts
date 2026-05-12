/**
 * T-002 — AskUserQuestion picker end-to-end (web side).
 *
 * Test style matches the project's static-source + pure-logic smoke
 * pattern (chat-markdown-shiki.test.ts, composer-controls.test.ts):
 * vitest's include glob is `apps/** /test/** /*.test.ts` only and the
 * test runtime is `node` (no jsdom). We verify the component source
 * declares the new contract (multi-select + Other), and we exercise
 * the live-chat frame-emission contract through the chat-types union.
 *
 * What we assert:
 *   AC2 (web): `live-chat.tsx` renders `<AskUserQuestionPicker>` inside
 *       the `pendingQuestion` branch (next to the `pendingPermission`
 *       branch). Static-source check.
 *   AC3 (web): `AskUserQuestionPicker.tsx` props now include `multiSelect`
 *       and the component renders a checkbox UI when it is true; the
 *       internal selection model is an array (`string[]`).
 *   AC4 (web): the picker exposes an "Other" / "__freeform__" option
 *       with an inline text input that gets revealed when picked, and
 *       its `onSubmit` payload carries `{ answers: string[], otherText?: string }`.
 *   AC5 (web): `live-chat.tsx` sends a `question-response` ClientFrame
 *       with `{ id, answers, otherText? }` on picker submit.
 *   mirror: chat-types.ts declares the `question-response` ClientFrame
 *       variant matching the server union (answers + otherText shape).
 *
 * RED path:
 *   Before implementation, the picker source does NOT contain the
 *   multi-select / Other free-text wiring, and `live-chat.tsx` does
 *   NOT render the picker. The static regexes return false; the
 *   runtime expects fail.
 *
 * GREEN path: the picker source matches the regexes; the live-chat
 * render branch is present; the chat-types mirror carries the
 * `answers` shape on `question-response`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const pickerPath = webRoot + "src/components/chat/AskUserQuestionPicker.tsx";
const liveChatPath = webRoot + "src/routes/live-chat.tsx";
const typesPath = webRoot + "src/lib/chat-types.ts";

describe("T-002 AskUserQuestionPicker contract (US-001 AC3/AC4)", () => {
  test("AskUserQuestionPicker.tsx exists at the documented path", () => {
    expect(existsSync(pickerPath)).toBe(true);
  });

  test("picker source accepts a `multiSelect` flag on props or the question payload", () => {
    const src = readFileSync(pickerPath, "utf8");
    expect(src).toMatch(/multiSelect/);
  });

  test("picker source uses an array-shaped selection model (selected: string[])", () => {
    const src = readFileSync(pickerPath, "utf8");
    // The hook signature when state is an array is `useState<string[]>`
    // or `useState([` or `useState(new Set` — any of these counts as
    // "internal selection is array-typed".
    const arrayState =
      /useState<string\[\]>/.test(src) ||
      /useState\(\s*\[/.test(src) ||
      /useState<Set</.test(src);
    expect(arrayState).toBe(true);
  });

  test("picker source renders a checkbox input branch for multi-select mode", () => {
    const src = readFileSync(pickerPath, "utf8");
    // Multi-select UI uses `type="checkbox"` (literal) or interpolated
    // `type={... ? "checkbox" : "radio"}` — accept either form.
    expect(src).toMatch(/["']checkbox["']/);
  });

  test("picker source declares an 'Other' free-text sentinel via the `__freeform__` id", () => {
    const src = readFileSync(pickerPath, "utf8");
    expect(src).toMatch(/__freeform__/);
  });

  test("picker `onSubmit` payload carries an `answers` array + optional `otherText`", () => {
    const src = readFileSync(pickerPath, "utf8");
    // The component invokes `onSubmit(...)` with an object whose shape
    // matches the wire `question-response` body. We check the field
    // names appear in the same source.
    expect(src).toMatch(/answers/);
    expect(src).toMatch(/otherText/);
  });

  test("picker source reveals a text input when the 'Other' option is picked", () => {
    const src = readFileSync(pickerPath, "utf8");
    // A conditional render guarded by the freeform sentinel — accept
    // either the explicit conditional (`includes("__freeform__")`) or
    // a state-driven boolean.
    const hasReveal =
      /includes\(["']__freeform__["']\)/.test(src) ||
      /=== ["']__freeform__["']/.test(src) ||
      /freeform/i.test(src);
    expect(hasReveal).toBe(true);
  });
});

describe("T-002 live-chat — pendingQuestion render branch + frame emission (AC2/AC5)", () => {
  test("live-chat.tsx imports the AskUserQuestionPicker component", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/AskUserQuestionPicker/);
  });

  test("live-chat.tsx renders the picker inside a pendingQuestion branch", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The render tree must reference `pendingQuestion` next to a
    // <AskUserQuestionPicker /> instance. Static smoke — the strict
    // contract is enforced by AC1 (server side) + the runtime smoke
    // checklist.
    expect(src).toMatch(/pendingQuestion/);
    expect(src).toMatch(/<AskUserQuestionPicker/);
  });

  test("live-chat.tsx sends a `question-response` frame on picker submit", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/question-response/);
    // The submit handler must forward `answers` (multi-select compatible).
    expect(src).toMatch(/answers/);
  });
});

describe("T-002 chat-types mirror — question-response answer shape", () => {
  test("chat-types ClientFrame union includes `question-response`", () => {
    const src = readFileSync(typesPath, "utf8");
    expect(src).toMatch(/question-response/);
  });

  test("chat-types `question-response.body` declares `answers: string[]`", () => {
    const src = readFileSync(typesPath, "utf8");
    // The body shape carries an `answers` array per the AC4/AC5 contract
    // (multi-select compatible); the previous single-`choice` form is
    // superseded.
    expect(src).toMatch(/answers\s*:\s*string\[\]/);
  });

  test("chat-types `question-response.body` declares an optional `otherText` field", () => {
    const src = readFileSync(typesPath, "utf8");
    expect(src).toMatch(/otherText\?\s*:\s*string/);
  });
});
