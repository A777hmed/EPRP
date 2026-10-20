"use client";

import * as React from "react";
import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import type { ProjectStructure, ProjectStructureLevel, ProjectStructureNode } from "@/types/project-structure";
import type { AmendmentViewer, SetupAmendment } from "../../setup-amendments";
import type { ProjectStructureActions } from "../../structure/structure-workspace-contract";
import {
  isStructureAmendment,
  LEVELS_TARGET,
  pendingStructureTargets,
  reportingInputText,
  STRUCTURE_REQUEST_LABEL,
  unitTarget,
  type StructureProposal,
} from "../../structure-amendments";
import { AmendmentList } from "./setup-amendments-panel";
import { RemovalImpact } from "./removal-impact";
import {
  blockedSummary,
  isBlocked,
  levelRemovalAssessment,
  unitArchiveAssessment,
} from "../../structure-dependencies";
import { ProposeStructureChangeDialog } from "./propose-structure-change-dialog";

/**
 * Phase 13.9B Step 4 — an Other project's structure once Project Setup is
 * Controlled (`02` §26.24.2a, `07` §10.12). The structure editors above stay
 * visible read-only; governed changes (add, rename, move, archive / restore,
 * reporting input, level changes) are PROPOSED here with a reason and apply
 * only after another Project Control Admin or System Administrator approves
 * them. Descriptions and display order stay direct (and logged); unit people
 * stay on the Project Team step. Presentation only — the database validates,
 * guards and applies.
 */

type DialogState =
  | { kind: "add" }
  | { kind: "rename" | "move" | "archive" | "restore" | "reporting" | "notes"; unit: ProjectStructureNode }
  | { kind: "rename_level"; level: ProjectStructureLevel }
  | { kind: "add_level" }
  | { kind: "remove_level"; level: ProjectStructureLevel };

