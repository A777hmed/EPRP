"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react";

import { weeklyReportService } from "@/services/weekly-report-service";
import { monthlyReportService } from "@/services/monthly-report-service";
import {
  normalizeMonthlyComments,
  normalizeWeeklyEntries,
  type NormalizedManagementItem,
} from "./components/management-items";
import type {
  DashboardMonthlyReportSummary,
  DashboardWeeklyReportSummary,
} from "@/services/dashboard-read-model";

/**
 * The Project Workspace Management tab's source (Dashboard Data Depth,
 * item 3). Weekly is the operational entry tier that actually captures
 * risk/issue/decision/action narrative, so the project's LATEST Weekly
 * report is read first; a project with no attention-worthy Weekly entry
 * (no Weekly at all, or one filed with only plain comments) falls back to
 * its LATEST Monthly report's comments — the same Weekly-first-then-
 * Monthly precedence `positionsFor` already applies to figures, applied
 * here to narrative instead. Planning has no narrative of its own to read,
 * so a Planning-backed position's Management tab reads this same fallback
 * chain regardless of `basis`.
 */
export type ManagementSource =
  | { status: "loading" }
  | { status: "none" }
  | {
      status: "ready";
      sourceLabel: string;
      sourcePeriod: string;
      sourceHref: string;
      items: NormalizedManagementItem[];
    };

export function useManagementItems(
  projectWeeklies: DashboardWeeklyReportSummary[],
  projectMonthlies: DashboardMonthlyReportSummary[]
): ManagementSource {
  const latestWeekly = React.useMemo(
    () => [...projectWeeklies].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0],
    [projectWeeklies]
  );
  const latestMonthly = React.useMemo(
    () => [...projectMonthlies].sort((a, b) => (b.reportingMonth ?? "").localeCompare(a.reportingMonth ?? ""))[0],
    [projectMonthlies]
  );

  const [source, setSource] = React.useState<ManagementSource>({ status: "loading" });

  React.useEffect(() => {
    if (!latestWeekly && !latestMonthly) {
      setSource({ status: "none" });
      return;
    }
    let cancelled = false;
    setSource({ status: "loading" });

    Promise.all([
      latestWeekly ? weeklyReportService.listEntries(latestWeekly.id).catch(() => []) : Promise.resolve([]),
      latestMonthly ? monthlyReportService.listComments(latestMonthly.id).catch(() => []) : Promise.resolve([]),
    ]).then(([entries, comments]) => {
      if (cancelled) return;

      const weeklyItems = latestWeekly ? normalizeWeeklyEntries(entries) : [];
      if (latestWeekly && weeklyItems.length > 0) {
        setSource({
          status: "ready",
          sourceLabel: `Weekly Report ${latestWeekly.reportNumber}`,
          sourcePeriod: `Period ending ${latestWeekly.periodEnd}`,
          sourceHref: `/weekly-reports/${latestWeekly.id}`,
          items: weeklyItems,
        });
        return;
      }

      const monthlyItems = latestMonthly ? normalizeMonthlyComments(comments) : [];
      if (latestMonthly && monthlyItems.length > 0) {
        setSource({
          status: "ready",
          sourceLabel: `Monthly Report ${latestMonthly.reportNumber}`,
          sourcePeriod: latestMonthly.reportingMonth,
          sourceHref: `/monthly-reports/${latestMonthly.id}`,
          items: monthlyItems,
        });
        return;
      }

      setSource({ status: "none" });
    });

    return () => {
      cancelled = true;
    };
  }, [latestWeekly, latestMonthly]);

  return source;
}
