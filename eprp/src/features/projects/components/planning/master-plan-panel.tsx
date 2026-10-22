"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  Flag,
  History,
  MoreHorizontal,
  Plus,
  Scale,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, FilterBar, LoadingState, SearchInput, StatusBadge } from "@/components/shared";
import { deliverableService } from "@/services/deliverable-service";
import { milestoneService } from "@/services/milestone-service";
import { planningService } from "@/services/planning-service";
import type {
  MasterDeliverable,
  MasterMilestone,
  PlanningActivity,
  PlanningWeightDecisionMode,
  PlanningWorkItem,
  PlanningWorkItemType,
  Project,
  ProjectPlanningSettings,
} from "@/types";
import {
  buildWorkingPlanTree,
  childrenOf,
  effectiveContributions,
  flattenWorkingPlan,
  parentWeightSummary,
  workingPlanFindings,
  type ParentWeightSummary,
  type WorkingPlanElement,
} from "../../working-plan";
import { ActivityFormDialog } from "./activity-form-dialog";
import { childrenTotalText, MasterPlanTable } from "./master-plan-table";
import { PlanningItemHistoryDialog } from "./planning-item-history-dialog";
import { WeightDecisionDialog } from "./weight-decision-dialog";
import { WorkItemFormDialog } from "./work-item-form-dialog";
import { WORK_ITEM_TYPE_LABEL } from "./work-item-labels";
import { useReportingUnitOptions } from "./working-plan-fields";
import { projectWorkflowHref } from "@/config/project-workflow";
import { NO_FORMAL_SCHEDULE_NOTICE } from "../../planning-experience";
import { useReturnRefresh } from "../../use-return-refresh";
import { isPlanningControlReadOnly } from "../../planning-control-archived";

const ALL_TYPES = "all";

type Editing =
  | { kind: "node"; item?: PlanningWorkItem; parentId?: string }
  | { kind: "activity"; activity?: PlanningActivity; nodeId?: string }
  | { kind: "weights"; parentId: string | null; parentName: string; mode: PlanningWeightDecisionMode }
  | { kind: "history"; target: { kind: "node" | "activity"; id: string }; name: string };

interface PlanData {
  workItems: PlanningWorkItem[];
  activities: PlanningActivity[];
  settings: ProjectPlanningSettings | null;
}

function ChildrenTotal({ summary }: { summary: ParentWeightSummary }) {
  return (
    <StatusBadge
      tone={summary.status === "complete" ? "success" : summary.status === "empty" ? "neutral" : "warning"}
      hideDot
    >
      {childrenTotalText(summary)}
    </StatusBadge>
  );
}

/**
 * Phase 13.11 — the Master Plan: the governed Working Plan editor
 * (`docs/02` §26.3, §26.4, `docs/07` §10.12).
 *
 * One tree of planning nodes and their activities (tasks and true
 * milestones). Each row shows its configured level, earning method (own or
 * inherited), LOCAL weight and the CALCULATED project contribution beside it
 * (W4); each parent shows whether its children total 100% (W1 / W2) and offers
 * an explicit, logged weight decision (W3). The Working Plan is never read
 * outside the Planning Workspace; nothing here is published.
 */
