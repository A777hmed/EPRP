import { isEditableStatus } from "@/config/workflows";
import type { MonthlyReport, ProjectLifecycleStatus } from "@/types";
import type { WeeklyScope } from "@/features/weekly-reports/scope";

/**
 * Pure Monthly editability rule, extracted from `monthly-viewer-context.ts`
 * (which is `"server-only"` and so cannot be loaded by a plain unit test)
 * so it can be exercised directly — the same separation `scope.ts`'s
 * `weeklyEditability` already has from `viewer-context.ts`.
 *
 * Whether this viewer may still write department input for this Monthly.
 *
 * Project Control keeps writing for as long as its own policies allow, so its
 * verdict does not depend on the round being open. Everyone else is bound by
 * `monthlyWorkflow.editableIn`, which is the same list
 * `monthly_report_accepts_department_input()` mirrors in SQL — so the control
 * offered and the write permitted cannot drift apart.
 *
 * `projectStatus` is optional so a caller without the project row loaded
 * keeps working (it simply skips the archived-project check below).
 */
export function monthlyEditability(
  scope: WeeklyScope,
  status: MonthlyReport["status"],
  projectStatus?: ProjectLifecycleStatus | null
): { canEdit: boolean; reason?: string } {
  if (scope.capability === "none") {
    return {
      canEdit: false,
      reason:
        "You have no assignments on this project, so this Monthly Report is read-only for you.",
    };
  }
  if (scope.capability === "portfolio_read") {
    // Same distinction as the Weekly mirror (`scope.ts`'s weeklyEditability):
    // a portfolio-wide READ grant working as designed, not a missing
    // assignment — and never editable, regardless of the round being open.
    return {
      canEdit: false,
      reason:
        scope.portfolioReadTier === "published"
          ? "You have Published Portfolio Read access. This Monthly Report is shown because it is finalized or locked; editing requires an assignment on this project."
          : "You have Full Portfolio Read access to this project. Viewing only — editing requires an assignment on this project.",
    };
  }
  /*
   * ACCESS & VISIBILITY HOTFIX (3A/3B) — archived is read-only for
   * EVERYONE, with no `canConsolidate` override, mirroring the Weekly twin
   * of this function (`scope.ts`'s `weeklyEditability`).
   *
   * Before this, `scope.canConsolidate` returned `canEdit: true`
   * unconditionally, so Project Control's own department/comment/plan/
   * summary CONTENT stayed editable on a report already `finalized`,
   * `locked` or `archived`, and on any report belonging to an archived
   * project. This governs CONTENT only — `monthly-workspace.tsx`'s
   * `ApprovalPanel` is deliberately NOT gated on this result, so the
   * lifecycle transitions that only happen once content is closed
   * (finalized → locked, locked → archived, archive from most states)
   * remain reachable for whoever holds `canControlReportLifecycle`; see
   * that file's `canOpenApprovalPanel` / `contentEditable` split.
   */
  if (projectStatus === "archived") {
    return {
      canEdit: false,
      reason:
        "This project is archived. Archived projects are historical and read-only.",
    };
  }
  if (status === "locked" || status === "finalized" || status === "archived") {
    return {
      canEdit: false,
      reason:
        status === "archived"
          ? "This Monthly Report is archived. Archived reports are historical and read-only."
          : status === "finalized"
            ? "This Monthly Report is finalised. Content changes require a new revision; lifecycle actions (e.g. lock) remain available."
            : "This Monthly Report is locked. Changes require a new revision — locked reports stay immutable.",
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
