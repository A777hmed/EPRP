import type { Metadata } from "next";

import { MasterDataPageForm } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "Edit System" };

export default async function EditSystemPage({
  params,
  searchParams,
}: {
  params: Promise<{ systemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { systemId } = await params;
  const context = readProjectContext(await searchParams);
  return (
    <MasterDataPageForm
      kind="system"
      eyebrow="Master Data"
      recordId={systemId}
      basePath="/systems"
      context={context}
    />
  );
}
