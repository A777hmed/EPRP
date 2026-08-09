import type { Metadata } from "next";

import { MasterDataPageForm } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "New Program & Study" };

export default async function NewDisciplinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = readProjectContext(await searchParams);
  return (
    <MasterDataPageForm
      kind="discipline"
      eyebrow="Master Data"
      basePath="/disciplines"
      context={context}
    />
  );
}
