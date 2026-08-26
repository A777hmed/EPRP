"use client";

/**
 * The Project Portfolio Executive Report as a document.
 *
 * Read-only by construction: it renders the view model it is handed and owns no
 * mutation. The Executive tier selects and presents; authoring belongs to
 * Project Control at the Monthly tier (`05_PERMISSION_MODEL.md` §2).
 *
 * ONE structure serves screen and A4. The section order, card composition and
 * chart positions are identical in both; only the drawing surface inside a
 * chart card swaps (interactive on screen, static SVG on paper) and the
 * interactive furniture is removed. Print rules live in `globals.css`.
 *
 * The document deliberately reuses the Monthly report's document CSS contract —
 * `monthly-report-sheet` / `monthly-print-document` and the section, table and
 * analytics classes beneath them. That class set IS the platform's A4 document
 * contract: page-break policy, repeated table headers, the screen/print chart
 * swap and colour-adjust. Opting into it keeps the two reports visually
 * identical and avoids duplicating ~180 lines of print CSS. Renaming it to
 * something neutral would mean editing Monthly files, which this phase forbids.
 */

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { format, parseISO } from "date-fns";

import { StatusBadge } from "@/components/shared";
import { siteConfig } from "@/config/site";
import { ExecutiveAnalytics } from "./executive-analytics";
import type { ExecPanel } from "./executive-panels";
import { ExecutiveAiPanel } from "./executive-ai-panel";
import { ExecutiveNotesPanel } from "./executive-notes-panel";
import type { ExecutiveNote, NotesAvailability } from "./executive-notes";
import { MILESTONE_STATUS_META } from "@/lib/constants";
import {
  MONTHLY_BASIS_META,
  NOT_REPORTED,
  NO_MOVEMENT,
  bySeverity,
  upcomingMilestones,
  type AttentionItem,
  type MilestoneRow,
  type PortfolioAggregate,
  type PreparedBy,
  type ProjectExecutiveRow,
} from "./executive-data";
import {
  SIGNATORY_ROLES,
  SIGNATORY_ROLE_LABEL,
  type ResolvedSignatories,
  type SignatoryRole,
} from "./executive-signatories";

/** Everything the document renders, resolved once by the caller. */
export interface ExecutiveDocumentModel {
  month: string;
  monthLabel: string;
  rows: ProjectExecutiveRow[];
  aggregate: PortfolioAggregate;
  narrative: string;
  panels: ExecPanel[];
  milestones: MilestoneRow[];
  lastUpdated?: string;
  today: string;
  /** Coverage note for the freshness layer. */
  movementWeekLimit: number;
  /* Executive Notes — the only authored content in this report. */
  notes: ExecutiveNote[];
  notesAvailability: NotesAvailability;
  canManageNotes: boolean;
  onNotesChanged: () => Promise<void> | void;
  /**
   * Prepared By, resolved from PROJECT RESPONSIBILITY — never from the account
   * that happens to be viewing. See `resolvePreparedBy()`.
   */
  preparedBy: PreparedBy;
  /**
   * The three sign-off roles as they should PRINT.
   *
   * Saved names come from the report's own snapshot, so a report that was
   * approved months ago keeps the names and job titles it was approved with.
   */
  signatories: ResolvedSignatories;
  /** A reviewed AI draft the user accepted this session. Never persisted. */
  acceptedSummary?: string;
  /** Absent on the print stage, which offers no authoring controls. */
  onAcceptSummary?: (text: string) => void;
}

/* -------------------------------- Primitives ------------------------------- */

/**
 * Section shell and empty row.
 *
 * Declared here rather than imported from `monthly-report-document`: that
 * module builds a module-scope lookup from a `"use client"` export, so pulling
 * it in makes the Executive tree fragile to the server/client boundary for the
 * sake of twenty lines. The CSS classes are the shared ones, so the two reports
 * still render identically.
 */
