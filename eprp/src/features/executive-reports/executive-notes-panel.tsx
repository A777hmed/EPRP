"use client";

/**
 * Executive Notes — the one place the Executive tier authors anything.
 *
 * Serves both altitudes from one component: `projectId` undefined writes a
 * portfolio-level note, `projectId` set writes a project-level one. Source
 * records are never touched.
 *
 * Authoring controls are gated on `canManage` (presentation) and by RLS
 * (enforcement). An unauthorized reader sees the notes and no controls.
 */

import * as React from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, StatusBadge } from "@/components/shared";
import { PRIORITY_META } from "@/lib/constants";
import type { Priority } from "@/types";
import {
  EXECUTIVE_NOTE_CATEGORIES,
  EXECUTIVE_NOTE_CATEGORY_LABEL,
  executiveNoteService,
  type ExecutiveNote,
  type ExecutiveNoteCategory,
  type NotesAvailability,
} from "./executive-notes";

export interface ExecutiveNotesPanelProps {
  /** Undefined = portfolio-level. */
  projectId?: string;
  projectName?: string;
  notes: ExecutiveNote[];
  availability: NotesAvailability;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  /** Portfolio view labels notes with their project; a drill-down need not. */
  showProjectColumn?: boolean;
  projectNameOf?: (projectId: string) => string;
  /**
   * Projects the author may scope a note to. Supplied only by the portfolio,
   * where a note can be portfolio-level OR about one project; a drill-down is
   * already scoped to its project and offers no choice.
   */
  scopeOptions?: { id: string; name: string }[];
}

const EMPTY_DRAFT = {
  category: "executive_comment" as ExecutiveNoteCategory,
  priority: "medium" as Priority,
  body: "",
  includeInSummary: true,
  includeInPrint: true,
  /** "" = portfolio level; otherwise the chosen project id. */
  scopeProjectId: "",
};

