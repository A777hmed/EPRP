"use client";

import type * as React from "react";

import { SectionCard, StatusBadge } from "@/components/shared";
import { REPORT_SOURCE_META, REPORT_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { getContactById } from "@/features/master-data";
import type { WeeklyReport } from "@/types";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

export interface WeeklyReportInformationProps {
  report: WeeklyReport;
}

/**
 * Report Information / Approval.
 *
 * The sign-off and audit facts a printed progress report carries at the foot
 * of the page: who prepared, reviewed and approved it, when it was created and
 * last changed, where its content came from, and where it stands in the
 * lifecycle.
 *
 * Every value is read from the report's own columns. A name that has not been
 * recorded reads "Not recorded" rather than being filled in with the signed-in
 * user or anyone else — an unapproved report must look unapproved.
 */
export function WeeklyReportInformation({
  report,
}: WeeklyReportInformationProps) {
  const status = REPORT_STATUS_META[report.status];
  const nameOf = (contactId?: string) =>
    getContactById(contactId)?.name ?? "Not recorded";

  return (
    <SectionCard
      title="Report Information"
      description="Preparation, review, approval and audit trail."
      action={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Prepared By" value={nameOf(report.preparedByContactId)} />
        <Fact label="Reviewed By" value={nameOf(report.reviewedByContactId)} />
        <Fact label="Approved By" value={nameOf(report.approvedByContactId)} />
        <Fact
          label="Created"
          value={
            <span className="tabular-nums">{formatDate(report.createdAt)}</span>
          }
        />
        <Fact
          label="Last Updated"
          value={
            <span className="tabular-nums">{formatDate(report.updatedAt)}</span>
          }
        />
        <Fact label="Source" value={REPORT_SOURCE_META[report.source].label} />
      </dl>
    </SectionCard>
  );
}
