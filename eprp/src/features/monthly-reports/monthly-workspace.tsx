"use client";

/**
 * The Monthly Workspace — where the report is authored.
 *
 * Deliberately not a copy of the document. The document is one long read; the
 * workspace is seven short jobs, each with its own controls at the top of the
 * panel, so a primary action is never buried under a page of content the author
 * has already dealt with.
 */

import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Check, Eye, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { MILESTONE_STATUS_META, PRIORITY_META, REPORT_STATUS_META } from "@/lib/constants";
import { getMonthLabel } from "@/lib/reporting";
import { monthlyReportService } from "@/services/monthly-report-service";
import type { Contact, MonthlyComment, MonthlyPlanItem, MonthlyReport } from "@/types";
import { EmptyRow, type MonthlyReportBundle } from "./monthly-report-document";
import { MONTHLY_UPDATE_TYPE_OPTIONS, MonthlyCommentForm } from "./monthly-comment-form";
import { MonthlyManagementPanel } from "./monthly-management";
import {
  GLOBAL_MONTHLY_LINKS,
  WeeklyImportStrip,
  buildProjectMonthlyLinks,
  type MonthlyReportLinks,
} from "./monthly-report-view";
import { useMonthlyBundle } from "./use-monthly-bundle";
import {
  NOT_RECORDED,
  autoDraftExecutiveSummary,
  commentStatusMeta,
  monthEndStatus,
  nameOf,
  nextMonthLabel,
  weekStatus,
} from "./monthly-data";

const typeLabels = Object.fromEntries(MONTHLY_UPDATE_TYPE_OPTIONS) as Record<MonthlyComment["updateType"], string>;
const KPI_RATINGS = ["excellent", "good", "fair", "at_risk", "critical"] as const;
const PLAN_STATUSES = ["not_started", "in_progress", "completed", "delayed", "pending"] as const;

type PanelKey = "overview" | "weekly" | "milestones" | "comments" | "management" | "plan" | "summary" | "approval";

const PANELS: { key: PanelKey; label: string; hint: string }[] = [
  { key: "overview", label: "Monthly Overview", hint: "Report identity and month-end KPIs" },
  { key: "weekly", label: "Weekly Inputs", hint: "Import and review this month's Weekly Reports" },
  { key: "milestones", label: "Master Milestone Progress", hint: "Governed milestone position, read-only" },
  { key: "comments", label: "Monthly Comments", hint: "Add and curate Monthly updates" },
  { key: "management", label: "Management Items", hint: "Decisions and escalations for leadership" },
  { key: "plan", label: "Next Month Plan", hint: "Plan items and focus for the coming month" },
  { key: "summary", label: "Executive Summary", hint: "The narrative leadership reads first" },
  { key: "approval", label: "Approval", hint: "Responsibility and lifecycle" },
];

/* --------------------------------- Helpers --------------------------------- */

function commentToInput(comment: MonthlyComment) {
  return {
    id: comment.id,
    updateType: comment.updateType,
    originalText: comment.presentationText || comment.originalText,
    presentationText: comment.presentationText,
    departmentId: comment.departmentId,
    systemId: comment.systemId,
    disciplineId: comment.disciplineId,
    priority: comment.priority,
    status: comment.status,
    responsibleContactId: comment.responsibleContactId,
    targetDate: comment.targetDate,
    includeInFinal: comment.includeInFinal,
    escalateToManagement: comment.escalateToManagement,
    isMajorAchievement: comment.isMajorAchievement,
  };
}

