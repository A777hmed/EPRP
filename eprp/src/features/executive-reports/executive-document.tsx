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
import { ChevronDown } from "lucide-react";

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
  buildManagementAttention,
  upcomingMilestones,
  type AttentionItem,
  type ExecHealth,
  type MilestoneRow,
  type PortfolioAggregate,
  type PreparedBy,
  type ProjectExecutiveRow,
} from "./executive-data";
import { BASIS_BADGE_CLASS, EmptyRow, ReportSection, pct, shortDate, signed } from "./executive-format";
import { ExecutiveProjectBrief, ExecutiveProjectCardsSection, type BriefFocus, type OpenBrief } from "./executive-project-brief";
import { CockpitAnalytics, CockpitAttention, CockpitNotes, CockpitSummary, WhatChangedSection } from "./executive-cockpit";
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
  /** False when no Monthly Report exists for ANY month across the visible
      projects — `month`/`monthLabel` still default to the current calendar
      month for querying, but that default must never be presented as a real
      selected reporting period (see `useDocumentModel()`). */
  hasReportingPeriods: boolean;
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
        {/*
          Never a static claim. A period with no approved Monthly at all must
          not headline "Approved Monthly Reports" — that is the exact
          contradiction the figures below it (marked "No approved basis")
          already refuse to make.
        */}
        <div className="exec-title-note">
          <span>Basis</span>
          <b>{model.aggregate.noApprovedBasis ? "Provisional — No Approved Monthly Basis" : "Approved Monthly Reports"}</b>
        </div>
      </div>
      {/*
        `03` §17.2: an output that is not generated from an approved snapshot
        must be unmistakably marked, as part of the document rather than as a
        covering note. The FIGURES are never snapshotted, numbered or
        approved — they are read live on every view. That is distinct from
        the Executive-owned CONTENT (summary wording, notes, signatories,
        lifecycle status), which IS stored, in `executive_reports` — see
        `executive-record.ts`. The line below used to claim persistence was
        "not yet implemented", which stopped being true once that record
        shipped; it now says only what remains true of the figures.
      */}
      <div className="exec-provenance-band">
        <b>Live derived view</b>
        <span>
          Figures above are computed live from approved Monthly Reports at the moment of viewing, never snapshotted
          or numbered. Only the reviewed summary, notes and lifecycle status are stored.
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

/**
 * Full Project Data — the original nine-column table, kept in full for anyone
 * who needs every figure on one screen (or on paper), but no longer the
 * default view. Project Executive Status (the cards, above) is what a reader
 * opens the portfolio to scan; this stays available a click away, and always
 * renders in full when printed regardless of its on-screen collapsed state
 * (`globals.css`'s print block forces `.exec-fulldata-body` open).
 */
function ProjectStatusTable({ model, onOpenBrief }: { model: ExecutiveDocumentModel; onOpenBrief: OpenBrief }) {
  const { rows } = model;
  const [expanded, setExpanded] = React.useState(false);

  return (
    <ReportSection
      number={5}
      title="Full Project Data"
      note="Every field, one row per project. Collapsed by default — Project Executive Status above is the primary view."
      accent={false}
    >
      <button
        type="button"
        className="exec-fulldata-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronDown aria-hidden className={expanded ? "is-open" : undefined} />
        {expanded ? "Hide full data table" : "Show full data table"}
        <span className="exec-fulldata-count">
          {rows.length} project{rows.length === 1 ? "" : "s"}
        </span>
      </button>
      <div className={`exec-fulldata-body${expanded ? "" : " is-collapsed"}`}>
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
                        <StatusBadge tone={basis.tone} className={BASIS_BADGE_CLASS}>{basis.label}</StatusBadge>
                      </span>
                      {/* Planning Integration 3E: additive provenance only —
                          shown only when governed, never a second badge
                          repeating "Manual"/"fallback" beside every row. */}
                      {row.planningBacked && (
                        <small className="exec-planning-tag" title={row.dataDate ? `Data Date ${row.dataDate}` : undefined}>
                          Planning v{row.snapshotVersion}
                        </small>
                      )}
                    </td>
                    <td>{row.clientName}</td>
                    {/*
                      No Monthly at all: the basis chip above already says
                      "No Monthly Report" once. Repeating "Not Reported" in
                      three narrow adjacent cells said the same thing three
                      times and, on a fixed-layout table, overflowed its cell
                      and visually collided with its neighbour. A dash carries
                      the same meaning — nothing to show — in the space the
                      column actually has. A Draft Monthly still prints its
                      real figures; only the true no-data case collapses.
                    */}
                    <td className="planned-value">{row.basis === "none" ? <span className="muted">—</span> : pct(row.planned)}</td>
                    <td className="actual-value">{row.basis === "none" ? <span className="muted">—</span> : pct(row.actual)}</td>
                    <td className="variance-value">{row.basis === "none" ? <span className="muted">—</span> : signed(row.variance)}</td>
                    {/*
                      "No Monthly Report" in the project cell already says why
                      this row is empty. A "Not Reported" health badge here
                      repeated the same fact in a second vocabulary right next
                      to it — two adjacent badges for one missing-data state.
                    */}
                    <td>
                      {row.basis === "none" ? (
                        <span className="muted">—</span>
                      ) : (
                        <button
                          type="button"
                          className="exec-health-trigger"
                          onClick={() => onOpenBrief(row.project.id, "health")}
                        >
                          <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge>
                        </button>
                      )}
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
                            Management Attention carries Decisions Required at
                            portfolio level, and the Executive Project Brief
                            (opened from the card or the Health badge above)
                            carries it per project; printing it a third time
                            directly beneath the table put the same sentence
                            in two adjacent places.
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
      </div>
    </ReportSection>
  );
}

