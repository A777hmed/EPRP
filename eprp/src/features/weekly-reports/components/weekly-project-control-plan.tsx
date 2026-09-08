"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  SectionCard,
  StatusBadge,
  type StatusTone,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { HierarchyTerms } from "@/config/project-terminology";
import { formatDate } from "@/lib/formatters";
import { milestoneStates } from "@/features/projects/milestone-state";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { milestoneService } from "@/services/milestone-service";
import {
  weeklyReportService,
  type WeeklyMilestoneDraftInput,
  type WeeklyPlanItemInput,
} from "@/services/weekly-report-service";
import type {
  MasterMilestone,
  MilestoneUpdate,
  Project,
  ReportStatus,
  WeeklyMilestoneDraft,
  WeeklyPlanItem,
  WeeklyPlanStatus,
} from "@/types";
import { eligibleOwners } from "../project-scope";
import { nextWeekWindow, placeOnWindow } from "../next-week-window";
import {
  NEXT_WEEK_GRID,
  NextWeekAxisHeader,
  NextWeekBar,
  NextWeekPlacementNote,
  planItemRange,
} from "./weekly-next-week-gantt";
import type { WeeklyNameLookup } from "./weekly-department-section";

const NONE = "__none__";
const STATUS: Record<
  WeeklyPlanStatus,
  { label: string; tone: StatusTone; color: string }
> = {
  not_started: {
    label: "Not Started",
    tone: "neutral",
    color: "bg-slate-300",
  },
  in_progress: { label: "In Progress", tone: "info", color: "bg-primary" },
  completed: { label: "Completed", tone: "success", color: "bg-success" },
  delayed: { label: "Delayed", tone: "danger", color: "bg-destructive" },
};

const APPROVAL_TONE: Record<string, StatusTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

interface PlanDraft extends WeeklyPlanItemInput {
  key: string;
}

interface GovernedDraft extends WeeklyMilestoneDraftInput {
  key: string;
}

const toPlanDraft = (item: WeeklyPlanItem): PlanDraft => ({
  ...item,
  key: item.id,
});

const toGovernedDraft = (draft: WeeklyMilestoneDraft): GovernedDraft => ({
  ...draft,
  key: draft.id,
});

function newPlanDraft(key: string, endDate: string): PlanDraft {
  return {
    key,
    kind: "next_week",
    title: "",
    startDate: endDate,
    endDate,
    status: "not_started",
  };
}

function newGovernedDraft(key: string): GovernedDraft {
  return {
    key,
    milestoneId: "",
    status: "not_started",
  };
}

function Timeline({
  item,
  periodStart,
  periodEnd,
}: {
  item: PlanDraft;
  periodStart: string;
  periodEnd: string;
}) {
  const start = new Date(`${periodStart}T00:00:00`).getTime();
  const end = new Date(`${periodEnd}T00:00:00`).getTime();
  const span = Math.max(end - start, 86_400_000);
  const itemStart = new Date(
    `${item.startDate ?? item.endDate}T00:00:00`
  ).getTime();
  const itemEnd = new Date(`${item.endDate}T00:00:00`).getTime();
  const left = Math.max(0, Math.min(100, ((itemStart - start) / span) * 100));
  const width = Math.max(
    4,
    Math.min(100 - left, ((itemEnd - itemStart) / span) * 100 + 4)
  );
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-muted">
      <span
        className={`absolute h-full rounded-full ${STATUS[item.status].color}`}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
    </div>
  );
}

