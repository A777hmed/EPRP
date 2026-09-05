"use client";

import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
} from "@/components/shared";
import { projectService } from "@/services/project-service";
import { MonthlyNewView } from "@/features/monthly-reports";
import { WeeklyReportFormView } from "@/features/weekly-reports";
import type { Project } from "@/types";
import { useProjectAuthority } from "../../use-project-authority";

/**
 * Authorization gate for the project-scoped Weekly/Monthly CREATE routes.
 *
 * Those routes were added with their entry points gated but the routes
 * themselves open, so typing the URL still produced a live create form whose
 * save RLS would then refuse. The product rule is that row-level security is
 * the boundary, NOT the thing that tells a user they were never allowed in:
 * an unauthorized account must never be handed a mutation form at all.
 *
 * The rule is not restated here. `useProjectAuthority().canManageReporting`
 * is the existing mirror of `can_manage_reporting_workflow()` — the same
 * predicate that decides whether the "+ New …" actions render on the
 * Reporting tabs, and the same one `weekly_reports_insert` /
 * `monthly_reports_insert` apply in the database. One model, three places it
 * is read.
 *
 * The form is chosen by `kind` rather than passed in as `children` so that an
 * unauthorized render never even references the create view.
 *
 * PRESENTATION AUTHORITY ONLY. RLS is unchanged and still refuses the write
 * independently — this closes the "shown a form you cannot submit" gap, it is
 * not itself the boundary.
 */

type ReportKind = "weekly" | "monthly";

const COPY: Record<
  ReportKind,
  { label: string; tab: string; loading: string }
> = {
  weekly: {
    label: "Weekly Report",
    tab: "weekly",
    loading: "Loading Weekly report form…",
  },
  monthly: {
    label: "Monthly Report",
    tab: "monthly",
    loading: "Loading Monthly report form…",
  },
};

export interface ProjectReportCreateGateProps {
  projectId: string;
  kind: ReportKind;
}

export function ProjectReportCreateGate({
  projectId,
  kind,
}: ProjectReportCreateGateProps) {
  const copy = COPY[kind];
  const [project, setProject] = React.useState<Project | null | undefined>();
  const authority = useProjectAuthority(project ?? null);

  React.useEffect(() => {
    let cancelled = false;
    projectService
      .getProjectById(projectId)
      .then((loaded) => {
        if (!cancelled) setProject(loaded);
      })
      .catch(() => {
        if (!cancelled) setProject(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const reportingHref = `/projects/${projectId}/reporting?tab=${copy.tab}`;

  // Hold until BOTH the project and the identity have settled. Rendering the
  // form on an unresolved answer would flash a create form at an account that
  // is about to be refused it.
  if (project === undefined || !authority.resolved) {
    return <LoadingState variant="page" label={copy.loading} />;
  }

  if (project === null) {
    return (
      <EmptyState
        icon={Lock}
        title="Project not found"
        description="This project does not exist, or it has been removed."
        action={
          <Button variant="outline" asChild>
            <Link href="/projects">Back to Projects</Link>
          </Button>
        }
      />
    );
  }

  /*
   * Raising a report is `can_manage_reporting_workflow()`: the two global
   * authorities, the assigned Project Control / Planning, and the assigned
   * Report Coordinator. A Department Manager, ordinary Team Member,
   * Department User or Viewer contributes to a report they do not raise, so
   * none of them reach the form — by URL or otherwise.
   *
   * Refused in place rather than redirected, so the reader is told why
   * instead of being bounced somewhere without explanation. Project context
   * and the sidebar stay mounted; the action returns them to the Reporting
   * tab where their own authorized input lives.
   */
  if (!authority.canManageReporting) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={project.code}
          title={`New ${copy.label}`}
          description={`${copy.label}s for this project are raised by Project Control.`}
        />
        <SectionCard title="Raised by Project Control">
          <EmptyState
            icon={Lock}
            title={`You do not raise ${copy.label}s on this project`}
            description={`Creating a ${copy.label} is limited to Project Control, the assigned Report Coordinator, and platform administrators. You can still open this project's reporting and contribute the input your assignment covers.`}
            action={
              <Button variant="outline" asChild>
                <Link href={reportingHref}>Back to Reporting</Link>
              </Button>
            }
            className="py-8"
          />
        </SectionCard>
      </div>
    );
  }

  return kind === "weekly" ? (
    <WeeklyReportFormView projectId={projectId} />
  ) : (
    <MonthlyNewView projectId={projectId} />
  );
}
