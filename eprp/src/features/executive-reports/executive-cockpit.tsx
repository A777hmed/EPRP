"use client";

/**
 * The Executive Decision Cockpit — the SCREEN-only composition of the live
 * Executive portfolio (Executive UX final pass). The formal, numbered
 * document in `executive-document.tsx` remains the PRINT/PDF composition;
 * both read the exact same `ProjectExecutiveRow[]`/`PortfolioAggregate` —
 * nothing here fetches, derives or invents a figure of its own.
 *
 * Screen and print are allowed to differ in COMPOSITION (what is shown,
 * grouped and ordered) while sharing the same governed DATA. This file is
 * the screen half of that split; see `ExecutiveDocument`'s doc comment for
 * how the two halves interleave in one DOM so each medium's CSS
 * (`.exec-cockpit-only` / `.exec-print-only`) can show only its own.
 *
 * Section headings reuse `ReportSection` from `executive-format.tsx` — the
 * same navy-pill treatment the formal print report uses — so the cockpit
 * reads as a strong, deliberate document rather than a flat dashboard. No
 * `number` is passed: these sections have no place in the print sequence to
 * be numbered against.
 */

import * as React from "react";
import { StatusBadge } from "@/components/shared";
import { ExecutiveNotesPanel } from "./executive-notes-panel";
import type { ExecutiveNote, NotesAvailability } from "./executive-notes";
import {
  buildManagementAttention,
  type AttentionItem,
  type ExecHealth,
  type MovementItem,
  type PortfolioAggregate,
  type ProjectExecutiveRow,
} from "./executive-data";
import { pct, ReportSection, shortDate, signed } from "./executive-format";
import { ExecutiveAnalytics } from "./executive-analytics";
import type { ExecPanel } from "./executive-panels";
import type { OpenBrief } from "./executive-project-brief";

/* -------------------------------- Summary ----------------------------------- */

/**
 * One Dynamic Executive Card. Interactive tiles are real buttons (`onClick`
 * set) so keyboard/focus reach every filter the same way a click does;
 * informational tiles (Projects in View, Planned/Actual/Variance) render as
 * plain cards — nothing to click, nothing pretends otherwise.
 */
function KpiCard({
  label,
  value,
  detail,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const className = `exec-kpi-card${tone ? ` ${tone}` : ""}${active ? " is-active" : ""}`;
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <span>{label}</span>
        <b>{value}</b>
        {detail && <small>{detail}</small>}
      </button>
    );
  }
  return (
    <div className={className}>
      <span>{label}</span>
      <b>{value}</b>
      {detail && <small>{detail}</small>}
    </div>
  );
}

/**
 * Item 2 (visual refinement pass) — Portfolio Position as Dynamic Executive
 * Cards, replacing the flat stat row. Planned/Actual/Variance render ONLY
 * when a valid approved basis exists (`!aggregate.noApprovedBasis`) — a
 * missing figure is never shown as a governed one, and it is never treated
 * as zero.
 *
 * The health tiles and Decisions/Client Actions tiles are live filters: a
 * health tile narrows Project Executive Status to that bucket and scrolls to
 * it; Decisions/Client Actions scroll straight to Management Attention,
 * where that category already leads. Nothing here computes a new figure —
 * every value is `aggregate`'s own field, read once.
 */
