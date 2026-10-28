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
  masterPlanItemIndent,
  masterPlanTableMinWidth,
  splitUnitPath,
  type MasterPlanColumn,
  type MasterPlanRowTone,
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

/**
 * A value over a quiet qualifier ("Percent Complete" over "Inherited"), so a
 * qualifier never truncates the value itself; the row keeps its two lines.
 */
function Stacked({ value, note, title, className }: { value: string; note?: string; title?: string; className?: string }) {
  return (
    <span className="block min-w-0" title={title ?? (note ? `${value} · ${note}` : value)}>
      <span className={cn("block truncate", className)}>{value}</span>
      {note && <span className="block truncate text-[11px] leading-4 text-muted-foreground">{note}</span>}
    </span>
  );
}

/** A compact, square designation tag — recognisable at a glance, never a large pill. */
function Tag({ tone, children }: { tone: "info" | "warning"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 items-center rounded-sm border px-1 text-[10px] font-semibold tracking-wide uppercase",
        tone === "info" ? "border-info/40 text-info" : "border-warning/40 text-warning"
      )}
    >
      {children}
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

/** How strongly an Item's name reads: a first-level node, a deeper node, or an activity. */
type ItemWeight = "group" | "node" | "leaf";

/**
 * The Item cell: the name on one line (ellipsis; full name on hover), then
 * one quieter line — monospace code · classification — that ellipsizes as a
 * whole. Every row is therefore exactly two lines high. Activities sit
 * indented under their node in this same column.
 */
function ItemCell({
  name,
  code,
  meta,
  weight,
  milestone,
  badges,
}: {
  name: string;
  code?: string;
  meta: string;
  weight: ItemWeight;
  milestone: boolean;
  badges?: React.ReactNode;
}) {
  const secondary = [code, meta].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      {milestone && <Diamond className="mt-1 size-3 shrink-0 text-muted-foreground" aria-label="Milestone" />}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-[13px] leading-5 text-foreground",
            weight === "group" && "font-semibold",
            weight === "node" && "font-medium"
          )}
          title={name}
        >
          {name}
        </p>
        {/* One secondary line: the code text ellipsizes first; a tag keeps
            its size, so every row stays two lines high. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 truncate text-[11px] leading-4 text-muted-foreground" title={secondary}>
            {code && <span className="font-mono tracking-tight">{code}</span>}
            {code && meta ? " · " : ""}
            {meta}
          </p>
          {badges && <span className="flex shrink-0 items-center gap-1">{badges}</span>}
        </div>
      </div>
    </div>
  );
}

/** "Reports in": the reporting unit itself, over the path above it (and whether it is inherited). */
function ReportingUnitCell({ text, inherited }: { text: string; inherited: boolean }) {
  const { unit, path } = splitUnitPath(text);
  const note = [path, inherited ? "inherited" : ""].filter(Boolean).join(" · ");
  return <Stacked value={unit} note={note || undefined} title={inherited ? `${text} (inherited)` : text} />;
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
 * Phase 13.11 — the Master Plan table (presentational); 13.12 closure polish.
 * Header, body and `<colgroup>` all come from {@link MASTER_PLAN_COLUMNS}.
 * The single scroll container is the Table's own; the outer frame clips the
 * corners and gives every cell the same card surface. First-level nodes are
 * group rows; deeper rows indent beneath them with one guide per level.
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
    const reportsCell = <ReportingUnitCell text={describeUnit(unit.unit)} inherited={unit.source === "inherited"} />;
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
            weight={element.depth === 1 ? "group" : "node"}
            milestone={false}
            badges={
              item.isControlAccount || (item.itemType === "deliverable" && item.masterDeliverableId) ? (
                <>
                  {item.isControlAccount && <Tag tone="info">Control account</Tag>}
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
          <Stacked value={EARNING_METHOD_LABEL[method.method]} note={item.earningMethod ? undefined : "Inherited"} />
        ) : (
          <Empty />
        ),
        local: <Numeric value={formatWeight(item.localWeightPercent)} />,
        contribution: contributionCell,
        children: <ChildrenTotalValue summary={summary} />,
        recorded: <Numeric value={formatWeight(item.weightPercent)} />,
        reports: reportsCell,
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
          weight="leaf"
          milestone={activity.isMilestone}
          badges={unattached ? <Tag tone="warning">Not attached to a node</Tag> : undefined}
        />
      ),
      level: <Empty />,
      method: method.method ? (
        <Stacked
          value={EARNING_METHOD_LABEL[method.method]}
          note={method.source === "activity" || method.source === "kind" ? undefined : "Inherited"}
        />
      ) : (
        <Truncated text="Not set" className="text-warning" />
      ),
      local: <Numeric value={formatWeight(activity.localWeightPercent)} />,
      contribution: contributionCell,
      children: <Empty />,
      recorded: <Numeric value={formatWeight(activity.weightPercent)} />,
      reports: reportsCell,
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
            const tone: MasterPlanRowTone = element.kind === "node" && element.depth === 1 ? "band" : "plain";
            // Activities and child nodes indent inside the Item column, under one guide per level.
            const indent = masterPlanItemIndent(element.depth);
            return (
              <TableRow
                key={element.id}
                className="group/row hover:bg-transparent"
                data-row-kind={element.kind}
                data-depth={element.depth}
              >
                {columns.map((key) => (
                  <TableCell key={key} className={masterPlanBodyCell(key, tone)} style={key === "item" ? indent : undefined}>
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
