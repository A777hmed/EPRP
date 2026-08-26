"use client";

/**
 * The Monthly Progress Report as a document.
 *
 * Read-only by construction: it renders the bundle it is handed and owns no
 * mutation. Authoring lives in the Workspace, which composes the same bundle —
 * so what an author edits and what leadership prints cannot drift apart.
 *
 * The same markup serves screen and A4 print. Print rules live in globals.css
 * under `@media print`; the classes here carry the page-break intent.
 */

import * as React from "react";
import Image from "next/image";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";

import { StatusBadge } from "@/components/shared";
import { KPI_RATING_META, MILESTONE_STATUS_META, PRIORITY_META } from "@/lib/constants";
import { getMonthLabel } from "@/lib/reporting";
import { siteConfig } from "@/config/site";
import type { HierarchyTerms } from "@/config/project-terminology";
import type { MilestoneState } from "@/features/projects/milestone-state";
import type {
  Client,
  Contact,
  MonthlyComment,
  MonthlyDepartmentSummary,
  MonthlyPlanItem,
  MonthlyReport,
  Project,
  WeeklyReport,
} from "@/types";
import { MonthlyAnalytics } from "./monthly-analytics";
import { buildAnalyticsPanels } from "./monthly-analytics-model";
import { MONTHLY_UPDATE_TYPE_OPTIONS } from "./monthly-comment-form";
import {
  NOT_RECORDED,
  buildScopeStatusRows,
  commentStatusMeta,
  contactLine,
  monthEndStatus,
  nameOf,
  nextMonthLabel,
  resolveApprovers,
  weekStatus,
  type NamedRecord,
  type ScopeStatusRow,
  type WeeklySubmissionInMonth,
} from "./monthly-data";

const typeLabels = Object.fromEntries(MONTHLY_UPDATE_TYPE_OPTIONS) as Record<MonthlyComment["updateType"], string>;

/** Everything the document needs, resolved once by the caller. */
export interface MonthlyReportBundle {
  report: MonthlyReport;
  project: Project | null;
  client?: Client;
  comments: MonthlyComment[];
  weeklies: WeeklyReport[];
  submissions: WeeklySubmissionInMonth[];
  summaries: MonthlyDepartmentSummary[];
  plans: MonthlyPlanItem[];
  /** Governed Master Milestone current state, read-only — see `milestone-state.ts`. */
  milestoneStates: MilestoneState[];
  departments: NamedRecord[];
  systems: NamedRecord[];
  disciplines: NamedRecord[];
  contacts: Contact[];
  terms: HierarchyTerms;
}

/* -------------------------------- Primitives ------------------------------- */

export function ReportSection({
  number,
  title,
  note,
  children,
  className = "",
}: {
  number: number;
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`monthly-section ${className}`.trim()}>
      <div className="monthly-section-title-row">
        <h2>
          <span>
            {number} · {title}
          </span>
        </h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </section>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="monthly-empty-row">{children}</div>;
}

function InfoField({ label, value, badge, detail }: { label: string; value?: string; badge?: React.ReactNode; detail?: string }) {
  return (
    <div className="monthly-info-field">
      <span>{label}</span>
      {badge ?? <b className={value ? "" : "muted"}>{value || NOT_RECORDED}</b>}
      {detail && <small>{detail}</small>}
    </div>
  );
}

/* --------------------------------- Header ---------------------------------- */

const noopSubscribe = () => () => {};

/**
 * The page origin, hydration-safe.
 *
 * A QR code has to encode an absolute URL to be scannable, and the origin only
 * exists in the browser. `useSyncExternalStore` gives the server an empty
 * snapshot and the client the real one without a setState-in-effect cascade.
 */
function useOrigin(): string {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => ""
  );
}

