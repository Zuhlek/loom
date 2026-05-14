/**
 * ChatContextMenu — production sidebar context menu for Handoff / Fork
 * actions. Pure UI primitive: action wiring (HTTP calls) lives in the
 * caller (LiveSidebar). DOM/styling salvaged from the deleted
 * `/handoff` mockup; the typed-props shape comes from design Interfaces
 * (ADR-007).
 *
 * Behaviour:
 *   - Renders Handoff + Fork entries.
 *   - Positions itself at props.position.{x,y} (clientX/clientY).
 *   - Closes on outside click and on Escape.
 */
import { useEffect, useRef } from "react";
import type { ApiChat } from "../../lib/api";

export interface ChatContextMenuProps {
  chat: ApiChat;
  /** Viewport-relative anchor from the triggering MouseEvent. */
  position: { x: number; y: number };
  onClose(): void;
  onHandoff(chat: ApiChat): Promise<void> | void;
  onRename(chat: ApiChat): void;
  onFork(chat: ApiChat): Promise<void> | void;
}

export function ChatContextMenu(props: ChatContextMenuProps) {
  const { chat, position, onClose, onHandoff, onRename, onFork } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="menu"
      data-testid="chat-context-menu"
      className="fixed rounded-lg border bg-white shadow-lg overflow-hidden text-xs w-56 z-50"
      style={{
        left: position.x,
        top: position.y,
        borderColor: "var(--border)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="px-3 py-2 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="font-medium truncate" title={chat.cwd}>
          {chat.cwd}
        </p>
      </div>
      <button
        type="button"
        role="menuitem"
        data-testid="chat-context-menu-handoff"
        className="w-full text-left px-3 py-2 hover:bg-[var(--accent)] flex items-start gap-2.5"
        onClick={() => {
          onHandoff(chat);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="size-3.5 mt-0.5"
          style={{ color: "var(--muted-foreground)" }}
        >
          <path d="M4 6h16v12H4zM7 9l3 3-3 3M13 15h4" />
        </svg>
        <div className="flex-1">
          <div className="text-xs font-medium">Handoff to terminal</div>
          <div
            className="text-[10px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Detach this PTY into a system terminal; chat row goes detached.
          </div>
        </div>
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="chat-context-menu-rename"
        className="w-full text-left px-3 py-2 hover:bg-[var(--accent)] flex items-start gap-2.5 border-t"
        style={{ borderColor: "var(--border)" }}
        onClick={() => {
          onRename(chat);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="size-3.5 mt-0.5"
          style={{ color: "var(--muted-foreground)" }}
        >
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
        <div className="flex-1">
          <div className="text-xs font-medium">Rename</div>
          <div
            className="text-[10px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Give this chat a custom label; clears on empty input.
          </div>
        </div>
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="chat-context-menu-fork"
        className="w-full text-left px-3 py-2 hover:bg-[var(--accent)] flex items-start gap-2.5 border-t"
        style={{ borderColor: "var(--border)" }}
        onClick={() => {
          onFork(chat);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="size-3.5 mt-0.5"
          style={{ color: "var(--muted-foreground)" }}
        >
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="12" cy="20" r="2" />
          <path d="M6 8v4a2 2 0 002 2h4M18 8v4a2 2 0 01-2 2h-4M12 14v4" />
        </svg>
        <div className="flex-1">
          <div className="text-xs font-medium">Fork chat</div>
          <div
            className="text-[10px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Open a new chat with the same cwd & permission preset; this chat unchanged.
          </div>
        </div>
      </button>
    </div>
  );
}
