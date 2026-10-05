"use client";

import { Layers } from "lucide-react";

import { EmptyState, SectionCard } from "@/components/shared";
import { reportingScope } from "../../../structure/structure-rules";
import type { ProjectStructureWorkspaceProps } from "../../../structure/structure-workspace-contract";
import { StructureLevelSummary } from "./structure-level-summary";

/**
 * The Project Structure step's body (Phase 2C.1c-c): a read-only summary
 * standing in for the level and unit editors, which replace this component
 * in a later slice WITHOUT changing the workflow. Keep the signature: it is
 * the frozen ProjectStructureWorkspaceProps contract (project, structure,
 * canManage, actions) — see structure-workspace-contract.ts.
 */
export function ProjectStructureWorkspace({ project, structure }: ProjectStructureWorkspaceProps) {
  if (structure.levels.length === 0) {
    return (
      <SectionCard title="Project structure">
        <EmptyState
          icon={Layers}
          title="No structure levels yet"
          description="Level and unit editing is not available on this step yet."
          className="py-8"
        />
      </SectionCard>
    );
  }

  const scope = reportingScope(structure.nodes);
  const owing = [
    project.reporting.weeklyEnabled && `Weekly input: ${scope.weekly.length}`,
    project.reporting.monthlyEnabled && `Monthly input: ${scope.monthly.length}`,
  ].filter(Boolean);

  return (
    <SectionCard
      title="Project structure"
      description="Levels and active units configured for this project. Editing is not available on this step yet."
    >
      <div className="space-y-2">
        <StructureLevelSummary structure={structure} />
        {owing.length > 0 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Units owing {owing.join(" · ")}
          </p>
        )}
      </div>
    </SectionCard>
  );
}
