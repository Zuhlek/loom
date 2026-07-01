import clsx from "clsx";

export type Lane = "backlog" | "in-progress" | "review" | "done";

export type KanbanCard = {
  id: string;
  title: string;
  subtitle?: string;
  tags?: string[];
  size?: "S" | "M" | "L" | "XL";
  duration?: string;
  reviewer?: boolean;
  /** Crossed-through done state */
  done?: boolean;
  active?: boolean;
};

export type KanbanColumn = {
  id: Lane;
  label: string;
  cards: KanbanCard[];
};

const LANE_BG: Record<Lane, string> = {
  backlog: "transparent",
  "in-progress": "rgba(59,130,246,0.04)",
  review: "rgba(245,158,11,0.04)",
  done: "rgba(16,185,129,0.03)",
};

const LANE_DOT: Record<Lane, string> = {
  backlog: "var(--muted-foreground)",
  "in-progress": "var(--info)",
  review: "var(--warning)",
  done: "var(--success-foreground)",
};

const SIZE_BG: Record<NonNullable<KanbanCard["size"]>, string> = {
  S: "rgba(59,130,246,0.15)",
  M: "rgba(16,185,129,0.15)",
  L: "rgba(239,68,68,0.15)",
  XL: "rgba(239,68,68,0.25)",
};

const SIZE_FG: Record<NonNullable<KanbanCard["size"]>, string> = {
  S: "var(--info-foreground)",
  M: "var(--success-foreground)",
  L: "#b91c1c",
  XL: "#7f1d1d",
};

function Checkmark({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="size-3" style={{ color }}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function KanbanView({ columns }: { columns: KanbanColumn[] }) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="grid grid-cols-4 gap-3 min-h-[420px]">
        {columns.map((col) => (
          <div
            key={col.id}
            className="rounded-lg border min-w-0 flex flex-col"
            style={{ borderColor: "var(--border)", background: LANE_BG[col.id] }}
          >
            <div className="px-3 py-2 flex items-center gap-2 border-b" style={{ borderColor: "var(--border)" }}>
              {col.id === "in-progress" && (
                <span className="size-1.5 rounded-full animate-pulse" style={{ background: LANE_DOT[col.id] }} />
              )}
              {col.id === "review" && <span className="size-1.5 rounded-full" style={{ background: LANE_DOT[col.id] }} />}
              {col.id === "done" && <Checkmark color={LANE_DOT[col.id]} />}
              <span className="text-[10px] uppercase tracking-wide font-medium" style={{ color: LANE_DOT[col.id] }}>
                {col.label}
              </span>
              <span className="text-[10px] px-1.5 rounded-full" style={{ background: "rgba(0,0,0,0.05)", color: LANE_DOT[col.id] }}>
                {col.cards.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {col.cards.map((card) => (
                <div
                  key={card.id}
                  className={clsx("rounded-md border p-2.5", card.done && "opacity-80")}
                  style={{
                    borderColor: card.active ? "rgba(59,130,246,0.5)" : "var(--border)",
                    background: "var(--card)",
                  }}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
                    <span className={card.done ? "line-through" : ""}>{card.id}</span>
                    {card.active && <span className="size-1.5 rounded-full animate-pulse" style={{ background: "var(--info)" }} />}
                    {card.done && <Checkmark color="var(--success)" />}
                  </div>
                  <p className={clsx("text-xs font-medium mt-0.5", card.done && "line-through")} style={card.done ? { color: "var(--muted-foreground)" } : undefined}>
                    {card.title}
                  </p>
                  {card.subtitle && (
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                      {card.subtitle}
                    </p>
                  )}
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {card.tags?.map((t) => (
                      <span key={t} className="text-[9px] font-mono px-1 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                        {t}
                      </span>
                    ))}
                    {card.size && (
                      <span className="text-[9px] px-1 rounded" style={{ background: SIZE_BG[card.size], color: SIZE_FG[card.size] }}>
                        {card.size}
                      </span>
                    )}
                    {card.reviewer && (
                      <span className="ml-auto text-[10px] inline-flex items-center gap-1" style={{ color: "var(--warning-foreground)" }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3">
                          <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
                          <rect x="8" y="2" width="8" height="4" rx="1" />
                        </svg>
                        Reviewer
                      </span>
                    )}
                    {card.duration && (
                      <span className="ml-auto text-[10px] font-mono" style={{ color: card.active ? "var(--info-foreground)" : card.done ? "var(--success-foreground)" : "var(--muted-foreground)" }}>
                        {card.duration}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
