"use client";

import * as React from "react";
import { Info } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * EPRP's one contextual-help pattern (`docs/07` §10.13).
 *
 * A small information icon beside a label. Clicking it — or pressing Enter /
 * Space on it — opens a compact popover with a short explanation, an optional
 * example and, only where genuinely needed, a "Learn more" section. Escape
 * or clicking outside closes it and returns focus to the icon.
 *
 * Rules:
 * - Explanation only. Never a warning: risk, error and governed-action
 *   messages keep their own warning / confirmation UX.
 * - Not hover-only: the trigger is a real button, so keyboard and touch work.
 * - Use it for concepts that are genuinely non-obvious, not beside Save,
 *   Cancel or self-explanatory fields.
 * - The visible UI keeps a short label; the detail lives here, once.
 */

/** The accessible name of a help trigger: "About Weight source". */
export function contextHelpLabel(topic: string): string {
  return `About ${topic}`;
}

export interface ContextHelpProps {
  /** The concept explained, e.g. "Weight source". Names the trigger and titles the popover. */
  topic: string;
  /** The explanation: one to three short sentences, or a short list. */
  children: React.ReactNode;
  /** One short, concrete example. */
  example?: React.ReactNode;
  /** Deeper content behind a "Learn more" toggle. Use sparingly. */
  learnMore?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}

export function ContextHelp({
  topic,
  children,
  example,
  learnMore,
  side = "bottom",
  align = "start",
  className,
}: ContextHelpProps) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const id = React.useId();
  const titleId = `${id}-title`;
  const moreId = `${id}-more`;

  return (
    <Popover onOpenChange={(open) => !open && setMoreOpen(false)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={contextHelpLabel(topic)}
          data-slot="context-help-trigger"
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle",
            "text-muted-foreground transition-colors hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            "data-[state=open]:text-primary",
            className
          )}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        collisionPadding={16}
        aria-labelledby={titleId}
        data-slot="context-help"
        // Never wider than the viewport minus its gutters, so it fits on phones.
        className="w-[min(20rem,calc(100vw-2rem))] gap-2 text-xs leading-relaxed"
      >
        <p id={titleId} className="text-sm font-semibold text-foreground">
          {topic}
        </p>
        <div className="grid gap-1.5 text-muted-foreground text-pretty">{children}</div>
        {example && (
          <p className="rounded-md bg-muted/60 px-2 py-1.5 text-foreground text-pretty">
            <span className="font-medium">Example: </span>
            {example}
          </p>
        )}
        {learnMore && (
          <div className="grid gap-1.5">
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls={moreId}
              onClick={() => setMoreOpen((open) => !open)}
              className="justify-self-start text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {moreOpen ? "Show less" : "Learn more"}
            </button>
            {moreOpen && (
              <div id={moreId} className="grid gap-1.5 text-muted-foreground text-pretty">
                {learnMore}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A label followed by its help icon, on one line. Keeps the pair aligned the
 * same way on every surface. (Table column headers whose label may wrap use an
 * inline, no-break-joined label + icon instead — see the Master Plan table.)
 */
export function LabelWithHelp({
  children,
  help,
  className,
}: {
  children: React.ReactNode;
  help: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      {help}
    </span>
  );
}
