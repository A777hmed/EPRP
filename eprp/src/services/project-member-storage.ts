import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectMemberRow } from "@/lib/supabase/database.types";
import type { ProjectMember } from "@/types";

/**
 * Project team membership reads (Phase 2C.3C). A database without the
 * additive table reads as "unavailable" (null), never as an empty team;
 * permission and network errors surface.
 */
export async function fetchProjectMemberRows(
  supabase: SupabaseClient, projectIds: string[]
): Promise<Map<string, ProjectMemberRow[]> | null> {
  const grouped = new Map<string, ProjectMemberRow[]>();
  if (projectIds.length === 0) return grouped;
  const { data, error } = await supabase.from("project_members").select("*")
    .in("project_id", projectIds).order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error?.code === "PGRST205" || error?.code === "42P01") return null;
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ProjectMemberRow[]) {
    grouped.set(row.project_id, [...(grouped.get(row.project_id) ?? []), row]);
  }
  return grouped;
}

export function memberFromRow(row: ProjectMemberRow): ProjectMember {
  return {
    id: row.id,
    projectId: row.project_id,
    contactId: row.contact_id,
    partyId: row.party_id ?? undefined,
    projectRole: row.project_role ?? undefined,
    reportsToMemberId: row.reports_to_member_id ?? undefined,
    endedAt: row.ended_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
