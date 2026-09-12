"use client";

import * as React from "react";
import { Plus, Save, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ENTRY_STATUS_META } from "@/lib/constants";
import { eligibleOwners, projectScopeItemIds, projectSystems } from "@/features/weekly-reports/project-scope";
import { useHierarchyTerms } from "@/features/weekly-reports/use-hierarchy-terms";
import { monthlyReportService } from "@/services/monthly-report-service";
import type { EntryStatus, MonthlyComment, Project } from "@/types";

export const MONTHLY_UPDATE_TYPE_OPTIONS = [
  ["progress_update", "Progress Update"],
  ["achievement", "Achievement"],
  ["challenge_constraint", "Challenge / Constraint"],
  ["risk_issue", "Risk / Issue"],
  ["action", "Client Action / Pending Approval"],
  ["decision_management_support", "Decision / Management Support"],
  ["next_month_plan", "Next Month Plan"],
  ["general", "General"],
] as const;

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const STATUS_OPTIONS = [...(Object.keys(ENTRY_STATUS_META) as EntryStatus[]), "pending"] as const;

interface MonthlyCommentFormProps {
  reportId: string;
  project: Project | null;
  departments: { id: string; name: string }[];
  disciplines: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
  onSaved: () => Promise<void>;
  comment?: MonthlyComment;
  defaultType?: MonthlyComment["updateType"];
  buttonLabel?: string;
  onCancel?: () => void;
  /** Render the editor immediately, when the caller owns the open/close state. */
  forceOpen?: boolean;
  /**
   * Which round is authoring this comment. Department input is recorded as
   * `monthly_department` so "who said this, and in which round?" stays
   * answerable; Project Control's own additions keep the existing default.
   * Only applies to a NEW comment — an existing one keeps the source it was
   * created with.
   */
  sourceKind?: "monthly_manual" | "monthly_department";
  /**
   * Pin the comment to one department and take the picker away.
   *
   * The department round is a department answering for itself, so the scope is
   * already known and must not be re-chosen. `monthly_comments` RLS refuses a
   * department the author cannot reach independently of this.
   */
  lockedDepartmentId?: string;
}

export function MonthlyCommentForm(props: MonthlyCommentFormProps) {
  const { comment, buttonLabel = "Add Monthly Comment", forceOpen = false } = props;
  const [isCreating, setIsCreating] = React.useState(false);
  const open = Boolean(comment) || isCreating || forceOpen;

  if (!open && !comment) {
    return (
      <Button type="button" onClick={() => setIsCreating(true)}>
        <Plus />
        {buttonLabel}
      </Button>
    );
  }

  return <MonthlyCommentEditor key={comment?.id ?? `new:${props.defaultType ?? "progress_update"}`} {...props} onClose={() => {
    setIsCreating(false);
    props.onCancel?.();
  }} />;
}

