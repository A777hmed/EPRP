"use client";

import * as React from "react";
import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A semantic status/health `StatusBadge` — shown only where genuinely valid. */
  badge?: React.ReactNode;
  /** Data Date / reporting period / source-basis chips, under the title. */
  meta?: React.ReactNode;
  /** Renders a back control before the title. Pass a handler while showing a
      detail view reached from a list inside the same drawer; omit it for the
      list view itself, or for a drawer with no list/detail split. */
  onBack?: () => void;
  /** Visible label on the back control. Omit for a compact icon-only button. */
  backLabel?: string;
  /** Extra header content below the meta row — search/filter/summary
      controls. Part of the fixed header, not the scrolling body. */
  toolbar?: React.ReactNode;
  /** Secondary, contextual actions only — never the primary way to read the
      detail, which lives in `children`. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The wide right-side "read a governed figure in context" drawer.
 *
 * One shared shell for every KPI/status/milestone detail surface in the app:
 * open/close, header (title, badge, source/basis meta, close), an optional
 * toolbar, a scrolling body, and an optional footer of contextual links. The
 * shell owns none of the content — callers supply `children` built from
 * `DrawerSection`/`DrawerSummary`/`DrawerFactGrid` below, or their own markup.
 *
 * Built on `Sheet`'s `size="wide"` variant (see `components/ui/sheet.tsx`):
 * full-width on a narrow screen, a capped wide panel on desktop, with the
 * underlying page left visible and interactive-looking behind it. Focus trap,
 * focus restoration, Escape-to-close and outside-click-close all come from
 * the Radix Dialog primitive underneath `Sheet` — nothing custom is needed
 * for any of that here.
 */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  badge,
  meta,
  onBack,
  backLabel,
  toolbar,
  footer,
  children,
}: DetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="wide" className="gap-0 p-0">
        <SheetHeader className="gap-2.5 border-b px-5 py-4">
          <div className="flex items-start gap-1">
            {onBack &&
              (backLabel ? (
                <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-mt-0.5 -ml-1.5">
                  <ChevronLeft aria-hidden />
                  {backLabel}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onBack}
                  aria-label="Back"
                  className="-mt-0.5 -ml-1.5"
                >
                  <ChevronLeft aria-hidden />
                </Button>
              ))}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3 pr-6">
                <SheetTitle className="truncate text-lg">{title}</SheetTitle>
                {badge}
              </div>
              {description && <SheetDescription>{description}</SheetDescription>}
            </div>
          </div>
          {meta && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">{meta}</div>
          )}
          {toolbar}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">{footer}</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------- Sections ---------------------------------- */

/**
 * One titled body section — "Performance", "Planning Basis", "Milestones &
 * Schedule Risks", etc. Rendered only where the caller has real content;
 * there is no empty/placeholder variant, by design (§G of the 5A audit —
 * an absent section says nothing, which is correct when there is nothing to
 * say, rather than a section labelled and then apologizing for itself).
 */
export function DrawerSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t pt-4 first:border-t-0 first:pt-0 [&+section]:mt-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * The "Executive Summary" tier: one primary reading, its label, and an
 * optional supporting context row (Planned/Actual/Variance/SPI-style mini
 * stats) directly beneath it.
 *
 * Dashboard Final Polish: the value reads at a restrained, label-led size —
 * a large, saturated headline (the original `text-4xl`) read as an alarm
 * rather than a status on a project detail surface a reader may open
 * often; strong semantic color is kept, just not at shouting size.
 */
export function DrawerSummary({
  label,
  value,
  tone = "default",
  context,
}: {
  label: string;
  value: React.ReactNode;
  tone?: DrawerTone;
  context?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className={cn("mt-1.5 text-2xl font-semibold tracking-tight text-foreground", TONE_TEXT[tone])}>
          {value}
        </p>
      </div>
      {context}
    </div>
  );
}

export type DrawerTone = "default" | "success" | "warning" | "danger";

export const TONE_TEXT: Record<DrawerTone, string> = {
  default: "",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

/** A compact row of mini stats sitting under a `DrawerSummary`'s primary
    value — one shared background block, not a row of bordered mini-cards. */
export function DrawerContextRow({
  items,
}: {
  items: { label: string; value: React.ReactNode; tone?: DrawerTone }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-muted/40 px-3.5 py-2.5">
      {items.map((item) => (
        <div key={item.label} className="min-w-[64px]">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{item.label}</p>
          <p className={cn("text-sm font-semibold text-foreground", TONE_TEXT[item.tone ?? "default"])}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** A label/value fact grid — the shared vocabulary for Planning Basis,
    Source & Provenance, and similar sections. No per-item border: facts
    read as one aligned grid, not a stack of nested cards. */
export function DrawerFactGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</dl>;
}

export function DrawerFact({
  label,
  value,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  tone?: DrawerTone;
  icon?: LucideIcon;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {Icon && <Icon className="size-3" aria-hidden />}
        {label}
      </dt>
      <dd className={cn("mt-0.5 truncate text-sm font-semibold text-foreground", TONE_TEXT[tone])}>{value}</dd>
    </div>
  );
}

/** A deliberate, honest "nothing to show" line — never fabricate a driver,
    contributor or breakdown when the underlying data does not support one. */
export function DrawerEmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">{children}</p>;
}
