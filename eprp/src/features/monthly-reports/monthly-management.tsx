"use client";

/**
 * Monthly Management Items — client actions, risks and issues, and the
 * decisions leadership is being asked for, in one authoring surface.
 *
 * **Storage**: these are `monthly_comments` rows. No new table, no new column.
 * The management "type" a user picks is expressed with the two fields the
 * schema already has — `update_type` (fixed to eight values by the
 * `monthly_comments_update_type` CHECK) and `escalate_to_management`.
 *
 * Two of the requested labels deliberately do NOT become types:
 *
 * - **Critical Issue** is a Risk / Issue carrying Priority = Critical. Making it
 *   a separate type would need a new enum value, and inferring it from priority
 *   would mean two different pickers writing the same field.
 * - **Escalation** is the `escalate_to_management` flag, offered as its own
 *   checkbox. It composes with every type rather than replacing one, which is
 *   what the column actually means.
 *
 * A Weekly-sourced row keeps its `original_text`; edits here land in
 * `presentation_text`, so the Weekly record is never rewritten.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertTriangle, Check, ClipboardList, Gavel, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared";
import { ENTRY_STATUS_META, PRIORITY_META } from "@/lib/constants";
import { eligibleOwners, projectScopeItemIds, projectSystems } from "@/features/weekly-reports/project-scope";
import { useHierarchyTerms } from "@/features/weekly-reports/use-hierarchy-terms";
import { monthlyReportService } from "@/services/monthly-report-service";
import { ReportSection } from "@/features/projects/components/sections/project-reporting-shell";
import type { EntryStatus, MonthlyComment } from "@/types";
import { EmptyRow, type MonthlyReportBundle } from "./monthly-report-document";
import { NOT_RECORDED, commentStatusMeta, nameOf } from "./monthly-data";

export interface ManagementType {
  key: string;
  label: string;
  updateType: MonthlyComment["updateType"];
  /** Set when the type itself implies management escalation. */
  escalate?: boolean;
}

export const MANAGEMENT_TYPES: ManagementType[] = [
  { key: "client_action", label: "Client Action / Pending Approval", updateType: "action" },
  { key: "risk_issue", label: "Risk / Issue", updateType: "risk_issue" },
  { key: "constraint", label: "Challenge / Constraint", updateType: "challenge_constraint" },
  { key: "decision", label: "Decision Required", updateType: "decision_management_support" },
  { key: "support", label: "Management Support", updateType: "decision_management_support", escalate: true },
];

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const STATUS_OPTIONS = [...(Object.keys(ENTRY_STATUS_META) as EntryStatus[]), "pending"] as const;

/** The update types this panel owns; everything else is an ordinary comment. */
const MANAGEMENT_UPDATE_TYPES = new Set<MonthlyComment["updateType"]>([
  "action",
  "risk_issue",
  "challenge_constraint",
  "decision_management_support",
]);

export function isManagementItem(comment: MonthlyComment): boolean {
  return MANAGEMENT_UPDATE_TYPES.has(comment.updateType) || comment.escalateToManagement;
}

/** Resolve a stored row back to the type the author picked. */
export function managementTypeOf(comment: MonthlyComment): ManagementType {
  const exact = MANAGEMENT_TYPES.find(
    (type) => type.updateType === comment.updateType && Boolean(type.escalate) === comment.escalateToManagement
  );
  if (exact) return exact;
  return (
    MANAGEMENT_TYPES.find((type) => type.updateType === comment.updateType) ?? MANAGEMENT_TYPES[1]
  );
}

/* --------------------------------- Editor ---------------------------------- */

