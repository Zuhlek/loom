/**
 * F4 — unit tests for the `shouldShowEmptyState` helper. The placeholder
 * ("Send a message to start the conversation.") must NOT render while a
 * turn is running, even with zero items — that case (e.g. a passive second
 * tab that received the `turn-state running` broadcast without an optimistic
 * item) is owned by the WorkingChip instead.
 */
import { describe, expect, test } from "vitest";

import { shouldShowEmptyState } from "../src/components/chat/MessagesTimeline";

describe("shouldShowEmptyState", () => {
  test("0 items + idle → true (the only case that shows the placeholder)", () => {
    expect(shouldShowEmptyState(0, "idle")).toBe(true);
  });

  test("0 items + running → false (WorkingChip is the feedback, not the placeholder)", () => {
    expect(shouldShowEmptyState(0, "running")).toBe(false);
  });

  test(">0 items + idle → false", () => {
    expect(shouldShowEmptyState(3, "idle")).toBe(false);
  });

  test(">0 items + running → false", () => {
    expect(shouldShowEmptyState(3, "running")).toBe(false);
  });
});
