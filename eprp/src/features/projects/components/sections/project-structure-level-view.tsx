"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderX, Layers, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, StatusBadge } from "@/components/shared";
import { projectSectionHref } from "@/config/project-sections";
import { projectService } from "@/services/project-service";
import type { Project } from "@/types";
import type { ProjectStructure, ProjectStructureNode } from "@/types/project-structure";
import {
  hierarchyLine,
  structureLevelHref,
  structureSetupHref,
} from "../../structure-navigation";
import { levelsOf } from "../../use-structure-nav";
import { useProjectStructure } from "../../use-project-structure";

const reportingInput = (node: ProjectStructureNode) =>
  node.archivedAt
    ? "—"
    : node.weeklyReportingRequired && node.monthlyReportingRequired
      ? "Weekly and Monthly"
      : node.weeklyReportingRequired
        ? "Weekly"
        : node.monthlyReportingRequired
          ? "Monthly"
          : "None";

/**
 * One level of an OTHER project's configured structure (e.g. "Functions"),
 * read-only. The level's name, the hierarchy line and the column headings all
 * come from the project's own levels — nothing here names Departments,
 * Systems or Disciplines. Editing stays in Project Setup → Project Structure
 * (governed once Setup is Controlled).
 */
export function ProjectStructureLevelView({
  projectId,
  levelNumber,
}: {
  projectId: string;
  levelNumber: number;
}) {
  const [project, setProject] = React.useState<Project | null | undefined>();
  const { structure, error, refresh } = useProjectStructure(projectId);

  React.useEffect(() => {
    let cancelled = false;
    void projectService.getProjectById(projectId).then((loaded) => {
      if (!cancelled) setProject(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (project === undefined || (!structure && !error)) {
    return <LoadingState variant="page" label="Loading project structure…" />;
  }
  if (project === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Project not found"
        description={`No project exists with id “${projectId}”.`}
        action={<Button variant="outline" asChild><Link href="/projects">Back to Projects</Link></Button>}
      />
    );
  }
  if (error || !structure) {
    return <ErrorState title="Project structure could not be loaded" description={error ?? undefined} onRetry={refresh} />;
  }
  return <LevelBody project={project} structure={structure} levelNumber={levelNumber} />;
}

function LevelBody({
  project,
  structure,
  levelNumber,
}: {
  project: Project;
  structure: ProjectStructure;
  levelNumber: number;
}) {
  const router = useRouter();
  const levels = levelsOf(structure) ?? [];
  const level = levels.find((candidate) => candidate.levelNumber === levelNumber);
  const family = project.structureFamily;
  const firstLevel = levels[0]?.levelNumber;

  // Only an Other project has configured levels: send any other project to its Overview.
  React.useEffect(() => {
    if (family !== "other") router.replace(projectSectionHref(project.id, "overview"));
  }, [family, project.id, router]);

  if (family !== "other") return <LoadingState variant="page" label="Opening project…" />;

  if (!level) {
    return (
      <EmptyState
        icon={Layers}
        title={`This project has no level ${levelNumber}`}
        description={
          levels.length > 0
            ? `Its structure is ${hierarchyLine(levels)}.`
            : "No structure levels are configured yet. Configure them in Project Setup."
        }
        action={
          <Button variant="outline" asChild>
            <Link href={firstLevel ? structureLevelHref(project.id, firstLevel) : structureSetupHref(project.id)}>
              {firstLevel ? `Open ${levels[0].pluralLabel}` : "Open Project Structure"}
            </Link>
          </Button>
        }
      />
    );
  }

  const nodes = structure.nodes
    .filter((node) => node.levelNumber === levelNumber)
    .sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const parentLevel = levels.find((candidate) => candidate.levelNumber === levelNumber - 1);
  const nameOf = (id: string | undefined) => structure.nodes.find((node) => node.id === id);
  const activeCount = nodes.filter((node) => !node.archivedAt).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${project.code} · ${project.shortName ?? project.name}`}
        title={level.pluralLabel}
        description={`${level.pluralLabel} in this project's structure: ${hierarchyLine(levels)}.`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={projectSectionHref(project.id, "overview")}>Project Overview</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={structureSetupHref(project.id)}>
                <PenLine data-icon="inline-start" aria-hidden="true" />
                Project Structure setup
              </Link>
            </Button>
          </>
        }
      />

      {levels.length > 1 && (
        <nav aria-label="Structure levels" className="flex flex-wrap gap-2">
          {levels.map((candidate) => (
            <Button
              key={candidate.levelNumber}
              size="sm"
              variant={candidate.levelNumber === levelNumber ? "default" : "outline"}
              asChild
            >
              <Link
                href={structureLevelHref(project.id, candidate.levelNumber)}
                aria-current={candidate.levelNumber === levelNumber ? "page" : undefined}
              >
                {candidate.pluralLabel}
              </Link>
            </Button>
          ))}
        </nav>
      )}

      <SectionCard
        title={`${level.pluralLabel} (${activeCount})`}
        description={`Every ${level.singularLabel.toLowerCase()} on this project${nodes.length > activeCount ? ", archived ones last" : ""}.`}
      >
        {nodes.length === 0 ? (
          <EmptyState
            title={`No ${level.pluralLabel.toLowerCase()} yet`}
            description={`Add them in Project Setup → Project Structure.`}
            className="py-8"
          />
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {nodes.map((node) => {
              const parent = nameOf(node.parentId);
              return (
                <li key={node.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className={node.archivedAt ? "text-muted-foreground line-through" : "font-medium"}>
                      {node.name}
                      {node.code ? ` (${node.code})` : ""}
                    </span>
                    {parentLevel && parent && (
                      <span className="block text-xs text-muted-foreground">
                        {parentLevel.singularLabel}: {parent.name}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Reporting input: {reportingInput(node)}</span>
                    <StatusBadge tone={node.archivedAt ? "neutral" : "success"}>
                      {node.archivedAt ? "Archived" : "Active"}
                    </StatusBadge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
