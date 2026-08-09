import type { Metadata } from "next";

import { MasterDataPageForm } from "@/features/master-data";

export const metadata: Metadata = { title: "New Job Title" };

export default function NewJobTitlePage() {
  return (
    <MasterDataPageForm
      kind="jobTitle"
      eyebrow="Administration"
      basePath="/administration/job-titles"
    />
  );
}
