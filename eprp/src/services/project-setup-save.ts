import type { SupabaseClient } from "@supabase/supabase-js";

import type { Project } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { projectService } from "./project-service";
import { readProjectByIdFresh } from "./supabase-project-service";
import { confirmSetupSave, setupSaveMessage, type SetupRelation } from "@/features/projects/setup-save";

/** A single setup relation and the project version form one atomic write. */
export async function saveProjectSetupRelation(
  project: Project,
  relation: SetupRelation,
  value: Project[SetupRelation]
): Promise<Project> {
  if (!Array.isArray(value)) {
    throw new Error("Project setup data has not finished loading. Reload and try again.");
  }

  if (!isSupabaseConfigured()) {
    return projectService.updateProject(project.id, { [relation]: value }, project.updatedAt);
  }

  const supabase = getSupabaseBrowserClient() as unknown as SupabaseClient;
  return confirmSetupSave(
    async () => {
      const { data, error } = await supabase.rpc("save_project_setup_relation", {
        p_project: project.id,
        p_expected_updated_at: project.updatedAt,
        p_relation: relation,
        p_rows: value,
      });
      if (error) throw new Error(setupSaveMessage(error.message));
      return typeof data === "string" ? data : "";
    },
    () => readProjectByIdFresh(project.id)
  );
}
