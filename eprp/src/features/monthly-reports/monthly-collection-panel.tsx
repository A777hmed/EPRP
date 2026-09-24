"use client";

/**
 * Monthly Distribution & Follow-up — Project Control's view of the department
 * round.
 *
 * THE PLATFORM SENDS NO EMAIL. There is no provider, no credential and no
 * server route, and this panel says so rather than implying delivery. Starting
 * collection records the deadline and opens each department's input; the
 * request itself is sent by the user from their own mail client via Email
 * Draft, or by pasting the copied link.
 *
 * Every row is derived from the PROJECT's department list, so a department that
 * has not been sent anything still appears — that is the row Project Control
 * most needs to see. Recipients are resolved from project assignments by
 * `resolveDepartmentRecipients`, shared with Weekly, so nobody is invented and
 * nobody is inferred from who happened to answer last month.
 */

import * as React from "react";
import { Link2, Mail, Send, Users } from "lucide-react";
import { toast } from "sonner";

import { SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { monthlyReportService } from "@/services/monthly-report-service";
import { GAP_LABEL } from "@/features/weekly-reports/weekly-recipients";
import type { Contact, Department } from "@/types";
import {
  COLLECTION_STATE_LABEL,
  buildMonthlyCollectionRows,
  monthlyCollectionCounters,
  monthlyDepartmentLink,
  monthlyInvitationEmail,
  type CollectionState,
  type MonthlyCollectionRow,
} from "./monthly-collection";
import type { MonthlyReportBundle } from "./monthly-report-document";

const STATE_TONE: Record<CollectionState, StatusTone> = {
  not_sent: "neutral",
  waiting: "warning",
  submitted: "info",
  approved: "success",
  returned: "warning",
};

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: StatusTone;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          tone === "warning" && value > 0
            ? "text-lg font-semibold tabular-nums text-warning"
            : "text-lg font-semibold tabular-nums"
        }
      >
        {value}
      </p>
    </div>
  );
}

export interface MonthlyCollectionPanelProps {
  bundle: MonthlyReportBundle;
  /** Project Control / Report Coordinator / admin. Nothing here is offered otherwise. */
  canManage: boolean;
  onChanged: () => Promise<void>;
}

export function MonthlyCollectionPanel({
  bundle,
  canManage,
  onChanged,
}: MonthlyCollectionPanelProps) {
  const { report, project } = bundle;
  const [busy, setBusy] = React.useState(false);
  const [dueAt, setDueAt] = React.useState("");

  const rows = React.useMemo(
    () =>
      buildMonthlyCollectionRows(
        project,
        bundle.monthlySubmissions,
        bundle.departments as Department[],
        bundle.contacts as Contact[]
      ),
    [project, bundle.monthlySubmissions, bundle.departments, bundle.contacts]
  );
  const counters = React.useMemo(
    () => monthlyCollectionCounters(rows),
    [rows]
  );

  const monthLabel = formatDate(report.reportingMonth);

  const linkFor = React.useCallback(
    (departmentId: string) =>
      monthlyDepartmentLink(
        window.location.origin,
        project?.id,
        report.id,
        departmentId
      ),
    [project?.id, report.id]
  );

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  };

  const emailDraft = (row: MonthlyCollectionRow) => {
    const { subject, body } = monthlyInvitationEmail({
      projectName: project?.name ?? "Project",
      projectCode: project?.code,
      reportNumber: report.reportNumber,
      monthLabel,
      departmentName: row.departmentName,
      dueAt: row.dueAt,
      link: linkFor(row.departmentId),
    });
    const to = row.recipients.emails.join(",");
    /*
     * An empty `mailto:` opens a blank message that looks like it did
     * something. When there is nobody to write to, say why instead.
     */
    if (!to) {
      toast.error(
        `${row.departmentName} has no email addresses stored — add them in Contacts first.`
      );
      return;
    }
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
  };

  const start = async (departmentIds: string[]) => {
    if (departmentIds.length === 0) return;
    setBusy(true);
    try {
      await monthlyReportService.startCollection(
        report.id,
        departmentIds,
        dueAt ? new Date(dueAt).toISOString() : undefined
      );
      await onChanged();
      toast.success(
        departmentIds.length === 1
          ? "Monthly collection started for this department."
          : `Monthly collection started for ${departmentIds.length} departments.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start Monthly collection."
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) return null;

  return (
    <SectionCard
      title="Distribution & Follow-up"
      description="Ask each department to review the month and add anything the Weekly Reports did not already say."
      action={
        <Button
          size="sm"
          disabled={busy || rows.length === 0}
          onClick={() => start(rows.map((row) => row.departmentId))}
        >
          <Send data-icon="inline-start" aria-hidden="true" />
          Start Monthly Collection for All Departments
        </Button>
      }
    >
      <p className="mb-3 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        This platform does not send email. Starting collection records the
        deadline and opens each department&apos;s Monthly input — send the
        request yourself with <b>Email Draft</b> or by pasting the copied link.
      </p>

      <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Counter label="Not Sent" value={counters.notSent} />
        <Counter label="Waiting for Input" value={counters.waiting} />
        <Counter label="Submitted" value={counters.submitted} />
        <Counter label="Dept. Approved" value={counters.approved} />
        <Counter label="Overdue" value={counters.overdue} tone="warning" />
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="monthly-collection-due" className="text-xs">
            Deadline for this round (optional)
          </Label>
          <Input
            id="monthly-collection-due"
            type="date"
            className="h-8 w-48 text-xs"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Applied to every department the round is started for.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This project has no departments assigned yet. Add them in Project
          Setup before collecting Monthly input.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.departmentId} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {row.departmentName}
                </span>
                {row.nilReturn && (
                  <StatusBadge tone="neutral">No additions</StatusBadge>
                )}
                {row.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
                <StatusBadge tone={STATE_TONE[row.state]}>
                  {COLLECTION_STATE_LABEL[row.state]}
                </StatusBadge>
              </div>

              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" aria-hidden="true" />
                  {row.recipients.manager
                    ? `Manager: ${row.recipients.manager.name}`
                    : "No manager assigned"}
                </span>
                <span>
                  {row.recipients.contributors.length} contributor
                  {row.recipients.contributors.length === 1 ? "" : "s"}
                </span>
                <span>
                  {row.recipients.emails.length} email
                  {row.recipients.emails.length === 1 ? "" : "s"}
                </span>
                {row.sentAt && <span>Sent {formatDateTime(row.sentAt)}</span>}
                {row.dueAt && <span>Due {formatDate(row.dueAt)}</span>}
                {row.lastActivityAt && (
                  <span>Last activity {formatDateTime(row.lastActivityAt)}</span>
                )}
              </p>

              {row.recipients.gaps.length > 0 && (
                <p className="mt-1 text-xs text-warning">
                  {row.recipients.gaps.map((gap) => GAP_LABEL[gap]).join(" · ")}
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => start([row.departmentId])}
                >
                  <Send data-icon="inline-start" aria-hidden="true" />
                  {row.state === "not_sent" ? "Start collection" : "Remind"}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => emailDraft(row)}
                >
                  <Mail data-icon="inline-start" aria-hidden="true" />
                  Email Draft
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    copy(
                      linkFor(row.departmentId),
                      `Link for ${row.departmentName} copied.`
                    )
                  }
                >
                  <Link2 data-icon="inline-start" aria-hidden="true" />
                  Copy Link
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

