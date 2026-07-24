import * as React from "react";
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatTrend = "up" | "down" | "flat";

export interface StatCardProps extends React.ComponentProps<typeof Card> {
  label: string;
  value: string;
  icon?: LucideIcon;
  /**
   * Period-over-period change. `positive` states whether the movement is
   * good news (an increase in open risks trends up but is negative).
   */
  delta?: {
    value: string;
    trend: StatTrend;
    positive?: boolean;
  };
  helper?: string;
}

const trendIcons: Record<StatTrend, LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

const trendLabels: Record<StatTrend, string> = {
  up: "trending up",
  down: "trending down",
  flat: "unchanged",
};

/**
 * Compact metric tile for dense stat rows: label, value, optional
 * period-over-period delta and helper text.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  delta,
  helper,
  className,
  ...props
}: StatCardProps) {
  const TrendIcon = delta ? trendIcons[delta.trend] : null;
  const deltaTone =
    delta?.positive === undefined
      ? "text-muted-foreground"
      : delta.positive
        ? "text-success"
        : "text-destructive";

  return (
    <Card
      data-slot="stat-card"
      className={cn("gap-3 shadow-soft", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-2 px-(--card-spacing)">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="space-y-1 px-(--card-spacing)">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        {(delta || helper) && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            {delta && TrendIcon && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-medium tabular-nums",
                  deltaTone
                )}
              >
                <TrendIcon className="size-3.5" aria-hidden="true" />
                {delta.value}
                <span className="sr-only">{trendLabels[delta.trend]}</span>
              </span>
            )}
            {helper && <span>{helper}</span>}
          </p>
        )}
      </div>
    </Card>
  );
}
