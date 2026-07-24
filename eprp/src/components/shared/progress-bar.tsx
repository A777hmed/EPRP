import * as React from "react";

import { cn } from "@/lib/utils";

export type ProgressTone = "default" | "success" | "warning" | "danger";

export interface ProgressBarProps extends React.ComponentProps<"div"> {
  /** Progress value, 0–100. Values outside the range are clamped. */
  value: number;
  /** Visible label rendered above the track. */
  label?: string;
  /** Accessible name when no visible label is rendered. */
  ariaLabel?: string;
  /** Show the numeric value next to the label. Defaults to true when a label is present. */
  showValue?: boolean;
  size?: "sm" | "md";
  tone?: ProgressTone;
}

const toneClasses: Record<ProgressTone, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

/**
 * Labeled determinate progress bar with semantic tones for
 * on-track / at-risk / delayed readings.
 */
export function ProgressBar({
  value,
  label,
  ariaLabel,
  showValue,
  size = "md",
  tone = "default",
  className,
  ...props
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const displayValue = showValue ?? Boolean(label);

  return (
    <div
      data-slot="progress-bar"
      className={cn("w-full space-y-1.5", className)}
      {...props}
    >
      {(label || displayValue) && (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          {label ? (
            <span className="font-medium text-muted-foreground">{label}</span>
          ) : (
            <span />
          )}
          {displayValue && (
            <span className="font-medium tabular-nums">
              {Math.round(clamped)}%
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label={label ?? ariaLabel ?? "Progress"}
        className={cn(
          "w-full overflow-hidden rounded-full bg-muted",
          size === "sm" ? "h-1.5" : "h-2"
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
            toneClasses[tone]
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
