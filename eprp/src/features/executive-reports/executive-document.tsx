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
import { summarise as summariseMilestones } from "@/features/projects/milestone-state";
import { ExecutiveAnalytics } from "./executive-analytics";
import type { ExecPanel } from "./executive-panels";
import { ExecutiveAiPanel } from "./executive-ai-panel";
import { ExecutiveNotesPanel } from "./executive-notes-panel";
import type { ExecutiveNote, NotesAvailability } from "./executive-notes";
import { MILESTONE_STATUS_META } from "@/lib/constants";
import {
  MONTHLY_BASIS_META,
  NOT_APPLICABLE,
  NOT_REPORTED,
  NO_MOVEMENT,
  buildManagementAttention,
  detailVisibility,
  restrictedEmptyText,
  restrictedPartialNote,
  upcomingMilestones,
  type AttentionItem,
  type ExecHealth,
  type MilestoneRow,
  type PortfolioAggregate,
  type PreparedBy,
  type ProjectExecutiveRow,
} from "./executive-data";
import { BASIS_BADGE_CLASS, EmptyRow, RESTRICTED_DETAIL, ReportSection, pct, shortDate, signed } from "./executive-format";
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
  /** Masthead identity for the printed document. Optional: absent, the
      masthead falls back to the EPROM-only header. */
  identity?: ExecutiveDocumentIdentity;
}

/**
 * What the printed masthead may state about the document itself — only facts
 * that already exist. There is no Executive report number or revision in the
 * data model, so none is shown or invented; the stored record's lifecycle
 * status and classification are the available document reference.
 */
