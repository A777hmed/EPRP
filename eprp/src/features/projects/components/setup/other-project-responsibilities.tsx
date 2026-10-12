"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState, SectionCard } from "@/components/shared";
import { projectWorkflowHref } from "@/config/project-workflow";
import { projectStructureService } from "@/services/project-structure-service";
import type { Contact, Project } from "@/types";
import { FIXED_RESPONSIBILITIES } from "../../responsibilities";
import type { ProjectStructureState } from "../../use-project-structure";
import { createStructureActions } from "../../structure/structure-workspace-contract";
import { buildTeamDirectory } from "../../structure/structure-responsibilities";
import { StructureResponsibilitiesWorkspace } from "./structure/structure-responsibilities-workspace";

/**
 * Project Team & Responsibilities for an Other project.
 *
 * - Structure Responsibilities (Phase 2C.3D Wave 1): each structure unit's
 *   members, Unit Lead, and Weekly / Monthly Responsible + Backup, chosen
 *   from the ACTIVE project team (2C.3C). A missing required Responsible
 *   blocks this step; a missing Unit Lead is a warning. Saved per unit,
 *   immediately, against the saved project. Grants no authority.
 * - Project-level holders: the fixed responsibilities set on Project Type &
 *   Information, shown read-only as before.
 */
export function OtherProjectResponsibilities({
  project,
  savedProject,
  contacts,
  clientName,
  title,
  structureState,
  canManage,
  onProjectChanged,
}: {
  /** The project as shown (fixed holders may carry unsaved Project Information edits). */
  project: Project;
  /** The saved project: its team, parties and version. */
  savedProject: Project;
  contacts: Contact[];
  clientName?: string;
  title: string;
  structureState: ProjectStructureState;
  /** Presentation only (Project Setup authority, project not archived). */
  canManage: boolean;
  /** A responsibility write advanced the project version: reload the project. */
  onProjectChanged: () => void;
}) {
  const nameOf = (id?: string) =>
    (id && contacts.find((contact) => contact.id === id)?.name) || undefined;
  const { structure: loaded, error, refresh } = structureState;
  // Only this project's structure — never one left over from another project.
  const structure = loaded?.projectId === savedProject.id ? loaded : null;
  const structureVersion = structure?.version ?? "";
  const directory = React.useMemo(
    () => buildTeamDirectory(savedProject, contacts, clientName),
    [savedProject, contacts, clientName]
  );
  const actions = React.useMemo(
    () =>
      createStructureActions({
        service: projectStructureService,
        projectId: savedProject.id,
        currentVersion: () => structureVersion,
        afterWrite: () => {
          refresh();
          onProjectChanged();
        },
        refresh,
      }),
    [savedProject.id, structureVersion, refresh, onProjectChanged]
  );

  return (
    <div className="space-y-6">
      <SectionCard
        title="Structure responsibilities"
        description="Who works in each structure unit, who leads it, and who provides its Weekly and Monthly input. Configuration only: these roles grant no platform or project authority."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href={projectWorkflowHref(savedProject.id, "contacts")}>Project team</Link>
          </Button>
        }
      >
        {error ? (
          <ErrorState title="Project structure could not be loaded" description={error} onRetry={refresh} />
        ) : !structure ? (
          <LoadingState variant="card" label="Loading the project structure…" />
        ) : (
          <StructureResponsibilitiesWorkspace
            project={savedProject}
            structure={structure}
            directory={directory}
            canManage={canManage}
            onSave={actions.saveUnitResponsibilities}
          />
        )}
      </SectionCard>

      <SectionCard
        title={title}
        description="Project-level responsibility holders, set on Project Type & Information."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href={projectWorkflowHref(project.id, "info")}>Edit holders</Link>
          </Button>
        }
      >
        <dl className="divide-y rounded-lg ring-1 ring-foreground/10">
          {FIXED_RESPONSIBILITIES.map((meta) => {
            const holder = nameOf(project[meta.field]);
            return (
              <div
                key={meta.field}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
              >
                <dt className="text-muted-foreground">
                  {meta.label}
                  {meta.required && <span className="sr-only"> (required)</span>}
                </dt>
                <dd className={holder ? "font-medium" : "text-muted-foreground"}>
                  {holder ?? (meta.required ? "Not assigned — required" : "Not assigned")}
                </dd>
              </div>
            );
          })}
        </dl>
      </SectionCard>
    </div>
  );
}
