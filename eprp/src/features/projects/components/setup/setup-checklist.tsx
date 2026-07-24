"use client";

import { Check, X } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { SectionCard, StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";
import type { ProjectStepStatus } from "@/config/project-workflow";

/**
 * A step's completion progress and the individual requirements behind it —
 * this is what tells the user exactly which data is still missing.
 */
export function SetupChecklist({ status }: { status: ProjectStepStatus }) {
  return (
    <SectionCard
      title="Required to continue"
      description={`${status.passedCount} of ${status.total} requirements met.`}
      action={
        <StatusBadge tone={status.complete ? "success" : "warning"}>
          {status.complete ? "Complete" : `${status.missing.length} missing`}
        </StatusBadge>
      }
    >
      <Progress value={status.percent} className="mb-3 h-2" />
      <ul className="space-y-1.5">
        {status.checks.map((item) => (
          <li key={item.label} className="flex items-start gap-2 text-sm">
            {item.passed ? (
              <Check
                className="mt-0.5 size-4 shrink-0 text-success"
                aria-hidden="true"
              />
            ) : (
              <X
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span>
              <span className={cn(!item.passed && "text-muted-foreground")}>
                {item.label}
              </span>
              {!item.passed && item.hint && (
                <span className="block text-xs text-muted-foreground">
                  {item.hint}
                </span>
              )}
            </span>
            <span className="sr-only">{item.passed ? "met" : "not met"}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
