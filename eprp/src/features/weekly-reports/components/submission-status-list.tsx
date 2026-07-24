"use client";

import { getContactById, getDepartmentById } from "@/features/master-data";
import { formatDate } from "@/lib/formatters";
import type { WeeklySubmission } from "@/types";
import { SubmissionStatusBadge } from "./weekly-status-badge";

export interface SubmissionStatusListProps {
  submissions: WeeklySubmission[];
}

/** Per-department submission status, resolved against real master data. */
export function SubmissionStatusList({
  submissions,
}: SubmissionStatusListProps) {
  if (submissions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No departments are contributing to this report.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {submissions.map((sub) => {
        const dept = getDepartmentById(sub.departmentId);
        const submitter = getContactById(sub.submittedByContactId);
        return (
          <li
            key={sub.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {dept?.name ?? sub.departmentId}
                {dept?.code && (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    {dept.code}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {sub.submittedAt
                  ? `Submitted ${formatDate(sub.submittedAt)}${
                      submitter ? ` · ${submitter.name}` : ""
                    }`
                  : "Not submitted yet"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {typeof sub.progressDelta === "number" && (
                <span className="text-xs font-medium text-muted-foreground tabular-nums">
                  +{sub.progressDelta}%
                </span>
              )}
              <SubmissionStatusBadge status={sub.status} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
