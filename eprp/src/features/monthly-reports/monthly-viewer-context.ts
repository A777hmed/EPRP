import "server-only";

import { cache } from "react";

import { getCurrentUserIdentity } from "@/features/auth/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isEditableStatus } from "@/config/workflows";
import type {
  MonthlyReportRow,
  ProjectContactRow,
  ProjectDepartmentRow,
  ProjectRow,
  ProjectTypeRow,
} from "@/lib/supabase/database.types";
import { rowToProject } from "@/services/supabase-project-service";
import type { MonthlyReport, ProjectType } from "@/types";
import { getWeeklyViewerScope } from "@/features/weekly-reports/viewer-scope";
import type { WeeklyScope } from "@/features/weekly-reports/scope";

/**
 * "Who is asking?" for a Monthly report, resolved on the server.
 *
 * WHY THIS EXISTS. The Monthly workspace resolved no authority at all: it is a
 * client component that loads a report and renders every panel to everybody,
 * because until now only Project Control ever opened it. The department round
 * changes that — a Department User must reach their own department's Monthly
 * input and nothing else — and "which contact is this?" is a server question,
 * decided by the auth cookie and the `profiles` row that links a login to a
 * contact.
 *
 * WHAT IS REUSED. `getWeeklyViewerScope()` resolves a contact's scope from the
 * PROJECT — departments assigned, scope items held, and whether they are the
 * Department Manager — and asks the Weekly tier nothing. Reusing it is what
 * makes a Department Manager the same person in both tiers rather than two
 * implementations that can disagree. Only the report lookup and the editable
 * status set differ here, and the latter comes from `monthlyWorkflow` rather
 * than being restated.
 *
 * This decides what to RENDER. `monthly_submissions` and `monthly_comments`
 * row-level security is the boundary and enforces the same rules independently.
 */
export interface MonthlyViewerContext {
  /** Mock mode: no login exists, so no identity can be scoped. */
  demoMode: boolean;
  scope: WeeklyScope | null;
  /** Whether the department round is open to this viewer, and why not. */
  editability: { canEdit: boolean; reason?: string } | null;
  reportStatus: MonthlyReport["status"] | null;
  viewerName?: string;
  viewerRoleLabel?: string;
}

const DENIED: MonthlyViewerContext = {
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
 * Whether this viewer may still write department input for this Monthly.
 *
 * Project Control keeps writing for as long as its own policies allow, so its
 * verdict does not depend on the round being open. Everyone else is bound by
 * `monthlyWorkflow.editableIn`, which is the same list
 * `monthly_report_accepts_department_input()` mirrors in SQL — so the control
 * offered and the write permitted cannot drift apart.
 */
function monthlyEditability(
  scope: WeeklyScope,
  status: MonthlyReport["status"]
): { canEdit: boolean; reason?: string } {
  if (scope.capability === "none") {
    return {
      canEdit: false,
      reason:
        "You have no assignments on this project, so this Monthly Report is read-only for you.",
    };
  }
  if (scope.canConsolidate) return { canEdit: true };
  if (!isEditableStatus("monthly", status)) {
    return {
      canEdit: false,
      reason:
        "This Monthly Report has left the department round, so your department input is read-only.",
    };
  }
  return { canEdit: true };
}

export const getMonthlyViewerContext = cache(
  async (reportId: string): Promise<MonthlyViewerContext> => {
    if (!isSupabaseConfigured()) return { ...DENIED, demoMode: true };

    const supabase = await createSupabaseServerClient();

    const { data: reportData } = await supabase
      .from("monthly_reports")
      .select("id, project_id, status")
      .eq("id", reportId)
      .maybeSingle();

    const report = reportData as Pick<
      MonthlyReportRow,
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
     * resolution reads the department list, the team and the project-control
     * contacts only. This Project never leaves the server.
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

    const status = report.status as MonthlyReport["status"];

    return {
      demoMode: false,
      scope,
      editability: monthlyEditability(scope, status),
      reportStatus: status,
      viewerName: identity?.fullName,
      viewerRoleLabel: identity?.roleLabel,
    };
  }
);