/** Units in hierarchy order (each parent followed by its children). */
function orderedUnits(nodes: readonly ProjectStructureNode[]): { unit: ProjectStructureNode; depth: number }[] {
  const children = new Map<string, ProjectStructureNode[]>();
  for (const node of nodes) {
    const key = node.parentId ?? "";
    children.set(key, [...(children.get(key) ?? []), node]);
  }
  for (const list of children.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const out: { unit: ProjectStructureNode; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      out.push({ unit: node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

export function StructureGovernancePanel({
  project,
  structure,
  amendments,
  viewer,
  canPropose,
  projectArchived,
  actions,
  onChanged,
}: {
  project: { id: string; code: string };
  structure: ProjectStructure;
  amendments: readonly SetupAmendment[];
  viewer: AmendmentViewer;
  /** Project Setup authority on this project, not archived. */
  canPropose: boolean;
  projectArchived: boolean;
  /** For the free edits (description, display order) only. */
  actions: ProjectStructureActions;
  onChanged: () => void;
}) {
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const pending = React.useMemo(() => pendingStructureTargets(amendments), [amendments]);
  const pendingHere = amendments.filter(
    (amendment) =>
      amendment.status === "pending" &&
      isStructureAmendment(amendment) &&
      (amendment.fieldKey === "structure_units" || amendment.fieldKey === "structure_levels")
  );
  const levels = [...structure.levels].sort((a, b) => a.levelNumber - b.levelNumber);
  const levelLabel = (number: number) => levels.find((level) => level.levelNumber === number)?.singularLabel ?? "Unit";
  const units = orderedUnits(structure.nodes);
  const levelsPending = pending.get(LEVELS_TARGET);
  const close = () => setDialog(null);
  const submitted = () => onChanged();

  return (
    <SectionCard
      title="Structure changes"
      description="Project Setup is controlled. Adding, renaming, moving, archiving or restoring units, changing their reporting input and changing levels are proposed with a reason and apply after another Project Control Admin or System Administrator approves them. Descriptions and display order still save directly and are recorded in Project History."
    >
      <div className="min-w-0 space-y-5">
        {pendingHere.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Pending structure requests ({pendingHere.length})</h3>
            <AmendmentList items={pendingHere} empty="" projectCode={project.code} viewer={viewer}
              projectArchived={projectArchived} onChanged={onChanged} />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Levels</h3>
            {canPropose && levels.length < 4 && (
              <Button type="button" size="sm" variant="outline" disabled={Boolean(levelsPending)}
                onClick={() => setDialog({ kind: "add_level" })}>
                <Plus data-icon="inline-start" aria-hidden="true" /> {STRUCTURE_REQUEST_LABEL.add_level}
              </Button>
            )}
          </div>
          {levelsPending && (
            <p className="text-xs text-muted-foreground">
              <StatusBadge tone="warning">Pending approval</StatusBadge>{" "}
              A level change is awaiting approval; one level change is decided at a time.
            </p>
          )}
          <ul className="divide-y rounded-lg border text-sm">
            {levels.map((level) => {
              const deepest = level.levelNumber === levels.length;
              return (
                <li key={level.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="text-muted-foreground">Level {level.levelNumber} · </span>
                    <span className="font-medium">{level.singularLabel}</span>
                    <span className="text-muted-foreground"> / {level.pluralLabel}</span>
                  </span>
                  {canPropose && !levelsPending && (
                    <span className="flex flex-wrap gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ kind: "rename_level", level })}>
                        {STRUCTURE_REQUEST_LABEL.rename_level}
                      </Button>
                      {deepest && levels.length > 1 && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ kind: "remove_level", level })}>
                          {STRUCTURE_REQUEST_LABEL.remove_level}
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Units</h3>
            {canPropose && levels.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: "add" })}>
                <Plus data-icon="inline-start" aria-hidden="true" /> {STRUCTURE_REQUEST_LABEL.add}
              </Button>
            )}
          </div>
          {units.length === 0 ? (
            <p className="text-sm text-muted-foreground">No units yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {units.map(({ unit, depth }) => {
                const pendingUnit = pending.get(unitTarget(unit.id));
                const archived = Boolean(unit.archivedAt);
                return (
                  <li key={unit.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
                      <span className="text-xs text-muted-foreground">{levelLabel(unit.levelNumber)}</span>
                      <span className={archived ? "text-muted-foreground line-through" : "font-medium"}>
                        {unit.name}{unit.code ? ` (${unit.code})` : ""}
                      </span>
                      {archived ? (
                        <StatusBadge tone="neutral">Archived</StatusBadge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {reportingInputText(unit.weeklyReportingRequired, unit.monthlyReportingRequired)}
                        </span>
                      )}
                      {pendingUnit && <StatusBadge tone="warning">Pending approval</StatusBadge>}
                    </span>
                    {canPropose && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Changes for ${unit.name}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          {pendingUnit ? (
                            <DropdownMenuItem disabled>A change is already awaiting approval</DropdownMenuItem>
                          ) : archived ? (
                            <DropdownMenuItem onClick={() => setDialog({ kind: "restore", unit })}>
                              {STRUCTURE_REQUEST_LABEL.restore}
                            </DropdownMenuItem>
                          ) : (
                            <>
                              <DropdownMenuItem onClick={() => setDialog({ kind: "rename", unit })}>
                                {STRUCTURE_REQUEST_LABEL.rename}
                              </DropdownMenuItem>
                              {unit.levelNumber > 1 && (
                                <DropdownMenuItem onClick={() => setDialog({ kind: "move", unit })}>
                                  {STRUCTURE_REQUEST_LABEL.move}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setDialog({ kind: "reporting", unit })}>
                                {STRUCTURE_REQUEST_LABEL.set_reporting_scope}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDialog({ kind: "archive", unit })}>
                                {STRUCTURE_REQUEST_LABEL.archive}
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDialog({ kind: "notes", unit })}>
                            Edit description and order
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {dialog && dialog.kind === "notes" && (
        <UnitNotesDialog unit={dialog.unit} actions={actions} onClose={close} />
      )}
      {dialog && dialog.kind !== "notes" && (
        <StructureRequestDialog
          // Re-created when the dialog switches to another unit (a blocker's own archive request).
          key={`${dialog.kind}:${"unit" in dialog ? dialog.unit.id : "level" in dialog ? dialog.level.id : "new"}`}
          projectId={project.id} dialog={dialog} structure={structure} levelLabel={levelLabel}
          pendingTargets={new Set(pending.keys())}
          onRequestArchive={(unitId) => {
            const child = structure.nodes.find((node) => node.id === unitId);
            if (child) setDialog({ kind: "archive", unit: child });
          }}
          onClose={close} onSubmitted={submitted} />
      )}
    </SectionCard>
  );
}

/* ------------------------------ request dialog ---------------------------- */

function StructureRequestDialog({
  projectId,
  dialog,
  structure,
  levelLabel,
  pendingTargets,
  onRequestArchive,
  onClose,
  onSubmitted,
}: {
  projectId: string;
  dialog: Exclude<DialogState, { kind: "notes" }>;
  structure: ProjectStructure;
  levelLabel: (number: number) => string;
  pendingTargets: ReadonlySet<string>;
  /** Opens the archive request of a child unit that is blocking its parent's archive. */
  onRequestArchive: (unitId: string) => void;
  onClose: () => void;
  onSubmitted: (amendment: SetupAmendment) => void;
}) {
  const unit = "unit" in dialog ? dialog.unit : undefined;
  const level = "level" in dialog ? dialog.level : undefined;
  const levelCount = structure.levels.length;
  const [name, setName] = React.useState(unit?.name ?? "");
  const [code, setCode] = React.useState(unit?.code ?? "");
  const [description, setDescription] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [addLevel, setAddLevel] = React.useState(1);
  const [weekly, setWeekly] = React.useState(unit?.weeklyReportingRequired ?? false);
  const [monthly, setMonthly] = React.useState(unit?.monthlyReportingRequired ?? false);
  const [singular, setSingular] = React.useState(level?.singularLabel ?? "");
  const [plural, setPlural] = React.useState(level?.pluralLabel ?? "");
  const ids = { name: React.useId(), code: React.useId(), parent: React.useId(), level: React.useId(),
    description: React.useId(), singular: React.useId(), plural: React.useId(), weekly: React.useId(), monthly: React.useId() };

  const activeAt = (number: number) =>
    structure.nodes.filter((node) => node.levelNumber === number && !node.archivedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
  const parentName = (id: string | undefined) => structure.nodes.find((node) => node.id === id)?.name;

  let title = "";
  let current: React.ReactNode = null;
  let proposal: StructureProposal | null = null;
  let blockedReason: string | undefined;
  let fields: React.ReactNode = null;

  const flagFields = (
    <div className="flex flex-wrap gap-6">
      <label htmlFor={ids.weekly} className="flex items-center gap-2 text-sm">
        <Switch id={ids.weekly} checked={weekly} onCheckedChange={setWeekly} /> Weekly input
      </label>
      <label htmlFor={ids.monthly} className="flex items-center gap-2 text-sm">
        <Switch id={ids.monthly} checked={monthly} onCheckedChange={setMonthly} /> Monthly input
      </label>
    </div>
  );
  const nameFields = (
    <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
      <Field>
        <FieldLabel htmlFor={ids.name}>Name</FieldLabel>
        <Input id={ids.name} value={name} maxLength={140} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={ids.code}>Code</FieldLabel>
        <Input id={ids.code} value={code} maxLength={40} onChange={(event) => setCode(event.target.value)} />
      </Field>
    </div>
  );
  const parentSelect = (choices: ProjectStructureNode[], label: string) => (
    <Field>
      <FieldLabel htmlFor={ids.parent}>{label}</FieldLabel>
      <Select value={parentId} onValueChange={setParentId}>
        <SelectTrigger id={ids.parent} className="w-full"><SelectValue placeholder="Choose a parent unit…" /></SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id}>{choice.name}{choice.code ? ` (${choice.code})` : ""}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {choices.length === 0 && <FieldDescription>There is no active unit to place it under.</FieldDescription>}
    </Field>
  );
  const levelLabels = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={ids.singular}>Singular name</FieldLabel>
        <Input id={ids.singular} value={singular} maxLength={60} onChange={(event) => setSingular(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={ids.plural}>Plural name</FieldLabel>
        <Input id={ids.plural} value={plural} maxLength={60} onChange={(event) => setPlural(event.target.value)} />
      </Field>
    </div>
  );

  switch (dialog.kind) {
    case "add": {
      const choices = addLevel > 1 ? activeAt(addLevel - 1) : [];
      title = STRUCTURE_REQUEST_LABEL.add;
      current = `${levelCount} level${levelCount === 1 ? "" : "s"} · ${structure.nodes.filter((node) => !node.archivedAt).length} active units`;
      fields = (
        <>
          <Field>
            <FieldLabel htmlFor={ids.level}>Level</FieldLabel>
            <Select value={String(addLevel)} onValueChange={(value) => { setAddLevel(Number(value)); setParentId(""); }}>
              <SelectTrigger id={ids.level} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {structure.levels.map((candidate) => (
                  <SelectItem key={candidate.id} value={String(candidate.levelNumber)}>
                    Level {candidate.levelNumber} · {candidate.singularLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {addLevel > 1 && parentSelect(choices, `Under (${levelLabel(addLevel - 1)})`)}
          {nameFields}
          <Field>
            <FieldLabel htmlFor={ids.description}>Description</FieldLabel>
            <Textarea id={ids.description} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          {flagFields}
        </>
      );
      proposal = name.trim() && (addLevel === 1 || parentId)
        ? { fieldKey: "structure_units", action: "add", levelNumber: addLevel, parentId: addLevel === 1 ? null : parentId,
            name, code, description, weeklyReportingRequired: weekly, monthlyReportingRequired: monthly }
        : null;
      break;
    }
    case "rename":
      title = `${STRUCTURE_REQUEST_LABEL.rename} · ${dialog.unit.name}`;
      current = `${dialog.unit.name}${dialog.unit.code ? ` (${dialog.unit.code})` : ""}`;
      fields = nameFields;
      proposal = name.trim() && (name.trim() !== dialog.unit.name || (code.trim() || undefined) !== dialog.unit.code)
        ? { fieldKey: "structure_units", action: "rename", unitId: dialog.unit.id, name, code }
        : null;
      break;
    case "move": {
      const choices = activeAt(dialog.unit.levelNumber - 1).filter((choice) => choice.id !== dialog.unit.parentId);
      title = `${STRUCTURE_REQUEST_LABEL.move} · ${dialog.unit.name}`;
      current = `Under ${parentName(dialog.unit.parentId) ?? "the top level"}`;
      fields = parentSelect(choices, `New parent (${levelLabel(dialog.unit.levelNumber - 1)})`);
      proposal = parentId ? { fieldKey: "structure_units", action: "move", unitId: dialog.unit.id, parentId } : null;
      break;
    }
    case "archive": {
      title = `${STRUCTURE_REQUEST_LABEL.archive} · ${dialog.unit.name}`;
      current = `Active · ${reportingInputText(dialog.unit.weeklyReportingRequired, dialog.unit.monthlyReportingRequired)}`;
      // The child level's own wording is used (Other projects name their levels).
      const assessment = unitArchiveAssessment({ structure, unit: dialog.unit, pending: pendingTargets });
      blockedReason = isBlocked(assessment) ? blockedSummary(assessment) : undefined;
      fields = <RemovalImpact assessment={assessment} onFix={onRequestArchive} />;
      proposal = { fieldKey: "structure_units", action: "archive", unitId: dialog.unit.id };
      break;
    }
    case "restore":
      title = `${STRUCTURE_REQUEST_LABEL.restore} · ${dialog.unit.name}`;
      current = "Archived";
      fields = <p className="text-sm text-muted-foreground">Once approved, the unit is active again, with no reporting input until that is changed.</p>;
      proposal = { fieldKey: "structure_units", action: "restore", unitId: dialog.unit.id };
      break;
    case "reporting":
      title = `${STRUCTURE_REQUEST_LABEL.set_reporting_scope} · ${dialog.unit.name}`;
      current = reportingInputText(dialog.unit.weeklyReportingRequired, dialog.unit.monthlyReportingRequired);
      fields = flagFields;
      proposal = weekly !== dialog.unit.weeklyReportingRequired || monthly !== dialog.unit.monthlyReportingRequired
        ? { fieldKey: "structure_units", action: "set_reporting_scope", unitId: dialog.unit.id,
            weeklyReportingRequired: weekly, monthlyReportingRequired: monthly }
        : null;
      break;
    case "rename_level":
      title = `${STRUCTURE_REQUEST_LABEL.rename_level} · Level ${dialog.level.levelNumber}`;
      current = `${dialog.level.singularLabel} / ${dialog.level.pluralLabel}`;
      fields = levelLabels;
      proposal = singular.trim() && plural.trim()
        && (singular.trim() !== dialog.level.singularLabel || plural.trim() !== dialog.level.pluralLabel)
        ? { fieldKey: "structure_levels", action: "rename_level", levelNumber: dialog.level.levelNumber,
            singularLabel: singular, pluralLabel: plural }
        : null;
      break;
    case "add_level":
      title = `${STRUCTURE_REQUEST_LABEL.add_level} · Level ${levelCount + 1}`;
      current = `${levelCount} level${levelCount === 1 ? "" : "s"} (a project structure has at most four)`;
      fields = levelLabels;
      proposal = singular.trim() && plural.trim()
        ? { fieldKey: "structure_levels", action: "add_level", levelNumber: levelCount + 1, singularLabel: singular, pluralLabel: plural }
        : null;
      break;
    case "remove_level": {
      title = `${STRUCTURE_REQUEST_LABEL.remove_level} · Level ${dialog.level.levelNumber}`;
      const assessment = levelRemovalAssessment({ structure, level: dialog.level });
      current = `${dialog.level.singularLabel} / ${dialog.level.pluralLabel}${isBlocked(assessment) ? "" : " · no units"}`;
      blockedReason = isBlocked(assessment) ? blockedSummary(assessment) : undefined;
      fields = <RemovalImpact assessment={assessment} />;
      proposal = { fieldKey: "structure_levels", action: "remove_level", levelNumber: dialog.level.levelNumber };
      break;
    }
  }

  return (
    <ProposeStructureChangeDialog open projectId={projectId} title={title} current={current} proposal={proposal}
      onClose={onClose} onSubmitted={onSubmitted} blockedReason={blockedReason}>
      {fields}
    </ProposeStructureChangeDialog>
  );
}

/* --------------------------- free: notes and order ------------------------ */

function UnitNotesDialog({
  unit,
  actions,
  onClose,
}: {
  unit: ProjectStructureNode;
  actions: ProjectStructureActions;
  onClose: () => void;
}) {
  const [description, setDescription] = React.useState(unit.description ?? "");
  const [order, setOrder] = React.useState(String(unit.sortOrder + 1));
  const [saving, setSaving] = React.useState(false);
  const descriptionId = React.useId();
  const orderId = React.useId();
  const position = Number(order);
  const valid = Number.isInteger(position) && position >= 1;
  const unchanged = description.trim() === (unit.description ?? "") && position - 1 === unit.sortOrder;

  const save = async () => {
    if (!valid || unchanged) return;
    setSaving(true);
    try {
      await actions.updateNode(unit, { description: description.trim(), sortOrder: position - 1 });
      toast.success(`${unit.name} updated. The change is recorded in Project History.`);
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The unit could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Description and order · {unit.name}</DialogTitle>
          <DialogDescription>These details are not controlled: they save directly and are recorded in Project History.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
            <Textarea id={descriptionId} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={orderId}>Display position among its siblings</FieldLabel>
            <Input id={orderId} type="number" min={1} className="max-w-28" value={order} onChange={(event) => setOrder(event.target.value)} />
            {!valid && <FieldDescription>Enter a whole number from 1.</FieldDescription>}
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !valid || unchanged}>
            {saving && <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
