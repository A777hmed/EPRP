"use client";

import { SectionCard } from "@/components/shared";
import { reportingScope } from "../../../structure/structure-rules";
import type { ProjectStructureWorkspaceProps } from "../../../structure/structure-workspace-contract";
import { StructureLevelSummary } from "./structure-level-summary";
import { StructureLevelsEditor } from "./structure-levels-editor";

/**
 * The Project Structure step's body (Phase 2C.1c-d): level configuration
 * and a read-only unit summary. Keep the signature: it is
 * the frozen ProjectStructureWorkspaceProps contract (project, structure,
 * canManage, actions) — see structure-workspace-contract.ts.
 */
export function ProjectStructureWorkspace({ project, structure, canManage, actions }: ProjectStructureWorkspaceProps) {
  const scope = reportingScope(structure.nodes);
  const owing = [
    project.reporting.weeklyEnabled && `Weekly input: ${scope.weekly.length}`,
    project.reporting.monthlyEnabled && `Monthly input: ${scope.monthly.length}`,
  ].filter(Boolean);

  return (
    <SectionCard
      title="Project structure"
      description="Define the project's hierarchy, then add its structure units. Levels alone do not complete Project Structure."
    >
      <div className="min-w-0 space-y-5">
        {!canManage && <p className="text-sm text-muted-foreground">{project.status === "archived" ? "Archived project · structure is read-only." : "Read-only · you can view this project's hierarchy."}</p>}
        <StructureLevelsEditor key={project.id} project={project} structure={structure} canManage={canManage} actions={actions} />
        <section className="space-y-2 border-t pt-4" aria-label="Structure units summary">
          <h3 className="text-sm font-semibold">Step 2 · Add structure units</h3>
          <p className="text-xs text-muted-foreground">{structure.nodes.length === 0 ? "No units added yet. Defining levels is the first step; structure units are still needed." : "Saved levels and unit counts for this project."} Unit editing will be available in the next structure slice.</p>
          {structure.levels.length > 0 && <StructureLevelSummary structure={structure} />}
          {owing.length > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              Units owing {owing.join(" · ")}
            </p>
          )}
        </section>
      </div>
    </SectionCard>
  );
}