export interface ExecutiveDocumentIdentity {
  /** Stored record's lifecycle label; absent when no record has been saved. */
  statusLabel?: string;
  /** Stored record title, when the author set one. */
  title?: string;
  /** Stored record classification, when the author set one. */
  classification?: string;
  /** Set only when EVERY project in scope shares one client. */
  client?: { name: string; logoRef?: string };
  /**
   * Multi-client scope only: every client in scope, with its configured logo
   * when one exists. Presented as "Clients in scope" — never as the
   * document's owner. A client without a logo prints as its configured
   * short name, else its registered name.
   */
  clients?: { name: string; shortName?: string; logoRef?: string }[];
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
 * One client in scope → that client's mark beside EPROM's. Several clients →
 * a small, labelled "Clients in scope" strip, so no single client reads as the
 * document's owner. Only configured logos print; a client without one prints
 * as its name — a logo is never substituted or guessed.
 *
 * No QR code — `03` §19.1 requires a QR to resolve to a specific
 * report AND revision, and the Executive record carries no revision for it to
 * point at. A QR onto a live view would promise traceability the platform
 * cannot honour.
 */
function DocumentHeader({ model }: { model: ExecutiveDocumentModel }) {
  const identity = model.identity;
  const client = identity?.client;
  const scopeClients = client ? [] : (identity?.clients ?? []);

  /*
   * `loading="eager"` is REQUIRED on every masthead image. The masthead is
   * print-only (`display: none` on screen), and next/image lazy-loads by
   * default — a lazy image that is never on screen is never fetched, so it
   * printed as an empty box. That is why the EPROM logo went missing on paper.
   */
  return (
    <header className="monthly-report-header monthly-print-header exec-masthead">
      <div className="monthly-brand-row">
        <Image src={siteConfig.logo.full} alt="EPROM" width={222} height={60} unoptimized loading="eager" />
        <div className="exec-header-meta">
          <div>
            <span>Reporting Period</span>
            <b>{model.monthLabel}</b>
          </div>
          <div>
            <span>Document Status</span>
            <b>{identity?.statusLabel ?? "Not yet saved"}</b>
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
        {client && (
          <div className="exec-client-mark">
            {client.logoRef ? (
              <Image
                src={client.logoRef}
                alt={`${client.name} logo`}
                width={150}
                height={54}
                unoptimized
                loading="eager"
                className="monthly-client-logo"
              />
            ) : (
              // No logo configured: the name, never a substituted mark.
              <span className="exec-client-name">{client.name}</span>
            )}
          </div>
        )}
        {scopeClients.length > 0 && (
          /*
            One compact, right-aligned list — logos where configured, otherwise
            the client's short name (or registered name) as plain text that
            wraps. No per-client boxes: three boxed names beside the meta tiles
            made the masthead taller and pushed Management Attention off page 1.
            The full registered name stays in the tooltip and in the report
            body (Full Project Data, project cards).
          */
          <div className="exec-client-scope">
            <span>Clients in scope</span>
            <ul className={scopeClients.length > 3 ? "is-many" : undefined}>
              {scopeClients.map((entry) => (
                <li key={entry.name}>
                  {entry.logoRef ? (
                    <Image
                      src={entry.logoRef}
                      alt={`${entry.name} logo`}
                      title={entry.name}
                      width={120}
                      height={40}
                      unoptimized
                      loading="eager"
                    />
                  ) : (
                    <span className="exec-client-name" title={entry.name}>
                      {entry.shortName || entry.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="monthly-title-band">
        <div>
          <p>
            Executive Reporting · {model.monthLabel}
            {client ? ` · ${client.name}` : ""}
          </p>
          <h1>{identity?.title || "Project Portfolio Executive Report"}</h1>
        </div>
        {identity?.classification && (
          <div className="exec-title-note exec-classification">
            <span>Classification</span>
            <b>{identity.classification}</b>
          </div>
        )}
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
  const restricted = aggregate.restrictedDetailProjects;

  const position: KpiSpec[] = [
    // The live Executive scope has already excluded archived projects, so this
    // is the management-scope count rather than a raw lifecycle-status tally.
    {
      label: "Active Projects",
      value: String(aggregate.activeProjects),
      recorded: true,
      note: `${aggregate.submitted} submitted · ${aggregate.contributing} approved`,
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
      label: "Monthly Submitted",
      value: String(aggregate.submitted),
      recorded: true,
      note: `${aggregate.excludedDraft} draft · ${aggregate.excludedMissing} missing`,
    },
    { label: "On Track", value: String(aggregate.health.on_track), recorded: true },
    { label: "At Risk", value: String(aggregate.health.at_risk), recorded: true },
    {
      label: "Delayed / Critical",
      value: String(aggregate.health.delayed + aggregate.health.critical),
      recorded: true,
    },
    { label: "Not Reported", value: String(aggregate.excludedMissing), recorded: true },
    ...(aggregate.restrictedDraftHealth > 0
      ? [{ label: "Draft Status Restricted", value: String(aggregate.restrictedDraftHealth), recorded: true }]
      : []),
    // Same rule as the screen cockpit: when some projects' detail is withheld
    // from this viewer, a count of what IS visible is not the portfolio figure.
    {
      label: "Open Executive Decisions",
      value: restricted ? "—" : String(aggregate.openDecisions),
      recorded: true,
      note: restricted ? `Details restricted for ${restricted} project(s)` : undefined,
    },
    {
      label: "Client Pending Actions",
      value: restricted ? "—" : String(aggregate.clientPendingActions),
      recorded: true,
      note: restricted ? "Partial visibility" : undefined,
    },
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
        <b>Project Health</b> = the submitted Monthly reading, including draft · <b>Portfolio Performance</b> = approved Monthly reports only.
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
    return <p className="exec-movement-none">{row.detailAvailable === false ? RESTRICTED_DETAIL : NO_MOVEMENT}</p>;
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
 * Full Project Data — one governed table with two presentation modes. Print
 * keeps the complete formal register; the cockpit replaces that all-project
 * view with a controlled, single-project drill-down.
 */
function ProjectStatusTable({
  model,
  onOpenBrief,
  compact = false,
  selectedProjectId = "",
  onSelectProject,
}: {
  model: ExecutiveDocumentModel;
  onOpenBrief: OpenBrief;
  compact?: boolean;
  selectedProjectId?: string;
  onSelectProject?: (projectId: string) => void;
}) {
  const { rows } = model;
  const selectedRow = compact ? rows.find((row) => row.project.id === selectedProjectId) : undefined;
  const visibleRows = compact ? (selectedRow ? [selectedRow] : []) : rows;

  return (
    <ReportSection
      number={5}
      title="Full Project Data"
      note={compact
        ? "Select a project to inspect its complete Executive data and supporting detail."
        : "Complete formal register — one row per project."}
      accent={false}
    >
      {compact && rows.length > 0 && (
        <div className="exec-fulldata-picker-row">
          <label className="exec-fulldata-picker">
            <span>Select Project</span>
            <select
              value={selectedRow?.project.id ?? ""}
              onChange={(event) => onSelectProject?.(event.target.value)}
            >
              <option value="">Choose a project</option>
              {rows.map((row) => (
                <option key={row.project.id} value={row.project.id}>{row.projectName}</option>
              ))}
            </select>
          </label>
          {selectedRow && (
            <Link
              className="exec-fulldata-register-link"
              href={`/executive-reports/projects/${selectedRow.project.id}?month=${model.month}`}
            >
              View Full Project Report →
            </Link>
          )}
        </div>
      )}
      {compact && rows.length > 0 && !selectedRow ? (
        <p className="exec-fulldata-prompt">Select a project to view its complete data and supporting details.</p>
      ) : visibleRows.length ? (
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
              {visibleRows.map((row) => {
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
                      Performance is approved-only. Draft and missing projects
                      remain separate governance states, but neither supplies
                      Planned / Actual / Variance to the Executive position.
                    */}
                    <td className="planned-value">{row.basis === "approved" ? pct(row.planned) : <span className="muted">{NOT_APPLICABLE}</span>}</td>
                    <td className="actual-value">{row.basis === "approved" ? pct(row.actual) : <span className="muted">{NOT_APPLICABLE}</span>}</td>
                    <td className="variance-value">{row.basis === "approved" ? signed(row.variance) : <span className="muted">{NOT_APPLICABLE}</span>}</td>
                    <td>
                      <button
                        type="button"
                        className="exec-health-trigger"
                        onClick={() => onOpenBrief(row.project.id, "health")}
                      >
                        <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge>
                      </button>
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
                        <span className="muted">{row.detailAvailable === false ? RESTRICTED_DETAIL : "Not recorded"}</span>
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
                            <p className="muted">{row.detailAvailable === false ? RESTRICTED_DETAIL : "No key concern reported"}</p>
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
    </ReportSection>
  );
}

/* ----------------------- 3 · Management attention -------------------------- */

/**
 * One printed Management Attention list.
 *
 * EVERY item prints — no cap. The count badge states the total, so printing
 * fewer rows than it claims would silently drop items from the record.
 *
 * A non-empty list is a TABLE so it paginates like one: Chrome repeats the
 * <thead> (list title + column labels) on every page the list spans, and each
 * row is kept whole (`.exec-attention-table` in globals.css). The list flows
 * across pages with no single-row orphan at either end.
 *
 * Print-only (the section mounts inside `.exec-print-only`), so rows carry no
 * click handler — the screen cockpit has its own interactive version.
 */
function AttentionList({
  title,
  items,
  emptyText,
  restrictedCount,
  showDue = false,
  prominent = false,
}: {
  title: string;
  items: AttentionItem[];
  emptyText: string;
  /** Projects whose operational detail this viewer cannot read. */
  restrictedCount: number;
  showDue?: boolean;
  /** The Decisions Required panel leads the section and carries a stronger
      accent — decision-first, per the Executive UX brief. */
  prominent?: boolean;
}) {
  const size = items.length === 0 ? "is-empty" : "is-listed";
  // Same wording as the screen cockpit: an empty list is not evidence of
  // "none" when some projects' detail is withheld from this viewer.
  const restrictedNote = restrictedCount > 0
    ? `Partial view: details are restricted for ${restrictedCount} project${restrictedCount === 1 ? "" : "s"}.`
    : undefined;

  if (items.length === 0) {
    return (
      <div className={`exec-attention-panel${prominent ? " is-decision" : ""} ${size}`}>
        <div className="monthly-mini-heading">
          <span>{title}</span>
        </div>
        <EmptyRow>
          {restrictedCount > 0
            ? `None visible. Details are restricted for ${restrictedCount} project${restrictedCount === 1 ? "" : "s"}; no conclusion can be drawn for the full portfolio.`
            : emptyText}
        </EmptyRow>
      </div>
    );
  }

  return (
    <div className={`exec-attention-panel${prominent ? " is-decision" : ""} ${size}`}>
      <table className="exec-attention-table">
        {/* Explicit widths: with fixed layout the browser sizes columns from
            the FIRST row, which here is the full-width title cell. */}
        <colgroup>
          <col className="exec-att-col-severity" />
          <col />
          <col className="exec-att-col-project" />
          <col className="exec-att-col-due" />
          <col className="exec-att-col-owner" />
        </colgroup>
        <thead>
          <tr className="exec-attention-title-row">
            <th colSpan={5}>
              <div className="monthly-mini-heading">
                <span>{title}</span>
                <small>{items.length}</small>
              </div>
              {restrictedNote && <p className="exec-attention-restricted">{restrictedNote}</p>}
            </th>
          </tr>
          <tr className="exec-attention-labels">
            <th>Severity</th>
            <th>Item</th>
            <th>Project</th>
            <th>{showDue ? "Due" : ""}</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <StatusBadge tone={item.priorityTone}>{item.priorityLabel}</StatusBadge>
              </td>
              <td className="exec-attention-text">{item.text}</td>
              <td className="exec-attention-project">{item.projectName}</td>
              <td className={`exec-attention-due${item.overdue ? " exec-overdue" : ""}`}>
                {showDue && item.dueDate ? `${item.overdue ? "Overdue" : "Due"} ${shortDate(item.dueDate)}` : ""}
              </td>
              <td className="exec-attention-owner">{item.ownerName ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManagementAttention({ model }: { model: ExecutiveDocumentModel }) {
  const { decisions, risks, clientActions, overdue } = buildManagementAttention(model.rows);
  const restrictedCount = model.aggregate.restrictedDetailProjects;

  return (
    <ReportSection number={3} title="Management Attention" note="Ranked by severity, then by due date.">
      {/*
        Decision-first: Decisions Required leads, not Top Risks, so what
        leadership must act on is the first thing read — and it carries its own
        accent (`.is-decision`).
      */}
      <div className="exec-attention-grid">
        <AttentionList
          title="Decisions Required"
          items={decisions}
          emptyText="No decisions awaiting management."
          restrictedCount={restrictedCount}
          showDue
          prominent
        />
        <AttentionList
          title="Critical Risks / Issues"
          items={risks}
          emptyText="No open risks or issues recorded."
          restrictedCount={restrictedCount}
        />
        <AttentionList
          title="Client Dependencies"
          items={clientActions}
          emptyText="No open client dependencies."
          restrictedCount={restrictedCount}
          showDue
        />
        <AttentionList
          title="Overdue Actions"
          items={overdue}
          emptyText="No overdue actions."
          restrictedCount={restrictedCount}
          showDue
        />
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
function GovernedMilestoneStatus({
  model,
  compact = false,
}: {
  model: ExecutiveDocumentModel;
  compact?: boolean;
}) {
  const [selectedProjectId, setSelectedProjectId] = React.useState("");
  const rows = model.rows.flatMap((row) =>
    row.milestoneStates.map((state) => ({ row, state }))
  );
  const states = rows.map(({ state }) => state);
  const summary = summariseMilestones(states);
  const selectedProject = model.rows.find((row) => row.project.id === selectedProjectId);
  const selectedRows = selectedProject
    ? selectedProject.milestoneStates.map((state) => ({ row: selectedProject, state }))
    : [];
  // The governed register is read only for projects with detail access; for
  // the rest an empty list means "not visible to you", never "none recorded".
  const visibility = detailVisibility(model.rows);
  const partialNote = rows.length ? restrictedPartialNote(visibility, "Master Milestone detail") : undefined;

  const milestoneTable = (visibleRows: typeof rows, includeProject: boolean) => (
    <div className="monthly-table-wrap">
      <table className={`monthly-table exec-milestone-table exec-governed-table${includeProject ? "" : " is-project-only"}`}>
        <thead>
          <tr>
            {includeProject && <th>Project</th>}
            <th>Code</th>
            <th>Milestone</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Forecast Date</th>
            <th>Actual Date</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ row, state }) => {
            const statusMeta = MILESTONE_STATUS_META[state.status];
            return (
              <tr key={state.milestone.id}>
                {includeProject && <td>{row.projectName}</td>}
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
  );

  return (
    <section className="monthly-section">
      <div className="monthly-section-title-row">
        <h2>
          <span>Current Master Milestone Position</span>
        </h2>
        <p>
          Governed current position, as approved by Project Control.
          {partialNote && <> {partialNote}</>}
        </p>
      </div>
      {rows.length && compact ? (
        <>
          <dl className="exec-milestone-summary" aria-label="Current Master Milestone summary">
            <div><dt>Total</dt><dd>{summary.total}</dd></div>
            <div><dt>Completed</dt><dd>{summary.completed}</dd></div>
            <div><dt>In Progress</dt><dd>{summary.inProgress}</dd></div>
            <div><dt>Delayed</dt><dd>{summary.delayed}</dd></div>
            <div><dt>Not Started</dt><dd>{summary.notStarted}</dd></div>
          </dl>
          <div className="exec-milestone-picker-row">
            <label className="exec-milestone-picker">
              <span>Select Project</span>
              <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
                <option value="">Choose a project</option>
                {model.rows.map((row) => (
                  <option key={row.project.id} value={row.project.id}>{row.projectName}</option>
                ))}
              </select>
            </label>
            {selectedProject && (
              <Link className="exec-milestone-register-link" href={`/projects/${selectedProject.project.id}/milestones`}>
                View Full Register →
              </Link>
            )}
          </div>
          {selectedProject ? (
            selectedRows.length ? milestoneTable(selectedRows, false) : (
              <EmptyRow>
                {selectedProject.detailAvailable === false
                  ? `Master Milestone detail for ${selectedProject.projectName} is ${RESTRICTED_DETAIL.toLowerCase()}.`
                  : `No active Master Milestones are recorded for ${selectedProject.projectName}.`}
              </EmptyRow>
            )
          ) : (
            <p className="exec-milestone-prompt">Select a project to view its governed milestones.</p>
          )}
        </>
      ) : rows.length ? (
        milestoneTable(rows, true)
      ) : (
        <EmptyRow>
          {restrictedEmptyText(visibility, {
            fallback: "No active Master Milestones are recorded for the visible projects.",
            subject: "Master Milestone detail",
            noneVisible: "No active Master Milestones are recorded",
          })}
        </EmptyRow>
      )}
    </section>
  );
}

/**
 * Upcoming Plan Items paginate as a table, never splitting a row:
 *   · a short list (up to COMPACT_PLAN_ROWS) is kept together — if it cannot
 *     fit under its heading it moves to the next page whole, heading included;
 *   · a longer list flows, with the first two and last two rows kept together
 *     (no single orphaned row at either end), and its <thead> — column labels
 *     plus a "(continued)" heading — repeats on every continuation page. The
 *     first instance of that heading sits under the section title (see
 *     `.exec-plan-section` in globals.css), so only the repeats show.
 */
const COMPACT_PLAN_ROWS = 8;

function MilestoneTimeline({ model }: { model: ExecutiveDocumentModel }) {
  const upcoming = upcomingMilestones(model.milestones, model.today);
  const compact = upcoming.length <= COMPACT_PLAN_ROWS;
  // Monthly and Weekly plan items are loaded only for projects with detail
  // access, so an empty or short list says nothing about withheld projects.
  const visibility = detailVisibility(model.rows);
  const baseNote =
    "Free-text planning entries from Monthly and Weekly plan items — not part of the governed Master Milestone register above.";
  const partialNote = upcoming.length ? restrictedPartialNote(visibility, "plan detail") : undefined;

  return (
    <div className={`exec-plan-section${compact ? " is-compact" : ""}`}>
    <ReportSection
      number={7}
      title="Upcoming Plan Items"
      note={partialNote ? `${baseNote} ${partialNote}` : baseNote}
    >
      {upcoming.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table exec-milestone-table exec-plan-table">
            {/* Explicit widths: with fixed layout the browser sizes columns
                from the FIRST row, which is the full-width continuation row. */}
            <colgroup>
              <col className="exec-plan-col-date" />
              <col className="exec-plan-col-project" />
              <col className="exec-plan-col-item" />
              <col className="exec-plan-col-owner" />
              <col className="exec-plan-col-status" />
              <col className="exec-plan-col-source" />
            </colgroup>
            <thead>
              <tr className="exec-plan-continued-row">
                <th colSpan={6}>
                  <span className="exec-continued">
                    7 · Upcoming Plan Items <em>(continued)</em>
                  </span>
                </th>
              </tr>
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
        <EmptyRow>
          {restrictedEmptyText(visibility, {
            fallback: "No dated plan items are recorded ahead of today in Monthly or Weekly plans.",
            subject: "Plan detail",
            noneVisible: "No dated plan items are recorded ahead of today",
          })}
        </EmptyRow>
      )}
    </ReportSection>
    </div>
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

      {/*
        Name · Position · Signature · Date for every person. Unassigned fields
        print as blank rules so the sheet can be completed by hand. A
        preparer's project list is NOT repeated inside the box — it prints once,
        beneath the document strip, and only when more than one preparer shares
        the report (see `PrintSignOff`).
      */}
      {(people.length ? people : [undefined]).map((person, index) => (
        <dl className="exec-sign-fields" key={person?.id ?? `blank-${index}`}>
          <div>
            <dt>Name</dt>
            <dd>{person?.name ?? ""}</dd>
          </div>
          <div>
            <dt>Position</dt>
            <dd>{person?.title ?? ""}</dd>
          </div>
          <div className="is-hand">
            <dt>Signature</dt>
            <dd />
          </div>
          <div className="is-hand">
            <dt>Date</dt>
            <dd />
          </div>
        </dl>
      ))}

      {placeholder && <i className="exec-preparer-gap">{placeholder}</i>}
    </div>
  );
}

function PrintSignOff({ model }: { model: ExecutiveDocumentModel }) {
  const projectCount = model.rows.length;
  // Per-preparer attribution matters only when the report is shared between
  // preparers; a single preparer covers every project listed in the report.
  const preparers = model.signatories.prepared.people.filter((person) => person.projects?.length);
  const showScope = model.signatories.prepared.people.length > 1 && preparers.length > 0;

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
          <dd>{model.identity?.title || "Project Portfolio Executive Report"}</dd>
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

      {showScope && (
        <dl className="exec-signoff-scope">
          <dt>Preparation scope</dt>
          {preparers.map((person) => (
            <dd key={person.id}>
              <b>{person.name}</b> — {person.projects?.join(", ")}
            </dd>
          ))}
        </dl>
      )}

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
 *
 * Running header, footer and page numbers are `@page` margin boxes, drawn by
 * the browser into the page margin on EVERY sheet — the only print-safe way to
 * repeat content per page without the trailing-blank-sheet problem of
 * `position: fixed` (see the `.exec-footer` note in `globals.css`). Chromium
 * 131+ renders them; an engine without margin-box support simply leaves the
 * margin empty; the masthead and sign-off still identify the document.
 * The first sheet carries the full masthead, so its running header is blank.
 */
function cssString(value: string): string {
  // Quote for a CSS string, and neutralise `<` so no text can close <style>.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\3C ").replace(/[\r\n]+/g, " ")}"`;
}

function ExecutivePrintPage({ model }: { model: ExecutiveDocumentModel }) {
  const title = model.identity?.title || "Project Portfolio Executive Report";
  const classification = model.identity?.classification;
  const runningRight = [model.monthLabel, classification].filter(Boolean).join(" · ");
  const box = "font-size: 6.4pt; color: #5b7290; letter-spacing: .02em;";

  return (
    <style>{`@media print {
      @page {
        size: A4 landscape;
        margin: 11mm 10mm 12mm;
        @top-left { content: ${cssString(`EPROM · ${title}`)}; ${box} font-weight: 700; color: #0d4384; vertical-align: bottom; padding-bottom: 2.5mm; }
        @top-right { content: ${cssString(runningRight)}; ${box} vertical-align: bottom; padding-bottom: 2.5mm; }
        @bottom-left { content: ${cssString(`EPROM Progress Report · Live derived view · not a controlled document`)}; ${box} vertical-align: top; padding-top: 2.5mm; }
        @bottom-right { content: "Page " counter(page) " of " counter(pages); ${box} font-weight: 700; color: #0d4384; vertical-align: top; padding-top: 2.5mm; }
      }
      @page :first {
        @top-left { content: none; }
        @top-right { content: none; }
      }
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
  const [fullDataProjectId, setFullDataProjectId] = React.useState("");

  const openBrief = React.useCallback<OpenBrief>((projectId, focus = "overview") => {
    // A card/brief action also primes the in-page Full Project Data drill-down
    // so the same project is ready when the reader reaches that section.
    setFullDataProjectId(projectId);
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
      <ExecutivePrintPage model={model} />

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
          <ManagementAttention model={model} />
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
          <GovernedMilestoneStatus model={model} compact />
        </div>
        <div className="exec-print-only">
          <GovernedMilestoneStatus model={model} />
          <MilestoneTimeline model={model} />
        </div>

        <div className="exec-cockpit-only">
          <ProjectStatusTable
            model={model}
            onOpenBrief={openBrief}
            compact
            selectedProjectId={fullDataProjectId}
            onSelectProject={setFullDataProjectId}
          />
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

      {/*
        No in-flow closing band. Title, period, provenance ("Live derived view ·
        not a controlled document") and "Page N of M" print on EVERY sheet via
        the `@page` margin boxes in `ExecutivePrintPage`; a trailing band
        repeated them once more and could spill onto a near-empty final page.
      */}

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
