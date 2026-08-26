import type { Metadata } from "next";

import { ExecutivePortfolioView } from "@/features/executive-reports";
import { getExecutiveViewerContext } from "@/features/executive-reports/executive-access";

export const metadata: Metadata = {
  title: "Project Portfolio Executive Report",
};

/**
 * The consolidated multi-project Executive Report for one reporting period.
 *
 * ONE portfolio report per period — never one report per project. Individual
 * projects are reached as read-only drill-downs beneath it.
 */
export default async function ExecutivePortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const viewer = await getExecutiveViewerContext();

  return (
    <ExecutivePortfolioView
      allowed={viewer.allowed}
      canManagePortfolio={viewer.canManagePortfolio}
      deniedReason={viewer.deniedReason}
      contactId={viewer.contactId}
      isAdmin={viewer.isAdmin}
      viewerName={viewer.viewerName}
      roleLabel={viewer.roleLabel}
      requestedMonth={month}
    />
  );
}
