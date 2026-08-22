"use client";

import * as React from "react";
import { CircleCheck, Flag, History, Pencil, Plus, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  SearchInput,
  StatusBadge,
} from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import { MILESTONE_STATUS_META, PRIORITY_META } from "@/lib/constants";
import { milestoneService } from "@/services/milestone-service";
import type {
  MasterMilestone,
  MilestoneStatus,
  MilestoneUpdate,
  Project,
} from "@/types";
import {
  approvalQueue,
  milestoneStates,
  summarise,
  type MilestoneState,
} from "../../milestone-state";
import { useHierarchyTerms } from "../../use-hierarchy-terms";
import { useMilestoneAuthority } from "../../use-milestone-authority";
import { ApprovalQueue } from "./approval-queue";
import { MilestoneFormDialog } from "./milestone-form-dialog";
import { MilestoneHistoryDialog } from "./milestone-history-dialog";
import { MilestoneUpdateDialog } from "./milestone-update-dialog";
import { useMilestoneScopeOptions } from "./scope-options";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "delayed", label: "Delayed" },
  // Not a status — a milestone nothing has been approved for yet. Kept in the
  // same control because it is the question a planner actually asks here.
  { value: "unreported", label: "Not yet reported" },
  { value: "awaiting", label: "Awaiting approval" },
];

/**
 * The Master Milestone register (Phase 13.2).
 *
 * The screen shows two things that must never be confused: what a milestone IS
 * (the register) and what has been REPORTED of it (the update stream). Identity
 * is edited here by Project Control; every figure in the table is derived from
 * the latest APPROVED update by `milestone-state.ts`, which is the single place
 * that rule lives.
 *
 * A pending update changes nothing in the table. It shows as a pending marker
 * and waits in the approval queue — that is R5, and making it visible is what
 * stops "submitted" from being read as "agreed".
 */