/* ----------------------- 3 · Management attention -------------------------- */

function AttentionList({
  title,
  items,
  emptyText,
  showDue = false,
  onOpenBrief,
  prominent = false,
}: {
  title: string;
  items: AttentionItem[];
  emptyText: string;
  showDue?: boolean;
  onOpenBrief: OpenBrief;
  /** The Decisions Required panel leads the grid and carries a stronger
      accent — decision-first, per the Executive UX brief. */
  prominent?: boolean;
}) {
  return (
    <div className={prominent ? "exec-attention-panel is-decision" : "exec-attention-panel"}>
      <div className="monthly-mini-heading">
        <span>{title}</span>
        {items.length > 0 && <small>{items.length}</small>}
      </div>
      {items.length ? (
        <ul className="exec-attention-list">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>
              <button type="button" className="exec-attention-trigger" onClick={() => onOpenBrief(item.projectId)}>
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
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyRow>{emptyText}</EmptyRow>
      )}
    </div>
  );
}

function ManagementAttention({ model, onOpenBrief }: { model: ExecutiveDocumentModel; onOpenBrief: OpenBrief }) {
  const { decisions, risks, clientActions, overdue, struggling } = buildManagementAttention(model.rows);

  return (
    <ReportSection number={3} title="Management Attention" note="Ranked by severity, then by due date.">
      {/*
        Decision-first: Decisions Required leads the grid, not Top Risks, so
        what leadership must act on is the first thing read — and it carries
        its own accent (`.is-decision`) rather than sitting as one panel among
        five identical ones.
      */}
      <div className="exec-attention-grid">
        <AttentionList
          title="Decisions Required"
          items={decisions}
          emptyText="No decisions awaiting management."
          showDue
          onOpenBrief={onOpenBrief}
          prominent
        />
        <AttentionList title="Top Risks" items={risks} emptyText="No open risks recorded." onOpenBrief={onOpenBrief} />
        <AttentionList
          title="Client Dependencies"
          items={clientActions}
          emptyText="No open client dependencies."
          showDue
          onOpenBrief={onOpenBrief}
        />
        <AttentionList title="Overdue Actions" items={overdue} emptyText="No overdue actions." showDue onOpenBrief={onOpenBrief} />

        <div className="exec-attention-panel">
          <div className="monthly-mini-heading">
            <span>Delayed / Critical Projects</span>
            {struggling.length > 0 && <small>{struggling.length}</small>}
          </div>
          {struggling.length ? (
            <ul className="exec-attention-list">
              {struggling.map((row) => (
                <li key={row.project.id}>
                  <button type="button" className="exec-attention-trigger" onClick={() => onOpenBrief(row.project.id, "health")}>
                    <span className="exec-attention-text">{row.projectName}</span>
                    <span className="exec-attention-meta">
                      <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge>
                      <b>{signed(row.variance)}</b>
                      <em>{row.reading.basis}</em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyRow>No project is reported delayed or critical.</EmptyRow>
          )}
        </div>
      </div>
    </ReportSection>
  );
}

/* ------------------------- 6 · Portfolio analytics ------------------------- */

function PortfolioAnalytics({ model }: { model: ExecutiveDocumentModel }) {
  return (
    <ReportSection
      number={6}
      title="Portfolio Performance Analytics"
      note="Charts collapse to a compact note where the data does not support them."
    >
      <ExecutiveAnalytics panels={model.panels} />
    </ReportSection>
  );
}

/* --------------------------- 7 · Milestones -------------------------------- */

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
          <span>Current Master Milestone Position</span>
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
      number={7}
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

/**
 * Executive UX — visual refinement pass. A HYBRID document: screen and print
 * are two different compositions of the SAME `model` — nothing is fetched,
 * derived or invented twice:
 *
 *   SCREEN — the Executive Decision Cockpit (`.exec-cockpit-only`):
 *     Executive Summary (shared) → Portfolio Position (Dynamic Executive
 *     Cards) → Management Attention (decision-first) →
 *     Project Executive Status (cards, primary, shared) →
 *     What Changed Since Last Approved Period → Portfolio Analytics
 *     (reduced to panels with real data) → Current Master Milestone Position
 *     → Full Project Data (secondary, collapsed, shared) →
 *     Executive Notes (low in the hierarchy).
 *
 *   PRINT — the formal, numbered Project Portfolio Executive Report
 *     (`.exec-print-only`), unchanged from the existing report contract:
 *     masthead → 1 Executive Summary (shared) → 2 Portfolio Position →
 *     3 Management Attention → 4 Project Executive Status (shared) →
 *     5 Full Project Data → 6 Portfolio Performance Analytics (full set) →
 *     Current Master Milestone Position → 7 Upcoming Plan Items →
 *     8 Executive Notes → Sign-off.
 *
 * Executive Summary and Project Executive Status are SHARED sections that
 * mount ONCE, at a DOM position simultaneously valid for both sequences —
 * each already shows the right content per medium on its own
 * (`ExecutiveProjectCardsSection` toggles interactive vs. printed cards
 * internally). Full Project Data and Current Master Milestone Position sit
 * at INCOMPATIBLE positions between the two orders (print wants Full Data
 * right after the cards; screen wants it last), so those two mount TWICE —
 * once per medium, each reading the same `model` — rather than forcing one
 * shared DOM position to serve two contradictory orders. See `globals.css`
 * for why `.exec-cockpit-only`/`.exec-print-only` are plain classes rather
 * than Tailwind's `hidden`/`print:` utilities.
 *
 * `briefProjectId`/`briefFocus` are owned here, once, because every trigger —
 * a card, a Health badge, an item in Management Attention or What Changed —
 * lives somewhere in this same tree and all of them open the SAME Executive
 * Project Brief for the row they point at.
 */
export function ExecutiveDocument({ model }: { model: ExecutiveDocumentModel }) {
  const [briefProjectId, setBriefProjectId] = React.useState<string | null>(null);
  const [briefFocus, setBriefFocus] = React.useState<BriefFocus>("overview");

  const openBrief = React.useCallback<OpenBrief>((projectId, focus = "overview") => {
    setBriefProjectId(projectId);
    setBriefFocus(focus);
  }, []);

  const briefRow = React.useMemo(
    () => (briefProjectId ? model.rows.find((row) => row.project.id === briefProjectId) : undefined),
    [briefProjectId, model.rows]
  );

  const projectNameOf = React.useCallback(
    (id: string) => model.rows.find((row) => row.project.id === id)?.projectName ?? "Project",
    [model.rows]
  );
  const scopeOptions = React.useMemo(
    () => model.rows.map((row) => ({ id: row.project.id, name: row.projectName })),
    [model.rows]
  );

  /*
   * Dynamic Executive Cards (Portfolio Position) filter/focus the rest of the
   * cockpit rather than merely restating a count. A health tile narrows the
   * INTERACTIVE Project Executive Status grid (never the printed one — see
   * `ExecutiveProjectCardsSection`) and scrolls to it; Decisions Required /
   * Client Actions scroll to Management Attention, where that category
   * already leads. Nothing here recomputes a figure — every value clicked
   * came from `model.aggregate`/`model.rows`, already resolved.
   */
  const [healthFilter, setHealthFilter] = React.useState<ExecHealth[] | null>(null);
  const cardsRef = React.useRef<HTMLDivElement>(null);
  const attentionRef = React.useRef<HTMLDivElement>(null);

  const onSelectHealth = React.useCallback((health: ExecHealth[]) => {
    setHealthFilter((current) =>
      current && current.length === health.length && current.every((h) => health.includes(h)) ? null : health
    );
    requestAnimationFrame(() => cardsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const onFocusAttention = React.useCallback(() => {
    attentionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const onClearHealthFilter = React.useCallback(() => setHealthFilter(null), []);

  return (
    <article className="monthly-report-sheet monthly-print-document exec-document">
      <ExecutivePrintPage />

      <div className="exec-print-only">
        <DocumentHeader model={model} />
      </div>

      <div className="monthly-report-body">
        {/*
          Executive Summary is SHARED — the same narrative, first in both the
          cockpit and the formal print sequence (where it is numbered "1").
          The AI drafting controls it may show are gated at the source
          (`model.onAcceptSummary`, set only for a manager — see
          `useDocumentModel()` in `executive-view.tsx`), not here.
        */}
        <ExecutiveSummarySection model={model} />

        <div className="exec-cockpit-only">
          <CockpitSummary
            monthLabel={model.monthLabel}
            hasReportingPeriods={model.hasReportingPeriods}
            aggregate={model.aggregate}
            activeHealthFilter={healthFilter}
            onSelectHealth={onSelectHealth}
            onFocusAttention={onFocusAttention}
          />
        </div>
        <div className="exec-print-only">
          <KpiStrip model={model} />
        </div>

        <div className="exec-print-only">
          <ManagementAttention model={model} onOpenBrief={openBrief} />
        </div>
        <div className="exec-cockpit-only">
          <CockpitAttention ref={attentionRef} rows={model.rows} onOpenBrief={openBrief} />
        </div>

        <ExecutiveProjectCardsSection
          ref={cardsRef}
          rows={model.rows}
          month={model.month}
          sectionNumber={4}
          onOpenBrief={openBrief}
          healthFilter={healthFilter}
          onClearHealthFilter={onClearHealthFilter}
        />

        {/* Full Project Data prints immediately after Project Executive
            Status (formal sequence, unchanged); on screen it moves near the
            end (see the second mount below) — two mounts of the SAME
            component/data, each visible in only one medium. */}
        <div className="exec-print-only">
          <ProjectStatusTable model={model} onOpenBrief={openBrief} />
        </div>

        <div className="exec-cockpit-only">
          <WhatChangedSection rows={model.rows} onOpenBrief={openBrief} />
          <CockpitAnalytics panels={model.panels} />
        </div>
        <div className="exec-print-only">
          <PortfolioAnalytics model={model} />
        </div>

        {/* Current Master Milestone Position — likewise two mounts of the
            SAME governed-state component: print keeps it in its established
            position (between Analytics and Upcoming Plan Items); the cockpit
            gives it its own place in the screen hierarchy, right after
            Analytics. */}
        <div className="exec-cockpit-only">
          <GovernedMilestoneStatus model={model} />
        </div>
        <div className="exec-print-only">
          <GovernedMilestoneStatus model={model} />
          <MilestoneTimeline model={model} />
        </div>

        <div className="exec-cockpit-only">
          <ProjectStatusTable model={model} onOpenBrief={openBrief} />
        </div>

        <div className="exec-cockpit-only">
          <CockpitNotes
            notes={model.notes}
            availability={model.notesAvailability}
            canManage={model.canManageNotes}
            onChanged={model.onNotesChanged}
            projectNameOf={projectNameOf}
            scopeOptions={scopeOptions}
          />
        </div>

        <div className="exec-print-only">
          <ExecutiveNotesSection model={model} />
          <PrintSignOff model={model} />
        </div>
      </div>

      <footer className="monthly-report-footer exec-footer exec-print-only">
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

      <ExecutiveProjectBrief
        row={briefRow}
        month={model.month}
        focus={briefFocus}
        open={Boolean(briefRow)}
        onOpenChange={(next) => {
          if (!next) setBriefProjectId(null);
        }}
      />
    </article>
  );
}
