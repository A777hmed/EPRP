"use client";

/**
 * Executive portfolio screens: the live dashboard (`/executive-reports`) and the
 * print stage (`/executive-reports/preview`).
 *
 * Both compose the SAME `ExecutiveDocument` from the same view model, so what a
 * reader sees on screen and what leadership prints cannot drift apart. Only the
 * surrounding furniture differs — filters and navigation on screen, a print
 * button on the preview, neither of them on paper.
 *
 * There is no register of historical Executive Reports here, deliberately: this
 * increment persists nothing, so a register would list report numbers, statuses
 * and revisions that do not exist. The portfolio view IS the page.
 */

import * as React from "react";
import Link from "next/link";
import { FilePenLine, Printer, ShieldAlert, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import type { ProjectType } from "@/types";
import {
  EXEC_HEALTH_META,
  EXEC_HEALTH_ORDER,
  aggregatePortfolio,
  byAttention,
  draftExecutiveNarrative,
  monthLabelOf,
  resolvePreparedBy,
  type ExecHealth,
  type PreparedBy,
  type ProjectExecutiveRow,
} from "./executive-data";
import { ExecutiveEditPanel } from "./executive-edit-panel";
import { resolveSignatories, type SignatorySnapshot } from "./executive-signatories";
import { buildExecutivePanels } from "./executive-panels";
import { ExecutiveDocument, type ExecutiveDocumentModel } from "./executive-document";
import { emptyPortfolioReason, type ExecutiveScopeInput } from "./executive-scope";
import { useExecutivePortfolio } from "./use-executive-portfolio";

export interface ExecutiveViewerProps {
  allowed: boolean;
  deniedReason?: string;
  contactId: string | null;
  isAdmin: boolean;
  viewerName?: string;
  roleLabel?: string;
  /** Reporting period selected in the register, via `?month=`. */
  requestedMonth?: string;
}

/* --------------------------------- Denied ---------------------------------- */

export function ExecutiveDenied({ reason }: { reason?: string }) {
  return (
    <div className="exec-denied">
      <EmptyState
        title="Executive portfolio unavailable"
        description={
          reason ??
          "The Executive portfolio is limited to Project Control and Executive accounts."
        }
        icon={ShieldAlert}
      />
    </div>
  );
}

/* --------------------------------- Filters --------------------------------- */

interface FilterState {
  projectId: string;
  clientId: string;
  managerId: string;
  projectTypeId: string;
  health: string;
}

const EMPTY_FILTERS: FilterState = { projectId: "", clientId: "", managerId: "", projectTypeId: "", health: "" };

function applyFilters(rows: ProjectExecutiveRow[], filters: FilterState): ProjectExecutiveRow[] {
  return rows.filter((row) => {
    if (filters.projectId && row.project.id !== filters.projectId) return false;
    if (filters.clientId && row.project.clientId !== filters.clientId) return false;
    if (filters.managerId && row.project.projectManagerId !== filters.managerId) return false;
    if (filters.projectTypeId && row.project.projectTypeId !== filters.projectTypeId) return false;
    if (filters.health && row.reading.health !== (filters.health as ExecHealth)) return false;
    return true;
  });
}

/* ------------------------------- View model -------------------------------- */

/**
 * Compose the document model from the loaded portfolio and the on-screen
 * filters.
 *
 * Aggregates, charts and the narrative are all computed from the FILTERED rows,
 * so a filtered portfolio reports its own position rather than the whole
 * estate's — and every one of them declares its basis, so a filtered figure is
 * never mistaken for the full portfolio.
 */
function useDocumentModel(
  portfolio: ReturnType<typeof useExecutivePortfolio>,
  filters: FilterState,
  viewer: ExecutiveViewerProps,
  authoring?: {
    acceptedSummary?: string;
    onAcceptSummary: (text: string) => void;
    /** Unsaved signatory edits, so the document previews what is being typed. */
    draftSignatories?: SignatorySnapshot;
  }
): {
  model: ExecutiveDocumentModel;
  filtered: ProjectExecutiveRow[];
  preparedBy: PreparedBy;
} {
  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), []);

  return React.useMemo(() => {
    const filtered = applyFilters(portfolio.rows, filters).sort(byAttention);
    const aggregate = aggregatePortfolio(filtered);
    const monthLabel = portfolio.month ? monthLabelOf(portfolio.month) : "No reporting period";
    // From project responsibility, not from `viewer` — the signed-in account is
    // not the business preparer of the report.
    const preparedBy = resolvePreparedBy(filtered, portfolio.contacts);

    const model: ExecutiveDocumentModel = {
      month: portfolio.month,
      monthLabel,
      rows: filtered,
      aggregate,
      narrative: draftExecutiveNarrative({
        rows: filtered,
        aggregate,
        monthLabel,
        // Only notes explicitly flagged for the summary. An Executive Note is
        // authored commentary and never silently joins the narrative.
        notes: portfolio.notes.filter(
          (note) =>
            note.includeInSummary &&
            (!note.projectId || filtered.some((row) => row.project.id === note.projectId))
        ),
      }),
      panels: buildExecutivePanels({
        rows: filtered,
        aggregate,
        allMonthlies: portfolio.allMonthlies,
        visibleProjectIds: new Set(filtered.map((row) => row.project.id)),
        // Bounds the official trend at the selected period — a later Monthly is
        // not part of this period's position.
        month: portfolio.month,
      }),
      milestones: filtered.flatMap((row) => row.milestones),
      lastUpdated: portfolio.lastUpdated,
      today,
      movementWeekLimit: portfolio.movementWeekLimit,
      // Portfolio notes plus notes for the projects currently on screen, so a
      // filtered view does not carry commentary about projects it excludes.
      notes: portfolio.notes.filter(
        (note) => !note.projectId || filtered.some((row) => row.project.id === note.projectId)
      ),
      notesAvailability: portfolio.notesAvailability,
      canManageNotes: viewer.allowed,
      onNotesChanged: portfolio.reloadNotes,
      preparedBy,
      /*
       * Signatories: unsaved edits first so Edit Mode previews live, then the
       * report's own saved SNAPSHOT, then derivation for Prepared By only.
       * Reviewed and Approved are never derived — see `resolveSignatories()`.
       */
      signatories: resolveSignatories(
        authoring?.draftSignatories ?? portfolio.record?.signatories ?? {},
        preparedBy
      ),
      /*
       * Precedence: a draft accepted in this session, else the SAVED Executive
       * wording, else the auto-draft. The saved record is what makes the
       * workspace's Edit meaningful — without it the report would ignore what
       * the author wrote.
       */
      acceptedSummary: authoring?.acceptedSummary ?? portfolio.record?.executiveSummary,
      onAcceptSummary: authoring?.onAcceptSummary,
    };

    return { model, filtered, preparedBy };
  }, [portfolio, filters, today, viewer, authoring]);
}

