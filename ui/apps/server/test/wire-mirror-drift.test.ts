/**
 * T-010 — Wire-mirror drift smoke (cross-cutting type guard).
 *
 * Verifies US-009-adjacent invariant from Spec `## Constraints`:
 * the hand-maintained mirror between
 *   `apps/server/src/chat-protocol/{messages,frames}.ts`
 * and
 *   `apps/web/src/lib/chat-types.ts`
 * MUST stay byte-identical at the discriminated-union level. A new
 * variant added on only one side silently breaks the wire — this test
 * is the cross-cutting type-level guard.
 *
 * Mechanism: TypeScript identity type `Equals<A, B>` plus a
 * `AssertTrue<T extends true>` brand. If any pair diverges, `tsc
 * --noEmit` rejects the corresponding `type _Cn = AssertTrue<...>`
 * alias at compile time and the test file fails to type-check, which
 * the project's `tsc --noEmit` AFK gate catches. The runtime assertion
 * is just a sentinel `expect(true).toBe(true)` so vitest surfaces a
 * pass row alongside the type-level work.
 *
 * Red phase: this file did not exist; the guard was absent so any
 * drift introduced by T-002 / T-003 / T-004 / T-006 / T-008 would
 * have surfaced only at integration. The first commit of this file
 * had a deliberately-broken assertion to confirm `tsc` rejects
 * divergent unions (see T-010.test-log.txt for the red transcript).
 *
 * Green phase: every `_C*` alias compiles, meaning every checked union
 * is byte-identical across the server↔web mirror today.
 *
 * NOTE on placement: the test lives on the server side because the
 * server's `messages.ts` / `frames.ts` are the canonical source of
 * truth; the web mirror is the consumer. A server-side test reaching
 * into `apps/web/src/lib/chat-types.ts` via a relative import does
 * not create a package coupling — `chat-types.ts` is a leaf
 * declaration file (no runtime imports) so importing it adds zero
 * runtime cost.
 */
import { describe, test, expect } from "vitest";

// Server-side canonical types.
import type {
  ChatItem as ServerChatItem,
  ChatSnapshot as ServerChatSnapshot,
  PendingPermission as ServerPendingPermission,
  PendingQuestion as ServerPendingQuestion,
  Task as ServerTask,
  ToolResultSummary as ServerToolResultSummary,
  TurnState as ServerTurnState,
} from "../src/chat-protocol/messages.ts";
import type {
  ClientFrame as ServerClientFrame,
  ServerFrame as ServerServerFrame,
  WirePermissionMode as ServerWirePermissionMode,
} from "../src/chat-protocol/frames.ts";

// Web mirror — relative-path import; chat-types.ts is a declaration-only
// leaf so the import has no runtime side effects.
import type {
  ChatItem as WebChatItem,
  ChatSnapshot as WebChatSnapshot,
  ClientFrame as WebClientFrame,
  PendingPermission as WebPendingPermission,
  PendingQuestion as WebPendingQuestion,
  PermissionMode as WebPermissionMode,
  ServerFrame as WebServerFrame,
  Task as WebTask,
  ToolResultSummary as WebToolResultSummary,
  TurnState as WebTurnState,
} from "../../web/src/lib/chat-types.ts";

/**
 * Exact-equality test for two TypeScript types. The classic invariant
 * function-trick: `(<T>() => T extends A ? 1 : 2)` carries the type
 * `A` in a strictly-invariant position; two such function types are
 * assignable iff `A` and `B` are mutually assignable AT EVERY POSITION
 * — i.e. `A` and `B` are identical, not just bidirectionally
 * assignable.
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * Force `T` to be the literal `true`. When `Equals<A, B>` returns
 * `false`, this constraint fails at compile time, surfacing the drift
 * at `tsc --noEmit` (the project's AFK type-check gate).
 */
type AssertTrue<T extends true> = T;

// ─── Items / domain types ────────────────────────────────────────────

type _C_ChatItem            = AssertTrue<Equals<ServerChatItem,            WebChatItem>>;
type _C_ChatSnapshot        = AssertTrue<Equals<ServerChatSnapshot,        WebChatSnapshot>>;
type _C_PendingPermission   = AssertTrue<Equals<ServerPendingPermission,   WebPendingPermission>>;
type _C_PendingQuestion     = AssertTrue<Equals<ServerPendingQuestion,     WebPendingQuestion>>;
type _C_Task                = AssertTrue<Equals<ServerTask,                WebTask>>;
type _C_ToolResultSummary   = AssertTrue<Equals<ServerToolResultSummary,   WebToolResultSummary>>;
type _C_TurnState           = AssertTrue<Equals<ServerTurnState,           WebTurnState>>;

// ─── Frames ──────────────────────────────────────────────────────────

type _C_ClientFrame         = AssertTrue<Equals<ServerClientFrame,         WebClientFrame>>;
type _C_ServerFrame         = AssertTrue<Equals<ServerServerFrame,         WebServerFrame>>;

// ─── PermissionMode (cross-named on each side) ───────────────────────
// Server names it `WirePermissionMode`; web names it `PermissionMode`.
// Structurally must be identical.
type _C_PermissionMode      = AssertTrue<Equals<ServerWirePermissionMode,  WebPermissionMode>>;

// Reference the aliases so noUnusedLocals (if ever enabled) and IDE
// tooling treat them as the test surface they are. The `void 0 as ...`
// pattern keeps the runtime cost at zero while pinning the type
// dependency from the surrounding test runtime.
type _AllChecks =
  & _C_ChatItem
  & _C_ChatSnapshot
  & _C_PendingPermission
  & _C_PendingQuestion
  & _C_Task
  & _C_ToolResultSummary
  & _C_TurnState
  & _C_ClientFrame
  & _C_ServerFrame
  & _C_PermissionMode;

describe("Wire mirror — server↔web type-level identity (T-010)", () => {
  test("the guard file exists and every union pair compiles to `true`", () => {
    // Type-level: the work happens at compile time (see `_C_*` aliases
    // above). If the file type-checks, every checked pair is identical.
    // Runtime: this sentinel exists so vitest surfaces a green row and
    // a regression in the test runner (e.g. file removed, file empty)
    // shows up alongside the type-level coverage.
    const allChecksHold: _AllChecks = true;
    expect(allChecksHold).toBe(true);
  });
});
