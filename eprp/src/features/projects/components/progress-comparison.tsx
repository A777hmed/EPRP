import { ProgressBar } from "@/components/shared";
import { cn } from "@/lib/utils";
import { formatVariance, varianceTone } from "@/features/projects/utils";

const toneText = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
} as const;

export interface ProgressComparisonProps {
  planned: number;
  actual: number;
  /** Compact hides the variance line (table cells, tight cards). */
  showVariance?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** Planned vs. actual progress bars with the schedule variance spelled out. */
export function ProgressComparison({
  planned,
  actual,
  showVariance = true,
  size = "sm",
  className,
}: ProgressComparisonProps) {
  const variance = Math.round((actual - planned) * 10) / 10;

  return (
    <div className={cn("space-y-2", className)}>
      <ProgressBar label="Planned" value={planned} size={size} tone="default" />
      <ProgressBar
        label="Actual"
        value={actual}
        size={size}
        tone={variance >= 0 ? "success" : variance >= -5 ? "warning" : "danger"}
      />
      {showVariance && (
        <p className="text-xs text-muted-foreground">
          Schedule variance:{" "}
          <span
            className={cn(
              "font-semibold tabular-nums",
              toneText[varianceTone(variance)]
            )}
          >
            {formatVariance(variance)}
          </span>
        </p>
      )}
    </div>
  );
}