export function CockpitSummary({
  monthLabel,
  hasReportingPeriods,
  aggregate,
  activeHealthFilter,
  onSelectHealth,
  onFocusAttention,
}: {
  monthLabel: string;
  hasReportingPeriods: boolean;
  aggregate: PortfolioAggregate;
  activeHealthFilter?: ExecHealth[] | null;
  onSelectHealth: (health: ExecHealth[]) => void;
  onFocusAttention: () => void;
}) {
  const isActive = (health: ExecHealth) => Boolean(activeHealthFilter?.includes(health));
  const delayedCritical: ExecHealth[] = ["delayed", "critical"];

  return (
    <ReportSection title="Portfolio Position" note={hasReportingPeriods ? monthLabel : "No reporting period yet"}>
      <p className="exec-cockpit-coverage">
        Monthly Reporting Governance — {aggregate.activeProjects} Active · {aggregate.submitted} Submitted ·{" "}
        {aggregate.contributing} Approved · {aggregate.excludedDraft} Draft · {aggregate.excludedMissing} Missing
      </p>

      <div className="exec-kpi-card-grid">
        <KpiCard label="Active Projects" value={aggregate.activeProjects} detail={`${aggregate.submitted} submitted`} />
        <KpiCard
          label="On Track"
          value={aggregate.health.on_track}
          tone="tone-success"
          active={isActive("on_track")}
          onClick={() => onSelectHealth(["on_track"])}
        />
        <KpiCard
          label="At Risk"
          value={aggregate.health.at_risk}
          tone="tone-warning"
          active={isActive("at_risk")}
          onClick={() => onSelectHealth(["at_risk"])}
        />
        <KpiCard
          label="Delayed / Critical"
          value={aggregate.health.delayed + aggregate.health.critical}
          tone="tone-danger"
          active={isActive("delayed") || isActive("critical")}
          onClick={() => onSelectHealth(delayedCritical)}
        />
        <KpiCard
          label="Not Reported"
          value={aggregate.excludedMissing}
          active={isActive("unknown")}
          onClick={() => onSelectHealth(["unknown"])}
        />
        {aggregate.restrictedDraftHealth > 0 && (
          <KpiCard
            label="Draft Status Restricted"
            value={aggregate.restrictedDraftHealth}
            detail="Draft health is not published for this account"
            active={isActive("unknown")}
            onClick={() => onSelectHealth(["unknown"])}
          />
        )}
        <KpiCard
          label="Decisions Required"
          value={aggregate.restrictedDetailProjects ? "—" : aggregate.openDecisions}
          detail={aggregate.restrictedDetailProjects ? `Details restricted for ${aggregate.restrictedDetailProjects} project(s)` : undefined}
          tone={aggregate.openDecisions ? "tone-danger" : undefined}
          onClick={onFocusAttention}
        />
        <KpiCard
          label="Client Actions"
          value={aggregate.restrictedDetailProjects ? "—" : aggregate.clientPendingActions}
          detail={aggregate.restrictedDetailProjects ? "Partial visibility" : undefined}
          tone={aggregate.clientPendingActions ? "tone-warning" : undefined}
          onClick={onFocusAttention}
        />
      </div>

      {!aggregate.noApprovedBasis ? (
        <div className="exec-kpi-card-grid exec-kpi-card-grid-figures">
          <KpiCard label="Portfolio Planned" value={pct(aggregate.planned)} />
          <KpiCard label="Portfolio Actual" value={pct(aggregate.actual)} tone="tone-success" />
          <KpiCard label="Portfolio Variance" value={signed(aggregate.variance)} />
        </div>
      ) : (
        <p className="exec-cockpit-note">
          Provisional — No Approved Monthly Basis. Planned/Actual/Variance are withheld until at least one project
          reports an approved Monthly.
        </p>
      )}
    </ReportSection>
  );
}

/* ------------------------------- Attention ----------------------------------- */

function AttentionRow({ item, onOpenBrief }: { item: AttentionItem; onOpenBrief: OpenBrief }) {
  return (
    <li>
      <button type="button" className="exec-cockpit-row" onClick={() => onOpenBrief(item.projectId)}>
        <StatusBadge tone={item.priorityTone}>{item.priorityLabel}</StatusBadge>
        <span className="exec-cockpit-row-text" title={item.text}>{item.text}</span>
        <span className="exec-cockpit-row-meta">
          <b className="exec-cockpit-project">{item.projectName}</b>
          {item.dueDate && (
            <em className={`exec-cockpit-due${item.overdue ? " exec-overdue" : ""}`}>
              {item.overdue ? "Overdue " : "Due "}
              {shortDate(item.dueDate)}
            </em>
          )}
          {item.ownerName && <em className="exec-cockpit-owner">{item.ownerName}</em>}
        </span>
      </button>
    </li>
  );
}