/* ------------------------------ Control bar -------------------------------- */

function ControlBar({
  portfolio,
  filters,
  setFilters,
  showPrintLink,
  editing,
  onEdit,
}: {
  portfolio: ReturnType<typeof useExecutivePortfolio>;
  filters: FilterState;
  setFilters: (next: FilterState) => void;
  showPrintLink: boolean;
  /** Editing is entered from the report itself, not only from the register. */
  editing?: boolean;
  /** Absent when the viewer may not author, or there is nothing to edit. */
  onEdit?: () => void;
}) {
  const { records: projectTypes } = useMasterData("projectType");

  // Options come from the projects actually in view, so a filter can never
  // offer a client or a manager the viewer has no project with.
  const clientOptions = React.useMemo(() => {
    const ids = new Set(portfolio.projects.map((project) => project.clientId));
    return portfolio.clients.filter((client) => ids.has(client.id));
  }, [portfolio.projects, portfolio.clients]);

  const managerOptions = React.useMemo(() => {
    const ids = new Set(portfolio.projects.map((project) => project.projectManagerId).filter(Boolean));
    return portfolio.contacts.filter((contact) => ids.has(contact.id));
  }, [portfolio.projects, portfolio.contacts]);

  const typeOptions = React.useMemo(() => {
    const ids = new Set(portfolio.projects.map((project) => project.projectTypeId).filter(Boolean));
    return (projectTypes as ProjectType[]).filter((type) => ids.has(type.id));
  }, [portfolio.projects, projectTypes]);

  const dirty = Object.values(filters).some(Boolean);

  return (
    <div className="exec-control-bar print:hidden">
      <div className="exec-control-title">
        <p>Executive Reporting</p>
        <h1>Project Portfolio Executive Report</h1>
        <span>Live view composed from approved Monthly Reports, with the latest Weekly movement after the baseline.</span>
      </div>

      <div className="exec-control-actions">
        <label className="exec-control-period">
          <span>Reporting Period</span>
          {portfolio.availableMonths.length ? (
            <select value={portfolio.month} onChange={(event) => portfolio.setMonth(event.target.value)}>
              {portfolio.availableMonths.map((month) => (
                <option key={month} value={month}>
                  {monthLabelOf(month)}
                </option>
              ))}
            </select>
          ) : (
            <b className="exec-control-empty">No reporting periods</b>
          )}
        </label>

        {onEdit && (
          <Button className="exec-control-button" onClick={onEdit} disabled={editing}>
            <FilePenLine />
            {editing ? "Editing…" : "Edit Report"}
          </Button>
        )}

        {showPrintLink && (
          <Button asChild className="exec-control-button is-primary">
            <Link href="/executive-reports/preview">
              <Printer />
              Print / Export PDF
            </Link>
          </Button>
        )}
      </div>

      <div className="exec-filter-row">
        <span className="exec-filter-label">
          <SlidersHorizontal aria-hidden />
          Filters
        </span>

        <select
          aria-label="Filter by project"
          value={filters.projectId}
          onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}
        >
          <option value="">All projects</option>
          {portfolio.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by client"
          value={filters.clientId}
          onChange={(event) => setFilters({ ...filters, clientId: event.target.value })}
        >
          <option value="">All clients</option>
          {clientOptions.map((client) => (
            <option key={client.id} value={client.id}>
              {client.shortName ?? client.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by project manager"
          value={filters.managerId}
          onChange={(event) => setFilters({ ...filters, managerId: event.target.value })}
        >
          <option value="">All managers</option>
          {managerOptions.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by project type"
          value={filters.projectTypeId}
          onChange={(event) => setFilters({ ...filters, projectTypeId: event.target.value })}
        >
          <option value="">All types</option>
          {typeOptions.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status"
          value={filters.health}
          onChange={(event) => setFilters({ ...filters, health: event.target.value })}
        >
          <option value="">All statuses</option>
          {EXEC_HEALTH_ORDER.map((health) => (
            <option key={health} value={health}>
              {EXEC_HEALTH_META[health].label}
            </option>
          ))}
        </select>

        {dirty && (
          <button type="button" className="exec-filter-clear" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Dashboard --------------------------------- */

export function ExecutivePortfolioView(props: ExecutiveViewerProps) {
  const scope = React.useMemo<ExecutiveScopeInput>(
    () => ({ contactId: props.contactId, isAdmin: props.isAdmin }),
    [props.contactId, props.isAdmin]
  );
  const portfolio = useExecutivePortfolio(scope, props.requestedMonth);
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  const [acceptedSummary, setAcceptedSummary] = React.useState<string | undefined>();
  const [editing, setEditing] = React.useState(false);
  /*
   * Unsaved edits, held here rather than in the panel so the DOCUMENT re-renders
   * as they are typed. What the author approves is what they are looking at.
   */
  const [draftSummary, setDraftSummary] = React.useState<string | undefined>();
  const [draftSignatories, setDraftSignatories] = React.useState<SignatorySnapshot | undefined>();

  const authoring = React.useMemo(
    () => ({
      acceptedSummary: draftSummary ?? acceptedSummary,
      onAcceptSummary: setAcceptedSummary,
      draftSignatories,
    }),
    [acceptedSummary, draftSummary, draftSignatories]
  );
  const { model, filtered, preparedBy } = useDocumentModel(portfolio, filters, props, authoring);

  if (!props.allowed) return <ExecutiveDenied reason={props.deniedReason} />;
  if (portfolio.loading) return <LoadingState label="Loading Executive portfolio…" />;

  const emptyReason = emptyPortfolioReason({
    totalProjects: portfolio.totalProjects,
    visibleCount: portfolio.projects.length,
    filteredCount: filtered.length,
    isAdmin: props.isAdmin,
  });

  const isEditing = editing && !emptyReason;

  /*
   * Rendered ONCE, then placed either on its own or inside the editing
   * workspace's preview pane. Edit Mode used to append the panel ABOVE this
   * element in normal flow, which stacked a full editor on top of a full report
   * and read as two pages sharing one screen.
   */
  const document = <ExecutiveDocument model={model} />;

  return (
    <div className={`monthly-screen-stage exec-stage${isEditing ? " is-editing" : ""}`}>
      <ControlBar
        portfolio={portfolio}
        filters={filters}
        setFilters={setFilters}
        showPrintLink
        editing={editing}
        onEdit={props.allowed && !emptyReason ? () => setEditing(true) : undefined}
      />

      {emptyReason ? (
        <div className="exec-empty-card">
          <EmptyState title="No portfolio data" description={emptyReason} icon={SlidersHorizontal} />
        </div>
      ) : isEditing ? (
        /*
         * One editing workspace: the author's controls on a sticky rail, the
         * document beside them as a live preview. Two panes, not two pages.
         */
        <div className="exec-edit-stage">
          <ExecutiveEditPanel
            month={portfolio.month}
            monthLabel={model.monthLabel}
            record={portfolio.record}
            autoDraft={model.narrative}
            contacts={portfolio.contacts}
            derivedPreparedBy={preparedBy}
            notes={model.notes}
            notesAvailability={portfolio.notesAvailability}
            canManageNotes={props.allowed}
            onNotesChanged={portfolio.reloadNotes}
            projectOptions={filtered.map((row) => ({ id: row.project.id, name: row.projectName }))}
            projectNameOf={(id) =>
              filtered.find((row) => row.project.id === id)?.projectName ?? "Project"
            }
            onDraftSummary={setDraftSummary}
            onDraftSignatories={setDraftSignatories}
            onSaved={(next) => {
              portfolio.applyRecord(next);
              // The saved record is now the source; drop the preview overlays so
              // the document reads from storage rather than from stale drafts.
              setDraftSummary(undefined);
              setDraftSignatories(undefined);
            }}
            onClose={() => setEditing(false)}
          />

          <div className="exec-edit-preview">
            <p className="exec-edit-preview-head print:hidden">
              Live preview — updates as you type
            </p>
            {document}
          </div>
        </div>
      ) : (
        document
      )}
    </div>
  );
}

/* ----------------------------- Print preview ------------------------------- */

export function ExecutivePreviewView(props: ExecutiveViewerProps) {
  const scope = React.useMemo<ExecutiveScopeInput>(
    () => ({ contactId: props.contactId, isAdmin: props.isAdmin }),
    [props.contactId, props.isAdmin]
  );
  const portfolio = useExecutivePortfolio(scope, props.requestedMonth);
  const { model, filtered } = useDocumentModel(portfolio, EMPTY_FILTERS, props);

  if (!props.allowed) return <ExecutiveDenied reason={props.deniedReason} />;
  if (portfolio.loading) return <LoadingState label="Preparing Executive document…" />;

  return (
    <div className="monthly-preview-stage exec-stage">
      {/* The landscape @page now travels with ExecutiveDocument, so it applies
          on the portfolio route too — not only here. */}
      <div className="monthly-preview-tools print:hidden">
        <Link href="/executive-reports">← Back to portfolio</Link>
        <div className="exec-preview-period">
          <label>
            <span>Reporting Period</span>
            <select value={portfolio.month} onChange={(event) => portfolio.setMonth(event.target.value)}>
              {portfolio.availableMonths.map((month) => (
                <option key={month} value={month}>
                  {monthLabelOf(month)}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => window.print()} disabled={filtered.length === 0}>
            <Printer />
            Print / Export PDF
          </Button>
        </div>
      </div>
      <ExecutiveDocument model={model} />
    </div>
  );
}
