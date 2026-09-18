"use client";

/**
 * The Project Executive Status cards and the Executive Project Brief they open.
 *
 * The cards are the PRIMARY project-browsing surface on the live Executive
 * portfolio screen (Executive UX Slice 2) — a premium, senior-management-facing
 * alternative to the dense Full Project Data table, which remains available as
 * a secondary, expandable view (see `ProjectStatusTable` in
 * `executive-document.tsx`).
 *
 * Every field rendered here already exists on `ProjectExecutiveRow`
 * (`use-executive-portfolio.ts`) — nothing is fetched or computed specially for
 * this surface, and nothing here writes anything. Clicking a card, or a Health
 * badge wherever one appears in the document, opens the SAME brief for that
 * project; a Health click sets `focus="health"` so the brief opens with an
 * explicit health explanation, without inventing a second calculation.
 */

import * as React from "react";
import Link from "next/link";

import { DetailDrawer, StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { MILESTONE_STATUS_META } from "@/lib/constants";
import {
  EXEC_HEALTH_META,
  MONTHLY_BASIS_META,
  NOT_REPORTED,
  NO_MOVEMENT,
  bySeverity,
  type ExecHealth,
  type ProjectExecutiveRow,
} from "./executive-data";
import { BASIS_BADGE_CLASS, EmptyRow, ReportSection, pct, shortDate, signed } from "./executive-format";

/** Which part of the brief a click opened it for. `"health"` shows the
    explicit health callout at the top; `"overview"` opens on the brief as a
    whole (Health is still its first section either way). */
export type BriefFocus = "overview" | "health";

export type OpenBrief = (projectId: string, focus?: BriefFocus) => void;

/**
 * Card order: worst first, "Not Reported" ranked ahead of "On Track" — a
 * project with no position at all needs a President's eyes before one that
 * is confirmed fine. This is a SCOPED display order for the cards only; it
 * does not touch `EXEC_HEALTH_ORDER` (used by the KPI tiles, the register's
 * worst-bucket badge and `byAttention()` elsewhere), so nothing else in the
 * platform's health ordering changes.
 */
const CARD_HEALTH_ORDER: ExecHealth[] = ["critical", "delayed", "at_risk", "unknown", "on_track"];

function byCardAttention(a: ProjectExecutiveRow, b: ProjectExecutiveRow): number {
  const rank = CARD_HEALTH_ORDER.indexOf(a.reading.health) - CARD_HEALTH_ORDER.indexOf(b.reading.health);
  if (rank !== 0) return rank;
  const av = a.variance ?? 0;
  const bv = b.variance ?? 0;
  if (av !== bv) return av - bv;
  return a.projectName.localeCompare(b.projectName);
}

/* --------------------------------- Card ------------------------------------ */

function ExecutiveProjectCard({
  row,
  onOpen,
}: {
  row: ProjectExecutiveRow;
  onOpen: OpenBrief;
}) {
  const basis = MONTHLY_BASIS_META[row.basis];
  const decision = row.decisions[0];
  const clientAction = !decision ? row.clientActions[0] : undefined;
  const flagged = decision ?? clientAction;

  return (
    <button
      type="button"
      className="exec-project-card"
      onClick={() => onOpen(row.project.id, "overview")}
      aria-haspopup="dialog"
    >
      <header className="exec-project-card-head">
        <div>
          <b>{row.projectName}</b>
          <small>{row.clientName}</small>
        </div>
        {row.basis !== "none" && <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge>}
      </header>

      <StatusBadge tone={basis.tone} className={BASIS_BADGE_CLASS}>
        {basis.label}
      </StatusBadge>

      <div className="exec-project-card-figures">
        <div>
          <span>Planned</span>
          <b className="planned-value">{row.basis === "none" ? "—" : pct(row.planned, 0)}</b>
        </div>
        <div>
          <span>Actual</span>
          <b className="actual-value">{row.basis === "none" ? "—" : pct(row.actual, 0)}</b>
        </div>
        <div>
          <span>Variance</span>
          <b className="variance-value">{row.basis === "none" ? "—" : signed(row.variance)}</b>
        </div>
      </div>

      <div className="exec-project-card-line">
        <span className="exec-project-card-label">Next Milestone</span>
        <span>
          {row.nextMilestone ? (
            <>
              {row.nextMilestone.title}
              {row.nextMilestone.date ? ` · ${shortDate(row.nextMilestone.date)}` : ""}
            </>
          ) : (
            <span className="muted">Not recorded</span>
          )}
        </span>
      </div>

      <div className="exec-project-card-line">
        <span className="exec-project-card-label">Top Exception</span>
        <span>{row.keyConcern ? row.keyConcern.text : <span className="muted">No open risks or issues</span>}</span>
      </div>

      {flagged && (
        <div className="exec-project-card-decision">
          <StatusBadge tone={flagged.priorityTone}>{decision ? "Decision Required" : "Client Action"}</StatusBadge>
          <span>{flagged.text}</span>
        </div>
      )}

      <span className="exec-project-card-cta">View Executive Brief →</span>
    </button>
  );
}

/**
 * The printed equivalent of the interactive card above — same fields plus the
 * achievement/decision/next-item/movement detail a printed page has room for
 * and a click cannot offer on paper. Unchanged from the original "Project
 * Executive Snapshots" section this replaces on screen; only its screen
 * visibility changed (`print:` only), so the printed document is exactly what
 * it was before this slice.
 */
function PrintProjectCard({ row, month }: { row: ProjectExecutiveRow; month: string }) {
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
        {row.basis !== "none" && <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge>}
      </header>

      <div className="exec-snapshot-basis">
        <StatusBadge tone={basis.tone} className={BASIS_BADGE_CLASS}>
          {basis.label}
        </StatusBadge>
        {row.monthlyStatusLabel && <small>{row.monthlyStatusLabel}</small>}
      </div>

      {row.planningBacked ? (
        <p className="exec-planning-note">
          Planning-backed · Snapshot v{row.snapshotVersion}
          {row.dataDate ? ` · Data Date ${row.dataDate}` : ""}
          {typeof row.coveragePercent === "number" ? ` · Coverage ${row.coveragePercent.toFixed(0)}%` : ""}
        </p>
      ) : (
        row.basis !== "none" && <p className="exec-planning-note">Manual / Monthly fallback basis</p>
      )}

      <div className="exec-snapshot-figures">
        <div>
          <span>Planned</span>
          <b className="planned-value">{row.basis === "none" ? "—" : pct(row.planned, 0)}</b>
        </div>
        <div>
          <span>Actual</span>
          <b className="actual-value">{row.basis === "none" ? "—" : pct(row.actual, 0)}</b>
        </div>
        <div>
          <span>Variance</span>
          <b className="variance-value">{row.basis === "none" ? "—" : signed(row.variance)}</b>
        </div>
      </div>

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
          <dt>Weekly movement</dt>
          <dd>
            {row.movement.length ? (
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

export const ExecutiveProjectCardsSection = React.forwardRef<
  HTMLDivElement,
  {
    rows: ProjectExecutiveRow[];
    month: string;
    sectionNumber: number;
    onOpenBrief: OpenBrief;
    /** Set by a Portfolio Position health tile — narrows the INTERACTIVE
        screen grid only. Print always shows every project; a filter is a
        screen browsing convenience, never a change to what the record
        contains. An array so "Delayed / Critical" (two buckets, one tile)
        filters correctly. */
    healthFilter?: ExecHealth[] | null;
    onClearHealthFilter?: () => void;
  }
>(function ExecutiveProjectCardsSection(
  { rows, month, sectionNumber, onOpenBrief, healthFilter, onClearHealthFilter },
  ref
) {
  const ordered = React.useMemo(() => [...rows].sort(byCardAttention), [rows]);
  const filtered = healthFilter?.length ? ordered.filter((row) => healthFilter.includes(row.reading.health)) : ordered;

  return (
    <div ref={ref}>
    <ReportSection
      number={sectionNumber}
      title="Project Executive Status"
      note="Ordered by attention required — Delayed/Critical, then At Risk, then Not Reported, then On Track. Select a project for its full Executive Brief."
      accent={false}
    >
      {healthFilter && healthFilter.length > 0 && (
        <p className="exec-card-filter-chip">
          Showing {healthFilter.map((health) => EXEC_HEALTH_META[health].label).join(" / ")} only
          <button type="button" onClick={onClearHealthFilter}>
            Clear filter
          </button>
        </p>
      )}
      {ordered.length ? (
        <>
          {/*
            Interactive cards — the primary screen surface. Visibility is
            toggled with dedicated classes (`.exec-project-card-grid` /
            `.exec-print-cards` in globals.css), not Tailwind's `hidden` /
            `print:` utilities: both grids also set `display` themselves via
            plain unlayered rules, and an unlayered rule always outranks a
            Tailwind utility (which ships inside `@layer utilities`) — so a
            `print:hidden` here would lose to this file's own `display: grid`
            and print both grids at once.
          */}
          {filtered.length ? (
            <div className="exec-project-card-grid">
              {filtered.map((row) => (
                <ExecutiveProjectCard key={row.project.id} row={row} onOpen={onOpenBrief} />
              ))}
            </div>
          ) : (
            <p className="exec-project-card-filter-empty">No projects match this filter.</p>
          )}
          {/* Printed equivalent — always the FULL set, unfiltered. A click
              cannot survive on paper, so print gets the fuller snapshot card
              instead of the interactive one. */}
          <div className="exec-print-cards">
            {ordered.map((row) => (
              <PrintProjectCard key={row.project.id} row={row} month={month} />
            ))}
          </div>
        </>
      ) : (
        <EmptyRow>No projects are available for this reporting period.</EmptyRow>
      )}
    </ReportSection>
    </div>
  );
});

/* --------------------------------- Brief ------------------------------------ */

function BriefHealthCallout({ row }: { row: ProjectExecutiveRow }) {
  const basis = MONTHLY_BASIS_META[row.basis];
  return (
    <div className="exec-brief-health-callout">
      <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge>
      <p>
        {row.reading.basis} {basis.note}
      </p>
      {row.keyConcern && (
        <p className="exec-brief-callout-concern">
          <b>Key concern:</b> {row.keyConcern.text}
        </p>
      )}
    </div>
  );
}

export function ExecutiveProjectBrief({
  row,
  month,
  focus,
  open,
  onOpenChange,
}: {
  row: ProjectExecutiveRow | undefined;
  month: string;
  focus: BriefFocus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!row) return null;
  const basis = MONTHLY_BASIS_META[row.basis];

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={<span className="exec-brief-title">{row.projectName}</span>}
      description={`${row.clientName} · ${row.project.code}`}
      badge={row.basis !== "none" ? <StatusBadge tone={row.reading.tone}>{row.reading.label}</StatusBadge> : undefined}
      meta={
        <>
          <StatusBadge tone={basis.tone} className={BASIS_BADGE_CLASS}>
            {basis.label}
          </StatusBadge>
          {row.monthlyStatusLabel && <span>{row.monthlyStatusLabel}</span>}
        </>
      }
      footer={
        <Button asChild variant="outline" size="sm">
          <Link href={`/executive-reports/projects/${row.project.id}?month=${month}`}>
            Open full project executive view →
          </Link>
        </Button>
      }
    >
      {focus === "health" && <BriefHealthCallout row={row} />}

      {/*
        A. Executive Summary — short governed text only. Planned/Actual/
        Variance are NOT repeated here: Performance below is their one
        headline home, so a reader never sees the same three figures twice
        in one panel.
      */}
      <section className="exec-brief-section">
        <h3 className="exec-tab-heading">Executive Summary</h3>
        {row.monthly?.executiveSummary ? (
          <div className="monthly-executive-summary exec-brief-summary">{row.monthly.executiveSummary}</div>
        ) : (
          <p className="exec-tab-note">
            {row.basis === "none"
              ? "No Monthly Report exists for this project."
              : `${row.reading.label} — ${row.reading.basis}`}
          </p>
        )}
      </section>

      {/* B. Management Attention — Decision Required leads; Client Action only
          when there is no decision; then the top risk/issue and open actions. */}
      <section className="exec-brief-section">
        <h3 className="exec-tab-heading">Management Attention</h3>
        {row.decisions[0] ? (
          <div className="exec-funnel-line exec-brief-decision-line">
            <StatusBadge tone={row.decisions[0].priorityTone}>Decision Required</StatusBadge>
            <span>{row.decisions[0].text}</span>
          </div>
        ) : row.clientActions[0] ? (
          <div className="exec-funnel-line exec-brief-decision-line">
            <StatusBadge tone={row.clientActions[0].priorityTone}>Client Action</StatusBadge>
            <span>{row.clientActions[0].text}</span>
          </div>
        ) : (
          <p className="exec-tab-note">No executive decision currently recorded.</p>
        )}
        <div className="exec-funnel-impact-row exec-brief-attention-row">
          <div>
            <span className="exec-funnel-impact-label">Top Risk / Issue</span>
            <span>{row.keyConcern ? row.keyConcern.text : <span className="muted">No open risks or issues recorded.</span>}</span>
          </div>
          <div>
            <span className="exec-funnel-impact-label">Open Actions</span>
            <span>
              {row.openActions.total} open
              {row.openActions.overdue > 0 ? `, ${row.openActions.overdue} overdue` : ""}
            </span>
          </div>
        </div>
      </section>

      {/* C. Performance — headline Planned/Actual/Variance, provenance (SPI,
          Coverage, Snapshot, Data Date) kept secondary and quieter. */}
      <section className="exec-brief-section">
        <h3 className="exec-tab-heading">Performance</h3>
        <div className="exec-figure-row exec-figure-row-3">
          <div className="exec-figure">
            <span>Planned</span>
            <b className="planned-value">{row.basis === "none" ? NOT_REPORTED : pct(row.planned)}</b>
          </div>
          <div className="exec-figure">
            <span>Actual</span>
            <b className="actual-value">{row.basis === "none" ? NOT_REPORTED : pct(row.actual)}</b>
          </div>
          <div className="exec-figure">
            <span>Variance</span>
            <b className="variance-value">{row.basis === "none" ? NOT_REPORTED : signed(row.variance)}</b>
          </div>
        </div>
        {row.basis !== "none" && (
          <p className="exec-tab-note exec-planning-note">
            <StatusBadge tone={row.planningBacked ? "info" : "neutral"}>
              {row.planningBacked ? "Planning-backed" : "Manual / Monthly fallback"}
            </StatusBadge>{" "}
            SPI {row.spi === undefined ? NOT_REPORTED : row.spi === null ? "N/A" : row.spi.toFixed(2)}
            {row.planningBacked && (
              <>
                {" · "}Coverage {typeof row.coveragePercent === "number" ? `${row.coveragePercent.toFixed(0)}%` : "—"}
                {" · "}Snapshot v{row.snapshotVersion}
                {row.dataDate ? ` · Data Date ${row.dataDate}` : ""}
              </>
            )}
          </p>
        )}
      </section>

      {/* D. Impact / Milestones — next milestone, then Current Master
          Milestone Position (governed, read-only). */}
      <section className="exec-brief-section">
        <h3 className="exec-tab-heading">Impact / Milestones</h3>
        <div className="exec-brief-attention-row">
          <span className="exec-funnel-impact-label">Next Milestone</span>
          <span>
            {row.nextMilestone ? (
              <>
                {row.nextMilestone.title}
                {row.nextMilestone.date ? ` · ${shortDate(row.nextMilestone.date)}` : ""}
                {row.nextMilestoneOverdue && <span className="exec-flag exec-flag-overdue">Overdue</span>}
              </>
            ) : (
              <span className="muted">No upcoming milestone recorded.</span>
            )}
          </span>
        </div>
        <h4 className="exec-brief-subheading">Current Master Milestone Position</h4>
        {row.milestoneStates.length ? (
          <ul className="exec-brief-milestone-list">
            {row.milestoneStates.map((state) => {
              const statusMeta = MILESTONE_STATUS_META[state.status];
              return (
                <li key={state.milestone.id}>
                  <span>
                    <b>{state.milestone.code}</b> {state.milestone.name}
                  </span>
                  {state.inConflict ? (
                    <StatusBadge tone="danger">Unresolved</StatusBadge>
                  ) : (
                    <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="exec-tab-note">No active Master Milestones are recorded for this project.</p>
        )}
      </section>

      {/* E. Latest Reporting — the Monthly basis this brief is speaking from,
          then Weekly movement past that baseline, with source links. */}
      <section className="exec-brief-section">
        <h3 className="exec-tab-heading">Latest Reporting</h3>
        <div className="exec-funnel-line exec-brief-basis-line">
          <StatusBadge tone={basis.tone} className={BASIS_BADGE_CLASS}>
            {basis.label}
          </StatusBadge>
          {row.monthly ? (
            <span className="exec-tab-note">
              {row.monthly.reportNumber} · {row.monthlyStatusLabel} ·{" "}
              <Link className="monthly-link" href={`/monthly-reports/${row.monthly.id}`}>
                Open Monthly Report →
              </Link>
            </span>
          ) : (
            <span className="exec-tab-note">No Monthly Report exists for this project.</span>
          )}
        </div>
        <div className="exec-brief-attention-row">
          <span className="exec-funnel-impact-label">Weekly Movement</span>
          {row.movement.length ? (
            <div className="exec-movement-list">
              {row.movement.slice(0, 3).map((item) => (
                <span className="exec-movement" key={item.id}>
                  <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
                  <small>
                    {item.weekNumber ? `W${item.weekNumber} · ` : ""}
                    {item.text}
                  </small>
                </span>
              ))}
            </div>
          ) : (
            <span className="muted">{NO_MOVEMENT}</span>
          )}
        </div>
      </section>
    </DetailDrawer>
  );
}
