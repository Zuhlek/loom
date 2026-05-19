import type { ContextUsageSnapshot } from "../../lib/use-chat-bridge";

/**
 * Circular percent ring rendered immediately left of the send button.
 * Reads the bridge-supplied {@link ContextUsageSnapshot}; NULL ⇒ 0%.
 * Warning treatment (`var(--destructive)` stroke) kicks in at
 * `percentage >= 90`. Tooltip surfaces `<totalTokens> / <maxTokens>`
 * and the model identifier via the `title` attribute.
 */
export interface ContextUsageIndicatorProps {
  usage: ContextUsageSnapshot | null;
}

const SIZE = 28;
const STROKE_WIDTH = 3;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const WARNING_THRESHOLD = 90;

export function ContextUsageIndicator({ usage }: ContextUsageIndicatorProps) {
  const percentage = usage ? clampPercentage(usage.percentage) : 0;
  const isWarning = percentage >= WARNING_THRESHOLD;
  const dashOffset = CIRCUMFERENCE * (1 - percentage / 100);
  const stroke = isWarning ? "var(--destructive)" : "var(--muted-foreground)";
  const title = usage
    ? `${usage.totalTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} tokens · ${usage.model}`
    : "Context usage — no reading yet";
  const center = SIZE / 2;

  return (
    <div
      data-testid="composer-pill-context-usage"
      title={title}
      aria-label={title}
      role="img"
      className="relative inline-grid place-items-center"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <circle
          cx={center}
          cy={center}
          r={RADIUS}
          fill="none"
          stroke="var(--border)"
          strokeWidth={STROKE_WIDTH}
        />
        <circle
          cx={center}
          cy={center}
          r={RADIUS}
          fill="none"
          stroke={stroke}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span
        className="absolute text-[8px] font-mono leading-none tabular-nums"
        style={{ color: isWarning ? "var(--destructive)" : "var(--muted-foreground)" }}
      >
        {percentage}%
      </span>
    </div>
  );
}

function clampPercentage(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 100) return 100;
  return Math.round(p);
}
