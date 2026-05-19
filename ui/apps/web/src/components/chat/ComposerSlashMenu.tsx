/**
 * Grouped slash-command menu. Mirrors {@link ComposerAtFileMenu} —
 * parent-driven keyboard nav, per-row `onMouseDown.preventDefault` to
 * keep the editor focused, `onSelect` emits the selected row by index
 * into a flat list the parent computes via {@link buildSlashMenuRows}.
 *
 * Two sections:
 *   - Built-in: three Loom-side rows (`/model`, `/plan`, `/default`)
 *     sourced from {@link BUILTIN_COMMANDS}.
 *   - Provider: rows from the bridge-supplied catalog
 *     ({@link WireSlashCommand}), with built-in name collisions
 *     suppressed so the built-in always wins.
 *
 * Empty-state matrix:
 *   - `slashCommands === null`, built-ins survive filter ⇒ Built-in
 *     group + "Loading commands…" italic muted row under PROVIDER
 *     header with `aria-busy="true"`.
 *   - `slashCommands === null`, built-ins filtered out ⇒ "No matching
 *     command" row only.
 *   - Loaded `[]` + non-empty built-ins ⇒ Built-in group only.
 *   - Loaded `[]` + empty built-ins ⇒ "No matching command" row.
 *   - Otherwise both groups render.
 *
 * Row icons — three inline SVGs, zero new deps:
 *   - Built-in    → hexagon outline
 *   - Provider    → square outline (`kind: 'command'`)
 *   - Skill       → diamond outline (`kind: 'skill'`)
 */
import { useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import type { WireSlashCommand } from "../../lib/chat-types";

/**
 * Built-in row shape. The three Loom-side commands `/model`, `/plan`,
 * `/default` open or toggle local UI state — they do NOT send a chat
 * turn. The menu reports selection by index; the parent
 * ({@link ChatComposer}) owns the click handlers.
 */
export interface BuiltinSlashCommand {
  name: string;
  description: string;
}

export const BUILTIN_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
  { name: "model", description: "Open the model picker" },
  { name: "plan", description: "Switch to Plan permission mode" },
  { name: "default", description: "Switch to default permission mode" },
];

const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_COMMANDS.map((c) => c.name));

/**
 * One menu row after filtering. The parent feeds these back to the
 * `onSelect` handler via the row index in the flat list (ordered:
 * built-ins first, then providers). Headers are not rows — they
 * render in between but are NOT navigable.
 */
export type SlashMenuRow =
  | { kind: "builtin"; name: string; description: string }
  | { kind: "command"; name: string; description: string; argumentHint: string }
  | { kind: "skill"; name: string; description: string; argumentHint: string };

export interface ComposerSlashMenuProps {
  /** Filter query — typed text AFTER the leading `/`. */
  query: string;
  /** Bridge-supplied SDK catalog; `null` until the first frame lands. */
  slashCommands: WireSlashCommand[] | null;
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (row: SlashMenuRow) => void;
}

/**
 * Compose the visible row list from built-ins + the bridge catalog.
 * Pure / exported so {@link ChatComposer} can keep `selectedIndex` in
 * range and route the accept handler without duplicating the merge.
 */
export function buildSlashMenuRows(
  query: string,
  slashCommands: WireSlashCommand[] | null,
): { builtins: SlashMenuRow[]; providers: SlashMenuRow[] } {
  const needle = query.trim().toLowerCase();
  const matchName = (name: string): boolean =>
    needle === "" || name.toLowerCase().startsWith(needle);

  const builtins: SlashMenuRow[] = [];
  for (const c of BUILTIN_COMMANDS) {
    if (!matchName(c.name)) continue;
    builtins.push({ kind: "builtin", name: c.name, description: c.description });
  }

  const providers: SlashMenuRow[] = [];
  if (slashCommands !== null) {
    for (const c of slashCommands) {
      if (BUILTIN_NAMES.has(c.name)) continue;
      if (!matchName(c.name)) continue;
      providers.push({
        kind: c.kind,
        name: c.name,
        description: c.description,
        argumentHint: c.argumentHint,
      });
    }
  }

  return { builtins, providers };
}

