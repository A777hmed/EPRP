import * as React from "react";
import { Loader2 } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface LoadingStateProps extends React.ComponentProps<"div"> {
  /**
   * `spinner` for short inline waits, `card` for stat/KPI grids,
   * `table` for tabular views, `page` for a full page shell.
   */
  variant?: "spinner" | "card" | "table" | "page";
  /** Number of skeleton cards or table rows. */
  count?: number;
  /** Screen-reader announcement. */
  label?: string;
}

function CardSkeletons({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

function TableSkeletons({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-1/6" />
        <Skeleton className="h-4 w-1/6" />
        <Skeleton className="h-4 flex-1" />
      </div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-5 w-1/4" />
          <Skeleton className="h-5 w-1/6" />
          <Skeleton className="h-5 w-1/6" />
          <Skeleton className="h-5 flex-1" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton/spinner placeholder shown while content loads. Skeletons reserve
 * layout space so the loaded content doesn't shift (CLS).
 */
export function LoadingState({
  variant = "spinner",
  count = 4,
  label = "Loading…",
  className,
  ...props
}: LoadingStateProps) {
  return (
    <div
      data-slot="loading-state"
      role="status"
      aria-busy="true"
      className={cn("w-full", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {variant === "spinner" && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {label}
        </div>
      )}
      {variant === "card" && <CardSkeletons count={count} />}
      {variant === "table" && <TableSkeletons count={count} />}
      {variant === "page" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <CardSkeletons count={4} />
          <TableSkeletons count={5} />
        </div>
      )}
    </div>
  );
}
