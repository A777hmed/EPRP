"use client";

import * as React from "react";

import { ErrorState, LoadingState } from "@/components/shared";
import { projectStructureService } from "@/services/project-structure-service";
import type { Contact, Project } from "@/types";
import type { ProjectStructureState } from "../../../use-project-structure";
import { createStructureActions } from "../../../structure/structure-workspace-contract";
import { buildTeamDirectory } from "../../../structure/structure-responsibilities";
import { ProjectStructureWorkspace } from "./project-structure-workspace";

export interface ProjectStructureStepProps {
  project: Project;
  /** Loaded once by the setup wizard for this project. */
  structureState: ProjectStructureState;
  /** Decided by the wizard (Project Setup authority, project not archived). */
  canManage: boolean;
  /** A structure write advanced the project version: reload the project. */
  onProjectChanged: () => void;
  /** The People master, to name the project's members on unit cards (2C.3D). */
  contacts?: Contact[];
  /** The Owner / Client's name, for party labels. */
  clientName?: string;
}

/**
 * The workflow container for an Other project's Project Structure step
 * (Phase 2C.1c-c). Owns the data and service wiring; the UI below only
 * receives the frozen ProjectStructureWorkspaceProps.
 */
export function ProjectStructureStep({
  project,
  structureState,
  canManage,
  onProjectChanged,
  contacts,
  clientName,
}: ProjectStructureStepProps) {
  const { structure: loaded, error, refresh } = structureState;
  // Only this project's structure — never one left over from another project.
  const structure = loaded?.projectId === project.id ? loaded : null;

  // The project version of the structure on screen: a level change is
  // checked against exactly what the user is looking at.
  const structureVersion = structure?.version ?? "";

  const actions = React.useMemo(
    () =>
      createStructureActions({
        service: projectStructureService,
        projectId: project.id,
        currentVersion: () => structureVersion,
        afterWrite: () => {
          refresh();
          onProjectChanged();
        },
        refresh,
      }),
    [project.id, structureVersion, refresh, onProjectChanged]
  );

  // The project's active members, display-ready, for each unit's people
  // summary and the Responsibility dialog. Without contacts: units only.
  const people = React.useMemo(
    () => (contacts ? buildTeamDirectory(project, contacts, clientName) : undefined),
    [project, contacts, clientName]
  );

  if (error) {
    return (
      <ErrorState
        title="Project structure could not be loaded"
        description={error}
        onRetry={refresh}
      />
    );
  }
  if (!structure) {
    return <LoadingState variant="card" label="Loading the project structure…" />;
  }
  return (
    <ProjectStructureWorkspace
      project={project}
      structure={structure}
      canManage={canManage}
      actions={actions}
      people={people}
    />
  );
}
