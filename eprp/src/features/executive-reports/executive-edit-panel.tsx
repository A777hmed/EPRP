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
import type { Contact } from "@/types";
import { ExecutiveNotesPanel } from "./executive-notes-panel";
import type { ExecutiveNote, NotesAvailability } from "./executive-notes";
import { executiveRecordService, type ExecutiveReportRecord } from "./executive-record";
import { SignatoryEditor } from "./executive-signatory-panel";
import {
  isSnapshotEmpty,
  seedSnapshot,
  type Signatory,
  type SignatoryRole,
  type SignatorySnapshot,
} from "./executive-signatories";
import type { PreparedBy } from "./executive-data";

export interface ExecutiveEditPanelProps {
  month: string;
  monthLabel: string;
  record: ExecutiveReportRecord | null;
  /** The auto-drafted narrative, used as placeholder and as "restore". */
  autoDraft: string;
  contacts: Contact[];
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
          <h2>Executive content</h2>
          <span>
            Summary, notes and signatories only. Planned, Actual, SV, Schedule Health, KPIs and charts stay
            controlled by their Monthly source.
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
