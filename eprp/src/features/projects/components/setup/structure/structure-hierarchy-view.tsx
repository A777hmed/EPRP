"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectStructure } from "@/types/project-structure";
import type { StructureWorkspaceProject } from "../../../structure/structure-workspace-contract";
import {
  branchIds,
  buildStructureHierarchy,
  countLabel,
  type HierarchyNode,
} from "../../../structure/structure-hierarchy";

export interface StructureHierarchyViewProps {
  project: StructureWorkspaceProject;
  structure: ProjectStructure;
  canManage: boolean;
  /** Switch to the Manage View (used by the empty state). */
  onManage: () => void;
  /** Rendered in the header's action area (the view switch). */
  headerAction?: React.ReactNode;
}

/**
 * Structure Hierarchy — a read-only picture of an Other project's units:
 * the project at the top, its Level 1 units side by side, and each unit's
 * deeper levels connected beneath it. It reads the same structure the
 * Manage View edits; nothing is stored or copied here.
 *
 * Units, not people: the People Organization Chart is a separate, later view
 * built from project membership and Reports To.
 */
export function StructureHierarchyView({ project, structure, canManage, onManage, headerAction }: StructureHierarchyViewProps) {
  const hierarchy = buildStructureHierarchy(structure);
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const branches = branchIds(hierarchy.roots);
  const regionId = React.useId();
  const firstLevel = hierarchy.levels[0];
  const regionRef = React.useRef<HTMLDivElement>(null);
  const rootCount = hierarchy.roots.length;

  // A diagram wider than the page opens centred on the Project apex, so the
  // top of the hierarchy is in view; afterwards the user's scrolling wins.
  React.useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const overflow = region.scrollWidth - region.clientWidth;
    if (overflow > 0) region.scrollLeft = overflow / 2;
  }, [rootCount]);

  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section className="min-w-0 space-y-4 border-t pt-4" aria-label="Structure Hierarchy · Hierarchy View">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Step 2 · Structure Hierarchy</h3>
          <p className="mt-1 text-xs text-muted-foreground">How this project&apos;s Structure Units are organized, level by level. It shows units, not people.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerAction}
          {branches.length > 0 && (
            <>
              <Button type="button" variant="outline" className="min-h-11" disabled={collapsed.size === 0} onClick={() => setCollapsed(new Set())}>Expand all</Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={collapsed.size === branches.length} onClick={() => setCollapsed(new Set(branches))}>Collapse all</Button>
            </>
          )}
        </div>
      </div>

      {hierarchy.levels.length > 0 && (
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-label="Structure levels, top to bottom">
          {hierarchy.levels.map((level, index) => (
            <li key={level.levelNumber} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true" className="text-muted-foreground">→</span>}
              <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
                <span className="font-medium tabular-nums text-muted-foreground">L{level.levelNumber}</span>
                <span className="font-medium">{level.singular}</span>
                <span className="text-muted-foreground tabular-nums">· {level.activeCount}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {hierarchy.levels.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No structure levels yet. Define them in Step 1, then add units in the Manage View.</p>
      ) : hierarchy.roots.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-5">
          <p className="text-sm font-medium">No {firstLevel?.plural ?? "units"} yet</p>
          <p className="mt-1 text-sm text-muted-foreground">{canManage ? `Add the first ${firstLevel?.singular ?? "unit"} in the Manage View; it will appear here.` : "Units appear here once they are added."}</p>
          {canManage && <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={onManage}>Open Manage View</Button>}
        </div>
      ) : (
        <div
          ref={regionRef}
          role="region"
          aria-label="Structure Hierarchy diagram"
          tabIndex={0}
          className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border bg-muted/20 px-4 py-3 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <div className="mx-auto w-max min-w-full">
            <div className="flex flex-col items-center">
              <div className="max-w-xs rounded-md border border-foreground/20 bg-background px-3 py-2 text-center" aria-label={`Project ${project.code}`}>
                <p className="text-xs text-muted-foreground">Project</p>
                <p className="break-words text-sm font-semibold">{project.code}</p>
                <p className="line-clamp-2 break-words text-xs text-muted-foreground" title={project.name}>{project.name}</p>
              </div>
              <span aria-hidden="true" className="h-3 border-l border-muted-foreground/40" />
            </div>
            <ul className="flex justify-center" aria-label={firstLevel?.plural ?? "Units"}>
              {hierarchy.roots.map((root) => (
                <li
                  key={root.id}
                  data-hierarchy-root={root.id}
                  className={cn(
                    "relative flex w-72 shrink-0 flex-col px-2 pt-4",
                    // Bus line joining the Level 1 units, and a drop to each card.
                    "before:absolute before:top-0 before:right-0 before:left-0 before:border-t before:border-muted-foreground/40",
                    "first:before:left-1/2 last:before:right-1/2 only:before:hidden",
                    "after:absolute after:top-0 after:left-1/2 after:h-4 after:border-l after:border-muted-foreground/40"
                  )}
                >
                  <HierarchyBranchNode node={root} depth={0} collapsed={collapsed} onToggle={toggle} regionId={regionId} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {hierarchy.levels.length > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums" aria-label="Structure summary">
          <span>{countLabel(hierarchy.activeCount, "active unit", "active units")} across {countLabel(hierarchy.levels.length, "level", "levels")}</span>
          <span>Weekly input: {countLabel(hierarchy.weeklyInputCount, "unit", "units")}{!project.reporting.weeklyEnabled && " · reporting disabled"}</span>
          <span>Monthly input: {countLabel(hierarchy.monthlyInputCount, "unit", "units")}{!project.reporting.monthlyEnabled && " · reporting disabled"}</span>
          {hierarchy.archivedCount > 0 && <span>{countLabel(hierarchy.archivedCount, "archived unit", "archived units")} hidden · shown in the Manage View</span>}
        </p>
      )}
    </section>
  );
}

function HierarchyBranchNode({ node, depth, collapsed, onToggle, regionId }: {
  node: HierarchyNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  regionId: string;
}) {
  const expanded = !collapsed.has(node.id);
  const childrenId = `${regionId}-children-${node.id}`;
  return (
    <>
      <StructureNodeCard node={node} depth={depth} expanded={expanded} controls={childrenId} onToggle={() => onToggle(node.id)} />
      {node.children.length > 0 && expanded && (
        <ul id={childrenId} className="mt-2 space-y-2" aria-label={`${node.name}: ${countLabel(node.children.length, node.children[0]?.levelSingular, node.childLevelPlural)}`}>
          {node.children.map((child) => (
            <li
              key={child.id}
              data-hierarchy-unit={child.id}
              className={cn(
                "relative pl-5",
                // Trunk from the parent down to this unit's elbow; it stops at
                // the last sibling so the branch ends cleanly.
                "before:absolute before:-top-2 before:bottom-0 before:left-2 before:border-l before:border-muted-foreground/40",
                "last:before:bottom-auto last:before:h-7",
                "after:absolute after:top-5 after:left-2 after:w-3 after:border-t after:border-muted-foreground/40"
              )}
            >
              <HierarchyBranchNode node={child} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} regionId={regionId} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * One structure unit. Zones, top to bottom: identity (level, name, code),
 * operational reporting input, then branch size. Phase 2C.3D adds unit
 * responsibilities (lead, members, Weekly / Monthly responsible, backup)
 * as a further zone below reporting input — the card is laid out for it,
 * but nothing about people is shown or implied now.
 */
export function StructureNodeCard({ node, depth, expanded, controls, onToggle }: {
  node: HierarchyNode;
  depth: number;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const hasChildren = node.children.length > 0;
  const branch = hasChildren ? countLabel(node.children.length, node.children[0]?.levelSingular, node.childLevelPlural) : undefined;
  const context = `${node.levelSingular}, Level ${node.levelNumber}${node.parentName ? `, under ${node.parentName}` : ""}`;
  return (
    <article
      data-structure-node={node.id}
      aria-label={`${node.name} — ${context}`}
      className={cn("rounded-md border bg-card px-2.5 py-2", depth === 0 && "border-foreground/20")}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0 rounded border px-1 font-medium tabular-nums">L{node.levelNumber}</span>
            <span className="truncate" title={node.levelSingular}>{node.levelSingular}</span>
          </p>
          <p className="mt-0.5 break-words text-sm font-semibold leading-snug">{node.name}</p>
          {node.code && <p className="break-all font-mono text-xs text-muted-foreground">{node.code}</p>}
        </div>
        {hasChildren && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-mr-1 shrink-0"
            aria-expanded={expanded}
            aria-controls={expanded ? controls : undefined}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name} (${branch})`}
            onClick={onToggle}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        )}
      </div>
      {(node.weeklyInputRequired || node.monthlyInputRequired) && (
        <ul className="mt-1.5 flex flex-wrap gap-1 text-xs" aria-label="Operational reporting input">
          {node.weeklyInputRequired && <li className="rounded border bg-accent px-1.5 py-0.5 text-accent-foreground">Weekly input</li>}
          {node.monthlyInputRequired && <li className="rounded border bg-accent px-1.5 py-0.5 text-accent-foreground">Monthly input</li>}
        </ul>
      )}
      {hasChildren && (
        <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
          {branch}
          {!expanded && ` · ${countLabel(node.descendantCount, "unit", "units")} hidden`}
        </p>
      )}
    </article>
  );
}
