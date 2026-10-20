"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard, StatusBadge } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import type { HierarchyTerms } from "@/config/project-terminology";
import type { Department, DepartmentAssignment, Discipline, Project, ProjectDisciplineLink, System } from "@/types";
import type { AmendmentViewer, SetupAmendment } from "../../setup-amendments";
import {
  departmentTarget,
  disciplineTarget,
  isStructureAmendment,
  pendingStructureTargets,
  STRUCTURE_REQUEST_LABEL,
  type StructureProposal,
} from "../../structure-amendments";
import { AmendmentList } from "./setup-amendments-panel";
import { ProposeStructureChangeDialog } from "./propose-structure-change-dialog";
import { RemovalImpact } from "./removal-impact";
import {
  countNoun,
  blockedSummary,
  departmentRemovalAssessment,
  departmentScopeAssessment,
  isBlocked,
  labelWithCode,
  resolveRecord,
  systemLabelFor,
  type PsmLookups,
  type PsmStepHrefs,
} from "../../structure-dependencies";

/**
 * Phase 13.9B Step 4 — a PSM project's scope once Project Setup is
 * Controlled (`02` §26.24.2a, `07` §10.12). The Departments, Systems and
 * Programs & Studies editors stay visible read-only; adding or removing a
 * department, changing its systems or whether it reports, and adding, moving
 * or removing a Program & Study are PROPOSED here with a reason and apply only
 * after another Project Control Admin or System Administrator approves them.
 * A department's lead and project description stay direct (and logged).
 * Programs & Studies are never merged with Disciplines. Presentation only —
 * the database validates, guards and applies.
 */

/**
 * A request started from a row of the (read-only) setup step — its "Request
 * removal" / "Request department" button. `seq` makes each click a new
 * request, so the same one can be opened again after it is closed.
 */
export type PsmScopeRequest =
  | { seq: number; action: "add_department" }
  | { seq: number; action: "remove_department" | "scope"; departmentId: string };

type DialogState =
  | { kind: "add_department" }
  | { kind: "scope" | "remove_department" | "notes"; assignment: DepartmentAssignment }
  | { kind: "add_discipline" }
  | { kind: "move_discipline" | "remove_discipline"; link: ProjectDisciplineLink };

