"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import { getMonthLabel } from "@/lib/reporting";
import { useMasterData } from "@/features/master-data";
import {
  ProjectReportingShell,
  ReportContextHeader,
} from "@/features/projects/components/sections/project-reporting-shell";
import type { GlobalMonthlyReportDetail } from "@/services/global-report-register";
import type { GlobalRegisterProject } from "@/services/global-report-register";
import type { Contact } from "@/types";
import { StatusBadge } from "@/components/shared";
import { monthlyStatusMeta } from "./monthly-data";
import type { MonthlyReportLinks } from "./monthly-report-view";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/**
 * `/monthly-reports/[reportId]` fallback for a viewer with NO ordinary
 * (assignment-gated) access to this report's project — reached only when
 * `monthlyReportService.getById()` returned nothing AND
 * `fetchGlobalMonthlyReportDetail()` succeeded, which only happens for a
 * report already `approved`/`finalized`/`locked`
 * (`report_status_is_approved()`, enforced inside the RPC).
 *
 * Mirrors `WeeklyReportCrossProjectView`'s reasoning exactly: department
 * content (`monthly_comments`, `monthly_department_summaries`,
 * `monthly_plan_items`, the imported Weekly breakdown) is not fetched here,
 * so it is never rendered as a false "nothing here" empty state — this
 * component states plainly that it is out of scope for this view. Zero
 * edit/lifecycle actions; there is no mutation path wired at all.
 */
export function MonthlyReportCrossProjectView({
  detail,
  project,
  links,
}: {
  detail: GlobalMonthlyReportDetail;
  project: GlobalRegisterProject | null;
  links: MonthlyReportLinks;
}) {
  const { records: contactRecords } = useMasterData("contact");
  const contacts = contactRecords as Contact[];
  const nameOf = (contactId: string | undefined) =>
    contactId ? contacts.find((c) => c.id === contactId)?.name ?? "Not recorded" : "Not recorded";
  const statusMeta = monthlyStatusMeta(detail.status);

  return (
    <ProjectReportingShell
      header={
        <ReportContextHeader
          projectCode={project?.code}
          projectName={project?.shortName ?? project?.name ?? "Project"}
          period={getMonthLabel(detail.reportingMonth)}
          status={{ label: statusMeta.label, tone: statusMeta.tone }}
          updatedAt={formatDate(detail.updatedAt)}
        />
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            You are viewing this report&rsquo;s published summary in read-only, cross-project mode
            — you are not assigned to {project?.shortName ?? project?.name ?? "this project"}. This
            report is {statusMeta.label.toLowerCase()}, and only that published header/KPI/Executive
            Summary content is shown here. Department summaries, comments and Project Control plan
            items are project-scoped and are not shown in this view. No edit, workflow, or approval
            action is available here.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={links.list}>
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              Back to Monthly Reports
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={links.preview(detail.id)}>
              <Eye data-icon="inline-start" aria-hidden="true" />
              Preview
            </Link>
          </Button>
        </div>

        <SectionCard title="Report Summary" description="Published header and KPIs.">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Report #">{detail.reportNumber}</Field>
            <Field label="Status">
              <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
            </Field>
            <Field label="Planned Progress">{detail.plannedProgress.toFixed(1)}%</Field>
            <Field label="Actual Progress">{detail.actualProgress.toFixed(1)}%</Field>
            {detail.hseStatus && <Field label="HSE Status">{detail.hseStatus}</Field>}
            {detail.qualityStatus && <Field label="Quality Status">{detail.qualityStatus}</Field>}
            {detail.overallProgressStatus && (
              <Field label="Overall Progress">{detail.overallProgressStatus}</Field>
            )}
            <Field label="Prepared By">{nameOf(detail.preparedByContactId)}</Field>
            {detail.approvedByContactId && (
              <Field label="Approved By">{nameOf(detail.approvedByContactId)}</Field>
            )}
          </dl>
        </SectionCard>

        {detail.executiveSummary && (
          <SectionCard title="Executive Summary" description="Published narrative for this reporting month.">
            <p className="whitespace-pre-wrap text-sm">{detail.executiveSummary}</p>
          </SectionCard>
        )}
      </div>
    </ProjectReportingShell>
  );
}
