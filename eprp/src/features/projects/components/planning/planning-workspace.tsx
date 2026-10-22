"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDot,
  Info,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { LabelWithHelp, LoadingState, StatusBadge } from "@/components/shared";
import { projectWorkflowHref } from "@/config/project-workflow";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { planningService } from "@/services/planning-service";
import type {
  PlanningSnapshot,
  Project,
  ProjectPlanningSettings,
} from "@/types";
import { isPlanningControlReadOnly } from "../../planning-control-archived";
import {
  PLANNING_WORKSPACE_VIEWS,
  nextReadinessStep,
  onboardingChoice,
  planningAuthoringAllowed,
  planningReadinessSteps,
  resolvePlanningView,
  type PlanningWorkspaceView,
  type ReadinessStep,
} from "../../planning-experience";
import { configurationComplete } from "../../working-plan";
import { ArchivedPlanningNotice } from "./archived-planning-notice";
import { BaselinesSnapshotsPanel } from "./baselines-snapshots-panel";
import { MasterPlanPanel } from "./master-plan-panel";
import { PlanningDataPanel } from "./planning-data-panel";
import { PlanningHelp } from "./planning-help";
import { PlanningSetupPanel } from "./planning-setup-panel";
import { PlanningFact } from "./planning-status";
import { useReturnRefresh } from "../../use-return-refresh";

/* ---------------------------- URL-addressable view ------------------------ */

const VIEW_EVENT = "planning-view-change";

/**
 * The open section lives in `?view=` so every section is deep-linkable (the
 * same URL-state pattern as the project Reporting workspace). Summary is the
 * default and carries no parameter.
 */
function usePlanningView(): [PlanningWorkspaceView, (view: PlanningWorkspaceView) => void] {
  const subscribe = React.useCallback((onChange: () => void) => {
    window.addEventListener("popstate", onChange);
    window.addEventListener(VIEW_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(VIEW_EVENT, onChange);
    };
  }, []);

  const view = React.useSyncExternalStore<PlanningWorkspaceView>(
    subscribe,
    () => resolvePlanningView(new URLSearchParams(window.location.search).get("view")),
    () => "summary"
  );

  const selectView = React.useCallback((next: PlanningWorkspaceView) => {
    const url = new URL(window.location.href);
    if (next === "summary") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(VIEW_EVENT));
  }, []);

  return [view, selectView];
}

/* ------------------------------ Workspace data --------------------------- */

interface WorkspaceFacts {
  settings: ProjectPlanningSettings | null;
  snapshot: PlanningSnapshot | null;
  workItemCount: number;
  activityCount: number;
  importCount: number;
  hasOpeningDraft: boolean;
  /** 13.11: any node or activity carries a local weight. */
  hasLocalWeights: boolean;
}

async function loadWorkspaceFacts(projectId: string): Promise<WorkspaceFacts> {
  const [settings, snapshot, workItems, activities, imports, openingDraft] = await Promise.all([
    planningService.getSettings(projectId),
    planningService.getLatestSnapshot(projectId),
    planningService.listWorkItems(projectId),
    planningService.listActivities(projectId),
    planningService.listImportBatches(projectId),
    planningService.getDraftOpeningPosition(projectId),
  ]);
  return {
    settings,
    snapshot,
    workItemCount: workItems.length,
    activityCount: activities.length,
    importCount: imports.length,
    hasOpeningDraft: Boolean(openingDraft),
    hasLocalWeights:
      workItems.some((item) => item.localWeightPercent !== undefined) ||
      activities.some((activity) => activity.localWeightPercent !== undefined),
  };
}

/* --------------------------------- Workspace ----------------------------- */

/**
 * Phase 13.9A — the Planning Workspace (`docs/02` §26.23.3, `docs/07` §10.12).
 *
 * Four sections — Summary, Master Plan, Imports & Review, Baselines &
 * Snapshots — under a pinned header strip that shows only values the current
 * data supplies. The inner Milestones tab (the Milestones module is the one
 * register) and Performance & Variance (Project Progress owns performance)
 * were removed. Opening Position record / promote lives in Baselines &
 * Snapshots only.
 */