export function ComposerSlashMenu({
  query,
  slashCommands,
  selectedIndex,
  onHover,
  onSelect,
}: ComposerSlashMenuProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const { builtins, providers } = buildSlashMenuRows(query, slashCommands);
  const loading = slashCommands === null;
  const hasBuiltins = builtins.length > 0;
  const hasProviders = providers.length > 0;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Empty-state matrix.
  //   - Both groups empty AND not loading ⇒ "No matching command".
  //   - Both groups empty AND loading ⇒ "No matching command" (the
  //     loading affordance fires only when SOMETHING renders alongside
  //     it — without built-ins to anchor the menu the user just sees
  //     the empty state).
  if (!hasBuiltins && !hasProviders && !loading) {
    return (
      <div
        ref={listRef}
        role="listbox"
        data-testid="composer-slash-menu"
        className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-lg border shadow-lg z-10"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div
          role="presentation"
          className="px-3 py-1.5 text-xs italic"
          style={{ color: "var(--muted-foreground)" }}
        >
          No matching command
        </div>
      </div>
    );
  }
  if (!hasBuiltins && !hasProviders && loading) {
    return (
      <div
        ref={listRef}
        role="listbox"
        data-testid="composer-slash-menu"
        className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-lg border shadow-lg z-10"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div
          role="presentation"
          className="px-3 py-1.5 text-xs italic"
          style={{ color: "var(--muted-foreground)" }}
        >
          No matching command
        </div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      data-testid="composer-slash-menu"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-lg border shadow-lg z-10"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {hasBuiltins && (
        <>
          <SectionHeader>Built-in</SectionHeader>
          {builtins.map((row, i) =>
            renderRow(row, i, selectedIndex, onHover, onSelect),
          )}
        </>
      )}
      {/* Provider header renders whenever provider rows exist OR the
          loading affordance is showing (so the user knows the SDK
          catalog will land under that header). */}
      {(hasProviders || loading) && (
        <>
          <SectionHeader>Provider</SectionHeader>
          {hasProviders &&
            providers.map((row, i) =>
              renderRow(
                row,
                builtins.length + i,
                selectedIndex,
                onHover,
                onSelect,
              ),
            )}
          {loading && !hasProviders && (
            <div
              role="presentation"
              data-testid="composer-slash-menu-loading"
              aria-busy={true}
              className="px-3 py-1.5 text-xs italic"
              style={{ color: "var(--muted-foreground)" }}
            >
              Loading commands…
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-wide"
      style={{ color: "var(--muted-foreground)" }}
    >
      {children}
    </div>
  );
}

function renderRow(
  row: SlashMenuRow,
  rowIndex: number,
  selectedIndex: number,
  onHover: (index: number) => void,
  onSelect: (row: SlashMenuRow) => void,
): ReactNode {
  return (
    <button
      key={`${row.kind}:${row.name}:${rowIndex}`}
      type="button"
      role="option"
      aria-selected={rowIndex === selectedIndex}
      data-row-index={rowIndex}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={() => onSelect(row)}
      onMouseEnter={() => onHover(rowIndex)}
      className={clsx(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs",
        rowIndex === selectedIndex ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]/60",
      )}
    >
      <RowIcon kind={row.kind} />
      <span className="font-mono">/{row.name}</span>
      <span
        className="truncate"
        style={{ color: "var(--muted-foreground)" }}
      >
        {row.description}
      </span>
    </button>
  );
}

function RowIcon({ kind }: { kind: SlashMenuRow["kind"] }) {
  if (kind === "builtin") return <HexagonGlyph />;
  if (kind === "skill") return <DiamondGlyph />;
  return <SquareGlyph />;
}

/** Built-in row glyph — hexagon outline. */
function HexagonGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
      style={{ color: "var(--muted-foreground)" }}
      aria-hidden="true"
    >
      <polygon points="12 2 21 7 21 17 12 22 3 17 3 7" />
    </svg>
  );
}

/** Provider command row glyph — square outline. */
function SquareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
      style={{ color: "var(--muted-foreground)" }}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

/** Skill row glyph — diamond outline. */
function DiamondGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
      style={{ color: "var(--muted-foreground)" }}
      aria-hidden="true"
    >
      <polygon points="12 2 22 12 12 22 2 12" />
    </svg>
  );
}
