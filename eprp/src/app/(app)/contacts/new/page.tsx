import type { Metadata } from "next";

import { MasterDataPageForm } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "New Contact" };

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = readProjectContext(await searchParams);
  return (
    <MasterDataPageForm
      kind="contact"
      eyebrow="Master Data"
      basePath="/contacts"
      context={context}
    />
  );
}
