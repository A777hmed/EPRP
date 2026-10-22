"use client";

import * as React from "react";
import { Diamond, Link2 } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";
import type { PlanningEarningMethod } from "@/types";
import {
  EARNING_METHOD_LABEL,
  inheritedNodeMethod,
  levelLabel,
  parentWeightSummary,
  resolveEarningMethod,
  resolveReportingUnit,
  type ParentWeightSummary,
  type ReportingUnit,
  type WorkingPlanElement,
  type WorkingPlanTree,
} from "../../working-plan";
import {
  formatContribution,
  formatWeight,
  MASTER_PLAN_COLUMNS,
  MASTER_PLAN_TABLE_CLASS,
  masterPlanBodyCell,
  masterPlanColumns,
  masterPlanHeadCell,
  masterPlanTableMinWidth,
  type MasterPlanColumn,
} from "./master-plan-columns";
import { PlanningHelp, type PlanningHelpConcept } from "./planning-help";
import { WORK_ITEM_TYPE_LABEL } from "./work-item-labels";

/** Children total as text: "100%", "75% · 1 missing", or "No work yet". */
export function childrenTotalText(summary: ParentWeightSummary): string {
  if (summary.status === "empty") return "No work yet";
  const total = `${Math.round(summary.enteredTotal * 1000) / 1000}%`;
  return summary.missing.length > 0 ? `${total} · ${summary.missing.length} missing` : total;
}

const HEADER_HELP: Partial<Record<MasterPlanColumn, PlanningHelpConcept>> = {
  method: "earningMethod",
  local: "localWeight",
  contribution: "contribution",
  children: "childrenTotal",
  recorded: "recordedWeight",
};

/**
 * A header's text, one deliberate line per entry (each a block, 2px apart),
 * aligned by the cell (left or centre). The help icon follows the last
 * line's text, joined by a no-break space, as part of that line.
 */
