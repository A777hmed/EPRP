"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared";
import {
  getContactById,
  getDepartmentById,
  getDisciplineById,
} from "@/features/master-data";
import {
  SUBMISSION_HEALTH_META,
  SUBMISSION_STATUS_META,
} from "@/lib/constants";
import type { WeeklySubmission } from "@/types";

export interface DepartmentUpdatesTableProps {
  submissions: WeeklySubmission[];
  emptyMessage?: string;
}

/**
 * Read-only Department and Discipline Updates table (spec §2 section 7),
 * shared by the detail view and the preview so both show the same columns.
 *
 * "Status" here is the department's own verdict on the work; the submission
 * lifecycle is a separate column — conflating them was the W3A gap.
 */
export function DepartmentUpdatesTable({
  submissions,
  emptyMessage = "No departments are contributing to this report.",
}: DepartmentUpdatesTableProps) {
  if (submissions.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Department</TableHead>
            <TableHead>Discipline</TableHead>
            <TableHead className="text-right">Progress</TableHead>
            <TableHead>Health Status</TableHead>
            <TableHead>Key Update</TableHead>
            <TableHead>Risks / Issues</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Submission</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {submissions.map((sub) => {
            const department = getDepartmentById(sub.departmentId);
            const health = sub.healthStatus
              ? SUBMISSION_HEALTH_META[sub.healthStatus]
              : undefined;
            const submission = SUBMISSION_STATUS_META[sub.status];
            return (
              <TableRow key={sub.id}>
                <TableCell className="font-medium">
                  {department?.name ?? sub.departmentId}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {getDisciplineById(sub.disciplineId)?.name ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {typeof sub.progressPercent === "number"
                    ? `${sub.progressPercent}%`
                    : "—"}
                </TableCell>
                <TableCell>
                  {health ? (
                    <StatusBadge tone={health.tone}>{health.label}</StatusBadge>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground text-pretty">
                  {sub.keyAchievement || "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground text-pretty">
                  {sub.risksIssues || "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {getContactById(sub.responsibleContactId)?.name ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={submission.tone}>
                    {submission.label}
                  </StatusBadge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
