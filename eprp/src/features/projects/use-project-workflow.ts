"use client";

import * as React from "react";

import { useMasterData } from "@/features/master-data";
import {
  evaluateProjectWorkflow,
  localizeProjectWorkflowStep,
  projectWorkflowPercent,
  nextIncompleteStep,
  resolveSetupSteps,
  setupFlowFor,
  type ProjectStepStatus,
  type ProjectWorkflowStep,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";
import type { HierarchyTerms } from "@/config/project-terminology";
import type {
  Contact,
  Department,
  Discipline,
  Project,
  System,
} from "@/types";
import { useHierarchyTerms } from "./use-hierarchy-terms";
import {
  useProjectStructure,
  type ProjectStructureState,
} from "./use-project-structure";

export interface ProjectWorkflowState {
  /** This project's own setup steps, in order, already in its wording. */
  steps: ProjectWorkflowStep[];
  statuses: ProjectStepStatus[];
  /** Statuses by step id — only for the steps this project has. */
  byId: Partial<Record<ProjectWorkflowStepId, ProjectStepStatus>>;
  /** Hierarchy wording for this project — display only. */
  terms: HierarchyTerms;
  /** Overall completion across all steps, 0–100. */
  percent: number;
  next?: ProjectStepStatus;
  /** Master data, already narrowed to active records. */
  departments: Department[];
  systems: System[];
  disciplines: Discipline[];
  contacts: Contact[];
  departmentName: (id: string) => string;
}

export interface ProjectWorkflowOptions {
  /**
   * An Other project's structure, when the caller already loads it (the setup
   * wizard does, once, for every view of the step). Omitted: an Other
   * project's structure is loaded here. Ignored for PSM and legacy projects.
   */
  structure?: ProjectStructureState;
}

/**
 * Evaluates the guided workflow for a project. Reads master data reactively,
 * so assigning a system or adding a contact updates the step progress and
 * unlocks the next step without a reload.
 */
export function useProjectWorkflow(
  project: Project,
  options: ProjectWorkflowOptions = {}
): ProjectWorkflowState {
  const { activeRecords: departmentRecords } = useMasterData("department");
  const { activeRecords: systemRecords } = useMasterData("system");
  const { activeRecords: disciplineRecords } = useMasterData("discipline");
  const { activeRecords: contactRecords } = useMasterData("contact");

  const departments = departmentRecords as Department[];
  const systems = systemRecords as System[];
  const disciplines = disciplineRecords as Discipline[];
  const contacts = contactRecords as Contact[];

  const departmentName = React.useCallback(
    (id: string) =>
      departments.find((department) => department.id === id)?.name ??
      "Unknown department",
    [departments]
  );

  const terms = useHierarchyTerms(project);

  // An Other project's Project Structure step is judged from its configured
  // structure (2C.1c). Loaded here only when the caller did not supply it, and
  // never for PSM / legacy projects.
  const isOther =
    setupFlowFor({ structureFamily: project.structureFamily, saved: true }) === "other";
  const ownStructure = useProjectStructure(
    isOther && !options.structure ? project.id : undefined
  );
  const structureState = options.structure ?? ownStructure;
  // Only THIS project's structure may judge it — never one left over from a
  // previously opened project.
  const loaded =
    structureState.structure?.projectId === project.id ? structureState.structure : null;
  const structureError = structureState.error;
  const structureInput = React.useMemo(
    () => (isOther ? { structure: loaded, error: structureError } : undefined),
    [isOther, loaded, structureError]
  );

  // Resolved by Project Type, then put in the project's hierarchy wording —
  // a legacy PSAIM-coded project still reads "Programs & Studies".
  const structureFamily = project.structureFamily;
  const steps = React.useMemo(
    () =>
      resolveSetupSteps({ structureFamily, saved: true }).map((step) =>
        localizeProjectWorkflowStep(step, terms)
      ),
    [structureFamily, terms]
  );

  const statuses = React.useMemo(
    () =>
      evaluateProjectWorkflow(
        project,
        { systems, disciplines, contacts, structure: structureInput },
        departmentName,
        terms,
        steps
      ),
    [project, systems, disciplines, contacts, structureInput, departmentName, terms, steps]
  );

  const byId = React.useMemo(
    () =>
      Object.fromEntries(
        statuses.map((status) => [status.id, status])
      ) as Partial<Record<ProjectWorkflowStepId, ProjectStepStatus>>,
    [statuses]
  );

  return {
    steps,
    statuses,
    byId,
    terms,
    percent: projectWorkflowPercent(statuses),
    next: nextIncompleteStep(statuses),
    departments,
    systems,
    disciplines,
    contacts,
    departmentName,
  };
}
