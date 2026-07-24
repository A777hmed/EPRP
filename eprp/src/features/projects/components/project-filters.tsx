"use client";

import { LayoutGrid, List } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterBar, SearchInput } from "@/components/shared";
import { PROJECT_LIFECYCLE_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Client, Contact, ProjectLifecycleStatus } from "@/types";
import {
  projectSortOptions,
  type ProjectSortKey,
} from "@/features/projects/options";

export type ProjectView = "table" | "grid";

export interface ProjectFiltersState {
  query: string;
  status: ProjectLifecycleStatus | "all";
  clientId: string | "all";
  managerId: string | "all";
  sort: ProjectSortKey;
}

export const defaultProjectFilters: ProjectFiltersState = {
  query: "",
  status: "all",
  clientId: "all",
  managerId: "all",
  sort: "updated",
};

export interface ProjectFiltersProps {
  filters: ProjectFiltersState;
  onFiltersChange: (filters: ProjectFiltersState) => void;
  view: ProjectView;
  onViewChange: (view: ProjectView) => void;
  clients: Client[];
  managers: Contact[];
}

const lifecycleStatuses = Object.keys(
  PROJECT_LIFECYCLE_META
) as ProjectLifecycleStatus[];

/** Search, status/client/manager filters, sort, and grid/table toggle. */
export function ProjectFilters({
  filters,
  onFiltersChange,
  view,
  onViewChange,
  clients,
  managers,
}: ProjectFiltersProps) {
  const set = (patch: Partial<ProjectFiltersState>) =>
    onFiltersChange({ ...filters, ...patch });

  const activeCount = [
    filters.query,
    filters.status !== "all",
    filters.clientId !== "all",
    filters.managerId !== "all",
  ].filter(Boolean).length;

  return (
    <FilterBar
      activeCount={activeCount}
      onReset={() => onFiltersChange({ ...defaultProjectFilters, sort: filters.sort })}
    >
      <SearchInput
        value={filters.query}
        onValueChange={(query) => set({ query })}
        placeholder="Search projects…"
        containerClassName="w-full sm:w-60"
      />

      <Select
        value={filters.status}
        onValueChange={(status) =>
          set({ status: status as ProjectFiltersState["status"] })
        }
      >
        <SelectTrigger className="w-32" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {lifecycleStatuses.map((s) => (
            <SelectItem key={s} value={s}>
              {PROJECT_LIFECYCLE_META[s].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.clientId}
        onValueChange={(clientId) => set({ clientId })}
      >
        <SelectTrigger className="w-36" aria-label="Filter by client">
          <SelectValue placeholder="Client" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All clients</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.shortName ?? c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.managerId}
        onValueChange={(managerId) => set({ managerId })}
      >
        <SelectTrigger className="w-40" aria-label="Filter by project manager">
          <SelectValue placeholder="Project manager" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All managers</SelectItem>
          {managers.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.sort}
        onValueChange={(sort) => set({ sort: sort as ProjectSortKey })}
      >
        <SelectTrigger className="w-40" aria-label="Sort projects">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {projectSortOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              Sort: {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div
        role="group"
        aria-label="View mode"
        className="ml-auto flex rounded-lg border p-0.5"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Table view"
          aria-pressed={view === "table"}
          className={cn(view === "table" && "bg-muted text-foreground")}
          onClick={() => onViewChange("table")}
        >
          <List aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Grid view"
          aria-pressed={view === "grid"}
          className={cn(view === "grid" && "bg-muted text-foreground")}
          onClick={() => onViewChange("grid")}
        >
          <LayoutGrid aria-hidden="true" />
        </Button>
      </div>
    </FilterBar>
  );
}
