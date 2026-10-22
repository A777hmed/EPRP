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
import { ConfirmDialog, EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { Checkbox } from "@/components/ui/checkbox";
import {
  setupGovernanceService,
  type SetupControlState,
} from "@/services/setup-governance-service";
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
import { useReturnRefresh } from "../../use-return-refresh";

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

/** 13.9B: the first-anchor confirmation, word for word (`07` §10.12). */
export const FIRST_ANCHOR_CONFIRMATION =
  "Publishing the first governed Planning Snapshot will make Project Setup Controlled. " +
  "Core Project Setup configuration will require amendments afterward.";

/**
 * Baselines & Snapshots — and, since 13.9A, the ONLY place an Opening
 * Position is declared or promoted (Project Setup no longer offers it).
 *
 * 13.9B: the FIRST governed anchor (the project is not yet Controlled) asks
 * for explicit confirmation before `confirmSetupControl` is sent; later
 * snapshots do not. A no-formal-schedule project offers neither Publish nor
 * Promote — the database refuses both.
 */
export function BaselinesSnapshotsPanel({
  project,
  canManage,
  onChanged,
}: {
  project: Project;
  canManage: boolean;
  /** Told after a publish / Opening Position change, so the workspace header refreshes. */
  onChanged?: () => void;
}) {
  const [snapshots, setSnapshots] = React.useState<PlanningSnapshot[] | undefined>();
  const [baselines, setBaselines] = React.useState<PlanningBaseline[] | undefined>();
  const [settings, setSettings] = React.useState<ProjectPlanningSettings | null | undefined>();
  const [openingPosition, setOpeningPosition] = React.useState<
    PlanningOpeningPosition | null | undefined
  >();
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [openingFormOpen, setOpeningFormOpen] = React.useState(false);
  const [control, setControl] = React.useState<SetupControlState | undefined>();
  const [promoteConfirmOpen, setPromoteConfirmOpen] = React.useState(false);

  const load = React.useCallback(() => {
    void planningService.listSnapshots(project.id).then(setSnapshots);
    void planningService.listBaselines(project.id).then(setBaselines);
    void planningService.getSettings(project.id).then(setSettings);
    void planningService.getDraftOpeningPosition(project.id).then(setOpeningPosition);
    void setupGovernanceService.getControlState(project.id).then(setControl).catch(() => setControl(undefined));
  }, [project.id]);

  // 13.11 UAT: re-read on return to the tab (a Planning Approach approved elsewhere).
  const returned = useReturnRefresh();
  React.useEffect(() => load(), [load, returned]);

  if (snapshots === undefined || settings === undefined || openingPosition === undefined) {
    return <LoadingState variant="table" label="Loading snapshots…" />;
  }

  const needsOpening =
    settings?.onboardingMode === "existing_active_project" && snapshots.length === 0;
  const noFormalSchedule = settings?.onboardingMode === "no_formal_schedule";
  // Unknown control state is treated as "first anchor": asking once too often
  // is harmless, publishing without the confirmation is refused anyway.
  const firstAnchor = !control?.controlledSince;

  const promoteOpening = async (confirmed: boolean) => {
    if (!openingPosition) return;
    try {
      const id = await planningService.publishSnapshot({
        projectId: project.id,
        openingPositionId: openingPosition.id,
        confirmSetupControl: confirmed,
      });
      toast.success(`Opening Position promoted as Snapshot V1 (${id.slice(0, 8)}).`);
      load();
      onChanged?.();
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
                <Button size="sm" onClick={() => (firstAnchor ? setPromoteConfirmOpen(true) : void promoteOpening(false))}>
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

      {noFormalSchedule && (
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground text-pretty">
          This project is planned without a formal schedule, so no Planning Snapshot is published and no Opening
          Position is promoted. Its progress is Reported — not planning governed. To bring it under planning
          control, change how it is planned in Project Setup (an approved amendment once Setup is controlled).
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Published Snapshots</h3>
        {canManage && !needsOpening && !noFormalSchedule && (
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
            onChanged?.();
          }}
        />
      )}

      <ConfirmDialog
        open={promoteConfirmOpen}
        onOpenChange={setPromoteConfirmOpen}
        title="Promote the Opening Position as Snapshot V1?"
        description={FIRST_ANCHOR_CONFIRMATION}
        confirmLabel="Promote and control Setup"
        onConfirm={() => promoteOpening(true)}
      />

      {publishOpen && (
        <PublishSnapshotDialog
          project={project}
          firstAnchor={firstAnchor}
          baselines={baselines ?? []}
          onClose={() => setPublishOpen(false)}
          onPublished={() => {
            setPublishOpen(false);
            load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function PublishSnapshotDialog({
  project,
  firstAnchor,
  baselines,
  onClose,
  onPublished,
}: {
  project: Project;
  /** 13.9B: this publish creates the first governance anchor. */
  firstAnchor: boolean;
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
  const [anchorConfirmed, setAnchorConfirmed] = React.useState(false);
  const anchorId = React.useId();
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
        // Only an explicit confirmation by the user, only for the first anchor.
        confirmSetupControl: firstAnchor && anchorConfirmed,
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
              {/* 13.9B Step 4: the project record's typed planned / actual
                  progress is retired and no longer previewed here; nothing is
                  computed for this preview. */}
              <p>
                Project Setup:{" "}
                {firstAnchor
                  ? "not yet controlled — this first governed snapshot makes it controlled"
                  : "controlled"}
              </p>
              <p className="text-muted-foreground">
                Only what has actually been confirmed is published — nothing
                here is calculated or fabricated for this preview.
              </p>
            </div>

            {firstAnchor && (
              <div className="flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/[0.06] p-3">
                <Checkbox
                  id={anchorId}
                  checked={anchorConfirmed}
                  onCheckedChange={(checked) => setAnchorConfirmed(checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor={anchorId} className="text-sm leading-snug text-pretty">
                  <span className="font-medium">This is the first governed Planning Snapshot.</span>{" "}
                  {FIRST_ANCHOR_CONFIRMATION}
                </label>
              </div>
            )}
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
                  (firstAnchor && !anchorConfirmed) ||
                  (isManual ? !manualDataDate : !selectedBatch?.dataDate)
                }
                title={
                  firstAnchor && !anchorConfirmed
                    ? "Confirm that Project Setup becomes controlled first"
                    : isManual && !manualDataDate
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
