"use client";

import { CalendarClock } from "lucide-react";

import { SectionCard } from "@/components/shared";
import type { LookaheadLine } from "../workspace";
import type { WeeklyNameLookup } from "./weekly-department-section";

export interface WeeklyLookaheadProps {
  lines: LookaheadLine[];
  names: WeeklyNameLookup;
  /** Wording for the scope-item level, from the project type. */
  scopeItemLabel: string;
}

/**
 * Next Week Lookahead, gathered rather than stored.
 *
 * Every line is the `nextWeekPlan` already recorded against a department or a
 * scope item, shown here under the department it came from. Nothing is copied
 * into a second field: editing the department's or the item's own update is
 * what changes this list, so the two can never drift apart, and Print has one
 * canonical source to read.
 *
 * Only lines the viewer may already see appear — the list is built from the
 * scoped department sections, not from the raw submissions.
 */
export function WeeklyLookahead({
  lines,
  names,
  scopeItemLabel,
}: WeeklyLookaheadProps) {
  const byDepartment = new Map<string, LookaheadLine[]>();
  for (const line of lines) {
    byDepartment.set(line.departmentId, [
      ...(byDepartment.get(line.departmentId) ?? []),
      line,
    ]);
  }

  return (
    <SectionCard
      title="Next Week Lookahead"
      description="What each department and scope item has planned for the coming week."
      action={
        lines.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {lines.length} planned
          </span>
        ) : undefined
      }
      contentClassName="space-y-3"
    >
      {lines.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
          No next-week plans have been recorded yet. They are written on each
          department and {scopeItemLabel.toLowerCase()} update.
        </p>
      ) : (
        [...byDepartment.entries()].map(([departmentId, group]) => (
          <div key={departmentId} className="space-y-1">
            <p className="text-xs font-semibold">
              {names.department(departmentId)?.name ?? "Unknown department"}
            </p>
            <ul className="space-y-1">
              {group.map((line, index) => (
                <li
                  key={`${line.scopeItemId ?? "overall"}-${index}`}
                  className="flex flex-wrap gap-x-2 text-sm"
                >
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {line.scopeItemId
                      ? (names.scopeItem(line.scopeItemId)?.name ??
                        "Unnamed item")
                      : "Department-wide"}
                  </span>
                  <span className="min-w-0 flex-1 text-pretty">{line.plan}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </SectionCard>
  );
}
