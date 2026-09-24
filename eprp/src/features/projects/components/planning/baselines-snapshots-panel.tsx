"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, History, Rocket } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { getContactById, useMasterData } from "@/features/master-data";
import { planningService } from "@/services/planning-service";
import type {
  PlanningBaseline,
  PlanningImportBatch,
  PlanningOpeningPosition,
  PlanningSnapshot,
  Project,
  ProjectPlanningSettings,
} from "@/types";
import { OpeningPositionDialog } from "./opening-position-dialog";

const NONE = "none";

type PlanningSnapshotSummary = PlanningSnapshot;

function activityCountOf(snapshot: PlanningSnapshot): number | undefined {
  const data = snapshot.snapshotData;
  if (data && typeof data === "object" && "activities" in data) {
    const activities = (data as { activities?: unknown }).activities;
    if (Array.isArray(activities)) return activities.length;
  }
  return undefined;
}

export function BaselinesSnapshotsPanel({
  project,
  canManage,
}: {
  project: Project;
  canManage: boolean;
}) {
  const [snapshots, setSnapshots] = React.useState<PlanningSnapshot[] | undefined>();
  const [baselines, setBaselines] = React.useState<PlanningBaseline[] | undefined>();
  const [settings, setSettings] = React.useState<ProjectPlanningSettings | null | undefined>();
  const [openingPosition, setOpeningPosition] = React.useState<
    PlanningOpeningPosition | null | undefined
  >();
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [openingFormOpen, setOpeningFormOpen] = React.useState(false);

  const load = React.useCallback(() => {
    void planningService.listSnapshots(project.id).then(setSnapshots);
    void planningService.listBaselines(project.id).then(setBaselines);
    void planningService.getSettings(project.id).then(setSettings);
    void planningService.getDraftOpeningPosition(project.id).then(setOpeningPosition);
  }, [project.id]);

  React.useEffect(() => load(), [load]);

  if (snapshots === undefined || settings === undefined || openingPosition === undefined) {
    return <LoadingState variant="table" label="Loading snapshots…" />;
  }

  const needsOpening =
    settings?.onboardingMode === "existing_active_project" && snapshots.length === 0;

  const promoteOpening = async () => {
    if (!openingPosition) return;
    try {
      const id = await planningService.publishSnapshot({
        projectId: project.id,
        openingPositionId: openingPosition.id,
      });
      toast.success(`Opening Position promoted as Snapshot V1 (${id.slice(0, 8)}).`);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not promote the Opening Position.");
    }
  };

  return (
    <div className="space-y-4">
      {needsOpening && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm font-medium">Opening Position needed</p>
          <p className="text-xs text-muted-foreground text-pretty">
            This project is onboarded mid-execution. Do not invent historical
            S-curve data — declare one honest starting position as of a data
            date instead of a fabricated from-zero history.
          </p>
          {openingPosition ? (
            <div className="mt-2 space-y-2 text-xs">
              <p>
                Draft as of {formatDate(openingPosition.dataDate)} · Planned{" "}
                {openingPosition.plannedProgressPercent ?? "—"}% · Actual{" "}
                {openingPosition.actualProgressPercent ?? "—"}% · Source: {openingPosition.source}
              </p>
              {canManage && (
                <Button size="sm" onClick={() => void promoteOpening()}>
                  <Rocket data-icon="inline-start" aria-hidden="true" />
                  Promote as Snapshot V1
                </Button>
              )}
            </div>
          ) : (
            canManage && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpeningFormOpen(true)}>
                Declare Opening Position
              </Button>
            )
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Published Snapshots</h3>
        {canManage && !needsOpening && (
          <Button size="sm" onClick={() => setPublishOpen(true)}>
            <Rocket data-icon="inline-start" aria-hidden="true" />
            Publish Snapshot
          </Button>
        )}
      </div>

      {snapshots.length === 0 ? (
        <EmptyState
          icon={History}
          title="No snapshots published yet"
          description="The Published Planning Snapshot becomes the source of truth Weekly and Monthly report against."
          className="py-8"
        />
      ) : (
        <ul className="space-y-2">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  v{snapshot.version}
                  {snapshot.label ? ` — ${snapshot.label}` : ""}
                  {snapshot.isOpeningSnapshot && (
                    <StatusBadge tone="info" className="ml-2">Opening</StatusBadge>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  Published {formatDateTime(snapshot.publishedAt)}
                  {activityCountOf(snapshot) !== undefined && ` · ${activityCountOf(snapshot)} activities`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Baselines</h3>
        {(baselines ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No baselines captured yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {(baselines ?? []).map((baseline) => (
              <li key={baseline.id} className="flex items-center justify-between rounded-lg border p-2 text-xs">
                <span>{baseline.name}</span>
                <span className="text-muted-foreground tabular-nums">{formatDate(baseline.baselineDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openingFormOpen && (
        <OpeningPositionDialog
          projectId={project.id}
          onClose={() => setOpeningFormOpen(false)}
          onSaved={() => {
            setOpeningFormOpen(false);
            load();
          }}
        />
      )}

      {publishOpen && (
        <PublishSnapshotDialog
          project={project}
          baselines={baselines ?? []}
          onClose={() => setPublishOpen(false)}
          onPublished={() => {
            setPublishOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function PublishSnapshotDialog({
  project,
  baselines,
  onClose,
  onPublished,
}: {
  project: Project;
  baselines: PlanningBaseline[];
  onClose: () => void;
  onPublished: () => void;
}) {
  const [batches, setBatches] = React.useState<PlanningImportBatch[]>([]);
  const [workItemCount, setWorkItemCount] = React.useState<number | null>(null);
  const [activityCount, setActivityCount] = React.useState<number | null>(null);
  const [batchId, setBatchId] = React.useState<string>(NONE);
  const [baselineId, setBaselineId] = React.useState<string>(NONE);
  const [label, setLabel] = React.useState("");
  const [manualDataDate, setManualDataDate] = React.useState("");
  const [publishing, setPublishing] = React.useState(false);
  const [published, setPublished] = React.useState<PlanningSnapshotSummary | null>(null);
  useMasterData("contact");

  React.useEffect(() => {
    void planningService.listImportBatches(project.id).then((all) =>
      setBatches(all.filter((b) => b.status === "validated"))
    );
    void planningService.listWorkItems(project.id).then((items) => setWorkItemCount(items.length));
    void planningService.listActivities(project.id).then((items) => setActivityCount(items.length));
  }, [project.id]);

  const isManual = batchId === NONE;

  const publish = async () => {
    setPublishing(true);
    try {
      const id = await planningService.publishSnapshot({
        projectId: project.id,
        importBatchId: isManual ? undefined : batchId,
        baselineId: baselineId === NONE ? undefined : baselineId,
        label: label.trim() || undefined,
        dataDate: isManual ? manualDataDate : undefined,
      });
      const created = await planningService.listSnapshots(project.id);
      setPublished(created.find((s) => s.id === id) ?? null);
      toast.success("Planning Snapshot published.");
      onPublished();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not publish the snapshot.");
    } finally {
      setPublishing(false);
    }
  };

  const selectedBatch = batches.find((b) => b.id === batchId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish Planning Snapshot</DialogTitle>
          <DialogDescription>
            Captures the current Master Plan and activities as one immutable,
            versioned snapshot. Weekly and Monthly will link to it once
            published.
          </DialogDescription>
        </DialogHeader>

        {published ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-8 text-success" aria-hidden="true" />
            <p className="text-sm font-medium">Snapshot v{published.version} published.</p>
            <p className="text-xs text-muted-foreground">
              {published.label ? `${published.label} · ` : ""}
              Published {formatDateTime(published.publishedAt)}
              {published.publishedByContactId &&
                ` by ${getContactById(published.publishedByContactId)?.name ?? "—"}`}
              .
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pub-batch">Source import batch (optional)</Label>
                <Select value={batchId} onValueChange={setBatchId}>
                  <SelectTrigger id="pub-batch">
                    <SelectValue placeholder="Manual / current Master Plan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Manual / current Master Plan</SelectItem>
                    {batches.map((batch) => (
                      <SelectItem key={batch.id} value={batch.id}>
                        {batch.fileName ?? batch.sourceType} · {batch.rowCount} rows
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isManual && (
                <div className="grid gap-1.5">
                  <Label htmlFor="pub-data-date">
                    Data Date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="pub-data-date"
                    type="date"
                    value={manualDataDate}
                    onChange={(e) => setManualDataDate(e.target.value)}
                    className="max-w-48"
                  />
                  <p className="text-xs text-muted-foreground text-pretty">
                    The schedule position this snapshot reports as of —
                    required when publishing manually. An import batch
                    already carries its own Data Date.
                  </p>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="pub-baseline">Baseline (optional)</Label>
                <Select value={baselineId} onValueChange={setBaselineId}>
                  <SelectTrigger id="pub-baseline">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {baselines.map((baseline) => (
                      <SelectItem key={baseline.id} value={baseline.id}>
                        {baseline.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pub-label">Label (optional)</Label>
                <Input id="pub-label" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-3 text-xs space-y-1">
              <p className="font-medium">Before you publish</p>
              <p>Source: {selectedBatch ? selectedBatch.sourceType : "Manual / current Master Plan"}</p>
              {selectedBatch?.fileName && <p>File: {selectedBatch.fileName}</p>}
              <p>
                Data Date:{" "}
                {selectedBatch
                  ? (selectedBatch.dataDate ?? "missing — this batch cannot be published")
                  : (manualDataDate || "required — enter one above")}
              </p>
              <p>Work items: {workItemCount ?? "…"} · Activities: {activityCount ?? "…"}</p>
              <p>
                Project summary (as recorded): Planned {project.plannedProgress}% · Actual{" "}
                {project.actualProgress}%
              </p>
              <p className="text-muted-foreground">
                Only what has actually been confirmed is published — nothing
                here is calculated or fabricated for this preview.
              </p>
            </div>
          </>
        )}

        <DialogFooter>
          {published ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={publishing}>
                Cancel
              </Button>
              <Button
                onClick={() => void publish()}
                disabled={
                  publishing ||
                  (isManual ? !manualDataDate : !selectedBatch?.dataDate)
                }
                title={
                  isManual && !manualDataDate
                    ? "Enter a Data Date first"
                    : !isManual && !selectedBatch?.dataDate
                      ? "This import batch has no Data Date — re-import or contact Project Control"
                      : undefined
                }
              >
                {publishing ? "Publishing…" : "Publish Snapshot"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
