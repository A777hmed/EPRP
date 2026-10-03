"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Clock, Lock } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  evaluateDraftWorkflow,
  NEEDS_SAVED_PROJECT_MESSAGE,
  projectWorkflowHref,
  resolveSetupSteps,
  setupStepLabel,
  STRUCTURE_PLACEHOLDER_MESSAGE,
  type InfoCheckInput,
  type ProjectStepStatus,
  type ProjectWorkflowStep,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";
import type { Project, StructureFamily } from "@/types";
import { useProjectWorkflow } from "../use-project-workflow";

/**
 * Locked outranks complete: a later step can already satisfy its own checks
 * while an earlier one is unfinished, and showing it as a green tick would
 * imply it is done and reachable when it is neither.
 */
function stepTone(status: ProjectStepStatus, selected: boolean) {
  if (selected) return "selected" as const;
  if (status.lockReason === "next-phase") return "pending" as const;
  if (!status.unlocked) return "locked" as const;
  if (status.complete) return "complete" as const;
  return "current" as const;
}

/** Why a step cannot be opened, in words. Undefined when it can. */
export function workflowLockMessage(
  status: ProjectStepStatus,
  steps: ProjectWorkflowStep[]
): string | undefined {
  switch (status.lockReason) {
    case "unsaved":
      return NEEDS_SAVED_PROJECT_MESSAGE;
    case "next-phase":
      return STRUCTURE_PLACEHOLDER_MESSAGE;
    case "earlier-step":
      return `Complete ${setupStepLabel(steps, status.blockedBy ?? "info")} first`;
    default:
      return undefined;
  }
}

export interface WorkflowTrackerProps {
  steps: ProjectWorkflowStep[];
  statuses: ProjectStepStatus[];
  /** Overall completion; ignored while the project is unsaved. */
  percent: number;
  /** Absent before the first save — no step links are generated then. */
  projectId?: string;
  activeStep?: ProjectWorkflowStepId;
  /** Shown under the title, e.g. before a Project Type is chosen. */
  note?: string;
  className?: string;
}

/**
 * Horizontal setup stepper. Each step shows its own completion progress, and
 * a step stays locked until every earlier step is finished. Before the first
 * save only step 1 is live; the rest read "Available after first save".
 *
 * Sizing: the steps share the width evenly and shrink together down to a
 * readable floor, below which the strip scrolls sideways inside its own box.
 * They are deliberately NOT sized to their content — one long label would
 * then set the width for all of them.
 */
