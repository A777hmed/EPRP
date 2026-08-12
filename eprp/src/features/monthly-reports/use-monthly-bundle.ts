"use client";
/* Monthly data loads from the browser service after mount. */
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react";
import { toast } from "sonner";

import { useMasterData } from "@/features/master-data";
import { useHierarchyTerms } from "@/features/weekly-reports/use-hierarchy-terms";
import { monthlyReportService } from "@/services/monthly-report-service";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type {
  Client,
  Contact,
  MonthlyComment,
  MonthlyDepartmentSummary,
  MonthlyPlanItem,
  MonthlyReport,
  Project,
  WeeklyReport,
} from "@/types";
import type { MonthlyReportBundle } from "./monthly-report-document";
import type { NamedRecord, WeeklySubmissionInMonth } from "./monthly-data";

export interface MonthlyBundleState {
  /** undefined while loading, null when the report does not exist. */
  bundle: MonthlyReportBundle | null | undefined;
  /** Other Monthly reports on the same project, newest first. */
  siblings: MonthlyReport[];
  reload: () => Promise<void>;
}

/**
 * Load one Monthly report and everything the document renders from.
 *
 * Weekly rows are read, never written: the month's Weekly reports and their
 * submissions supply the breakdown table and the only numeric progress the
 * scope table can show.
 */
export function useMonthlyBundle(reportId: string): MonthlyBundleState {
  const { records: departments } = useMasterData("department");
  const { records: systems } = useMasterData("system");
  const { records: disciplines } = useMasterData("discipline");
  const { records: contacts } = useMasterData("contact");
  const { records: clients } = useMasterData("client");

  const [report, setReport] = React.useState<MonthlyReport | null | undefined>();
  const [project, setProject] = React.useState<Project | null>(null);
  const [comments, setComments] = React.useState<MonthlyComment[]>([]);
  const [plans, setPlans] = React.useState<MonthlyPlanItem[]>([]);
  const [summaries, setSummaries] = React.useState<MonthlyDepartmentSummary[]>([]);
  const [weeklies, setWeeklies] = React.useState<WeeklyReport[]>([]);
  const [submissions, setSubmissions] = React.useState<WeeklySubmissionInMonth[]>([]);
  const [siblings, setSiblings] = React.useState<MonthlyReport[]>([]);

  const terms = useHierarchyTerms(project);

  const reload = React.useCallback(async () => {
    try {
      const next = await monthlyReportService.getById(reportId);
      if (!next) {
        setReport(null);
        return;
      }

      const month = next.reportingMonth.slice(0, 7);
      const [nextProject, nextComments, nextPlans, nextSummaries, projectReports, allWeeklies] = await Promise.all([
        projectService.getProjectById(next.projectId),
        monthlyReportService.listComments(next.id),
        monthlyReportService.listPlanItems(next.id),
        monthlyReportService.listSummaries(next.id),
        monthlyReportService.list(next.projectId),
        weeklyReportService.list(),
      ]);

      const inMonth = allWeeklies
        .filter((weekly) => weekly.projectId === next.projectId && weekly.periodStart.slice(0, 7) === month)
        .sort((a, b) => a.weekNumber - b.weekNumber);

      const submissionRows = (
        await Promise.all(
          inMonth.map(async (weekly) =>
            (await weeklyReportService.listSubmissions(weekly.id)).map((submission) => ({
              weekNumber: weekly.weekNumber,
              submission,
            }))
          )
        )
      ).flat();

      setProject(nextProject);
      setComments(nextComments);
      setPlans(nextPlans);
      setSummaries(nextSummaries);
      setWeeklies(inMonth);
      setSubmissions(submissionRows);
      setSiblings(projectReports.filter((item) => item.id !== next.id).sort((a, b) => b.reportingMonth.localeCompare(a.reportingMonth)));
      // Set last: `report` is what flips the bundle out of its loading state, so
      // publishing it only once its companions are in hand keeps the header from
      // flashing "Not recorded" for the project on every load.
      setReport(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the Monthly Report.");
      setReport(null);
    }
  }, [reportId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const bundle = React.useMemo<MonthlyReportBundle | null | undefined>(() => {
    if (report === undefined) return undefined;
    if (report === null) return null;
    return {
      report,
      project,
      client: (clients as Client[]).find((record) => record.id === project?.clientId),
      comments,
      weeklies,
      submissions,
      summaries,
      plans,
      departments: departments as NamedRecord[],
      systems: systems as NamedRecord[],
      disciplines: disciplines as NamedRecord[],
      contacts: contacts as Contact[],
      terms,
    };
  }, [report, project, clients, comments, weeklies, submissions, summaries, plans, departments, systems, disciplines, contacts, terms]);

  return { bundle, siblings, reload };
}
