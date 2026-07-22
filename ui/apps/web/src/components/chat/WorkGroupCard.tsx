/**
 * WorkGroupCard — compact card that condenses consecutive tool-only
 * assistant messages into one block. Each tool renders as a single
 * line (icon · name · summary · status). The whole card is collapsible
 * once it exceeds MAX_VISIBLE_ENTRIES; an individual row can also be
 * expanded to show its tool_result payload.
 *
 * Loosely modelled on t3code's WorkGroupSection but kept self-contained
 * — no shared search/log infra, no LegendList virtualisation.
 */
import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import clsx from "clsx";

import type { AssistantToolUseBlock } from "../../lib/chat-types";
import { describeInput } from "../../lib/describe-tool-input";
import { ToolResultMedia } from "./ToolResultMedia";

const MAX_VISIBLE_ENTRIES = 8;

interface Props {
  tools: Array<{ block: AssistantToolUseBlock; sourceMessageId: string }>;
}

export function WorkGroupCard({ tools }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = tools.length > MAX_VISIBLE_ENTRIES;
  const visible = hasOverflow && !expanded ? tools.slice(-MAX_VISIBLE_ENTRIES) : tools;
  const hiddenCount = tools.length - visible.length;

  return (
    <div
      className="rounded-xl border px-2 py-1.5"
      style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.015)" }}
      data-testid="work-group-card"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <p
          className="text-[9px] uppercase tracking-[0.16em]"
          style={{ color: "var(--muted-foreground)" }}
        >
          Tool calls ({tools.length})
        </p>
        {hasOverflow && (
          <button
            type="button"
            className="text-[9px] uppercase tracking-[0.12em] hover:underline"
            style={{ color: "var(--muted-foreground)" }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : `Show ${hiddenCount} more`}
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {visible.map(({ block }) => (
          <RowErrorBoundary key={block.id} toolName={block?.name ?? "tool"}>
            <WorkEntryRow block={block} />
          </RowErrorBoundary>
        ))}
      </div>
    </div>
  );
}

function WorkEntryRow({ block }: { block: AssistantToolUseBlock }) {
  const [open, setOpen] = useState(false);
  const summary = describeInput(block?.name ?? "", block?.input);
  const tone =
    block?.status === "error"
      ? { dot: "var(--destructive)", label: "error" }
      : block?.status === "complete"
        ? { dot: "var(--success)", label: "ok" }
        : { dot: "var(--info)", label: "…" };

  const result = block?.result;
  const resultText = typeof result?.text === "string" ? result.text : "";
  const hasImages = !!(result?.images && result.images.length > 0);
  const hasText = resultText.length > 0;
  const hasResult = hasText || hasImages;

  return (
    <div>
      <button
        type="button"
        disabled={!hasResult}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "w-full flex items-center gap-2 px-2 py-1 text-left rounded-md text-[12px] leading-5",
          hasResult && "hover:bg-black/5 cursor-pointer",
          !hasResult && "cursor-default",
        )}
        title={hasResult ? (open ? "Hide result" : "Show result") : undefined}
      >
        <span
          className={clsx(
            "size-1.5 rounded-full shrink-0",
            block?.status === "running" && "animate-pulse",
          )}
          style={{ background: tone.dot }}
        />
        <span className="font-medium">{block?.name ?? "tool"}</span>
        {summary && (
          <code
            className="font-mono truncate min-w-0"
            style={{ color: "var(--muted-foreground)" }}
          >
            {summary}
          </code>
        )}
        <span
          className="ml-auto text-[10px] font-mono"
          style={{ color: "var(--muted-foreground)" }}
        >
          {tone.label}
        </span>
      </button>
      {open && hasResult && result && (
        <div className="px-2 pb-2 pt-0">
          {hasText && (
            <pre
              className="m-0 whitespace-pre-wrap text-[11px] leading-relaxed font-mono overflow-x-auto"
              style={{
                color: result.isError
                  ? "var(--destructive-foreground)"
                  : "var(--muted-foreground)",
              }}
            >
              {resultText}
            </pre>
          )}
          {hasImages && result.images && <ToolResultMedia images={result.images} />}
        </div>
      )}
    </div>
  );
}

/** Duplicated from ToolUseCard — kept inline so the work-group card is
 *  self-contained. If we add a third call site, factor into a shared
 *  helper at that point, not before.
 *
 *  Defensive: `input` is typed `Record<string, unknown>` but the wire
 *  shape isn't enforced at runtime. Treat anything non-object as `{}`
 *  so a malformed bridge payload can't throw inside the render path
 *  and take the whole timeline down with it.
 */
/**
 * Per-row error boundary. A single malformed tool_use block should
 * render as an inert "failed to render" line instead of taking down
 * the entire WorkGroupCard (or the timeline above it). We deliberately
 * keep this local rather than introducing a global ErrorBoundary —
 * the work-group is the only spot where heterogeneous bridge payloads
 * touch the render path, so the blast radius is small.
 */
class RowErrorBoundary extends Component<
  { toolName: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.warn("[loom] WorkGroupCard row render failed", {
      tool: this.props.toolName,
      error,
      info,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="px-2 py-1 text-[12px] leading-5 flex items-center gap-2"
          style={{ color: "var(--muted-foreground)" }}
        >
          <span
            className="size-1.5 rounded-full shrink-0"
            style={{ background: "var(--destructive)" }}
          />
          <span className="font-medium">{this.props.toolName}</span>
          <span className="font-mono text-[11px]">(failed to render)</span>
        </div>
      );
    }
    return this.props.children;
  }
}
