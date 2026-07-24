"use client";

import * as React from "react";

import { useMasterData } from "@/features/master-data";
import {
  evaluateProjectWorkflow,
  projectWorkflowPercent,
  nextIncompleteStep,
  type ProjectStepStatus,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";
import type {
  Contact,
  Department,
  Discipline,
  Project,
  System,
} from "@/types";

export interface ProjectWorkflowState {
  statuses: ProjectStepStatus[];
  byId: Record<ProjectWorkflowStepId, ProjectStepStatus>;
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

/**
 * Evaluates the guided workflow for a project. Reads master data reactively,
 * so assigning a system or adding a contact updates the step progress and
 * unlocks the next step without a reload.
 */
export function useProjectWorkflow(project: Project): ProjectWorkflowState {
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
      departments.find((department) => department.id === id)?.name ?? id,
    [departments]
  );

  const statuses = React.useMemo(
    () =>
      evaluateProjectWorkflow(
        project,
        { systems, disciplines, contacts },
        departmentName
      ),
    [project, systems, disciplines, contacts, departmentName]
  );

  const byId = React.useMemo(
    () =>
      Object.fromEntries(
        statuses.map((status) => [status.id, status])
      ) as Record<ProjectWorkflowStepId, ProjectStepStatus>,
    [statuses]
  );

  return {
    statuses,
    byId,
    percent: projectWorkflowPercent(statuses),
    next: nextIncompleteStep(statuses),
    departments,
    systems,
    disciplines,
    contacts,
    departmentName,
  };
}
