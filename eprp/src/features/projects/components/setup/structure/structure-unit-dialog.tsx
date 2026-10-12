"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectStructureWorkspaceProps } from "../../../structure/structure-workspace-contract";
import { findNode, parentCandidates, STRUCTURE_NODE_CODE_MAX, STRUCTURE_NODE_DESCRIPTION_MAX, STRUCTURE_NODE_NAME_MAX } from "../../../structure/structure-rules";
import { initialUnitFields, saveStructureUnit, unitActionError, unitFormIssues, unitLabels, unitPathLabel, type StructureUnitIntent } from "../../../structure/structure-units-ui";

export interface StructureUnitDialogProps extends ProjectStructureWorkspaceProps {
  intent: StructureUnitIntent;
  onClose: () => void;
  onSaved: () => void;
  onReload: () => void;
  onReturnFocus?: () => void;
}

export function StructureUnitDialog({ structure, canManage, actions, intent, onClose, onSaved, onReload, onReturnFocus }: StructureUnitDialogProps) {
  const [fields, setFields] = React.useState(() => initialUnitFields(intent));
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = React.useState(false);
  const [discard, setDiscard] = React.useState(false);
  const submitting = React.useRef(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const id = React.useId();
  const number = intent.mode === "create" ? intent.levelNumber : intent.node.levelNumber;
  const labels = unitLabels(structure, number);
  const parentLabel = unitLabels(structure, number - 1).singular;
  const parents = parentCandidates(structure, number);
  const changed = intent.mode !== "create" && findNode(structure.nodes, intent.node.id)?.updatedAt !== intent.node.updatedAt;
  const blocked = reloadRequired || changed || !canManage;
  const dirty = JSON.stringify(fields) !== JSON.stringify(initialUnitFields(intent));
  const issues = unitFormIssues(structure, intent, fields);
  const confirmation = ["archive", "restore", "delete"].includes(intent.mode);
  const destructive = intent.mode === "delete";
  const verb = intent.mode === "create" ? "Add" : intent.mode === "details" ? "Edit" : intent.mode === "reporting" ? "Reporting input for" : intent.mode === "move" ? "Move" : intent.mode === "archive" ? "Archive" : intent.mode === "restore" ? "Restore" : "Delete";
  const title = `${verb} ${labels.singular}${intent.mode === "create" ? "" : ` · ${intent.node.name}`}`;
  const description = intent.mode === "delete" ? "Delete only if there are no children or protected references. A refused deletion keeps the record and its history intact."
    : intent.mode === "archive" ? "Archive this unit only. Active children must be archived first. Its Weekly and Monthly input settings will be cleared."
    : intent.mode === "restore" ? "Restore this unit under an active parent, with an available name and code. Reporting input stays off until it is set again."
    : intent.mode === "move" ? `Choose a different ${parentLabel}. The unit stays at the ${labels.singular} level, and its children move with it.`
    : intent.mode === "reporting" ? "Operational reporting input only: this does not assign people or grant reviewer or consolidator authority."
    : intent.mode === "details" ? `Update this ${labels.singular}'s details. Use Reporting input or Move for those separate changes.`
    : `Add a new unit at the ${labels.singular} level of the Structure Hierarchy. Its level cannot be changed later.`;

  React.useEffect(() => {
    if (!dirty || !canManage) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, canManage]);

  function close() {
    if (saving || submitting.current) return;
    if (dirty && !confirmation && !discard) { setDiscard(true); return; }
    onClose();
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || saving || submitting.current) return;
    setTouched(true);
    if (issues.length > 0) {
      const first = issues.find((issue) => issue.field);
      if (first) formRef.current?.querySelector<HTMLElement>(`[id="${id}-${first.field}"]`)?.focus();
      return;
    }
    if (!confirmation && !dirty) return;
    submitting.current = true;
    setSaving(true); setError(null);
    try {
      await saveStructureUnit(actions, intent, fields);
      toast.success(`${labels.singular} ${intent.mode === "create" ? "added" : intent.mode === "delete" ? "deleted" : intent.mode === "archive" ? "archived" : intent.mode === "restore" ? "restored" : "saved"}`);
      onSaved();
    } catch (failure: unknown) {
      const safe = unitActionError(failure, labels.singular);
      setError(safe.message); setReloadRequired(safe.reload);
    } finally {
      submitting.current = false; setSaving(false);
    }
  }

  const fieldError = (field: "name" | "code" | "description" | "parentId") => touched ? issues.find((issue) => issue.field === field)?.message : undefined;
  const disabled = saving || blocked;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!saving} onCloseAutoFocus={(event) => { if (onReturnFocus) { event.preventDefault(); onReturnFocus(); } }} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => { if (saving || dirty) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form ref={formRef} onSubmit={save} noValidate className="min-w-0 space-y-4" aria-busy={saving} aria-label={title}>
          {(intent.mode === "create" || intent.mode === "details") && (
            <>
              <div className="space-y-1.5"><Label htmlFor={`${id}-name`}>{labels.singular} name <span className="text-muted-foreground">(required)</span></Label>
                <Input id={`${id}-name`} value={fields.name} maxLength={STRUCTURE_NODE_NAME_MAX} required disabled={disabled} className="min-h-11" autoComplete="off" aria-invalid={Boolean(fieldError("name"))} aria-describedby={fieldError("name") ? `${id}-name-error` : undefined} onBlur={() => setTouched(true)} onChange={(event) => setFields((current) => ({ ...current, name: event.target.value }))} />
                {fieldError("name") && <p id={`${id}-name-error`} role="alert" className="text-xs text-destructive">{fieldError("name")}</p>}
              </div>
              <div className="space-y-1.5"><Label htmlFor={`${id}-code`}>Code <span className="text-muted-foreground">(optional)</span></Label>
                <Input id={`${id}-code`} value={fields.code} maxLength={STRUCTURE_NODE_CODE_MAX} disabled={disabled} className="min-h-11" autoComplete="off" aria-invalid={Boolean(fieldError("code"))} aria-describedby={fieldError("code") ? `${id}-code-error` : undefined} onBlur={() => setTouched(true)} onChange={(event) => setFields((current) => ({ ...current, code: event.target.value }))} />
                {fieldError("code") && <p id={`${id}-code-error`} role="alert" className="text-xs text-destructive">{fieldError("code")}</p>}
              </div>
              <div className="space-y-1.5"><Label htmlFor={`${id}-description`}>Description <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea id={`${id}-description`} value={fields.description} maxLength={STRUCTURE_NODE_DESCRIPTION_MAX} disabled={disabled} aria-invalid={Boolean(fieldError("description"))} aria-describedby={fieldError("description") ? `${id}-description-error` : undefined} onChange={(event) => setFields((current) => ({ ...current, description: event.target.value }))} />
                {fieldError("description") && <p id={`${id}-description-error`} role="alert" className="text-xs text-destructive">{fieldError("description")}</p>}
              </div>
            </>
          )}
          {number > 1 && (intent.mode === "create" || intent.mode === "move") && (
            <div className="space-y-1.5"><Label htmlFor={`${id}-parentId`}>Parent {parentLabel}</Label>
              <Select value={fields.parentId} disabled={disabled || parents.length === 0} onValueChange={(parentId) => setFields((current) => ({ ...current, parentId }))}>
                <SelectTrigger id={`${id}-parentId`} className="min-h-11 w-full" aria-invalid={Boolean(fieldError("parentId"))} aria-describedby={`${id}-parent-hint`}><SelectValue placeholder={`Select ${parentLabel}`} /></SelectTrigger>
                <SelectContent>{parents.map((parent) => <SelectItem key={parent.id} value={parent.id}>{unitPathLabel(structure, parent.id)}</SelectItem>)}</SelectContent>
              </Select>
              <p id={`${id}-parent-hint`} className={`text-xs ${fieldError("parentId") ? "text-destructive" : "text-muted-foreground"}`}>{fieldError("parentId") ?? (parents.length === 0 ? `Add an active ${parentLabel} first.` : `Choose an active ${parentLabel} from this project.`)}</p>
            </div>
          )}
          {number > 1 && intent.mode === "details" && <p className="text-xs text-muted-foreground">Parent {parentLabel}: {unitPathLabel(structure, fields.parentId) || "Not available"}</p>}
          {(intent.mode === "create" || intent.mode === "reporting") && (
            <fieldset className="space-y-2 border-t pt-3"><legend className="text-sm font-medium">Operational reporting input</legend>
              <p id={`${id}-reporting-hint`} className="text-xs text-muted-foreground">Select the reports this {labels.singular} provides input for. Each report takes input from one unit per branch, so a unit and the units above or below it cannot both provide the same input.</p>
              <div className="grid gap-2 sm:grid-cols-2">{(["weeklyReportingRequired", "monthlyReportingRequired"] as const).map((field) => (
                <Label key={field} htmlFor={`${id}-${field}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3">
                  <input id={`${id}-${field}`} type="checkbox" checked={fields[field]} disabled={disabled} className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-describedby={`${id}-reporting-hint`} onChange={(event) => setFields((current) => ({ ...current, [field]: event.target.checked }))} />
                  {field === "weeklyReportingRequired" ? "Weekly input" : "Monthly input"}
                </Label>
              ))}</div>
            </fieldset>
          )}
          <div aria-live="polite" className="space-y-2 text-sm">
            {(touched || dirty || confirmation) && issues.filter((issue) => !issue.field).map((issue, index) => <p key={index} role="alert" className="text-destructive">{issue.message}</p>)}
            {error && <p role="alert" className="text-destructive">{error}</p>}
            {changed && !reloadRequired && <p role="alert">This {labels.singular} changed while this form was open. Your edits are kept. Reload before saving.</p>}
            {!canManage && <p role="alert">This project is now read-only. No changes can be saved.</p>}
            {discard && <p role="alert">Discard the unsaved edits to this {labels.singular}?</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} className="min-h-11" onClick={() => { if (discard) setDiscard(false); else close(); }}>{discard ? "Keep editing" : "Cancel"}</Button>
            {discard ? <Button type="button" variant="destructive" className="min-h-11" onClick={onClose}>Discard changes</Button>
              : blocked && canManage ? <Button type="button" variant="outline" className="min-h-11" onClick={() => { onReload(); actions.refresh(); }}>Reload and discard edits</Button>
              : <Button type="submit" variant={destructive ? "destructive" : "default"} className="min-h-11" disabled={disabled || (!confirmation && !dirty) || ((confirmation || intent.mode === "reporting") && issues.length > 0)}>{saving ? "Saving…" : confirmation ? `${verb} ${labels.singular}` : intent.mode === "create" ? `Add ${labels.singular}` : "Save Changes"}</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
