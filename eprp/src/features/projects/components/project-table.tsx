"use client";

import Link from "next/link";
import {
  Archive,
  Copy,
  Eye,
  MoreHorizontal,
  PenLine,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import { getClientById, getContactById } from "@/features/master-data";
import type { Project } from "@/types";
import {
  formatVariance,
  projectVariance,
  varianceTone,
} from "@/features/projects/utils";
import {
  OverallStatusBadge,
  ProjectStatusBadge,
} from "./project-status-badge";

const varianceText = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
} as const;

export interface ProjectTableProps {
  projects: Project[];
  onDuplicate: (project: Project) => void;
  onArchive: (project: Project) => void;
}

/** Full projects table (desktop). Horizontally scrollable below xl. */
export function ProjectTable({
  projects,
  onDuplicate,
  onArchive,
}: ProjectTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead className="min-w-48">Project</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Manager</TableHead>
            <TableHead>Start</TableHead>
            <TableHead>Planned Finish</TableHead>
            <TableHead className="text-right">Planned %</TableHead>
            <TableHead className="text-right">Actual %</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead>Overall</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => {
            const variance = projectVariance(project);
            return (
              <TableRow key={project.id}>
                <TableCell className="font-mono text-xs">
                  {project.code}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/projects/${project.id}`}
                    className="font-medium hover:underline"
                  >
                    {project.shortName ?? project.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {getClientById(project.clientId)?.shortName ?? "—"}
                </TableCell>
                <TableCell>
                  {getContactById(project.projectManagerId)?.name ?? "—"}
                </TableCell>
                <TableCell className="tabular-nums whitespace-nowrap">
                  {formatDate(project.actualStartDate ?? project.plannedStartDate)}
                </TableCell>
                <TableCell className="tabular-nums whitespace-nowrap">
                  {formatDate(project.plannedFinishDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {project.plannedProgress}%
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {project.actualProgress}%
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium tabular-nums",
                    varianceText[varianceTone(variance)]
                  )}
                >
                  {formatVariance(variance)}
                </TableCell>
                <TableCell>
                  <OverallStatusBadge status={project.overallStatus} />
                </TableCell>
                <TableCell>
                  <ProjectStatusBadge status={project.status} />
                </TableCell>
                <TableCell className="tabular-nums whitespace-nowrap text-muted-foreground">
                  {formatDate(project.updatedAt)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${project.name}`}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem asChild>
                        <Link href={`/projects/${project.id}`}>
                          <Eye aria-hidden="true" /> View
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/projects/${project.id}/edit`}>
                          <PenLine aria-hidden="true" /> Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDuplicate(project)}>
                        <Copy aria-hidden="true" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={project.status === "archived"}
                        onClick={() => onArchive(project)}
                      >
                        <Archive aria-hidden="true" /> Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
