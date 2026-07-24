import type { Metadata } from "next";

import { SystemsListView } from "@/features/master-data";

export const metadata: Metadata = {
  title: "Systems",
};

/**
 * Search params carry deep links from the project setup wizard:
 * `focus` picks a record, `mode=edit` opens it for editing, and
 * `return` is the wizard step to go back to.
 */
export default async function SystemsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; mode?: string; return?: string }>;
}) {
  const { focus, mode, return: returnTo } = await searchParams;
  return (
    <SystemsListView
      focusId={focus}
      focusMode={mode === "edit" ? "edit" : "view"}
      returnTo={returnTo}
    />
  );
}
