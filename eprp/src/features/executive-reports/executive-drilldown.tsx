"use client";
/* One project's executive detail and its Executive Notes load from the browser
   services after mount, under the signed-in user's own session. */
/* eslint-disable react-hooks/set-state-in-effect */

/**
 * Project executive drill-down — `/executive-reports/projects/[projectId]`.
 *
 * READ ONLY, without exception. Every tab reads Weekly and Monthly data and
 * links back to the native workspace for anyone authorized to change it. The
 * Executive tier never edits the tiers beneath it (`03` §4.6, §5.4): a
 * correction to a Weekly figure is made in the Weekly, not here.
 *
 * There is no Documents tab. No attachment table exists in any migration, so a
 * Documents tab could only ever render an empty list — which would read as
 * "this project has no documents" rather than "the platform cannot store them".
 */

import * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowLeft, FileWarning, Inbox } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import type { StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { ENTRY_STATUS_META, MILESTONE_STATUS_META, PRIORITY_META, REPORT_STATUS_META } from "@/lib/constants";
import { formatReportingPeriod, getMonthLabel, scheduleVariance } from "@/lib/reporting";
import { useMasterData } from "@/features/master-data";
import { milestoneStates as deriveMilestoneStates, type MilestoneState } from "@/features/projects/milestone-state";
import {
  ProjectReportingShell,
  ReportContextHeader,
  ReportTypeTabs,
} from "@/features/projects/components/sections/project-reporting-shell";
import { monthlyReportService } from "@/services/monthly-report-service";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import { milestoneService } from "@/services/milestone-service";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type {
  Client,
  Contact,
  MonthlyComment,
  MonthlyPlanItem,
  MonthlyReport,
  Priority,
  Project,
  WeeklyEntry,
  WeeklyPlanItem,
  WeeklyReport,
} from "@/types";
import {
  MONTHLY_BASIS_META,
  NOT_RECORDED,
  NO_MOVEMENT,
  availableMonths,
  buildAttention,
  buildMilestones,
  bySeverity,
  changesSinceMonthly,
  monthLabelOf,
  monthlyStatusLabel,
  nameOf,
  openItems,
  readHealth,
  selectOfficialMonthly,
  type MilestoneRow,
  type MonthlySelection,
  type MovementItem,
  type NamedRecord,
} from "./executive-data";
import { canAccessProject, type ExecutiveScopeInput } from "./executive-scope";
import { ExecutiveNotesPanel } from "./executive-notes-panel";
import { executiveNoteService, type ExecutiveNote, type NotesAvailability } from "./executive-notes";
import {
  ExecutiveDenied,
  canPrepareProjectExecutive,
  type ExecutiveViewerProps,
} from "./executive-view";

const MOVEMENT_WEEK_LIMIT = 3;

type TabId = "overview" | "weekly" | "monthly" | "risks" | "actions" | "milestones";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "weekly", label: "Weekly Updates" },
  { id: "monthly", label: "Monthly Reports" },
  { id: "risks", label: "Risks & Issues" },
  { id: "actions", label: "Actions" },
  { id: "milestones", label: "Milestones" },
];

/* --------------------------------- Loading --------------------------------- */

interface ProjectDetail {
  project: Project | null;
  denied: boolean;
  monthlies: MonthlyReport[];
  weeklies: WeeklyReport[];
  selection: MonthlySelection;
  comments: MonthlyComment[];
  monthlyPlans: MonthlyPlanItem[];
  laterWeeklies: WeeklyReport[];
  entriesByWeekly: Map<string, WeeklyEntry[]>;
  plansByWeekly: Map<string, WeeklyPlanItem[]>;
  month: string;
  /** Governed Master Milestone current state, read-only — see `milestone-state.ts`. */
  milestoneStates: MilestoneState[];
}

