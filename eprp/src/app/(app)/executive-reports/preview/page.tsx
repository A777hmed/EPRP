import type { Metadata } from "next";

import { ExecutivePreviewView } from "@/features/executive-reports";
import { getExecutiveViewerContext } from "@/features/executive-reports/executive-access";

export const metadata: Metadata = {
  title: "Executive Report Preview",
};

/** Print stage for the portfolio document — same structure, same data, no chrome. */
export default async function ExecutiveReportPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const viewer = await getExecutiveViewerContext();

  return (
    <ExecutivePreviewView
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
