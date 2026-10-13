import * as React from "react";
import { ChevronDown, ChevronRight, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Project } from "@/types";
import {
  peopleChartLayout,
  type PeopleChart,
  type PeopleChartNode,
} from "@/features/projects/people-chart";
import { PeopleChartCard, PeopleChartRootCard } from "./people-chart-card";

/** Connector colour: visible on the canvas in light and dark, never loud. */
const LINE = "bg-muted-foreground/30";

interface TreeProps {
  chart: PeopleChart;
  project: Pick<Project, "code" | "name" | "shortName" | "structureFamily" | "status">;
  /** Managers whose direct reports are hidden. */
  collapsed: ReadonlySet<string>;
  onToggle: (memberId: string) => void;
}

const reportsLabel = (count: number) => (count === 1 ? "1 direct report" : `${count} direct reports`);

/* --------------------------------- chart --------------------------------- */

/**
 * Top-down chart: the project at the top, then each person over their direct
 * reports, joined by straight vertical / horizontal connectors. A manager's
 * reports sit side by side; three or more reports with nobody under them
 * hang in two columns either side of one line, so a flat team stays compact.
 * Wider than the screen, the canvas scrolls sideways; narrower, it centres.
 */
export function PeopleChartTree({ chart, project, collapsed, onToggle }: TreeProps) {
  return (
    <div
      data-people-chart-view="chart"
      className="overflow-x-auto overscroll-x-contain rounded-lg border bg-muted/30"
    >
      <div className="mx-auto flex w-max min-w-full flex-col items-center px-6 py-6">
        <PeopleChartRootCard
          project={project}
          memberCount={chart.memberCount}
          reportingLines={chart.reportingLines}
          layout="chart"
        />
        {chart.roots.length > 0 && (
          <Branch nodes={chart.roots} collapsed={collapsed} onToggle={onToggle} />
        )}
      </div>
    </div>
  );
}

