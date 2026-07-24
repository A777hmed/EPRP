import type { Metadata } from "next";

import { SystemDetailView } from "@/features/master-data";
import { readProjectContext } from "@/features/projects/project-link-context";

export const metadata: Metadata = { title: "System Details" };

export default async function SystemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ systemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { systemId } = await params;
  const context = readProjectContext(await searchParams);
  return <SystemDetailView systemId={systemId} context={context} />;
}