export function ExecutiveNotesPanel({
  projectId,
  projectName,
  notes,
  availability,
  canManage,
  onChanged,
  showProjectColumn = false,
  projectNameOf,
  scopeOptions,
}: ExecutiveNotesPanelProps) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState(EMPTY_DRAFT);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ExecutiveNote | null>(null);

  const scopeLabel = projectId ? projectName ?? "this project" : "the portfolio";

  const startNew = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setOpen(true);
  };

  const startEdit = (note: ExecutiveNote) => {
    setEditing(note.id);
    setDraft({
      category: note.category,
      priority: note.priority,
      body: note.body,
      includeInSummary: note.includeInSummary,
      includeInPrint: note.includeInPrint,
      scopeProjectId: note.projectId ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft.body.trim()) {
      toast.error("An Executive Note needs some text.");
      return;
    }
    setSaving(true);
    try {
      await executiveNoteService.save({
        id: editing ?? undefined,
        // A drill-down is already scoped to its project; the portfolio lets the
        // author choose, and "" means the note is about the portfolio itself.
        projectId: scopeOptions ? draft.scopeProjectId || undefined : projectId,
        category: draft.category,
        priority: draft.priority,
        body: draft.body,
        includeInSummary: draft.includeInSummary,
        includeInPrint: draft.includeInPrint,
      });
      await onChanged();
      setOpen(false);
      setEditing(null);
      setDraft(EMPTY_DRAFT);
      toast.success(editing ? "Executive Note updated." : "Executive Note added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the Executive Note.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await executiveNoteService.remove(deleting.id);
      await onChanged();
      toast.success("Executive Note deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the Executive Note.");
    }
  };

  if (availability === "migration_pending") {
    /*
     * Management wording only. The technical cause — an unapplied migration —
     * is written to the console for an administrator and deliberately kept out
     * of the executive document, where a migration filename means nothing to
     * the reader and looks like a fault in the report.
     */
    return (
      <div className="exec-notes-pending">
        <b>Executive Notes are not available yet</b>
        <span>Executive-level notes will become available after the feature is activated.</span>
      </div>
    );
  }

  if (availability === "error") {
    return (
      <div className="exec-notes-pending">
        <b>Executive Notes could not be loaded</b>
        <span>The notes store returned an error. Existing report content is unaffected.</span>
      </div>
    );
  }

  return (
    <div className="exec-notes">
      {canManage && (
        <div className="exec-notes-toolbar print:hidden">
          <Button size="sm" onClick={startNew}>
            <Plus />
            Add Executive Note
          </Button>
          <span>Authored at Executive level. Weekly and Monthly records are never changed.</span>
        </div>
      )}

      {open && canManage && (
        <div className="exec-note-editor print:hidden">
          <div className="exec-note-editor-head">
            <b>{editing ? "Edit Executive Note" : `New Executive Note — ${scopeLabel}`}</b>
            <button type="button" aria-label="Close editor" onClick={() => setOpen(false)}>
              <X />
            </button>
          </div>

          <div className="exec-note-editor-grid">
            {scopeOptions && (
              <label className="exec-note-scope">
                Scope
                <select
                  value={draft.scopeProjectId}
                  onChange={(event) => setDraft({ ...draft, scopeProjectId: event.target.value })}
                >
                  <option value="">Portfolio Level</option>
                  {scopeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Category
              <select
                value={draft.category}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value as ExecutiveNoteCategory })
                }
              >
                {EXECUTIVE_NOTE_CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={draft.priority}
                onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
              >
                {(["critical", "high", "medium", "low"] as Priority[]).map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_META[value].label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="exec-note-body">
            Note
            <textarea
              rows={3}
              value={draft.body}
              placeholder="Management commentary for this reporting period."
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </label>

          <div className="exec-note-flags">
            <label>
              <input
                type="checkbox"
                checked={draft.includeInSummary}
                onChange={(event) => setDraft({ ...draft, includeInSummary: event.target.checked })}
              />
              Include in Executive Summary
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.includeInPrint}
                onChange={(event) => setDraft({ ...draft, includeInPrint: event.target.checked })}
              />
              Include in Print
            </label>
          </div>

          <div className="exec-note-editor-actions">
            <Button size="sm" onClick={save} disabled={saving || !draft.body.trim()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add note"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {notes.length ? (
        <ul className="exec-note-list">
          {notes.map((note) => (
            // A note excluded from print is still shown on screen; the flag
            // controls the printed document, not the working view.
            <li key={note.id} className={note.includeInPrint ? undefined : "print:hidden"}>
              <div className="exec-note-head">
                <span className="monthly-pill">{EXECUTIVE_NOTE_CATEGORY_LABEL[note.category]}</span>
                <StatusBadge tone={PRIORITY_META[note.priority].tone}>
                  {PRIORITY_META[note.priority].label}
                </StatusBadge>
                {showProjectColumn && (
                  <b>{note.projectId ? projectNameOf?.(note.projectId) ?? "Project" : "Portfolio"}</b>
                )}
                {note.includeInSummary && <span className="exec-flag exec-flag-new">In summary</span>}
                {!note.includeInPrint && <span className="exec-flag exec-flag-internal">Screen only</span>}
                {canManage && (
                  <span className="exec-note-actions print:hidden">
                    <button type="button" aria-label="Edit note" onClick={() => startEdit(note)}>
                      <Pencil />
                    </button>
                    <button type="button" aria-label="Delete note" onClick={() => setDeleting(note)}>
                      <Trash2 />
                    </button>
                  </span>
                )}
              </div>
              <p>{note.body}</p>
              <small>
                {note.createdByName ?? "Unknown author"} · {format(parseISO(note.createdAt), "dd MMM yyyy")}
                {/* Only worth saying when the note has actually been edited. */}
                {note.updatedAt !== note.createdAt && note.updatedByName && (
                  <> · edited by {note.updatedByName} on {format(parseISO(note.updatedAt), "dd MMM yyyy")}</>
                )}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <div className="monthly-empty-row">No Executive Notes recorded for {scopeLabel}.</div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete this Executive Note?"
        description="The note is removed from the Executive Report. No Weekly or Monthly record is affected."
        confirmLabel="Delete note"
        onConfirm={remove}
      />
    </div>
  );
}