function useProjectDetail(projectId: string, scope: ExecutiveScopeInput, requestedMonth?: string) {
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<ProjectDetail | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const milestoneRegisterPromise = isSupabaseConfigured()
          ? milestoneService.listRegister([projectId])
          : Promise.resolve({ milestones: [], updates: [] });
        const [project, monthlies, allWeeklies, milestoneRegister] = await Promise.all([
          projectService.getProjectById(projectId),
          monthlyReportService.list(projectId),
          weeklyReportService.list(),
          milestoneRegisterPromise,
        ]);
        if (cancelled) return;

        const milestoneStates = deriveMilestoneStates(milestoneRegister.milestones, milestoneRegister.updates);

        if (!project) {
          setDetail(null);
          return;
        }

        // The same access predicate the portfolio applies. A project outside
        // the viewer's reach is refused here too, rather than being reachable
        // by typing its id into the address bar.
        if (!canAccessProject(project, scope)) {
          setDetail({
            project,
            denied: true,
            monthlies: [],
            weeklies: [],
            selection: { basis: "none" },
            comments: [],
            monthlyPlans: [],
            laterWeeklies: [],
            entriesByWeekly: new Map(),
            plansByWeekly: new Map(),
            month: "",
            milestoneStates: [],
          });
          return;
        }

        /*
         * Archived Weekly reports stay visible in their own register (Weekly
         * Reports still shows them), but the Executive tier reads them as
         * withdrawn from active use — the same treatment `MONTHLY_BASIS_META`
         * already gives an archived Monthly. An archived Weekly must not count
         * as freshness or "since Monthly baseline" movement.
         */
        const weeklies = allWeeklies
          .filter((weekly) => weekly.projectId === projectId && weekly.status !== "archived")
          .sort((a, b) => b.periodStart.localeCompare(a.periodStart));

        /*
         * Honour the period the reader came from, so clicking through from an
         * August portfolio does not silently open a September baseline. An
         * unknown or absent month falls back to the project's newest.
         */
        const months = availableMonths(monthlies);
        const month = (requestedMonth && months.includes(requestedMonth) ? requestedMonth : months[0]) ?? "";
        const selection = selectOfficialMonthly(monthlies, month);

        const laterWeeklies = month
          ? weeklies.filter((weekly) => weekly.periodStart.slice(0, 7) > month).slice(0, MOVEMENT_WEEK_LIMIT)
          : [];

        const [comments, monthlyPlans, entryPairs, planPairs] = await Promise.all([
          selection.report ? monthlyReportService.listComments(selection.report.id) : Promise.resolve([]),
          selection.report ? monthlyReportService.listPlanItems(selection.report.id) : Promise.resolve([]),
          Promise.all(laterWeeklies.map(async (w) => [w.id, await weeklyReportService.listEntries(w.id)] as const)),
          Promise.all(laterWeeklies.map(async (w) => [w.id, await weeklyReportService.listPlanItems(w.id)] as const)),
        ]);
        if (cancelled) return;

        setDetail({
          project,
          denied: false,
          monthlies,
          weeklies,
          selection,
          comments,
          monthlyPlans,
          laterWeeklies,
          entriesByWeekly: new Map(entryPairs),
          plansByWeekly: new Map(planPairs),
          month,
          milestoneStates,
        });
      } catch (error) {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "Could not load the project.");
        setDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, scope, requestedMonth]);

  return { loading, detail };
}

/* -------------------------------- Fragments -------------------------------- */

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="exec-figure">
      <span>{label}</span>
      <b className={className}>{value}</b>
    </div>
  );
}

function MovementList({ movement }: { movement: MovementItem[] }) {
  if (movement.length === 0) return <span className="muted">{NO_MOVEMENT}</span>;
  return (
    <div className="exec-movement-list">
      {movement.map((item) => (
        <span className="exec-movement" key={item.id}>
          <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
          <small>
            {item.weekNumber ? `W${item.weekNumber} · ` : ""}
            {item.text}
          </small>
        </span>
      ))}
    </div>
  );
}

/**
 * One drill-down row, from either tier.
 *
 * `displayId` is a POSITIONAL label (R-01, A-01), not a stored identifier — the
 * platform assigns no human-readable id to a risk or an action. It exists so a
 * reader can refer to a line in a meeting; it is not a key and does not survive
 * a re-sort. The column header says so.
 */
interface DrillRow {
  key: string;
  displayId: string;
  text: string;
  sourceLabel: string;
  sourceTone: StatusTone;
  priority: Priority;
  responsible?: string;
  dueDate?: string;
  statusLabel: string;
  escalated: boolean;
  newSinceMonthly: boolean;
  overdue: boolean;
  actionType?: "Client" | "Internal";
}