function WorkspacePanel({ title, hint, action, children }: { title: string; hint: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="monthly-ws-panel">
      <div className="monthly-ws-panel-head">
        <div>
          <b>{title}</b>
          <span>{hint}</span>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Authorship({ comment, contacts }: { comment: MonthlyComment; contacts: Contact[] }) {
  return (
    <p className="monthly-comment-author">
      {comment.sourceKind === "weekly" ? `Weekly W${comment.weekNumber ?? "—"}` : "Monthly (manual)"} · Author:{" "}
      {nameOf(comment.createdByContactId, contacts, NOT_RECORDED)} · Created {new Date(comment.createdAt).toLocaleString()}
      {comment.updatedByContactId && (
        <>
          {" "}
          · Last edited by {nameOf(comment.updatedByContactId, contacts, NOT_RECORDED)} {new Date(comment.updatedAt).toLocaleString()}
        </>
      )}
    </p>
  );
}

/* ------------------------------ Comment editor ----------------------------- */

function CommentRows({
  comments,
  bundle,
  reload,
  emptyText,
}: {
  comments: MonthlyComment[];
  bundle: MonthlyReportBundle;
  reload: () => Promise<void>;
  emptyText: string;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);

  if (!comments.length) return <EmptyRow>{emptyText}</EmptyRow>;

  const toggle = async (comment: MonthlyComment) => {
    try {
      await monthlyReportService.saveComment(bundle.report.id, { ...commentToInput(comment), includeInFinal: !comment.includeInFinal });
      await reload();
      toast.success(comment.includeInFinal ? "Excluded from the Monthly report." : "Restored to the Monthly report.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the item.");
    }
  };

  const remove = async (comment: MonthlyComment) => {
    try {
      await monthlyReportService.deleteComment(bundle.report.id, comment.id);
      await reload();
      toast.success("Monthly item removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the item.");
    }
  };

  return (
    <div className="monthly-comment-list">
      {comments.map((comment) => (
        <article className={`monthly-comment-card ${comment.includeInFinal ? "" : "excluded"}`} key={comment.id}>
          {editingId === comment.id ? (
            <MonthlyCommentForm
              reportId={bundle.report.id}
              project={bundle.project}
              departments={bundle.departments}
              disciplines={bundle.disciplines}
              contacts={bundle.contacts}
              comment={comment}
              onSaved={reload}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <div className="monthly-comment-meta">
                <b>{typeLabels[comment.updateType]}</b>
                <StatusBadge tone={PRIORITY_META[comment.priority].tone}>{PRIORITY_META[comment.priority].label}</StatusBadge>
                <StatusBadge tone={commentStatusMeta(comment.status).tone}>{commentStatusMeta(comment.status).label}</StatusBadge>
                <StatusBadge tone={comment.includeInFinal ? "success" : "neutral"}>{comment.includeInFinal ? "Included" : "Excluded"}</StatusBadge>
              </div>
              <p className="monthly-comment-text">{comment.presentationText || comment.originalText}</p>
              {comment.sourceKind === "weekly" && comment.presentationText && comment.presentationText !== comment.originalText && (
                <p className="monthly-comment-source">Original Weekly wording: {comment.originalText}</p>
              )}
              <Authorship comment={comment} contacts={bundle.contacts} />
              <div className="monthly-row-actions">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(comment.id)}>
                  <Pencil />
                  Edit
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => toggle(comment)}>
                  {comment.includeInFinal ? <X /> : <RotateCcw />}
                  {comment.includeInFinal ? "Exclude" : "Restore"}
                </Button>
                {comment.sourceKind === "monthly_manual" && (
                  <Button type="button" variant="destructive" size="sm" onClick={() => remove(comment)}>
                    <Trash2 />
                    Delete
                  </Button>
                )}
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  );
}

/* --------------------------------- Panels ---------------------------------- */

function OverviewPanel({ bundle, reload }: { bundle: MonthlyReportBundle; reload: () => Promise<void> }) {
  const { report, project, contacts } = bundle;
  const [reportNumber, setReportNumber] = React.useState(report.reportNumber);
  const [preparedBy, setPreparedBy] = React.useState(report.preparedByContactId ?? project?.reportingCoordinatorId ?? "");
  const [planned, setPlanned] = React.useState(String(report.plannedProgress));
  const [actual, setActual] = React.useState(String(report.actualProgress));
  const [hse, setHse] = React.useState(report.hseStatus ?? "");
  const [quality, setQuality] = React.useState(report.qualityStatus ?? "");
  const [overall, setOverall] = React.useState(report.overallProgressStatus ?? "");
  const [saving, setSaving] = React.useState(false);
  const status = monthEndStatus(report);

  const save = async () => {
    const plannedValue = Number(planned);
    const actualValue = Number(actual);
    if (![plannedValue, actualValue].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
      toast.error("Planned and Actual progress must be between 0 and 100.");
      return;
    }
    setSaving(true);
    try {
      await monthlyReportService.update(report.id, {
        reportNumber,
        preparedByContactId: preparedBy,
        plannedProgress: plannedValue,
        actualProgress: actualValue,
        hseStatus: (hse || undefined) as MonthlyReport["hseStatus"],
        qualityStatus: (quality || undefined) as MonthlyReport["qualityStatus"],
        overallProgressStatus: (overall || undefined) as MonthlyReport["overallProgressStatus"],
      });
      await reload();
      toast.success("Monthly overview saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the Monthly overview.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspacePanel
      title="Monthly Overview"
      hint="Report identity and the month-end KPI position."
      action={
        <Button onClick={save} disabled={saving}>
          <Check />
          {saving ? "Saving…" : "Save Overview"}
        </Button>
      }
    >
      <div className="monthly-ws-readout">
        <span>
          Project <b>{project?.name ?? NOT_RECORDED}</b>
        </span>
        <span>
          Month <b>{getMonthLabel(report.reportingMonth)}</b>
        </span>
        <span>
          Month-end <StatusBadge tone={status.tone}>{status.label}</StatusBadge> {status.detail}
        </span>
      </div>
      <div className="monthly-ws-grid">
        <label>
          Report No.
          <input value={reportNumber} onChange={(event) => setReportNumber(event.target.value)} />
        </label>
        <label>
          Prepared By
          <select value={preparedBy} onChange={(event) => setPreparedBy(event.target.value)}>
            <option value="">Not recorded</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Planned %
          <input type="number" min="0" max="100" step="0.1" value={planned} onChange={(event) => setPlanned(event.target.value)} />
        </label>
        <label>
          Actual %
          <input type="number" min="0" max="100" step="0.1" value={actual} onChange={(event) => setActual(event.target.value)} />
        </label>
        <label>
          HSE Rating
          <select value={hse} onChange={(event) => setHse(event.target.value)}>
            <option value="">Not recorded</option>
            {KPI_RATINGS.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quality Rating
          <select value={quality} onChange={(event) => setQuality(event.target.value)}>
            <option value="">Not recorded</option>
            {KPI_RATINGS.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Overall Status
          <select value={overall} onChange={(event) => setOverall(event.target.value)}>
            <option value="">Derive from variance</option>
            {(["ahead", "on_track", "at_risk", "behind", "critical"] as const).map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="monthly-ws-note">
        HSE event counts (LTI, recordable, first aid, near miss) have no field in the Monthly data model — only the rating above is stored.
      </p>
    </WorkspacePanel>
  );
}

function WeeklyPanel({
  bundle,
  reload,
  links,
}: {
  bundle: MonthlyReportBundle;
  reload: () => Promise<void>;
  links: MonthlyReportLinks;
}) {
  const imported = bundle.comments.filter((comment) => comment.sourceKind === "weekly").length;

  return (
    <WorkspacePanel title="Weekly Inputs" hint="Weekly Reports are the operational source; this panel reads them and never writes back.">
      <WeeklyImportStrip reportId={bundle.report.id} importedCount={imported} onDone={reload} />
      {bundle.weeklies.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table monthly-table-weekly">
            <thead>
              <tr>
                <th>Week</th>
                <th>Period</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>SV</th>
                <th>Status</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {bundle.weeklies.map((weekly) => {
                const variance = weekly.actualProgress - weekly.plannedProgress;
                const status = weekStatus(weekly.plannedProgress, weekly.actualProgress);
                return (
                  <tr key={weekly.id}>
                    <td>
                      <b>W{weekly.weekNumber}</b>
                    </td>
                    <td>
                      {format(new Date(weekly.periodStart), "dd MMM")} – {format(new Date(weekly.periodEnd), "dd MMM")}
                    </td>
                    <td className="planned-value">{weekly.plannedProgress.toFixed(1)}%</td>
                    <td className="actual-value">{weekly.actualProgress.toFixed(1)}%</td>
                    <td className="variance-value">
                      {variance > 0 ? "+" : ""}
                      {variance.toFixed(1)}%
                    </td>
                    <td>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </td>
                    <td>
                      <Link
                        className="monthly-link"
                        href={links.weeklyDetail(weekly.id)}
                        prefetch={false}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRow>No Weekly Reports fall within this reporting month.</EmptyRow>
      )}
    </WorkspacePanel>
  );
}

/**
 * Governed Master Milestones, read-only.
 *
 * Consumes `bundle.milestoneStates` — already loaded once by `useMonthlyBundle`
 * — and adds no fetch of its own. Monthly has no observation, submission, or
 * reconciliation path for milestones; this panel exists only so an author can
 * see the governed position while preparing the report, before touching
 * Management Items or the Next Month Plan.
 */
function MilestonesPanel({ bundle }: { bundle: MonthlyReportBundle }) {
  const { milestoneStates } = bundle;

  return (
    <WorkspacePanel title="Master Milestone Progress" hint="Governed position, as approved by Project Control. Read-only here.">
      {milestoneStates.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table monthly-table-milestones">
            <thead>
              <tr>
                <th>Code</th>
                <th>Milestone</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Forecast Date</th>
                <th>Actual Date</th>
              </tr>
            </thead>
            <tbody>
              {milestoneStates.map((state) => {
                const statusMeta = MILESTONE_STATUS_META[state.status];
                return (
                  <tr key={state.milestone.id}>
                    <td>
                      <b>{state.milestone.code}</b>
                    </td>
                    <td>{state.milestone.name}</td>
                    <td>
                      {state.inConflict ? (
                        <StatusBadge tone="danger">Unresolved</StatusBadge>
                      ) : (
                        <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                      )}
                    </td>
                    <td className="actual-value">
                      {state.inConflict ? (
                        <span className="muted">Reconciliation required</span>
                      ) : typeof state.progressPercent === "number" ? (
                        `${state.progressPercent.toFixed(1)}%`
                      ) : (
                        <span className="muted">{NOT_RECORDED}</span>
                      )}
                    </td>
                    <td>{state.forecastDate ? format(new Date(state.forecastDate), "dd MMM yyyy") : <span className="muted">—</span>}</td>
                    <td>{state.actualDate ? format(new Date(state.actualDate), "dd MMM yyyy") : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRow>No active Master Milestones are recorded for this project.</EmptyRow>
      )}
    </WorkspacePanel>
  );
}

function CommentsPanel({ bundle, reload }: { bundle: MonthlyReportBundle; reload: () => Promise<void> }) {
  const [adding, setAdding] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "included" | "excluded" | "weekly" | "manual">("all");

  const comments = bundle.comments.filter((comment) => {
    if (filter === "included") return comment.includeInFinal;
    if (filter === "excluded") return !comment.includeInFinal;
    if (filter === "weekly") return comment.sourceKind === "weekly";
    if (filter === "manual") return comment.sourceKind === "monthly_manual";
    return true;
  });

  return (
    <WorkspacePanel
      title="Monthly Comments"
      hint="Every Monthly update, whether imported from Weekly or written here."
      action={
        !adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus />
            Add Monthly Comment
          </Button>
        )
      }
    >
      {adding && (
        <div className="monthly-ws-inline-form">
          <MonthlyCommentForm
            reportId={bundle.report.id}
            project={bundle.project}
            departments={bundle.departments}
            disciplines={bundle.disciplines}
            contacts={bundle.contacts}
            comment={undefined}
            onSaved={async () => {
              await reload();
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
            forceOpen
          />
        </div>
      )}
      <div className="monthly-ws-filters">
        {(
          [
            ["all", "All"],
            ["included", "Included"],
            ["excluded", "Excluded"],
            ["weekly", "From Weekly"],
            ["manual", "Monthly only"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>
      <CommentRows comments={comments} bundle={bundle} reload={reload} emptyText="No Monthly comments match this filter." />
    </WorkspacePanel>
  );
}

function PlanPanel({ bundle, reload }: { bundle: MonthlyReportBundle; reload: () => Promise<void> }) {
  const { report, plans, contacts, departments } = bundle;
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [targetDate, setTargetDate] = React.useState("");
  const [ownerContactId, setOwnerContactId] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  const [status, setStatus] = React.useState<MonthlyPlanItem["status"]>("not_started");
  const [remarks, setRemarks] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const reset = () => {
    setEditingId(null);
    setTitle("");
    setStartDate("");
    setTargetDate("");
    setOwnerContactId("");
    setDepartmentId("");
    setStatus("not_started");
    setRemarks("");
  };

  const edit = (plan: MonthlyPlanItem) => {
    setEditingId(plan.id);
    setTitle(plan.title);
    setStartDate(plan.startDate ?? "");
    setTargetDate(plan.targetDate ?? "");
    setOwnerContactId(plan.ownerContactId ?? "");
    setDepartmentId(plan.departmentId ?? "");
    setStatus(plan.status);
    setRemarks(plan.remarks ?? "");
  };

  const save = async () => {
    if (!title.trim()) {
      toast.error("A plan item title is required.");
      return;
    }
    setSaving(true);
    try {
      await monthlyReportService.savePlanItem(report.id, {
        id: editingId ?? undefined,
        title,
        departmentId: departmentId || undefined,
        startDate: startDate || undefined,
        targetDate: targetDate || undefined,
        ownerContactId: ownerContactId || undefined,
        status,
        remarks: remarks.trim() || undefined,
        sortOrder: editingId ? (plans.find((plan) => plan.id === editingId)?.sortOrder ?? plans.length) : plans.length,
      });
      await reload();
      reset();
      toast.success(editingId ? "Plan item updated." : "Plan item added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the plan item.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await monthlyReportService.deletePlanItem(report.id, id);
      await reload();
      toast.success("Plan item removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the plan item.");
    }
  };

  return (
    <WorkspacePanel title={`Next Month Plan — ${nextMonthLabel(report.reportingMonth)}`} hint="Plan items appear in section 8 of the report.">
      <div className="monthly-ws-grid monthly-ws-plan-grid">
        <label className="wide">
          Plan Item
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What must be achieved next month" />
        </label>
        <label>
          Start Date
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          Target Date
          <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
        </label>
        <label>
          Owner
          <select value={ownerContactId} onChange={(event) => setOwnerContactId(event.target.value)}>
            <option value="">Not specified</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">Not specified</option>
            {(bundle.project?.departments ?? []).map((assignment) => (
              <option key={assignment.departmentId} value={assignment.departmentId}>
                {nameOf(assignment.departmentId, departments)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as MonthlyPlanItem["status"])}>
            {PLAN_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          Focus / Remarks
          <input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional dependency, target, or note" />
        </label>
      </div>
      <div className="monthly-ws-actions">
        <Button onClick={save} disabled={saving}>
          <Check />
          {saving ? "Saving…" : editingId ? "Update Plan Item" : "Add Plan Item"}
        </Button>
        {editingId && (
          <Button variant="outline" onClick={reset}>
            Cancel Edit
          </Button>
        )}
      </div>

      {plans.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table monthly-table-plan">
            <thead>
              <tr>
                <th>Plan Item</th>
                <th>Target</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <b>{plan.title}</b>
                    {plan.remarks && <small>{plan.remarks}</small>}
                  </td>
                  <td>{plan.targetDate ? format(new Date(plan.targetDate), "dd MMM yyyy") : "—"}</td>
                  <td>{plan.ownerContactId ? nameOf(plan.ownerContactId, contacts) : nameOf(plan.departmentId, departments, "—")}</td>
                  <td>{plan.status.replaceAll("_", " ")}</td>
                  <td className="monthly-register-actions">
                    <button type="button" onClick={() => edit(plan)}>
                      Edit
                    </button>
                    <button type="button" className="danger" onClick={() => remove(plan.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRow>No Next Month plan items have been recorded.</EmptyRow>
      )}

      <div className="monthly-ws-subhead">Focus &amp; Targets</div>
      <CommentRows
        comments={bundle.comments.filter((comment) => comment.updateType === "next_month_plan")}
        bundle={bundle}
        reload={reload}
        emptyText="No next-month focus narrative recorded. Add one from Monthly Comments with category “Next Month Plan”."
      />
    </WorkspacePanel>
  );
}

function SummaryPanel({ bundle, reload }: { bundle: MonthlyReportBundle; reload: () => Promise<void> }) {
  const { report } = bundle;
  const [summary, setSummary] = React.useState(report.executiveSummary ?? "");
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  const draft = () => {
    const text = autoDraftExecutiveSummary({
      report,
      project: bundle.project,
      clientName: bundle.client?.shortName ?? bundle.client?.name,
      comments: bundle.comments,
      weeklies: bundle.weeklies,
      monthLabel: getMonthLabel(report.reportingMonth),
    });
    if (!text) {
      toast.error("There is not enough recorded Monthly data to draft a summary yet.");
      return;
    }
    setSummary(text);
    setDirty(true);
    toast.success("Draft written from recorded Monthly data. Review before saving.");
  };

  const save = async () => {
    setSaving(true);
    try {
      await monthlyReportService.update(report.id, { executiveSummary: summary });
      await reload();
      setDirty(false);
      toast.success("Executive Summary saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the Executive Summary.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspacePanel
      title="Executive Summary"
      hint="Drafted only from data already recorded in this Monthly report — never invented."
      action={
        <div className="monthly-ws-actions">
          <Button variant="outline" onClick={draft}>
            <Sparkles />
            Auto-draft from Monthly Data
          </Button>
          <Button onClick={save} disabled={saving}>
            <Check />
            {saving ? "Saving…" : "Save Summary"}
          </Button>
        </div>
      }
    >
      <textarea
        className="monthly-ws-textarea"
        value={summary}
        onChange={(event) => {
          setSummary(event.target.value);
          setDirty(true);
        }}
        placeholder="Summarize the month for leadership: progress, achievements, constraints, client actions, and next-month focus."
      />
      {dirty && <p className="monthly-ws-note">Unsaved changes.</p>}
    </WorkspacePanel>
  );
}

function ApprovalPanel({ bundle, reload }: { bundle: MonthlyReportBundle; reload: () => Promise<void> }) {
  const { report, project, contacts } = bundle;
  const [reviewedBy, setReviewedBy] = React.useState(report.reviewedByContactId ?? project?.projectControlManagerId ?? "");
  const [approvedBy, setApprovedBy] = React.useState(report.approvedByContactId ?? project?.projectManagerId ?? "");
  const [status, setStatus] = React.useState<MonthlyReport["status"]>(report.status);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      /*
       * Sign-off fields first, then the transition. Status is a governed field
       * since P0.3 and no longer travels with ordinary column updates; saving
       * the reviewer and approver before moving the report also means the
       * stage conditions see the values this save is recording, rather than
       * the ones it is replacing.
       */
      await monthlyReportService.update(report.id, { reviewedByContactId: reviewedBy, approvedByContactId: approvedBy });
      if (status !== report.status) {
        await monthlyReportService.changeStatus(report.id, status);
      }
      await reload();
      toast.success("Approval data saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save approval data.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspacePanel
      title="Approval"
      hint="Responsibility resolves from project assignments; override here when a different person signs."
      action={
        <Button onClick={save} disabled={saving}>
          <Check />
          {saving ? "Saving…" : "Save Approval"}
        </Button>
      }
    >
      <div className="monthly-ws-grid">
        <label>
          Reviewed By
          <select value={reviewedBy} onChange={(event) => setReviewedBy(event.target.value)}>
            <option value="">Not recorded</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Approved By
          <select value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)}>
            <option value="">Not recorded</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Report Status
          <select value={status} onChange={(event) => setStatus(event.target.value as MonthlyReport["status"])}>
            {Object.entries(REPORT_STATUS_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="monthly-ws-note">
        Prepared By is set in Monthly Overview. A slot left as “Not recorded” prints blank for wet signature.
      </p>
    </WorkspacePanel>
  );
}

/* -------------------------------- Workspace -------------------------------- */

export function MonthlyWorkspaceView({
  reportId,
  projectId,
}: {
  reportId: string;
  /**
   * When set, this view's own actions stay under
   * `/projects/[projectId]/...`. A plain string, not a links object — see
   * `MonthlyReportView` for why.
   */
  projectId?: string;
}) {
  const links = projectId
    ? buildProjectMonthlyLinks(projectId)
    : GLOBAL_MONTHLY_LINKS;
  const { bundle, reload } = useMonthlyBundle(reportId);
  const [panel, setPanel] = React.useState<PanelKey>("overview");

  if (bundle === undefined) return <LoadingState label="Loading Monthly Workspace…" />;
  if (bundle === null) {
    return <EmptyState title="Monthly Report not found" description="This report is unavailable or you do not have access to it." icon={Plus} />;
  }

  const active = PANELS.find((item) => item.key === panel) ?? PANELS[0];

  return (
    <div className="monthly-workspace">
      <div className="monthly-ws-header">
        <div>
          <p className="monthly-eyebrow">Monthly Workspace</p>
          <h1>
            {bundle.project?.name ?? NOT_RECORDED} — {getMonthLabel(bundle.report.reportingMonth)}
          </h1>
          <span>
            {bundle.report.reportNumber} · <StatusBadge tone={monthEndStatus(bundle.report).tone}>{monthEndStatus(bundle.report).label}</StatusBadge>
          </span>
        </div>
        <div className="monthly-ws-header-actions">
          <Button asChild variant="outline">
            <Link href={links.detail(bundle.report.id)}>
              <Eye />
              View Report
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={links.preview(bundle.report.id)}>Print Preview</Link>
          </Button>
        </div>
      </div>

      <nav className="monthly-ws-nav" aria-label="Workspace sections">
        {PANELS.map((item) => (
          <button key={item.key} type="button" className={item.key === panel ? "active" : ""} onClick={() => setPanel(item.key)}>
            {item.label}
          </button>
        ))}
      </nav>

      <p className="monthly-ws-hint">{active.hint}</p>

      {panel === "overview" && <OverviewPanel bundle={bundle} reload={reload} />}
      {panel === "weekly" && (
        <WeeklyPanel bundle={bundle} reload={reload} links={links} />
      )}
      {panel === "milestones" && <MilestonesPanel bundle={bundle} />}
      {panel === "comments" && <CommentsPanel bundle={bundle} reload={reload} />}
      {panel === "management" && <MonthlyManagementPanel bundle={bundle} reload={reload} />}
      {panel === "plan" && <PlanPanel bundle={bundle} reload={reload} />}
      {panel === "summary" && <SummaryPanel bundle={bundle} reload={reload} />}
      {panel === "approval" && <ApprovalPanel bundle={bundle} reload={reload} />}
    </div>
  );
}
