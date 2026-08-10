"use client";

import { SectionCard, StatusBadge } from "@/components/shared";
import { PROGRESS_STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { varianceTone } from "../utils";
import type { ProgressSummary } from "../workspace";

const toneClass = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-2xl font-semibold tracking-tight tabular-nums",
          tone
        )}
      >
        {value}
      </p>
    </div>
  );
}

export interface WeeklyProgressSummaryProps {
  summary: ProgressSummary;
}

/**
 * Project progress for the week: the plan, the actual, the gap between them,
 * and the narrative that explains it.
 *
 * Every figure comes from `progressSummary()`, so the screen cannot disagree
 * with the derivation. Where the report carries a human verdict in
 * `overallStatus` that is what is shown, with the arithmetic reading kept
 * beside it — a person's judgement outranks the calculation, but hiding the
 * calculation would remove the evidence for questioning it.
 */
export function WeeklyProgressSummary({ summary }: WeeklyProgressSummaryProps) {
  const derived = PROGRESS_STATUS_META[summary.health];
  const stated = summary.overallStatus
    ? PROGRESS_STATUS_META[
        summary.overallStatus as keyof typeof PROGRESS_STATUS_META
      ]
    : undefined;

  return (
    <SectionCard
      title="Project Progress"
      description="Planned against actual for the reporting week."
      contentClassName="space-y-5"
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Planned" value={`${summary.planned}%`} />
        <Figure label="Actual" value={`${summary.actual}%`} />
        <Figure
          label="Variance"
          value={`${summary.variance > 0 ? "+" : ""}${summary.variance}%`}
          tone={toneClass[varianceTone(summary.variance)]}
        />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {stated ? "Overall Status" : "Health"}
          </p>
          <StatusBadge tone={(stated ?? derived).tone}>
            {(stated ?? derived).label}
          </StatusBadge>
          {stated && (
            <p className="text-xs text-muted-foreground">
              Variance reads {derived.label.toLowerCase()}
            </p>
          )}
        </div>
      </div>

      <div className="border-t pt-4">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Executive Summary
        </p>
        {summary.executiveSummary ? (
          <p className="text-sm whitespace-pre-wrap text-pretty">
            {summary.executiveSummary}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No executive summary has been written for this week.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
