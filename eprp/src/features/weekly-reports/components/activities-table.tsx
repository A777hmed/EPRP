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
import { ACTIVITY_STATUS_META } from "@/lib/constants";
import type { WeeklyActivity } from "@/types";

export interface ActivitiesTableProps {
  activities: WeeklyActivity[];
  /** Shown when the report has no activities. */
  emptyMessage?: string;
}

/**
 * Read-only Major Activities table, shared by the detail view and the
 * preview so both render identically (spec §2 section 6).
 */
export function ActivitiesTable({
  activities,
  emptyMessage = "No major activities recorded for this week.",
}: ActivitiesTableProps) {
  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const ordered = [...activities].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">#</TableHead>
            <TableHead>Activity</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Discipline</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Progress</TableHead>
            <TableHead>Remarks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((activity, index) => {
            const meta = ACTIVITY_STATUS_META[activity.status];
            return (
              <TableRow key={activity.id}>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </TableCell>
                <TableCell className="font-medium">{activity.title}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {getDepartmentById(activity.departmentId)?.name ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {getDisciplineById(activity.disciplineId)?.name ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {getContactById(activity.ownerContactId)?.name ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {typeof activity.progressPercent === "number"
                    ? `${activity.progressPercent}%`
                    : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground text-pretty">
                  {activity.remarks || "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
