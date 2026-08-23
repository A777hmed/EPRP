"use client";

import * as React from "react";
import {
  CircleCheck,
  Flag,
  History,
  Pencil,
  Plus,
  Scale,
  Send,
} from "lucide-react";
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
import { formatDate, formatNumber } from "@/lib/formatters";
import {
  MILESTONE_PAYMENT_STATUS_META,
  MILESTONE_STATUS_META,
  MILESTONE_TYPE_META,
  PRIORITY_META,
} from "@/lib/constants";
import { milestoneService } from "@/services/milestone-service";
import type {
  MasterMilestone,
  MilestoneStatus,
  MilestoneUpdate,
  Project,
} from "@/types";
import { deliverableService } from "@/services/deliverable-service";
import {
  deliverableStates,
  forMilestone,
  type DeliverableState,
} from "../../deliverable-state";
import {
  approvalQueue,
  milestoneStates,
  reconciliationQueue,
  registerProgress,
  summarise,
  type CutoffState,
  type MilestoneState,
} from "../../milestone-state";
import { MilestoneReconcileDialog } from "./milestone-reconcile-dialog";
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

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "technical", label: MILESTONE_TYPE_META.technical.label },
  { value: "contractual", label: MILESTONE_TYPE_META.contractual.label },
  { value: "commercial", label: MILESTONE_TYPE_META.commercial.label },
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
  const [deliverables, setDeliverables] = React.useState<DeliverableState[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();

  const [query, setQuery] = React.useState("");
  const [departmentFilter, setDepartmentFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [showArchived, setShowArchived] = React.useState(false);

  const [editing, setEditing] = React.useState<MasterMilestone | "new">();
  const [updating, setUpdating] = React.useState<MilestoneState>();
  const [viewing, setViewing] = React.useState<MilestoneState>();
  const [reconciling, setReconciling] = React.useState<{
    state: MilestoneState;
    cutoff: CutoffState;
  }>();

  /*
   * Deliverables are read alongside the register because the relationship runs
   * from the deliverable to the milestone — the milestone row itself holds no
   * link, by design, so the only way to answer "what serves this milestone?" is
   * to have the deliverables in hand. Nothing about them is copied onto a
   * milestone; the register stays the single milestone source.
   */
  const load = React.useCallback(async () => {
    setError(undefined);
    try {
      const [rows, stream, deliverableRows, deliverableStream] =
        await Promise.all([
          milestoneService.list(project.id),
          milestoneService.listUpdates(project.id),
          deliverableService.list(project.id),
          deliverableService.listUpdates(project.id),
        ]);
      setMilestones(rows);
      setUpdates(stream);
      setDeliverables(deliverableStates(deliverableRows, deliverableStream));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load milestones."
      );
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  /*
   * The fetch is wrapped rather than awaited directly: an effect body that
   * calls setState synchronously triggers cascading renders, and the lint rule
   * that enforces this is the reason the initial load is written this way
   * rather than simply calling `load()`.
   */
  React.useEffect(() => {
    let active = true;
    void (async () => {
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

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
  /*
   * Cut-offs where two sources disagree and nobody has adjudicated. A separate
   * list from the approval queue on purpose: that one asks "do we accept this
   * report", this one asks "which report is right". Different decisions.
   */
  const conflicts = React.useMemo(
    () => reconciliationQueue(activeStates),
    [activeStates]
  );
  /*
   * Two progress figures, never one. Commercial milestones are excluded from
   * the physical measure entirely — an advance payment is money received, not
   * work delivered, and adding it would let a 100% contract read as 110%.
   */
  const progress = React.useMemo(
    () => registerProgress(activeStates),
    [activeStates]
  );

  /*
   * id → code, so a dependency renders as the code a planner actually knows.
   * Built from the whole register, archived included: an archived predecessor
   * must still resolve rather than showing a bare uuid.
   */
  const codes = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const milestone of milestones) map[milestone.id] = milestone.code;
    return map;
  }, [milestones]);

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
      if (typeFilter !== "all" && milestone.type !== typeFilter) return false;
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
        (milestone.category ?? "").toLowerCase().includes(needle) ||
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
    typeFilter,
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
        {summary.inConflict > 0 && (
          <SummaryChip
            label="Unreconciled conflicts"
            value={summary.inConflict}
            tone="danger"
          />
        )}
        {summary.awaitingClient > 0 && (
          <SummaryChip
            label="Awaiting client"
            value={summary.awaitingClient}
            tone="warning"
          />
        )}
        {summary.commercial > 0 && (
          <SummaryChip
            label="Payment outstanding"
            value={summary.paymentOutstanding}
            tone="warning"
          />
        )}

        {authority.canManage && (
          <Button className="ml-auto" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add Milestone
          </Button>
        )}
      </div>

      {/*
        The two measures, side by side and labelled. Presenting them apart is
        the whole point: an advance payment moves the commercial number and must
        never move the physical one.
      */}
      {(progress.physicalPercent !== undefined ||
        progress.commercialPercent !== undefined ||
        progress.outstandingAdvance !== undefined) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <ProgressCard
            label="Physical progress"
            value={progress.physicalPercent}
            note={
              progress.physicalPercent === undefined
                ? "No weighted milestone has an approved figure yet."
                : `Weighted over milestones carrying a weight · ${Math.round(progress.physicalCoverage)}% of that weight reported`
            }
          />
          <ProgressCard
            label="Commercial progress"
            value={progress.commercialPercent}
            note={
              progress.commercialPercent === undefined
                ? "No payment milestone carries a payment share yet."
                : "Payment received, weighted by payment share. Never added to physical progress."
            }
          />
          <ProgressCard
            label="Outstanding advance"
            amount={progress.outstandingAdvance}
            note={
              progress.outstandingAdvance === undefined
                ? "No advance payment with an agreed amount."
                : "Advance still to be recovered from later certificates."
            }
          />
        </div>
      )}

      {/*
        Surfacing the discrepancy, which is the whole point of refusing to pick
        a winner. Named at register level so it is seen without opening a row,
        and worded as an owed decision rather than an error.
      */}
      {conflicts.length > 0 && (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-destructive">
            <Scale className="size-4" aria-hidden="true" />
            {conflicts.length} cut-off{conflicts.length === 1 ? "" : "s"} need
            {conflicts.length === 1 ? "s" : ""} reconciliation
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Two sources reported different progress for the same cut-off. Until
            Project Control resolves each one, those milestones have no official
            figure — and nothing is being used in its place.
          </p>
          <ul className="mt-2 space-y-1">
            {conflicts.slice(0, 5).map(({ milestone, cutoff }) => (
              <li
                key={`${milestone.id}-${cutoff.asOfDate}`}
                className="text-sm tabular-nums"
              >
                <span className="font-medium">{milestone.code}</span>{" "}
                <span className="text-muted-foreground">
                  as of {formatDate(cutoff.asOfDate)} —{" "}
                  {cutoff.reportedValues.join("% vs ")}%
                </span>
              </li>
            ))}
            {conflicts.length > 5 && (
              <li className="text-xs text-muted-foreground">
                and {conflicts.length - 5} more.
              </li>
            )}
          </ul>
        </div>
      )}

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
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                {TYPE_FILTERS.map((filter) => (
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
                    <TableHead>Planned</TableHead>
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
                      codes={codes}
                      linked={forMilestone(deliverables, state.milestone.id)}
                      scopeTerm={terms.singular}
                      canManage={authority.canManage}
                      canSubmit={authority.canSubmit}
                      canReconcile={authority.canReconcile}
                      onEdit={() => setEditing(state.milestone)}
                      onUpdate={() => setUpdating(state)}
                      onReconcile={() => {
                        // The newest disputed cut-off: the one management is
                        // actually being asked about.
                        const [cutoff] = state.conflicts;
                        if (cutoff) setReconciling({ state, cutoff });
                      }}
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
          register={milestones}
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

      {reconciling && (
        <MilestoneReconcileDialog
          state={reconciling.state}
          cutoff={reconciling.cutoff}
          names={options.names}
          reconciledByContactId={authority.scope?.contactId || undefined}
          onClose={() => setReconciling(undefined)}
          onReconciled={() => {
            setReconciling(undefined);
            void load();
          }}
        />
      )}

      {viewing && (
        <MilestoneHistoryDialog
          state={viewing}
          names={options.names}
          linked={forMilestone(deliverables, viewing.milestone.id)}
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

/**
 * One measure, presented on its own.
 *
 * Physical and commercial progress get identical cards deliberately — they are
 * peers, not a headline and a footnote, and neither may be read as the other.
 */
function ProgressCard({
  label,
  value,
  amount,
  note,
}: {
  label: string;
  value?: number;
  amount?: number;
  note: string;
}) {
  const shown = value ?? amount;
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">
        {shown === undefined ? (
          <span className="text-base font-normal text-muted-foreground">
            Not measured
          </span>
        ) : value !== undefined ? (
          `${Math.round(value)}%`
        ) : (
          formatNumber(Math.round(shown))
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function MilestoneRow({
  state,
  names,
  codes,
  linked,
  scopeTerm,
  canManage,
  canSubmit,
  canReconcile,
  onEdit,
  onUpdate,
  onReconcile,
  onHistory,
  onArchive,
}: {
  state: MilestoneState;
  names: Record<string, string>;
  /** Milestone id → code, for rendering the dependency. */
  codes: Record<string, string>;
  /** Deliverables serving this milestone. The link lives on their side. */
  linked: DeliverableState[];
  scopeTerm: string;
  canManage: boolean;
  canSubmit: boolean;
  /** May declare the official figure for a disputed cut-off (13.2d). */
  canReconcile: boolean;
  onEdit: () => void;
  onUpdate: () => void;
  onReconcile: () => void;
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
          {/*
            Kept apart from the approval marker above: "awaiting approval" means
            nobody has accepted a report yet, "sources disagree" means two
            accepted reports contradict each other. Merging them would hide
            which decision is actually owed.
          */}
          {state.inConflict && (
            <StatusBadge tone="danger" className="text-[10px]">
              Sources disagree
            </StatusBadge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{MILESTONE_TYPE_META[milestone.type].label}</span>
          {milestone.category && <span>· {milestone.category}</span>}
          {milestone.ownerContactId && (
            <span>· Owner: {names[milestone.ownerContactId] ?? "—"}</span>
          )}
          {milestone.predecessorMilestoneId && (
            <span>
              · After {codes[milestone.predecessorMilestoneId] ?? "another milestone"}
            </span>
          )}
          {milestone.weightPercent !== undefined && (
            <span>· Weight {milestone.weightPercent}%</span>
          )}
          {linked.length > 0 && (
            <span>
              · {linked.length} deliverable{linked.length === 1 ? "" : "s"}
              {linked.filter((item) => item.accepted).length > 0 &&
                ` (${linked.filter((item) => item.accepted).length} accepted)`}
            </span>
          )}
        </div>
        {/*
          Payment position sits on its own line and is never merged into the
          Status column: money received is not work delivered.
        */}
        {state.commercial && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {milestone.isAdvancePayment && (
              <StatusBadge tone="warning" hideDot className="text-[10px]">
                Advance
              </StatusBadge>
            )}
            <StatusBadge
              tone={
                state.paymentStatus
                  ? MILESTONE_PAYMENT_STATUS_META[state.paymentStatus].tone
                  : "neutral"
              }
              className="text-[10px]"
            >
              Payment:{" "}
              {state.paymentStatus
                ? MILESTONE_PAYMENT_STATUS_META[state.paymentStatus].label
                : "Not reported"}
            </StatusBadge>
            {milestone.paymentPercent !== undefined && (
              <span className="text-xs text-muted-foreground">
                {milestone.paymentPercent}% of contract value
              </span>
            )}
            {state.outstandingAdvance !== undefined && (
              <span className="text-xs text-muted-foreground">
                · {formatNumber(Math.round(state.outstandingAdvance))} outstanding
              </span>
            )}
          </div>
        )}
        {milestone.clientApprovalRequired && (
          <p className="mt-1 text-xs text-muted-foreground">
            Client approval required
            {state.clientApprovalStatus
              ? ` · ${state.clientApprovalStatus === "approved" ? "approved" : state.clientApprovalStatus === "rejected" ? "rejected" : "awaiting client"}`
              : " · not yet reported"}
          </p>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {scope.length > 0 ? scope.join(" · ") : "Project-wide"}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {formatDate(milestone.plannedDate)}
        {/*
          Variance against the PLAN, shown next to the plan. `slipDays` below
          measures against the baseline, and the two are kept apart: a
          re-planned milestone can be on plan and behind baseline at once.
        */}
        {typeof state.varianceDays === "number" && state.varianceDays > 0 && (
          <span className="ml-1 text-xs text-warning">
            +{state.varianceDays}d
          </span>
        )}
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
          // An em dash for "nothing approved", but a named state when the
          // reason is a conflict — a reader must not mistake "we cannot say"
          // for "nobody reported".
          <span className="text-muted-foreground">
            {state.inConflict ? (
              <span className="text-destructive">unresolved</span>
            ) : (
              "—"
            )}
          </span>
        ) : (
          `${state.progressPercent}%`
        )}
        {milestone.plannedProgressPercent !== undefined && (
          <div className="text-xs text-muted-foreground">
            plan {milestone.plannedProgressPercent}%
            {typeof state.progressVariance === "number" && (
              <span
                className={
                  state.progressVariance < 0 ? "ml-1 text-destructive" : "ml-1 text-success"
                }
              >
                {state.progressVariance > 0 ? "+" : ""}
                {state.progressVariance}
              </span>
            )}
          </div>
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
          {canReconcile && state.inConflict && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onReconcile}
              aria-label={`Reconcile the disputed cut-off on ${milestone.code}`}
            >
              <Scale className="size-3.5" aria-hidden="true" />
              Reconcile
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
