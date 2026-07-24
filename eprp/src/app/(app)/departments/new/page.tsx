import type { Metadata } from "next";

import { MasterDataPageForm } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "New Department" };

export default async function NewDepartmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = readProjectContext(await searchParams);
  return (
    <MasterDataPageForm
      kind="department"
      eyebrow="Master Data"
      basePath="/departments"
      context={context}
    />
  );
}
