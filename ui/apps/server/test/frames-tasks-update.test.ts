/**
 * T-001 — `tasks-update` typed end-to-end.
 *
 * Verifies US-009 acceptance criteria:
 *   1. ServerFrame union includes the `tasks-update` variant with the
 *      same body shape as the web mirror.
 *   2. The typed `serializeServerFrame` helper produces the exact JSON
 *      wire shape currently consumed by `live-chat.tsx` / TasksPanel.
 *
 * RED path: the helper is stubbed to return "__STUB__"; the runtime
 * assertion that the emitted JSON matches the wire shape fails. The
 * union-membership assertion fails because the variant is declared as
 * a stand-alone interface but not yet added to the union.
 *
 * GREEN path: the union includes TasksUpdateFrame and the helper is
 * implemented as `JSON.stringify(frame)`.
 */
import { describe, test, expect, expectTypeOf } from "vitest";
import {
  serializeServerFrame,
  type ServerFrame,
  type TasksUpdateFrame,
} from "../src/chat-protocol/frames.ts";
import type { Task } from "../src/chat-protocol/messages.ts";

describe("ServerFrame — `tasks-update` variant", () => {
  test("the `tasks-update` variant is a member of the ServerFrame union (type-level)", () => {
    // If `TasksUpdateFrame` is not in the `ServerFrame` union, this
    // call's type signature will reject the literal at compile time.
    // Vitest's `expectTypeOf` surfaces the type error inside the test
    // function so a `tsc --noEmit` over the test files reports it.
    expectTypeOf<TasksUpdateFrame>().toMatchTypeOf<ServerFrame>();

    // Runtime sanity: the literal must round-trip through the
    // ServerFrame type. `satisfies` evaluates at compile time; the
    // runtime expect simply documents intent.
    const frame = {
      kind: "tasks-update",
      "chat-id": "c1",
      body: { tasks: [] as Task[] },
    } satisfies ServerFrame;
    expect(frame.kind).toBe("tasks-update");
  });

  test("`serializeServerFrame` accepts a tasks-update payload and emits the wire JSON shape the web mirror consumes", () => {
    const tasks: Task[] = [
      { step: "Set up workspace", status: "completed", activeForm: "Setting up workspace" },
      { step: "Write the test", status: "inProgress", activeForm: "Writing the test" },
      { step: "Land the implementation", status: "pending" },
    ];
    const frame: TasksUpdateFrame = {
      kind: "tasks-update",
      "chat-id": "chat-xyz",
      body: { tasks },
    };

    const wire = serializeServerFrame(frame);

    // The web mirror at apps/web/src/lib/chat-types.ts declares:
    //   { kind: "tasks-update"; "chat-id": string; body: { tasks: Task[]; replay?: boolean } }
    // so the round-trip via JSON must produce that exact envelope.
    const parsed = JSON.parse(wire) as Record<string, unknown>;
    expect(parsed).toEqual({
      kind: "tasks-update",
      "chat-id": "chat-xyz",
      body: { tasks },
    });
  });

  test("`serializeServerFrame` preserves the optional `replay` flag when present", () => {
    const frame: TasksUpdateFrame = {
      kind: "tasks-update",
      "chat-id": "chat-xyz",
      body: { tasks: [], replay: true },
    };
    const wire = serializeServerFrame(frame);
    const parsed = JSON.parse(wire) as { body: { replay?: boolean } };
    expect(parsed.body.replay).toBe(true);
  });
});
