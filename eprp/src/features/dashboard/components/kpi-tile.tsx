import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type KpiTone = "default" | "success" | "warning" | "danger" | "info";

export interface KpiTileProps extends React.ComponentProps<typeof Card> {
  label: string;
  value: string;
  /** Short qualifier under the value, e.g. "Cumulative", "Behind". */
  caption: string;
  icon: LucideIcon;
  tone?: KpiTone;
}

const toneText: Record<KpiTone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};

const toneIconBox: Record<KpiTone, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

/**
 * Compact executive KPI tile matching the reference dashboard: icon,
 * label, toned headline value, and a one-word qualifier.
 */
export function KpiTile({
  label,
  value,
  caption,
  icon: Icon,
  tone = "default",
  className,
  ...props
}: KpiTileProps) {
  return (
    <Card
      data-slot="kpi-tile"
      size="sm"
      className={cn("gap-2 text-center shadow-soft", className)}
      {...props}
    >
      <div className="flex flex-col items-center gap-1.5 px-(--card-spacing)">
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            toneIconBox[tone]
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-2xl leading-none font-semibold tracking-tight tabular-nums",
            toneText[tone]
          )}
        >
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>
    </Card>
  );
}
