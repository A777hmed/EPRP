"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, PenLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { planningService } from "@/services/planning-service";
import type {
  PlanningActivity,
  PlanningImportBatch,
  PlanningImportRow,
  PlanningSnapshotActivity,
} from "@/types";

interface ReviewRow {
  importRow: PlanningImportRow;
  existingActivity?: PlanningActivity;
  previousSnapshotActivity?: PlanningSnapshotActivity | null;
}

function num(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
function text(raw: unknown): string | undefined {
  return raw === null || raw === undefined || raw === "" ? undefined : String(raw);
}

/**
 * Planning Review for one Draft Import Batch.
 *
 * Raw import rows are never touched here — confirming or adjusting a row
 * writes planning_activities and logs the decision to
 * planning_confirmations. "Reason is required when changing an imported
 * value": Confirm auto-fills a reason ("Confirmed as imported"); Adjust
 * requires one to be typed.
 *
 * Weekly/Monthly comparison is shown at PROJECT level only
 * (`projectPlannedProgress`/`projectActualProgress`) — activity-level Weekly/
 * Monthly figures do not exist in this schema, and the brief is explicit
 * that they must not be fabricated.
 */
export function PlanningReviewPanel({
  projectId,
  batch,
  projectPlannedProgress,
  projectActualProgress,
  canManage,
  onConfirmed,
}: {
  projectId: string;
  batch: PlanningImportBatch;
  projectPlannedProgress?: number;
  projectActualProgress?: number;
  canManage: boolean;
  onConfirmed: () => void;
}) {
  const [rows, setRows] = React.useState<ReviewRow[] | undefined>();
  const [adjusting, setAdjusting] = React.useState<ReviewRow | null>(null);

  const load = React.useCallback(() => {
    void Promise.all([
      planningService.listImportRows(batch.id),
      planningService.listActivities(projectId),
    ]).then(async ([importRows, activities]) => {
      const byExternalId = new Map(activities.filter((a) => a.externalId).map((a) => [a.externalId, a]));
      const withPrevious = await Promise.all(
        importRows.map(async (importRow) => ({
          importRow,
          existingActivity: importRow.externalId ? byExternalId.get(importRow.externalId) : undefined,
          previousSnapshotActivity: importRow.externalId
            ? await planningService.getPreviousSnapshotActivity(projectId, importRow.externalId)
            : null,
        }))
      );
      setRows(withPrevious);
    });
  }, [batch.id, projectId]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (rows === undefined) {
    return <LoadingState variant="table" label="Loading the batch for review…" />;
  }

  const confirmedCount = rows.filter((r) => r.existingActivity).length;

  const confirmAsImported = async (row: ReviewRow) => {
    try {
      const raw = row.importRow.rawData;
      const patch = {
        work_item_id: null,
        planned_start_date: text(raw.currentStart) ?? null,
        planned_finish_date: text(raw.currentFinish) ?? null,
        baseline_start_date: text(raw.baselineStart) ?? null,
        baseline_finish_date: text(raw.baselineFinish) ?? null,
        actual_start_date: text(raw.actualStart) ?? null,
        actual_finish_date: text(raw.actualFinish) ?? null,
        planned_duration_days: num(raw.originalDuration) ?? null,
        remaining_duration_days: num(raw.remainingDuration) ?? null,
        percent_complete_planned: num(raw.plannedPercent) ?? null,
        percent_complete_actual: num(raw.actualPercent) ?? null,
        percent_complete_physical: num(raw.physicalPercent) ?? null,
        weight_percent: num(raw.weightPercent) ?? null,
        status: text(raw.status) ?? null,
        planned_value: num(raw.plannedValue) ?? null,
        earned_value: num(raw.earnedValue) ?? null,
        is_milestone: Boolean(raw.isMilestone),
      };

      let activity = row.existingActivity;
      if (!activity) {
        activity = await planningService.createActivity(
          projectId,
          {
            externalId: row.importRow.externalId,
            code: row.importRow.externalId,
            name: row.importRow.name ?? row.importRow.externalId ?? "Untitled activity",
            isMilestone: Boolean(raw.isMilestone),
            plannedStartDate: text(raw.currentStart),
            plannedFinishDate: text(raw.currentFinish),
            baselineStartDate: text(raw.baselineStart),
            baselineFinishDate: text(raw.baselineFinish),
            actualStartDate: text(raw.actualStart),
            actualFinishDate: text(raw.actualFinish),
            plannedDurationDays: num(raw.originalDuration),
            remainingDurationDays: num(raw.remainingDuration),
            percentCompletePlanned: num(raw.plannedPercent),
            percentCompleteActual: num(raw.actualPercent),
            percentCompletePhysical: num(raw.physicalPercent),
            weightPercent: num(raw.weightPercent),
            status: text(raw.status),
            plannedValue: num(raw.plannedValue),
            earnedValue: num(raw.earnedValue),
          },
          row.importRow.id
        );
      }

      await planningService.confirmActivityField({
        activityId: activity.id,
        fieldName: "row",
        previousValue: null,
        newValue: JSON.stringify(patch),
        action: "confirm",
        reason: "Confirmed as imported.",
        patch,
        importRowId: row.importRow.id,
      });
      toast.success(`${row.importRow.externalId ?? "Row"} confirmed.`);
      onConfirmed();
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not confirm the row.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-3 text-xs">
        <p className="font-medium">Project-level reported progress (latest on record)</p>
        <p className="text-muted-foreground text-pretty">
          Planned {projectPlannedProgress ?? "—"}% · Actual {projectActualProgress ?? "—"}%.
          Weekly/Monthly report project and department progress, not
          individual activities — an activity-level Weekly/Monthly figure
          does not exist and is not shown here.
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge tone={confirmedCount === rows.length ? "success" : "neutral"}>
          {confirmedCount} of {rows.length} confirmed
        </StatusBadge>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Activity ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Imported Planned %</TableHead>
              <TableHead>Previous Snapshot %</TableHead>
              <TableHead>Difference</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const imported = num(row.importRow.rawData.plannedPercent);
              const previous = row.previousSnapshotActivity?.percentCompletePlanned;
              const diff = imported !== undefined && previous !== undefined ? imported - previous : undefined;
              return (
                <TableRow key={row.importRow.id}>
                  <TableCell className="font-mono text-xs">{row.importRow.externalId ?? "—"}</TableCell>
                  <TableCell className="text-xs">{row.importRow.name ?? "—"}</TableCell>
                  <TableCell className="text-xs tabular-nums">{imported ?? "—"}</TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {previous ?? "No prior snapshot"}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {diff === undefined ? "—" : diff === 0 ? "No change" : (diff > 0 ? "+" : "") + diff}
                  </TableCell>
                  <TableCell>
                    {row.importRow.parseStatus === "error" ? (
                      <Badge variant="destructive" className="text-[0.65rem]">Error</Badge>
                    ) : row.importRow.parseStatus === "warning" ? (
                      <Badge variant="outline" className="text-[0.65rem] text-warning border-warning/40">Warning</Badge>
                    ) : row.existingActivity ? (
                      <Badge variant="outline" className="gap-1 text-[0.65rem] text-success border-success/40">
                        <CheckCircle2 className="size-3" aria-hidden="true" /> Confirmed
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[0.65rem]">Pending</Badge>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={row.importRow.parseStatus === "error"}
                        onClick={() => void confirmAsImported(row)}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={row.importRow.parseStatus === "error"}
                        onClick={() => setAdjusting(row)}
                      >
                        <PenLine className="size-3.5" aria-hidden="true" />
                        Adjust
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {rows.length === 0 && (
        <EmptyState
          icon={AlertTriangle}
          title="No rows in this batch"
          description="Nothing was saved for this import."
          className="py-10"
        />
      )}

      {adjusting && (
        <AdjustRowDialog
          projectId={projectId}
          row={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            onConfirmed();
            load();
          }}
        />
      )}
    </div>
  );
}

function AdjustRowDialog({
  projectId,
  row,
  onClose,
  onSaved,
}: {
  projectId: string;
  row: ReviewRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const importedPlanned = num(row.importRow.rawData.plannedPercent);
  const [plannedPercent, setPlannedPercent] = React.useState(
    importedPlanned === undefined ? "" : String(importedPlanned)
  );
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const valid = reason.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const raw = row.importRow.rawData;
      const adjustedPercent = plannedPercent === "" ? null : Number(plannedPercent);
      const patch = {
        planned_start_date: text(raw.currentStart) ?? null,
        planned_finish_date: text(raw.currentFinish) ?? null,
        baseline_start_date: text(raw.baselineStart) ?? null,
        baseline_finish_date: text(raw.baselineFinish) ?? null,
        percent_complete_planned: adjustedPercent,
        status: text(raw.status) ?? null,
      };

      let activity = row.existingActivity;
      if (!activity) {
        activity = await planningService.createActivity(
          projectId,
          {
            externalId: row.importRow.externalId,
            code: row.importRow.externalId,
            name: row.importRow.name ?? row.importRow.externalId ?? "Untitled activity",
            plannedStartDate: text(raw.currentStart),
            plannedFinishDate: text(raw.currentFinish),
          },
          row.importRow.id
        );
      }

      await planningService.confirmActivityField({
        activityId: activity.id,
        fieldName: "plannedPercent",
        previousValue: importedPlanned === undefined ? null : String(importedPlanned),
        newValue: adjustedPercent === null ? null : String(adjustedPercent),
        action: "adjust",
        reason: reason.trim(),
        patch,
        importRowId: row.importRow.id,
      });
      toast.success(`${row.importRow.externalId ?? "Row"} adjusted.`);
      onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the adjustment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust {row.importRow.externalId}</DialogTitle>
          <DialogDescription>
            The raw imported value is never overwritten — this records what
            Planning confirmed instead, with a reason.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="adjust-planned">Imported Planned %</Label>
            <Input id="adjust-imported" value={importedPlanned ?? "—"} disabled />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adjust-planned">Confirmed Planned %</Label>
            <Input
              id="adjust-planned"
              inputMode="decimal"
              value={plannedPercent}
              onChange={(event) => setPlannedPercent(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adjust-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="adjust-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why the confirmed value differs from what was imported."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            {saving ? "Saving…" : "Save Adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
