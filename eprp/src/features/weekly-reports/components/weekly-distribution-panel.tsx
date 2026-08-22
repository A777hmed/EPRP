"use client";

/**
 * Distribution & Follow-up — the Weekly's operational starting point.
 *
 * Project Control distributes the Weekly to each department, a deadline starts,
 * and this table is where they see who responded and who did not. It is a
 * control table, not a dashboard: one row per department, dense, with the next
 * action always visible on the row it belongs to.
 *
 * WHAT IT WRITES. Only `sent_at` and `due_at`, and only on the submission rows
 * of the departments being sent. Status is never written here — distributing a
 * Weekly does not mean a department has started it, and stamping a status would
 * silently overwrite work already in progress.
 *
 * EMAIL IS NOT FAKED. The platform has no outbound mail configured, so "send"
 * starts the collection workflow and the link is copied by hand. The panel says
 * so plainly rather than implying a message was delivered.
 */

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Link2,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import type { Department, WeeklySubmission } from "@/types";
import {
  GAP_LABEL,
  manageContactsHref,
  type DepartmentRecipients,
  type Recipient,
} from "../weekly-recipients";
import { weeklyReportService } from "@/services/weekly-report-service";

/** No mail transport is configured anywhere in the platform. */
const EMAIL_CONFIGURED = false;

const DEFAULT_DEADLINE_HOURS = 48;

export type DistributionState =
  | "not_sent"
  | "sent"
  | "in_progress"
  | "submitted"
  | "returned"
  | "approved"
  | "overdue";

export const DISTRIBUTION_LABEL: Record<DistributionState, string> = {
  not_sent: "Not Sent",
  sent: "Collection Started",
  in_progress: "In Progress",
  submitted: "Submitted",
  returned: "Returned",
  approved: "Department Approved",
  overdue: "Overdue",
};

const DISTRIBUTION_TONE: Record<DistributionState, string> = {
  not_sent: "idle",
  sent: "info",
  in_progress: "info",
  submitted: "good",
  returned: "warn",
  approved: "good",
  overdue: "bad",
};

/**
 * One department's state, from the existing status plus the two timing columns.
 *
 * No status value is invented: Overdue is DERIVED from the deadline and the
 * work still being outstanding, so it can never disagree with the clock, and
 * "Not Sent" is simply the absence of `sentAt`.
 */
export function distributionStateOf(
  submission: WeeklySubmission | undefined,
  now: number
): DistributionState {
  if (!submission || !submission.sentAt) return "not_sent";
  if (submission.status === "approved") return "approved";
  if (submission.status === "submitted") return "submitted";
  if (submission.status === "returned") return "returned";

  const overdue = submission.dueAt ? new Date(submission.dueAt).getTime() < now : false;
  if (overdue) return "overdue";
  return submission.status === "in_progress" ? "in_progress" : "sent";
}

export interface DistributionRow {
  departmentId: string;
  departmentName: string;
  recipients: DepartmentRecipients;
  submission?: WeeklySubmission;
  state: DistributionState;
  lastActivity?: string;
}

export interface WeeklyDistributionPanelProps {
  reportId: string;
  reportNumber: string;
  /** For the "Manage Project Contacts" action on an unassigned department. */
  projectId?: string;
  /** EVERY department assigned to this project — the candidates for scope. */
  projectDepartments: { id: string; name: string }[];
  /** Whether the viewer may change the Weekly's department scope. */
  canEditScope: boolean;
  rows: DistributionRow[];
  /** Refetch submissions after a write. */
  onChanged: () => Promise<void> | void;
}

