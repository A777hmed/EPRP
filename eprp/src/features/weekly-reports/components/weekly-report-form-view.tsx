"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";
import { projectService } from "@/services/project-service";
import {
  planningRollupService,
  type PlanningSnapshotRollup,
} from "@/services/planning-rollup-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type { Project, WeeklyActivity, WeeklyReport } from "@/types";
import { deriveWeeklyPlanningFigures } from "../planning-integration";
import {
  emptyWeeklyReportHeaderValues,
  weeklyReportToHeaderValues,
  type WeeklyReportHeaderValues,
} from "../schemas/weekly-report-header";
import { WeeklyReportHeaderForm } from "./weekly-report-header-form";

export interface WeeklyReportFormViewProps {
  reportId?: string;
  /**
   * Create or edit this report against ONE fixed project, and stay inside
   * that project afterwards (Top-Level Reporting 4A).
   *
   * Set by `/projects/[projectId]/reports/weekly/new` (create) and by
   * `/projects/[projectId]/reports/weekly/[reportId]/edit` (edit). The
   * project picker is locked (`projectLocked`) in both cases, and every
   * exit — save, cancel, "report not found" — returns to a project-scoped
   * route rather than the global register a project-context user never
   * came from.
   *
   * Omitted on the global `/weekly-reports/new` and
   * `/weekly-reports/[reportId]/edit`, which keep the picker (create) and
   * the global register (both) as their destinations. One form, two entry
   * contexts; no duplicated create/edit logic, validation or service call.
   */
  projectId?: string;
}

