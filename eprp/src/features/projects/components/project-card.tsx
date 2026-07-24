"use client";

import Link from "next/link";
import { Building2, CalendarDays, Layers, PenLine, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";
import { getClientById, getContactById } from "@/features/master-data";
import type { Project } from "@/types";
import { countSystems } from "@/features/projects/utils";
import { ProgressComparison } from "./progress-comparison";
import {
  OverallStatusBadge,
  ProjectStatusBadge,
} from "./project-status-badge";

export interface ProjectCardProps {
  project: Project;
}

/** Project summary card for the grid view and small screens. */
export function ProjectCard({ project }: ProjectCardProps) {
  const client = getClientById(project.clientId);
  const manager = getContactById(project.projectManagerId);

  return (
    <Card data-slot="project-card" className="shadow-soft">
      <CardHeader>
        <CardTitle className="leading-snug">
          <Link
            href={`/projects/${project.id}`}
            className="hover:underline"
          >
            {project.shortName ?? project.name}
          </Link>
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          {project.code}
        </CardDescription>
        <CardAction>
          <ProjectStatusBadge status={project.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="size-3.5" aria-hidden="true" />
            {client?.shortName ?? "—"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <User className="size-3.5" aria-hidden="true" />
            {manager?.name ?? "—"}
          </span>
        </div>

        <ProgressComparison
          planned={project.plannedProgress}
          actual={project.actualProgress}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            {formatDate(project.plannedStartDate)} –{" "}
            {formatDate(project.plannedFinishDate)}
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Layers className="size-3.5" aria-hidden="true" />
            {project.departments.length} depts · {countSystems(project)} systems
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <OverallStatusBadge status={project.overallStatus} />
          <span className="text-xs text-muted-foreground tabular-nums">
            Updated {formatDate(project.updatedAt)}
          </span>
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/projects/${project.id}`}>View Project</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/projects/${project.id}/edit`}>
            <PenLine data-icon="inline-start" aria-hidden="true" />
            Edit
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