export function PsmScopeGovernancePanel({
  project,
  focus,
  departments,
  disciplines,
  amendments,
  viewer,
  canPropose,
  projectArchived,
  onSaveDepartmentNotes,
  onChanged,
  request,
  terms,
  hrefs,
}: {
  project: Pick<Project, "id" | "code" | "departments" | "disciplines">;
  /** Departments & systems (the Departments and Systems steps) or Programs & Studies. */
  focus: "departments" | "disciplines";
  departments: readonly Department[];
  systems: readonly System[];
  disciplines: readonly Discipline[];
  amendments: readonly SetupAmendment[];
  viewer: AmendmentViewer;
  canPropose: boolean;
  projectArchived: boolean;
  /** Free: a department's lead and project description. */
  onSaveDepartmentNotes: (departmentId: string, notes: { leadName?: string; projectDescription?: string }) => Promise<void>;
  onChanged: () => void;
  /** Opens the matching request dialog (from the step's own buttons). */
  request?: PsmScopeRequest;
  /** The project's own wording for the level below a System (Programs & Studies on PSM). */
  terms: HierarchyTerms;
  /** Where the fix links for a blocked removal go. */
  hrefs: PsmStepHrefs;
}) {
  // Every record, archived included: a stored snapshot may point at one that is no longer active.
  const { records: allDepartments } = useMasterData("department");
  const { records: allSystems } = useMasterData("system");
  const { records: allDisciplines } = useMasterData("discipline");
  const lookups = React.useMemo<PsmLookups>(
    () => ({
      departments: allDepartments as Department[],
      systems: allSystems as System[],
      disciplines: allDisciplines as Discipline[],
    }),
    [allDepartments, allSystems, allDisciplines]
  );
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  // A new request from the step opens its dialog (derived during render, not in an effect).
  const [handledRequest, setHandledRequest] = React.useState(0);
  if (request && request.seq !== handledRequest) {
    setHandledRequest(request.seq);
    if (canPropose) {
      if (request.action === "add_department") {
        setDialog({ kind: "add_department" });
      } else {
        const assignment = (project.departments ?? []).find((candidate) => candidate.departmentId === request.departmentId);
        if (assignment) setDialog({ kind: request.action === "scope" ? "scope" : "remove_department", assignment });
      }
    }
  }
  const pending = React.useMemo(() => pendingStructureTargets(amendments), [amendments]);
  const fieldKey = focus === "departments" ? "structure_departments" : "structure_disciplines";
  const pendingHere = amendments.filter(
    (amendment) => amendment.status === "pending" && isStructureAmendment(amendment) && amendment.fieldKey === fieldKey
  );
  const departmentName = (id: string | undefined) =>
    id ? labelWithCode(resolveRecord("Department", { id }, lookups.departments)) : "Department";
  const systemName = (id: string | undefined) =>
    id ? labelWithCode(resolveRecord("System", { id }, lookups.systems)) : undefined;
  const disciplineName = (id: string) => labelWithCode(resolveRecord("Program & Study", { id }, lookups.disciplines));
  const assigned = project.departments ?? [];
  const links = project.disciplines ?? [];
  const close = () => setDialog(null);

  return (
    <SectionCard
      title={focus === "departments" ? "Department and system scope changes" : "Programs & Studies changes"}
      description={
        focus === "departments"
          ? "Project Setup is controlled. Adding or removing a department, changing its systems or whether it reports is proposed with a reason and applies after another Project Control Admin or System Administrator approves it. A department's lead and project description still save directly and are recorded in Project History."
          : "Project Setup is controlled. Adding, moving or removing a Program & Study is proposed with a reason and applies after another Project Control Admin or System Administrator approves it."
      }
    >
      <div className="min-w-0 space-y-4">
        {pendingHere.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Pending requests ({pendingHere.length})</h3>
            <AmendmentList items={pendingHere} empty="" projectCode={project.code} viewer={viewer}
              projectArchived={projectArchived} onChanged={onChanged} />
          </div>
        )}

        {focus === "departments" ? (
          <>
            {canPropose && (
              <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: "add_department" })}>
                <Plus data-icon="inline-start" aria-hidden="true" /> {STRUCTURE_REQUEST_LABEL.add_department}
              </Button>
            )}
            <ul className="divide-y rounded-lg border text-sm">
              {assigned.length === 0 && <li className="px-3 py-2 text-muted-foreground">No departments yet.</li>}
              {assigned.map((assignment) => {
                const isPending = pending.get(departmentTarget(assignment.departmentId));
                return (
                  <li key={assignment.departmentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{departmentName(assignment.departmentId)}</span>
                      <span className="text-xs text-muted-foreground">
                        {assignment.systems.length ? assignment.systems.map((system) => systemLabelFor(system, lookups)).join(", ") : "No systems"}
                      </span>
                      <StatusBadge tone={assignment.reportingRequired ? "info" : "neutral"}>
                        {assignment.reportingRequired ? "Reports" : "Does not report"}
                      </StatusBadge>
                      {isPending && <StatusBadge tone="warning">Pending approval</StatusBadge>}
                    </span>
                    {canPropose && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Changes for ${departmentName(assignment.departmentId)}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          {isPending ? (
                            <DropdownMenuItem disabled>A change is already awaiting approval</DropdownMenuItem>
                          ) : (
                            <>
                              <DropdownMenuItem onClick={() => setDialog({ kind: "scope", assignment })}>
                                {STRUCTURE_REQUEST_LABEL.set_department_scope}
                              </DropdownMenuItem>
                              {/* Always offered: if child structure is still assigned, the dialog names it and blocks Submit. */}
                              <DropdownMenuItem onClick={() => setDialog({ kind: "remove_department", assignment })}>
                                {STRUCTURE_REQUEST_LABEL.remove_department}
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDialog({ kind: "notes", assignment })}>
                            Edit lead and description
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            {canPropose && (
              <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: "add_discipline" })}>
                <Plus data-icon="inline-start" aria-hidden="true" /> {STRUCTURE_REQUEST_LABEL.add_discipline}
              </Button>
            )}
            <ul className="divide-y rounded-lg border text-sm">
              {links.length === 0 && <li className="px-3 py-2 text-muted-foreground">No Programs & Studies yet.</li>}
              {links.map((link) => {
                const isPending = pending.get(disciplineTarget(link.disciplineId));
                return (
                  <li key={link.disciplineId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{disciplineName(link.disciplineId)}</span>
                      <span className="text-xs text-muted-foreground">
                        {departmentName(link.departmentId)}{systemName(link.systemId) ? ` · ${systemName(link.systemId)}` : ""}
                      </span>
                      {isPending && <StatusBadge tone="warning">Pending approval</StatusBadge>}
                    </span>
                    {canPropose && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Changes for ${disciplineName(link.disciplineId)}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          {isPending ? (
                            <DropdownMenuItem disabled>A change is already awaiting approval</DropdownMenuItem>
                          ) : (
                            <>
                              <DropdownMenuItem onClick={() => setDialog({ kind: "move_discipline", link })}>
                                {STRUCTURE_REQUEST_LABEL.move_discipline}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDialog({ kind: "remove_discipline", link })}>
                                {STRUCTURE_REQUEST_LABEL.remove_discipline}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {dialog?.kind === "notes" && (
        <DepartmentNotesDialog assignment={dialog.assignment} name={departmentName(dialog.assignment.departmentId)}
          onSave={onSaveDepartmentNotes} onClose={close} />
      )}
      {dialog && dialog.kind !== "notes" && (
        <ScopeRequestDialog projectId={project.id} project={project} dialog={dialog} assigned={assigned} links={links}
          departments={departments} systems={allSystems as System[]} disciplines={disciplines}
          lookups={lookups} terms={terms} hrefs={hrefs} pendingTargets={new Set(pending.keys())}
          names={{ department: departmentName, system: systemName, discipline: disciplineName }}
          onClose={close} onSubmitted={() => onChanged()} />
      )}
    </SectionCard>
  );
}

/* ------------------------------ request dialog ---------------------------- */

const NO_SYSTEM = "__none__";

function ScopeRequestDialog({
  projectId,
  project,
  lookups,
  terms,
  hrefs,
  pendingTargets,
  dialog,
  assigned,
  links,
  departments,
  systems,
  disciplines,
  names,
  onClose,
  onSubmitted,
}: {
  projectId: string;
  project: Pick<Project, "id" | "departments" | "disciplines">;
  lookups: PsmLookups;
  terms: HierarchyTerms;
  hrefs: PsmStepHrefs;
  pendingTargets: ReadonlySet<string>;
  dialog: Exclude<DialogState, { kind: "notes" }>;
  assigned: readonly DepartmentAssignment[];
  links: readonly ProjectDisciplineLink[];
  departments: readonly Department[];
  systems: readonly System[];
  disciplines: readonly Discipline[];
  names: { department: (id?: string) => string; system: (id?: string) => string | undefined; discipline: (id: string) => string };
  onClose: () => void;
  onSubmitted: (amendment: SetupAmendment) => void;
}) {
  const assignment = "assignment" in dialog ? dialog.assignment : undefined;
  const link = "link" in dialog ? dialog.link : undefined;
  const [departmentId, setDepartmentId] = React.useState(assignment?.departmentId ?? link?.departmentId ?? "");
  const [systemIds, setSystemIds] = React.useState<string[]>(assignment?.systems.map((system) => system.id) ?? []);
  const [reporting, setReporting] = React.useState(assignment?.reportingRequired ?? true);
  const [disciplineId, setDisciplineId] = React.useState(link?.disciplineId ?? "");
  const [systemId, setSystemId] = React.useState(link?.systemId ?? NO_SYSTEM);
  const ids = { department: React.useId(), discipline: React.useId(), system: React.useId(), reporting: React.useId() };

  const departmentSystems = (id: string) =>
    systems.filter((system) => system.departmentId === id && (system.active || systemIds.includes(system.id)))
      .sort((a, b) => a.name.localeCompare(b.name));
  const scopeOf = (id: string) => assigned.find((candidate) => candidate.departmentId === id)?.systems ?? [];
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));
  const scopeText = (target: DepartmentAssignment) =>
    `${target.systems.length ? target.systems.map((system) => systemLabelFor(system, lookups)).join(", ") : "No systems"} · ${target.reportingRequired ? "reports" : "does not report"}`;

  const systemsField = (id: string) => (
    <Field>
      <FieldLabel>Systems in this project&apos;s scope</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        {departmentSystems(id).map((system) => (
          <label key={system.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={systemIds.includes(system.id)}
              onCheckedChange={(checked) =>
                setSystemIds((current) => (checked === true ? [...current, system.id] : current.filter((value) => value !== system.id)))
              } />
            {system.name}
          </label>
        ))}
      </div>
      {departmentSystems(id).length === 0 && <FieldDescription>This department has no active systems.</FieldDescription>}
    </Field>
  );
  const reportingField = (
    <label htmlFor={ids.reporting} className="flex items-center gap-2 text-sm">
      <Switch id={ids.reporting} checked={reporting} onCheckedChange={setReporting} /> Submits weekly report input
    </label>
  );
  const placementFields = (
    <>
      <Field>
        <FieldLabel htmlFor={ids.department}>Department</FieldLabel>
        <Select value={departmentId} onValueChange={(value) => { setDepartmentId(value); setSystemId(NO_SYSTEM); }}>
          <SelectTrigger id={ids.department} className="w-full"><SelectValue placeholder="Choose a department…" /></SelectTrigger>
          <SelectContent>
            {assigned.map((candidate) => (
              <SelectItem key={candidate.departmentId} value={candidate.departmentId}>{names.department(candidate.departmentId)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={ids.system}>System</FieldLabel>
        <Select value={systemId} onValueChange={setSystemId} disabled={!departmentId}>
          <SelectTrigger id={ids.system} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SYSTEM}>No system</SelectItem>
            {scopeOf(departmentId).map((system) => (
              <SelectItem key={system.id} value={system.id}>{system.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Only systems in the department&apos;s project scope are offered.</FieldDescription>
      </Field>
    </>
  );

  let title = "";
  let current: React.ReactNode = null;
  let fields: React.ReactNode = null;
  let proposal: StructureProposal | null = null;
  let blockedReason: string | undefined;
  const chosenSystem = systemId === NO_SYSTEM ? null : systemId;

  switch (dialog.kind) {
    case "add_department": {
      const available = departments.filter(
        (department) => department.active && !assigned.some((candidate) => candidate.departmentId === department.id)
      );
      title = STRUCTURE_REQUEST_LABEL.add_department;
      current = `${assigned.length} department${assigned.length === 1 ? "" : "s"} in the project`;
      fields = (
        <>
          <p className="rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground text-pretty">
            This links an <b>existing</b> department to this project only. It does not create or change the shared
            Department record. A department that is not in the list must first be created in{" "}
            <Link href="/departments/new" className="font-medium text-primary underline-offset-2 hover:underline">
              Master Data → New Department
            </Link>{" "}
            (a global action that applies to every project).
          </p>
          <Field>
            <FieldLabel htmlFor={ids.department}>Department</FieldLabel>
            <Select value={departmentId} onValueChange={(value) => { setDepartmentId(value); setSystemIds([]); }}>
              <SelectTrigger id={ids.department} className="w-full"><SelectValue placeholder="Choose a department…" /></SelectTrigger>
              <SelectContent>
                {available.map((department) => (
                  <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {departmentId && systemsField(departmentId)}
          {reportingField}
        </>
      );
      proposal = departmentId
        ? { fieldKey: "structure_departments", action: "add_department", departmentId, systemIds, reportingRequired: reporting }
        : null;
      break;
    }
    case "scope": {
      title = `${STRUCTURE_REQUEST_LABEL.set_department_scope} · ${names.department(dialog.assignment.departmentId)}`;
      current = scopeText(dialog.assignment);
      const assessment = departmentScopeAssessment({
        project, departmentId: dialog.assignment.departmentId, proposedSystemIds: systemIds,
        lookups, terms, hrefs, pending: pendingTargets,
      });
      blockedReason = isBlocked(assessment) ? blockedSummary(assessment) : undefined;
      fields = (
        <>
          {systemsField(dialog.assignment.departmentId)}
          {reportingField}
          <RemovalImpact assessment={assessment} />
        </>
      );
      proposal =
        !sameSet(systemIds, dialog.assignment.systems.map((system) => system.id)) || reporting !== dialog.assignment.reportingRequired
          ? { fieldKey: "structure_departments", action: "set_department_scope", departmentId: dialog.assignment.departmentId,
              systemIds, reportingRequired: reporting }
          : null;
      break;
    }
    case "remove_department": {
      title = `${STRUCTURE_REQUEST_LABEL.remove_department} · ${names.department(dialog.assignment.departmentId)}`;
      current = scopeText(dialog.assignment);
      const assessment = departmentRemovalAssessment({
        project, departmentId: dialog.assignment.departmentId, lookups, terms, hrefs, pending: pendingTargets,
      });
      blockedReason = isBlocked(assessment) ? blockedSummary(assessment) : undefined;
      fields = <RemovalImpact assessment={assessment} />;
      proposal = { fieldKey: "structure_departments", action: "remove_department", departmentId: dialog.assignment.departmentId };
      break;
    }
    case "add_discipline": {
      const available = disciplines.filter(
        (discipline) => discipline.active && !links.some((candidate) => candidate.disciplineId === discipline.id)
          && (!departmentId || !discipline.departmentId || discipline.departmentId === departmentId)
      );
      title = STRUCTURE_REQUEST_LABEL.add_discipline;
      current = `${countNoun(links.length, terms.singular, terms.plural)} in the project`;
      fields = (
        <>
          {placementFields}
          <Field>
            <FieldLabel htmlFor={ids.discipline}>Program & Study</FieldLabel>
            <Select value={disciplineId} onValueChange={setDisciplineId} disabled={!departmentId}>
              <SelectTrigger id={ids.discipline} className="w-full"><SelectValue placeholder="Choose a Program & Study…" /></SelectTrigger>
              <SelectContent>
                {available.map((discipline) => (
                  <SelectItem key={discipline.id} value={discipline.id}>{discipline.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      );
      proposal = departmentId && disciplineId
        ? { fieldKey: "structure_disciplines", action: "add_discipline", disciplineId, departmentId, systemId: chosenSystem }
        : null;
      break;
    }
    case "move_discipline":
      title = `${STRUCTURE_REQUEST_LABEL.move_discipline} · ${names.discipline(dialog.link.disciplineId)}`;
      current = `${names.department(dialog.link.departmentId)}${names.system(dialog.link.systemId) ? ` · ${names.system(dialog.link.systemId)}` : " · no system"}`;
      fields = placementFields;
      proposal = departmentId && (departmentId !== dialog.link.departmentId || chosenSystem !== (dialog.link.systemId ?? null))
        ? { fieldKey: "structure_disciplines", action: "move_discipline", disciplineId: dialog.link.disciplineId, departmentId,
            systemId: chosenSystem }
        : null;
      break;
    case "remove_discipline":
      title = `${STRUCTURE_REQUEST_LABEL.remove_discipline} · ${names.discipline(dialog.link.disciplineId)}`;
      current = `${names.department(dialog.link.departmentId)}${names.system(dialog.link.systemId) ? ` · ${names.system(dialog.link.systemId)}` : ""}`;
      fields = <p className="text-sm text-muted-foreground">Once approved, this Program & Study leaves the project&apos;s scope.</p>;
      proposal = { fieldKey: "structure_disciplines", action: "remove_discipline", disciplineId: dialog.link.disciplineId };
      break;
  }

  return (
    <ProposeStructureChangeDialog open projectId={projectId} title={title} current={current} proposal={proposal}
      onClose={onClose} onSubmitted={onSubmitted} blockedReason={blockedReason}>
      {fields}
    </ProposeStructureChangeDialog>
  );
}

/* ---------------------- free: department lead and notes ------------------- */

function DepartmentNotesDialog({
  assignment,
  name,
  onSave,
  onClose,
}: {
  assignment: DepartmentAssignment;
  name: string;
  onSave: (departmentId: string, notes: { leadName?: string; projectDescription?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [lead, setLead] = React.useState(assignment.leadName ?? "");
  const [description, setDescription] = React.useState(assignment.projectDescription ?? "");
  const [saving, setSaving] = React.useState(false);
  const leadId = React.useId();
  const descriptionId = React.useId();
  const unchanged = lead.trim() === (assignment.leadName ?? "") && description.trim() === (assignment.projectDescription ?? "");

  const save = async () => {
    if (unchanged) return;
    setSaving(true);
    try {
      await onSave(assignment.departmentId, { leadName: lead.trim() || undefined, projectDescription: description.trim() || undefined });
      toast.success(`${name} updated. The change is recorded in Project History.`);
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The department could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lead and description · {name}</DialogTitle>
          <DialogDescription>These details are not controlled: they save directly and are recorded in Project History.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor={leadId}>Lead</FieldLabel>
            <Input id={leadId} value={lead} maxLength={200} onChange={(event) => setLead(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={descriptionId}>Project description</FieldLabel>
            <Textarea id={descriptionId} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || unchanged}>
            {saving && <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
