"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import { useMasterData } from "@/features/master-data";
import {
  ProjectReportingShell,
  ReportContextHeader,
} from "@/features/projects/components/sections/project-reporting-shell";
import type { GlobalRegisterProject, GlobalWeeklyReportDetail } from "@/services/global-report-register";
import type { Contact, Discipline, ReportSignatory } from "@/types";
import { REPORT_STATUS_META } from "@/lib/constants";
import { WeeklyStatusBadge } from "./weekly-status-badge";
import type { WeeklyReportLinks } from "./weekly-report-detail-view";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function SignatoryLine({ role, people }: { role: string; people: ReportSignatory[] | undefined }) {
  if (!people || people.length === 0) return null;
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{role}</dt>
      <dd className="mt-0.5 text-sm">
        {people.map((p) => p.name + (p.title ? ` — ${p.title}` : "")).join(", ")}
      </dd>
    </div>
  );
}

/**
 * `/weekly-reports/[reportId]` fallback for a viewer with NO ordinary
 * (assignment-gated) access to this report's project — reached only when
 * `weeklyReportService.getById()` returned nothing AND
 * `fetchGlobalWeeklyReportDetail()` succeeded, which itself only happens
 * for a report already `approved`/`finalized`/`locked`
 * (`report_status_is_approved()`, enforced server-side inside the RPC —
 * this component never re-derives that decision, it only renders what the
 * RPC already decided to hand back).
 *
 * Deliberately a SEPARATE, minimal component rather than a branch inside
 * `WeeklyReportDetailView`: that view's Departments/Distribution/Management
 * Items/Plan/Lookahead sections all need department-level data
 * (`weekly_submissions`, `weekly_entries`, `weekly_plan_items`) this fallback
 * never fetches — rendering them here would either error on missing data or,
 * worse, render their normal "nothing here" empty state, which would read as
 * "this report genuinely has none" rather than "not shown in this view". This
 * component states that explicitly instead, and has zero edit/lifecycle
 * actions — read-only is not a UI choice here, there is no mutation path
 * wired at all.
 */
export function WeeklyReportCrossProjectView({
  detail,
  project,
  links,
}: {
  detail: GlobalWeeklyReportDetail;
  project: GlobalRegisterProject | null;
  links: WeeklyReportLinks;
}) {
  const { records: contactRecords } = useMasterData("contact");
  const { records: disciplineRecords } = useMasterData("discipline");
  const contacts = contactRecords as Contact[];
  const disciplines = disciplineRecords as Discipline[];

  const nameOf = (contactId: string | undefined) =>
    contactId ? contacts.find((c) => c.id === contactId)?.name ?? "Not recorded" : "Not recorded";
  const disciplineNames = detail.disciplineIds
    .map((id) => disciplines.find((d) => d.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <ProjectReportingShell
      header={
        <ReportContextHeader
          projectCode={project?.code}
          projectName={project?.shortName ?? project?.name ?? "Project"}
          period={`Week ${String(detail.weekNumber).padStart(2, "0")} · ${formatDate(detail.periodStart)} – ${formatDate(detail.periodEnd)}`}
          status={{
            label: REPORT_STATUS_META[detail.status].label,
            tone: REPORT_STATUS_META[detail.status].tone,
          }}
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
            report is {REPORT_STATUS_META[detail.status].label.toLowerCase()}, and only that
            published header/KPI/narrative content is shown here. Department submissions,
            comments and Project Control plan items are project-scoped and are not shown in this
            view. No edit, workflow, or approval action is available here.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={links.list}>
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              Back to Weekly Reports
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
              <WeeklyStatusBadge status={detail.status} />
            </Field>
            <Field label="Planned Progress">{detail.plannedProgress}%</Field>
            <Field label="Actual Progress">{detail.actualProgress}%</Field>
            {detail.manHoursToDate !== undefined && (
              <Field label="Man-hours to Date">{detail.manHoursToDate.toLocaleString()}</Field>
            )}
            {detail.hseStatus && <Field label="HSE Status">{detail.hseStatus}</Field>}
            {detail.qualityStatus && <Field label="Quality Status">{detail.qualityStatus}</Field>}
            {detail.overallProgressStatus && (
              <Field label="Overall Progress">{detail.overallProgressStatus}</Field>
            )}
            {disciplineNames.length > 0 && (
              <Field label="Disciplines">{disciplineNames.join(", ")}</Field>
            )}
          </dl>
        </SectionCard>

        {detail.summary && (
          <SectionCard title="Summary" description="Published narrative for this reporting week.">
            <p className="whitespace-pre-wrap text-sm">{detail.summary}</p>
          </SectionCard>
        )}

        <SectionCard title="Sign-off" description="Names snapshotted at the time each step was recorded.">
          <dl className="grid gap-4 sm:grid-cols-3">
            <SignatoryLine role="Prepared By" people={detail.signatories?.prepared} />
            <SignatoryLine role="Reviewed By" people={detail.signatories?.reviewed} />
            <SignatoryLine role="Approved By" people={detail.signatories?.approved} />
            {!detail.signatories?.prepared && (
              <Field label="Prepared By">{nameOf(detail.preparedByContactId)}</Field>
            )}
          </dl>
        </SectionCard>
      </div>
    </ProjectReportingShell>
  );
}