function HeaderLabel({ column }: { column: MasterPlanColumn }) {
  const { header, numeric } = MASTER_PLAN_COLUMNS[column];
  const concept = HEADER_HELP[column];
  const last = header.length - 1;
  return (
    <span data-slot="header-label" className="block">
      {header.map((line, index) => (
        <span key={line} className={cn("block", index > 0 && "mt-0.5")}>
          {line}
          {index === last && concept && (
            <>
              {" "}
              {/* A 16px box (one line of header text): the 20px help button
                  is centred in it, so the icon never makes its line taller. */}
              <span className="inline-flex h-4 items-center align-top">
                <PlanningHelp concept={concept} align={numeric ? "center" : "start"} />
              </span>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

/** One line, ellipsis when it does not fit; the full text stays in the DOM and on hover. */
function Truncated({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("block truncate", className)} title={text}>
      {text}
    </span>
  );
}

/** Every empty numeric cell renders the same way: a muted em dash. */
function Empty() {
  return <span className="text-muted-foreground">—</span>;
}

function Numeric({ value }: { value: string | null }) {
  return value === null ? <Empty /> : <>{value}</>;
}

/**
 * Children total inside the table: plain right-aligned text in the status
 * colour, so it sits on the numeric column's edge exactly like a percentage.
 */
function ChildrenTotalValue({ summary }: { summary: ParentWeightSummary }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap",
        summary.status === "complete" && "font-medium text-success",
        summary.status === "incomplete" && "font-medium text-warning",
        summary.status === "empty" && "text-muted-foreground"
      )}
    >
      {childrenTotalText(summary)}
    </span>
  );
}

/**
 * The Item cell: the name first (up to two lines, full name on hover), then
 * one compact line — monospace code · classification — that ellipsizes as a
 * whole. Activities sit indented under their node in this same column.
 */
function ItemCell({
  name,
  code,
  meta,
  emphasised,
  milestone,
  badges,
}: {
  name: string;
  code?: string;
  meta: string;
  emphasised: boolean;
  milestone: boolean;
  badges?: React.ReactNode;
}) {
  const secondary = [code, meta].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      {milestone && <Diamond className="mt-1 size-3 shrink-0 text-muted-foreground" aria-label="Milestone" />}
      <div className="min-w-0 flex-1">
        <p className={cn("line-clamp-2 text-sm leading-snug break-words", emphasised && "font-semibold")} title={name}>
          {name}
        </p>
        {/* One secondary line: the code text ellipsizes first; a badge keeps
            its size, so every row stays two lines high. */}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 truncate text-xs text-muted-foreground" title={secondary}>
            {code && <span className="font-mono">{code}</span>}
            {code && meta ? " · " : ""}
            {meta}
          </p>
          {badges && <span className="flex shrink-0 items-center gap-1">{badges}</span>}
        </div>
      </div>
    </div>
  );
}

export interface MasterPlanTableProps {
  tree: WorkingPlanTree;
  /** The rows to show, in tree order (possibly filtered). */
  rows: readonly WorkingPlanElement[];
  showRecorded: boolean;
  contributions: Map<string, number | null>;
  levelLabels: readonly string[];
  projectDefault?: PlanningEarningMethod;
  describeUnit: (unit: ReportingUnit | null) => string;
  renderActions: (element: WorkingPlanElement) => React.ReactNode;
}

/**
 * Phase 13.11 — the Master Plan table (presentational). Header, body and
 * `<colgroup>` all come from {@link MASTER_PLAN_COLUMNS}. The single scroll
 * container is the Table's own; the outer frame only clips the corners and
 * gives every cell the same card surface.
 */
export function MasterPlanTable({
  tree,
  rows,
  showRecorded,
  contributions,
  levelLabels,
  projectDefault,
  describeUnit,
  renderActions,
}: MasterPlanTableProps) {
  const columns = masterPlanColumns(showRecorded);

  const cellsOf = (element: WorkingPlanElement): Record<MasterPlanColumn, React.ReactNode> => {
    const contribution = contributions.get(element.id);
    const unit = resolveReportingUnit(element);
    const unitText = unit.source === "inherited" ? `${describeUnit(unit.unit)} (inherited)` : describeUnit(unit.unit);
    const contributionCell = (
      <Numeric value={contribution === null || contribution === undefined ? null : formatContribution(contribution)} />
    );

    if (element.kind === "node") {
      const item = element.item;
      const summary = parentWeightSummary(element, element.children);
      const method = inheritedNodeMethod(element, projectDefault);
      return {
        item: (
          <ItemCell
            name={item.name}
            code={item.code}
            meta={`${WORK_ITEM_TYPE_LABEL[item.itemType]}${item.source === "import" ? " · Imported" : ""}`}
            emphasised={element.depth === 1}
            milestone={false}
            badges={
              item.isControlAccount || (item.itemType === "deliverable" && item.masterDeliverableId) ? (
                <>
                  {item.isControlAccount && (
                    <StatusBadge tone="info" hideDot>
                      Control Account
                    </StatusBadge>
                  )}
                  {item.itemType === "deliverable" && item.masterDeliverableId && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Link2 className="size-3" aria-hidden="true" />
                      Linked deliverable
                    </span>
                  )}
                </>
              ) : undefined
            }
          />
        ),
        level: <Truncated text={levelLabel(levelLabels, element.depth)} />,
        method: method ? (
          <Truncated text={`${EARNING_METHOD_LABEL[method.method]}${item.earningMethod ? "" : " (inherited)"}`} />
        ) : (
          <Empty />
        ),
        local: <Numeric value={formatWeight(item.localWeightPercent)} />,
        contribution: contributionCell,
        children: <ChildrenTotalValue summary={summary} />,
        recorded: <Numeric value={formatWeight(item.weightPercent)} />,
        reports: <Truncated text={unitText} />,
        actions: renderActions(element),
      };
    }

    const activity = element.activity;
    const method = resolveEarningMethod(element, projectDefault);
    const unattached = tree.hasHierarchy && !element.parent;
    return {
      item: (
        <ItemCell
          name={activity.name}
          code={activity.code ?? activity.externalId}
          meta={`${activity.isMilestone ? "Milestone" : "Activity"}${activity.source === "import" ? " · Imported" : ""}`}
          emphasised={false}
          milestone={activity.isMilestone}
          badges={
            unattached ? (
              <StatusBadge tone="warning" hideDot>
                Not attached to a node
              </StatusBadge>
            ) : undefined
          }
        />
      ),
      level: <Empty />,
      method: method.method ? (
        <Truncated
          text={`${EARNING_METHOD_LABEL[method.method]}${method.source === "activity" || method.source === "kind" ? "" : " (inherited)"}`}
        />
      ) : (
        <Truncated text="Not set" className="text-warning" />
      ),
      local: <Numeric value={formatWeight(activity.localWeightPercent)} />,
      contribution: contributionCell,
      children: <Empty />,
      recorded: <Numeric value={formatWeight(activity.weightPercent)} />,
      reports: <Truncated text={unitText} />,
      actions: renderActions(element),
    };
  };

  return (
    // bg-card: every cell sits on the same surface as the pinned Item cells,
    // so pinned and scrolling columns never differ in shade (either theme).
    <div className="table-frame overflow-hidden rounded-lg border bg-card">
      <Table className={MASTER_PLAN_TABLE_CLASS} style={{ minWidth: `${masterPlanTableMinWidth(columns)}rem` }}>
        <colgroup>
          {columns.map((key) => (
            <col key={key} style={{ width: `${MASTER_PLAN_COLUMNS[key].width}rem` }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((key) => (
              <TableHead key={key} scope="col" className={masterPlanHeadCell(key)}>
                <HeaderLabel column={key} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((element) => {
            const cells = cellsOf(element);
            // Activities and child nodes indent inside the Item column.
            const indent = { paddingLeft: 12 + (element.depth - 1) * 16 };
            return (
              <TableRow key={element.id} className="group/row">
                {columns.map((key) => (
                  <TableCell key={key} className={masterPlanBodyCell(key)} style={key === "item" ? indent : undefined}>
                    {cells[key]}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