function DocumentHeader({ report, project, client }: { report: MonthlyReport; project: Project | null; client?: Client }) {
  const clientLogo = project?.branding.clientLogoRef ?? client?.logoRef;
  const origin = useOrigin();
  const qrValue = `${origin}/monthly-reports/${report.id}`;

  return (
    <header className="monthly-report-header monthly-print-header">
      <div className="monthly-brand-row">
        {/* Dimensions hold the asset's true 445:120 ratio; CSS sizes it. */}
        <Image src={siteConfig.logo.full} alt="EPROM" width={222} height={60} unoptimized />
        <div className="monthly-header-right">
          {clientLogo ? (
            <Image src={clientLogo} alt={`${client?.name ?? "Client"} logo`} width={150} height={54} unoptimized className="monthly-client-logo" />
          ) : (
            <span className="monthly-client-placeholder">{client?.shortName ?? client?.name ?? NOT_RECORDED}</span>
          )}
          {project?.branding.includeQrCode !== false && (
            <div className="monthly-qr-panel">
              <QRCodeSVG value={qrValue} size={52} level="M" />
              <span>
                Scan to open
                <br />
                this report
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="monthly-title-band">
        <div>
          <p>Monthly Reports</p>
          <h1>Monthly Project Progress Report</h1>
        </div>
        <div className="monthly-document-number">
          <span>Doc. No.</span>
          <b>{report.reportNumber}</b>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------- 1 · Information --------------------------- */

function ReportInformation({ report, project, client, contacts }: MonthlyReportBundle) {
  const preparedBy = contacts.find((contact) => contact.id === report.preparedByContactId);
  const status = monthEndStatus(report);

  return (
    <ReportSection number={1} title="Report Information" note="Derived from project master data and this month's KPIs.">
      <div className="monthly-info-grid">
        <InfoField label="Project" value={project?.name ?? project?.code} />
        <InfoField label="Report No." value={report.reportNumber} />
        <InfoField label="Client" value={client?.shortName ?? client?.name} />
        <InfoField label="Reporting Month" value={getMonthLabel(report.reportingMonth)} />
        <InfoField label="Prepared By" value={contactLine(preparedBy)} />
        <InfoField
          label="Month-End Status"
          badge={
            <span className="monthly-status-value">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </span>
          }
          detail={status.detail}
        />
      </div>
    </ReportSection>
  );
}

/* ---------------------------------- 2 · KPI -------------------------------- */

function KpiSummary({ bundle, scopeRows }: { bundle: MonthlyReportBundle; scopeRows: ScopeStatusRow[] }) {
  const { report, weeklies, comments, departments, terms } = bundle;
  const panels = buildAnalyticsPanels({
    weeklies,
    comments,
    departments,
    scopeRows,
    scopeLabel: terms.plural,
    hseRating: report.hseStatus,
    qualityRating: report.qualityStatus,
  });
  const latestWeekly = weeklies.at(-1);
  // Needs two weeks: with one, the month's opening position is unknown, and a
  // computed "+0.0 pts" would assert a measured zero gain that nothing supports.
  const gained = weeklies.length >= 2 ? report.actualProgress - weeklies[0].actualProgress : undefined;
  const manHours = latestWeekly?.manHoursToDate;

  const kpis: { label: string; value: string; tone: string; recorded: boolean; note?: string }[] = [
    { label: "Planned %", value: `${report.plannedProgress.toFixed(1)}%`, tone: "planned", recorded: true },
    { label: "Actual %", value: `${report.actualProgress.toFixed(1)}%`, tone: "actual", recorded: true },
    {
      label: "Variance (SV)",
      value: `${report.scheduleVariance > 0 ? "+" : ""}${report.scheduleVariance.toFixed(1)}%`,
      tone: "variance",
      recorded: true,
    },
    {
      label: "Progress This Month",
      value: gained === undefined ? "N/A" : `${gained >= 0 ? "+" : "−"}${Math.abs(gained).toFixed(1)} pts`,
      tone: "progress",
      recorded: gained !== undefined,
      note: gained === undefined ? "Needs two reporting weeks" : undefined,
    },
    {
      label: "Man-Hours To Date",
      value: manHours ? manHours.toLocaleString() : "N/A",
      tone: "hours",
      recorded: Boolean(manHours),
      // Weekly stores `man_hours_to_date` only. There is no planned/budget
      // man-hour column anywhere, so an "actual / planned" pair is not
      // available without inventing the denominator.
      note: manHours ? "Actual to date · no planned budget stored" : undefined,
    },
  ];

  return (
    <ReportSection number={2} title="Month-End KPI Summary" note="Cumulative position compiled from this month's Weekly Reports.">
      <div className="monthly-kpi-row">
        {kpis.map((kpi) => (
          <div className={`monthly-kpi ${kpi.tone}${kpi.recorded ? "" : " unavailable"}`} key={kpi.label}>
            <span>{kpi.label}</span>
            <b>{kpi.value}</b>
            {kpi.note && <small>{kpi.note}</small>}
          </div>
        ))}
      </div>
      <MonthlyAnalytics panels={panels} />
    </ReportSection>
  );
}

/* ---------------------------- 3 · Weekly breakdown ------------------------- */

function WeeklyBreakdown({ weeklies }: MonthlyReportBundle) {
  return (
    <ReportSection number={3} title="Weekly Breakdown" note="Every eligible Weekly Report in this reporting month.">
      {weeklies.length ? (
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
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {weeklies.map((weekly) => {
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
                    <td className="drive-cell">{weekly.attachmentIds.length ? `${weekly.attachmentIds.length} file(s)` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRow>No Weekly Reports fall within this reporting month.</EmptyRow>
      )}
    </ReportSection>
  );
}

/* -------------------------- 4 · Programmes / Disciplines ------------------- */

function ScopeStatus({ bundle, rows }: { bundle: MonthlyReportBundle; rows: ScopeStatusRow[] }) {
  const { terms } = bundle;

  return (
    <ReportSection number={4} title={`${terms.plural} Status`} note="Latest reported position per scope item.">
      {rows.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table monthly-table-scope">
            <thead>
              <tr>
                <th>{terms.singular}</th>
                <th>System</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Latest Update</th>
                <th>Responsible</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <b>{row.scopeName}</b>
                    <small>{row.departmentName}</small>
                  </td>
                  <td>{row.systemName ?? "—"}</td>
                  <td>{row.status ? <StatusBadge tone={row.status.tone}>{row.status.label}</StatusBadge> : <span className="muted">—</span>}</td>
                  <td className="actual-value">
                    {typeof row.progressPercent === "number" ? `${row.progressPercent.toFixed(1)}%` : <span className="muted">—</span>}
                  </td>
                  <td>{row.latestUpdate ?? <span className="muted">{NOT_RECORDED}</span>}</td>
                  <td>{row.responsibleName ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRow>No {terms.plural.toLowerCase()} have been reported against this month.</EmptyRow>
      )}
    </ReportSection>
  );
}

/* ----------------------- 5 · Master Milestone progress ---------------------- */

/**
 * Governed Master Milestones, read-only.
 *
 * Reads the same frozen state Weekly's Project Control Plan reads —
 * `milestoneStates`, derived by `milestone-state.ts` from the governed
 * register — and writes nothing. Monthly has no observation path of its own;
 * this section exists only to show, on the compiled document, the official
 * position the governed source already holds.
 */
function MasterMilestoneProgress({ milestoneStates }: MonthlyReportBundle) {
  return (
    <ReportSection number={5} title="Master Milestone Progress" note="Governed position, as approved by Project Control.">
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
    </ReportSection>
  );
}

/* --------------------------- 6 · Client action items ----------------------- */

function ClientActionItems(bundle: MonthlyReportBundle) {
  const { comments, contacts, client } = bundle;
  const actions = comments.filter((comment) => comment.includeInFinal && comment.updateType === "action");
  const title = client?.shortName || client?.name ? `Client Action Items — ${client.shortName ?? client.name}` : "Client Action Items";

  return (
    <ReportSection number={6} title={title} note="Items awaiting client decision or approval.">
      {actions.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table monthly-table-actions">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Action Required</th>
                <th>Responsible Party</th>
                <th>Due Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((comment) => {
                const status = commentStatusMeta(comment.status);
                return (
                  <tr key={comment.id}>
                    <td>
                      <b>{comment.weekNumber ? `W${comment.weekNumber}` : "Monthly"}</b>
                    </td>
                    <td>
                      <span className="monthly-pill">{typeLabels[comment.updateType]}</span>
                    </td>
                    <td>{comment.presentationText || comment.originalText}</td>
                    <td>{nameOf(comment.responsibleContactId, contacts, "—")}</td>
                    <td>{comment.targetDate ? format(new Date(comment.targetDate), "dd MMM yyyy") : "—"}</td>
                    <td>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRow>No client action items are recorded for this month.</EmptyRow>
      )}
    </ReportSection>
  );
}

/* ------------------------- 7 · Key highlights & issues --------------------- */

const HIGHLIGHT_EXCLUDED = new Set<MonthlyComment["updateType"]>(["action", "next_month_plan"]);

function KeyHighlights({ comments }: MonthlyReportBundle) {
  const items = comments.filter((comment) => comment.includeInFinal && !HIGHLIGHT_EXCLUDED.has(comment.updateType));

  return (
    <ReportSection number={7} title="Key Highlights & Issues" note="Weekly items selected for Monthly, plus Monthly-only entries.">
      {items.length ? (
        <div className="monthly-highlight-list">
          {items.map((comment) => (
            <div className="monthly-highlight-row" key={comment.id}>
              <b>{comment.weekNumber ? `W${comment.weekNumber}` : "MTH"}</b>
              <span className="monthly-pill">{typeLabels[comment.updateType]}</span>
              <span className="monthly-highlight-text">{comment.presentationText || comment.originalText}</span>
              <StatusBadge tone={PRIORITY_META[comment.priority].tone}>{PRIORITY_META[comment.priority].label}</StatusBadge>
            </div>
          ))}
        </div>
      ) : (
        <EmptyRow>No highlights or issues have been selected for this month.</EmptyRow>
      )}
    </ReportSection>
  );
}

/* --------------------------- 8 · Next month outlook ------------------------ */

function NextMonthOutlook({ report, plans, comments, contacts, departments }: MonthlyReportBundle) {
  const focus = comments.filter((comment) => comment.includeInFinal && comment.updateType === "next_month_plan");

  return (
    <ReportSection
      number={8}
      title={`Next Month Outlook — ${nextMonthLabel(report.reportingMonth)}`}
      note="Recorded Monthly plan items and focus narrative."
    >
      <div className="monthly-outlook-grid">
        <div className="monthly-outlook-panel">
          <div className="monthly-mini-heading">
            <span>Plan Items</span>
          </div>
          {plans.length ? (
            <div className="monthly-milestones">
              {plans.map((plan) => (
                <div className="monthly-milestone" key={plan.id}>
                  <b>{plan.targetDate ? format(new Date(plan.targetDate), "dd MMM") : "—"}</b>
                  <span>
                    {plan.title}
                    {plan.remarks && <small className="monthly-milestone-remark">{plan.remarks}</small>}
                  </span>
                  <small>{plan.ownerContactId ? nameOf(plan.ownerContactId, contacts) : nameOf(plan.departmentId, departments, "—")}</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyRow>No Next Month plan items have been recorded.</EmptyRow>
          )}
        </div>
        <div className="monthly-outlook-panel">
          <div className="monthly-mini-heading">
            <span>Focus &amp; Targets</span>
            <small>Planned % target: not stored in the Monthly data model</small>
          </div>
          {focus.length ? (
            <div className="monthly-focus-copy">
              {focus.map((comment) => (
                <p key={comment.id}>{comment.presentationText || comment.originalText}</p>
              ))}
            </div>
          ) : (
            <EmptyRow>No next-month focus or target has been recorded.</EmptyRow>
          )}
        </div>
      </div>
    </ReportSection>
  );
}

/* --------------------------- 9 · Executive summary ------------------------- */

function ExecutiveSummary({ report }: MonthlyReportBundle) {
  return (
    <ReportSection number={9} title="Executive Summary" note="Management narrative for the reporting month.">
      {report.executiveSummary?.trim() ? (
        <div className="monthly-executive-summary">{report.executiveSummary}</div>
      ) : (
        <EmptyRow>No executive summary has been recorded for this month.</EmptyRow>
      )}
    </ReportSection>
  );
}

/* --------------------------------- Approval -------------------------------- */

/**
 * Lifecycle presentation. The labels are the ones leadership expects to read;
 * each maps onto real `ReportStatus` values — the platform has no "published"
 * status, so Published means finalized, locked, or archived.
 */
const APPROVAL_STAGES: { key: string; label: string; statuses: MonthlyReport["status"][] }[] = [
  {
    key: "draft",
    label: "Draft",
    statuses: ["draft", "collecting", "submitted", "under_review", "approved", "finalized", "locked", "archived"],
  },
  { key: "approved", label: "Reviewed / Approved", statuses: ["approved", "finalized", "locked", "archived"] },
  { key: "published", label: "Published", statuses: ["finalized", "locked", "archived"] },
];

function ApprovalBlock({ report, project, contacts }: MonthlyReportBundle) {
  const approvers = resolveApprovers(report, project);
  const blocks: { label: string; contactId?: string }[] = [
    { label: "Prepared By", contactId: approvers.preparedByContactId },
    { label: "Reviewed By", contactId: approvers.reviewedByContactId },
    { label: "Approved By", contactId: approvers.approvedByContactId },
  ];

  return (
    <section className="monthly-section monthly-approval-section">
      <div className="monthly-approval-strip">
        <b>Approval</b>
        {APPROVAL_STAGES.map((stage, index) => {
          const reached = stage.statuses.includes(report.status);
          return (
            <React.Fragment key={stage.key}>
              {index > 0 && <i aria-hidden>›</i>}
              <span className={reached ? "reached" : ""}>{stage.label}</span>
            </React.Fragment>
          );
        })}
      </div>
      <div className="monthly-signoff-grid">
        {blocks.map((block) => {
          const contact = contacts.find((record) => record.id === block.contactId);
          return (
            <div className="monthly-signoff" key={block.label}>
              <b>{block.label}</b>
              <span className={contact ? "" : "muted"}>{contact?.name ?? NOT_RECORDED}</span>
              {contact?.position && <em>{contact.position}</em>}
              <small>Signature __________________</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------- Document -------------------------------- */

export function MonthlyReportDocument(bundle: MonthlyReportBundle) {
  const { report, project, client } = bundle;
  const footerText = project?.branding.reportFooterText?.trim() || "One Team. One Goal. Operational Excellence.";

  // Built once: section 4 tabulates these rows and the analytics panel charts
  // them, and the two must never disagree about what was reported.
  const scopeRows = buildScopeStatusRows({
    comments: bundle.comments,
    summaries: bundle.summaries,
    submissions: bundle.submissions,
    departments: bundle.departments,
    systems: bundle.systems,
    disciplines: bundle.disciplines,
    contacts: bundle.contacts,
  });

  return (
    <article className="monthly-report-sheet monthly-print-document">
      <DocumentHeader report={report} project={project} client={client} />
      <div className="monthly-report-body">
        <ReportInformation {...bundle} />
        <KpiSummary bundle={bundle} scopeRows={scopeRows} />
        <WeeklyBreakdown {...bundle} />
        <ScopeStatus bundle={bundle} rows={scopeRows} />
        <MasterMilestoneProgress {...bundle} />
        <ClientActionItems {...bundle} />
        <KeyHighlights {...bundle} />
        <NextMonthOutlook {...bundle} />
        <ExecutiveSummary {...bundle} />
        <ApprovalBlock {...bundle} />
      </div>
      <footer className="monthly-report-footer">
        <b>{footerText}</b>
        <span>www.eprom.com.eg</span>
        <span>{getMonthLabel(report.reportingMonth)}</span>
      </footer>
    </article>
  );
}

/** Exported for the Workspace, which reuses the KPI ratings wording. */
export function kpiRatingLabel(rating: MonthlyReport["hseStatus"]): string {
  return rating ? KPI_RATING_META[rating].label : NOT_RECORDED;
}
