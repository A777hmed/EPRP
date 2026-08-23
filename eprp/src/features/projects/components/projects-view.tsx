"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  FolderKanban,
  Plus,
  SearchX,
  TrendingDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
} from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import type { Client, Contact } from "@/types";
import { projectService } from "@/services/project-service";
import type { Project } from "@/types";
import { projectVariance } from "@/features/projects/utils";
import {
  defaultProjectFilters,
  ProjectFilters,
  type ProjectFiltersState,
  type ProjectView,
} from "./project-filters";
import { ProjectTable } from "./project-table";
import { ProjectCard } from "./project-card";
import { ConfirmArchiveDialog } from "./confirm-archive-dialog";

function applyFilters(
  projects: Project[],
  filters: ProjectFiltersState
): Project[] {
  const query = filters.query.trim().toLowerCase();

  const filtered = projects.filter((p) => {
    if (filters.status !== "all" && p.status !== filters.status) return false;
    if (filters.clientId !== "all" && p.clientId !== filters.clientId)
      return false;
    if (filters.managerId !== "all" && p.projectManagerId !== filters.managerId)
      return false;
    if (query) {
      const haystack = `${p.name} ${p.shortName ?? ""} ${p.code}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const sorted = [...filtered];
  switch (filters.sort) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "code":
      sorted.sort((a, b) => a.code.localeCompare(b.code));
      break;
    case "progress":
      sorted.sort((a, b) => b.actualProgress - a.actualProgress);
      break;
    case "variance":
      sorted.sort((a, b) => projectVariance(a) - projectVariance(b));
      break;
    default:
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return sorted;
}

/** /projects — stats, filters, and the table/grid with all view states. */
export function ProjectsView() {
  const router = useRouter();
  // Live master data — reflects records added through the managed selects.
  const { activeRecords: clientRecords } = useMasterData("client");
  const { activeRecords: contactRecords } = useMasterData("contact");
  const managers = React.useMemo(
    () =>
      (contactRecords as Contact[]).filter((c) =>
        // `contacts.position` is nullable in the database even though the type
        // declares it as `string`, so a contact saved without a position
        // arrives here as null and a bare `.includes()` throws. Every other
        // reader of this field already guards it; this was the one that did not.
        (c.position ?? "").includes("Project Manager")
      ),
    [contactRecords]
  );
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [error, setError] = React.useState(false);
  const [filters, setFilters] = React.useState(defaultProjectFilters);
  const [view, setView] = React.useState<ProjectView>("table");
  const [archiveTarget, setArchiveTarget] = React.useState<Project | null>(
    null
  );

  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    projectService
      .getProjects()
      .then((result) => {
        if (!cancelled) setProjects(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const load = () => {
    setError(false);
    setProjects(null);
    setReloadKey((k) => k + 1);
  };

  const visible = React.useMemo(
    () => (projects ? applyFilters(projects, filters) : []),
    [projects, filters]
  );

  const stats = React.useMemo(() => {
    const all = projects ?? [];
    return {
      total: all.length,
      active: all.filter((p) => p.status === "active").length,
      delayed: all.filter(
        (p) => p.status === "delayed" || p.overallStatus === "behind"
      ).length,
      completed: all.filter((p) => p.status === "completed").length,
    };
  }, [projects]);

  const handleDuplicate = async (project: Project) => {
    const copy = await projectService.duplicateProject(project.id);
    router.push(`/projects/${copy.id}/edit`);
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    await projectService.archiveProject(archiveTarget.id);
    setArchiveTarget(null);
    load();
  };

  const hasFilters =
    filters.query !== "" ||
    filters.status !== "all" ||
    filters.clientId !== "all" ||
    filters.managerId !== "all";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Projects"
        description="Project master data: status, progress, responsibility, and reporting configuration."
        actions={
          <Button asChild>
            <Link href="/projects/new">
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add Project
            </Link>
          </Button>
        }
      />

      <section aria-label="Project statistics">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total Projects" value={String(stats.total)} icon={FolderKanban} />
          <StatCard label="Active" value={String(stats.active)} icon={Clock} />
          <StatCard label="Delayed / Behind" value={String(stats.delayed)} icon={TrendingDown} />
          <StatCard label="Completed" value={String(stats.completed)} icon={CheckCircle2} />
        </div>
      </section>

      <ProjectFilters
        filters={filters}
        onFiltersChange={setFilters}
        view={view}
        onViewChange={setView}
        clients={clientRecords as Client[]}
        managers={managers}
      />

      {error ? (
        <ErrorState
          title="Projects could not be loaded"
          description="The project list failed to load. Try again."
          onRetry={load}
        />
      ) : projects === null ? (
        <LoadingState
          variant={view === "grid" ? "card" : "table"}
          count={5}
          label="Loading projects…"
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create the first project to start collecting progress reports."
          action={
            <Button asChild>
              <Link href="/projects/new">
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add Project
              </Link>
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No projects match your filters"
          description={
            hasFilters
              ? "Try a different search term or reset the filters."
              : "No projects to show."
          }
        />
      ) : view === "table" ? (
        <>
          {/* Cards on small screens, table from md up */}
          <div className="grid gap-4 sm:grid-cols-2 md:hidden">
            {visible.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
          <div className="hidden md:block">
            <ProjectTable
              projects={visible}
              onDuplicate={handleDuplicate}
              onArchive={setArchiveTarget}
            />
          </div>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      <ConfirmArchiveDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        projectName={archiveTarget?.name ?? ""}
        onConfirm={handleArchive}
      />
    </div>
  );
}