function EmptyTabState({ text }: { text: string }) {
  return (
    <div className="exec-empty-inline">
      <Inbox aria-hidden />
      <span>{text}</span>
    </div>
  );
}

function DueCell({ row }: { row: DrillRow }) {
  if (!row.dueDate) return <span className="muted">—</span>;
  return (
    <span className={row.overdue ? "exec-overdue" : undefined}>
      {format(parseISO(row.dueDate), "dd MMM yyyy")}
      {row.overdue && <small className="exec-overdue">Overdue</small>}
    </span>
  );
}

/** Risks & Issues — severity-led, with escalation and newness called out. */
function RiskTable({ rows, empty }: { rows: DrillRow[]; empty: string }) {
  if (rows.length === 0) return <EmptyTabState text={empty} />;
  return (
    <div className="monthly-table-wrap">
      <table className="monthly-table exec-risk-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Risk / Issue</th>
            <th>Source</th>
            <th>Severity</th>
            <th>Responsible</th>
            <th>Target Date</th>
            <th>Status</th>
            <th>Escalated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.priority === "critical" || row.priority === "high" ? "exec-row-severe" : undefined}>
              <td>
                <b>{row.displayId}</b>
                {row.newSinceMonthly && <span className="exec-flag exec-flag-new">New</span>}
              </td>
              <td>{row.text}</td>
              <td>
                <StatusBadge tone={row.sourceTone}>{row.sourceLabel}</StatusBadge>
              </td>
              <td>
                <StatusBadge tone={PRIORITY_META[row.priority].tone}>{PRIORITY_META[row.priority].label}</StatusBadge>
              </td>
              <td>{row.responsible ?? <span className="muted">—</span>}</td>
              <td>
                <DueCell row={row} />
              </td>
              <td>{row.statusLabel}</td>
              <td>
                {row.escalated ? <span className="exec-flag exec-flag-escalated">Escalated</span> : <span className="muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Actions — commitment-led: who owes what, to whom, by when. */
function ActionTable({ rows, empty }: { rows: DrillRow[]; empty: string }) {
  if (rows.length === 0) return <EmptyTabState text={empty} />;
  return (
    <div className="monthly-table-wrap">
      <table className="monthly-table exec-action-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Action Required</th>
            <th>Source</th>
            <th>Type</th>
            <th>Responsible</th>
            <th>Due Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.overdue ? "exec-row-overdue" : undefined}>
              <td>
                <b>{row.displayId}</b>
                {row.newSinceMonthly && <span className="exec-flag exec-flag-new">New</span>}
              </td>
              <td>{row.text}</td>
              <td>
                <StatusBadge tone={row.sourceTone}>{row.sourceLabel}</StatusBadge>
              </td>
              <td>
                {row.actionType ? (
                  <span className={`exec-flag ${row.actionType === "Client" ? "exec-flag-client" : "exec-flag-internal"}`}>
                    {row.actionType}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>{row.responsible ?? <span className="muted">—</span>}</td>
              <td>
                <DueCell row={row} />
              </td>
              <td>{row.statusLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A compact milestone timeline.
 *
 * Static SVG with literal dimensions, for the same reason the Monthly print
 * charts are: it must survive a print re-layout without collapsing. Dated
 * milestones only — an undated item has no position on a time axis and is
 * listed in the table beneath instead.
 */
function MilestoneTimeline({ rows, today }: { rows: MilestoneRow[]; today: string }) {
  const dated = rows.filter((row) => row.date);
  if (dated.length < 2) return null;

  const W = 900;
  const H = 82;
  const PAD = 34;
  const times = dated.map((row) => parseISO(row.date as string).getTime());
  const todayTime = parseISO(today).getTime();
  const min = Math.min(...times, todayTime);
  const max = Math.max(...times, todayTime);
  const span = Math.max(max - min, 1);
  const x = (time: number) => PAD + ((time - min) / span) * (W - PAD * 2);

  return (
    <div className="exec-timeline">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Plan item timeline" style={{ width: "100%", height: H }}>
        <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#c9d6e4" strokeWidth={1.5} />
        {/* Today marker, so "upcoming" and "overdue" are visible, not inferred. */}
        <line x1={x(todayTime)} y1={16} x2={x(todayTime)} y2={H - 16} stroke="#0d59a8" strokeWidth={1.5} strokeDasharray="3 2" />
        <text x={x(todayTime)} y={12} fill="#0d59a8" fontSize={9} textAnchor="middle" fontWeight={700}>
          Today
        </text>
        {dated.map((row, index) => {
          const time = parseISO(row.date as string).getTime();
          const overdue = row.date! < today && row.statusLabel !== "Completed";
          const color = row.statusLabel === "Completed" ? "#2e9c43" : overdue ? "#c0444c" : "#d1841f";
          // Alternate above/below so close dates do not overprint each other.
          const above = index % 2 === 0;
          return (
            <g key={row.id}>
              <circle cx={x(time)} cy={H / 2} r={4.5} fill={color} />
              <text
                x={x(time)}
                y={above ? H / 2 - 10 : H / 2 + 18}
                fill="#5b718c"
                fontSize={8.5}
                textAnchor="middle"
              >
                {format(parseISO(row.date as string), "dd MMM")}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Governed Master Milestones, read-only.
 *
 * Consumes the current state already derived by `milestone-state.ts` — the
 * same frozen logic Weekly and Monthly read. This tab adds no observation,
 * submission, or reconciliation path; it only shows the governed register's
 * official position for this project.
 */
function MasterMilestoneProgress({ states }: { states: MilestoneState[] }) {
  return (
    <>
      <div className="exec-tab-lead">
        <h2 className="exec-tab-heading">Master Milestone Progress</h2>
        <span>Governed position, as approved by Project Control.</span>
      </div>
      {states.length ? (
        <div className="monthly-table-wrap">
          <table className="monthly-table exec-milestone-detail-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Milestone</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Forecast Date</th>
                <th>Actual Date</th>
              </tr>
            </thead>
            <tbody>
              {states.map((state) => {
                const statusMeta = MILESTONE_STATUS_META[state.status];
                return (
                  <tr key={state.milestone.id}>
                    <td>
                      <b>{state.milestone.code}</b>
                    </td>
                    <td>{state.milestone.name}</td>
                    <td>
                      {state.inConflict ? (
                        <StatusBadge tone="danger">Unresolved</StatusBadge>
                      ) : (
                        <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                      )}
                    </td>
                    <td>
                      {state.inConflict ? (
                        <span className="muted">Reconciliation required</span>
                      ) : typeof state.progressPercent === "number" ? (
                        `${state.progressPercent.toFixed(1)}%`
                      ) : (
                        <span className="muted">{NOT_RECORDED}</span>
                      )}
                    </td>
                    <td>{state.forecastDate ? format(parseISO(state.forecastDate), "dd MMM yyyy") : <span className="muted">—</span>}</td>
                    <td>{state.actualDate ? format(parseISO(state.actualDate), "dd MMM yyyy") : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyTabState text="No active Master Milestones are recorded for this project." />
      )}
    </>
  );
}

/* ---------------------------------- View ----------------------------------- */

export function ExecutiveProjectDrilldown({
  projectId,
  viewer,
  requestedMonth,
  requestedTab,
}: {
  projectId: string;
  viewer: ExecutiveViewerProps;
  /** Reporting period the reader came from, via `?month=`. */
  requestedMonth?: string;
  /** Opening tab, from `?tab=` — lets the portfolio deep-link into Actions. */
  requestedTab?: string;
}) {
  const scope = React.useMemo<ExecutiveScopeInput>(
    () => ({ contactId: viewer.contactId, isAdmin: viewer.isAdmin }),
    [viewer.contactId, viewer.isAdmin]
  );
  const { loading, detail } = useProjectDetail(projectId, scope, requestedMonth);
  /* Preparation authority is PROJECT-SCOPED. It was `viewer.allowed`, which is
     view authority — now that Viewers may read the module, gating a write on it
     would hand them the Notes editor. */
  const canPrepareNotes = canPrepareProjectExecutive(detail?.project, viewer.contactId, {
    isGlobalAuthority: viewer.isAdmin,
  });
  const [tab, setTab] = React.useState<TabId>(() =>
    TABS.some((entry) => entry.id === requestedTab) ? (requestedTab as TabId) : "overview"
  );
  const [notes, setNotes] = React.useState<ExecutiveNote[]>([]);
  const [notesAvailability, setNotesAvailability] = React.useState<NotesAvailability>("ready");

  const reloadNotes = React.useCallback(async () => {
    const result = await executiveNoteService.list([projectId]);
    setNotes(result.notes.filter((note) => note.projectId === projectId));
    setNotesAvailability(result.availability);
  }, [projectId]);

  React.useEffect(() => {
    void reloadNotes();
  }, [reloadNotes]);
  const { records: contactRecords } = useMasterData("contact");
  const { records: clientRecords } = useMasterData("client");

  const contacts = contactRecords as Contact[];
  const clients = clientRecords as Client[];

  const model = React.useMemo(() => {
    if (!detail?.project || detail.denied) return null;
    const projectName = detail.project.name || detail.project.code;
    const today = new Date().toISOString().slice(0, 10);

    const attention = buildAttention({
      comments: detail.comments,
      project: detail.project,
      projectName,
      contacts: contacts as NamedRecord[],
      today,
    });

    const movement = changesSinceMonthly({
      monthly: detail.selection.report,
      monthlyComments: detail.comments,
      laterWeeklies: detail.laterWeeklies,
      entriesByWeekly: detail.entriesByWeekly,
      plansByWeekly: detail.plansByWeekly,
      limit: 8,
    });

    const milestones: MilestoneRow[] = buildMilestones({
      monthlyPlans: [{ projectId, projectName, items: detail.monthlyPlans }],
      weeklyPlans: detail.laterWeeklies.map((weekly) => ({
        projectId,
        projectName,
        items: detail.plansByWeekly.get(weekly.id) ?? [],
      })),
      contacts: contacts as NamedRecord[],
    });

    // Newer Weekly items, deduped against what the Monthly already compiled —
    // the same `source_weekly_entry_id` set the movement layer uses.
    const compiled = new Set(
      detail.comments.map((comment) => comment.sourceWeeklyEntryId).filter((id): id is string => Boolean(id))
    );
    const newerEntries = detail.laterWeeklies.flatMap((weekly) =>
      (detail.entriesByWeekly.get(weekly.id) ?? [])
        .filter((entry) => !compiled.has(entry.id))
        .map((entry) => ({ weekly, entry }))
    );

    /*
     * Both drill-down tables are built from ONE row shape, filled from the two
     * tiers. The `newSinceMonthly` flag is what distinguishes them — it is not
     * a second data path, and nothing compiled into the Monthly appears twice.
     */
    const statusOf = (status: MonthlyComment["status"]) =>
      status === "pending" ? "Pending" : ENTRY_STATUS_META[status].label;

    const monthlyRow = (comment: MonthlyComment, prefix: string, index: number): DrillRow => ({
      key: comment.id,
      displayId: `${prefix}-${String(index + 1).padStart(2, "0")}`,
      text: comment.presentationText?.trim() || comment.originalText.trim(),
      sourceLabel: comment.weekNumber ? `Monthly (W${comment.weekNumber})` : "Monthly",
      sourceTone: "info",
      priority: comment.priority,
      responsible: comment.responsibleContactId
        ? nameOf(comment.responsibleContactId, contacts as NamedRecord[], NOT_RECORDED)
        : undefined,
      dueDate: comment.targetDate,
      statusLabel: statusOf(comment.status),
      escalated: comment.escalateToManagement,
      newSinceMonthly: false,
      overdue: Boolean(
        comment.targetDate && comment.targetDate < today && !["resolved", "closed"].includes(comment.status)
      ),
      // Monthly's own taxonomy: `action` IS the client action list (the Monthly
      // document titles it "Client Action Items"); management support is internal.
      actionType: comment.updateType === "action" ? "Client" : "Internal",
    });

    const weeklyRow = (
      { weekly, entry }: { weekly: WeeklyReport; entry: WeeklyEntry },
      prefix: string,
      index: number
    ): DrillRow => ({
      key: entry.id,
      displayId: `${prefix}-${String(index + 1).padStart(2, "0")}`,
      text: entry.description.trim(),
      sourceLabel: `Weekly (W${weekly.weekNumber})`,
      sourceTone: "warning",
      priority: entry.priority,
      responsible: entry.ownerContactId
        ? nameOf(entry.ownerContactId, contacts as NamedRecord[], NOT_RECORDED)
        : undefined,
      dueDate: entry.dueDate,
      statusLabel: ENTRY_STATUS_META[entry.status].label,
      escalated: entry.entryType === "decision",
      newSinceMonthly: true,
      overdue: Boolean(entry.dueDate && entry.dueDate < today && !["resolved", "closed"].includes(entry.status)),
      actionType: entry.entryType === "decision" ? "Internal" : "Internal",
    });

    const baselineRisks = detail.comments
      .filter((comment) => comment.includeInFinal && comment.updateType === "risk_issue")
      .map((comment, index) => monthlyRow(comment, "R", index));

    const newRisks = newerEntries
      .filter(({ entry }) => entry.entryType === "risk" || entry.entryType === "issue")
      .map((pair, index) => weeklyRow(pair, "RW", index));

    const baselineActions = detail.comments
      .filter(
        (comment) =>
          comment.includeInFinal &&
          (comment.updateType === "action" || comment.updateType === "decision_management_support")
      )
      .map((comment, index) => monthlyRow(comment, "A", index));

    const newActions = newerEntries
      .filter(({ entry }) => entry.entryType === "action" || entry.entryType === "decision")
      .map((pair, index) => weeklyRow(pair, "AW", index));

    return {
      project: detail.project,
      projectName,
      clientName: nameOf(detail.project.clientId, clients as NamedRecord[], NOT_RECORDED),
      reading: readHealth(detail.selection.report),
      attention,
      risks: openItems(attention, "risk").sort(bySeverity),
      decisions: openItems(attention, "decision").sort(bySeverity),
      clientActions: openItems(attention, "client_action").sort(bySeverity),
      achievements: attention.filter((item) => item.kind === "achievement"),
      movement,
      milestones,
      newerEntries,
      baselineRisks,
      newRisks,
      baselineActions,
      newActions,
      today,
    };
  }, [detail, contacts, clients, projectId]);

  if (!viewer.allowed) return <ExecutiveDenied reason={viewer.deniedReason} />;
  if (loading) return <LoadingState label="Loading project executive view…" />;
  if (!detail?.project) {
    return (
      <EmptyState
        title="Project not found"
        description="This project is unavailable or you do not have access to it."
        icon={FileWarning}
      />
    );
  }
  if (detail.denied || !model) {
    return (
      <ExecutiveDenied reason="You have no assignment on this project, so its executive detail is not available to you." />
    );
  }

  const basis = MONTHLY_BASIS_META[detail.selection.basis];
  const monthly = detail.selection.report;

  return (
    <ProjectReportingShell
      header={
        <ReportContextHeader
          projectCode={model.project.code}
          projectName={model.projectName}
          period={detail.month ? monthLabelOf(detail.month) : undefined}
          status={{ label: basis.label, tone: basis.tone }}
        />
      }
      tabs={<ReportTypeTabs projectId={projectId} active="executive" />}
    >
    <div className="exec-drilldown">
      <div className="exec-drilldown-head">
        <Link className="exec-back" href="/executive-reports">
          <ArrowLeft aria-hidden /> Portfolio
        </Link>
        <div>
          <p className="monthly-eyebrow">Project executive view · read only</p>
          <h1>{model.projectName}</h1>
          <span>
            {model.clientName} · {model.project.code}
            {detail.month ? ` · baseline ${monthLabelOf(detail.month)}` : ""}
          </span>
        </div>
        <div className="exec-drilldown-status">
          <StatusBadge tone={model.reading.tone}>{model.reading.label}</StatusBadge>
          <StatusBadge tone={basis.tone}>{basis.label}</StatusBadge>
        </div>
      </div>

      <nav className="exec-tabs" aria-label="Project executive sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === tab ? "active" : ""}
            aria-current={entry.id === tab ? "page" : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="exec-tab-panel">
        {tab === "overview" && (
          <>
            <div className="exec-figure-row">
              <Figure label="Planned" value={monthly ? `${monthly.plannedProgress.toFixed(1)}%` : NOT_RECORDED} className="planned-value" />
              <Figure label="Actual" value={monthly ? `${monthly.actualProgress.toFixed(1)}%` : NOT_RECORDED} className="actual-value" />
              <Figure
                label="Variance"
                value={monthly ? `${monthly.scheduleVariance > 0 ? "+" : ""}${monthly.scheduleVariance.toFixed(1)}%` : NOT_RECORDED}
                className="variance-value"
              />
              <Figure label="SPI" value={monthly ? monthly.spi.toFixed(2) : NOT_RECORDED} />
            </div>

            <p className="exec-tab-note">{model.reading.basis} {basis.note}</p>

            <h2 className="exec-tab-heading">Monthly baseline</h2>
            {monthly ? (
              <p className="exec-tab-note">
                {monthly.reportNumber} · {getMonthLabel(monthly.reportingMonth)} · {monthlyStatusLabel(monthly)} ·{" "}
                <Link className="monthly-link" href={`/monthly-reports/${monthly.id}`}>
                  Open Monthly Report →
                </Link>
              </p>
            ) : (
              <p className="exec-tab-note">No Monthly Report exists for this project.</p>
            )}
            {monthly?.executiveSummary && <div className="monthly-executive-summary">{monthly.executiveSummary}</div>}

            <h2 className="exec-tab-heading">Latest Weekly movement</h2>
            <MovementList movement={model.movement} />

            <h2 className="exec-tab-heading">Executive Notes</h2>
            <ExecutiveNotesPanel
              projectId={projectId}
              projectName={model.projectName}
              notes={notes}
              availability={notesAvailability}
              canManage={canPrepareNotes}
              onChanged={reloadNotes}
            />
          </>
        )}

        {tab === "weekly" && (
          <>
            <p className="exec-tab-note">
              Weekly reports for this project, newest first. Weekly is the operational source of truth and is read here,
              never written.
            </p>
            {detail.weeklies.length ? (
              <table className="monthly-table exec-tab-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Period</th>
                    <th>Planned</th>
                    <th>Actual</th>
                    <th>Variance</th>
                    <th>Status</th>
                    <th className="exec-actions-col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.weeklies.map((weekly) => {
                    const variance = scheduleVariance(weekly.plannedProgress, weekly.actualProgress);
                    return (
                      <tr key={weekly.id}>
                        <td>
                          <b>W{weekly.weekNumber}</b>
                        </td>
                        <td>{formatReportingPeriod(weekly.periodStart, weekly.periodEnd)}</td>
                        <td className="planned-value">{weekly.plannedProgress.toFixed(1)}%</td>
                        <td className="actual-value">{weekly.actualProgress.toFixed(1)}%</td>
                        <td className="variance-value">
                          {variance > 0 ? "+" : ""}
                          {variance.toFixed(1)}%
                        </td>
                        <td>
                          <StatusBadge tone={REPORT_STATUS_META[weekly.status].tone}>
                            {REPORT_STATUS_META[weekly.status].label}
                          </StatusBadge>
                        </td>
                        <td className="exec-actions-col">
                          <Link
                            className="monthly-link"
                            href={`/weekly-reports/${weekly.id}`}
                            prefetch={false}
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="exec-tab-note">No Weekly Reports exist for this project.</p>
            )}
          </>
        )}

        {tab === "monthly" && (
          <>
            <p className="exec-tab-note">Monthly history for this project. Open a report to see its full document.</p>
            {detail.monthlies.length ? (
              <table className="monthly-table exec-tab-table">
                <thead>
                  <tr>
                    <th>Report No.</th>
                    <th>Month</th>
                    <th>Planned</th>
                    <th>Actual</th>
                    <th>Variance</th>
                    <th>Status</th>
                    <th className="exec-actions-col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.monthlies.map((report) => (
                    <tr key={report.id}>
                      <td>
                        <b>{report.reportNumber}</b>
                      </td>
                      <td>{getMonthLabel(report.reportingMonth)}</td>
                      <td className="planned-value">{report.plannedProgress.toFixed(1)}%</td>
                      <td className="actual-value">{report.actualProgress.toFixed(1)}%</td>
                      <td className="variance-value">
                        {report.scheduleVariance > 0 ? "+" : ""}
                        {report.scheduleVariance.toFixed(1)}%
                      </td>
                      <td>
                        <StatusBadge tone={REPORT_STATUS_META[report.status].tone}>
                          {REPORT_STATUS_META[report.status].label}
                        </StatusBadge>
                      </td>
                      <td className="exec-actions-col">
                        <Link
                          className="monthly-link"
                          href={`/monthly-reports/${report.id}`}
                          prefetch={false}
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="exec-tab-note">No Monthly Reports exist for this project.</p>
            )}
          </>
        )}

        {tab === "risks" && (
          <>
            <div className="exec-tab-lead">
              <h2 className="exec-tab-heading">On the Monthly baseline</h2>
              <span>{model.baselineRisks.length} recorded</span>
            </div>
            <RiskTable rows={model.baselineRisks} empty="No risks or issues recorded." />

            <div className="exec-tab-lead">
              <h2 className="exec-tab-heading">Raised since the Monthly baseline</h2>
              <span>
                {model.newRisks.length} new · last {detail.laterWeeklies.length} Weekly report
                {detail.laterWeeklies.length === 1 ? "" : "s"}
              </span>
            </div>
            <RiskTable rows={model.newRisks} empty="No risks or issues recorded." />
          </>
        )}

        {tab === "actions" && (
          <>
            <div className="exec-tab-lead">
              <h2 className="exec-tab-heading">On the Monthly baseline</h2>
              <span>{model.baselineActions.length} recorded</span>
            </div>
            <ActionTable rows={model.baselineActions} empty="No actions recorded." />

            <div className="exec-tab-lead">
              <h2 className="exec-tab-heading">Raised since the Monthly baseline</h2>
              <span>
                {model.newActions.length} new · last {detail.laterWeeklies.length} Weekly report
                {detail.laterWeeklies.length === 1 ? "" : "s"}
              </span>
            </div>
            <ActionTable rows={model.newActions} empty="No actions recorded." />
          </>
        )}

        {tab === "milestones" && (
          <>
            <MasterMilestoneProgress states={detail.milestoneStates} />

            <div className="exec-tab-lead">
              <h2 className="exec-tab-heading">Monthly &amp; Weekly Plan Items</h2>
              <span>
                Free-text planning entries from Monthly and Weekly plan items — not part of the governed Master
                Milestone register above. Every row states the plan it came from.
              </span>
            </div>
            {model.milestones.length ? (
              <>
                <MilestoneTimeline rows={model.milestones} today={model.today} />
                <div className="monthly-table-wrap">
                  <table className="monthly-table exec-milestone-detail-table">
                    <thead>
                      <tr>
                        <th>Target Date</th>
                        <th>Plan Item</th>
                        <th>Owner</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th>Timing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.milestones.map((row) => {
                        const overdue = Boolean(row.date && row.date < model.today && row.statusLabel !== "Completed");
                        return (
                          <tr key={row.id} className={overdue ? "exec-row-overdue" : undefined}>
                            <td>
                              <b>{row.date ? format(parseISO(row.date), "dd MMM yyyy") : "—"}</b>
                            </td>
                            <td>{row.title}</td>
                            <td>{row.ownerName ?? <span className="muted">—</span>}</td>
                            <td>
                              <span className="monthly-pill">{row.sourceLabel}</span>
                            </td>
                            <td>
                              <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>
                            </td>
                            <td>
                              {row.statusLabel === "Completed" ? (
                                <span className="muted">—</span>
                              ) : overdue ? (
                                <span className="exec-flag exec-flag-overdue">Overdue</span>
                              ) : (
                                <span className="exec-flag exec-flag-upcoming">Upcoming</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyTabState text="No plan items recorded." />
            )}
          </>
        )}
      </div>

      <div className="exec-drilldown-foot">
        <Button asChild variant="outline">
          <Link href={`/projects/${projectId}`}>Open project workspace</Link>
        </Button>
        <span>
          Executive views are read only. Weekly and Monthly content is changed in its own workspace, by an account
          authorized for it.
        </span>
      </div>
    </div>
    </ProjectReportingShell>
  );
}
