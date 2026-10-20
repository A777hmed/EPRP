import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { projectWorkflowHref } from "@/config/project-workflow";

export const metadata: Metadata = {
  title: "Edit Project",
};

/**
 * Compatibility redirect (Phase 13.9B Step 4). Project Setup is the one
 * canonical editing experience: it presents field classes once Setup is
 * Controlled (amendments, approvals, structure governance), which this route's
 * older standalone form did not. Every existing link and bookmark to
 * `/projects/[projectId]/edit` lands on Project Setup → Project Info instead,
 * with any query string kept; a `#section` fragment is kept by the browser and
 * still targets the same form section. Draft and not-yet-Controlled projects
 * edit there exactly as before.
 */
export default async function EditProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const suffix = query.toString();
  redirect(`${projectWorkflowHref(projectId, "info")}${suffix ? `?${suffix}` : ""}`);
}
