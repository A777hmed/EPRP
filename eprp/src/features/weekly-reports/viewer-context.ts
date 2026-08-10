import "server-only";

import { cache } from "react";

import { getCurrentUserIdentity } from "@/features/auth/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type {
  ProjectContactRow,
  ProjectDepartmentRow,
  ProjectRow,
  ProjectTypeRow,
  WeeklyReportRow,
} from "@/lib/supabase/database.types";
import { rowToProject } from "@/services/supabase-project-service";
import type { ProjectType, ReportStatus } from "@/types";
import {
  weeklyEditability,
  type WeeklyEditability,
  type WeeklyScope,
} from "./scope";
import { getWeeklyViewerScope } from "./viewer-scope";

/**
 * The Weekly workspace's authorization props, resolved on the server.
 *
 * The workspace itself is a client component — it edits, saves and reloads —
 * but "who is asking?" is a server question: it depends on the auth cookie and
 * on the `profiles` row that links a login to a contact. Resolving it here and
 * passing the ANSWER down means the client never re-derives authority, so
 * there is exactly one scope model (`resolveWeeklyScope`) and one editability
 * rule (`weeklyEditability`), both already committed.
 *
 * This decides what to RENDER. Row-level security is the boundary and enforces
 * the same rules independently — a tampered client sees an empty screen, not
 * someone else's department.
 */
export interface WeeklyViewerContext {
  /**
   * True when the platform runs on mock data. No login exists, so no identity
   * can be scoped — the client falls back to an explicitly demo-only scope
   * rather than pretending someone was authenticated.
   */
  demoMode: boolean;
  /** The signed-in viewer's scope, or null when it could not be resolved. */
  scope: WeeklyScope | null;
  /** Derived from `scope` + the status below. Null whenever `scope` is. */
  editability: WeeklyEditability | null;
  /**
   * The lifecycle status as the server read it. The client compares it with
   * the report it loads and re-derives editability if the two have drifted,
   * using the same function rather than a second rule.
   */
  reportStatus: ReportStatus | null;
  /** For the "you are viewing as…" line. Display only, never authority. */
  viewerName?: string;
  viewerRoleLabel?: string;
}

const DENIED: WeeklyViewerContext = {
  demoMode: false,
  scope: null,
  editability: null,
  reportStatus: null,
};

function rowToProjectType(row: ProjectTypeRow): ProjectType {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? undefined,
    description: row.description ?? undefined,
    active: row.active,
  };
}

/**
 * Resolve one viewer's scope for one Weekly report.
 *
 * Reads the report only to learn which project it belongs to and how far
 * through the lifecycle it is; the scope itself comes from the project's own
 * assignments. Every read goes through the request-cookie client, so a report
 * the viewer may not see returns nothing here for the same reason it returns
 * nothing to the client — RLS, not a check written twice.
 *
 * `cache()`d so the page and its metadata share one resolution.
 */
export const getWeeklyViewerContext = cache(
  async (reportId: string): Promise<WeeklyViewerContext> => {
    // No backend: the whole app is running on mock data, so there is no
    // identity to resolve. Reported as such rather than guessed at.
    if (!isSupabaseConfigured()) {
      return { ...DENIED, demoMode: true };
    }

    const supabase = await createSupabaseServerClient();

    const { data: reportData } = await supabase
      .from("weekly_reports")
      .select("id, project_id, status")
      .eq("id", reportId)
      .maybeSingle();

    const report = reportData as Pick<
      WeeklyReportRow,
      "id" | "project_id" | "status"
    > | null;
    if (!report) return DENIED;

    const { data: projectData } = await supabase
      .from("projects")
      .select("*")
      .eq("id", report.project_id)
      .maybeSingle();

    const projectRow = projectData as ProjectRow | null;
    if (!projectRow) return DENIED;

    const [{ data: deptData }, { data: teamData }] = await Promise.all([
      supabase
        .from("project_departments")
        .select("*")
        .eq("project_id", projectRow.id),
      supabase
        .from("project_contacts")
        .select("*")
        .eq("project_id", projectRow.id),
    ]);

    /*
     * Disciplines and delegations are deliberately not fetched: scope
     * resolution reads only the department list, the team, and the two
     * project-control contacts. This Project never leaves the server — it
     * exists to answer one question — so the unread arrays stay empty rather
     * than costing two more queries on every page load.
     */
    const project = rowToProject(
      projectRow,
      (deptData ?? []) as ProjectDepartmentRow[],
      [],
      (teamData ?? []) as ProjectContactRow[],
      []
    );

    let projectType: ProjectType | null = null;
    if (projectRow.project_type_id) {
      const { data: typeData } = await supabase
        .from("project_types")
        .select("*")
        .eq("id", projectRow.project_type_id)
        .maybeSingle();
      const typeRow = typeData as ProjectTypeRow | null;
      if (typeRow) projectType = rowToProjectType(typeRow);
    }

    const [scope, identity] = await Promise.all([
      getWeeklyViewerScope(project, projectType),
      getCurrentUserIdentity(),
    ]);

    const status = report.status as ReportStatus;

    return {
      demoMode: false,
      scope,
      editability: weeklyEditability(scope, status),
      reportStatus: status,
      viewerName: identity?.fullName,
      viewerRoleLabel: identity?.roleLabel,
    };
  }
);
