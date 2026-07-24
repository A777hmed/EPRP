import type { Metadata } from "next";

import { MasterDataPageForm } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "New System" };

export default async function NewSystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = readProjectContext(await searchParams);
  return (
    <MasterDataPageForm
      kind="system"
      eyebrow="Master Data"
      basePath="/systems"
      context={context}
    />
  );
}
