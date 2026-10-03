"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import { formatDateTime } from "@/lib/formatters";
import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { useMasterData } from "@/features/master-data";
import {
  projectService,
  type ClassificationCorrection,
} from "@/services/project-service";
import type { Project, ProjectType } from "@/types";
import {
  canCorrectProjectType,
  classificationLabel,
  correctionHistoryLabel,
} from "../classification";
import {
  CorrectProjectTypeDialog,
  type CorrectProjectTypeTarget,
} from "./project-classification";

/**
 * Project Type corrections on Project Details (Phase 2C.1): the exceptional
 * System Admin "Correct Project Type" action, and the read-only history of
 * every correction made. History is visible to the audience the database
 * lets read it (Project Control on this project, or a global authority);
 * the action to System Admin only.
 */
export function ProjectTypeCorrections({
  project,
  canViewHistory,
  onCorrected,
}: {
  project: Project;
  /** Mirrors the history table's read policy — presentation only. */
  canViewHistory: boolean;
  onCorrected: (project: Project) => void;
}) {
  const identity = useCurrentIdentity();
  const { records } = useMasterData("projectType");
  const [history, setHistory] = React.useState<ClassificationCorrection[]>([]);
  const [open, setOpen] = React.useState(false);

  const canCorrect = canCorrectProjectType(identity, project);
  const categoryName = React.useCallback(
    (id: string | undefined) =>
      (records as ProjectType[]).find((record) => record.id === id)?.name,
    [records]
  );

  // Re-read after every saved change to the project, including a correction.
  const version = project.updatedAt;
  React.useEffect(() => {
    if (!canViewHistory) return;
    let cancelled = false;
    projectService
      .listClassificationCorrections(project.id)
      .then((entries) => {
        if (!cancelled) setHistory(entries);
      })
      // History is supplementary to the page; keep it empty on failure.
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canViewHistory, project.id, version]);

  if (!canCorrect && (!canViewHistory || history.length === 0)) return null;

  const currentLabel = classificationLabel(
    project.structureFamily,
    categoryName(project.projectTypeId),
    project.projectCategoryDetail
  );

  const correct = async (target: CorrectProjectTypeTarget) => {
    const corrected = await projectService.correctProjectType({
      projectId: project.id,
      expectedUpdatedAt: project.updatedAt,
      ...target,
    });
    onCorrected(corrected);
  };

  return (
    <SectionCard
      title="Project Type corrections"
      description="Project Type is locked once a project is saved. Exceptional System Admin corrections are recorded here permanently."
      action={
        canCorrect ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Correct Project Type
          </Button>
        ) : undefined
      }
    >
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No corrections have been made.</p>
      ) : (
        <ol className="space-y-3">
          {history.map((entry) => (
            <li key={entry.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                <span>
                  {correctionHistoryLabel(entry, "old", categoryName)}
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground" aria-label="corrected to" />
                <span>
                  {correctionHistoryLabel(entry, "new", categoryName)}
                </span>
              </div>
              <p className="mt-1 text-pretty">
                <span className="text-muted-foreground">Reason: </span>
                {entry.reason}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(entry.correctedAt)} · {entry.correctedByName ?? "System Admin"}
              </p>
            </li>
          ))}
        </ol>
      )}

      {canCorrect && project.structureFamily && (
        <CorrectProjectTypeDialog
          open={open}
          onOpenChange={setOpen}
          currentFamily={project.structureFamily}
          currentLabel={currentLabel}
          onCorrect={correct}
        />
      )}
    </SectionCard>
  );
}
