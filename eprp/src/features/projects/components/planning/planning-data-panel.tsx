"use client";

import * as React from "react";
import { ChevronLeft, FileSpreadsheet, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { formatDateTime } from "@/lib/formatters";
import { planningService } from "@/services/planning-service";
import type { PlanningImportBatch, Project } from "@/types";
import { PlanningImportWizard } from "./planning-import-wizard";
import { PlanningReviewPanel } from "./planning-review-panel";

const SOURCE_LABEL: Record<PlanningImportBatch["sourceType"], string> = {
  eprp_excel: "EPRP Excel Template",
  p6: "Primavera P6",
  msproject: "MS Project",
};

const STATUS_TONE: Record<PlanningImportBatch["status"], "neutral" | "success" | "danger" | "info"> = {
  uploaded: "neutral",
  validated: "info",
  rejected: "danger",
  published: "success",
};

/**
 * Import history and the Planning Review workflow. The wizard only ever
 * saves a Draft Import Batch (`uploaded`/`validated`) — publishing happens
 * from Baselines & Snapshots, against a batch reviewed here.
 */
export function PlanningDataPanel({
  project,
  canManage,
}: {
  project: Project;
  canManage: boolean;
}) {
  const [batches, setBatches] = React.useState<PlanningImportBatch[] | undefined>();
  const [existingCodes, setExistingCodes] = React.useState<string[]>([]);
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [reviewing, setReviewing] = React.useState<PlanningImportBatch | null>(null);

  const load = React.useCallback(() => {
    void planningService.listImportBatches(project.id).then(setBatches);
    void planningService.listWorkItems(project.id).then((items) =>
      setExistingCodes(items.map((item) => item.code))
    );
  }, [project.id]);

  React.useEffect(() => load(), [load]);

  if (batches === undefined) {
    return <LoadingState variant="table" label="Loading import history…" />;
  }

  if (reviewing) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setReviewing(null)}>
          <ChevronLeft data-icon="inline-start" aria-hidden="true" />
          Back to Planning Data
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">
            Planning Review — {reviewing.fileName ?? SOURCE_LABEL[reviewing.sourceType]}
          </h3>
          <StatusBadge tone={STATUS_TONE[reviewing.status]}>{reviewing.status}</StatusBadge>
        </div>
        <PlanningReviewPanel
          projectId={project.id}
          batch={reviewing}
          projectPlannedProgress={project.plannedProgress}
          projectActualProgress={project.actualProgress}
          canManage={canManage}
          onConfirmed={load}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Every import lands here as a Draft Import Batch first — nothing is
          published or added to the Master Plan until Planning Review
          confirms it.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Upload data-icon="inline-start" aria-hidden="true" />
            Import Planning Data
          </Button>
        )}
      </div>

      {batches.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No imports yet"
          description="Import an EPRP template, a P6 export, or an MS Project export — or add work items directly from Master Plan."
          className="py-10"
          action={
            canManage ? (
              <Button variant="outline" onClick={() => setWizardOpen(true)}>
                <Upload data-icon="inline-start" aria-hidden="true" />
                Import Planning Data
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {batches.map((batch) => (
            <li key={batch.id}>
              <button
                type="button"
                onClick={() => setReviewing(batch)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {batch.fileName ?? SOURCE_LABEL[batch.sourceType]}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {SOURCE_LABEL[batch.sourceType]} · {batch.rowCount} row
                    {batch.rowCount === 1 ? "" : "s"} · {formatDateTime(batch.uploadedAt)}
                  </span>
                </span>
                <StatusBadge tone={STATUS_TONE[batch.status]}>{batch.status}</StatusBadge>
              </button>
            </li>
          ))}
        </ul>
      )}

      <PlanningImportWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        projectId={project.id}
        existingWorkItemCodes={existingCodes}
        onSaved={load}
      />
    </div>
  );
}
