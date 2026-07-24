import * as React from "react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/components/shared";
import type { StatList } from "@/features/dashboard/types";

const toneText: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
  neutral: "text-foreground",
};

export interface StatListCardProps extends React.ComponentProps<typeof Card> {
  stats: StatList;
}

/**
 * Headline metric plus a two-column grid of toned sub-metrics — used for
 * HSE and Quality statistics per the reference layout.
 */
export function StatListCard({ stats, className, ...props }: StatListCardProps) {
  const Icon = stats.icon;

  return (
    <Card
      data-slot="stat-list-card"
      size="sm"
      className={cn("shadow-soft", className)}
      {...props}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          {stats.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {stats.headline.value}
          </p>
          <p className="text-xs text-muted-foreground">
            {stats.headline.label}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {stats.items.map((item) => (
            <div
              key={item.label}
              className="flex items-baseline justify-between gap-2 border-b border-dashed pb-1 last:border-0"
            >
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  toneText[item.tone]
                )}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground">{stats.footnote}</p>
      </CardFooter>
    </Card>
  );
}
