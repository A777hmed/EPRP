"use client";

import { SectionCard } from "@/components/shared";
import type { ProjectStructureWorkspaceProps } from "../../../structure/structure-workspace-contract";
import { StructureLevelsEditor } from "./structure-levels-editor";
import { StructureViews } from "./structure-views";

/**
 * The Project Structure step's body (Phase 2C.1c-e/f): the structure levels,
 * then the project's actual units in two views over the same data — the
 * Structure Hierarchy and the Manage View (the existing editor, which owns
 * every write and the operational reporting input). Keep the signature: it
 * is the frozen ProjectStructureWorkspaceProps contract (project, structure,
 * canManage, actions) — see structure-workspace-contract.ts.
 */
export function ProjectStructureWorkspace({ project, structure, canManage, actions }: ProjectStructureWorkspaceProps) {
  return (
    <SectionCard
      title="Project structure"
      description="Choose how this project is organized, build its units, and select which units provide Weekly and Monthly input."
    >
      <div className="min-w-0 space-y-5">
        {!canManage && <p className="text-sm text-muted-foreground">{project.status === "archived" ? "Archived project · structure is read-only." : "Read-only · you can view this project's structure."}</p>}
        <StructureLevelsEditor key={`levels:${project.id}`} project={project} structure={structure} canManage={canManage} actions={actions} />
        <StructureViews key={`units:${project.id}`} project={project} structure={structure} canManage={canManage} actions={actions} />
      </div>
    </SectionCard>
  );
}
