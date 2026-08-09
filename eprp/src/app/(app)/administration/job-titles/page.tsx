import type { Metadata } from "next";

import { JobTitlesListView } from "@/features/master-data";

export const metadata: Metadata = {
  title: "Job Titles",
};

/**
 * Search params mirror the other master-data lists: `focus` picks a record and
 * `mode=edit` opens it straight into its edit dialog.
 */
export default async function JobTitlesPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; mode?: string; return?: string }>;
}) {
  const { focus, mode, return: returnTo } = await searchParams;
  return (
    <JobTitlesListView
      focusId={focus}
      focusMode={mode === "edit" ? "edit" : "view"}
      returnTo={returnTo}
    />
  );
}
