"use client";

import { SectionCard } from "@/components/shared";
import type { ProjectStructureWorkspaceProps } from "../../../structure/structure-workspace-contract";
import { StructureLevelsEditor } from "./structure-levels-editor";
import { StructureUnitsEditor } from "./structure-units-editor";

/**
 * The Project Structure step's body (Phase 2C.1c-e/f): hierarchy types,
 * actual items and operational reporting input. Keep the signature: it is
 * the frozen ProjectStructureWorkspaceProps contract (project, structure,
 * canManage, actions) — see structure-workspace-contract.ts.
 */
export function ProjectStructureWorkspace({ project, structure, canManage, actions }: ProjectStructureWorkspaceProps) {
  return (
    <SectionCard
      title="Project structure"
      description="Choose how this project is organized, build its groups, and select who provides Weekly and Monthly input."
    >
      <div className="min-w-0 space-y-5">
        {!canManage && <p className="text-sm text-muted-foreground">{project.status === "archived" ? "Archived project · structure is read-only." : "Read-only · you can view this project's hierarchy."}</p>}
        <StructureLevelsEditor key={`levels:${project.id}`} project={project} structure={structure} canManage={canManage} actions={actions} />
        <StructureUnitsEditor key={`units:${project.id}`} project={project} structure={structure} canManage={canManage} actions={actions} />
      </div>
    </SectionCard>
  );
}