export function WorkflowTracker({
  steps,
  statuses,
  percent,
  projectId,
  activeStep,
  note,
  className,
}: WorkflowTrackerProps) {
  const saved = Boolean(projectId);

  return (
    <section
      aria-label="Project workflow"
      className={cn(
        "rounded-xl bg-card p-3 shadow-soft ring-1 ring-foreground/10",
        className
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Project Setup Workflow</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {saved ? `${percent}% complete` : "Not saved yet"}
        </p>
      </div>

      {/* The scroll container and the row must stay separate elements, or the
          row overflows its parent instead of scrolling inside it. */}
      <div className="overflow-x-auto pb-1">
        <ol className="flex w-full items-stretch gap-1">
          {steps.map((step, index) => {
            const status = statuses[index];
            const selected = activeStep === step.id;
            const tone = stepTone(status, selected);
            const lockMessage = workflowLockMessage(status, steps);
            // Opened only when it exists, is reachable and can be worked on.
            const linkable =
              saved && status.unlocked && status.lockReason === undefined;

            const body = (
              <>
                <span className="flex min-h-9 items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold",
                      tone === "selected" &&
                        "bg-primary-foreground/20 text-primary-foreground",
                      tone === "complete" && "bg-success text-background",
                      (tone === "locked" || tone === "pending") &&
                        "bg-muted text-muted-foreground",
                      tone === "current" && "bg-primary text-primary-foreground"
                    )}
                  >
                    {tone === "pending" ? (
                      <Clock className="size-3" />
                    ) : !status.unlocked && !selected ? (
                      <Lock className="size-3" />
                    ) : status.complete ? (
                      <Check className="size-3" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {/* Wraps rather than truncates: a clipped label is worse
                      than two short lines. */}
                  <span className="min-w-0 leading-tight text-pretty">
                    {step.label}
                  </span>
                </span>
                {/* `mt-auto` pins the progress to the bottom of the stretched
                    tab, so the bars and counts stay on one line across the
                    strip even when a label needs two lines. */}
                <span className="mt-auto block space-y-1 pt-2">
                  {status.total > 0 ? (
                    <>
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
                    </>
                  ) : (
                    // No invented counts for a step that cannot exist yet.
                    <span
                      className={cn(
                        "block text-[0.7rem] leading-tight",
                        tone === "selected"
                          ? "text-primary-foreground/80"
                          : "text-muted-foreground"
                      )}
                    >
                      {status.lockReason === "unsaved"
                        ? "After first save"
                        : status.lockReason === "next-phase"
                          ? "Next setup phase"
                          : "Not started"}
                    </span>
                  )}
                </span>
              </>
            );

            const shared =
              "flex w-full min-w-0 flex-col rounded-lg px-2 py-2 text-sm transition-colors";

            return (
              <li
                key={step.id}
                /* Equal share of the row, never below a readable floor. Once
                   the floors no longer fit, the wrapper above scrolls. */
                className="flex flex-1 basis-0 items-stretch gap-1 min-w-28"
              >
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "my-auto h-px w-2 shrink-0 sm:w-4",
                      statuses[index - 1].complete ? "bg-success" : "bg-border"
                    )}
                  />
                )}
                {selected ? (
                  <span
                    aria-current="step"
                    className={cn(
                      shared,
                      "bg-primary font-semibold text-primary-foreground"
                    )}
                  >
                    {body}
                  </span>
                ) : linkable && projectId ? (
                  <Link
                    href={projectWorkflowHref(projectId, step.id)}
                    className={cn(
                      shared,
                      "hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  <span
                    className={cn(shared, "cursor-not-allowed opacity-60")}
                    aria-disabled="true"
                    title={lockMessage}
                  >
                    {body}
                    {lockMessage && <span className="sr-only">{lockMessage}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

export interface ProjectWorkflowNavProps {
  project: Project;
  /** The step whose page is open, if the workflow itself is being viewed. */
  activeStep?: ProjectWorkflowStepId;
  className?: string;
}

/** The tracker for a saved project, from its persisted data. */
export function ProjectWorkflowNav({
  project,
  activeStep,
  className,
}: ProjectWorkflowNavProps) {
  const { steps, statuses, percent } = useProjectWorkflow(project);
  return (
    <WorkflowTracker
      steps={steps}
      statuses={statuses}
      percent={percent}
      projectId={project.id}
      activeStep={activeStep}
      className={className}
    />
  );
}

/**
 * The tracker for a new, unsaved project, from its live form values: step 1
 * is evaluated as it is filled in; every later step reads "Available after
 * first save". The steps follow the chosen Project Type as soon as it is
 * picked.
 */
export function DraftWorkflowNav({
  draft,
  className,
}: {
  draft: InfoCheckInput & { structureFamily?: StructureFamily };
  className?: string;
}) {
  const steps = React.useMemo(
    () => resolveSetupSteps({ structureFamily: draft.structureFamily, saved: false }),
    [draft.structureFamily]
  );
  const statuses = evaluateDraftWorkflow(draft, steps);
  return (
    <WorkflowTracker
      steps={steps}
      statuses={statuses}
      percent={0}
      activeStep="info"
      note={
        draft.structureFamily
          ? undefined
          : "Choose a Project Type to see the remaining setup steps."
      }
      className={className}
    />
  );
}
