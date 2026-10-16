"use client";

import { formatDate } from "@/lib/formatters";
import {
  getClientById,
  getContactById,
  getProjectPhaseById,
} from "@/features/master-data";
import type { Project } from "@/types";
import {
  planningGovernanceOf,
  showLegacyPerformanceBadge,
} from "../planning-experience";
import { usePlanningPosition } from "../use-planning-position";
import { OverallStatusBadge, ProjectStatusBadge } from "./project-status-badge";
import { PlanningStatus } from "./planning/planning-status";

export interface ProjectSummaryHeaderProps {
  project: Project;
  /** Right-aligned action buttons. */
  actions?: React.ReactNode;
}

/**
 * Project overview header: identity, badges, the compact Planning Status and
 * the Project Setup reference dates.
 *
 * 13.9A: the Priority badge is gone (Priority is no longer part of the UI; its
 * stored value is kept), and the typed Planned / Actual / Variance / SPI
 * metrics — read from the project record, with a percent-ratio SPI — are
 * replaced by the Planning Status read from the Published Planning Snapshot.
 */
export function ProjectSummaryHeader({
  project,
  actions,
}: ProjectSummaryHeaderProps) {
  const client = getClientById(project.clientId);
  const manager = getContactById(project.projectManagerId);
  const phase = getProjectPhaseById(project.currentPhaseId);
  // One read of the planning position, shared with the Planning Status below.
  const position = usePlanningPosition(project.id);
  const governance =
    position.status === "ready"
      ? planningGovernanceOf(
          position.settings?.onboardingMode ?? "new_project",
          Boolean(position.snapshot)
        )
      : undefined;
  const dates: { label: string; value: string | undefined }[] = [
    { label: "Start", value: project.actualStartDate ?? project.plannedStartDate },
    { label: "Planned finish", value: project.plannedFinishDate },
    { label: "Forecast finish", value: project.forecastFinishDate },
    { label: "Actual finish", value: project.actualFinishDate },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-xs text-muted-foreground">
            {project.code}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
            {project.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            {/* The manual overallStatus badge never sits beside a governed
                planning state it would contradict (13.9A UAT). */}
            {showLegacyPerformanceBadge(governance) && (
              <OverallStatusBadge status={project.overallStatus} />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {client?.name ?? "—"} · Managed by {manager?.name ?? "—"}
            {phase ? ` · ${phase.name}` : ""}
          </p>
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </header>

      <PlanningStatus projectId={project.id} position={position} className="bg-card shadow-soft" />

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <dl className="contents">
          {dates
            .filter((date) => date.value || date.label === "Start" || date.label === "Planned finish")
            .map((date) => (
              <div key={date.label} className="flex gap-1.5">
                <dt>{date.label}</dt>
                <dd className="font-medium text-foreground">{formatDate(date.value)}</dd>
              </div>
            ))}
        </dl>
        <span className="text-muted-foreground/80">Reference dates from Project Setup</span>
      </div>
    </div>
  );
}
