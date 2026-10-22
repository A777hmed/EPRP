"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LabelWithHelp } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import type { PlanningEarningMethod, Project } from "@/types";
import { useProjectStructure } from "../../use-project-structure";
import {
  EARNING_METHOD_CHOICES,
  EARNING_METHOD_LABEL,
  type ReportingUnit,
} from "../../working-plan";
import { formatContribution } from "./master-plan-columns";
import { PlanningHelp } from "./planning-help";

/**
 * Phase 13.11 — shared Working Plan fields for the node and activity dialogs:
 * local weight, earning method (own or inherited) and the reporting-unit
 * mapping (`docs/02` §26.3 H6). PSM projects map to the project's own
 * Departments → Systems → Programs & Studies; Other Projects to their own
 * Project Structure units. Nothing here is hardcoded master data.
 */

export const INHERIT = "inherit";

/* ---------------------------- Reporting units ---------------------------- */

export interface ReportingUnitOption {
  id: string;
  label: string;
}

export interface ReportingUnitOptions {
  family: "psm" | "other";
  departments: ReportingUnitOption[];
  systemsFor: (departmentId: string | undefined) => ReportingUnitOption[];
  disciplinesFor: (departmentId: string | undefined) => ReportingUnitOption[];
  /** Active Other-project units, indented by level. */
  units: ReportingUnitOption[];
  /** Plain words for a mapping, for tables and "inherits …" hints. */
  describe: (unit: ReportingUnit | null) => string;
}

