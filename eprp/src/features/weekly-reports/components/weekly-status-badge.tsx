import { StatusBadge } from "@/components/shared";
import { REPORT_STATUS_META, SUBMISSION_STATUS_META } from "@/lib/constants";
import type { ReportStatus, SubmissionStatus } from "@/types";

/** Report lifecycle badge (Draft / Collecting / Under Review / …). */
export function WeeklyStatusBadge({
  status,
  className,
}: {
  status: ReportStatus;
  className?: string;
}) {
  const meta = REPORT_STATUS_META[status];
  return (
    <StatusBadge tone={meta.tone} className={className}>
      {meta.label}
    </StatusBadge>
  );
}

/** Department submission status badge (Pending / In Progress / Submitted / …). */
export function SubmissionStatusBadge({
  status,
  className,
}: {
  status: SubmissionStatus;
  className?: string;
}) {
  const meta = SUBMISSION_STATUS_META[status];
  return (
    <StatusBadge tone={meta.tone} className={className}>
      {meta.label}
    </StatusBadge>
  );
}
