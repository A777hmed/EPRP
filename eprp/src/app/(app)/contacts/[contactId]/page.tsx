import type { Metadata } from "next";

import { ContactDetailView } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "Contact Details" };

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { contactId } = await params;
  const context = readProjectContext(await searchParams);
  return <ContactDetailView contactId={contactId} context={context} />;
}
