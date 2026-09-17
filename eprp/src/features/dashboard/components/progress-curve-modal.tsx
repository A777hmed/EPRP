"use client";

/**
 * Expanded "Project Progress Comparison" analysis modal — Dashboard UX Part
 * 1, item 6 (formerly the 5A1-correction "Planned vs Actual Progress"
 * modal, widened from Planning-backed projects only to every visible
 * project).
 *
 * A centered `DetailModal` at `size="wide"`: every visible project on the
 * left, the selected project's curve and governed metrics on the right.
 * Clicking another project updates the chart INSIDE this same modal — it
 * never navigates away, and it never fetches anything the caller did not
 * already fetch (same `curve` prop, same `usePlanningProgressCurve` call
 * site in `dashboard-view.tsx`).
 *
 * Up to 4 candidates use the compact `ProjectChipSelector`; beyond that a
 * search box narrows a scrollable list — a portfolio-sized project list
 * should never force scrolling through everything to find one project.
 *
 * A selected project whose CURRENT position is not Planning-backed still
 * renders honestly: `PlanningFigureStrip` already reads "N/A" for SPI and
 * Coverage rather than inventing them, and `PlanningCurveChart` already
 * states the true published-snapshot count rather than drawing a curve that
 * is not there — this view adds one explicit line stating the position's
 * real source so that honesty is not left implicit.
 */

import * as React from "react";
import { Info, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { DetailModal, DrawerFact, DrawerFactGrid, DrawerSection } from "@/components/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BASIS_LABEL, HEALTH_META, type ProjectPosition } from "../dashboard-data";
import type { ProgressCurvePoint } from "../planning-integration";
import { PlanningCurveChart, PlanningFigureStrip, ProjectChipSelector } from "./planned-vs-actual-panel";
import { signedPct } from "./dashboard-format";

/** Final Visual Polish: the reader-facing line states what the curve IS
    ("based on published Planning data dates"); the technical distinction
    from a true baseline S-curve — that a re-plan can move the Planned line
    between snapshots, which a baseline never does — moves into this info
    tooltip instead of sitting in every reader's way. */
function CurveCaveat() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          aria-label="About this progress curve"
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        Not a fabricated time-phased baseline — a re-plan can move the Planned line between snapshots, which a true
        baseline never does.
      </TooltipContent>
    </Tooltip>
  );
}

const SEARCH_THRESHOLD = 4;

export function ExpandedProgressCurveModal({
  open,
  onOpenChange,
  candidates,
  selectedProjectId,
  onSelectProject,
  curve,
  reduced,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: ProjectPosition[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  curve: ProgressCurvePoint[] | undefined;
  reduced: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const useSearch = candidates.length > SEARCH_THRESHOLD;

  const filtered = React.useMemo(() => {
    if (!useSearch || !query.trim()) return candidates;
    const q = query.trim().toLowerCase();
    return candidates.filter(
      (position) =>
        position.project.name.toLowerCase().includes(q) ||
        position.project.code?.toLowerCase().includes(q) ||
        position.project.shortName?.toLowerCase().includes(q)
    );
  }, [candidates, query, useSearch]);

  const selected = candidates.find((p) => p.project.id === selectedProjectId) ?? candidates[0];

  return (
    <DetailModal
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      title={selected ? `Project Progress — ${selected.project.shortName?.trim() || selected.project.name}` : "Project Progress Comparison"}
      description={
        <span className="inline-flex items-center gap-1.5">
          Based on published Planning data dates
          <CurveCaveat />
        </span>
      }
    >
      <div className="flex h-full min-h-0 gap-5 p-1">
        {candidates.length > 1 &&
          (useSearch ? (
            <aside className="flex w-64 shrink-0 flex-col border-r pr-4">
              <div className="relative mb-2">
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search projects…"
                  aria-label="Search projects"
                  className="w-full rounded-md border border-input bg-transparent py-1.5 pr-2 pl-8 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Projects ({filtered.length})
              </p>
              <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">No project matches &ldquo;{query}&rdquo;.</li>
                ) : (
                  filtered.map((position) => (
                    <ProjectListItem
                      key={position.project.id}
                      position={position}
                      active={position.project.id === selected?.project.id}
                      onSelect={onSelectProject}
                    />
                  ))
                )}
              </ul>
            </aside>
          ) : (
            <aside className="w-56 shrink-0 overflow-y-auto border-r pr-4">
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Projects</p>
              <ProjectChipSelector
                candidates={candidates}
                selectedProjectId={selected?.project.id ?? ""}
                onSelect={onSelectProject}
              />
            </aside>
          ))}

        <div className="min-w-0 flex-1 overflow-y-auto">
          {!selected ? (
            <p className="rounded-md bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              No project is in view for the current filters.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {selected.basis !== "planning" && (
                <p className="rounded-md bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                  This project&rsquo;s current position comes from{" "}
                  <b className="font-semibold text-foreground">
                    {selected.basis === "none" ? "no governed report yet" : BASIS_LABEL[selected.basis]}
                  </b>
                  , not a published Planning Snapshot — SPI and Coverage read N/A below, and the curve reflects only
                  whatever Planning Snapshot history this project separately has, if any.
                </p>
              )}
              <PlanningCurveChart curve={curve} reduced={reduced} height={280} />

              <DrawerSection title="Performance">
                <PlanningFigureStrip position={selected} />
              </DrawerSection>

              <DrawerSection title="Planning Basis">
                <DrawerFactGrid>
                  <DrawerFact
                    label="Source"
                    value={selected.basis === "planning" ? "Planning Snapshot" : "Not Planning-backed"}
                  />
                  <DrawerFact label="Snapshot" value={selected.snapshotVersion !== undefined ? `v${selected.snapshotVersion}` : "—"} />
                  <DrawerFact label="Data Date" value={selected.dataDate ?? "—"} />
                  <DrawerFact
                    label="Coverage"
                    value={typeof selected.coveragePercent === "number" ? `${Math.round(selected.coveragePercent)}%` : "—"}
                  />
                </DrawerFactGrid>
              </DrawerSection>
            </div>
          )}
        </div>
      </div>
    </DetailModal>
  );
}

/** One row of the searchable list — project name/code plus a health dot and
    its variance (or an explicit "No Data"), so a reader can spot a project
    worth opening without leaving the list. */
function ProjectListItem({
  position,
  active,
  onSelect,
}: {
  position: ProjectPosition;
  active: boolean;
  onSelect: (projectId: string) => void;
}) {
  const hasVariance = typeof position.variance === "number";
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(position.project.id)}
        aria-current={active}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
          active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50"
        )}
      >
        <i
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: HEALTH_META[position.health].color }}
        />
        <span className="min-w-0 flex-1 truncate">{position.project.name}</span>
        <span className="shrink-0 text-[11px] font-medium tabular-nums">
          {hasVariance ? signedPct(position.variance) : "No Data"}
        </span>
      </button>
    </li>
  );
}
