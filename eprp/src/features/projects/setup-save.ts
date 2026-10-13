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

/**
 * A refusal raised with a stable [TAG] prefix (e.g. 2C.3D Wave 2's
 * [PSM_MEMBER_REQUIRED]) is shown without the tag; the sentence after it was
 * written for users. Anything else is passed on unchanged.
 */
export function setupSaveMessage(message: string): string {
  const tagged = /^\[[A-Z_]+\]\s*([\s\S]+)$/.exec(message);
  return tagged ? tagged[1] : message;
}

/**
 * 2C.3E: an archived project's setup is history — visible, never changed. The
 * database refuses every setup write with [PROJECT_ARCHIVED] and this sentence;
 * the application refuses first, with the same words.
 */
export const PROJECT_SETUP_ARCHIVED_MESSAGE = "This project is archived; its setup is read-only.";

export function isSetupReadOnly(project: Pick<Project, "status"> | null | undefined): boolean {
  return project?.status === "archived";
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