export function useReportingUnitOptions(project: Project): ReportingUnitOptions {
  const family = project.structureFamily === "other" ? "other" : "psm";
  const { records: departmentRecords } = useMasterData("department");
  const { records: disciplineRecords } = useMasterData("discipline");
  const { structure } = useProjectStructure(family === "other" ? project.id : undefined);

  return React.useMemo(() => {
    const departmentName = new Map(departmentRecords.map((record) => [record.id, record.name]));
    const disciplineName = new Map(disciplineRecords.map((record) => [record.id, record.name]));
    const systemName = new Map<string, string>();
    for (const assignment of project.departments) {
      for (const system of assignment.systems) systemName.set(system.id, system.name);
    }
    const nodes = (structure?.nodes ?? []).filter((unit) => !unit.archivedAt);
    const unitName = new Map((structure?.nodes ?? []).map((unit) => [unit.id, unit.name]));

    const departments = project.departments.map((assignment) => ({
      id: assignment.departmentId,
      label: departmentName.get(assignment.departmentId) ?? "Department",
    }));

    const ordered: ReportingUnitOption[] = [];
    const walk = (parentId: string | undefined, depth: number) => {
      for (const unit of nodes
        .filter((candidate) => candidate.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
        ordered.push({ id: unit.id, label: `${"  ".repeat(depth)}${unit.code ? `${unit.code} — ` : ""}${unit.name}` });
        walk(unit.id, depth + 1);
      }
    };
    walk(undefined, 0);

    return {
      family,
      departments,
      systemsFor: (departmentId) =>
        (project.departments.find((assignment) => assignment.departmentId === departmentId)?.systems ?? []).map(
          (system) => ({ id: system.id, label: system.name })
        ),
      disciplinesFor: (departmentId) =>
        (project.disciplines ?? [])
          .filter((link) => !link.departmentId || link.departmentId === departmentId)
          .filter((link, index, all) => all.findIndex((other) => other.disciplineId === link.disciplineId) === index)
          .map((link) => ({ id: link.disciplineId, label: disciplineName.get(link.disciplineId) ?? "Program & Study" })),
      units: ordered,
      describe: (unit) => {
        if (!unit) return "Project-level section";
        if (unit.family === "other") return unitName.get(unit.structureNodeId) ?? "Project Structure unit";
        return [
          departmentName.get(unit.departmentId) ?? "Department",
          unit.systemId ? systemName.get(unit.systemId) : undefined,
          unit.disciplineId ? disciplineName.get(unit.disciplineId) : undefined,
        ]
          .filter(Boolean)
          .join(" → ");
      },
    };
  }, [departmentRecords, disciplineRecords, family, project.departments, project.disciplines, structure]);
}

export interface ReportingUnitValue {
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  structureNodeId?: string;
}

/**
 * The mapping fields. "Inherit" leaves the item unmapped so it follows its
 * parent (or reports in the project-level section).
 */
export function ReportingUnitFields({
  idPrefix,
  options,
  value,
  onChange,
  inheritedLabel,
  hierarchyTerm,
  disabled,
}: {
  idPrefix: string;
  options: ReportingUnitOptions;
  value: ReportingUnitValue;
  onChange: (next: ReportingUnitValue) => void;
  /** What the item follows when it states no mapping. */
  inheritedLabel: string;
  /** "Program & Study" or the project's own term. */
  hierarchyTerm: string;
  disabled?: boolean;
}) {
  if (options.family === "other") {
    return (
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-unit`}>Reporting unit</Label>
        <Select
          value={value.structureNodeId || INHERIT}
          disabled={disabled}
          onValueChange={(next) => onChange({ structureNodeId: next === INHERIT ? "" : next })}
        >
          <SelectTrigger className="w-full min-w-0" id={`${idPrefix}-unit`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>Inherit — {inheritedLabel}</SelectItem>
            {options.units.map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The Project Structure unit whose report sections show this work. It
          never changes the plan&apos;s hierarchy or weights.
        </p>
      </div>
    );
  }

  const systems = options.systemsFor(value.departmentId);
  const disciplines = options.disciplinesFor(value.departmentId);
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-department`}>Reporting department</Label>
        <Select
          value={value.departmentId || INHERIT}
          disabled={disabled}
          onValueChange={(next) =>
            onChange(next === INHERIT ? { departmentId: "", systemId: "", disciplineId: "" } : { departmentId: next, systemId: "", disciplineId: "" })
          }
        >
          <SelectTrigger className="w-full min-w-0" id={`${idPrefix}-department`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>Inherit — {inheritedLabel}</SelectItem>
            {options.departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-system`}>System</Label>
        <Select
          value={value.systemId || INHERIT}
          disabled={disabled || !value.departmentId || systems.length === 0}
          onValueChange={(next) => onChange({ ...value, systemId: next === INHERIT ? "" : next })}
        >
          <SelectTrigger className="w-full min-w-0" id={`${idPrefix}-system`}>
            <SelectValue placeholder="Any system" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>Any system</SelectItem>
            {systems.map((system) => (
              <SelectItem key={system.id} value={system.id}>
                {system.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-discipline`}>{hierarchyTerm}</Label>
        <Select
          value={value.disciplineId || INHERIT}
          disabled={disabled || !value.departmentId || disciplines.length === 0}
          onValueChange={(next) => onChange({ ...value, disciplineId: next === INHERIT ? "" : next })}
        >
          <SelectTrigger className="w-full min-w-0" id={`${idPrefix}-discipline`}>
            <SelectValue placeholder={`Any ${hierarchyTerm}`} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>Any {hierarchyTerm}</SelectItem>
            {disciplines.map((discipline) => (
              <SelectItem key={discipline.id} value={discipline.id}>
                {discipline.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The report section this work appears in. It never changes the plan&apos;s
          hierarchy or weights.
        </p>
      </div>
    </>
  );
}

/* ------------------------------ Earning method --------------------------- */

export function EarningMethodSelect({
  id,
  value,
  onChange,
  inheritedLabel,
  methods,
  disabled,
}: {
  id: string;
  value: PlanningEarningMethod | "";
  onChange: (next: PlanningEarningMethod | "") => void;
  /** Shown on the "Inherit" option; omit to offer no inherit choice. */
  inheritedLabel?: string;
  methods: readonly PlanningEarningMethod[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || INHERIT}
      disabled={disabled}
      onValueChange={(next) => onChange(next === INHERIT ? "" : (next as PlanningEarningMethod))}
    >
      <SelectTrigger className="w-full min-w-0" id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {inheritedLabel !== undefined && <SelectItem value={INHERIT}>Inherit — {inheritedLabel}</SelectItem>}
        {methods.map((method) => (
          <SelectItem key={method} value={method}>
            {EARNING_METHOD_CHOICES.find((choice) => choice.value === method)?.question ?? EARNING_METHOD_LABEL[method]}
            {" "}
            <span className="text-muted-foreground">({EARNING_METHOD_LABEL[method]})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* --------------------------------- Weight -------------------------------- */

/** "" while empty; a number otherwise. Blank is "not entered", never 0. */
export function parseWeightText(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

export function weightTextValid(text: string): boolean {
  const value = parseWeightText(text);
  return (
    value === undefined ||
    (!Number.isNaN(value) && value >= 0 && value <= 100 && Math.round(value * 1000) / 1000 === value)
  );
}

export function LocalWeightField({
  id,
  text,
  onText,
  parentName,
  recordedWeight,
  contribution,
  disabled,
}: {
  id: string;
  text: string;
  onText: (text: string) => void;
  parentName: string;
  recordedWeight?: number;
  /** The calculated effective contribution, shown beside the input (W4). */
  contribution?: number | null;
  disabled?: boolean;
}) {
  const valid = weightTextValid(text);
  return (
    <div className="grid gap-1.5">
      <LabelWithHelp help={<PlanningHelp concept="localWeight" />}>
        <Label htmlFor={id}>Local weight %</Label>
      </LabelWithHelp>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-invalid={!valid}
        onChange={(event) => onText(event.target.value)}
        placeholder={`Share of ${parentName}`}
      />
      {!valid && (
        <p className="text-xs text-destructive">A local weight is between 0 and 100, with at most three decimals.</p>
      )}
      {contribution !== undefined && (
        <p className="text-xs text-muted-foreground">
          Project contribution: {contribution === null ? "—" : `${formatContribution(contribution)} (calculated)`}
        </p>
      )}
      {recordedWeight !== undefined && (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          Recorded weight: {recordedWeight}%
          <PlanningHelp concept="recordedWeight" />
        </p>
      )}
    </div>
  );
}

export { formatContribution } from "./master-plan-columns";
