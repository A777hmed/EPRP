"use client";
/* Workspace data loads from the browser services after mount. */

/**
 * The Executive workspace — `/executive-reports/workspace?month=YYYY-MM`.
 *
 * Edits EXECUTIVE-OWNED CONTENT ONLY:
 *   · the reviewed Executive Summary wording
 *   · Executive Notes
 *   · the preparer override
 *   · Executive metadata (title, confidentiality) and lifecycle state
 *
 * Every source figure — planned, actual, variance, schedule health, risks,
 * actions, milestones, Weekly movement — is shown READ-ONLY and is re-derived
 * from approved Monthly data on load. There is no control here that writes to a
 * Weekly or Monthly record, by design: correcting a figure means revising the
 * report it came from, not overtyping it at the Executive tier.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LoadingState, StatusBadge } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import type { Contact } from "@/types";
import {
  draftExecutiveNarrative,
  aggregatePortfolio,
  byAttention,
  monthLabelOf,
  resolvePreparedBy,
} from "./executive-data";
import { ExecutiveAiPanel } from "./executive-ai-panel";
import { ExecutiveNotesPanel } from "./executive-notes-panel";
import { ExecutiveDenied, type ExecutiveViewerProps } from "./executive-view";
import {
  EXECUTIVE_STATUS_LABEL,
  executiveRecordService,
  type ExecutiveReportRecord,
  type ExecutiveReportStatus,
} from "./executive-record";
import { useExecutivePortfolio } from "./use-executive-portfolio";
import type { ExecutiveScopeInput } from "./executive-scope";
import { buildExecutivePanels } from "./executive-panels";
import type { ExecutiveDocumentModel } from "./executive-document";
import { SignatoryEditor } from "./executive-signatory-panel";
import {
  resolveSignatories,
  seedSnapshot,
  type Signatory,
  type SignatoryRole,
  type SignatorySnapshot,
} from "./executive-signatories";

const STATUSES: ExecutiveReportStatus[] = ["draft", "under_review", "approved", "locked", "archived"];

export function ExecutiveWorkspaceView(props: ExecutiveViewerProps) {
  const month = props.requestedMonth;
  const scope = React.useMemo<ExecutiveScopeInput>(
    () => ({ contactId: props.contactId, isAdmin: props.isAdmin }),
    [props.contactId, props.isAdmin]
  );
  const portfolio = useExecutivePortfolio(scope, month);
  const { records: contactRecords } = useMasterData("contact");
  const contacts = contactRecords as Contact[];

  const [record, setRecord] = React.useState<ExecutiveReportRecord | null | undefined>();
  const [summary, setSummary] = React.useState("");
  /*
   * `null` means "nobody has touched the signatories yet", which is different
   * from "the author cleared them". Seeding from derivation is therefore done
   * during render below, not by writing state — otherwise removing the last
   * preparer would immediately re-add it.
   */
  const [editedSignatories, setEditedSignatories] = React.useState<SignatorySnapshot | null>(null);
  const [status, setStatus] = React.useState<ExecutiveReportStatus>("draft");
  const [saving, setSaving] = React.useState(false);

  /*
   * The record is created on FIRST EDIT, not on first view. Opening the
   * workspace to look at a period should not litter the register with empty
   * Executive records nobody asked for.
   */
  React.useEffect(() => {
    if (!month) return;
    let cancelled = false;
    executiveRecordService
      .getByMonth(month)
      .then((next) => {
        if (cancelled) return;
        setRecord(next);
        setSummary(next?.executiveSummary ?? "");
        setEditedSignatories(null);
        setStatus(next?.status ?? "draft");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "Could not load the Executive record.");
        setRecord(null);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const rows = React.useMemo(() => [...portfolio.rows].sort(byAttention), [portfolio.rows]);
  const aggregate = React.useMemo(() => aggregatePortfolio(rows), [rows]);
  const monthLabel = month ? monthLabelOf(month) : "No reporting period";

  const autoDraft = React.useMemo(
    () =>
      draftExecutiveNarrative({
        rows,
        aggregate,
        monthLabel,
        notes: portfolio.notes.filter((note) => note.includeInSummary),
      }),
    [rows, aggregate, monthLabel, portfolio.notes]
  );

  /**
   * Preparers derived from project responsibility.
   *
   * Used to SEED the signatory editor on a period nobody has saved yet, so the
   * author starts from the names the report already prints instead of an empty
   * block that would silently drop them on first save.
   */
  const derivedPreparedBy = React.useMemo(
    () => resolvePreparedBy(rows, contacts),
    [rows, contacts]
  );

  /** Untouched → seeded from the stored snapshot and derivation; touched → verbatim. */
  const signatories = React.useMemo(
    () => editedSignatories ?? seedSnapshot(record?.signatories ?? {}, derivedPreparedBy),
    [editedSignatories, record, derivedPreparedBy]
  );

  /** The model the AI panel needs. Read-only; the workspace edits text, not data. */
  const aiModel = React.useMemo<ExecutiveDocumentModel>(
    () => ({
      month: month ?? "",
      monthLabel,
      rows,
      aggregate,
      narrative: autoDraft,
      panels: buildExecutivePanels({
        rows,
        aggregate,
        allMonthlies: portfolio.allMonthlies,
        visibleProjectIds: new Set(rows.map((row) => row.project.id)),
        month: month ?? "",
      }),
      milestones: rows.flatMap((row) => row.milestones),
      lastUpdated: portfolio.lastUpdated,
      today: new Date().toISOString().slice(0, 10),
      movementWeekLimit: portfolio.movementWeekLimit,
      notes: portfolio.notes,
      notesAvailability: portfolio.notesAvailability,
      canManageNotes: props.allowed,
      onNotesChanged: portfolio.reloadNotes,
      preparedBy: derivedPreparedBy,
      signatories: resolveSignatories(signatories, derivedPreparedBy),
    }),
    [
      month,
      monthLabel,
      rows,
      aggregate,
      autoDraft,
      portfolio,
      props.allowed,
      derivedPreparedBy,
      signatories,
    ]
  );

  const setRole = React.useCallback(
    (role: SignatoryRole, next: Signatory[]) => {
      setEditedSignatories((current) => ({ ...(current ?? signatories), [role]: next }));
    },
    [signatories]
  );

  const save = async () => {
    if (!month) return;
    setSaving(true);
    try {
      const target = record ?? (await executiveRecordService.ensure(month));
      const next = await executiveRecordService.update(target.id, {
        // Empty means "fall back to the auto-drafted narrative" rather than
        // storing a blank summary.
        executiveSummary: summary.trim() ? summary.trim() : null,
        signatories,
        status,
      });
      setRecord(next);
      toast.success("Executive Report saved. No Weekly or Monthly record was changed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the Executive Report.");
    } finally {
      setSaving(false);
    }
  };

  if (!props.allowed) return <ExecutiveDenied reason={props.deniedReason} />;
  if (!month) {
    return <ExecutiveDenied reason="No reporting period was supplied. Open a period from the Executive register." />;
  }
  if (portfolio.loading || record === undefined) return <LoadingState label="Loading Executive workspace…" />;

  return (
    <div className="exec-workspace">
      <div className="exec-drilldown-head">
        <Link className="exec-back" href="/executive-reports">
          <ArrowLeft aria-hidden /> Register
        </Link>
        <div>
          <p className="monthly-eyebrow">Executive workspace · editable</p>
          <h1>{monthLabel}</h1>
          <span>
            Executive-owned content only. Weekly and Monthly values are read-only and re-read on every load.
          </span>
        </div>
        <div className="exec-drilldown-status">
          <StatusBadge tone={status === "approved" || status === "locked" ? "success" : "warning"}>
            {EXECUTIVE_STATUS_LABEL[status]}
          </StatusBadge>
          {record?.updatedByName && <small>Last edited by {record.updatedByName}</small>}
        </div>
      </div>

      {/* Read-only source position, so the author can see what they summarise. */}
      <section className="exec-ws-panel">
        <div className="monthly-mini-heading">
          <span>Source position — read only</span>
          <small>Derived from approved Monthly Reports</small>
        </div>
        <div className="exec-figure-row">
          <div className="exec-figure">
            <span>Projects</span>
            <b>{aggregate.totalProjects}</b>
          </div>
          <div className="exec-figure">
            <span>Planned</span>
            <b className="planned-value">
              {(aggregate.planned ?? aggregate.provisionalPlanned)?.toFixed(1) ?? "—"}%
            </b>
          </div>
          <div className="exec-figure">
            <span>Actual</span>
            <b className="actual-value">
              {(aggregate.actual ?? aggregate.provisionalActual)?.toFixed(1) ?? "—"}%
            </b>
          </div>
          <div className="exec-figure">
            <span>Variance</span>
            <b className="variance-value">
              {(aggregate.variance ?? aggregate.provisionalVariance)?.toFixed(1) ?? "—"}%
            </b>
          </div>
        </div>
        <p className="exec-tab-note">{aggregate.basisNote}</p>
      </section>

      <section className="exec-ws-panel">
        <div className="monthly-mini-heading">
          <span>Executive Summary</span>
          <small>Leave blank to use the auto-drafted narrative</small>
        </div>
        <textarea
          className="exec-ws-summary"
          rows={9}
          value={summary}
          placeholder={autoDraft}
          onChange={(event) => setSummary(event.target.value)}
          aria-label="Executive Summary"
        />
        <div className="exec-ws-summary-actions">
          <Button size="sm" variant="outline" onClick={() => setSummary(autoDraft)}>
            <RotateCcw />
            Use auto-draft
          </Button>
        </div>
        <ExecutiveAiPanel model={aiModel} currentText={summary || autoDraft} onAccept={setSummary} />
      </section>

      {/*
        Signatories, using the SAME control as in-report Edit Mode.
        The previous checkbox list here could only tick existing contacts, only
        covered Prepared By, and wrote a field the printed document never read —
        so an override chosen here never reached the paper. One control now
        feeds one stored snapshot.
      */}
      <section className="exec-ws-panel">
        <div className="monthly-mini-heading">
          <span>Signatories</span>
          <small>Saved as a snapshot — later edits to Contacts will not change an issued report</small>
        </div>
        <SignatoryEditor snapshot={signatories} contacts={contacts} onChange={setRole} />
      </section>

      <section className="exec-ws-panel">
        <div className="monthly-mini-heading">
          <span>Executive Notes</span>
        </div>
        <ExecutiveNotesPanel
          notes={portfolio.notes}
          availability={portfolio.notesAvailability}
          canManage={props.allowed}
          onChanged={portfolio.reloadNotes}
          showProjectColumn
          projectNameOf={(id) => rows.find((row) => row.project.id === id)?.projectName ?? "Project"}
          scopeOptions={rows.map((row) => ({ id: row.project.id, name: row.projectName }))}
        />
      </section>

      <section className="exec-ws-panel">
        <div className="monthly-mini-heading">
          <span>Report state</span>
        </div>
        <div className="exec-ws-state">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as ExecutiveReportStatus)}>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {EXECUTIVE_STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <p className="exec-tab-note">
            Approved and Locked reports cannot be deleted — the database refuses it. Archive withdraws a report from
            active use while leaving it readable.
          </p>
        </div>
      </section>

      <div className="exec-ws-actions">
        <Button onClick={save} disabled={saving}>
          <Save />
          {saving ? "Saving…" : "Save Executive Report"}
        </Button>
        <Button asChild variant="outline">
          <Link href={`/executive-reports/portfolio?month=${month}`}>Open Portfolio</Link>
        </Button>
        <span>Saves Executive-owned content only. Weekly and Monthly records are never written.</span>
      </div>
    </div>
  );
}
