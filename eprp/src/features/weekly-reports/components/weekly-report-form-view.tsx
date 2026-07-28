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
import type {
  Project,
  WeeklyActivity,
  WeeklyEntry,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";
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
   * Report, submissions, and entries land in one state update: the form
   * captures its default values on mount, so a later arrival would leave the
   * repeatable rows empty.
   */
  const [loaded, setLoaded] = React.useState<{
    report: WeeklyReport | null;
    submissions: WeeklySubmission[];
    entries: WeeklyEntry[];
    activities: WeeklyActivity[];
  } | null>(
    isEdit
      ? null
      : { report: null, submissions: [], entries: [], activities: [] }
  );

  React.useEffect(() => {
    projectService.getProjects().then(setProjects);
    if (!reportId) return;
    weeklyReportService.getById(reportId).then(async (found) => {
      if (!found) {
        setLoaded({
          report: null,
          submissions: [],
          entries: [],
          activities: [],
        });
        return;
      }
      const [submissions, entries, activities] = await Promise.all([
        weeklyReportService.listSubmissions(found.id),
        weeklyReportService.listEntries(found.id),
        weeklyReportService.listActivities(found.id),
      ]);
      setLoaded({ report: found, submissions, entries, activities });
    });
  }, [reportId]);

  if (projects === null || loaded === null) {
    return <LoadingState variant="page" label="Loading weekly report header…" />;
  }

  const { report, submissions, entries, activities } = loaded;

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
    ? weeklyReportToHeaderValues(report, submissions, entries, activities)
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
    const departmentUpdates = values.departmentUpdates.map((row) => ({
      id: row.id,
      departmentId: row.departmentId,
      disciplineId: blank(row.disciplineId),
      status: row.status,
      progressPercent: Number.isNaN(row.progressPercent)
        ? undefined
        : row.progressPercent,
      summary: blank(row.summary),
      keyAchievement: blank(row.keyAchievement),
      delayConstraint: blank(row.delayConstraint),
      nextWeekPlan: blank(row.nextWeekPlan),
      responsibleContactId: blank(row.responsibleContactId),
      targetDate: blank(row.targetDate),
    }));

    const entryRows = values.entries.map((row) => ({
      id: row.id,
      entryType: row.entryType,
      category: row.category,
      description: row.description,
      priority: row.priority,
      status: row.status,
      ownerContactId: blank(row.ownerContactId),
      dueDate: blank(row.dueDate),
      departmentId: blank(row.departmentId),
      systemId: blank(row.systemId),
      disciplineId: blank(row.disciplineId),
      includeInMonthly: row.includeInMonthly,
    }));

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
      await weeklyReportService.saveSubmissions(updated.id, departmentUpdates);
      await weeklyReportService.saveActivities(updated.id, activityRows);
      await weeklyReportService.saveEntries(updated.id, entryRows);
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
    // Replaces the rows auto-created from the project with the edited set.
    await weeklyReportService.saveSubmissions(created.id, departmentUpdates);
    await weeklyReportService.saveActivities(created.id, activityRows);
    await weeklyReportService.saveEntries(created.id, entryRows);
    toast.success(`Draft ${created.reportNumber} saved`);
    router.push(`/weekly-reports/${created.id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting"
        title={isEdit ? `Edit ${report?.reportNumber}` : "New Weekly Report"}
        description="Complete the weekly header, progress KPIs, department updates, and any comments, risks, issues, or actions, then save the report as a draft."
      />
      <WeeklyReportHeaderForm
        projects={availableProjects}
        initialValues={initialValues}
        existingReportNumber={report?.reportNumber}
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
