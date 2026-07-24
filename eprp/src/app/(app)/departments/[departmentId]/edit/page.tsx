import type { Metadata } from "next";

import { MasterDataPageForm } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "Edit Department" };

export default async function EditDepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ departmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { departmentId } = await params;
  const context = readProjectContext(await searchParams);
  return (
    <MasterDataPageForm
      kind="department"
      eyebrow="Master Data"
      recordId={departmentId}
      basePath="/departments"
      context={context}
    />
  );
}
