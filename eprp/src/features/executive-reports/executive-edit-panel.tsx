"use client";

/**
 * Edit Mode, INSIDE the Executive Report.
 *
 * The register opens reporting periods; it is not where a report is written.
 * This panel sits above the document on the report itself, so an author edits
 * the wording while looking at the figures it describes.
 *
 * WHAT IS EDITABLE HERE IS EXACTLY WHAT THE EXECUTIVE TIER OWNS:
 *   · the Executive Summary wording
 *   · Executive Notes
 *   · the three signature blocks
 *   · the report's lifecycle status (draft/under_review/approved/locked/
 *     archived) — shown ONLY to `canManagePortfolio` (Top-Level Reporting
 *     4B). Before 4B this lived solely on the dedicated
 *     `/executive-reports/workspace` page, reachable only from the register's
 *     own Edit action; once that action was removed for the read-only
 *     register, this panel became the only in-app path left, so the SAME
 *     control (same statuses, same `executiveRecordService.update()` call)
 *     was added here rather than reintroducing a register write affordance.
 *
 * Everything else is absent by construction, not merely disabled. Planned %,
 * Actual %, SV, Schedule Health, the KPI strip, every chart and every
 * Monthly-derived portfolio metric are re-derived from approved Monthly data on
 * each load and have no control here at all — there is no field to type into
 * and no code path that writes one. Correcting a figure means revising the
 * Monthly Report it came from (`03_REPORTING_ARCHITECTURE.md` Law 1).
 *
 * The whole panel carries `print:hidden`: editing furniture never reaches paper.
 */

