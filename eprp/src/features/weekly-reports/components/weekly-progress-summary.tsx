"use client";

import { SectionCard, StatusBadge } from "@/components/shared";
import {
  KPI_RATING_META,
  PROGRESS_STATUS_META,
  SCHEDULE_RECOMMENDATION_META,
} from "@/lib/constants";
import { formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { KpiRating } from "@/types";
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
          "text-xl font-semibold tracking-tight tabular-nums",
          tone
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** One qualitative rating chip. Rendered only when the report records one. */
function RatingChip({ label, rating }: { label: string; rating: KpiRating }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <StatusBadge tone={KPI_RATING_META[rating].tone}>
        {KPI_RATING_META[rating].label}
      </StatusBadge>
    </span>
  );
}

export interface WeeklyProgressSummaryProps {
  summary: ProgressSummary;
  /** Recorded only when the report tracks it. Omitted rather than shown as "—". */
  manHoursToDate?: number;
  hseStatus?: KpiRating;
  qualityStatus?: KpiRating;
  /** Department submissions received, out of those the viewer can see. */
  submissionsReceived?: number;
  submissionsTotal?: number;
}

/**
 * Project progress for the week: the plan, the actual, the gap between them,
 * the narrative that explains it, and the qualitative ratings the report
 * actually carries.
 *
 * One block rather than two. It previously shared the page with a "Key
 * Indicators" card that re-derived the same variance under a second name
 * ("Recommendation") and coloured the SPI by a third threshold set — so one
 * report could read On Track, At Risk and On Schedule at the same time.
 * Everything here now comes from `progressSummary()`, which interprets the
 * variance exactly once.
 *
 * The recorded `overallStatus` still leads when the report carries one — a
 * human judgement outranks the arithmetic — and the arithmetic is only
 * remarked on when the two genuinely disagree, in which case the figure that
 * caused the disagreement is named rather than hinted at.
 */
export function WeeklyProgressSummary({
  summary,
  manHoursToDate,
  hseStatus,
  qualityStatus,
  submissionsReceived,
  submissionsTotal,
}: WeeklyProgressSummaryProps) {
  const reading = SCHEDULE_RECOMMENDATION_META[summary.reading];
  const stated = summary.overallStatus
    ? PROGRESS_STATUS_META[summary.overallStatus]
    : undefined;
  const headline = stated ?? reading;
  const tone = toneClass[varianceTone(summary.variance)];

  const ratings = [
    hseStatus ? { key: "hse", label: "HSE", rating: hseStatus } : null,
    qualityStatus
      ? { key: "quality", label: "Quality", rating: qualityStatus }
      : null,
  ].filter((entry) => entry !== null);

  const hasSubmissionCount =
    typeof submissionsReceived === "number" &&
    typeof submissionsTotal === "number" &&
    submissionsTotal > 0;

  return (
    <SectionCard
      title="Project Progress"
      description="Planned against actual for the reporting week."
      contentClassName="space-y-4"
      action={
        <StatusBadge tone={headline.tone}>{headline.label}</StatusBadge>
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure label="Planned" value={`${summary.planned}%`} />
        <Figure label="Actual" value={`${summary.actual}%`} />
        <Figure
          label="Variance"
          value={`${summary.variance > 0 ? "+" : ""}${summary.variance}%`}
          tone={tone}
        />
        <Figure label="SPI" value={summary.spi.toFixed(2)} tone={tone} />
      </div>

      {/* Said only when the recorded verdict and the arithmetic disagree. */}
      {!summary.statusAgrees && stated && (
        <p className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
          Recorded as <span className="font-medium">{stated.label}</span>, but a
          variance of {summary.variance > 0 ? "+" : ""}
          {summary.variance} points reads{" "}
          <span className="font-medium">{reading.label}</span> against the
          reporting thresholds.
        </p>
      )}

      {(ratings.length > 0 ||
        typeof manHoursToDate === "number" ||
        hasSubmissionCount) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3">
          {ratings.map((entry) => (
            <RatingChip
              key={entry.key}
              label={entry.label}
              rating={entry.rating}
            />
          ))}
          {typeof manHoursToDate === "number" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Man-hours
              <span className="text-sm font-medium tabular-nums text-foreground">
                {formatNumber(manHoursToDate)}
              </span>
            </span>
          )}
          {hasSubmissionCount && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Submissions received
              <span className="text-sm font-medium tabular-nums text-foreground">
                {submissionsReceived}/{submissionsTotal}
              </span>
            </span>
          )}
        </div>
      )}

      <div className="border-t pt-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
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
