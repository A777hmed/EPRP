import type { Metadata } from "next";

import { DisciplinesListView } from "@/features/master-data";

export const metadata: Metadata = {
  title: "Programs & Studies",
};

/**
 * Search params carry deep links from the project setup wizard:
 * `focus` picks a record, `mode=edit` opens it for editing, and
 * `return` is the wizard step to go back to.
 */
export default async function DisciplinesPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; mode?: string; return?: string }>;
}) {
  const { focus, mode, return: returnTo } = await searchParams;
  return (
    <DisciplinesListView
      focusId={focus}
      focusMode={mode === "edit" ? "edit" : "view"}
      returnTo={returnTo}
    />
  );
}
