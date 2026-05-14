/**
 * T-001 — Wire frames foundation for the composer-slash-command-catalog
 * seed. Covers the three new frame kinds defined in `design.md`
 * §Interfaces:
 *
 *   - server→client `slash-commands-update`     (US-001, US-006)
 *   - server→client `context-usage-update`      (US-005)
 *   - client→server `model-settings-set`        (US-007, US-008)
 *
 * Acceptance criteria checked here:
 *   - Each frame round-trips through `serializeServerFrame()` / `JSON.parse`
 *     (or, for the client-bound frame, plain `JSON.stringify` since only
 *     server frames go through the serializer helper) without loss.
 *   - `ServerFrame` / `ClientFrame` unions include the new kinds and the
 *     `WireSlashCommand` / `WireModelSettings` shapes have the field
 *     sets declared in `design.md`.
 *   - The web mirror in `apps/web/src/lib/chat-types.ts` carries the
 *     same kinds (the cross-cutting `wire-mirror-drift.test.ts` already
 *     enforces full union identity; this file pins the names so a typo
 *     fails locally too).
 *
 * `ChatSnapshot` is intentionally not extended — there is no assertion
 * in this file beyond the round-trip checks for the three new kinds.
 */
import { describe, test, expect, expectTypeOf } from "vitest";
import {
  serializeServerFrame,
  type ClientFrame,
  type ContextUsageUpdateFrame,
  type ModelSettingsSetFrame,
  type ServerFrame,
  type SlashCommandsUpdateFrame,
  type WireModelSettings,
  type WireSlashCommand,
} from "../src/chat-protocol/frames.ts";
import type {
  ClientFrame as WebClientFrame,
  ServerFrame as WebServerFrame,
  WireModelSettings as WebWireModelSettings,
  WireSlashCommand as WebWireSlashCommand,
} from "../../web/src/lib/chat-types.ts";

describe("ServerFrame — slash-commands-update (US-001 / US-006)", () => {
  test("round-trips through serializeServerFrame with a populated catalog", () => {
    const commands: WireSlashCommand[] = [
      {
        name: "weave",
        description: "Loom lifecycle orchestrator",
        argumentHint: "",
        kind: "skill",
      },
      {
        name: "review",
        description: "Review the pending PR",
        argumentHint: "[scope]",
        kind: "command",
      },
    ];
    const frame: SlashCommandsUpdateFrame = {
      kind: "slash-commands-update",
      "chat-id": "chat-abc",
      body: { commands },
    };

    const wire = serializeServerFrame(frame);
    const parsed = JSON.parse(wire);

    expect(parsed).toEqual(frame);
  });

  test("round-trips with an empty catalog (post-load empty state)", () => {
    const frame: SlashCommandsUpdateFrame = {
      kind: "slash-commands-update",
      "chat-id": "chat-empty",
      body: { commands: [] },
    };
    const parsed = JSON.parse(serializeServerFrame(frame));
    expect(parsed).toEqual(frame);
  });

  test("WireSlashCommand carries the four fields declared in design.md §Interfaces", () => {
    expectTypeOf<WireSlashCommand>().toEqualTypeOf<{
      name: string;
      description: string;
      argumentHint: string;
      kind: "skill" | "command";
    }>();
  });

  test("SlashCommandsUpdateFrame is a member of ServerFrame", () => {
    expectTypeOf<SlashCommandsUpdateFrame>().toMatchTypeOf<ServerFrame>();
  });
});

describe("ServerFrame — context-usage-update (US-005)", () => {
  test("round-trips through serializeServerFrame with realistic numbers", () => {
    const frame: ContextUsageUpdateFrame = {
      kind: "context-usage-update",
      "chat-id": "chat-xyz",
      body: {
        percentage: 42,
        totalTokens: 84_000,
        maxTokens: 200_000,
        model: "claude-opus-4-7",
      },
    };
    const parsed = JSON.parse(serializeServerFrame(frame));
    expect(parsed).toEqual(frame);
  });

  test("body shape is exactly { percentage, totalTokens, maxTokens, model }", () => {
    type Body = ContextUsageUpdateFrame["body"];
    expectTypeOf<Body>().toEqualTypeOf<{
      percentage: number;
      totalTokens: number;
      maxTokens: number;
      model: string;
    }>();
  });

  test("ContextUsageUpdateFrame is a member of ServerFrame", () => {
    expectTypeOf<ContextUsageUpdateFrame>().toMatchTypeOf<ServerFrame>();
  });
});

describe("ClientFrame — model-settings-set (US-007 / US-008)", () => {
  test("round-trips through JSON with a partial patch (model only)", () => {
    const frame: ModelSettingsSetFrame = {
      kind: "model-settings-set",
      "chat-id": "chat-1",
      body: { model: "claude-opus-4-7" },
    };
    const parsed = JSON.parse(JSON.stringify(frame));
    expect(parsed).toEqual(frame);
  });

  test("round-trips a full WireModelSettings patch including Ultrathink thinking", () => {
    const full: WireModelSettings = {
      model: "claude-opus-4-7",
      effort: "max",
      thinking: { type: "enabled", budgetTokens: 32_000 },
      contextWindow: "1m",
    };
    const frame: ModelSettingsSetFrame = {
      kind: "model-settings-set",
      "chat-id": "chat-2",
      body: full,
    };
    const parsed = JSON.parse(JSON.stringify(frame));
    expect(parsed).toEqual(frame);
  });

  test("WireModelSettings carries the four nullable fields declared in design.md", () => {
    expectTypeOf<WireModelSettings>().toEqualTypeOf<{
      model: string | null;
      effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
      thinking: { type: "enabled"; budgetTokens: number } | null;
      contextWindow: "200k" | "1m" | null;
    }>();
  });

  test("ModelSettingsSetFrame is a member of ClientFrame", () => {
    expectTypeOf<ModelSettingsSetFrame>().toMatchTypeOf<ClientFrame>();
  });
});

describe("Web mirror — the three new kinds exist on the web side too", () => {
  test("WebServerFrame discriminator union covers the two new server kinds", () => {
    type Kinds = WebServerFrame["kind"];
    const slash: Extract<Kinds, "slash-commands-update"> = "slash-commands-update";
    const usage: Extract<Kinds, "context-usage-update"> = "context-usage-update";
    expect(slash).toBe("slash-commands-update");
    expect(usage).toBe("context-usage-update");
  });

  test("WebClientFrame discriminator union covers model-settings-set", () => {
    type Kinds = WebClientFrame["kind"];
    const setKind: Extract<Kinds, "model-settings-set"> = "model-settings-set";
    expect(setKind).toBe("model-settings-set");
  });

  test("WireSlashCommand / WireModelSettings mirror server names verbatim", () => {
    expectTypeOf<WebWireSlashCommand>().toEqualTypeOf<WireSlashCommand>();
    expectTypeOf<WebWireModelSettings>().toEqualTypeOf<WireModelSettings>();
  });
});
