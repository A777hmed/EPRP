"use client";

import Link from "next/link";
import { ArrowRight, Ban, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BlockerGroup, RemovalAssessment } from "../../structure-dependencies";

/**
 * The shared "what this removal does / what is in the way" block of every
 * governed removal dialog (PSM Departments, Systems, Programs & Studies and
 * the Other-project hierarchy). Presentation only — the assessment comes from
 * `structure-dependencies.ts`, the database still refuses what it must.
 */
export function RemovalImpact({
  assessment,
  onFix,
}: {
  assessment: RemovalAssessment;
  /** Offered fix actions that open a request in place (Other projects). */
  onFix?: (unitId: string) => void;
}) {
  return (
    <div className="space-y-3">
      {assessment.impact.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground text-pretty">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            {assessment.impact.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      )}
      {assessment.blockers.map((group) => (
        <BlockedGroup key={group.heading} group={group} onFix={onFix} />
      ))}
    </div>
  );
}

function BlockedGroup({ group, onFix }: { group: BlockerGroup; onFix?: (unitId: string) => void }) {
  return (
    <section
      role="alert"
      aria-label="This removal is blocked"
      className="space-y-2 rounded-md border border-warning/40 bg-warning/[0.07] p-3 text-sm"
    >
      <p className="flex items-start gap-2 font-medium text-foreground text-pretty">
        <Ban className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>Removal is blocked. {group.heading}</span>
      </p>
      {group.items.length > 0 && (
        <ul className="space-y-1 pl-6">
          {group.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 text-pretty">
                <span className="font-medium">{item.label}</span>
                {item.detail && <span className="text-muted-foreground"> — {item.detail}</span>}
                {item.note && <span className="text-xs text-warning"> · {item.note}</span>}
              </span>
              {item.fix && onFix && (
                <Button type="button" size="sm" variant="outline" onClick={() => onFix(item.fix!.unitId)}>
                  {item.fix.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className={cn("pl-6 text-xs text-muted-foreground text-pretty")}>{group.todo}</p>
      {group.link && (
        <p className="pl-6">
          <Button type="button" size="sm" variant="outline" asChild>
            <Link href={group.link.href}>
              {group.link.label}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </p>
      )}
    </section>
  );
}