function AttentionGroup({
  title,
  items,
  onOpenBrief,
  compactColumns = false,
  collapseAfter,
}: {
  title: string;
  items: AttentionItem[];
  onOpenBrief: OpenBrief;
  compactColumns?: boolean;
  collapseAfter?: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const listId = React.useId();
  if (items.length === 0) return null;
  const collapseLimit = collapseAfter ?? Number.POSITIVE_INFINITY;
  const hasCollapsibleOverflow = items.length > collapseLimit;
  const shown = hasCollapsibleOverflow && !expanded
    ? items.slice(0, collapseLimit)
    : compactColumns
      ? items
      : items.slice(0, 4);
  return (
    <div className={`exec-cockpit-group${compactColumns ? " exec-cockpit-critical" : ""}`}>
      <div className="exec-cockpit-group-head">
        <span>{title}</span>
        <small>{items.length}</small>
      </div>
      <ul id={hasCollapsibleOverflow ? listId : undefined} className="exec-cockpit-list">
        {shown.map((item) => (
          <AttentionRow key={item.id} item={item} onOpenBrief={onOpenBrief} />
        ))}
      </ul>
      {hasCollapsibleOverflow ? (
        <button
          type="button"
          className="exec-cockpit-overflow"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : `Show ${items.length - collapseLimit} more`}
        </button>
      ) : items.length > shown.length ? (
        <p className="exec-cockpit-more">+{items.length - shown.length} more</p>
      ) : null}
    </div>
  );
}

/**
 * Item 3 — Management Attention, decision-first, with empty categories
 * suppressed rather than rendered as large empty panels. Decisions Required
 * is the one category always present (compact, restrained empty state when
 * there is nothing to decide) — every other category disappears entirely
 * when it has zero items. Wrapped in `forwardRef` so the Decisions Required /
 * Client Actions cards in Portfolio Position can scroll straight to it.
 */
export const CockpitAttention = React.forwardRef<
  HTMLDivElement,
  { rows: ProjectExecutiveRow[]; onOpenBrief: OpenBrief }
>(function CockpitAttention({ rows, onOpenBrief }, ref) {
  const { decisions, risks, clientActions, overdue } = buildManagementAttention(rows);
  const restrictedCount = rows.filter((row) => row.detailAvailable === false).length;

  return (
    <div ref={ref}>
      <ReportSection title="Management Attention" note="Decisions Required leads; every other category is shown only when it has something to say.">
        <div className="exec-cockpit-decision">
          <div className="exec-cockpit-group-head">
            <span>Decisions Required</span>
            {decisions.length > 0 && <small>{decisions.length}</small>}
          </div>
          {restrictedCount > 0 && decisions.length > 0 && (
            <p className="exec-cockpit-note">Partial view: decision details are restricted for {restrictedCount} project(s).</p>
          )}
          {decisions.length ? (
            <ul className="exec-cockpit-list">
              {decisions.map((item) => (
                <AttentionRow key={item.id} item={item} onOpenBrief={onOpenBrief} />
              ))}
            </ul>
          ) : (
            <p className="exec-cockpit-note">
              {restrictedCount
                ? `Decision details are restricted for ${restrictedCount} project(s); no conclusion can be drawn for the full portfolio.`
                : "No decisions currently required."}
            </p>
          )}
        </div>

        <AttentionGroup
          title="Critical Risks / Issues"
          items={risks}
          onOpenBrief={onOpenBrief}
          compactColumns
          collapseAfter={3}
        />

        {(clientActions.length > 0 || overdue.length > 0) && (
          <div className="exec-cockpit-group-grid">
            <AttentionGroup title="Client Actions / Dependencies" items={clientActions} onOpenBrief={onOpenBrief} />
            <AttentionGroup title="Overdue Actions" items={overdue} onOpenBrief={onOpenBrief} />
          </div>
        )}
      </ReportSection>
    </div>
  );
});

/* ---------------------------- What changed ------------------------------------ */

const MOVEMENT_TONE_RANK: Record<string, number> = { danger: 0, warning: 1, info: 2, success: 3, neutral: 4 };

