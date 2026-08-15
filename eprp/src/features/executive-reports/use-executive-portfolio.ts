"use client";
/* Portfolio data loads from the browser services after mount, under the
   signed-in user's own session, so every read is RLS-filtered. */
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { useMasterData } from "@/features/master-data";
import { monthlyReportService } from "@/services/monthly-report-service";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type {
  Client,
  Contact,
  MonthlyComment,
  MonthlyPlanItem,
  MonthlyReport,
  Project,
  WeeklyEntry,
  WeeklyPlanItem,
  WeeklyReport,
} from "@/types";
import {
  NOT_RECORDED,
  availableMonths as monthsWithData,
  buildAttention,
  buildMilestones,
  changesSinceMonthly,
  dedupeMilestones,
  isOverdueMilestone,
  monthlyStatusLabel,
  nameOf,
  nextDueMilestone,
  openActionSummary,
  openItems,
  readHealth,
  selectOfficialMonthly,
  bySeverity,
  type MilestoneRow,
  type NamedRecord,
  type ProjectExecutiveRow,
} from "./executive-data";
import { visibleProjects, type ExecutiveScopeInput } from "./executive-scope";
import { executiveNoteService, type ExecutiveNote, type NotesAvailability } from "./executive-notes";
import { executiveRecordService, type ExecutiveReportRecord } from "./executive-record";

/**
 * How many post-baseline Weekly reports are inspected per project for movement.
 *
 * Bounded deliberately: the freshness layer answers "what has moved since the
 * Monthly", which the most recent weeks answer. Reading every Weekly ever filed
 * would issue an unbounded number of requests to say the same thing.
 */
const MOVEMENT_WEEK_LIMIT = 3;

export interface ExecutivePortfolioState {
  loading: boolean;
  /** Every project row the viewer may see, before on-screen filters. */
  rows: ProjectExecutiveRow[];
  milestones: MilestoneRow[];
  allMonthlies: MonthlyReport[];
  visibleProjectIds: Set<string>;
  projects: Project[];
  clients: Client[];
  contacts: Contact[];
  availableMonths: string[];
  month: string;
  setMonth: (month: string) => void;
  /** Total projects returned by the service, before the access filter. */
  totalProjects: number;
  lastUpdated?: string;
  /** How many post-baseline weeks were inspected, for the coverage note. */
  movementWeekLimit: number;
  /** Executive-authored notes across the visible portfolio. */
  notes: ExecutiveNote[];
  notesAvailability: NotesAvailability;
  reloadNotes: () => Promise<void>;
  /** The stored Executive record for this period, when one has been saved. */
  record: ExecutiveReportRecord | null;
  /** Adopt a freshly saved record without refetching the whole portfolio. */
  applyRecord: (record: ExecutiveReportRecord) => void;
}

/**
 * Load the live Executive portfolio for one reporting month.
 *
 * The loading strategy is deliberately narrow. `projects`, `monthly_reports` and
 * `weekly_reports` are three list calls; everything after that is fetched only
 * for what is actually shown:
 *
 * - Monthly comments and plan items — only for the ONE selected Monthly per
 *   project, not for every Monthly the project has ever filed.
 * - Weekly entries and plan items — only for weeks falling AFTER the baseline
 *   month, capped per project.
 *
 * Nothing is written. The Executive tier reads approved output and composes it
 * (`03_REPORTING_ARCHITECTURE.md` §6); it owns no data of its own in this
 * increment.
 */
