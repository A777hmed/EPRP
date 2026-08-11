"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type { Project, WeeklyActivity, WeeklyReport } from "@/types";
import {
  emptyWeeklyReportHeaderValues,
  weeklyReportToHeaderValues,
  type WeeklyReportHeaderValues,
} from "../schemas/weekly-report-header";
import { WeeklyReportHeaderForm } from "./weekly-report-header-form";

export interface WeeklyReportFormViewProps {
  reportId?: string;
}

/** /weekly-reports/new and /weekly-reports/[id]/edit — form through Phase 6A.4. */
export function WeeklyReportFormView({ reportId }: WeeklyReportFormViewProps) {
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

  React.useEffect(() => {
    projectService.getProjects().then(setProjects);
    if (!reportId) return;
    weeklyReportService.getById(reportId).then(async (found) => {
      if (!found) {
        setLoaded({ report: null, activities: [] });
        return;
      }
      // Neither submissions nor management items are loaded here: this form
      // edits neither. Both belong to the workspace.
      const activities = await weeklyReportService.listActivities(found.id);
      setLoaded({ report: found, activities });
    });
  }, [reportId]);

  if (projects === null || loaded === null) {
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
            <Link href="/weekly-reports">Back to Weekly Reports</Link>
          </Button>
        }
      />
    );
  }

  const availableProjects = projects.filter(
    (project) =>
      (project.status !== "archived" && project.reporting.weeklyEnabled) ||
      project.id === report?.projectId
  );
  const initialValues = report
    ? weeklyReportToHeaderValues(report, activities)
    : emptyWeeklyReportHeaderValues();

  const handleSaveDraft = async (values: WeeklyReportHeaderValues) => {
    // Man-hours is optional: NaN maps to null so clearing a saved value persists.
    const manHoursToDate = Number.isNaN(values.manHoursToDate)
      ? null
      : values.manHoursToDate;
    const kpis = {
      plannedProgress: values.plannedProgress,
      actualProgress: values.actualProgress,
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
      router.push(`/weekly-reports/${updated.id}`);
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
    router.push(`/weekly-reports/${created.id}`);
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
        projectLocked={isEdit}
        onSaveDraft={handleSaveDraft}
        onCancel={() =>
          router.push(
            isEdit && report
              ? `/weekly-reports/${report.id}`
              : "/weekly-reports"
          )
        }
      />
    </div>
  );
}
