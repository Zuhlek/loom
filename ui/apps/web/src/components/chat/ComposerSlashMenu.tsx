/**
 * Floating menu rendered above the composer textarea while the user is
 * mid-`/`-trigger. Keyboard navigation is driven from the parent
 * (ChatComposer) — this component is presentational: it renders the
 * list, highlights the selected row, and emits onSelect / onHover.
 */
import { useEffect, useRef } from "react";
import clsx from "clsx";

import type { SlashCommandEntry } from "../../lib/api";

export interface ComposerSlashMenuProps {
  items: SlashCommandEntry[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: SlashCommandEntry) => void;
}

function scopeBadgeClasses(scope: SlashCommandEntry["scope"]): string {
  switch (scope) {
    case "project":
      return "bg-emerald-500/15 text-emerald-700";
    case "user":
      return "bg-sky-500/15 text-sky-700";
    case "plugin":
      return "bg-violet-500/15 text-violet-700";
  }
}

export function ComposerSlashMenu({ items, selectedIndex, onHover, onSelect }: ComposerSlashMenuProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      data-testid="composer-slash-menu"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-lg border shadow-lg z-10"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {items.map((item, i) => (
        <button
          key={`${item.scope}:${item.name}`}
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          data-row-index={i}
          onMouseDown={(e) => {
            // Prevent the textarea from losing focus before onClick fires.
            e.preventDefault();
          }}
          onClick={() => onSelect(item)}
          onMouseEnter={() => onHover(i)}
          className={clsx(
            "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs",
            i === selectedIndex ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]/60",
          )}
        >
          <span className="font-mono">/{item.name}</span>
          <span className="flex-1" />
          <span
            className={clsx(
              "text-[10px] font-mono rounded px-1.5 py-0.5",
              scopeBadgeClasses(item.scope),
            )}
          >
            {item.scope}
          </span>
        </button>
      ))}
    </div>
  );
}
