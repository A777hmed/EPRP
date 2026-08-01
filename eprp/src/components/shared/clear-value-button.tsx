"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ClearValueButtonProps {
  /**
   * Accessible name, phrased as the action — e.g. "Clear Project Manager".
   * Selectors pass the field or master-data label so screen-reader users can
   * tell several clear buttons in one form apart.
   */
  label: string;
  onClear: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * "×" affordance shown beside a selector that currently holds a value.
 *
 * Clears the assignment in the current form only. The referenced master-data
 * record is never deleted, archived, or edited — that is what the adjacent
 * Manage surface is for. Rendered as a sibling of the field (not an overlay
 * on its trigger) so it stays a real button with its own focus stop, and so
 * clicking it can never open the field's popover.
 */
export function ClearValueButton({
  label,
  onClear,
  disabled = false,
  className,
}: ClearValueButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClear}
      className={cn(
        "shrink-0 text-muted-foreground hover:text-foreground",
        className
      )}
    >
      <X aria-hidden="true" />
    </Button>
  );
}