export function WeeklyDistributionPanel({
  reportId,
  reportNumber,
  projectId,
  projectDepartments,
  canEditScope,
  rows,
  onChanged,
}: WeeklyDistributionPanelProps) {
  const [dialogFor, setDialogFor] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const linkFor = React.useCallback(
    (departmentId: string) =>
      `${window.location.origin}/weekly-reports/${reportId}/workspace#dept-${departmentId}`,
    [reportId]
  );

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  };

  const startCollection = async (departmentIds: string[], dueAt: string) => {
    setBusy(true);
    try {
      await weeklyReportService.startCollection(reportId, departmentIds, dueAt);
      await onChanged();
      toast.success(
        departmentIds.length === 1
          ? "Collection started for the department."
          : `Collection started for ${departmentIds.length} departments.`
      );
      setDialogFor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start collection.");
    } finally {
      setBusy(false);
    }
  };

  const [scopeBusy, setScopeBusy] = React.useState(false);

  const applyScope = async (departmentIds: string[]) => {
    setScopeBusy(true);
    try {
      const result = await weeklyReportService.setDepartmentScope(reportId, departmentIds);
      await onChanged();
      if (result.refusedDepartmentIds.length > 0) {
        // Naming the refusal beats a silent partial save.
        const names = result.refusedDepartmentIds
          .map((id) => projectDepartments.find((d) => d.id === id)?.name ?? "a department")
          .join(", ");
        toast.warning(`Kept in scope — input already exists: ${names}.`);
      } else {
        toast.success("Weekly scope updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the Weekly scope.");
    } finally {
      setScopeBusy(false);
    }
  };

  const counts = summarise(rows);

  return (
    <SectionCard
      title="Distribution & Follow-up"
      description="Who has the Weekly, who has responded, and what is due."
    >
      {!EMAIL_CONFIGURED && (
        <p className="wd-notice">
          <AlertTriangle aria-hidden />
          Email delivery is not configured — use Copy Link.
        </p>
      )}

      {/*
        Departments in Weekly Scope.

        The scope IS the set of department submission rows, so selecting a
        department adds its row and clearing one removes it — and removal is
        refused by the service for any department that has already started, so
        scope editing can never destroy input.
      */}
      <div className="wd-scope">
        <div className="wd-scope-head">
          <b>Departments in Weekly Scope</b>
          <small>
            {rows.length} of {projectDepartments.length} project department
            {projectDepartments.length === 1 ? "" : "s"} selected
          </small>
          {canEditScope && (
            <Button
              size="sm"
              variant="outline"
              disabled={scopeBusy || rows.length === projectDepartments.length}
              onClick={() => applyScope(projectDepartments.map((d) => d.id))}
            >
              Select All Project Departments
            </Button>
          )}
        </div>
        <ul className="wd-scope-list">
          {projectDepartments.map((department) => {
            const inScope = rows.some((row) => row.departmentId === department.id);
            return (
              <li key={department.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={inScope}
                    disabled={!canEditScope || scopeBusy}
                    onChange={(event) =>
                      applyScope(
                        event.target.checked
                          ? [...rows.map((row) => row.departmentId), department.id]
                          : rows
                              .map((row) => row.departmentId)
                              .filter((id) => id !== department.id)
                      )
                    }
                  />
                  {department.name}
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Compact counts: every one derived from the rows below. */}
      <ul className="wd-summary">
        <Count label="Departments" value={counts.total} />
        <Count label="Not Sent" value={counts.notSent} tone={counts.notSent ? "idle" : undefined} />
        <Count label="Waiting for Input" value={counts.waiting} tone="info" />
        <Count label="Submitted" value={counts.submitted} tone="good" />
        <Count label="Dept. Approved" value={counts.approved} tone="good" />
        <Count label="Overdue" value={counts.overdue} tone={counts.overdue ? "bad" : undefined} />
      </ul>

      <div className="wd-toolbar">
        <Button
          size="sm"
          onClick={() => setDialogFor(rows.map((row) => row.departmentId))}
          disabled={rows.length === 0}
        >
          <Send aria-hidden /> Start Collection for All Departments
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length === 0}
          onClick={() =>
            copy(
              rows.map((row) => `${row.departmentName}: ${linkFor(row.departmentId)}`).join("\n"),
              "All department links copied."
            )
          }
        >
          <Link2 aria-hidden /> Copy All Links
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="wd-empty">
          This project has no departments in scope for Weekly reporting yet. Add them in Project
          Setup before distributing.
        </p>
      ) : (
        <div className="wd-table-wrap">
          <table className="wd-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Manager</th>
                <th>Contributors</th>
                <th>Recipient Emails</th>
                <th>Distribution</th>
                <th>Sent At</th>
                <th>Deadline</th>
                <th>Submission</th>
                <th>Last Activity</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.departmentId}>
                  <td className="wd-dept">{row.departmentName}</td>
                  <td>
                    {row.recipients.manager ? (
                      <RecipientLine person={row.recipients.manager} />
                    ) : (
                      <span className="wd-none">No manager assigned</span>
                    )}
                  </td>
                  <td>
                    <ContributorCell recipients={row.recipients} projectId={projectId} />
                  </td>
                  <td className="wd-emails">
                    {row.recipients.emails.length === 0 ? (
                      <span className="wd-none">None stored</span>
                    ) : (
                      <span title={row.recipients.emails.join(", ")}>
                        {row.recipients.emails.length} address
                        {row.recipients.emails.length === 1 ? "" : "es"}
                      </span>
                    )}
                  </td>
                  <td>
                    <StateChip state={row.state} />
                  </td>
                  <td className="wd-when">{stamp(row.submission?.sentAt)}</td>
                  <td className="wd-when">
                    {row.submission?.dueAt ? (
                      <span className={row.state === "overdue" ? "wd-due is-late" : "wd-due"}>
                        <Clock aria-hidden />
                        {stamp(row.submission.dueAt)}
                      </span>
                    ) : (
                      <span className="wd-none">—</span>
                    )}
                  </td>
                  <td>{submissionLabel(row.submission)}</td>
                  <td className="wd-when">{stamp(row.lastActivity)}</td>
                  <td className="wd-actions">
                    <button
                      type="button"
                      onClick={() => setDialogFor([row.departmentId])}
                      title={row.submission?.sentAt ? "Resend reminder" : "Start collection for this department"}
                    >
                      <Send aria-hidden />
                      {row.submission?.sentAt ? "Remind" : "Start Collection"}
                    </button>
                    <button
                      type="button"
                      onClick={() => copy(linkFor(row.departmentId), `Link copied for ${row.departmentName}.`)}
                      title="Copy department link"
                    >
                      <Copy aria-hidden /> Link
                    </button>
                    <a href={`#dept-${row.departmentId}`} title="Open department input">
                      <ExternalLink aria-hidden /> Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogFor && (
        <DistributionDialog
          reportNumber={reportNumber}
          projectId={projectId}
          rows={rows.filter((row) => dialogFor.includes(row.departmentId))}
          busy={busy}
          onCancel={() => setDialogFor(null)}
          onStart={(dueAt) => startCollection(dialogFor, dueAt)}
        />
      )}
    </SectionCard>
  );
}

/* --------------------------------- Dialog ---------------------------------- */

function DistributionDialog({
  reportNumber,
  projectId,
  rows,
  busy,
  onCancel,
  onStart,
}: {
  reportNumber: string;
  projectId?: string;
  rows: DistributionRow[];
  busy: boolean;
  onCancel: () => void;
  onStart: (dueAt: string) => void;
}) {
  /* Default deadline is Send time + 48 hours, adjustable before starting. */
  const blocked = rows.filter((row) => row.recipients.hasNoRecipients);

  const [dueLocal, setDueLocal] = React.useState(() => {
    const due = new Date(Date.now() + DEFAULT_DEADLINE_HOURS * 3600 * 1000);
    due.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
  });

  return (
    <div className="wd-dialog-scrim" role="dialog" aria-modal="true" aria-label="Start Weekly collection">
      <div className="wd-dialog">
        <header>
          <b>Start Weekly Collection</b>
          <small>{reportNumber}</small>
        </header>

        <div className="wd-dialog-body">
          <div className="wd-field">
            <span>Recipients</span>
            <ul className="wd-recipients">
              {rows.map((row) => (
                <li key={row.departmentId} className={row.recipients.hasNoRecipients ? "is-blocked" : undefined}>
                  <b>{row.departmentName}</b>
                  <em>
                    {row.recipients.manager
                      ? row.recipients.manager.name
                      : "No manager assigned"}
                  </em>
                  <i>
                    {row.recipients.contributors.length} contributor
                    {row.recipients.contributors.length === 1 ? "" : "s"}
                  </i>
                  {/* The exact state, never hidden: a department with nobody
                      assigned cannot receive the Weekly, and one with a manager
                      but no contributors is a different situation again. */}
                  {row.recipients.gaps.length > 0 && (
                    <u>
                      {row.recipients.gaps.map((gap) => GAP_LABEL[gap]).join(" · ")}
                    </u>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <label className="wd-field">
            <span>Deadline</span>
            <input
              type="datetime-local"
              value={dueLocal}
              onChange={(event) => setDueLocal(event.target.value)}
            />
            <small>Defaults to {DEFAULT_DEADLINE_HOURS} hours from now. Adjust before starting.</small>
          </label>

          <div className="wd-field">
            <span>Delivery</span>
            <p className="wd-delivery">
              {EMAIL_CONFIGURED
                ? "Email and department link."
                : "Department link only — email delivery is not configured, so copy the link to each department after starting."}
            </p>
          </div>
        </div>

        {blocked.length > 0 && (
          /*
           * Named, not hidden. Starting collection for a department nobody is
           * assigned to would report a distribution that cannot reach anybody,
           * so the department is named and the fix is one click away.
           */
          <p className="wd-blocked">
            <AlertTriangle aria-hidden />
            <span>
              <b>
                {blocked.length} department{blocked.length === 1 ? " has" : "s have"} no recipients
                assigned:
              </b>{" "}
              {blocked.map((row) => row.departmentName).join(", ")}. Collection can still start, but
              nobody is recorded to receive it.
              <a href={manageContactsHref(projectId)}>Manage Project Contacts</a>
            </span>
          </p>
        )}

        <footer>
          <Button
            onClick={() => onStart(new Date(dueLocal).toISOString())}
            disabled={busy || !dueLocal}
          >
            <Check aria-hidden />
            {busy ? "Starting…" : "Start Weekly Collection"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------- Fragments -------------------------------- */

/** Name over address, so a row stays two compact lines. */
function RecipientLine({ person }: { person: Recipient }) {
  return (
    <span className="wd-person">
      <b>{person.name}</b>
      {person.email ? (
        <a href={`mailto:${person.email}`}>{person.email}</a>
      ) : (
        <em>{person.unlinked ? "Free-text name — no contact record" : "No email stored"}</em>
      )}
    </span>
  );
}

/**
 * Two contributors, then a count — with the full list on demand.
 *
 * An unassigned department gets the action that fixes it rather than a dash,
 * because "None assigned" without a next step is where Phase 1 left the user.
 */
function ContributorCell({
  recipients,
  projectId,
}: {
  recipients: DepartmentRecipients;
  projectId?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const people = recipients.contributors;

  if (people.length === 0) {
    return (
      <span className="wd-unassigned">
        No recipients assigned
        <a href={manageContactsHref(projectId)}>Manage Project Contacts</a>
      </span>
    );
  }

  const shown = open ? people : people.slice(0, 2);
  return (
    <span className="wd-people">
      {shown.map((person) => (
        <RecipientLine key={person.contactId ?? person.name} person={person} />
      ))}
      {people.length > 2 && (
        <button type="button" className="wd-more" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : `+${people.length - 2} more`}
        </button>
      )}
    </span>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <li className={tone ? `wd-count is-${tone}` : "wd-count"}>
      <b>{value}</b>
      <span>{label}</span>
    </li>
  );
}

function StateChip({ state }: { state: DistributionState }) {
  return (
    <span className={`wd-chip is-${DISTRIBUTION_TONE[state]}`}>{DISTRIBUTION_LABEL[state]}</span>
  );
}

function submissionLabel(submission: WeeklySubmission | undefined): React.ReactNode {
  if (!submission) return <span className="wd-none">No row</span>;
  const map: Record<string, string> = {
    pending: "Awaiting input",
    in_progress: "In progress",
    submitted: "Submitted",
    returned: "Returned",
    approved: "Approved",
  };
  return map[submission.status] ?? submission.status;
}

function stamp(value: string | undefined): React.ReactNode {
  if (!value) return <span className="wd-none">—</span>;
  const date = new Date(value);
  return (
    <time dateTime={value}>
      {date.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}{" "}
      {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}

export function summarise(rows: DistributionRow[]) {
  const by = (state: DistributionState) => rows.filter((row) => row.state === state).length;
  return {
    total: rows.length,
    notSent: by("not_sent"),
    /* Distributed but not yet delivered back — Sent, In Progress or Returned. */
    waiting: by("sent") + by("in_progress") + by("returned"),
    submitted: by("submitted"),
    approved: by("approved"),
    overdue: by("overdue"),
  };
}

export type { Department };
