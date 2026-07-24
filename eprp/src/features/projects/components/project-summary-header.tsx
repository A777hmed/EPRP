"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  getClientById,
  getContactById,
  getProjectPhaseById,
} from "@/features/master-data";
import type { Project } from "@/types";
import {
  formatVariance,
  projectSpi,
  projectVariance,
  varianceTone,
} from "@/features/projects/utils";
import {
  OverallStatusBadge,
  PriorityBadge,
  ProjectStatusBadge,
} from "./project-status-badge";

const varianceText = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-foreground",
} as const;

function Metric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tracking-tight tabular-nums",
          valueClassName
        )}
      >
        {value}
      </p>
    </div>
  );
}

export interface ProjectSummaryHeaderProps {
  project: Project;
  /** Right-aligned action buttons. */
  actions?: React.ReactNode;
}

/** Project overview header: identity, badges, key metrics, and dates. */
export function ProjectSummaryHeader({
  project,
  actions,
}: ProjectSummaryHeaderProps) {
  const client = getClientById(project.clientId);
  const manager = getContactById(project.projectManagerId);
  const phase = getProjectPhaseById(project.currentPhaseId);
  const variance = projectVariance(project);

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
            <OverallStatusBadge status={project.overallStatus} />
            <PriorityBadge priority={project.priority} />
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

      <Card className="shadow-soft">
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Planned Progress" value={`${project.plannedProgress}%`} />
            <Metric label="Actual Progress" value={`${project.actualProgress}%`} />
            <Metric
              label="Schedule Variance"
              value={formatVariance(variance)}
              valueClassName={varianceText[varianceTone(variance)]}
            />
            <Metric label="SPI" value={projectSpi(project).toFixed(2)} />
            <Metric
              label="Start"
              value={formatDate(project.actualStartDate ?? project.plannedStartDate)}
            />
            <Metric
              label="Planned Finish"
              value={formatDate(project.plannedFinishDate)}
            />
          </div>
          {(project.forecastFinishDate || project.actualFinishDate) && (
            <>
              <Separator className="my-3" />
              <p className="text-xs text-muted-foreground tabular-nums">
                {project.forecastFinishDate &&
                  `Forecast finish: ${formatDate(project.forecastFinishDate)}`}
                {project.forecastFinishDate && project.actualFinishDate && " · "}
                {project.actualFinishDate &&
                  `Actual finish: ${formatDate(project.actualFinishDate)}`}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