export function WeeklyProjectControlPlan({
  reportId,
  reportStatus,
  project,
  names,
  terms,
  periodStart,
  periodEnd,
  items,
  editable,
  onChange,
}: {
  reportId: string;
  reportStatus: ReportStatus;
  project: Project | null;
  names: WeeklyNameLookup;
  terms: HierarchyTerms;
  periodStart: string;
  periodEnd: string;
  items: WeeklyPlanItem[];
  editable: boolean;
  onChange: (items: WeeklyPlanItem[]) => void;
}) {
  const [planDrafts, setPlanDrafts] = React.useState<PlanDraft[]>(() =>
    items.map(toPlanDraft)
  );
  const [governedDrafts, setGovernedDrafts] = React.useState<GovernedDraft[]>(
    []
  );
  /*
   * The Next Week axis.
   *
   * Derived from the REPORT's own period and the project's configured working
   * week — never from today's date, so the same report shows the same week
   * whenever it is opened. See `next-week-window.ts`.
   */
  const nextWeekDays = React.useMemo(
    () => nextWeekWindow(periodEnd, project?.reporting?.workingWeek),
    [periodEnd, project?.reporting?.workingWeek]
  );

  const [milestones, setMilestones] = React.useState<MasterMilestone[]>([]);
  const [updates, setUpdates] = React.useState<MilestoneUpdate[]>([]);
  const [canManageGoverned, setCanManageGoverned] = React.useState(false);
  const [milestoneLoading, setMilestoneLoading] = React.useState(true);
  const [milestoneError, setMilestoneError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);
  const counter = React.useRef(0);
  const projectId = project?.id;

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      setMilestoneLoading(true);
      setMilestoneError(null);
      try {
        const registerPromise =
          projectId && isSupabaseConfigured()
            ? milestoneService.listRegister([projectId])
            : Promise.resolve({
                milestones: [] as MasterMilestone[],
                updates: [] as MilestoneUpdate[],
              });
        const [register, drafts, authority] = await Promise.all([
          registerPromise,
          weeklyReportService.listMilestoneDrafts(reportId),
          projectId
            ? weeklyReportService.canManageMilestoneObservations(projectId)
            : Promise.resolve(false),
        ]);
        if (!active) return;
        setMilestones(register.milestones);
        setUpdates(register.updates);
        setGovernedDrafts(drafts.map(toGovernedDraft));
        setCanManageGoverned(authority);
      } catch (error) {
        if (!active) return;
        setMilestones([]);
        setUpdates([]);
        setGovernedDrafts([]);
        setCanManageGoverned(false);
        setMilestoneError(
          error instanceof Error
            ? error.message
            : "The governed milestone register could not be loaded."
        );
      } finally {
        if (active) setMilestoneLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [projectId, reportId, reportStatus]);

  const states = React.useMemo(
    () => milestoneStates(milestones, updates),
    [milestones, updates]
  );
  const stateByMilestone = React.useMemo(
    () => new Map(states.map((state) => [state.milestone.id, state])),
    [states]
  );
  const submittedByMilestone = React.useMemo(
    () =>
      new Map(
        updates
          .filter(
            (update) =>
              update.source === "weekly" && update.weeklyReportId === reportId
          )
          .map((update) => [update.milestoneId, update])
      ),
    [reportId, updates]
  );

  const patchPlan = (key: string, change: Partial<PlanDraft>) =>
    setPlanDrafts((rows) =>
      rows.map((row) =>
        row.key === key
          ? {
              ...row,
              ...change,
              ...(change.departmentId ? { ownerContactId: undefined } : {}),
            }
          : row
      )
    );

  const patchGoverned = (key: string, change: Partial<GovernedDraft>) =>
    setGovernedDrafts((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...change } : row))
    );

  const addNextWeek = () => {
    counter.current += 1;
    setPlanDrafts((rows) => [
      ...rows,
      newPlanDraft(`new-plan-${counter.current}`, periodEnd),
    ]);
  };

  const addGoverned = () => {
    counter.current += 1;
    setGovernedDrafts((rows) => [
      ...rows,
      newGovernedDraft(`new-milestone-${counter.current}`),
    ]);
  };

  const savePlan = async (row: PlanDraft) => {
    if (!row.title.trim() || !row.endDate) {
      toast.error("Enter a plan item and target date.");
      return;
    }
    setSaving(row.key);
    try {
      const saved = await weeklyReportService.savePlanItem(reportId, row);
      const next = items.some((item) => item.id === saved.id)
        ? items.map((item) => (item.id === saved.id ? saved : item))
        : [...items, saved];
      setPlanDrafts((current) =>
        current.map((draft) =>
          draft.key === row.key ? toPlanDraft(saved) : draft
        )
      );
      onChange(next);
      toast.success(
        row.kind === "next_week" ? "Next Week task saved" : "Legacy row saved"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the plan item"
      );
    } finally {
      setSaving(null);
    }
  };

  const saveGoverned = async (row: GovernedDraft) => {
    if (!row.milestoneId) {
      toast.error("Select an active Master Milestone.");
      return;
    }
    setSaving(row.key);
    try {
      const saved = await weeklyReportService.saveMilestoneDraft(reportId, row);
      setGovernedDrafts((current) => [
        ...current.filter(
          (draft) => draft.key !== row.key && draft.id !== saved.id
        ),
        toGovernedDraft(saved),
      ]);
      toast.success("Weekly milestone draft saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save the milestone draft"
      );
    } finally {
      setSaving(null);
    }
  };

  const removePlan = async (row: PlanDraft) => {
    if (!row.id) {
      setPlanDrafts((rows) => rows.filter((item) => item.key !== row.key));
      return;
    }
    setSaving(row.key);
    try {
      await weeklyReportService.deletePlanItem(reportId, row.id);
      setPlanDrafts((current) =>
        current.filter((item) => item.key !== row.key)
      );
      onChange(items.filter((item) => item.id !== row.id));
      toast.success("Plan item removed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove plan item"
      );
    } finally {
      setSaving(null);
    }
  };

  const removeGoverned = async (row: GovernedDraft) => {
    if (!row.id) {
      setGovernedDrafts((rows) =>
        rows.filter((item) => item.key !== row.key)
      );
      return;
    }
    setSaving(row.key);
    try {
      await weeklyReportService.deleteMilestoneDraft(reportId, row.id);
      setGovernedDrafts((current) =>
        current.filter((item) => item.key !== row.key)
      );
      toast.success("Weekly milestone draft removed");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not remove the milestone draft"
      );
    } finally {
      setSaving(null);
    }
  };

  const governedEditable = editable && canManageGoverned;
  const selectedMilestoneIds = new Set(
    governedDrafts.map((draft) => draft.milestoneId).filter(Boolean)
  );
  const legacyMilestones = planDrafts.filter(
    (draft) => draft.kind === "milestone"
  );
  const nextWeek = planDrafts.filter((draft) => draft.kind === "next_week");

  return (
    <SectionCard
      title="Project Control — Look-Ahead & Next Week Plan"
      description="Master Milestones stay governed; ordinary Next Week tasks remain separate."
      contentClassName="space-y-6"
    >
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <div>
            <h4 className="text-sm font-semibold">
              A. Governed Master Milestone Observations
            </h4>
            <p className="text-xs text-muted-foreground">
              Cut-off: {periodEnd}. Finalization appends a pending observation;
              Project Control approval makes it official.
            </p>
          </div>
          {governedEditable && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addGoverned}
            >
              <Plus data-icon="inline-start" />
              Select milestone
            </Button>
          )}
        </div>

        {milestoneLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading the governed register…
          </div>
        ) : milestoneError ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {milestoneError}
          </div>
        ) : governedDrafts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {milestones.length === 0
              ? "No active Master Milestones are available for this project."
              : "No governed milestone observation is drafted for this Weekly."}
          </p>
        ) : (
          governedDrafts.map((row) => {
            const milestone = milestones.find(
              (candidate) => candidate.id === row.milestoneId
            );
            const state = stateByMilestone.get(row.milestoneId);
            const submitted = submittedByMilestone.get(row.milestoneId);
            const scopeName = names.scopeItem(milestone?.disciplineId)?.name;
            return (
              <div
                key={row.key}
                className="space-y-3 rounded-lg border bg-background p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    {state?.inConflict ? (
                      <span className="font-medium text-destructive">
                        Official state unresolved — Project Control reconciliation
                        required
                      </span>
                    ) : (
                      <span>
                        Official: {state?.progressPercent ?? "—"}
                        {state?.progressPercent !== undefined ? "%" : ""} ·{" "}
                        {STATUS[state?.status ?? "not_started"].label}
                      </span>
                    )}
                    {scopeName ? ` · ${terms.singular}: ${scopeName}` : ""}
                  </div>
                  {submitted ? (
                    <StatusBadge
                      tone={APPROVAL_TONE[submitted.approvalStatus] ?? "neutral"}
                    >
                      Governed {submitted.approvalStatus}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Editable Weekly draft</StatusBadge>
                  )}
                </div>

                {governedEditable && !submitted ? (
                  <div className="grid gap-2 lg:grid-cols-[minmax(15rem,2fr)_10rem_8rem_10rem_10rem_auto]">
                    <Select
                      value={row.milestoneId || NONE}
                      onValueChange={(value) =>
                        patchGoverned(row.key, {
                          milestoneId: value === NONE ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger aria-label="Master Milestone">
                        <SelectValue placeholder="Select Master Milestone" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Select Master Milestone</SelectItem>
                        {milestones.map((candidate) => (
                          <SelectItem
                            key={candidate.id}
                            value={candidate.id}
                            disabled={
                              candidate.id !== row.milestoneId &&
                              selectedMilestoneIds.has(candidate.id)
                            }
                          >
                            {candidate.code} — {candidate.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={row.status}
                      onValueChange={(value) =>
                        patchGoverned(row.key, {
                          status: value as WeeklyPlanStatus,
                        })
                      }
                    >
                      <SelectTrigger aria-label="Reported milestone status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS) as WeeklyPlanStatus[]).map(
                          (status) => (
                            <SelectItem key={status} value={status}>
                              {STATUS[status].label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label="Reported progress percent"
                      type="number"
                      min={0}
                      max={100}
                      placeholder="Progress %"
                      value={row.progressPercent ?? ""}
                      onChange={(event) =>
                        patchGoverned(row.key, {
                          progressPercent:
                            event.target.value === ""
                              ? undefined
                              : Number(event.target.value),
                        })
                      }
                    />
                    <Input
                      aria-label="Forecast date"
                      type="date"
                      value={row.forecastDate ?? ""}
                      onChange={(event) =>
                        patchGoverned(row.key, {
                          forecastDate: event.target.value || undefined,
                        })
                      }
                    />
                    <Input
                      aria-label="Actual date"
                      type="date"
                      value={row.actualDate ?? ""}
                      onChange={(event) =>
                        patchGoverned(row.key, {
                          actualDate: event.target.value || undefined,
                        })
                      }
                    />
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        aria-label="Save Weekly milestone draft"
                        onClick={() => saveGoverned(row)}
                        disabled={saving === row.key}
                      >
                        {saving === row.key ? (
                          <Loader2 className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Save aria-hidden="true" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove Weekly milestone draft"
                        onClick={() => removeGoverned(row)}
                        disabled={saving === row.key}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                    <Textarea
                      className="lg:col-span-5"
                      aria-label="Milestone observation narrative"
                      placeholder="Observation / evidence (optional)"
                      value={row.narrative ?? ""}
                      onChange={(event) =>
                        patchGoverned(row.key, {
                          narrative: event.target.value,
                        })
                      }
                    />
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium">
                      {milestone
                        ? `${milestone.code} — ${milestone.name}`
                        : "Archived or unavailable Master Milestone"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Reported {row.progressPercent ?? "—"}
                      {row.progressPercent !== undefined ? "%" : ""} ·{" "}
                      {STATUS[row.status].label}
                      {row.forecastDate
                        ? ` · Forecast ${row.forecastDate}`
                        : ""}
                      {row.actualDate ? ` · Actual ${row.actualDate}` : ""}
                    </p>
                    {row.narrative && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {row.narrative}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {editable &&
          !canManageGoverned &&
          !milestoneLoading &&
          !milestoneError && (
            <p className="text-xs text-muted-foreground">
              Governed milestone observations require Project Control authority.
            </p>
          )}
      </section>

      {legacyMilestones.length > 0 && (
        <section className="space-y-2">
          <div className="border-b pb-2">
            <h4 className="text-sm font-semibold">Legacy Look-Ahead Rows</h4>
            <p className="text-xs text-muted-foreground">
              Preserved for coverage and cutover. No title matching or automatic
              Master Milestone creation is performed.
            </p>
          </div>
          {legacyMilestones.map((row) => {
            const owners = eligibleOwners(project, {
              departmentId: row.departmentId,
            });
            return editable ? (
              <div
                key={row.key}
                className="grid gap-2 rounded-lg border bg-muted/20 p-3 lg:grid-cols-[minmax(12rem,2fr)_9rem_11rem_11rem_auto]"
              >
                <Input
                  aria-label="Legacy milestone / deliverable"
                  value={row.title}
                  onChange={(event) =>
                    patchPlan(row.key, { title: event.target.value })
                  }
                />
                <Input
                  aria-label="Legacy target date"
                  type="date"
                  value={row.endDate}
                  onChange={(event) =>
                    patchPlan(row.key, { endDate: event.target.value })
                  }
                />
                <Select
                  value={row.departmentId ?? NONE}
                  onValueChange={(value) =>
                    patchPlan(row.key, {
                      departmentId: value === NONE ? undefined : value,
                    })
                  }
                >
                  <SelectTrigger aria-label="Legacy owner department">
                    <SelectValue placeholder="Department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Project Control</SelectItem>
                    {(project?.departments ?? []).map((department) => (
                      <SelectItem
                        key={department.departmentId}
                        value={department.departmentId}
                      >
                        {names.department(department.departmentId)?.name ??
                          department.departmentId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.ownerContactId ?? NONE}
                  onValueChange={(value) =>
                    patchPlan(row.key, {
                      ownerContactId: value === NONE ? undefined : value,
                    })
                  }
                >
                  <SelectTrigger aria-label="Legacy plan owner">
                    <SelectValue placeholder="Owner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No owner</SelectItem>
                    {owners.map((owner) => (
                      <SelectItem key={owner.contactId} value={owner.contactId}>
                        {names.person(owner.contactId)?.name ?? "Assigned person"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    aria-label="Save legacy plan item"
                    onClick={() => savePlan(row)}
                    disabled={saving === row.key}
                  >
                    {saving === row.key ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Save aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove legacy plan item"
                    onClick={() => removePlan(row)}
                    disabled={saving === row.key}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <Select
                  value={row.status}
                  onValueChange={(value) =>
                    patchPlan(row.key, { status: value as WeeklyPlanStatus })
                  }
                >
                  <SelectTrigger aria-label="Legacy plan status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS) as WeeklyPlanStatus[]).map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS[status].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="self-center lg:col-span-4">
                  <Timeline
                    item={row}
                    periodStart={periodStart}
                    periodEnd={periodEnd}
                  />
                </div>
              </div>
            ) : (
              <div
                key={row.key}
                className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[minmax(12rem,2fr)_9rem_10rem]"
              >
                <div>
                  <p className="text-sm font-medium">{row.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Legacy row · {row.endDate}
                  </p>
                </div>
                <StatusBadge tone={STATUS[row.status].tone}>
                  {STATUS[row.status].label}
                </StatusBadge>
                <Timeline
                  item={row}
                  periodStart={periodStart}
                  periodEnd={periodEnd}
                />
              </div>
            );
          })}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold">
              B. Next Week Plan — Gantt
            </h4>
            {nextWeekDays.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatDate(nextWeekDays[0].date)} –{" "}
                {formatDate(nextWeekDays[nextWeekDays.length - 1].date)} ·
                working week {project?.reporting?.workingWeek ?? "Sun – Thu"}
              </p>
            )}
          </div>
          {editable && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addNextWeek}
            >
              <Plus data-icon="inline-start" />
              Add task
            </Button>
          )}
        </div>

        {/*
          The axis, once, on the SAME grid as the rows below it — otherwise the
          day headings sit over the wrong part of the row and the chart lies.
          In the editor the bar spans the full row width, so the axis does too;
          in the read-only Gantt it occupies the timeline column and the axis is
          placed in that same column with `NEXT_WEEK_GRID`.
        */}
        {nextWeekDays.length > 0 && nextWeek.length > 0 && (
          editable ? (
            <div className="px-3">
              <NextWeekAxisHeader days={nextWeekDays} />
            </div>
          ) : (
            <div className={`grid gap-x-3 px-3 ${NEXT_WEEK_GRID}`}>
              <span className="hidden text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase lg:block">
                Task
              </span>
              <span className="hidden text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase lg:block">
                Start – End
              </span>
              <NextWeekAxisHeader days={nextWeekDays} />
              <span className="hidden text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase lg:block">
                Owner / Department
              </span>
              <span className="hidden text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase lg:block">
                Status
              </span>
            </div>
          )
        )}

        {nextWeekDays.length === 0 && nextWeek.length > 0 && (
          <p className="text-xs text-muted-foreground">
            The next working week could not be derived from this report&apos;s
            period, so the timeline is not shown. Task dates below are unaffected.
          </p>
        )}

        {nextWeek.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tasks recorded.</p>
        ) : (
          nextWeek.map((row) => {
            const owners = eligibleOwners(project, {
              departmentId: row.departmentId,
            });
            return editable ? (
              <div
                key={row.key}
                className="grid gap-2 rounded-lg border bg-background p-3 lg:grid-cols-[minmax(12rem,2fr)_9rem_9rem_11rem_11rem_auto]"
              >
                <Input
                  aria-label="Next Week task"
                  placeholder="Task"
                  value={row.title}
                  onChange={(event) =>
                    patchPlan(row.key, { title: event.target.value })
                  }
                />
                <Input
                  aria-label="From"
                  type="date"
                  value={row.startDate ?? ""}
                  onChange={(event) =>
                    patchPlan(row.key, { startDate: event.target.value })
                  }
                />
                <Input
                  aria-label="To"
                  type="date"
                  value={row.endDate}
                  onChange={(event) =>
                    patchPlan(row.key, { endDate: event.target.value })
                  }
                />
                <Select
                  value={row.departmentId ?? NONE}
                  onValueChange={(value) =>
                    patchPlan(row.key, {
                      departmentId: value === NONE ? undefined : value,
                    })
                  }
                >
                  <SelectTrigger aria-label="Owner department">
                    <SelectValue placeholder="Department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Project Control</SelectItem>
                    {(project?.departments ?? []).map((department) => (
                      <SelectItem
                        key={department.departmentId}
                        value={department.departmentId}
                      >
                        {names.department(department.departmentId)?.name ??
                          department.departmentId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.ownerContactId ?? NONE}
                  onValueChange={(value) =>
                    patchPlan(row.key, {
                      ownerContactId: value === NONE ? undefined : value,
                    })
                  }
                >
                  <SelectTrigger aria-label="Plan owner">
                    <SelectValue placeholder="Owner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No owner</SelectItem>
                    {owners.map((owner) => (
                      <SelectItem key={owner.contactId} value={owner.contactId}>
                        {names.person(owner.contactId)?.name ?? "Assigned person"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    aria-label="Save Next Week task"
                    onClick={() => savePlan(row)}
                    disabled={saving === row.key}
                  >
                    {saving === row.key ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Save aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove Next Week task"
                    onClick={() => removePlan(row)}
                    disabled={saving === row.key}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <Select
                  value={row.status}
                  onValueChange={(value) =>
                    patchPlan(row.key, { status: value as WeeklyPlanStatus })
                  }
                >
                  <SelectTrigger
                    className="lg:col-start-4"
                    aria-label="Task status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS) as WeeklyPlanStatus[]).map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS[status].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Same task record, same grid as the axis above. */}
                <div className="space-y-1 self-center lg:col-span-full">
                  {nextWeekDays.length > 0 && (
                    <NextWeekBar
                      days={nextWeekDays}
                      placement={placeOnWindow(row, nextWeekDays)}
                      status={row.status}
                      meta={STATUS}
                      label={`${row.title || "Untitled task"} · ${planItemRange(row.startDate, row.endDate)}`}
                    />
                  )}
                  {nextWeekDays.length > 0 && (
                    <NextWeekPlacementNote
                      placement={placeOnWindow(row, nextWeekDays)}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div
                key={row.key}
                className={`grid items-center gap-x-3 gap-y-2 rounded-lg border bg-background p-3 ${NEXT_WEEK_GRID}`}
              >
                <p className="min-w-0 truncate text-sm font-medium" title={row.title}>
                  {row.title}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {planItemRange(row.startDate, row.endDate)}
                </p>
                <div className="space-y-1">
                  {nextWeekDays.length > 0 && (
                    <>
                      <NextWeekBar
                        days={nextWeekDays}
                        placement={placeOnWindow(row, nextWeekDays)}
                        status={row.status}
                        meta={STATUS}
                        label={`${row.title || "Untitled task"} · ${planItemRange(row.startDate, row.endDate)}`}
                      />
                      <NextWeekPlacementNote
                        placement={placeOnWindow(row, nextWeekDays)}
                      />
                    </>
                  )}
                </div>
                <p
                  className="min-w-0 truncate text-xs text-muted-foreground"
                  /* Truncation must not lose the name — see the design
                     constitution on clamping. */
                  title={`${names.person(row.ownerContactId)?.name ?? "No owner"} · ${
                    names.department(row.departmentId)?.name ?? "Project Control"
                  }`}
                >
                  {names.person(row.ownerContactId)?.name ?? "No owner"}
                  {" · "}
                  {names.department(row.departmentId)?.name ?? "Project Control"}
                </p>
                <StatusBadge tone={STATUS[row.status].tone}>
                  {STATUS[row.status].label}
                </StatusBadge>
              </div>
            );
          })
        )}
      </section>
    </SectionCard>
  );
}
