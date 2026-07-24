import type { Metadata } from "next";
import { FolderOpen } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Documents",
};

export default function DocumentsPage() {
  return (
    <PlaceholderPage
      eyebrow="Insights"
      title="Documents"
      description="Project documents, attachments, and reference material."
      icon={FolderOpen}
    />
  );
}
