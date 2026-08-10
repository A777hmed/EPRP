import type { Metadata } from "next";

import { MasterDataPageForm } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "Edit Discipline" };

export default async function EditDisciplinePage({
  params,
  searchParams,
}: {
  params: Promise<{ disciplineId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { disciplineId } = await params;
  const context = readProjectContext(await searchParams);
  return (
    <MasterDataPageForm
      kind="discipline"
      eyebrow="Master Data"
      recordId={disciplineId}
      basePath="/disciplines"
      context={context}
    />
  );
}
