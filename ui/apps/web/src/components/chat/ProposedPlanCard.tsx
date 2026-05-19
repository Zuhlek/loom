/**
 * ProposedPlanCard — renders a `PlanProposedItem`.
 *
 * Visual surface for the chat-level Accept/Reject flow: when Claude
 * issues an `ExitPlanMode` tool_use while the SDK is in `plan`
 * permission mode, the bridge emits a `plan-proposed` ChatItem and
 * this card mounts with the plan body + two action buttons.
 *
 * Lifecycle:
 *   - `status === "pending"` → buttons active. Accept emits a
 *     `plan-accept` ClientFrame; Reject emits `plan-reject`.
 *   - `status === "accepted" | "rejected"` → buttons disabled. The
 *     card stays in the timeline as an audit row per Design
 *     `## Plan-proposed lifecycle`.
 *
 * Per ADR-001 the card is ALWAYS visible whenever the SDK emits
 * `ExitPlanMode`, independent of loom's orchestration-level Plan phase.
 * Per ADR-004 Accept does NOT auto-submit any composer draft and the
 * `setPermissionMode` call is NOT debounced — the server bridge owns
 * both side-effects when it receives the `plan-accept` frame.
 *
 * Plan body is rendered via the existing `ChatMarkdown` so fenced code
 * blocks, bullet lists, and the curated Shiki grammar subset (Q04)
 * render with the same look as assistant messages.
 */
import { ChatMarkdown } from "./ChatMarkdown";
import type { PlanProposedItem } from "../../lib/chat-types";

export interface ProposedPlanCardProps {
  item: PlanProposedItem;
  /**
   * Fired when the user clicks Accept. The parent route emits a
   * `plan-accept` ClientFrame carrying `item.id` so the server bridge
   * can correlate the click to the pending plan item.
   */
  onAccept(): void;
  /**
   * Fired when the user clicks Reject. The parent route emits a
   * `plan-reject` ClientFrame carrying `item.id`.
   */
  onReject(): void;
}

export function ProposedPlanCard({ item, onAccept, onReject }: ProposedPlanCardProps) {
  const disabled = item.status !== "pending";
  const statusLabel =
    item.status === "accepted"
      ? "Accepted"
      : item.status === "rejected"
        ? "Rejected"
        : null;

  return (
    <div
      className="ml-10 rounded-xl border-2 overflow-hidden"
      style={{
        borderColor: "var(--info)",
        background: "rgba(99,102,241,0.04)",
      }}
      data-testid="proposed-plan-card"
    >
      <div
        className="px-4 py-3 flex items-center gap-2.5 border-b"
        style={{ borderColor: "rgba(99,102,241,0.25)" }}
      >
        <div
          className="size-6 rounded-md grid place-items-center"
          style={{ background: "rgba(99,102,241,0.18)" }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="size-3.5"
            style={{ color: "var(--info-foreground)" }}
          >
            <path d="M9 11l3 3 8-8" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(99,102,241,0.18)",
                color: "var(--info-foreground)",
              }}
            >
              Proposed plan
            </span>
            {statusLabel && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{
                  background:
                    item.status === "accepted"
                      ? "rgba(16,185,129,0.15)"
                      : "rgba(239,68,68,0.12)",
                  color:
                    item.status === "accepted"
                      ? "var(--success-foreground)"
                      : "var(--destructive-foreground)",
                }}
                data-testid="proposed-plan-status"
              >
                {statusLabel}
              </span>
            )}
          </div>
          <p
            className="text-[10px] mt-0.5"
            style={{ color: "var(--muted-foreground)" }}
          >
            Claude paused in plan mode. Accept to switch to default
            permissions and execute; Reject to ask for a revision.
          </p>
        </div>
      </div>

      <div className="px-4 py-3">
        <ChatMarkdown text={item.planText} />
      </div>

      <div
        className="px-4 py-3 border-t flex items-center justify-end gap-2"
        style={{
          borderColor: "rgba(99,102,241,0.25)",
          background: "rgba(255,255,255,0.4)",
        }}
      >
        <button
          type="button"
          onClick={onReject}
          disabled={disabled}
          data-testid="proposed-plan-reject"
          className="px-2.5 py-1.5 rounded-md text-xs font-medium hover:bg-[var(--accent)] disabled:opacity-50"
          style={{ color: "var(--muted-foreground)" }}
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          data-testid="proposed-plan-accept"
          className="px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm disabled:opacity-50"
          style={{ background: "var(--primary)" }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