export function MasterPlanPanel({
  project,
  canManage,
  noFormalSchedule = false,
  hierarchyTerm,
}: {
  project: Project;
  /** Write authority, already withdrawn for an archived or no-formal-schedule project. */
  canManage: boolean;
  /** The Planning Approach is "No formal schedule": read-only, no authoring invitation. */
  noFormalSchedule?: boolean;
  /** "Program & Study" or the project's own term. */
  hierarchyTerm: string;
}) {
  const projectId = project.id;
  const archived = isPlanningControlReadOnly(project);
  const [data, setData] = React.useState<PlanData | null | undefined>();
  const [milestones, setMilestones] = React.useState<MasterMilestone[]>([]);
  const [deliverables, setDeliverables] = React.useState<MasterDeliverable[]>([]);
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<string>(ALL_TYPES);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [showChecks, setShowChecks] = React.useState(false);
  const unitOptions = useReportingUnitOptions(project);

  const load = React.useCallback(() => {
    Promise.all([
      planningService.listWorkItems(projectId),
      planningService.listActivities(projectId),
      planningService.getSettings(projectId),
    ]).then(
      ([workItems, activities, settings]) => setData({ workItems, activities, settings }),
      () => setData(null)
    );
    void milestoneService.list(projectId).then(setMilestones);
    void deliverableService.list(projectId).then(setDeliverables);
  }, [projectId]);

  // 13.11 UAT: re-read on return to the tab (a Planning Approach approved elsewhere).
  const returned = useReturnRefresh();
  React.useEffect(() => load(), [load, returned]);

  const tree = React.useMemo(
    () => (data ? buildWorkingPlanTree(data.workItems, data.activities) : null),
    [data]
  );
  const contributions = React.useMemo(
    () => (tree ? effectiveContributions(tree) : new Map<string, number | null>()),
    [tree]
  );
  const findings = React.useMemo(
    () => (tree && data ? workingPlanFindings(tree, data.settings) : []),
    [data, tree]
  );

  if (data === null) {
    return (
      <p className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
        The Working Plan could not be loaded. Try again in a moment.
      </p>
    );
  }
  if (data === undefined || !tree) {
    return <LoadingState variant="table" label="Loading the Master Plan…" />;
  }

  const settings = data.settings;
  const levelLabels = settings?.levelLabels ?? [];
  const projectDefault = settings?.defaultEarningMethod;
  const nodeNames = new Map([...tree.nodes.values()].map((node) => [node.id, node.item.name]));
  const showRecorded =
    data.workItems.some((item) => item.weightPercent !== undefined) ||
    data.activities.some((activity) => activity.weightPercent !== undefined);
  const rootSummary = parentWeightSummary(null, tree.roots);
  const blocking = findings.filter((finding) => finding.severity === "blocking");
  const advisory = findings.filter((finding) => finding.severity === "advisory");

  const needle = search.trim().toLowerCase();
  const filtering = needle.length > 0 || typeFilter !== ALL_TYPES;
  const matches = (element: WorkingPlanElement) => {
    if (typeFilter !== ALL_TYPES && (element.kind !== "node" || element.item.itemType !== typeFilter)) return false;
    if (!needle) return true;
    const code = element.kind === "node" ? element.item.code : (element.activity.code ?? element.activity.externalId ?? "");
    const name = element.kind === "node" ? element.item.name : element.activity.name;
    return code.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
  };
  const rows = flattenWorkingPlan(tree).filter((element) => !filtering || matches(element));

  const archiveNode = async (item: PlanningWorkItem) => {
    try {
      await planningService.archiveWorkItem(item.id);
      toast.success(`${item.code} archived.`);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not archive the node.");
    }
  };
  const archiveActivity = async (activity: PlanningActivity) => {
    try {
      await planningService.archiveActivity(activity.id);
      toast.success(`${activity.code ?? activity.name} archived.`);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not archive the activity.");
    }
  };

  const decideMenu = (parentId: string | null, parentName: string, summary: ParentWeightSummary) =>
    summary.childCount > 0 && (
      <>
        <DropdownMenuItem
          onClick={() => setEditing({ kind: "weights", parentId, parentName, mode: "proportional_rescale" })}
        >
          <Scale aria-hidden="true" /> Normalise weights…
        </DropdownMenuItem>
        {summary.recordedAvailable > 0 && (
          <DropdownMenuItem
            onClick={() => setEditing({ kind: "weights", parentId, parentName, mode: "adopt_recorded" })}
          >
            <Scale aria-hidden="true" /> Use recorded weights…
          </DropdownMenuItem>
        )}
      </>
    );

  return (
    <div className="space-y-3" data-hierarchy-term={hierarchyTerm}>
      <FilterBar>
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search code or name…"
          containerClassName="sm:w-64"
        />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>All classifications</SelectItem>
            {(Object.keys(WORK_ITEM_TYPE_LABEL) as PlanningWorkItemType[]).map((type) => (
              <SelectItem key={type} value={type}>
                {WORK_ITEM_TYPE_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <div className="flex gap-2 sm:ml-auto">
            <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "activity" })}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add Activity
            </Button>
            <Button size="sm" onClick={() => setEditing({ kind: "node" })}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add Node
            </Button>
          </div>
        )}
      </FilterBar>

      {tree.roots.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-2">
            <span className="text-muted-foreground">Project — top-level weights</span>
            <ChildrenTotal summary={rootSummary} />
          </span>
          {canManage && rootSummary.status !== "complete" && rootSummary.childCount > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs">
                  Decide <ChevronDown data-icon="inline-end" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {decideMenu(null, "the Project", rootSummary)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            type="button"
            onClick={() => setShowChecks((open) => !open)}
            aria-expanded={showChecks}
            className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-2 hover:underline sm:ml-auto"
          >
            {blocking.length > 0 ? (
              <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />
            ) : null}
            Working Plan checks: {blocking.length} to resolve · {advisory.length} advisory
          </button>
        </div>
      )}

      {showChecks && findings.length > 0 && (
        <ul className="divide-y rounded-lg border text-xs" aria-label="Working Plan checks">
          {[...blocking, ...advisory].map((finding, index) => (
            <li key={`${finding.code}-${finding.elementId}-${index}`} className="flex items-start gap-2 px-3 py-2">
              <StatusBadge tone={finding.severity === "blocking" ? "warning" : "neutral"} hideDot>
                {finding.severity === "blocking" ? "Resolve" : "Note"}
              </StatusBadge>
              <span className="text-pretty">{finding.message}</span>
            </li>
          ))}
          <li className="px-3 py-2 text-muted-foreground">
            Items to resolve will stop the first calculated Planning Snapshot from being published.
          </li>
        </ul>
      )}

      {noFormalSchedule && tree.roots.length > 0 && (
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground text-pretty">
          {NO_FORMAL_SCHEDULE_NOTICE.description} The plan below is kept for reference and cannot be changed.
        </p>
      )}

      {noFormalSchedule && tree.roots.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={NO_FORMAL_SCHEDULE_NOTICE.title}
          description={NO_FORMAL_SCHEDULE_NOTICE.description}
          className="py-10"
          action={
            <Button variant="outline" asChild>
              <Link href={`${projectWorkflowHref(projectId, "info")}#planning-entry`}>Open Project Setup</Link>
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={
            tree.roots.length > 0
              ? "Nothing matches"
              : archived
                ? "No Master Plan recorded"
                : "The Master Plan is empty"
          }
          description={
            tree.roots.length > 0
              ? "Try a different search or classification."
              : archived
                ? "This archived project is read-only. Historical planning data remains visible, but no new planning items can be added."
                : "Add the project breakdown and its activities here, or import a schedule from Imports & Review."
          }
          className="py-10"
        />
      ) : (
        <MasterPlanTable
          tree={tree}
          rows={rows}
          showRecorded={showRecorded}
          contributions={contributions}
          levelLabels={levelLabels}
          projectDefault={projectDefault}
          describeUnit={unitOptions.describe}
          renderActions={(element) =>
            element.kind === "node" ? (
              <RowActions
                label={element.item.code}
                canManage={canManage}
                onEdit={() => setEditing({ kind: "node", item: element.item })}
                onHistory={() =>
                  setEditing({ kind: "history", target: { kind: "node", id: element.id }, name: element.item.name })
                }
                onArchive={() => void archiveNode(element.item)}
              >
                <DropdownMenuItem onClick={() => setEditing({ kind: "node", parentId: element.id })}>
                  <Plus aria-hidden="true" /> Add node under {element.item.code}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditing({ kind: "activity", nodeId: element.id })}>
                  <Plus aria-hidden="true" /> Add activity under {element.item.code}
                </DropdownMenuItem>
                {decideMenu(element.id, element.item.name, parentWeightSummary(element, element.children))}
              </RowActions>
            ) : (
              <RowActions
                label={element.activity.code ?? element.activity.name}
                canManage={canManage}
                onEdit={() => setEditing({ kind: "activity", activity: element.activity })}
                onHistory={() =>
                  setEditing({
                    kind: "history",
                    target: { kind: "activity", id: element.id },
                    name: element.activity.name,
                  })
                }
                onArchive={() => void archiveActivity(element.activity)}
              />
            )
          }
        />
      )}

      {/* A no-formal-schedule project has no PV / EV / SPI: its plan, if any,
          is kept for reference only (13.11 UAT). */}
      {!noFormalSchedule && (
        <p className="text-xs text-muted-foreground">
          Local weights are each item&apos;s share of its parent. Project
          contribution, PV, EV and SPI are calculated by EPRP — never typed.
          Archived items are hidden here but kept for history.
        </p>
      )}

      {editing?.kind === "node" && (
        <WorkItemFormDialog
          projectId={projectId}
          item={editing.item}
          parentId={editing.parentId}
          tree={tree}
          contributions={contributions}
          levelLabels={levelLabels}
          projectDefaultMethod={projectDefault}
          unitOptions={unitOptions}
          hierarchyTerm={hierarchyTerm}
          masterMilestones={milestones}
          masterDeliverables={deliverables}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {editing?.kind === "activity" && (
        <ActivityFormDialog
          projectId={projectId}
          activity={editing.activity}
          nodeId={editing.nodeId}
          tree={tree}
          contributions={contributions}
          projectDefaultMethod={projectDefault}
          unitOptions={unitOptions}
          hierarchyTerm={hierarchyTerm}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {editing?.kind === "weights" && (
        <WeightDecisionDialog
          projectId={projectId}
          parentId={editing.parentId}
          parentName={editing.parentName}
          childElements={childrenOf(tree, editing.parentId)}
          initialMode={editing.mode}
          onClose={() => setEditing(null)}
          onDecided={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {editing?.kind === "history" && (
        <PlanningItemHistoryDialog
          target={editing.target}
          name={editing.name}
          nodeNames={nodeNames}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowActions({
  label,
  canManage,
  onEdit,
  onHistory,
  onArchive,
  children,
}: {
  label: string;
  canManage: boolean;
  onEdit: () => void;
  onHistory: () => void;
  onArchive: () => void;
  children?: React.ReactNode;
}) {
  if (!canManage) {
    return (
      <span className="inline-flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={onHistory}>
          <History data-icon="inline-start" aria-hidden="true" />
          History
        </Button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More for ${label}`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {children}
          {children && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={onHistory}>
            <History aria-hidden="true" /> History
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onArchive} className="text-destructive focus:text-destructive">
            <Archive aria-hidden="true" /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
