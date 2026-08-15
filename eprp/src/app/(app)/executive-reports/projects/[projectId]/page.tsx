import type { Metadata } from "next";

import { ExecutiveProjectDrilldown } from "@/features/executive-reports";
import { getExecutiveViewerContext } from "@/features/executive-reports/executive-access";

export const metadata: Metadata = {
  title: "Project Executive View",
};

/**
 * Read-only executive detail for one project.
 *
 * `month` is read here on the server and passed down as a prop rather than with
 * `useSearchParams()` in the client component, which would need its own Suspense
 * boundary to keep the route renderable.
 */
export default async function ExecutiveProjectPage({
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
        deniedReason: viewer.deniedReason,
        contactId: viewer.contactId,
        isAdmin: viewer.isAdmin,
        viewerName: viewer.viewerName,
        roleLabel: viewer.roleLabel,
      }}
    />
  );
}
