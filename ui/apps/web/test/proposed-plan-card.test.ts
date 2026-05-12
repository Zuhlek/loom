/**
 * T-003 — Interactive ProposedPlanCard (web side).
 *
 * Verifies US-003 acceptance criteria on the web side via static-source
 * contract checks (test runtime is `node` and the include glob is
 * `apps/** /test/** /*.test.ts` — matching the precedent set by
 * `composer-controls.test.ts`, `tool-result-media.test.ts`, etc.).
 *
 *   AC2 (web): when a `plan-proposed` ChatItem is the latest item, the
 *       `ProposedPlanCard` renders with both an Accept and a Reject
 *       button. Buttons disable when the item's `status !== "pending"`.
 *   AC3 (web): clicking Accept emits a `plan-accept` ClientFrame with
 *       the plan item's id.
 *   AC4 (web): clicking Reject emits a `plan-reject` ClientFrame with
 *       the plan item's id.
 *   AC5 (mirror): the `PlanProposedItem` kind and the two new
 *       ClientFrame variants are declared in `chat-types.ts` matching
 *       the server union.
 *
 *   MessagesTimeline integration: the timeline's per-item render branch
 *       includes a `plan-proposed` case that mounts the new card.
 *
 * RED path:
 *   - `ProposedPlanCard.tsx` does not exist → file-existence check fails.
 *   - `chat-types.ts` lacks the `PlanProposedItem` mirror and the
 *     `plan-accept` / `plan-reject` ClientFrame variants → static-grep
 *     fails.
 *   - `MessagesTimeline.tsx` has no `plan-proposed` switch branch →
 *     static-grep fails.
 *   - `live-chat.tsx` does not yet emit either new frame kind.
 *
 * GREEN path: implementation lands all four touchpoints in the same
 * diff per Spec `## Constraints` wire-mirror discipline.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const cardPath = webRoot + "src/components/chat/ProposedPlanCard.tsx";
const timelinePath = webRoot + "src/components/chat/MessagesTimeline.tsx";
const liveChatPath = webRoot + "src/routes/live-chat.tsx";
const typesPath = webRoot + "src/lib/chat-types.ts";

describe("T-003 ProposedPlanCard — file exists + Accept/Reject buttons (US-003 AC2)", () => {
  test("ProposedPlanCard.tsx exists at the documented path", () => {
    expect(existsSync(cardPath)).toBe(true);
  });

  test("component declares an Accept handler/button and a Reject handler/button", () => {
    const src = readFileSync(cardPath, "utf8");
    // Loose match: the component must reference an onAccept and onReject
    // prop or equivalent local handler. Static-grep is the test surface
    // per project convention (no jsdom).
    expect(src).toMatch(/onAccept/);
    expect(src).toMatch(/onReject/);
    // The visible button labels live in the JSX.
    expect(src).toMatch(/Accept/);
    expect(src).toMatch(/Reject/);
  });

  test("component accepts a `PlanProposedItem` via an `item` prop (or similar)", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/PlanProposedItem|plan-proposed|planText/);
  });

  test("buttons disable when status !== 'pending'", () => {
    const src = readFileSync(cardPath, "utf8");
    // The component branches on the item's status to drive the disabled
    // attribute. Accept either a direct `status !== "pending"` check
    // or a derived boolean named `disabled` / `isPending`.
    expect(src).toMatch(/status/);
    expect(src).toMatch(/disabled/);
  });
});

describe("T-003 MessagesTimeline — plan-proposed render branch", () => {
  test("timeline switch covers the `plan-proposed` ChatItem kind", () => {
    const src = readFileSync(timelinePath, "utf8");
    expect(src).toMatch(/plan-proposed/);
    expect(src).toMatch(/ProposedPlanCard/);
  });
});

describe("T-003 chat-types mirror — PlanProposedItem + frames (US-003 AC5)", () => {
  test("chat-types declares the `plan-proposed` ChatItem kind", () => {
    const src = readFileSync(typesPath, "utf8");
    expect(src).toMatch(/PlanProposedItem/);
    expect(src).toMatch(/"plan-proposed"/);
    // The item carries planText + status.
    expect(src).toMatch(/planText/);
    expect(src).toMatch(/"pending"\s*\|\s*"accepted"\s*\|\s*"rejected"/);
  });

  test("chat-types ClientFrame union includes `plan-accept` and `plan-reject`", () => {
    const src = readFileSync(typesPath, "utf8");
    expect(src).toMatch(/"plan-accept"/);
    expect(src).toMatch(/"plan-reject"/);
    expect(src).toMatch(/planId/);
  });
});

describe("T-003 live-chat — emits plan-accept / plan-reject on button handlers", () => {
  test("live-chat dispatches a `plan-accept` ClientFrame", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/"plan-accept"/);
  });

  test("live-chat dispatches a `plan-reject` ClientFrame", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/"plan-reject"/);
  });

  test("live-chat references ProposedPlanCard or wires Accept/Reject handlers", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The route either renders the card directly or wires the handlers
    // via the timeline. Either is acceptable (Design ## Plan-proposed
    // lifecycle says the card is rendered inside the timeline render
    // branch, but the handlers are owned by live-chat). The handler
    // names must be present somewhere in this file.
    expect(src).toMatch(/planId|plan-accept|plan-reject/);
  });
});