function Branch({
  nodes,
  collapsed,
  onToggle,
}: {
  nodes: PeopleChartNode[];
  collapsed: ReadonlySet<string>;
  onToggle: (memberId: string) => void;
}) {
  const { hang, row } = peopleChartLayout(nodes);
  return (
    <>
      <span className={cn("h-4 w-px shrink-0", LINE)} aria-hidden="true" />
      {hang.length > 0 && <HangingReports nodes={hang} continues={row.length > 0} />}
      {hang.length > 0 && row.length > 0 && <span className={cn("h-4 w-px shrink-0", LINE)} aria-hidden="true" />}
      {row.length > 0 && (
        <ul className="flex items-start" data-people-chart-row>
          {row.map((node, index) => (
            <li key={node.memberId} className="relative flex flex-col items-center px-2.5 pt-4">
              {/* The bus joining siblings, drawn half on each side of a card. */}
              {row.length > 1 && (
                <span
                  className={cn(
                    "absolute top-0 h-px",
                    LINE,
                    index === 0 ? "right-0 left-1/2" : index === row.length - 1 ? "right-1/2 left-0" : "inset-x-0"
                  )}
                  aria-hidden="true"
                />
              )}
              <span className={cn("absolute top-0 left-[calc(50%-0.5px)] h-4 w-px", LINE)} aria-hidden="true" />
              <ChartPerson node={node} collapsed={collapsed} onToggle={onToggle} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ChartPerson({
  node,
  collapsed,
  onToggle,
}: {
  node: PeopleChartNode;
  collapsed: ReadonlySet<string>;
  onToggle: (memberId: string) => void;
}) {
  const hasReports = node.children.length > 0;
  const open = hasReports && !collapsed.has(node.memberId);
  return (
    <div className="flex flex-col items-center">
      <PeopleChartCard node={node} layout="chart" />
      {hasReports && (
        <>
          <span className={cn("h-2 w-px shrink-0", LINE)} aria-hidden="true" />
          <button
            type="button"
            onClick={() => onToggle(node.memberId)}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${node.name}'s ${reportsLabel(node.children.length)}`}
            title={`${reportsLabel(node.children.length)} · ${node.descendantCount} in total`}
            className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full border bg-card px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground shadow-xs transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            <Users className="size-3" aria-hidden="true" />
            {open ? node.children.length : node.descendantCount}
            <ChevronDown
              className={cn("size-3 transition-transform motion-reduce:transition-none", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
          {open && <Branch nodes={node.children} collapsed={collapsed} onToggle={onToggle} />}
        </>
      )}
    </div>
  );
}

/**
 * Leaf reports in two columns either side of a single line descending from
 * the manager. Read left to right, row by row. When the manager also has
 * reports with teams of their own, the line `continues` down to them.
 */
function HangingReports({ nodes, continues }: { nodes: PeopleChartNode[]; continues: boolean }) {
  const rows: [PeopleChartNode, PeopleChartNode | undefined][] = [];
  for (let index = 0; index < nodes.length; index += 2) rows.push([nodes[index], nodes[index + 1]]);
  return (
    <div className="grid grid-cols-[15rem_2.5rem_15rem]" data-people-chart-hang>
      {rows.map(([left, right], row) => (
        <React.Fragment key={left.memberId}>
          <div className="flex items-center justify-end py-1.5">
            <PeopleChartCard node={left} layout="chart" />
          </div>
          <div className="relative" aria-hidden="true">
            <span
              className={cn(
                "absolute top-0 left-[calc(50%-0.5px)] w-px",
                LINE,
                row === rows.length - 1 && !continues ? "h-1/2" : "h-full"
              )}
            />
            <span className={cn("absolute top-1/2 left-0 h-px w-1/2", LINE)} />
            {right && <span className={cn("absolute top-1/2 right-0 h-px w-1/2", LINE)} />}
          </div>
          <div className="flex items-center py-1.5">
            {right && <PeopleChartCard node={right} layout="chart" />}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* -------------------------------- outline -------------------------------- */

/**
 * The same chart as an indented outline — for narrow screens, and for
 * scanning a large team. Each level hangs from its manager on a left rail.
 */
export function PeopleChartOutline({ chart, project, collapsed, onToggle }: TreeProps) {
  return (
    <div data-people-chart-view="outline">
      <PeopleChartRootCard
        project={project}
        memberCount={chart.memberCount}
        reportingLines={chart.reportingLines}
        layout="outline"
      />
      {chart.roots.length > 0 && (
        <OutlineLevel nodes={chart.roots} collapsed={collapsed} onToggle={onToggle} />
      )}
    </div>
  );
}

function OutlineLevel({
  nodes,
  collapsed,
  onToggle,
}: {
  nodes: PeopleChartNode[];
  collapsed: ReadonlySet<string>;
  onToggle: (memberId: string) => void;
}) {
  return (
    <ul className="ml-3">
      {nodes.map((node, index) => {
        const last = index === nodes.length - 1;
        const hasReports = node.children.length > 0;
        const open = hasReports && !collapsed.has(node.memberId);
        return (
          <li key={node.memberId} className="relative pt-2 pl-5">
            <span className={cn("absolute top-0 left-0 w-px", LINE, last ? "h-7" : "h-full")} aria-hidden="true" />
            <span className={cn("absolute top-7 left-0 h-px w-5", LINE)} aria-hidden="true" />
            <PeopleChartCard node={node} layout="outline" />
            {hasReports && (
              <button
                type="button"
                onClick={() => onToggle(node.memberId)}
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} ${node.name}'s ${reportsLabel(node.children.length)}`}
                className="mt-1 inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <ChevronRight
                  className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-90")}
                  aria-hidden="true"
                />
                {reportsLabel(node.children.length)}
                {!open && node.descendantCount > node.children.length && (
                  <span className="tabular-nums">· {node.descendantCount} in total</span>
                )}
              </button>
            )}
            {open && <OutlineLevel nodes={node.children} collapsed={collapsed} onToggle={onToggle} />}
          </li>
        );
      })}
    </ul>
  );
}