/** /weekly-reports/new and /weekly-reports/[id]/edit — form through Phase 6A.4. */
export function WeeklyReportFormView({
  reportId,
  projectId: fixedProjectId,
}: WeeklyReportFormViewProps) {
  const router = useRouter();
  const isEdit = reportId !== undefined;
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  /**
   * The report and its activities land in one state update: the form captures
   * its default values on mount, so a later arrival would leave the repeatable
   * rows empty.
   */
  const [loaded, setLoaded] = React.useState<{
    report: WeeklyReport | null;
    activities: WeeklyActivity[];
  } | null>(isEdit ? null : { report: null, activities: [] });
  /**
   * The rollup for the report's pinned snapshot (Planning Integration 3B),
   * loaded by id — never re-resolved by project/period. `null` once
   * resolved means "no pinned snapshot"; `undefined` means "not resolved
   * yet", so the form does not briefly render editable fields for a report
   * that turns out to be Planning-backed.
   */
  const [planningProvenance, setPlanningProvenance] = React.useState<
    PlanningSnapshotRollup | null | undefined
  >(isEdit ? undefined : null);

  React.useEffect(() => {
    projectService.getProjects().then(setProjects);
    if (!reportId) return;
    weeklyReportService.getById(reportId).then(async (found) => {
      if (!found) {
        setLoaded({ report: null, activities: [] });
        setPlanningProvenance(null);
        return;
      }
      // Neither submissions nor management items are loaded here: this form
      // edits neither. Both belong to the workspace.
      const activities = await weeklyReportService.listActivities(found.id);
      setLoaded({ report: found, activities });
      if (found.planningSnapshotId) {
        planningRollupService
          .computeSnapshotRollup(found.planningSnapshotId)
          .then(setPlanningProvenance);
      } else {
        setPlanningProvenance(null);
      }
    });
  }, [reportId]);

  if (
    projects === null ||
    loaded === null ||
    // Wait for the pinned snapshot's rollup before rendering, so a
    // Planning-backed report never briefly shows its progress fields as
    // editable while that resolution is still in flight.
    planningProvenance === undefined
  ) {
    return <LoadingState variant="page" label="Loading weekly report header…" />;
  }

  const { report, activities } = loaded;

  if (isEdit && report === null) {
    return (
      <EmptyState
        icon={FileX}
        title="Weekly report not found"
        description={`No weekly report exists with id “${reportId}”.`}
        action={
          <Button variant="outline" asChild>
            <Link href={fixedProjectId ? `/projects/${fixedProjectId}/reporting?tab=weekly` : "/weekly-reports"}>
              {fixedProjectId ? "Back to Reporting" : "Back to Weekly Reports"}
            </Link>
          </Button>
        }
      />
    );
  }

  const availableProjects = projects.filter(
    (project) =>
      (project.status !== "archived" && project.reporting.weeklyEnabled) ||
      project.id === report?.projectId ||
      // The fixed project is always offered, so a project-scoped create cannot
      // present an empty picker; the header form still validates it.
      project.id === fixedProjectId
  );
  const initialValues = report
    ? weeklyReportToHeaderValues(report, activities)
    : {
        ...emptyWeeklyReportHeaderValues(),
        // Seeds the locked picker. Empty string on the global route, which
        // leaves the existing "choose a project" behaviour untouched.
        projectId: fixedProjectId ?? "",
      };

  /*
   * Where this form came from decides where it goes back to — for BOTH
   * create and edit. `fixedProjectId` is set by
   * `/projects/[projectId]/reports/weekly/new` (create) and by
   * `/projects/[projectId]/reports/weekly/[reportId]/edit` (edit); either
   * way, every exit stays under that project's own routes rather than
   * dropping the user into the global register they never came from.
   */
  const projectScoped = Boolean(fixedProjectId);
  const afterCreateHref = (createdId: string) =>
    projectScoped
      ? `/projects/${fixedProjectId}/reports/weekly/${createdId}`
      : `/weekly-reports/${createdId}`;
  const afterSaveHref = (savedId: string) =>
    projectScoped
      ? `/projects/${fixedProjectId}/reports/weekly/${savedId}`
      : `/weekly-reports/${savedId}`;

  // Planning Integration 3B: a Planning-backed report's Planned/Actual
  // Progress are rendered read-only (see WeeklyReportHeaderForm) and are
  // never part of a save from here either — omitted entirely rather than
  // resent unchanged, so there is no path, silent or otherwise, by which
  // this form could touch them. The service independently refuses the
  // same edit if it is ever attempted another way.
  const planningBacked = deriveWeeklyPlanningFigures(planningProvenance).planningBacked;

  const handleSaveDraft = async (values: WeeklyReportHeaderValues) => {
    // Man-hours is optional: NaN maps to null so clearing a saved value persists.
    const manHoursToDate = Number.isNaN(values.manHoursToDate)
      ? null
      : values.manHoursToDate;
    const kpis = {
      ...(planningBacked
        ? {}
        : {
            plannedProgress: values.plannedProgress,
            actualProgress: values.actualProgress,
          }),
      manHoursToDate,
      hseStatus: values.hseStatus,
      qualityStatus: values.qualityStatus,
      overallProgressStatus: values.overallProgressStatus,
      // Empty string clears any previously saved narrative.
      summary: values.executiveSummary,
    };

    // Blank optional text/date/number fields are stored as "not set".
    const blank = (value?: string) => (value ? value : undefined);

    /*
     * Neither `saveSubmissions` nor `saveEntries` is called from here any
     * more.
     *
     * Both delete every row of their kind on the report and re-insert the
     * form's set — `saveEntries` without ids, so surviving rows came back with
     * new uuids and new `created_at` values. This form edits neither: the
     * workspace does, one row at a time. Calling them would delete input this
     * form never showed and reissue the ids of the rest. Nothing about the
     * stored rows changed; this form simply stops rewriting them.
     */

    const activityRows = values.activities.map((row) => ({
      id: row.id,
      title: row.title,
      departmentId: blank(row.departmentId),
      disciplineId: blank(row.disciplineId),
      ownerContactId: blank(row.ownerContactId),
      status: row.status,
      progressPercent: Number.isNaN(row.progressPercent)
        ? undefined
        : row.progressPercent,
      remarks: blank(row.remarks),
    }));

    if (isEdit && report) {
      const updated = await weeklyReportService.update(report.id, {
        periodStart: values.periodStart,
        preparedByContactId: values.preparedByContactId,
        disciplineIds: values.disciplineIds,
        ...kpis,
      });
      await weeklyReportService.saveActivities(updated.id, activityRows);
      toast.success(`Draft ${updated.reportNumber} saved`);
      router.push(afterSaveHref(updated.id));
      return;
    }

    const created = await weeklyReportService.create({
      projectId: values.projectId,
      periodStart: values.periodStart,
      preparedByContactId: values.preparedByContactId,
      disciplineIds: values.disciplineIds,
      ...kpis,
    });
    /*
     * The rows `create` seeds from the project's reporting departments are
     * left exactly as created. They are the workspace's starting point.
     */
    await weeklyReportService.saveActivities(created.id, activityRows);
    toast.success(`Draft ${created.reportNumber} saved`);
    router.push(afterCreateHref(created.id));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting"
        title={isEdit ? `Edit ${report?.reportNumber}` : "New Weekly Report"}
        description="Complete the weekly header, progress KPIs, Executive Summary and Major Activities, then save the report as a draft. Department input and management items are collected in the report workspace."
      />
      <WeeklyReportHeaderForm
        projects={availableProjects}
        initialValues={initialValues}
        existingReportNumber={report?.reportNumber}
        existingReportId={report?.id}
        // Locked on edit (as before) and on a project-scoped create, where the
        // project is the context the user is already standing in.
        projectLocked={isEdit || projectScoped}
        planningProvenance={planningProvenance}
        onSaveDraft={handleSaveDraft}
        onCancel={() =>
          router.push(
            isEdit && report
              ? afterSaveHref(report.id)
              : projectScoped
                ? `/projects/${fixedProjectId}/reporting?tab=weekly`
                : "/weekly-reports"
          )
        }
      />
    </div>
  );
}
