import type { Metadata } from "next";

import { MasterDataPageForm } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "Edit Contact" };

export default async function EditContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { contactId } = await params;
  const context = readProjectContext(await searchParams);
  return (
    <MasterDataPageForm
      kind="contact"
      eyebrow="Master Data"
      recordId={contactId}
      basePath="/contacts"
      context={context}
    />
  );
}