export function useExecutivePortfolio(
  scope: ExecutiveScopeInput,
  /** Period chosen in the register. Wins over the calendar-month default. */
  requestedMonth?: string
): ExecutivePortfolioState {
  const { records: clientRecords } = useMasterData("client");
  const { records: contactRecords } = useMasterData("contact");

  const [loading, setLoading] = React.useState(true);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [totalProjects, setTotalProjects] = React.useState(0);
  const [allMonthlies, setAllMonthlies] = React.useState<MonthlyReport[]>([]);
  const [allWeeklies, setAllWeeklies] = React.useState<WeeklyReport[]>([]);
  const [month, setMonth] = React.useState<string>(() => requestedMonth ?? format(new Date(), "yyyy-MM"));
  // An explicit period from the register is a choice, not a default, so the
  // fallback below must not override it.
  const [monthTouched, setMonthTouched] = React.useState(Boolean(requestedMonth));

  const [comments, setComments] = React.useState<Map<string, MonthlyComment[]>>(new Map());
  const [monthlyPlans, setMonthlyPlans] = React.useState<Map<string, MonthlyPlanItem[]>>(new Map());
  const [weeklyEntries, setWeeklyEntries] = React.useState<Map<string, WeeklyEntry[]>>(new Map());
  const [weeklyPlans, setWeeklyPlans] = React.useState<Map<string, WeeklyPlanItem[]>>(new Map());

  const contacts = contactRecords as Contact[];
  const clients = clientRecords as Client[];

  /* ------------------------------ Base load ------------------------------- */

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [nextProjects, nextMonthlies, nextWeeklies] = await Promise.all([
          projectService.getProjects(),
          monthlyReportService.list(),
          weeklyReportService.list(),
        ]);
        if (cancelled) return;

        setTotalProjects(nextProjects.length);
        setProjects(visibleProjects(nextProjects, scope));
        setAllMonthlies(nextMonthlies);
        setAllWeeklies(nextWeeklies);
      } catch (error) {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "Could not load the Executive portfolio.");
        setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const visibleProjectIds = React.useMemo(() => new Set(projects.map((project) => project.id)), [projects]);

  /*
   * Executive Notes load alongside the portfolio and never block it: a missing
   * table resolves to `migration_pending`, which the panel renders as a state
   * rather than an error, so the report is unaffected either way.
   */
  const [notes, setNotes] = React.useState<ExecutiveNote[]>([]);
  const [notesAvailability, setNotesAvailability] = React.useState<NotesAvailability>("ready");
  const projectIdKey = React.useMemo(() => [...visibleProjectIds].sort().join(","), [visibleProjectIds]);

  const reloadNotes = React.useCallback(async () => {
    const ids = projectIdKey ? projectIdKey.split(",") : [];
    const result = await executiveNoteService.list(ids);
    setNotes(result.notes);
    setNotesAvailability(result.availability);
  }, [projectIdKey]);

  React.useEffect(() => {
    void reloadNotes();
  }, [reloadNotes]);

  /*
   * The stored Executive record for this period, if one has been saved.
   *
   * Only Executive-OWNED content comes from here — the reviewed summary
   * wording. Every figure is still derived from Monthly on load, so editing the
   * Executive record can never change a reported number.
   */
  const [record, setRecord] = React.useState<ExecutiveReportRecord | null>(null);

  React.useEffect(() => {
    if (!month) return;
    let cancelled = false;
    executiveRecordService
      .getByMonth(month)
      .then((next) => {
        if (!cancelled) setRecord(next);
      })
      .catch(() => {
        if (!cancelled) setRecord(null);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  /** Applied after an in-report save, so the document shows what was stored. */
  const applyRecord = React.useCallback((next: ExecutiveReportRecord) => {
    setRecord(next);
  }, []);

  const monthliesInScope = React.useMemo(
    () => allMonthlies.filter((report) => visibleProjectIds.has(report.projectId)),
    [allMonthlies, visibleProjectIds]
  );

  const availableMonths = React.useMemo(() => monthsWithData(monthliesInScope), [monthliesInScope]);

  /*
   * Open on the current calendar month when it holds a Monthly Report, and
   * otherwise fall back to the newest month that does.
   *
   * Landing on an empty current month would read as "nothing is happening"
   * rather than "this month has not been reported yet", so the fallback matters
   * — but when the current month HAS been reported it is the month leadership
   * means, and jumping to some later month would be surprising.
   */
  React.useEffect(() => {
    if (monthTouched || availableMonths.length === 0) return;
    if (!availableMonths.includes(month)) setMonth(availableMonths[0]);
  }, [availableMonths, month, monthTouched]);

  const chooseMonth = React.useCallback((next: string) => {
    setMonthTouched(true);
    setMonth(next);
  }, []);

  /* ----------------------- Per-project detail load ------------------------ */

  /** The one Monthly each visible project speaks from, for the selected month. */
  const selections = React.useMemo(
    () =>
      projects.map((project) => ({
        project,
        selection: selectOfficialMonthly(
          monthliesInScope.filter((report) => report.projectId === project.id),
          month
        ),
      })),
    [projects, monthliesInScope, month]
  );

  /** Weeks after the baseline month — the only ones that can carry movement. */
  const laterWeeklies = React.useMemo(() => {
    const byProject = new Map<string, WeeklyReport[]>();
    for (const project of projects) {
      const weeks = allWeeklies
        .filter((weekly) => weekly.projectId === project.id && weekly.periodStart.slice(0, 7) > month)
        .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
        .slice(0, MOVEMENT_WEEK_LIMIT);
      if (weeks.length) byProject.set(project.id, weeks);
    }
    return byProject;
  }, [projects, allWeeklies, month]);

  const selectedReportIds = React.useMemo(
    () =>
      selections
        .map(({ selection }) => selection.report?.id)
        .filter((id): id is string => Boolean(id))
        .sort()
        .join(","),
    [selections]
  );

  const laterWeeklyIds = React.useMemo(
    () =>
      [...laterWeeklies.values()]
        .flat()
        .map((weekly) => weekly.id)
        .sort()
        .join(","),
    [laterWeeklies]
  );

  React.useEffect(() => {
    let cancelled = false;
    const monthlyIds = selectedReportIds ? selectedReportIds.split(",") : [];
    const weeklyIds = laterWeeklyIds ? laterWeeklyIds.split(",") : [];

    const load = async () => {
      try {
        const [commentPairs, planPairs, entryPairs, weeklyPlanPairs] = await Promise.all([
          Promise.all(
            monthlyIds.map(async (id) => [id, await monthlyReportService.listComments(id)] as const)
          ),
          Promise.all(
            monthlyIds.map(async (id) => [id, await monthlyReportService.listPlanItems(id)] as const)
          ),
          Promise.all(
            weeklyIds.map(async (id) => [id, await weeklyReportService.listEntries(id)] as const)
          ),
          Promise.all(
            weeklyIds.map(async (id) => [id, await weeklyReportService.listPlanItems(id)] as const)
          ),
        ]);
        if (cancelled) return;

        setComments(new Map(commentPairs));
        setMonthlyPlans(new Map(planPairs));
        setWeeklyEntries(new Map(entryPairs));
        setWeeklyPlans(new Map(weeklyPlanPairs));
      } catch (error) {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "Could not load Executive report detail.");
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedReportIds, laterWeeklyIds]);

  /* -------------------------------- Compose -------------------------------- */

  const today = React.useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const rows = React.useMemo<ProjectExecutiveRow[]>(() => {
    return selections.map(({ project, selection }) => {
      const projectName = project.name || project.code;
      const monthly = selection.report;
      const projectComments = monthly ? comments.get(monthly.id) ?? [] : [];

      const attention = buildAttention({
        comments: projectComments,
        project,
        projectName,
        contacts: contacts as NamedRecord[],
        today,
      });

      const risks = openItems(attention, "risk").sort(bySeverity);
      const decisions = openItems(attention, "decision").sort(bySeverity);
      const clientActions = openItems(attention, "client_action").sort(bySeverity);
      const achievements = attention.filter((item) => item.kind === "achievement");
      const overdue = attention.filter((item) => item.overdue).sort(bySeverity);

      const milestones = dedupeMilestones(
        buildMilestones({
          monthlyPlans: monthly
            ? [{ projectId: project.id, projectName, items: monthlyPlans.get(monthly.id) ?? [] }]
            : [],
          weeklyPlans: (laterWeeklies.get(project.id) ?? []).map((weekly) => ({
            projectId: project.id,
            projectName,
            items: weeklyPlans.get(weekly.id) ?? [],
          })),
          contacts: contacts as NamedRecord[],
        })
      );

      const openActions = openActionSummary({
        comments: projectComments,
        laterWeeklies: laterWeeklies.get(project.id) ?? [],
        entriesByWeekly: weeklyEntries,
        today,
      });

      const nextMilestone = nextDueMilestone(milestones, today);

      const movement = changesSinceMonthly({
        monthly,
        monthlyComments: projectComments,
        laterWeeklies: laterWeeklies.get(project.id) ?? [],
        entriesByWeekly: weeklyEntries,
        plansByWeekly: weeklyPlans,
      });

      const reading = readHealth(monthly);

      /*
       * Key Concern is drawn from RISKS AND ISSUES ONLY.
       *
       * It used to pool risks, decisions and client dependencies, so a single
       * source item surfaced as both "Main Concern" and "Decision Required" on
       * the same snapshot — the same sentence twice, which reads as a defect to
       * a Chairman. Each Executive field now maps to exactly one source
       * classification and the sets are disjoint:
       *
       *   Main Concern ....... risk_issue
       *   Decision Required .. decision_management_support / escalated
       *   Client Dependency .. action
       *
       * A project with a decision but no risk correctly reports no key concern
       * rather than borrowing the decision to fill the field.
       */
      const keyConcern = [...risks].sort(bySeverity)[0];

      return {
        project,
        projectName,
        clientName: nameOf(project.clientId, clients as NamedRecord[], NOT_RECORDED),
        managerName: project.projectManagerId
          ? nameOf(project.projectManagerId, contacts as NamedRecord[], NOT_RECORDED)
          : undefined,
        basis: selection.basis,
        monthly,
        monthlyStatusLabel: monthly ? monthlyStatusLabel(monthly) : undefined,
        planned: monthly?.plannedProgress,
        actual: monthly?.actualProgress,
        variance: monthly?.scheduleVariance,
        reading,
        attention,
        risks,
        decisions,
        clientActions,
        achievements,
        overdue,
        openActions,
        keyConcern,
        nextMilestone,
        nextMilestoneOverdue: isOverdueMilestone(nextMilestone, today),
        milestones,
        movement,
      };
    });
  }, [selections, comments, monthlyPlans, weeklyEntries, weeklyPlans, laterWeeklies, contacts, clients, today]);

  const milestones = React.useMemo(() => rows.flatMap((row) => row.milestones), [rows]);

  const lastUpdated = React.useMemo(() => {
    const stamps = rows.map((row) => row.monthly?.updatedAt).filter((value): value is string => Boolean(value));
    return stamps.sort((a, b) => b.localeCompare(a))[0];
  }, [rows]);

  return {
    loading,
    rows,
    milestones,
    allMonthlies: monthliesInScope,
    visibleProjectIds,
    projects,
    clients,
    contacts,
    availableMonths,
    month,
    setMonth: chooseMonth,
    totalProjects,
    lastUpdated,
    movementWeekLimit: MOVEMENT_WEEK_LIMIT,
    notes,
    notesAvailability,
    reloadNotes,
    record,
    applyRecord,
  };
}
