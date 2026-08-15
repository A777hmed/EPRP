import type { Metadata } from "next";

import { ExecutiveWorkspaceView } from "@/features/executive-reports";
import { getExecutiveViewerContext } from "@/features/executive-reports/executive-access";

export const metadata: Metadata = {
  title: "Executive Report Workspace",
};

/** Editable Executive-owned content for one reporting period. */
export default async function ExecutiveWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const viewer = await getExecutiveViewerContext();

  return (
    <ExecutiveWorkspaceView
      allowed={viewer.allowed}
      deniedReason={viewer.deniedReason}
      contactId={viewer.contactId}
      isAdmin={viewer.isAdmin}
      viewerName={viewer.viewerName}
      roleLabel={viewer.roleLabel}
      requestedMonth={month}
    />
  );
}
