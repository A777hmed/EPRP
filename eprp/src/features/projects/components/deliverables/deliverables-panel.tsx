"use client";

import * as React from "react";
import { FileCheck2, History, Pencil, Plus, Send } from "lucide-react";
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
import { CLIENT_REVIEW_META } from "@/lib/constants";
import { deliverableService } from "@/services/deliverable-service";
import { milestoneService } from "@/services/milestone-service";
import { projectDocumentService } from "@/services/project-document-service";
import type {
  DeliverableUpdate,
  MasterDeliverable,
  MasterMilestone,
  Project,
  ProjectDocument,
} from "@/types";
import {
  deliverableApprovalQueue,
  deliverableStates,
  summariseDeliverables,
  type DeliverableState,
} from "../../deliverable-state";
import { useHierarchyTerms } from "../../use-hierarchy-terms";
import { useMilestoneAuthority } from "../../use-milestone-authority";
import { useMilestoneScopeOptions } from "../milestones/scope-options";
import { DeliverableApprovalQueue } from "./deliverable-approval-queue";
import { DeliverableFormDialog } from "./deliverable-form-dialog";
import { DeliverableHistoryDialog } from "./deliverable-history-dialog";
import { DeliverableUpdateDialog } from "./deliverable-update-dialog";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All client statuses" },
  { value: "not_submitted", label: "Not Submitted" },
  { value: "submitted", label: "Submitted to Client" },
  { value: "under_review", label: "Under Client Review" },
  { value: "approved", label: "Client Approved" },
  { value: "approved_with_comments", label: "Approved with Comments" },
  { value: "rejected", label: "Client Rejected" },
  { value: "resubmit", label: "Resubmit Required" },
  // Not a client status — a deliverable nothing has been approved for yet.
  { value: "unreported", label: "Not yet reported" },
  { value: "awaiting", label: "Awaiting approval" },
];

/**
 * The Master Deliverable register (Phase 13.3).
 *
 * Built on the same split as the milestone register: identity is edited here by
 * Project Control, and every client-facing figure in the table is derived from
 * the latest APPROVED update by `deliverable-state.ts`.
 *
 * D6 IS VISIBLE IN THE LAYOUT, not just in the schema. The table carries a
 * "Client status" column and, separately, an "awaiting approval" marker. The two
 * never merge into one chip, because a deliverable the client has approved and a
 * report Project Control has accepted are different facts and either can be true
 * without the other.
 *
 * The Milestone column shows a REFERENCE. It reads `milestoneId` against the
 * milestone register and displays that register's own code and name — nothing is
 * copied onto the deliverable, so `master_milestones` stays the single
 * authoritative milestone source.
 */
