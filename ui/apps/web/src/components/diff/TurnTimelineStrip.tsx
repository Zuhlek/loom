// Horizontal marker strip in the diff-panel header — one per checkpoint ref.
export interface TurnMarker {
  turn: number;
  ref: string;
  ts?: string;
}

export interface TurnTimelineStripProps {
  markers: TurnMarker[];
  selected: number | "whole";
  onSelect(sel: number | "whole"): void;
  emptyState?: { badgeCopy: "no per-turn history" | "non-git project" };
}

export function TurnTimelineStrip(props: TurnTimelineStripProps) {
  const { markers, selected, onSelect, emptyState } = props;

  if (markers.length === 0 && emptyState) {
    return (
      <div
        className="px-3 py-1.5 border-b text-[10px]"
        style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
        data-testid="turn-timeline-strip-empty"
      >
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-md border"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
        >
          {emptyState.badgeCopy}
        </span>
      </div>
    );
  }

  return (
    <div
      className="px-3 py-1.5 border-b flex items-center gap-1"
      style={{
        borderColor: "var(--border)",
        overflowX: "auto",
      }}
      data-testid="turn-timeline-strip"
    >
      <button
        type="button"
        onClick={() => onSelect("whole")}
        className="px-2 py-0.5 rounded text-[10px] border shrink-0"
        style={{
          borderColor: "var(--border)",
          background:
            selected === "whole" ? "var(--selected-row)" : "var(--card)",
          color:
            selected === "whole" ? "var(--info-foreground)" : "var(--muted-foreground)",
          fontWeight: selected === "whole" ? 500 : 400,
        }}
        data-testid="turn-marker-whole"
      >
        whole
      </button>
      {markers.map((m) => {
        const isSelected = selected === m.turn;
        return (
          <button
            key={m.turn}
            type="button"
            onClick={() => onSelect(m.turn)}
            className="px-1.5 py-0.5 rounded text-[10px] border shrink-0"
            style={{
              borderColor: "var(--border)",
              background: isSelected ? "var(--selected-row)" : "transparent",
              color: isSelected ? "var(--info-foreground)" : "var(--muted-foreground)",
              fontWeight: isSelected ? 500 : 400,
              minWidth: 28,
            }}
            data-testid={`turn-marker-${m.turn}`}
            title={`Turn ${m.turn}${m.ts ? ` (${m.ts})` : ""}`}
          >
            {m.turn}
          </button>
        );
      })}
    </div>
  );
}
