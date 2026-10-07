import type { Project } from "@/types";
import type { ProjectWorkflowStepId } from "@/config/project-workflow";
import { subcontractorsForSave } from "./project-parties";

export type SetupRelation = "departments" | "disciplines" | "team";
export const setupRelations = ["departments", "disciplines", "team", "sites", "positions", "delegations", "parties"] as const;

/** Present-but-unhydrated relations must never disappear during JSON transport. */
export function collectSetupRelations(input: Partial<Project>): Record<string, unknown[]> {
  const relations: Record<string, unknown[]> = {};
  for (const key of setupRelations) {
    if (!(key in input)) continue;
    const value = input[key];
    if (!Array.isArray(value)) {
      throw new Error(`Project ${key} data has not finished loading. Reload before saving.`);
    }
    relations[key] = key === "parties" ? subcontractorsForSave(input.parties!) : value;
  }
  return relations;
}

/** Only the editor on the current step may submit a relation. */
export function relationForSetupStep(
  step: ProjectWorkflowStepId
): SetupRelation | null {
  switch (step) {
    case "departments":
    case "systems":
      return "departments";
    case "disciplines":
      return "disciplines";
    case "contacts":
      return "team";
    case "info":
    // The Other "Project Structure" placeholder owns nothing yet (2C.1b).
    case "structure":
    case "team":
    case "review":
      return null;
  }
}

/** Keep edits made during an in-flight save, including edits to other steps. */
export function reconcileSetupSave(
  baseline: Project,
  submitted: Project,
  latest: Project,
  saved: Project,
  relation: SetupRelation | readonly (keyof Project)[]
): Project {
  const next = { ...saved };
  for (const key of Object.keys(latest) as (keyof Project)[]) {
    if (typeof relation === "string" ? key === relation : relation.includes(key)) {
      if (latest[key] !== submitted[key]) {
        Object.assign(next, { [key]: latest[key] });
      }
    } else if (latest[key] !== baseline[key]) {
      Object.assign(next, { [key]: latest[key] });
    }
  }
  return next;
}

export function isSetupDraftDirty(draft: Project, saved: Project): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

/** A write acknowledgement alone is insufficient; confirm the read-back version. */
export async function confirmSetupSave(
  write: () => Promise<string>,
  read: () => Promise<Project | null>
): Promise<Project> {
  const version = await write();
  if (!version) throw new Error("Project setup save returned no confirmed project version.");
  const saved = await read();
  if (!saved) {
    throw new Error("Project setup saved, but the project could not be read back. Reload before editing again.");
  }
  if (saved.updatedAt !== version) {
    throw new Error("Project setup changed again after this save. Reload before editing again.");
  }
  return saved;
}