export function DeliverablesPanel({ project }: { project: Project }) {
  const authority = useMilestoneAuthority(project);
  const options = useMilestoneScopeOptions(project);
  const terms = useHierarchyTerms(project);

  const [deliverables, setDeliverables] = React.useState<MasterDeliverable[]>(
    []
  );
  const [updates, setUpdates] = React.useState<DeliverableUpdate[]>([]);
  const [milestones, setMilestones] = React.useState<MasterMilestone[]>([]);
  const [documents, setDocuments] = React.useState<ProjectDocument[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();

  const [query, setQuery] = React.useState("");
  const [departmentFilter, setDepartmentFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [showArchived, setShowArchived] = React.useState(false);

  const [editing, setEditing] = React.useState<MasterDeliverable | "new">();
  const [updating, setUpdating] = React.useState<DeliverableState>();
  const [viewing, setViewing] = React.useState<DeliverableState>();

  const load = React.useCallback(async () => {
    setError(undefined);
    try {
      /*
       * Milestones and documents are read alongside the register because both
       * are REFERENCED by it and neither is duplicated into it — the milestone
       * column and the evidence link resolve ids against their own registers.
       */
      const [rows, stream, milestoneRows, documentRows] = await Promise.all([
        deliverableService.list(project.id),
        deliverableService.listUpdates(project.id),
        milestoneService.list(project.id),
        projectDocumentService.list(project.id),
      ]);
      setDeliverables(rows);
      setUpdates(stream);
      setMilestones(milestoneRows);
      setDocuments(documentRows.filter((document) => !document.deletedAt));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load deliverables."
      );
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, stream, milestoneRows, documentRows] = await Promise.all([
          deliverableService.list(project.id),
          deliverableService.listUpdates(project.id),
          milestoneService.list(project.id),
          projectDocumentService.list(project.id),
        ]);
        if (!active) return;
        setDeliverables(rows);
        setUpdates(stream);
        setMilestones(milestoneRows);
        setDocuments(documentRows.filter((document) => !document.deletedAt));
      } catch (cause) {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load deliverables."
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
    () => deliverableStates(deliverables, updates),
    [deliverables, updates]
  );

  const activeStates = React.useMemo(
    () => states.filter((state) => state.deliverable.active),
    [states]
  );
  const archivedStates = React.useMemo(
    () => states.filter((state) => !state.deliverable.active),
    [states]
  );
  const summary = React.useMemo(
    () => summariseDeliverables(activeStates),
    [activeStates]
  );
  const queue = React.useMemo(
    () => deliverableApprovalQueue(activeStates),
    [activeStates]
  );

  /** Milestone lookup for the reference column. Read-only, never copied. */
  const milestoneById = React.useMemo(
    () => new Map(milestones.map((milestone) => [milestone.id, milestone])),
    [milestones]
  );
  const documentById = React.useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents]
  );

  /*
   * Only active milestones are offered for NEW links, but an existing link to an
   * archived milestone is preserved in the list — otherwise editing an unrelated
   * field would silently clear the reference.
   */
  const milestoneChoices = React.useMemo(() => {
    const current =
      editing && editing !== "new" ? editing.milestoneId : undefined;
    return milestones.filter(
      (milestone) => milestone.active || milestone.id === current
    );
  }, [milestones, editing]);

  const visible = React.useMemo(() => {
    const pool = showArchived ? archivedStates : activeStates;
    const needle = query.trim().toLowerCase();
    return pool.filter((state) => {
      const { deliverable } = state;
      if (
        departmentFilter !== "all" &&
        deliverable.departmentId !== departmentFilter
      ) {
        return false;
      }
      if (statusFilter === "unreported" && state.current) return false;
      if (statusFilter === "awaiting" && state.pending.length === 0) return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "unreported" &&
        statusFilter !== "awaiting" &&
        state.clientReviewStatus !== statusFilter
      ) {
        return false;
      }
      if (!needle) return true;
      return (
        deliverable.code.toLowerCase().includes(needle) ||
        deliverable.title.toLowerCase().includes(needle) ||
        (deliverable.description ?? "").toLowerCase().includes(needle)
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

  const archive = async (state: DeliverableState) => {
    const next = !state.deliverable.active;
    try {
      await deliverableService.setActive(state.deliverable.id, next);
      toast.success(next ? "Deliverable restored." : "Deliverable archived.");
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not update the deliverable."
      );
    }
  };

  if (loading) return <LoadingState label="Loading deliverables…" />;
  if (error) return <ErrorState description={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SummaryChip label="Deliverables" value={summary.total} />
        <SummaryChip
          label="Awaiting client"
          value={summary.awaitingClient}
          tone="info"
        />
        <SummaryChip label="Accepted" value={summary.accepted} tone="success" />
        <SummaryChip label="Returned" value={summary.returned} tone="danger" />
        <SummaryChip label="Slipping" value={summary.slipping} tone="warning" />
        <SummaryChip label="Not yet reported" value={summary.unreported} />
        <SummaryChip
          label="Awaiting approval"
          value={summary.awaitingApproval}
          tone="warning"
        />

        {authority.canManage && (
          <Button className="ml-auto" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add Deliverable
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
              placeholder="Search code, title or description…"
            />
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
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
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All client statuses" />
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
              icon={FileCheck2}
              title={
                deliverables.length === 0
                  ? "No deliverables yet"
                  : "No deliverables match these filters"
              }
              description={
                deliverables.length === 0
                  ? "The deliverable register is the single place a submittable item exists. Add them here, link them to the milestones they serve, then report against them."
                  : "Clear the search or filters to see the rest of the register."
              }
              className="py-8"
              action={
                authority.canManage && deliverables.length === 0 ? (
                  <Button onClick={() => setEditing("new")}>
                    <Plus data-icon="inline-start" aria-hidden="true" />
                    Add Deliverable
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
                    <TableHead>Deliverable</TableHead>
                    <TableHead>Milestone</TableHead>
                    <TableHead>Planned</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Rev</TableHead>
                    <TableHead>Client status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((state) => (
                    <DeliverableRow
                      key={state.deliverable.id}
                      state={state}
                      milestone={
                        state.deliverable.milestoneId
                          ? milestoneById.get(state.deliverable.milestoneId)
                          : undefined
                      }
                      documentTitle={
                        state.deliverable.documentId
                          ? documentById.get(state.deliverable.documentId)?.title
                          : undefined
                      }
                      names={options.names}
                      canManage={authority.canManage}
                      canSubmit={authority.canSubmit}
                      onEdit={() => setEditing(state.deliverable)}
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
          <DeliverableApprovalQueue
            queue={queue}
            names={options.names}
            canManage={authority.canManage}
            onDecided={() => void load()}
          />
        </TabsContent>
      </Tabs>

      {editing && (
        <DeliverableFormDialog
          projectId={project.id}
          deliverable={editing === "new" ? undefined : editing}
          options={options}
          milestones={milestoneChoices}
          documents={documents}
          scopeTerm={terms.singular}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      )}

      {updating && (
        <DeliverableUpdateDialog
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
        <DeliverableHistoryDialog
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

function DeliverableRow({
  state,
  milestone,
  documentTitle,
  names,
  canManage,
  canSubmit,
  onEdit,
  onUpdate,
  onHistory,
  onArchive,
}: {
  state: DeliverableState;
  milestone?: MasterMilestone;
  documentTitle?: string;
  names: Record<string, string>;
  canManage: boolean;
  canSubmit: boolean;
  onEdit: () => void;
  onUpdate: () => void;
  onHistory: () => void;
  onArchive: () => void;
}) {
  const { deliverable } = state;
  const reviewMeta = CLIENT_REVIEW_META[state.clientReviewStatus];

  return (
    <TableRow>
      <TableCell className="font-medium tabular-nums">
        {deliverable.code}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{deliverable.title}</span>
          {/*
            The internal decision is its own marker, deliberately apart from the
            Client status column. A deliverable can be client-approved with its
            report still pending, and the screen must show both.
          */}
          {state.pending.length > 0 && (
            <StatusBadge tone="warning" className="text-[10px]">
              {state.pending.length} awaiting approval
            </StatusBadge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {deliverable.ownerContactId
            ? `Owner: ${names[deliverable.ownerContactId] ?? "—"}`
            : "Unassigned"}
          {documentTitle && ` · ${documentTitle}`}
        </p>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {milestone ? (
          <span title={milestone.name}>
            {milestone.code}
            {!milestone.active && " (archived)"}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {formatDate(deliverable.plannedSubmissionDate)}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {formatDate(state.actualSubmissionDate ?? state.forecastDate)}
        {typeof state.slipDays === "number" && state.slipDays > 0 && (
          <span className="ml-1 text-xs text-destructive">
            +{state.slipDays}d
          </span>
        )}
      </TableCell>
      <TableCell className="text-sm">{state.revision ?? "—"}</TableCell>
      <TableCell>
        <StatusBadge tone={reviewMeta.tone}>{reviewMeta.label}</StatusBadge>
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {canSubmit && deliverable.active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUpdate}
              aria-label={`Submit an update for ${deliverable.code}`}
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
            aria-label={`History of ${deliverable.code}`}
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
                aria-label={`Edit ${deliverable.code}`}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onArchive}
                aria-label={
                  deliverable.active
                    ? `Archive ${deliverable.code}`
                    : `Restore ${deliverable.code}`
                }
              >
                {deliverable.active ? "Archive" : "Restore"}
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
