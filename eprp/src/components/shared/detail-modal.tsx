"use client";

import * as React from "react";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Renders a back control before the title. Pass a handler while showing a
      detail view reached from a list inside the same modal; omit it for the
      list view itself, or for a modal with no list/detail split at all. */
  onBack?: () => void;
  /** Visible label on the back control (e.g. "Back to Milestones"). Omit for
      a compact icon-only button. */
  backLabel?: string;
  /** Extra header content below the title row — summary counters, search or
      filter controls. Part of the fixed header, not the scrolling body, so
      it stays reachable regardless of list length. Typically shown for the
      list view only; omit it for a detail view. */
  toolbar?: React.ReactNode;
  /** Secondary actions only (e.g. "Open source report") — never the primary
      way to read the detail, which lives in `children`. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The large centered "browse a list, open one, come back" modal — mirrors the
 * project document viewer's dialog (`h-[90vh]`, `sm:max-w-6xl`, same dim/blur
 * overlay) so every big in-page detail surface reads as one visual family.
 * First used by the Dashboard's Milestones modal; meant for KPI drill-ins and
 * the Executive Snapshot next. It owns only the shell chrome — open/close,
 * back, title, an optional footer — callers own their own list/detail state
 * and content.
 */
export function DetailModal({
  open,
  onOpenChange,
  title,
  description,
  onBack,
  backLabel,
  toolbar,
  footer,
  children,
}: DetailModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] flex-col sm:max-w-6xl">
        {/* Bleeds to the dialog's own edges (mirrors DialogFooter's own
            bleed) so the border reads as a real header/body seam, not an
            inset rule floating inside the padding. */}
        <DialogHeader className="-mx-4 -mt-4 gap-3 border-b px-4 pt-4 pb-4 space-y-0">
          <div className="flex items-center gap-1">
            {onBack &&
              (backLabel ? (
                <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-1.5">
                  <ChevronLeft aria-hidden />
                  {backLabel}
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back">
                  <ChevronLeft aria-hidden />
                </Button>
              ))}
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </div>
          </div>
          {toolbar}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
