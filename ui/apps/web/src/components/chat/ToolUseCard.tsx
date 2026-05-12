/**
 * ToolUseCard — visual cell for a single tool invocation inside an
 * assistant message. Mirrors t3code's WorkGroupSection entry visuals
 * but rendered inline with the assistant text so the order matches
 * what the model produced.
 *
 * Status flips from "running" → "complete" / "error" when the matching
 * tool_result arrives. We collapse the result behind a disclosure so
 * the timeline stays readable when results are large.
 */
import { useState } from "react";
import clsx from "clsx";

import type { AssistantToolUseBlock } from "../../lib/chat-types";
import { ToolResultMedia } from "./ToolResultMedia";

interface Props {
  block: AssistantToolUseBlock;
}

export function ToolUseCard({ block }: Props) {
  const [open, setOpen] = useState(false);
  const summary = describeInput(block.name, block.input);
  const tone = block.status === "error"
    ? { dot: "var(--destructive)", label: "error" }
    : block.status === "complete"
      ? { dot: "var(--success)", label: "ok" }
      : { dot: "var(--info)", label: "…" };

  const result = block.result;
  const hasImages = !!(result?.images && result.images.length > 0);
  const hasText = !!(result && result.text.length > 0);
  // The collapse toggle should engage whenever there's *any* result
  // payload to surface — text OR images. Per Design ADR-007 image-only
  // results are common (screenshot tools, MCP image returns).
  const hasResult = hasText || hasImages;

  return (
    <div
      className="rounded-lg border text-[12px]"
      style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.015)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasResult}
        className={clsx("w-full flex items-center gap-2 px-3 py-2 text-left", hasResult && "hover:bg-black/5")}
        title={hasResult ? (open ? "Hide result" : "Show result") : undefined}
      >
        <span
          className={clsx("size-1.5 rounded-full shrink-0", block.status === "running" && "animate-pulse")}
          style={{ background: tone.dot }}
        />
        <span className="font-medium">{block.name}</span>
        {summary && (
          <code className="font-mono truncate" style={{ color: "var(--muted-foreground)" }}>
            {summary}
          </code>
        )}
        <span className="ml-auto text-[10px]" style={{ color: "var(--muted-foreground)" }}>
          {tone.label}
        </span>
      </button>
      {open && hasResult && result && (
        <div className="px-3 pb-2 pt-0">
          {hasText && (
            <pre
              className="m-0 whitespace-pre-wrap text-[11px] leading-relaxed font-mono overflow-x-auto"
              style={{ color: result.isError ? "var(--destructive-foreground)" : "var(--muted-foreground)" }}
            >
              {result.text}
            </pre>
          )}
          {hasImages && result.images && (
            <ToolResultMedia images={result.images} />
          )}
        </div>
      )}
    </div>
  );
}

/** One-line summary of the tool input. Tuned for common Claude tools. */
function describeInput(name: string, input: Record<string, unknown>): string {
  const get = (k: string): string | undefined => {
    const v = input?.[k];
    return typeof v === "string" ? v : undefined;
  };
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return get("file_path") ?? "";
    case "Bash": {
      const cmd = get("command") ?? "";
      return cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd;
    }
    case "Glob":
      return get("pattern") ?? "";
    case "Grep":
      return get("pattern") ?? "";
    case "WebFetch":
    case "WebSearch":
      return get("url") ?? get("query") ?? "";
    case "TodoWrite": {
      const todos = (input as { todos?: unknown[] }).todos;
      return Array.isArray(todos) ? `${todos.length} task${todos.length === 1 ? "" : "s"}` : "";
    }
    case "Task":
    case "Agent":
      return get("description") ?? "";
    default: {
      // Fall back to the first string-valued field for a hint.
      for (const [k, v] of Object.entries(input ?? {})) {
        if (typeof v === "string" && v.length > 0) {
          return `${k}=${v.length > 80 ? `${v.slice(0, 80)}…` : v}`;
        }
      }
      return "";
    }
  }
}
