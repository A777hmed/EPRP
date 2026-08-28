import type { Metadata } from "next";

import { ExecutiveProjectDrilldown } from "@/features/executive-reports";
import { getExecutiveViewerContext } from "@/features/executive-reports/executive-access";

export const metadata: Metadata = {
  title: "Project Executive View",
};

/**
 * Project-scoped alias for the Project Executive drill-down.
 *
 * Same view as `/executive-reports/projects/[projectId]` — only the URL
 * differs, so opening it from a project's Reporting tab keeps
 * `activeProjectId(pathname)` truthy and the project sidebar stays mounted.
 * `ExecutiveProjectDrilldown` and `getExecutiveViewerContext` are the exact
 * same function and component the global route uses; no logic is
 * duplicated. The drill-down's own "← Portfolio" link is left pointing at
 * the global register — that is a deliberate, labeled exit to portfolio
 * scope, not an accidental one.
 */
export default async function ProjectReportsExecutivePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ month?: string; tab?: string }>;
}) {
  const { projectId } = await params;
  const { month, tab } = await searchParams;
  const viewer = await getExecutiveViewerContext();

  return (
    <ExecutiveProjectDrilldown
      projectId={projectId}
      requestedMonth={month}
      requestedTab={tab}
      viewer={{
        allowed: viewer.allowed,
        canManagePortfolio: viewer.canManagePortfolio,
        deniedReason: viewer.deniedReason,
        contactId: viewer.contactId,
        isAdmin: viewer.isAdmin,
        viewerName: viewer.viewerName,
        roleLabel: viewer.roleLabel,
      }}
    />
  );
}