import * as React from "react";
import { RotateCcw, Save, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared";
import type { Contact } from "@/types";
import { ExecutiveNotesPanel } from "./executive-notes-panel";
import type { ExecutiveNote, NotesAvailability } from "./executive-notes";
import {
  executiveRecordService,
  EXECUTIVE_STATUS_LABEL,
  type ExecutiveReportRecord,
  type ExecutiveReportStatus,
} from "./executive-record";
import { SignatoryEditor } from "./executive-signatory-panel";
import {
  isSnapshotEmpty,
  seedSnapshot,
  type Signatory,
  type SignatoryRole,
  type SignatorySnapshot,
} from "./executive-signatories";
import type { PreparedBy } from "./executive-data";

/** Lifecycle order, matching the workspace's own `STATUSES` exactly. */
const STATUSES: ExecutiveReportStatus[] = ["draft", "under_review", "approved", "locked", "archived"];

export interface ExecutiveEditPanelProps {
  month: string;
  monthLabel: string;
  record: ExecutiveReportRecord | null;
  /** The auto-drafted narrative, used as placeholder and as "restore". */
  autoDraft: string;
  contacts: Contact[];
  /**
   * PORTFOLIO management — Edit, Archive, Delete of the stored record.
   * Global authorities only (mirrors `executive_can_manage()`, the same
   * predicate `executive_reports_update`'s RLS already requires for ANY
   * write here, lifecycle included). Gates the Report status control ONLY:
   * Summary/Signatories/Notes keep their existing, broader `onClose`/save
   * reach exactly as before this control was added — this prop widens
   * nothing, it only decides whether ONE MORE field renders.
   */
  canManagePortfolio: boolean;
  /** Derived preparers, used to seed an unsaved period. */
  derivedPreparedBy: PreparedBy;
  notes: ExecutiveNote[];
  notesAvailability: NotesAvailability;
  canManageNotes: boolean;
  onNotesChanged: () => Promise<void> | void;
  projectOptions: { id: string; name: string }[];
  projectNameOf: (id: string) => string;
  /** Live preview while typing, so the document reflects the draft. */
  onDraftSummary: (value: string | undefined) => void;
  onDraftSignatories: (value: SignatorySnapshot) => void;
  onSaved: (record: ExecutiveReportRecord) => void;
  onClose: () => void;
}

export function ExecutiveEditPanel(props: ExecutiveEditPanelProps) {
  const { record, autoDraft, month, onDraftSummary, onDraftSignatories } = props;

  const [summary, setSummary] = React.useState(record?.executiveSummary ?? "");
  const [snapshot, setSnapshot] = React.useState<SignatorySnapshot>(() =>
    seedSnapshot(record?.signatories ?? {}, props.derivedPreparedBy)
  );
  /*
   * Only ever read/written when `canManagePortfolio` — a viewer without that
   * authority never sees this control, and `save()` below only includes it
   * in the update when it does. Unauthorized either way, RLS
   * (`executive_reports_update`) is the actual boundary: this is presentation
   * only, matching every other write gate in this module.
   */
  const [status, setStatus] = React.useState<ExecutiveReportStatus>(record?.status ?? "draft");
  const [saving, setSaving] = React.useState(false);

  /*
   * The document below re-renders as the author types, so what they are
   * approving is what they are looking at.
   *
   * The parent is notified from the CHANGE HANDLERS rather than from an effect:
   * pushing state upward in an effect makes every keystroke a two-pass render
   * for the whole report, charts included. An empty summary reverts to the
   * auto-draft rather than previewing a blank section.
   */
  const editSummary = (value: string) => {
    setSummary(value);
    onDraftSummary(value.trim() ? value.trim() : undefined);
  };

  const setRole = (role: SignatoryRole, next: Signatory[]) => {
    const updated = { ...snapshot, [role]: next };
    setSnapshot(updated);
    onDraftSignatories(updated);
  };

  const cancel = () => {
    // Drop the preview so the document returns to what is actually stored.
    onDraftSummary(undefined);
    onDraftSignatories(record?.signatories ?? {});
    props.onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      // Created on FIRST SAVE, not on opening the editor — looking at a period
      // should not litter the register with empty records.
      const target = record ?? (await executiveRecordService.ensure(month));
      const next = await executiveRecordService.update(target.id, {
        executiveSummary: summary.trim() ? summary.trim() : null,
        signatories: snapshot,
        // Only ever sent when the control is rendered, i.e. `canManagePortfolio`
        // — an unauthorized viewer's `status` state never leaves "draft"'s
        // seed because the field that would change it does not exist for them.
        ...(props.canManagePortfolio ? { status } : {}),
      });
      props.onSaved(next);
      toast.success("Executive Report saved. No Weekly or Monthly record was changed.");
      props.onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the Executive Report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="exec-edit-panel print:hidden" aria-label="Edit Executive Report">
      <header className="exec-edit-head">
        <div>
          <p className="monthly-eyebrow">Edit Mode · {props.monthLabel}</p>
          <h2>Executive content{props.canManagePortfolio ? " & report status" : ""}</h2>
          <span>
            {props.canManagePortfolio
              ? "Summary, notes, signatories and report status. Planned, Actual, SV, Schedule Health, KPIs and charts stay controlled by their Monthly source."
              : "Summary, notes and signatories only. Planned, Actual, SV, Schedule Health, KPIs and charts stay controlled by their Monthly source."}
          </span>
        </div>
        <div className="exec-edit-actions">
          <Button onClick={save} disabled={saving}>
            <Save aria-hidden />
            {saving ? "Saving…" : "Save Changes"}
          </Button>
          <Button variant="outline" onClick={cancel} disabled={saving}>
            <X aria-hidden />
            Cancel
          </Button>
        </div>
      </header>

      <div className="exec-edit-body">
        <div className="exec-edit-block">
          <div className="monthly-mini-heading">
            <span>Executive Summary</span>
            <small>Leave blank to use the auto-drafted narrative</small>
          </div>
          <textarea
            className="exec-ws-summary"
            rows={7}
            value={summary}
            placeholder={autoDraft}
            onChange={(event) => editSummary(event.target.value)}
            aria-label="Executive Summary"
          />
          <div className="exec-ws-summary-actions">
            <Button size="sm" variant="outline" onClick={() => editSummary(autoDraft)}>
              <RotateCcw aria-hidden />
              Use auto-draft
            </Button>
          </div>
        </div>

        <div className="exec-edit-block">
          <div className="monthly-mini-heading">
            <span>Signatories</span>
            <small>
              Saved as a snapshot — later edits to Contacts will not change an issued report
            </small>
          </div>
          <SignatoryEditor snapshot={snapshot} contacts={props.contacts} onChange={setRole} />
          {isSnapshotEmpty(snapshot) && (
            <p className="exec-tab-note">
              With nothing assigned the sign-off page prints blank signature lines for completion by hand.
            </p>
          )}
        </div>

        {/*
          Lifecycle management — the one thing this panel did NOT cover before
          Top-Level Reporting 4B removed the register's own Edit action, which
          had been the only in-app path to it (via `/executive-reports/
          workspace`). Portfolio management only: mirrors `executive_can_manage()`,
          the same predicate `executive_reports_update`'s RLS already requires
          for every write this panel makes, lifecycle included — this is the
          identical transition set and the identical service call
          `executive-workspace.tsx` uses, not a second implementation of either.
        */}
        {props.canManagePortfolio && (
          <div className="exec-edit-block">
            <div className="monthly-mini-heading">
              <span>Report status</span>
              <small>Approved and Locked reports cannot be deleted — Archive withdraws one from active use instead</small>
            </div>
            <div className="exec-ws-state">
              <StatusBadge tone={status === "approved" || status === "locked" ? "success" : "warning"}>
                {EXECUTIVE_STATUS_LABEL[status]}
              </StatusBadge>
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
            </div>
          </div>
        )}

        <div className="exec-edit-block">
          <div className="monthly-mini-heading">
            <span>Executive Notes</span>
            <small>Authored at Executive level — no Weekly or Monthly record is changed</small>
          </div>
          <ExecutiveNotesPanel
            notes={props.notes}
            availability={props.notesAvailability}
            canManage={props.canManageNotes}
            onChanged={props.onNotesChanged}
            showProjectColumn
            projectNameOf={props.projectNameOf}
            scopeOptions={props.projectOptions}
          />
        </div>
      </div>
    </section>
  );
}