function ReportSection({
  number,
  title,
  note,
  children,
}: {
  number: number;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="monthly-section">
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

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="monthly-empty-row">{children}</div>;
}

function pct(value: number | undefined, digits = 1): string {
  return value === undefined ? NOT_REPORTED : `${value.toFixed(digits)}%`;
}

function signed(value: number | undefined): string {
  if (value === undefined) return NOT_REPORTED;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function shortDate(value: string | undefined): string {
  if (!value) return "—";
  return format(parseISO(value), "dd MMM yyyy");
}

/** The Open Actions figure navigates straight to that project's Actions tab. */
function actionsHref(row: ProjectExecutiveRow, month: string): string {
  return `/executive-reports/projects/${row.project.id}?month=${month}&tab=actions`;
}

/* --------------------------------- Header ---------------------------------- */

/**
 * The masthead.
 *
 * No client logo: a portfolio spans clients, and showing one project's client
 * would misrepresent the document. No QR code either — `03` §19.1 requires a QR
 * to resolve to a specific report AND revision, and this increment persists no
 * Executive record, so there is no revision for it to point at. A QR onto a
 * live view would promise traceability the platform cannot honour.
 */
function DocumentHeader({ model }: { model: ExecutiveDocumentModel }) {
  return (
    <header className="monthly-report-header monthly-print-header">
      <div className="monthly-brand-row">
        <Image src={siteConfig.logo.full} alt="EPROM" width={222} height={60} unoptimized />
        <div className="exec-header-meta">
          <div>
            <span>Reporting Period</span>
            <b>{model.monthLabel}</b>
          </div>
          <div>
            <span>Last Updated</span>
            <b>{model.lastUpdated ? shortDate(model.lastUpdated.slice(0, 10)) : NOT_REPORTED}</b>
          </div>
          <div>
            <span>Generated</span>
            <b>{shortDate(model.today)}</b>
          </div>
        </div>
      </div>
      <div className="monthly-title-band">
        <div>
          <p>Executive Reporting</p>
          <h1>Project Portfolio Executive Report</h1>
        </div>
        <div className="exec-title-note">
          <span>Basis</span>
          <b>Approved Monthly Reports</b>
        </div>
      </div>
      {/*
        `03` §17.2: an output that is not generated from an approved snapshot
        must be unmistakably marked, as part of the document rather than as a
        covering note. Nothing here is snapshotted, numbered or approved.
      */}
      <div className="exec-provenance-band">
        <b>Live derived view</b>
        <span>
          Composed from approved Monthly Reports at the moment of viewing. Not a snapshotted, numbered or approved
          controlled document — Executive persistence is not yet implemented.
        </span>
      </div>
    </header>
  );
}

/* ---------------------------- 1 · Executive summary ------------------------ */

function ExecutiveSummarySection({ model }: { model: ExecutiveDocumentModel }) {
  // An accepted AI draft replaces the auto-drafted narrative for this session.
  // It is NOT stored — no Executive record exists to store it in — so the note
  // below says so rather than letting a reader assume it was saved.
  const text = model.acceptedSummary ?? model.narrative;

  return (
    <ReportSection
      number={1}
      title="Executive Summary"
      note={model.acceptedSummary ? "Executive-authored wording" : "Auto-drafted from approved portfolio data."}
    >
      {text ? (
        <div className="monthly-executive-summary">{text}</div>
      ) : (
        <EmptyRow>No portfolio data is available to summarise for this reporting period.</EmptyRow>
      )}
      {model.onAcceptSummary && (
        <ExecutiveAiPanel model={model} currentText={text} onAccept={model.onAcceptSummary} />
      )}
    </ReportSection>
  );
}

/* -------------------------------- 2 · KPIs --------------------------------- */

interface KpiSpec {
  label: string;
  value: string;
  tone?: string;
  recorded: boolean;
  note?: string;
}

function KpiStrip({ model }: { model: ExecutiveDocumentModel }) {
  const { aggregate } = model;
  const noBasis = aggregate.noApprovedBasis;

  const position: KpiSpec[] = [
    /*
     * "Projects in View" leads, not "Active".
     *
     * A portfolio of one lifecycle-completed project rendered "Total Active
     * Projects 0" beside a full report, which reads as an error. The count of
     * what the reader is actually looking at is the primary figure; the active
     * subset is a separate, explicitly labelled measure below it. The two are
     * different concepts and are no longer presented as one.
     */
    {
      label: "Projects in View",
      value: String(aggregate.totalProjects),
      recorded: true,
      note: `${aggregate.activeProjects} active · lifecycle status`,
    },
    {
      label: "Portfolio Planned %",
      value: noBasis ? "No approved basis" : pct(aggregate.planned),
      tone: "planned",
      recorded: !noBasis,
    },
    {
      label: "Portfolio Actual %",
      value: noBasis ? "No approved basis" : pct(aggregate.actual),
      tone: "actual",
      recorded: !noBasis,
    },
    {
      label: "Portfolio Variance",
      value: noBasis ? "No approved basis" : signed(aggregate.variance),
      tone: "variance",
      recorded: !noBasis,
    },
  ];

  // Health counts read every project in view, approved or not — a project's
  // health is a fact about the project, not a portfolio total. The labels below
  // say "projects", never "approved", so the two can never be confused.
  const health: KpiSpec[] = [
    {
      label: "Active Lifecycle Projects",
      value: String(aggregate.activeProjects),
      recorded: true,
      note: "Project master status",
    },
    { label: "On Track", value: String(aggregate.health.on_track), recorded: true },
    { label: "At Risk", value: String(aggregate.health.at_risk), recorded: true },
    {
      label: "Delayed / Critical",
      value: String(aggregate.health.delayed + aggregate.health.critical),
      recorded: true,
    },
    { label: "Not Reported", value: String(aggregate.health.unknown), recorded: true },
    { label: "Open Executive Decisions", value: String(aggregate.openDecisions), recorded: true },
    { label: "Client Pending Actions", value: String(aggregate.clientPendingActions), recorded: true },
  ];

  return (
    <ReportSection
      number={2}
      title="Portfolio Position"
      note={aggregate.basisNote}
    >
      {/*
        ONE compact notice. The Executive Summary already carries the caveat in
        full sentences; repeating the same paragraph here made the same fact
        appear three times on one screen and buried the figures under it.
      */}
      {noBasis && (
        <div className="exec-basis-warning">
          <b>Provisional figures</b>
          <span>Awaiting an approved Monthly Report for this period.</span>
        </div>
      )}

      <div className="exec-kpi-row exec-kpi-position">
        {position.map((kpi) => (
          <Tile key={kpi.label} kpi={kpi} />
        ))}
      </div>
      <div className="exec-kpi-row exec-kpi-health">
        {health.map((kpi) => (
          <Tile key={kpi.label} kpi={kpi} />
        ))}
      </div>
      <p className="exec-kpi-legend">
        <b>Schedule Health</b> = reported performance against plan · <b>Lifecycle Status</b> = project master status.
      </p>
    </ReportSection>
  );
}

function Tile({ kpi }: { kpi: KpiSpec }) {
  return (
    <div className={`monthly-kpi ${kpi.tone ?? ""}${kpi.recorded ? "" : " unavailable"}`.trim()}>
      <span>{kpi.label}</span>
      <b>{kpi.value}</b>
      {kpi.note && <small>{kpi.note}</small>}
    </div>
  );
}

/* --------------------- 3 · Project Status Overview ------------------------- */

function MovementCell({ row }: { row: ProjectExecutiveRow }) {
  if (row.movement.length === 0) {
    return <p className="exec-movement-none">{NO_MOVEMENT}</p>;
  }
  return (
    <div className="exec-movement-list">
      {row.movement.slice(0, 2).map((item) => (
        <span className="exec-movement" key={item.id}>
          <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
          <small>
            {item.weekNumber ? `W${item.weekNumber} · ` : ""}
            {item.text}
          </small>
        </span>
      ))}
      {row.movement.length > 2 && <small className="exec-more">+{row.movement.length - 2} more</small>}
    </div>
  );
}

function ProjectStatusTable({ model }: { model: ExecutiveDocumentModel }) {
  const { rows } = model;

  return (
    <ReportSection
      number={3}
      title="Project Status Overview"
      note="Ordered by attention required. Every row states the Monthly it speaks from."
    >
      {rows.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table exec-status-table">
            <thead>
              {/*
                EIGHT columns, not eleven.

                Key Concern and Latest Movement are narrative, and forcing them
                into the same row as the figures is what produced every wrapping
                and collision problem in this table. They move to a subordinate
                second row per project — the same structure on screen and on
                paper — so each column can be sized for what it actually holds.
              */}
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>SV</th>
                <th>Schedule Health</th>
                <th>Open Actions</th>
                <th>Next / Due Plan Item</th>
                <th className="exec-actions-col">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const basis = MONTHLY_BASIS_META[row.basis];
                return (
                  <React.Fragment key={row.project.id}>
                  <tr className="exec-row-primary">
                    <td>
                      <b>{row.projectName}</b>
                      <small>{row.project.code}</small>
                      {/* One badge only. The lifecycle word ("Draft") used to be
                          printed beside "Draft / Not Approved", which said the
                          same thing twice in two vocabularies. */}
                      <span className="exec-basis-chip">
                        <StatusBadge tone={basis.tone}>{basis.label}</StatusBadge>
                      </span>
                    </td>
                    <td>{row.clientName}</td>
                    <td className="planned-value">{pct(row.planned)}</td>
                    <td className="actual-value">{pct(row.actual)}</td>
                    <td className="variance-value">{signed(row.variance)}</td>
                    <td>
                      <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge>
                    </td>
                    <td className="exec-numeric">
                      <Link className="exec-count-link" href={actionsHref(row, model.month)}>
                        {row.openActions.total}
                      </Link>
                      {row.openActions.overdue > 0 && (
                        <small className="exec-overdue">{row.openActions.overdue} Overdue</small>
                      )}
                    </td>
                    <td>
                      {row.nextMilestone ? (
                        <>
                          {row.nextMilestone.title}
                          <small className={row.nextMilestoneOverdue ? "exec-overdue" : undefined}>
                            {shortDate(row.nextMilestone.date)} ·{" "}
                            {row.nextMilestoneOverdue ? "Overdue" : "Upcoming"}
                          </small>
                        </>
                      ) : (
                        <span className="muted">Not recorded</span>
                      )}
                    </td>
                    <td className="exec-actions-col">
                      {/* Carry the selected period through, so the drill-down
                          opens on the month the reader was looking at rather
                          than silently jumping to the project's newest. */}
                      <Link
                        className="monthly-link"
                        href={`/executive-reports/projects/${row.project.id}?month=${model.month}`}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>

                  {/* Subordinate narrative row, tied to the project above it. */}
                  <tr className="exec-row-secondary">
                    <td colSpan={9}>
                      {/*
                        Label above content, not beside it. A 96px label column
                        left the concern text starting at a different x for every
                        row once labels wrapped, which read as misalignment.
                      */}
                      <div className="exec-secondary-grid">
                        <div className="exec-detail">
                          <b>Key Concern</b>
                          {row.keyConcern ? (
                            <>
                              <p>{row.keyConcern.text}</p>
                              <span className="exec-detail-chips">
                                <StatusBadge tone={row.keyConcern.priorityTone}>
                                  {row.keyConcern.priorityLabel}
                                </StatusBadge>
                                <StatusBadge tone={row.keyConcern.statusTone}>
                                  {row.keyConcern.statusLabel}
                                </StatusBadge>
                              </span>
                            </>
                          ) : (
                            <p className="muted">No key concern reported</p>
                          )}
                          {/*
                            Decisions are deliberately NOT repeated here.
                            Section 4 carries Decisions Required at portfolio
                            level and the project snapshot carries it per
                            project; printing it a third time directly beneath
                            the table put the same sentence in two adjacent
                            sections.
                          */}
                        </div>
                        <div className="exec-detail">
                          <b>Latest Movement</b>
                          <MovementCell row={row} />
                        </div>
                      </div>
                    </td>
                  </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRow>No projects are available for this reporting period.</EmptyRow>
      )}
    </ReportSection>
  );
}

/* ----------------------- 4 · Management attention -------------------------- */

function AttentionList({
  title,
  items,
  emptyText,
  showDue = false,
}: {
  title: string;
  items: AttentionItem[];
  emptyText: string;
  showDue?: boolean;
}) {
  return (
    <div className="exec-attention-panel">
      <div className="monthly-mini-heading">
        <span>{title}</span>
        {items.length > 0 && <small>{items.length}</small>}
      </div>
      {items.length ? (
        <ul className="exec-attention-list">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>
              <span className="exec-attention-text">{item.text}</span>
              <span className="exec-attention-meta">
                <StatusBadge tone={item.priorityTone}>{item.priorityLabel}</StatusBadge>
                <b>{item.projectName}</b>
                {showDue && item.dueDate && (
                  <em className={item.overdue ? "exec-overdue" : ""}>
                    {item.overdue ? "Overdue " : "Due "}
                    {shortDate(item.dueDate)}
                  </em>
                )}
                {item.ownerName && <em>{item.ownerName}</em>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyRow>{emptyText}</EmptyRow>
      )}
    </div>
  );
}

function ManagementAttention({ model }: { model: ExecutiveDocumentModel }) {
  const { rows } = model;

  const risks = rows.flatMap((row) => row.risks).sort(bySeverity);
  const decisions = rows.flatMap((row) => row.decisions).sort(bySeverity);
  const clientActions = rows.flatMap((row) => row.clientActions).sort(bySeverity);
  const overdue = rows.flatMap((row) => row.overdue).sort(bySeverity);
  const struggling = rows.filter(
    (row) => row.reading.health === "delayed" || row.reading.health === "critical"
  );

  return (
    <ReportSection number={4} title="Management Attention" note="Ranked by severity, then by due date.">
      <div className="exec-attention-grid">
        <AttentionList title="Top Risks" items={risks} emptyText="No open risks recorded." />

        <div className="exec-attention-panel">
          <div className="monthly-mini-heading">
            <span>Delayed / Critical Projects</span>
            {struggling.length > 0 && <small>{struggling.length}</small>}
          </div>
          {struggling.length ? (
            <ul className="exec-attention-list">
              {struggling.map((row) => (
                <li key={row.project.id}>
                  <span className="exec-attention-text">{row.projectName}</span>
                  <span className="exec-attention-meta">
                    <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge>
                    <b>{signed(row.variance)}</b>
                    <em>{row.reading.basis}</em>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyRow>No project is reported delayed or critical.</EmptyRow>
          )}
        </div>

        <AttentionList title="Decisions Required" items={decisions} emptyText="No decisions awaiting management." showDue />
        <AttentionList title="Client Dependencies" items={clientActions} emptyText="No open client dependencies." showDue />
        <AttentionList title="Overdue Actions" items={overdue} emptyText="No overdue actions." showDue />
      </div>
    </ReportSection>
  );
}

/* ------------------------- 5 · Portfolio analytics ------------------------- */

function PortfolioAnalytics({ model }: { model: ExecutiveDocumentModel }) {
  return (
    <ReportSection
      number={5}
      title="Portfolio Performance Analytics"
      note="Charts collapse to a compact note where the data does not support them."
    >
      <ExecutiveAnalytics panels={model.panels} />
    </ReportSection>
  );
}

/* --------------------------- 6 · Milestones -------------------------------- */

/**
 * Governed Master Milestones, portfolio-wide, read-only.
 *
 * Consumes `row.milestoneStates` — already derived by `milestone-state.ts`,
 * the same frozen logic Weekly, Monthly and the Project Executive drill-down
 * read. This adds no observation, submission, or reconciliation path; it only
 * shows the governed register's official position across the visible
 * projects. Unnumbered and placed directly above the existing free-text
 * "Upcoming Plan Items" section.
 */
function GovernedMilestoneStatus({ model }: { model: ExecutiveDocumentModel }) {
  const rows = model.rows.flatMap((row) =>
    row.milestoneStates.map((state) => ({ row, state }))
  );

  return (
    <section className="monthly-section">
      <div className="monthly-section-title-row">
        <h2>
          <span>Master Milestone Status</span>
        </h2>
        <p>Governed position, as approved by Project Control — across the visible portfolio.</p>
      </div>
      {rows.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table exec-milestone-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Code</th>
                <th>Milestone</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Forecast Date</th>
                <th>Actual Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, state }) => {
                const statusMeta = MILESTONE_STATUS_META[state.status];
                return (
                  <tr key={state.milestone.id}>
                    <td>{row.projectName}</td>
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
                        <span className="muted">Not recorded</span>
                      )}
                    </td>
                    <td>{state.forecastDate ? format(parseISO(state.forecastDate), "dd MMM yyyy") : <span className="muted">—</span>}</td>
                    <td>{state.actualDate ? format(parseISO(state.actualDate), "dd MMM yyyy") : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRow>No active Master Milestones are recorded for the visible projects.</EmptyRow>
      )}
    </section>
  );
}

function MilestoneTimeline({ model }: { model: ExecutiveDocumentModel }) {
  const upcoming = upcomingMilestones(model.milestones, model.today);

  return (
    <ReportSection
      number={6}
      title="Upcoming Plan Items"
      note="Free-text planning entries from Monthly and Weekly plan items — not part of the governed Master Milestone register above."
    >
      {upcoming.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table exec-milestone-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Project</th>
                <th>Plan Item</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((row) => (
                <tr key={row.id}>
                  <td>
                    <b>{row.date ? format(parseISO(row.date), "dd MMM") : "—"}</b>
                    <small>{row.date ? format(parseISO(row.date), "yyyy") : "No date"}</small>
                  </td>
                  <td>{row.projectName}</td>
                  <td>{row.title}</td>
                  <td>{row.ownerName ?? <span className="muted">—</span>}</td>
                  <td>
                    <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>
                  </td>
                  <td>
                    <span className="monthly-pill">{row.sourceLabel}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRow>No dated plan items are recorded ahead of today in Monthly or Weekly plans.</EmptyRow>
      )}
    </ReportSection>
  );
}

/* ------------------------ 7 · Executive snapshots -------------------------- */

function SnapshotCard({ row, month }: { row: ProjectExecutiveRow; month: string }) {
  const basis = MONTHLY_BASIS_META[row.basis];
  const achievement = [...row.achievements].sort(bySeverity)[0];
  const concern = row.keyConcern;
  const decision = row.decisions[0];

  return (
    <article className="exec-snapshot">
      <header>
        <div>
          <b>{row.projectName}</b>
          <small>{row.clientName}</small>
        </div>
        <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge>
      </header>

      <div className="exec-snapshot-basis">
        <StatusBadge tone={basis.tone}>{basis.label}</StatusBadge>
        {row.monthlyStatusLabel && <small>{row.monthlyStatusLabel}</small>}
      </div>

      <div className="exec-snapshot-figures">
        <div>
          <span>Planned</span>
          <b className="planned-value">{pct(row.planned, 0)}</b>
        </div>
        <div>
          <span>Actual</span>
          <b className="actual-value">{pct(row.actual, 0)}</b>
        </div>
        <div>
          <span>Variance</span>
          <b className="variance-value">{signed(row.variance)}</b>
        </div>
      </div>

      {/*
        One concise item per field, each from its OWN source classification, so
        nothing appears twice. Fallbacks say what is true rather than repeating
        a generic "None recorded" everywhere.
      */}
      <dl className="exec-snapshot-lines">
        <div>
          <dt>Major achievement</dt>
          <dd>{achievement?.text ?? <span className="muted">None reported</span>}</dd>
        </div>
        <div>
          <dt>Main concern</dt>
          <dd>
            {concern ? (
              <>
                {concern.text}
                <span className="exec-snapshot-chips">
                  <StatusBadge tone={concern.priorityTone}>{concern.priorityLabel}</StatusBadge>
                  <StatusBadge tone={concern.statusTone}>{concern.statusLabel}</StatusBadge>
                </span>
              </>
            ) : (
              <span className="muted">No key concern reported</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Decision required</dt>
          <dd>{decision?.text ?? <span className="muted">None required</span>}</dd>
        </div>
        <div>
          <dt>Next plan item</dt>
          <dd>
            {row.nextMilestone ? (
              <>
                {row.nextMilestone.title} <small>({shortDate(row.nextMilestone.date)})</small>
              </>
            ) : (
              <span className="muted">No upcoming plan item recorded</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Latest Weekly movement</dt>
          <dd>
            {row.movement.length ? (
              // One line: the drill-down carries the full movement history.
              <span className="exec-snapshot-move">
                <StatusBadge tone={row.movement[0].tone}>{row.movement[0].label}</StatusBadge>
                <small>{row.movement[0].text}</small>
              </span>
            ) : (
              <span className="muted">{NO_MOVEMENT}</span>
            )}
          </dd>
        </div>
      </dl>

      <Link className="exec-snapshot-link" href={`/executive-reports/projects/${row.project.id}?month=${month}`}>
        View Project →
      </Link>
    </article>
  );
}

function SnapshotCards({ model }: { model: ExecutiveDocumentModel }) {
  return (
    <ReportSection
      number={7}
      title="Project Executive Snapshots"
      note="One card per project — a summary, never a reproduction of the Monthly Report."
    >
      {model.rows.length ? (
        <div className="exec-snapshot-grid">
          {model.rows.map((row) => (
            <SnapshotCard key={row.project.id} row={row} month={model.month} />
          ))}
        </div>
      ) : (
        <EmptyRow>No projects to summarise.</EmptyRow>
      )}
    </ReportSection>
  );
}

/* -------------------------- 8 · Executive Notes ---------------------------- */

function ExecutiveNotesSection({ model }: { model: ExecutiveDocumentModel }) {
  return (
    <ReportSection
      number={8}
      title="Executive Notes"
      note="Authored at Executive level. No Weekly or Monthly record is changed."
    >
      <ExecutiveNotesPanel
        notes={model.notes}
        availability={model.notesAvailability}
        canManage={model.canManageNotes}
        onChanged={model.onNotesChanged}
        showProjectColumn
        projectNameOf={(id) => model.rows.find((row) => row.project.id === id)?.projectName ?? "Project"}
        scopeOptions={model.rows.map((row) => ({ id: row.project.id, name: row.projectName }))}
      />
    </ReportSection>
  );
}

/* ------------------- Print-only approval page (page 4) --------------------- */

/**
 * The Executive Approval page.
 *
 * A DELIBERATE final sheet, not a leftover. The signature block was previously
 * whatever fell off the bottom of the last content page, which produced a sheet
 * that was ~85% empty and read as an accident. It now starts its own page by
 * design (`break-before: page`) and is composed to fill it: what is being
 * signed is restated at the top, the three signature columns sit in the optical
 * centre, and the standing footer closes the sheet.
 *
 * NO NAME IS EVER INVENTED.
 *
 * A name prints only if it was SAVED against this report, or — for Prepared By
 * alone — resolved from the project's own Reporting Coordinator. Reviewed and
 * Approved are never guessed: putting somebody's name under an approval they
 * did not give is worse than an empty rule. Unassigned roles print a blank line
 * for completion by hand.
 */
function SignatureColumn({
  role,
  model,
}: {
  role: SignatoryRole;
  model: ExecutiveDocumentModel;
}) {
  const resolved = model.signatories[role];
  const { people } = resolved;
  const placeholder = role === "prepared" ? resolved.placeholder : undefined;

  return (
    <div className={`exec-signoff exec-signoff-${role}`}>
      <b>{SIGNATORY_ROLE_LABEL[role]}</b>

      {people.length ? (
        people.map((person) => (
          <div className="exec-preparer" key={person.id}>
            <span>{person.name}</span>
            <em>{person.title || " "}</em>
            {/* Which projects this person actually prepared, so a multi-project
                report attributes each part correctly. */}
            {role === "prepared" && person.projects?.length ? (
              <i>{person.projects.join(", ")}</i>
            ) : null}
            <small className="exec-sign-rule">Signature</small>
            <small className="exec-sign-rule">Date</small>
          </div>
        ))
      ) : (
        <div className="exec-preparer">
          {/* Name and title rules are drawn so the sheet can be completed by
              hand without anybody having to guess what belongs on each line. */}
          <span className="exec-signoff-blank">{placeholder ?? " "}</span>
          <em className="exec-sign-rule">Name</em>
          <i className="exec-sign-rule">Job Title / Position</i>
          <small className="exec-sign-rule">Signature</small>
          <small className="exec-sign-rule">Date</small>
        </div>
      )}

      {people.length > 0 && placeholder && <i className="exec-preparer-gap">{placeholder}</i>}
    </div>
  );
}

function PrintSignOff({ model }: { model: ExecutiveDocumentModel }) {
  const projectCount = model.rows.length;

  return (
    <section className="exec-signoff-section">
      <div className="monthly-section-title-row">
        <h2>
          <span>Executive Report Sign-off</span>
        </h2>
        <p>{model.monthLabel}</p>
      </div>

      {/*
        What is being signed, restated on the signature sheet.
        A signature page that leaves the report body behind must identify the
        document on its own — a loose final sheet is otherwise unattributable.
        Every field here is already established elsewhere in the model; nothing
        is computed specially for this page.
      */}
      <dl className="exec-signoff-doc">
        <div>
          <dt>Report</dt>
          <dd>Project Portfolio Executive Report</dd>
        </div>
        <div>
          <dt>Reporting Period</dt>
          <dd>{model.monthLabel}</dd>
        </div>
        <div>
          <dt>Projects in Scope</dt>
          <dd>
            {projectCount} {projectCount === 1 ? "project" : "projects"}
          </dd>
        </div>
        <div>
          <dt>Issued</dt>
          <dd>{shortDate(model.today)}</dd>
        </div>
      </dl>

      <div className="exec-signoff-grid">
        {SIGNATORY_ROLES.map((role) => (
          <SignatureColumn key={role} role={role} model={model} />
        ))}
      </div>

      <p className="exec-signoff-note">
        Figures in this report are compiled from approved Monthly Reports and are not altered at Executive
        level. Signing confirms review of the reported position for the period stated above.
      </p>
    </section>
  );
}

/* --------------------------------- Document -------------------------------- */

/*
 * There is deliberately no Approval & Sign-off section ON SCREEN.
 *
 * A live derived view has no report number, no revision and no approval record,
 * so rendering those slots — even marked "Not recorded" — put six empty fields
 * in front of leadership and implied a controlled document that does not exist.
 * The provenance band in the masthead already states what this is.
 *
 * Future support is NOT removed, only unrendered: when `executive_reports`
 * exists and the Executive Report is numbered, revisioned and taken through its
 * approval workflow (`03` §9, §13), the controlled-document block returns here
 * as section 8, populated from real fields. The `.exec-approval-*` styles are
 * retained in `globals.css` for exactly that.
 */

/**
 * Landscape orientation for the printed portfolio.
 *
 * Mounted with the DOCUMENT, not with one route. It previously lived only on
 * the print-preview page, so pressing Ctrl+P on the portfolio page fell back to
 * the global portrait `@page` in `globals.css` — which is why the PDF came out
 * the wrong way round and had to be rotated by hand. Both routes render this
 * component, so both now agree on the page box.
 *
 * `@page` cannot take a selector, so orientation is a document-level fact. That
 * is sound here: wherever this component renders, the Executive document IS the
 * printed sheet. The Weekly, Monthly and drill-down pages never mount it and
 * keep the portrait rule.
 *
 * `height: auto` on html/body stops the viewport-height rules resolving against
 * the page box and claiming an extra sheet.
 */
function ExecutivePrintPage() {
  return (
    <style>{`@media print {
      @page { size: A4 landscape; margin: 9mm 10mm; }
      html, body { height: auto !important; min-height: 0 !important; }
    }`}</style>
  );
}

export function ExecutiveDocument({ model }: { model: ExecutiveDocumentModel }) {
  return (
    <article className="monthly-report-sheet monthly-print-document exec-document">
      <ExecutivePrintPage />
      <DocumentHeader model={model} />
      <div className="monthly-report-body">
        <ExecutiveSummarySection model={model} />
        <KpiStrip model={model} />
        <ProjectStatusTable model={model} />
        <ManagementAttention model={model} />
        <PortfolioAnalytics model={model} />
        <GovernedMilestoneStatus model={model} />
        <MilestoneTimeline model={model} />
        <SnapshotCards model={model} />
        <ExecutiveNotesSection model={model} />
        <PrintSignOff model={model} />
      </div>
      <footer className="monthly-report-footer exec-footer">
        <b>EPROM — Project Portfolio Executive Report</b>
        <span>{model.monthLabel}</span>
        {/*
          No page number: Chrome does not implement `@page` margin boxes, so CSS
          cannot count pages. The only source of page numbers in a Chrome print
          is the browser's own header/footer, which would also stamp the URL and
          date into the margin — explicitly unwanted. The footer below repeats on
          every page instead, so a loose sheet still identifies itself.
        */}
        <span>Live derived view · not a controlled document</span>
      </footer>
    </article>
  );
}
