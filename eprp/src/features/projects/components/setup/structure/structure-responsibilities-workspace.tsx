"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Users } from "lucide-react";

import { StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectStructure, ProjectStructureNode, StructureUnitPeopleInput } from "@/types/project-structure";
import type { StructureWorkspaceProject } from "../../../structure/structure-workspace-contract";
import { findLevel } from "../../../structure/structure-rules";
import {
  activeUnitsInOrder,
  REPORT_KIND_LABEL,
  responsibilityGaps,
  unitPeopleSummary,
  type ReportPeopleSummary,
  type StructureTeamDirectory,
} from "../../../structure/structure-responsibilities";
import { StructureResponsibilityDialog } from "./structure-responsibility-dialog";

export interface StructureResponsibilitiesWorkspaceProps {
  project: StructureWorkspaceProject;
  structure: Pick<ProjectStructure, "levels" | "nodes" | "assignments">;
  directory: StructureTeamDirectory;
  /** Presentation only: the database is the authority. */
  canManage: boolean;
  onSave: (input: StructureUnitPeopleInput) => Promise<void>;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Project Team & Responsibilities for an Other project (Phase 2C.3D): every
 * active structure unit, in hierarchy order, with its Unit Lead, members and
 * the Weekly / Monthly Responsible + Backup it needs. A missing Responsible
 * (report enabled + unit flagged) BLOCKS Project Setup; a missing Unit Lead
 * is a warning; a missing Backup is fine. Editing happens in the one
 * Responsibility dialog. Configuration only: nothing here grants authority.
 */
export function StructureResponsibilitiesWorkspace({
  project,
  structure,
  directory,
  canManage,
  onSave,
}: StructureResponsibilitiesWorkspaceProps) {
  const [needsOnly, setNeedsOnly] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const openers = React.useRef(new Map<string, HTMLButtonElement>());
  const units = activeUnitsInOrder(structure);
  const gaps = responsibilityGaps(project.reporting, structure);
  const blocked = new Set([...gaps.weekly, ...gaps.monthly].map((node) => node.id));
  const shown = needsOnly ? units.filter((node) => blocked.has(node.id)) : units;
  const editingNode = units.find((node) => node.id === editing);

  if (units.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
        No active structure units yet. Add them on the Project Structure step, then assign their people here.
      </p>
    );
  }
  if (!structure.assignments) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground" role="status">
        Structure responsibilities are not available on this database yet. Contact your administrator.
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-4" data-structure-responsibilities>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ul className="space-y-1 text-sm" aria-label="Structure responsibility status">
          <li className={cn("flex items-start gap-2", blocked.size > 0 ? "text-destructive" : "text-muted-foreground")}>
            {blocked.size > 0
              ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              : <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <span>
              {blocked.size > 0
                ? `${plural(blocked.size, "unit needs", "units need")} a required Responsible — Project Setup cannot complete until assigned.`
                : "Every unit that provides Weekly or Monthly input has its Responsible."}
            </span>
          </li>
          {gaps.withoutLead.length > 0 && (
            <li className="flex items-start gap-2 text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>{plural(gaps.withoutLead.length, "unit has", "units have")} no Unit Lead (a warning, not a blocker).</span>
            </li>
          )}
        </ul>
        {blocked.size > 0 && (
          <Button type="button" variant="outline" className="min-h-11" aria-pressed={needsOnly} onClick={() => setNeedsOnly((value) => !value)}>
            {needsOnly ? "Show all units" : `Needs responsible (${blocked.size})`}
          </Button>
        )}
      </div>

      <ul className="space-y-2" aria-label="Structure units and their people">
        {shown.map((node) => (
          <UnitRow
            key={node.id}
            node={node}
            levelLabel={findLevel(structure.levels, node.levelNumber)?.singularLabel ?? `Level ${node.levelNumber}`}
            structure={structure}
            project={project}
            directory={directory}
            blocked={blocked.has(node.id)}
            canManage={canManage}
            onOpen={(button) => { openers.current.set(node.id, button); setEditing(node.id); }}
          />
        ))}
      </ul>

      {editingNode && (
        <StructureResponsibilityDialog
          project={project}
          node={editingNode}
          levelLabel={findLevel(structure.levels, editingNode.levelNumber)?.singularLabel ?? `Level ${editingNode.levelNumber}`}
          assignments={structure.assignments}
          directory={directory}
          canManage={canManage}
          onSave={onSave}
          onClose={() => setEditing(null)}
          onReturnFocus={() => {
            const opener = openers.current.get(editingNode.id);
            if (!opener?.isConnected) return false;
            opener.focus();
            return true;
          }}
        />
      )}
    </div>
  );
}

function UnitRow({
  node,
  levelLabel,
  structure,
  project,
  directory,
  blocked,
  canManage,
  onOpen,
}: {
  node: ProjectStructureNode;
  levelLabel: string;
  structure: Pick<ProjectStructure, "assignments">;
  project: StructureWorkspaceProject;
  directory: StructureTeamDirectory;
  blocked: boolean;
  canManage: boolean;
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const people = unitPeopleSummary(node, structure, directory, project.reporting);
  return (
    <li
      data-responsibility-unit={node.id}
      className={cn("rounded-lg border bg-card p-3", blocked && "border-destructive/50")}
      style={{ marginInlineStart: `${(node.levelNumber - 1) * 1.25}rem` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded border px-1 text-xs font-medium tabular-nums text-muted-foreground">L{node.levelNumber}</span>
            <span className="text-xs text-muted-foreground">{levelLabel}</span>
            <span className="break-words text-sm font-semibold">{node.name}</span>
            {node.code && <span className="font-mono text-xs text-muted-foreground">{node.code}</span>}
          </p>
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Unit Lead</dt>
            <dd>{people?.leadName ?? <span className="text-warning">Lead not assigned</span>}</dd>
            <dt className="text-muted-foreground">Members</dt>
            <dd className="tabular-nums">{plural(people?.memberCount ?? 0, "member", "members")}</dd>
            {(["weekly", "monthly"] as const).map((kind) => people?.[kind] && (
              <ReportLine key={kind} label={REPORT_KIND_LABEL[kind]} summary={people[kind] as ReportPeopleSummary} />
            ))}
          </dl>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0"
          aria-label={`${canManage ? "Edit" : "View"} people for ${node.name}`}
          onClick={(event) => onOpen(event.currentTarget)}
        >
          <Users data-icon="inline-start" aria-hidden="true" />
          {canManage ? "Edit people" : "View people"}
        </Button>
      </div>
    </li>
  );
}

function ReportLine({ label, summary }: { label: string; summary: ReportPeopleSummary }) {
  return (
    <>
      <dt className="text-muted-foreground">{label} Responsible</dt>
      <dd>
        {summary.responsibleName ? (
          <>
            {summary.responsibleName}
            <span className="text-muted-foreground"> · Backup: {summary.backupName ?? "none"}</span>
          </>
        ) : summary.required ? (
          <StatusBadge tone="danger">{label} Responsible required</StatusBadge>
        ) : (
          <span className="text-muted-foreground">Not assigned · {label} reporting is off for this project</span>
        )}
      </dd>
    </>
  );
}
