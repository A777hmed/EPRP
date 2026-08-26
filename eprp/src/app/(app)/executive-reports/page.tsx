import type { Metadata } from "next";

import { ExecutiveRegisterView } from "@/features/executive-reports";
import { getExecutiveViewerContext } from "@/features/executive-reports/executive-access";

export const metadata: Metadata = {
  title: "Executive Reports",
};

/**
 * The Executive Report Register.
 *
 * Consistent with `/weekly-reports` and `/monthly-reports`: the sidebar lands on
 * a register of reporting periods, and the consolidated report opens from a row.
 * The portfolio itself lives at `/executive-reports/portfolio`.
 */
export default async function ExecutiveReportsPage() {
  const viewer = await getExecutiveViewerContext();

  return (
    <ExecutiveRegisterView
      allowed={viewer.allowed}
      canManagePortfolio={viewer.canManagePortfolio}
      deniedReason={viewer.deniedReason}
      contactId={viewer.contactId}
      isAdmin={viewer.isAdmin}
      viewerName={viewer.viewerName}
      roleLabel={viewer.roleLabel}
    />
  );
}
