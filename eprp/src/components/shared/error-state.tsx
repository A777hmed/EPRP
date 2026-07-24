"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps extends React.ComponentProps<"div"> {
  title?: string;
  description?: string;
  /** Recovery action — renders a Retry button when provided. */
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * Failure placeholder with a clear recovery path. Use where content failed
 * to load; for form-level errors use inline field messages instead.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "The data could not be loaded. Check your connection and try again.",
  onRetry,
  retryLabel = "Try again",
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground text-pretty">
          {description}
        </p>
      )}
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