/**
 * Item 6 — reuses `row.movement`, the SAME post-baseline Weekly movement
 * `changesSinceMonthly()` already computes for the drill-down and the print
 * report's Latest Movement column. Nothing new is derived: each project's
 * movement is already "what changed since that project's own last Monthly
 * baseline" (approved where one exists — see `selectOfficialMonthly()`).
 */
export function WhatChangedSection({
  rows,
  onOpenBrief,
}: {
  rows: ProjectExecutiveRow[];
  onOpenBrief: OpenBrief;
}) {
  const items = rows
    .flatMap((row) => row.movement.map((item) => ({ ...item, projectId: row.project.id, projectName: row.projectName })))
    .sort((a, b) => (MOVEMENT_TONE_RANK[a.tone] ?? 9) - (MOVEMENT_TONE_RANK[b.tone] ?? 9))
    .slice(0, 6);

  return (
    <ReportSection title="What Changed Since Last Approved Period">
      {items.length ? (
        <ul className="exec-cockpit-list">
          {items.map((item: MovementItem & { projectId: string; projectName: string }) => (
            <li key={`${item.projectId}-${item.id}`}>
              <button type="button" className="exec-cockpit-row" onClick={() => onOpenBrief(item.projectId)}>
                <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
                <span className="exec-cockpit-row-text">
                  {item.weekNumber ? `W${item.weekNumber} · ` : ""}
                  {item.text}
                </span>
                <span className="exec-cockpit-row-meta">
                  <b>{item.projectName}</b>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="exec-cockpit-note">
          No material change recorded since each project&rsquo;s last reported Monthly baseline.
        </p>
      )}
    </ReportSection>
  );
}

/* ----------------------------- Analytics --------------------------------------- */

/**
 * The panels worth a President's screen time — everything else is still in
 * the printed report, in full, as the formal appendix. Adds Variance by
 * Project and the Decision/Risk/Client Action breakdown to last pass's set,
 * per the visual-refinement brief's preferred chart list.
 */
const COCKPIT_PANEL_IDS = new Set(["health", "planned-actual", "variance", "trend", "milestone-status", "attention"]);

/**
 * Item 5 — reduce, don't expand. Screen shows only the panels named in the
 * brief, and only the ones that actually have data this period; print keeps
 * the complete panel set unchanged (`PortfolioAnalytics` in
 * `executive-document.tsx`).
 */
export function CockpitAnalytics({ panels }: { panels: ExecPanel[] }) {
  const curated = panels.filter((panel) => {
    if (!COCKPIT_PANEL_IDS.has(panel.id) || panel.kind === "empty") return false;
    /*
     * The Management Attention exception panel (`id: "attention"`) always
     * returns a real `kind: "exception"` panel, never `kind: "empty"` — it
     * has five zero-able counters, not a single missing-data case. A ring of
     * five zeroes is not a meaningful chart; let the other curated panels
     * use the space instead. Print's full appendix (`PortfolioAnalytics`)
     * is unaffected and still shows it.
     */
    if (panel.kind === "exception" && panel.total === 0) return false;
    return true;
  });
  if (curated.length === 0) return null;

  return (
    <ReportSection title="Portfolio Analytics" note="Only panels with real data for this period are shown.">
      <ExecutiveAnalytics panels={curated} />
    </ReportSection>
  );
}

/* ------------------------------- Notes ----------------------------------------- */

/** Item 10 (governance) — kept, but low in the hierarchy and never offering
    authoring controls to a Viewer (`canManage` is the caller's real write
    authority). */
export function CockpitNotes({
  notes,
  availability,
  canManage,
  onChanged,
  projectNameOf,
  scopeOptions,
}: {
  notes: ExecutiveNote[];
  availability: NotesAvailability;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  projectNameOf: (id: string) => string;
  scopeOptions: { id: string; name: string }[];
}) {
  return (
    <ReportSection title="Executive Notes" note="Authored at Executive level. Weekly and Monthly records are never changed.">
      <ExecutiveNotesPanel
        notes={notes}
        availability={availability}
        canManage={canManage}
        onChanged={onChanged}
        showProjectColumn
        projectNameOf={projectNameOf}
        scopeOptions={scopeOptions}
      />
    </ReportSection>
  );
}
