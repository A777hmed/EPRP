"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  getProjectWorkflowStep,
  projectWorkflowHref,
  projectWorkflowSteps,
  type ProjectStepStatus,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";
import type { Project } from "@/types";
import { useProjectWorkflow } from "../use-project-workflow";

export interface ProjectWorkflowNavProps {
  project: Project;
  /** The step whose page is open, if the workflow itself is being viewed. */
  activeStep?: ProjectWorkflowStepId;
  className?: string;
}

/**
 * Locked outranks complete: a later step can already satisfy its own checks
 * while an earlier one is unfinished, and showing it as a green tick would
 * imply it is done and reachable when it is neither.
 */
function stepTone(status: ProjectStepStatus, selected: boolean) {
  if (selected) return "selected" as const;
  if (!status.unlocked) return "locked" as const;
  if (status.complete) return "complete" as const;
  return "current" as const;
}

/**
 * Horizontal setup stepper. Steps run Project Info → Departments → Systems →
 * Disciplines → Contacts → Review; each shows its own completion progress,
 * and a step stays locked until every earlier step is finished. On narrow
 * screens the row scrolls sideways so the sequence stays readable.
 */
export function ProjectWorkflowNav({
  project,
  activeStep,
  className,
}: ProjectWorkflowNavProps) {
  const { statuses, percent } = useProjectWorkflow(project);

  return (
    <section
      aria-label="Project workflow"
      className={cn(
        "rounded-xl bg-card p-3 shadow-soft ring-1 ring-foreground/10",
        className
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Project Setup Workflow</h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {percent}% complete
        </p>
      </div>

      {/* The scroll container and the min-width row must be separate elements,
          or the row overflows its parent instead of scrolling inside it. */}
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-max items-stretch gap-1">
        {projectWorkflowSteps.map((step, index) => {
          const status = statuses[index];
          const selected = activeStep === step.id;
          const tone = stepTone(status, selected);
          const locked = !status.unlocked;

          const body = (
            <>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold",
                    tone === "selected" &&
                      "bg-primary-foreground/20 text-primary-foreground",
                    tone === "complete" && "bg-success text-background",
                    tone === "locked" && "bg-muted text-muted-foreground",
                    tone === "current" && "bg-primary text-primary-foreground"
                  )}
                >
                  {locked ? (
                    <Lock className="size-3" />
                  ) : status.complete ? (
                    <Check className="size-3" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="whitespace-nowrap">{step.label}</span>
              </span>
              <span className="mt-2 block space-y-1">
                <Progress
                  value={status.percent}
                  className={cn(
                    "h-1",
                    tone === "selected" && "bg-primary-foreground/25"
                  )}
                />
                <span
                  className={cn(
                    "block text-[0.7rem] tabular-nums",
                    tone === "selected"
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground"
                  )}
                >
                  {status.passedCount} of {status.total}
                </span>
              </span>
            </>
          );

          const shared =
            "flex w-40 flex-col rounded-lg px-2.5 py-2 text-sm transition-colors";

          return (
            <li key={step.id} className="flex items-stretch gap-1">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "my-auto h-px w-3 shrink-0 sm:w-5",
                    statuses[index - 1].complete ? "bg-success" : "bg-border"
                  )}
                />
              )}
              {locked ? (
                <span
                  className={cn(shared, "cursor-not-allowed opacity-60")}
                  aria-disabled="true"
                  title={`Complete ${
                    getProjectWorkflowStep(status.blockedBy ?? "info").label
                  } first`}
                >
                  {body}
                  <span className="sr-only">
                    Locked until{" "}
                    {getProjectWorkflowStep(status.blockedBy ?? "info").label}{" "}
                    is complete
                  </span>
                </span>
              ) : (
                <Link
                  href={projectWorkflowHref(project.id, step.id)}
                  aria-current={selected ? "step" : undefined}
                  className={cn(
                    shared,
                    "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected
                      ? "bg-primary font-semibold text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
        </ol>
      </div>
    </section>
  );
}