export function MilestonesPanel({ project }: { project: Project }) {
  const authority = useMilestoneAuthority(project);
  const options = useMilestoneScopeOptions(project);
  const terms = useHierarchyTerms(project);

  const [milestones, setMilestones] = React.useState<MasterMilestone[]>([]);
  const [updates, setUpdates] = React.useState<MilestoneUpdate[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();

  const [query, setQuery] = React.useState("");
  const [departmentFilter, setDepartmentFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [showArchived, setShowArchived] = React.useState(false);

  const [editing, setEditing] = React.useState<MasterMilestone | "new">();
  const [updating, setUpdating] = React.useState<MilestoneState>();
  const [viewing, setViewing] = React.useState<MilestoneState>();

  const load = React.useCallback(async () => {
    setError(undefined);
    try {
      const [rows, stream] = await Promise.all([
        milestoneService.list(project.id),
        milestoneService.listUpdates(project.id),
      ]);
      setMilestones(rows);
      setUpdates(stream);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load milestones."
      );
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, stream] = await Promise.all([
          milestoneService.list(project.id),
          milestoneService.listUpdates(project.id),
        ]);
        if (!active) return;
        setMilestones(rows);
        setUpdates(stream);
      } catch (cause) {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load milestones."
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [project.id]);

  const states = React.useMemo(
    () => milestoneStates(milestones, updates),
    [milestones, updates]
  );

  /*
   * The register counts ACTIVE milestones. Archived ones keep their history and
   * stay reachable behind a toggle, but they are not part of what the project is
   * currently delivering and must not dilute the summary.
   */
  const activeStates = React.useMemo(
    () => states.filter((state) => state.milestone.active),
    [states]
  );
  const archivedStates = React.useMemo(
    () => states.filter((state) => !state.milestone.active),
    [states]
  );
  const summary = React.useMemo(() => summarise(activeStates), [activeStates]);
  const queue = React.useMemo(() => approvalQueue(activeStates), [activeStates]);

  const visible = React.useMemo(() => {
    const pool = showArchived ? archivedStates : activeStates;
    const needle = query.trim().toLowerCase();
    return pool.filter((state) => {
      const { milestone } = state;
      if (
        departmentFilter !== "all" &&
        milestone.departmentId !== departmentFilter
      ) {
        return false;
      }
      if (statusFilter === "unreported" && state.current) return false;
      if (statusFilter === "awaiting" && state.pending.length === 0) return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "unreported" &&
        statusFilter !== "awaiting" &&
        state.status !== statusFilter
      ) {
        return false;
      }
      if (!needle) return true;
      return (
        milestone.code.toLowerCase().includes(needle) ||
        milestone.name.toLowerCase().includes(needle) ||
        (milestone.description ?? "").toLowerCase().includes(needle)
      );
    });
  }, [
    activeStates,
    archivedStates,
    showArchived,
    query,
    departmentFilter,
    statusFilter,
  ]);

  const archive = async (state: MilestoneState) => {
    const next = !state.milestone.active;
    try {
      await milestoneService.setActive(state.milestone.id, next);
      toast.success(next ? "Milestone restored." : "Milestone archived.");
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not update the milestone."
      );
    }
  };

  if (loading) return <LoadingState label="Loading milestones…" />;
  if (error) return <ErrorState description={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SummaryChip label="Milestones" value={summary.total} />
        <SummaryChip label="In progress" value={summary.inProgress} tone="info" />
        <SummaryChip label="Completed" value={summary.completed} tone="success" />
        <SummaryChip label="Delayed" value={summary.delayed} tone="danger" />
        <SummaryChip label="Slipping" value={summary.slipping} tone="warning" />
        <SummaryChip
          label="Not yet reported"
          value={summary.unreported}
          tone="neutral"
        />
        <SummaryChip
          label="Awaiting approval"
          value={summary.awaitingApproval}
          tone="warning"
        />

        {authority.canManage && (
          <Button className="ml-auto" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add Milestone
          </Button>
        )}
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="approvals">
            Pending Approvals{queue.length > 0 ? ` (${queue.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="space-y-3 pt-3">
          <FilterBar>
            <SearchInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search code, name or description…"
            />
            <Select
              value={departmentFilter}
              onValueChange={setDepartmentFilter}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {options.departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {archivedStates.length > 0 && (
              <Button
                variant={showArchived ? "secondary" : "outline"}
                onClick={() => setShowArchived((shown) => !shown)}
              >
                Archived ({archivedStates.length})
              </Button>
            )}
          </FilterBar>

          {visible.length === 0 ? (
            <EmptyState
              icon={Flag}
              title={
                milestones.length === 0
                  ? "No milestones yet"
                  : "No milestones match these filters"
              }
              description={
                milestones.length === 0
                  ? "The milestone register is the single place a milestone exists. Add them here, then Weekly and Monthly report against them."
                  : "Clear the search or filters to see the rest of the register."
              }
              className="py-8"
              action={
                authority.canManage && milestones.length === 0 ? (
                  <Button onClick={() => setEditing("new")}>
                    <Plus data-icon="inline-start" aria-hidden="true" />
                    Add Milestone
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Milestone</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Baseline</TableHead>
                    <TableHead>Forecast / Actual</TableHead>
                    <TableHead className="text-right">Progress</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((state) => (
                    <MilestoneRow
                      key={state.milestone.id}
                      state={state}
                      names={options.names}
                      scopeTerm={terms.singular}
                      canManage={authority.canManage}
                      canSubmit={authority.canSubmit}
                      onEdit={() => setEditing(state.milestone)}
                      onUpdate={() => setUpdating(state)}
                      onHistory={() => setViewing(state)}
                      onArchive={() => void archive(state)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="approvals" className="pt-3">
          <ApprovalQueue
            queue={queue}
            names={options.names}
            canManage={authority.canManage}
            onDecided={() => void load()}
          />
        </TabsContent>
      </Tabs>

      {editing && (
        <MilestoneFormDialog
          projectId={project.id}
          milestone={editing === "new" ? undefined : editing}
          options={options}
          scopeTerm={terms.singular}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      )}

      {updating && (
        <MilestoneUpdateDialog
          state={updating}
          options={options}
          departmentIds={
            authority.canManage ? undefined : authority.departmentIds
          }
          submittedByContactId={authority.scope?.contactId || undefined}
          onClose={() => setUpdating(undefined)}
          onSubmitted={() => {
            setUpdating(undefined);
            void load();
          }}
        />
      )}

      {viewing && (
        <MilestoneHistoryDialog
          state={viewing}
          names={options.names}
          onClose={() => setViewing(undefined)}
        />
      )}
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: React.ComponentProps<typeof StatusBadge>["tone"];
}) {
  return (
    <StatusBadge tone={tone} className="gap-2">
      <span className="tabular-nums font-semibold">{value}</span>
      {label}
    </StatusBadge>
  );
}

function MilestoneRow({
  state,
  names,
  scopeTerm,
  canManage,
  canSubmit,
  onEdit,
  onUpdate,
  onHistory,
  onArchive,
}: {
  state: MilestoneState;
  names: Record<string, string>;
  scopeTerm: string;
  canManage: boolean;
  canSubmit: boolean;
  onEdit: () => void;
  onUpdate: () => void;
  onHistory: () => void;
  onArchive: () => void;
}) {
  const { milestone } = state;
  const statusMeta = MILESTONE_STATUS_META[state.status as MilestoneStatus];

  const scope = [
    milestone.departmentId ? names[milestone.departmentId] : undefined,
    milestone.systemId ? names[milestone.systemId] : undefined,
    milestone.disciplineId
      ? `${scopeTerm}: ${names[milestone.disciplineId]}`
      : undefined,
  ].filter(Boolean);

  return (
    <TableRow>
      <TableCell className="font-medium tabular-nums">{milestone.code}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="font-medium">{milestone.name}</span>
          <StatusBadge
            tone={PRIORITY_META[milestone.priority].tone}
            hideDot
            className="text-[10px]"
          >
            {PRIORITY_META[milestone.priority].label}
          </StatusBadge>
          {state.pending.length > 0 && (
            <StatusBadge tone="warning" className="text-[10px]">
              {state.pending.length} awaiting approval
            </StatusBadge>
          )}
        </div>
        {milestone.ownerContactId && (
          <p className="text-xs text-muted-foreground">
            Owner: {names[milestone.ownerContactId] ?? "—"}
          </p>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {scope.length > 0 ? scope.join(" · ") : "Project-wide"}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {formatDate(milestone.baselineDate)}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {state.actualDate ? (
          <span className="inline-flex items-center gap-1">
            <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
            {formatDate(state.actualDate)}
          </span>
        ) : (
          formatDate(state.forecastDate)
        )}
        {typeof state.slipDays === "number" && state.slipDays > 0 && (
          <span className="ml-1 text-xs text-destructive">
            +{state.slipDays}d
          </span>
        )}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {/*
          An unreported milestone shows an em dash, never 0%. Nothing has been
          approved, and printing a number would state a fact nobody reported.
        */}
        {state.progressPercent === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          `${state.progressPercent}%`
        )}
      </TableCell>
      <TableCell>
        <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {canSubmit && milestone.active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUpdate}
              aria-label={`Submit an update for ${milestone.code}`}
            >
              <Send className="size-3.5" aria-hidden="true" />
              Update
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onHistory}
            aria-label={`History of ${milestone.code}`}
          >
            <History className="size-3.5" aria-hidden="true" />
          </Button>
          {canManage && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={onEdit}
                aria-label={`Edit ${milestone.code}`}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onArchive}
                aria-label={
                  milestone.active
                    ? `Archive ${milestone.code}`
                    : `Restore ${milestone.code}`
                }
              >
                {milestone.active ? "Archive" : "Restore"}
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
