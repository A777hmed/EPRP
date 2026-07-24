import * as React from "react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/components/shared";
import type { InsightList } from "@/features/dashboard/types";

const toneIconBox: Record<StatusTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  neutral: "bg-muted text-muted-foreground",
};

const toneBullet: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground",
};

export interface InsightCardProps extends React.ComponentProps<typeof Card> {
  insight: InsightList;
}

/**
 * Executive insight card (achievements, delays, risks, issues): toned icon
 * header and a compact bulleted list, matching the reference layout.
 */
export function InsightCard({ insight, className, ...props }: InsightCardProps) {
  const Icon = insight.icon;

  return (
    <Card
      data-slot="insight-card"
      size="sm"
      className={cn("shadow-soft", className)}
      {...props}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              toneIconBox[insight.tone]
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </span>
          {insight.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {insight.items.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  toneBullet[insight.tone]
                )}
              />
              <span className="text-pretty">{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
