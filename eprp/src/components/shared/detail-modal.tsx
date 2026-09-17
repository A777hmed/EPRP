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
  /**
   * "compact" (~672px, height sized to content up to 85vh) for a quick
   * management-summary modal — a KPI headline plus a short breakdown, read
   * in a few seconds and dismissed. "wide" (the original 6xl, h-[90vh]) for
   * an analysis surface with real canvas — a project selector beside a
   * chart, or any "browse many, open one" list/detail flow. Defaults to
   * "wide" so every existing call shape keeps its exact current size.
   */
  size?: "compact" | "wide";
  children: React.ReactNode;
}

/**
 * The centered "quick look" / "browse many, open one" modal — mirrors the
 * project document viewer's dialog so every big in-page detail surface reads
 * as one visual family. Two sizes (see `size` above); both keep the Dashboard
 * (or whichever page opened it) dimmed but visible behind a restrained scrim,
 * never a full-page takeover.
 *
 * Dashboard UX Part 1: mouse-resizable via native CSS `resize` (a corner
 * handle, the platform's own affordance — no drag library, no extra
 * dependency). `MODAL_BOUNDS` sets a starting size plus a min/max a reader
 * can resize between without ever exceeding the viewport; the body keeps its
 * own internal scroll, so content is never clipped at a small size.
 *
 * Top-Level 5A1 correction: quick per-KPI/summary detail uses this component
 * at `size="compact"`, and the expanded Planned-vs-Actual analysis view uses
 * it at `size="wide"` (the default). Deeper, multi-section PROJECT
 * exploration — Overview/Performance/Planning/Milestones/Reports/Management
 * — belongs in the wide right-side `DetailDrawer`-based Project Workspace
 * instead (`project-workspace.tsx`): a centered modal reads as an
 * interruption for that kind of open-ended browsing, where a side panel
 * keeps the Dashboard reachable while the reader moves between sections. It
 * owns only the shell chrome — open/close, back, title, an optional footer —
 * callers own their own list/detail state and content.
 */
/**
 * Starting size, and the floor/ceiling a reader may resize between, per
 * `size`. Set as inline `style` rather than Tailwind's `max-w-*`, which
 * would only ever apply below `sm:max-w-*` at desktop widths and defeat
 * "resize up toward the viewport" — native CSS `resize` reads the element's
 * own `width`/`height`/`min-*`/`max-*`, wherever they come from.
 */
const MODAL_BOUNDS: Record<"compact" | "wide", React.CSSProperties> = {
  compact: {
    width: "min(42rem, 95vw)",
    height: "min(32rem, 85vh)",
    minWidth: 380,
    minHeight: 280,
    maxWidth: "95vw",
    maxHeight: "90vh",
  },
  wide: {
    width: "min(72rem, 95vw)",
    height: "min(40rem, 90vh)",
    minWidth: 480,
    minHeight: 360,
    maxWidth: "95vw",
    maxHeight: "95vh",
  },
};

export function DetailModal({
  open,
  onOpenChange,
  title,
  description,
  onBack,
  backLabel,
  toolbar,
  footer,
  size = "wide",
  children,
}: DetailModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex resize flex-col overflow-hidden"
        style={MODAL_BOUNDS[size]}
      >
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
