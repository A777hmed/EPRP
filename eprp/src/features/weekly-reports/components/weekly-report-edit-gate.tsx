import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared";

/**
 * Server-rendered refusal for the Weekly header EDIT route.
 *
 * `/weekly-reports/[reportId]/edit` and its project-scoped alias
 * (`/projects/[projectId]/reports/weekly/[reportId]/edit`) used to render
 * `WeeklyReportFormView` unconditionally: neither route resolved a viewer
 * scope, so any authenticated account could open the header edit form for any
 * project's Weekly Report regardless of assignment. The report detail page
 * already gates its own Edit link on
 * `isEditableReport(report) && editability.canEdit && scope?.canConsolidate`
 * (see `weekly-report-detail-view.tsx`); this is the same rule, applied at
 * the route the link points to, so reaching it directly — not just clicking
 * the hidden button — is refused the same way. RLS (`weekly_reports_update`,
 * `can_manage_reporting_workflow()`) remains the write boundary; this closes
 * the "handed a live form you cannot submit" gap in front of it.
 */
export function WeeklyReportEditDenied({ backHref }: { backHref: string }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting"
        title="Edit Weekly Report"
        description="The Weekly header is edited by Project Control, the assigned Report Coordinator, and platform administrators."
      />
      <EmptyState
        icon={Lock}
        title="You cannot edit this Weekly Report"
        description="This report is not open to you for editing — either it is outside your assigned project authority, it has left department collection, or it is not available. You can still view it from its project's own Reporting area."
        action={
          <Button variant="outline" asChild>
            <Link href={backHref}>Back</Link>
          </Button>
        }
        className="py-8"
      />
    </div>
  );
}
