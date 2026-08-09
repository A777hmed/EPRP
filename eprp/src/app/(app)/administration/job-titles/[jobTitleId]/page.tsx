import type { Metadata } from "next";

import { JobTitleDetailView } from "@/features/master-data";

export const metadata: Metadata = { title: "Job Title Details" };

export default async function JobTitleDetailPage({
  params,
}: {
  params: Promise<{ jobTitleId: string }>;
}) {
  const { jobTitleId } = await params;
  return <JobTitleDetailView jobTitleId={jobTitleId} />;
}
