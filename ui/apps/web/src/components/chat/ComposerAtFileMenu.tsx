/**
 * Presentational @-file picker menu. Mirrors {@link ComposerSlashMenu}:
 * parent-driven keyboard navigation, per-row mousedown preventDefault to
 * keep the editor focused, onSelect emits the chosen path. The frame
 * renders whenever the parent mounts the component (trigger-active);
 * the empty-state row is query-aware — "Type to search files" when the
 * query is blank, "No matching files" once the user has typed and the
 * search returned nothing.
 */
import { useEffect, useRef } from "react";
import clsx from "clsx";

export interface ComposerAtFileMenuProps {
  items: string[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (path: string) => void;
  loading?: boolean;
  query?: string;
}

/**
 * Split a path into basename + dirname. Pure file-local; no Node
 * `path` import (web build is DOM-only). When the path has no `/`,
 * basename is the whole path and dirname is the empty string.
 */
function splitPath(path: string): { basename: string; dirname: string } {
  const parts = path.split("/");
  const basename = parts[parts.length - 1] ?? path;
  const dirname = parts.slice(0, -1).join("/");
  return { basename, dirname };
}

export function ComposerAtFileMenu({
  items,
  selectedIndex,
  onHover,
  onSelect,
  loading,
  query,
}: ComposerAtFileMenuProps) {
  const hasQuery = (query ?? "").trim().length > 0;
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div
      ref={listRef}
      role="listbox"
      data-testid="composer-atfile-menu"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-lg border shadow-lg z-10"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {items.length === 0 && loading ? (
        <div
          className="px-3 py-1.5 text-xs"
          style={{ color: "var(--muted-foreground)" }}
        >
          Searching…
        </div>
      ) : items.length === 0 ? (
        <div
          role="presentation"
          data-testid="composer-atfile-menu-empty"
          className="px-3 py-1.5 text-xs italic"
          style={{ color: "var(--muted-foreground)" }}
        >
          {hasQuery ? "No matching files" : "Type to search files"}
        </div>
      ) : (
        items.map((path, i) => {
          const { basename, dirname } = splitPath(path);
          return (
            <button
              key={path + ":" + i}
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              data-row-index={i}
              onMouseDown={(e) => {
                // Prevent the textarea from losing focus before onClick fires.
                e.preventDefault();
              }}
              onClick={() => onSelect(path)}
              onMouseEnter={() => onHover(i)}
              className={clsx(
                "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs",
                i === selectedIndex ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]/60",
              )}
            >
              <span className="font-mono">{basename}</span>
              {dirname && (
                <span style={{ color: "var(--muted-foreground)" }}>{dirname}</span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