function ManagementForm({
  bundle,
  comment,
  defaultTypeKey,
  onDone,
  onCancel,
}: {
  bundle: MonthlyReportBundle;
  comment?: MonthlyComment;
  defaultTypeKey?: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const initialType = comment ? managementTypeOf(comment) : MANAGEMENT_TYPES.find((t) => t.key === defaultTypeKey) ?? MANAGEMENT_TYPES[0];
  const [typeKey, setTypeKey] = React.useState(initialType.key);
  const [text, setText] = React.useState(comment?.presentationText || comment?.originalText || "");
  const [departmentId, setDepartmentId] = React.useState(comment?.departmentId ?? "");
  const [systemId, setSystemId] = React.useState(comment?.systemId ?? "");
  const [disciplineId, setDisciplineId] = React.useState(comment?.disciplineId ?? "");
  const [responsibleContactId, setResponsibleContactId] = React.useState(comment?.responsibleContactId ?? "");
  const [targetDate, setTargetDate] = React.useState(comment?.targetDate ?? "");
  const [priority, setPriority] = React.useState<MonthlyComment["priority"]>(comment?.priority ?? "medium");
  const [status, setStatus] = React.useState<MonthlyComment["status"]>(comment?.status ?? "open");
  const [escalate, setEscalate] = React.useState(comment?.escalateToManagement ?? Boolean(initialType.escalate));
  const [saving, setSaving] = React.useState(false);

  const terms = useHierarchyTerms(bundle.project);
  const availableSystems = projectSystems(bundle.project, departmentId || undefined);
  const availableScopeItems = projectScopeItemIds(bundle.project, departmentId || undefined, systemId || undefined);
  const owners = eligibleOwners(bundle.project, { departmentId, systemId, disciplineId });
  const type = MANAGEMENT_TYPES.find((t) => t.key === typeKey) ?? MANAGEMENT_TYPES[0];

  const changeType = (key: string) => {
    setTypeKey(key);
    const next = MANAGEMENT_TYPES.find((t) => t.key === key);
    if (next?.escalate) setEscalate(true);
  };

  const save = async () => {
    if (!text.trim()) {
      toast.error("A description of the action required is needed.");
      return;
    }
    setSaving(true);
    try {
      await monthlyReportService.saveComment(bundle.report.id, {
        id: comment?.id,
        updateType: type.updateType,
        originalText: text,
        // A Weekly-sourced row keeps its original wording; the service writes
        // this into presentation_text and leaves original_text untouched.
        presentationText: comment?.sourceKind === "weekly" ? text : undefined,
        departmentId: departmentId || undefined,
        systemId: systemId || undefined,
        disciplineId: disciplineId || undefined,
        responsibleContactId: responsibleContactId || undefined,
        targetDate: targetDate || undefined,
        priority,
        status,
        includeInFinal: comment?.includeInFinal ?? true,
        escalateToManagement: escalate,
        isMajorAchievement: false,
      });
      await onDone();
      onCancel();
      toast.success(comment ? "Management item updated." : "Management item added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the management item.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="monthly-comment-editor">
      <div className="monthly-comment-editor-head">
        <div>
          <b>{comment ? "Edit Management Item" : "Add Management Item"}</b>
          <span>
            {comment?.sourceKind === "weekly"
              ? `Imported from Weekly W${comment.weekNumber ?? "—"}. Editing changes the Monthly wording only — the Weekly record is untouched.`
              : "Recorded against this Monthly report."}
          </span>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={onCancel}>
          <X />
        </Button>
      </div>

      <div className="monthly-comment-editor-grid">
        <label className="monthly-comment-field">
          Type
          <span>
            <select value={typeKey} onChange={(event) => changeType(event.target.value)}>
              {MANAGEMENT_TYPES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="monthly-comment-field">
          Responsible / Owner
          <span>
            <select value={responsibleContactId} onChange={(event) => setResponsibleContactId(event.target.value)}>
              <option value="">Not specified</option>
              {owners.map((owner) => (
                <option key={owner.contactId} value={owner.contactId}>
                  {nameOf(owner.contactId, bundle.contacts)}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="monthly-comment-field">
          Due Date
          <span>
            <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          </span>
        </label>
        <label className="monthly-comment-field">
          Priority
          <span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as MonthlyComment["priority"])}>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_META[value].label}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="monthly-comment-field">
          Status
          <span>
            <select value={status} onChange={(event) => setStatus(event.target.value as MonthlyComment["status"])}>
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value === "pending" ? "Pending" : ENTRY_STATUS_META[value as EntryStatus].label}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="monthly-comment-field">
          Department
          <span>
            <select
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setSystemId("");
                setDisciplineId("");
                setResponsibleContactId("");
              }}
            >
              <option value="">Project-level</option>
              {(bundle.project?.departments ?? []).map((assignment) => (
                <option key={assignment.departmentId} value={assignment.departmentId}>
                  {nameOf(assignment.departmentId, bundle.departments)}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="monthly-comment-field">
          System
          <span>
            <select
              value={systemId}
              disabled={!departmentId}
              onChange={(event) => {
                setSystemId(event.target.value);
                setDisciplineId("");
                setResponsibleContactId("");
              }}
            >
              <option value="">Not specified</option>
              {availableSystems.map((system) => (
                <option key={system.systemId} value={system.systemId}>
                  {system.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="monthly-comment-field">
          {terms.singular}
          <span>
            <select value={disciplineId} disabled={!departmentId} onChange={(event) => setDisciplineId(event.target.value)}>
              <option value="">Not specified</option>
              {availableScopeItems.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id, bundle.disciplines)}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <label className="monthly-comment-textarea">
        Action Required / Description
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="What must happen, and what is being asked of whom."
        />
      </label>

      <label className="monthly-comment-check">
        <input
          type="checkbox"
          checked={escalate}
          disabled={Boolean(type.escalate)}
          onChange={(event) => setEscalate(event.target.checked)}
        />
        Escalate to management
        {type.escalate && <em> — always set for {type.label}</em>}
      </label>

      <div className="monthly-comment-editor-actions">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={saving}>
          <Check />
          {saving ? "Saving…" : comment ? "Update Item" : "Add Item"}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------- Panel ---------------------------------- */

const GROUPS: { key: string; title: string; icon: typeof ClipboardList; typeKeys: string[]; empty: string }[] = [
  {
    key: "client",
    title: "Client Action Items / Pending Approvals",
    icon: ClipboardList,
    typeKeys: ["client_action"],
    empty: "No client actions or pending approvals recorded.",
  },
  {
    key: "risk",
    title: "Critical Issues / Risks",
    icon: AlertTriangle,
    typeKeys: ["risk_issue", "constraint"],
    empty: "No risks, issues or constraints recorded.",
  },
  {
    key: "decision",
    title: "Required Decisions / Management Support",
    icon: Gavel,
    typeKeys: ["decision", "support"],
    empty: "No decisions or management support requests recorded.",
  },
];

export function MonthlyManagementPanel({ bundle, reload }: { bundle: MonthlyReportBundle; reload: () => Promise<void> }) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [addingTypeKey, setAddingTypeKey] = React.useState<string | null>(null);

  const items = bundle.comments.filter(isManagementItem);
  const closeEditors = () => {
    setEditingId(null);
    setAddingTypeKey(null);
  };

  const toggle = async (comment: MonthlyComment) => {
    try {
      await monthlyReportService.saveComment(bundle.report.id, {
        id: comment.id,
        updateType: comment.updateType,
        originalText: comment.presentationText || comment.originalText,
        presentationText: comment.presentationText,
        departmentId: comment.departmentId,
        systemId: comment.systemId,
        disciplineId: comment.disciplineId,
        priority: comment.priority,
        status: comment.status,
        responsibleContactId: comment.responsibleContactId,
        targetDate: comment.targetDate,
        includeInFinal: !comment.includeInFinal,
        escalateToManagement: comment.escalateToManagement,
        isMajorAchievement: comment.isMajorAchievement,
      });
      await reload();
      toast.success(comment.includeInFinal ? "Removed from the Monthly report." : "Restored to the Monthly report.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the item.");
    }
  };

  const remove = async (comment: MonthlyComment) => {
    try {
      await monthlyReportService.deleteComment(bundle.report.id, comment.id);
      await reload();
      toast.success("Management item deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the item.");
    }
  };

  return (
    <ReportSection
      title="Management Items"
      hint="Client actions, risks and issues, and decisions requiring management support."
      action={
        !addingTypeKey && !editingId ? (
          <Button
            onClick={() => {
              setEditingId(null);
              setAddingTypeKey("client_action");
            }}
          >
            <Plus />
            Add Item
          </Button>
        ) : undefined
      }
    >

      {addingTypeKey && (
        <div className="monthly-ws-inline-form">
          <ManagementForm bundle={bundle} defaultTypeKey={addingTypeKey} onDone={reload} onCancel={closeEditors} />
        </div>
      )}

      {GROUPS.map((group) => {
        const groupItems = items.filter((item) => group.typeKeys.includes(managementTypeOf(item).key));
        const Icon = group.icon;
        return (
          <div className="monthly-ws-group" key={group.key}>
            <div className="monthly-ws-subhead">
              <Icon aria-hidden />
              {group.title}
              <span className="monthly-ws-count">{groupItems.length}</span>
              <button
                type="button"
                className="monthly-ws-add"
                onClick={() => {
                  setEditingId(null);
                  setAddingTypeKey(group.typeKeys[0]);
                }}
              >
                + Add
              </button>
            </div>

            {groupItems.length ? (
              <div className="monthly-comment-list">
                {groupItems.map((item) =>
                  editingId === item.id ? (
                    <ManagementForm key={item.id} bundle={bundle} comment={item} onDone={reload} onCancel={closeEditors} />
                  ) : (
                    <article className={`monthly-comment-card ${item.includeInFinal ? "" : "excluded"}`} key={item.id}>
                      <div className="monthly-comment-meta">
                        <b>{managementTypeOf(item).label}</b>
                        <StatusBadge tone={PRIORITY_META[item.priority].tone}>{PRIORITY_META[item.priority].label}</StatusBadge>
                        <StatusBadge tone={commentStatusMeta(item.status).tone}>{commentStatusMeta(item.status).label}</StatusBadge>
                        {item.escalateToManagement && <StatusBadge tone="danger">Escalated</StatusBadge>}
                        {!item.includeInFinal && <StatusBadge tone="neutral">Excluded</StatusBadge>}
                      </div>
                      <p className="monthly-comment-text">{item.presentationText || item.originalText}</p>
                      {item.sourceKind === "weekly" && item.presentationText && item.presentationText !== item.originalText && (
                        <p className="monthly-comment-source">Original Weekly wording: {item.originalText}</p>
                      )}
                      <div className="monthly-item-facts">
                        <span>
                          Owner <b>{nameOf(item.responsibleContactId, bundle.contacts, "—")}</b>
                        </span>
                        <span>
                          Due <b>{item.targetDate ? format(new Date(item.targetDate), "dd MMM yyyy") : "—"}</b>
                        </span>
                        <span>
                          Source <b>{item.sourceKind === "weekly" ? `Weekly W${item.weekNumber ?? "—"}` : "Monthly"}</b>
                        </span>
                      </div>
                      <p className="monthly-comment-author">
                        Author: {nameOf(item.createdByContactId, bundle.contacts, NOT_RECORDED)} · Created{" "}
                        {new Date(item.createdAt).toLocaleString()}
                        {item.updatedByContactId && (
                          <> · Last edited by {nameOf(item.updatedByContactId, bundle.contacts, NOT_RECORDED)}</>
                        )}
                      </p>
                      <div className="monthly-row-actions">
                        <Button type="button" variant="outline" size="sm" onClick={() => { setAddingTypeKey(null); setEditingId(item.id); }}>
                          <Pencil />
                          Edit
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => toggle(item)}>
                          {item.includeInFinal ? <X /> : <RotateCcw />}
                          {item.includeInFinal ? "Remove from Monthly" : "Restore"}
                        </Button>
                        {item.sourceKind === "monthly_manual" && (
                          <Button type="button" variant="destructive" size="sm" onClick={() => remove(item)}>
                            <Trash2 />
                            Delete
                          </Button>
                        )}
                      </div>
                    </article>
                  )
                )}
              </div>
            ) : (
              <EmptyRow>{group.empty}</EmptyRow>
            )}
          </div>
        );
      })}

      <p className="monthly-ws-note">
        Items are stored as Monthly records linked to their Weekly source. Editing a Weekly-sourced item changes the Monthly wording only —
        the original Weekly entry, its week, its author and its creation date are preserved. “Critical Issue” is a Risk / Issue at Priority =
        Critical, and “Escalation” is the escalate flag above, because the Monthly schema fixes the available update types.
      </p>
    </ReportSection>
  );
}
