"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FilterBarProps extends React.ComponentProps<"div"> {
  /** Filter controls: SearchInput, Selects, date pickers. */
  children: React.ReactNode;
  /** Number of active filters; shows the reset button when > 0. */
  activeCount?: number;
  onReset?: () => void;
  resetLabel?: string;
}

/**
 * Horizontal toolbar that lines up filter controls above a table or grid,
 * with a reset affordance once filters are active. Wraps on small screens.
 */
export function FilterBar({
  children,
  activeCount = 0,
  onReset,
  resetLabel = "Reset filters",
  className,
  ...props
}: FilterBarProps) {
  return (
    <div
      data-slot="filter-bar"
      role="toolbar"
      aria-label="Filters"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    >
      {children}
      {onReset && activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X data-icon="inline-start" aria-hidden="true" />
          {resetLabel}
          <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
            {activeCount}
          </span>
        </Button>
      )}
    </div>
  );
}
