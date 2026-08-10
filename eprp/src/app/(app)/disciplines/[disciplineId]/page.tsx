import type { Metadata } from "next";

import { DisciplineDetailView } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "Discipline Details" };

export default async function DisciplineDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ disciplineId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { disciplineId } = await params;
  const context = readProjectContext(await searchParams);
  return (
    <DisciplineDetailView disciplineId={disciplineId} context={context} />
  );
}
