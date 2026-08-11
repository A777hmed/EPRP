"use client";

import Link from "next/link";
import { ArrowRight, PanelsTopLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import type { HierarchyTerms } from "@/config/project-terminology";

export interface WeeklyWorkspacePointerProps {
  /** Present only when editing a saved report. */
  reportId?: string;
  terms: HierarchyTerms;
  departmentCount: number;
}

/**
 * Where department and scope-item input actually happens.
 *
 * This form used to carry a second editor for the same `weekly_submissions`
 * rows the workspace edits. The two wrote differently — this one replace-all,
 * the workspace one row at a time — so a Save Draft here could rewrite or
 * delete work done there. The editor is gone; this says where it went, so the
 * absence reads as a decision rather than a missing section.
 */
export function WeeklyWorkspacePointer({
  reportId,
  terms,
  departmentCount,
}: WeeklyWorkspacePointerProps) {
  return (
    <SectionCard
      title="Department Updates"
      description={`Collected in the report workspace, one department and ${terms.singularLower} at a time.`}
      action={
        reportId ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/weekly-reports/${reportId}/workspace`}>
              Open workspace
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        ) : undefined
      }
    >
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <PanelsTopLeft className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {departmentCount > 0
            ? `This project's ${departmentCount} assigned department${departmentCount === 1 ? "" : "s"} and their ${terms.pluralLower} are edited in the workspace, where each row is saved on its own and department access is enforced.`
            : `Department and ${terms.singularLower} input is edited in the workspace, where each row is saved on its own and department access is enforced.`}
          {!reportId && " Save this draft first, then open the workspace."}
        </span>
      </p>
    </SectionCard>
  );
}
