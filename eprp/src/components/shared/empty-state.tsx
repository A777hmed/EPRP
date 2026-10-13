import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Backdrop, type BackdropVariant } from "@/components/backdrop";

export interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Call to action, e.g. a "Create project" button. */
  action?: React.ReactNode;
  /**
   * A background illustration behind the message. Only for a first-run
   * "nothing created yet" state that is the main content of its page or tab —
   * including a derived tab whose first entry follows another record (a
   * project's Executive periods follow its Monthly) — never for a filter,
   * error, not-found or denied state, and never inside a dialog, drawer or
   * queue.
   */
  backdrop?: BackdropVariant;
  /**
   * `lg` — the first-run panel of a workspace tab: a minimum height shared by
   * its sibling tabs so switching does not jump, a tinted icon, and the title
   * set above the description instead of at its size.
   */
  size?: "default" | "lg";
}

/**
 * Placeholder for views with no content yet — explains why the view is
 * empty and offers the next step.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  backdrop,
  size = "default",
  className,
  ...props
}: EmptyStateProps) {
  const lg = size === "lg";
  return (
    <div
      data-slot="empty-state"
      data-size={lg ? "lg" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-6 py-12 text-center",
        lg && "min-h-80 gap-1.5 border-solid",
        backdrop && "relative isolate overflow-hidden",
        // A size container, so a narrow panel can lift its action clear of
        // the art (see below).
        lg && backdrop && "@container",
        className
      )}
      {...props}
    >
      {backdrop && <Backdrop variant={backdrop} layout="panel" />}
      {Icon && (
        <div
          className={cn(
            "mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground",
            lg && "mb-4 size-12 bg-primary/10 text-primary ring-1 ring-primary/15 ring-inset"
          )}
        >
          <Icon className={lg ? "size-6" : "size-5"} aria-hidden="true" />
        </div>
      )}
      <p className={lg ? "text-base font-semibold tracking-tight" : "text-sm font-medium"}>
        {title}
      </p>
      {description && (
        <p
          className={cn(
            "max-w-sm text-sm text-muted-foreground text-pretty",
            lg && "max-w-md leading-relaxed"
          )}
        >
          {description}
        </p>
      )}
      {action && (
        <div
          className={cn(
            lg ? "mt-5" : "mt-4",
            // The panel art is a 4.5:1 strip as wide as the panel's padding
            // box (100cqw is its content box, so + 48px of side padding).
            // Wide, it frames the message from the sides; narrow, it is a
            // strip along the foot, and the action rises above it: the 48px
            // bottom padding plus this margin equals the art's height + 8px.
            lg && backdrop && "@max-[560px]:mb-[calc((100cqw_+_48px)/4.5_-_40px)]"
          )}
        >
          {action}
        </div>
      )}
    </div>
  );
}
