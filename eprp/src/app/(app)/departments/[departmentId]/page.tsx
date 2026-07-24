import type { Metadata } from "next";

import { DepartmentDetailView } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "Department Details" };

export default async function DepartmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ departmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { departmentId } = await params;
  const context = readProjectContext(await searchParams);
  return (
    <DepartmentDetailView departmentId={departmentId} context={context} />
  );
}