export function PlanningWorkspace({
  project,
  canManage,
  hierarchyTerm,
}: {
  project: Project;
  canManage: boolean;
  hierarchyTerm: string;
}) {
  const [view, selectView] = usePlanningView();
  const [facts, setFacts] = React.useState<WorkspaceFacts | null | undefined>();
  const [reloadToken, setReloadToken] = React.useState(0);
  // 13.11 UAT: a Planning Approach approved in another tab re-gates authoring
  // (Master Plan, Imports, Baselines) when the user returns here.
  const returned = useReturnRefresh();

  React.useEffect(() => {
    let cancelled = false;
    loadWorkspaceFacts(project.id).then(
      (next) => {
        if (!cancelled) setFacts(next);
      },
      () => {
        if (!cancelled) setFacts(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [project.id, reloadToken, view, returned]);

  const archived = isPlanningControlReadOnly(project);
  // 13.11 UAT: while the Planning Approach is "No formal schedule" the
  // Working Plan, imports and baselines are read-only (the database refuses
  // the writes too). Authoring waits until the approach is known.
  const noFormalSchedule = facts?.settings?.onboardingMode === "no_formal_schedule";
  const authoring =
    canManage && facts !== undefined && planningAuthoringAllowed(facts?.settings?.onboardingMode);

  return (
    <div className="space-y-4">
      {isPlanningControlReadOnly(project) && <ArchivedPlanningNotice />}

      <Tabs
        value={view}
        onValueChange={(value) => selectView(resolvePlanningView(value))}
        className="gap-0"
      >
        <div className="rounded-xl border bg-card shadow-soft">
          <WorkspaceHeaderStrip facts={facts} archived={archived} />
          <ScrollableTabRow activeKey={view}>
            <TabsList
              variant="line"
              aria-label="Planning Workspace sections"
              className="h-11 justify-start gap-0 p-0 group-data-horizontal/tabs:h-11"
            >
              {PLANNING_WORKSPACE_VIEWS.map((section) => (
                <TabsTrigger
                  key={section.id}
                  value={section.id}
                  className={cn(
                    "h-11 flex-none rounded-none px-3.5 text-[13px] font-medium",
                    // Inactive: quiet, but legible in both themes.
                    "text-muted-foreground hover:text-foreground dark:text-muted-foreground",
                    // Active: accent text and weight — no background fill.
                    "data-active:font-semibold data-active:text-primary dark:data-active:text-primary",
                    // Active: a 3px accent underline sitting INSIDE the bar. The
                    // base trigger hangs it 5px below, where the scrollable tab
                    // container clipped it; overriding the same variant classes
                    // lets tailwind-merge replace them.
                    "group-data-horizontal/tabs:after:bottom-0 group-data-horizontal/tabs:after:h-[3px] after:rounded-t-sm after:bg-primary"
                  )}
                >
                  {section.label}
                  {section.id === "imports" && facts && facts.importCount > 0 && (
                    <span className="ml-1 rounded-full bg-foreground/[0.07] px-1.5 text-[11px] leading-5 font-semibold tabular-nums text-muted-foreground">
                      {facts.importCount}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </ScrollableTabRow>
        </div>

        <TabsContent value="summary" className="pt-4">
          {archived ? (
            <ArchivedPlanningHistory onOpen={selectView} />
          ) : (
            <PlanningSummary
              project={project}
              facts={facts}
              canManage={canManage}
              onOpen={selectView}
              onChanged={() => setReloadToken((token) => token + 1)}
            />
          )}
        </TabsContent>
        <TabsContent value="master-plan" className="pt-4">
          <MasterPlanPanel
            project={project}
            canManage={authoring}
            noFormalSchedule={noFormalSchedule}
            hierarchyTerm={hierarchyTerm}
          />
        </TabsContent>
        <TabsContent value="imports" className="pt-4">
          <PlanningDataPanel project={project} canManage={authoring} noFormalSchedule={noFormalSchedule} />
        </TabsContent>
        <TabsContent value="baselines" className="pt-4">
          <BaselinesSnapshotsPanel
            project={project}
            canManage={authoring}
            onChanged={() => setReloadToken((token) => token + 1)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------------------- Scrollable tab row ------------------------- */

/**
 * One row of section tabs that scrolls sideways when it does not fit (tablet
 * and phone) — never wraps. Edge fades in the card's own colour appear only
 * on a side that has more tabs, so a clipped tab reads as "scroll for more",
 * and the active tab is kept in view whenever it changes.
 */
function ScrollableTabRow({
  activeKey,
  children,
}: {
  activeKey: string;
  children: React.ReactNode;
}) {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });

  const measure = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((previous) =>
      previous.left === left && previous.right === right ? previous : { left, right }
    );
  }, []);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // Horizontal only — never scrolls the page vertically.
  React.useEffect(() => {
    const el = scrollerRef.current;
    const active = el?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!el || !active) return;
    const start = active.offsetLeft - 16;
    const end = active.offsetLeft + active.offsetWidth + 16 - el.clientWidth;
    if (el.scrollLeft > start) el.scrollTo({ left: Math.max(0, start), behavior: "smooth" });
    else if (el.scrollLeft < end) el.scrollTo({ left: end, behavior: "smooth" });
  }, [activeKey]);

  return (
    <div className="relative border-t">
      <div
        ref={scrollerRef}
        onScroll={measure}
        className="relative overflow-x-auto px-2 sm:px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-8 rounded-bl-xl bg-linear-to-r from-card to-transparent transition-opacity",
          edges.left ? "opacity-100" : "opacity-0"
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-10 rounded-br-xl bg-linear-to-l from-card to-transparent transition-opacity",
          edges.right ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}

/* ------------------------------- Header strip ---------------------------- */

function WorkspaceHeaderStrip({
  facts,
  archived,
}: {
  facts: WorkspaceFacts | null | undefined;
  archived: boolean;
}) {
  if (facts === undefined) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground" aria-busy="true">
        Loading planning position…
      </p>
    );
  }
  if (facts === null) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        The planning position could not be loaded. The sections below still open.
      </p>
    );
  }

  const planItems = facts.workItemCount + facts.activityCount;
  const workingPlan =
    planItems === 0
      ? "Not started"
      : `${facts.workItemCount} work item${facts.workItemCount === 1 ? "" : "s"} · ${facts.activityCount} activit${facts.activityCount === 1 ? "y" : "ies"}`;
  const snapshot = facts.snapshot;

  // Each fact is its own cell, separated by a hairline: a 2 × 2 grid on
  // tablets and narrow laptops, one row of equal columns from `lg`. Values
  // and their sources are unchanged; a value the data cannot supply (Data
  // Date before any snapshot) is still omitted, never estimated.
  const cells: { key: string; label: string; value: React.ReactNode; help?: React.ReactNode }[] = [
    { key: "plan", label: "Working Plan", value: workingPlan },
    {
      key: "snapshot",
      label: "Published snapshot",
      value: snapshot ? (
        <span className="inline-flex items-center gap-1.5">
          v{snapshot.version}
          {snapshot.isOpeningSnapshot && <StatusBadge tone="info">Opening</StatusBadge>}
        </span>
      ) : (
        <span className="font-normal text-muted-foreground">None yet</span>
      ),
    },
    ...(snapshot
      ? [{ key: "data-date", label: "Data Date", value: formatDate(snapshot.dataDate), help: <PlanningHelp concept="dataDate" /> }]
      : []),
    // Only a STORED choice is shown as the approach. With no settings row the
    // fallback ("new_project") is not a decision anyone made — the readiness
    // checklist rightly says so too.
    {
      key: "approach",
      label: "Planning approach",
      value: facts.settings ? (
        onboardingChoice(facts.settings.onboardingMode).label
      ) : (
        <span className="font-normal text-muted-foreground">Not chosen yet</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col lg:flex-row lg:items-stretch">
      <dl className="grid min-w-0 flex-1 grid-cols-1 sm:grid-cols-2 lg:flex">
        {cells.map((cell, index) => (
          <PlanningFact
            key={cell.key}
            label={cell.label}
            value={cell.value}
            help={cell.help}
            className={cn(
              "px-4 py-3 lg:min-w-0 lg:flex-1",
              // Separators: rows below the first on the stacked layouts,
              // the second column in the 2 × 2 grid, every later column on one row.
              index > 0 && "border-t sm:border-t-0",
              index >= 2 && "sm:border-t lg:border-t-0",
              index % 2 === 1 && "sm:border-l",
              index > 0 && "lg:border-l"
            )}
          />
        ))}
      </dl>
      {archived && (
        <div className="flex items-center border-t px-4 py-3 lg:border-t-0 lg:border-l">
          <StatusBadge tone="neutral">Archived · read-only</StatusBadge>
        </div>
      )}
    </div>
  );
}

/* --------------------------- Archived: history only ---------------------- */

const HISTORY_VIEWS: { id: PlanningWorkspaceView; label: string }[] = PLANNING_WORKSPACE_VIEWS.filter(
  (view) => view.id !== "summary"
);

/**
 * Summary for an ARCHIVED project. An archived project cannot be brought
 * under new planning control, so there is no readiness workflow, no next
 * step and no call to configure, import or publish — only read-only
 * navigation to the history. The sections opened from here are themselves
 * read-only (13.9: archive-aware authority withholds every mutation).
 */
function ArchivedPlanningHistory({ onOpen }: { onOpen: (view: PlanningWorkspaceView) => void }) {
  return (
    <section aria-labelledby="planning-history" className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
      <h2 id="planning-history" className="text-sm font-semibold">
        Planning history
      </h2>
      <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground text-pretty">
        This project is archived. Its Working Plan, imports, baselines and
        Published Planning Snapshots remain available for historical reference.
      </p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {HISTORY_VIEWS.map((view) => (
          <li key={view.id}>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpen(view.id)}>
              View {view.label}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------- Summary ------------------------------ */

const STEP_ICON = {
  done: CheckCircle2,
  next: CircleDot,
  pending: Circle,
} as const;

function PlanningSummary({
  project,
  facts,
  canManage,
  onOpen,
  onChanged,
}: {
  project: Project;
  facts: WorkspaceFacts | null | undefined;
  canManage: boolean;
  onOpen: (view: PlanningWorkspaceView) => void;
  onChanged: () => void;
}) {
  // The version the user just saved in Planning Setup, so the reloaded panel
  // can confirm the save (it remounts on every new version).
  const [savedVersion, setSavedVersion] = React.useState<string | null>(null);
  if (facts === undefined) {
    return <LoadingState variant="spinner" label="Loading planning readiness…" />;
  }
  if (facts === null) {
    return (
      <p className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
        Planning readiness could not be loaded. Try again in a moment.
      </p>
    );
  }

  const mode = facts.settings?.onboardingMode ?? "new_project";
  const steps = planningReadinessSteps({
    onboardingMode: mode,
    onboardingSaved: Boolean(facts.settings),
    hasPlanData: facts.workItemCount + facts.activityCount + facts.importCount > 0,
    hasOpeningDraft: facts.hasOpeningDraft,
    hasPublishedSnapshot: Boolean(facts.snapshot),
    configurationComplete: configurationComplete(facts.settings),
  });
  const next = nextReadinessStep(steps);
  const setupHref = `${projectWorkflowHref(project.id, "info")}#planning-entry`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="grid min-w-0 gap-4 self-start">
        <section aria-labelledby="planning-readiness" className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="planning-readiness" className="text-sm font-semibold">
                <LabelWithHelp help={<PlanningHelp concept="readiness" />}>Planning readiness</LabelWithHelp>
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                {mode === "no_formal_schedule"
                  ? "This project is reported without a formal schedule."
                  : next
                    ? "What to do next to bring this project under planning control."
                    : "The project is under planning control. Keep the plan current and publish new snapshots as it moves."}
              </p>
            </div>
            {next && (
              <NextStepAction step={next} setupHref={setupHref} onOpen={onOpen} />
            )}
          </div>

          <ol className="mt-4 divide-y rounded-lg border">
            {steps.map((step, index) => (
              <ReadinessRow
                key={step.id}
                step={step}
                index={index}
                setupHref={setupHref}
                onOpen={onOpen}
              />
            ))}
          </ol>

          {mode === "no_formal_schedule" && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <p className="text-pretty">
                Progress is shown as “Reported — not planning governed” and SPI is
                not applicable. If a schedule becomes available, change how the
                project is planned in Project Setup.
              </p>
            </div>
          )}
        </section>

        {/* 13.11: the Planning Setup questions. A no-formal-schedule project is
            not planning-governed and has no planning configuration. */}
        {mode !== "no_formal_schedule" && (
          <PlanningSetupPanel
            key={facts.settings?.updatedAt ?? "unsaved"}
            projectId={project.id}
            settings={facts.settings}
            canManage={canManage}
            hasLocalWeights={facts.hasLocalWeights}
            setupHref={setupHref}
            justSaved={savedVersion !== null && savedVersion === facts.settings?.updatedAt}
            onSaved={(updatedAt) => {
              setSavedVersion(updatedAt);
              onChanged();
            }}
          />
        )}
      </div>

      {/* Secondary by design: a light outlined container (border token,
          card radius, near-transparent tint, no shadow), three short points. */}
      <aside
        aria-labelledby="how-planning-works"
        className="self-start rounded-xl border bg-muted/10 p-3 text-xs text-muted-foreground lg:p-4"
      >
        <p id="how-planning-works" className="text-[11px] font-medium uppercase tracking-wide">
          How Planning works
        </p>
        {/* A no-formal-schedule project has no planned figures to explain. */}
        {mode === "no_formal_schedule" ? (
          <ul className="mt-2 space-y-1.5 text-pretty">
            <li>This project is reported without a formal schedule.</li>
            <li>Any earlier planning data stays visible for reference, read-only.</li>
            <li>To plan it, change the Planning Approach in Project Setup.</li>
          </ul>
        ) : (
          <ul className="mt-2 space-y-1.5 text-pretty">
            <li>The Published Planning Snapshot is the governed source.</li>
            <li>PV, EV, SPI and the S-curve are calculated — never typed in.</li>
            <li>Planning Engineers work in Master Plan, Imports &amp; Review and Baselines &amp; Snapshots.</li>
          </ul>
        )}
      </aside>
    </div>
  );
}

function stepHref(step: ReadinessStep, setupHref: string): string | undefined {
  if (step.target === "setup") return setupHref;
  if (step.target === "planning-setup") return "#planning-setup";
  return undefined;
}

function NextStepAction({
  step,
  setupHref,
  onOpen,
}: {
  step: ReadinessStep;
  setupHref: string;
  onOpen: (view: PlanningWorkspaceView) => void;
}) {
  const href = stepHref(step, setupHref);
  // The shared button never wraps; on a ~390px phone a long step title would
  // overflow the card, so below `sm` it may wrap within the card's width.
  const fit = "h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal sm:whitespace-nowrap";
  if (href) {
    return (
      <Button size="sm" asChild className={fit}>
        <Link href={href}>
          {step.title}
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </Link>
      </Button>
    );
  }
  return (
    <Button size="sm" className={fit} onClick={() => onOpen(step.target as PlanningWorkspaceView)}>
      {step.title}
      <ArrowRight data-icon="inline-end" aria-hidden="true" />
    </Button>
  );
}

function ReadinessRow({
  step,
  index,
  setupHref,
  onOpen,
}: {
  step: ReadinessStep;
  index: number;
  setupHref: string;
  onOpen: (view: PlanningWorkspaceView) => void;
}) {
  const Icon = STEP_ICON[step.state];
  const href = stepHref(step, setupHref);
  const label =
    step.target === "setup"
      ? "Project Setup"
      : step.target === "planning-setup"
        ? "Planning setup"
        : PLANNING_WORKSPACE_VIEWS.find((view) => view.id === step.target)?.label;

  return (
    <li
      className={cn(
        "flex items-start gap-3 px-3 py-3",
        step.state === "next" && "bg-primary/[0.04]"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          step.state === "done" && "text-success",
          step.state === "next" && "text-primary",
          step.state === "pending" && "text-muted-foreground/60"
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          <span className="sr-only">
            Step {index + 1}, {step.state === "done" ? "done" : step.state === "next" ? "next" : "not yet"}:{" "}
          </span>
          {step.title}
          {step.optional && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">Optional</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{step.description}</p>
      </div>
      {label &&
        (href ? (
          <Link
            href={href}
            className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onOpen(step.target as PlanningWorkspaceView)}
            className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {label}
          </button>
        ))}
    </li>
  );
}