function MonthlyCommentEditor({
  reportId,
  project,
  departments,
  disciplines,
  contacts,
  onSaved,
  comment,
  defaultType,
  sourceKind,
  lockedDepartmentId,
  onClose,
}: MonthlyCommentFormProps & { onClose: () => void }) {
  const [saving, setSaving] = React.useState(false);
  const [type, setType] = React.useState<MonthlyComment["updateType"]>(comment?.updateType ?? defaultType ?? "progress_update");
  const [departmentId, setDepartmentId] = React.useState(lockedDepartmentId ?? comment?.departmentId ?? "");
  const [systemId, setSystemId] = React.useState(comment?.systemId ?? "");
  const [disciplineId, setDisciplineId] = React.useState(comment?.disciplineId ?? "");
  const [responsibleContactId, setResponsibleContactId] = React.useState(comment?.responsibleContactId ?? "");
  const [targetDate, setTargetDate] = React.useState(comment?.targetDate ?? "");
  const [priority, setPriority] = React.useState<MonthlyComment["priority"]>(comment?.priority ?? "low");
  const [status, setStatus] = React.useState<MonthlyComment["status"]>(comment?.status ?? "open");
  const [includeInFinal, setIncludeInFinal] = React.useState(comment?.includeInFinal ?? true);
  const [text, setText] = React.useState(comment?.presentationText || comment?.originalText || "");
  const terms = useHierarchyTerms(project);
  const availableSystems = projectSystems(project, departmentId || undefined);
  const availableDisciplines = projectScopeItemIds(project, departmentId || undefined, systemId || undefined);
  const owners = eligibleOwners(project, { departmentId, systemId, disciplineId });
  const nameOf = (id: string, rows: { id: string; name: string }[]) => rows.find((row) => row.id === id)?.name ?? "Unknown";

  const save = async () => {
    if (!text.trim()) {
      toast.error("Comment text is required.");
      return;
    }
    setSaving(true);
    try {
      await monthlyReportService.saveComment(reportId, {
        id: comment?.id,
        // New comments only: an existing row keeps the source it was created
        // with, and the service never lets a caller claim a Weekly source.
        ...(comment ? {} : { sourceKind }),
        updateType: type,
        originalText: text,
        presentationText: comment?.sourceKind === "weekly" ? text : undefined,
        departmentId: departmentId || undefined,
        systemId: systemId || undefined,
        disciplineId: disciplineId || undefined,
        responsibleContactId: responsibleContactId || undefined,
        targetDate: targetDate || undefined,
        priority,
        status,
        includeInFinal,
        escalateToManagement: type === "decision_management_support",
        isMajorAchievement: type === "achievement",
      });
      await onSaved();
      onClose();
      toast.success(comment ? "Monthly comment updated." : "Monthly comment saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Monthly comment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="monthly-comment-editor">
      <div className="monthly-comment-editor-head">
        <div>
          <b>{comment ? "Edit Monthly Comment" : "Add Monthly Comment"}</b>
          <span>{comment?.sourceKind === "weekly" ? "Monthly wording only. The original Weekly source remains unchanged." : "Create a month-level update against the project or an assigned scope item."}</span>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel Monthly comment" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="monthly-comment-editor-grid">
        <Field label="Category">
          <select value={type} onChange={(event) => setType(event.target.value as MonthlyComment["updateType"])}>
            {MONTHLY_UPDATE_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Department">
          {lockedDepartmentId ? (
            /* Scope already decided by whose round this is. Rendered as text so
               it is visible and unarguable rather than a disabled control that
               looks like it could be changed. */
            <p className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm">
              {nameOf(lockedDepartmentId, departments)}
            </p>
          ) : (
            <select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setSystemId(""); setDisciplineId(""); setResponsibleContactId(""); }}>
              <option value="">Project-level</option>
              {(project?.departments ?? []).map((item) => <option key={item.departmentId} value={item.departmentId}>{nameOf(item.departmentId, departments)}</option>)}
            </select>
          )}
        </Field>
        <Field label="System">
          <select value={systemId} disabled={!departmentId} onChange={(event) => { setSystemId(event.target.value); setDisciplineId(""); setResponsibleContactId(""); }}>
            <option value="">Not specified</option>
            {availableSystems.map((item) => <option key={item.systemId} value={item.systemId}>{item.name}</option>)}
          </select>
        </Field>
        <Field label={terms.singular}>
          <select value={disciplineId} disabled={!departmentId} onChange={(event) => { setDisciplineId(event.target.value); setResponsibleContactId(""); }}>
            <option value="">Not specified</option>
            {availableDisciplines.map((id) => <option key={id} value={id}>{nameOf(id, disciplines)}</option>)}
          </select>
        </Field>
        <Field label="Responsible Person">
          <select value={responsibleContactId} onChange={(event) => setResponsibleContactId(event.target.value)}>
            <option value="">Not specified</option>
            {owners.map((owner) => <option key={owner.contactId} value={owner.contactId}>{nameOf(owner.contactId, contacts)}</option>)}
          </select>
        </Field>
        <Field label="Due Date">
          <Input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(event) => setPriority(event.target.value as MonthlyComment["priority"])}>
            {PRIORITIES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value as MonthlyComment["status"])}>
            {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </Field>
      </div>
      <label className="monthly-comment-textarea">
        Comment / Update Text
        <Textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Describe the Monthly update, decision, risk, action, or next-month priority." />
      </label>
      <label className="monthly-comment-check">
        <input type="checkbox" checked={includeInFinal} onChange={(event) => setIncludeInFinal(event.target.checked)} />
        Include in final Monthly report
      </label>
      <div className="monthly-comment-editor-actions">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" onClick={save} disabled={saving}>
          <Save />
          {saving ? "Saving..." : "Save Monthly Comment"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="monthly-comment-field">
      {label}
      <span>{children}</span>
    </label>
  );
}
