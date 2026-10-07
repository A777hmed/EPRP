import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectPartyRow } from "@/lib/supabase/database.types";

/** A missing additive table is supported; permission/network errors must surface. */
export async function fetchProjectPartyRows(
  supabase: SupabaseClient, projectIds: string[]
): Promise<Map<string, ProjectPartyRow[]> | null> {
  const grouped = new Map<string, ProjectPartyRow[]>();
  if (projectIds.length === 0) return grouped;
  const { data, error } = await supabase.from("project_parties").select("*")
    .in("project_id", projectIds).order("sort_order", { ascending: true }).order("id", { ascending: true });
  if (error?.code === "PGRST205" || error?.code === "42P01") return null;
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ProjectPartyRow[]) {
    grouped.set(row.project_id, [...(grouped.get(row.project_id) ?? []), row]);
  }
  return grouped;
}

/** Before migration, retain ordinary zero-subcontractor saves; never silently drop new data. */
export async function preparePartyRelation(
  supabase: SupabaseClient, projectId: string, relations: Record<string, unknown[]>
): Promise<void> {
  if (!("parties" in relations)) return;
  const rows = await fetchProjectPartyRows(supabase, [projectId]);
  if (rows !== null) return;
  if (relations.parties.length > 0) {
    throw new Error("Subcontractor setup is not available yet. Contact your administrator.");
  }
  delete relations.parties;
}
