"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog, StatusBadge } from "@/components/shared";
import { projectSectionHref } from "@/config/project-sections";
import { projectWorkflowHref } from "@/config/project-workflow";
import { cn } from "@/lib/utils";
import type { PlanningOnboardingMode, Project } from "@/types";
import {
  EXTERNAL_SCHEDULE_CHOICES,
  ONBOARDING_CHOICES,
  ONBOARDING_TECHNICAL_LABEL,
  SETUP_STATE_LABEL,
  externalScheduleGuidance,
  pendingPlanningOutcome,
  planningViewHref,
  setupStateOf,
  type ExternalScheduleAnswer,
} from "../planning-experience";
import { usePlanningPosition } from "../use-planning-position";
import { useProjectWorkflow } from "../use-project-workflow";
import { PlanningStatus } from "./planning/planning-status";
import { formatDate } from "@/lib/formatters";
import { useSetupFormGovernance, type SetupFinaliseContext } from "./governance/setup-governance-ui";
import { FINALISE_EXPLANATION, FinaliseSetupDialog } from "./governance/finalise-setup-dialog";

/**
 * Phase 13.9A — Project Setup → Planning Entry (`docs/02` §26.20.1, §26.23.4).
 *
 * Asks "How will this project be planned?" over the ONE existing canonical
 * field (`project_planning_settings.onboarding_mode`, saved with the project
 * as before). "Show advanced" exposes the same value in its technical form —
 * the same state, never a copy. The external-schedule follow-up is guidance
 * only: it is never persisted (owner decision 2026-10-15). The setup state is
 * presentational; nothing is locked in 13.9A.
 */
export function PlanningEntry({
  project,
  value,
  onChange,
  readOnly = false,
  unsavedChanges = false,
  onboardingUnsaved = false,
  savedValue,
}: {
  /** The saved project; absent while a new project has not been saved. */
  project?: Project | null;
  value: PlanningOnboardingMode;
  onChange: (value: PlanningOnboardingMode) => void;
  readOnly?: boolean;
  /** The Project Setup form has unsaved work (fields, master data or this answer). */
  unsavedChanges?: boolean;
  /** The guided answer differs from what is stored. */
  onboardingUnsaved?: boolean;
  /** The stored onboarding mode; when a save changes it, the status re-reads. */
  savedValue?: PlanningOnboardingMode;
}) {
  const groupName = React.useId();
  const advancedId = React.useId();
  const router = useRouter();
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const projectId = project?.id;
  const position = usePlanningPosition(projectId, savedValue);
  // 13.9B: the governed state, when the hosting Project Setup provides it.
  const governance = useSetupFormGovernance();
  const onboardingPending = governance?.pending.get("onboarding_mode");
  // The onboarding mode is saved only for an existing project (the form's
  // save writes it after the project row) — so a brand-new project chooses it
  // after its first save rather than answering a question that is not kept.
  const questionLocked = readOnly || !project;

  /*
   * 13.9A hardening — no silent data loss. Every link in this section leaves
   * the Project Setup form. While the form has unsaved work, a plain click is
   * held and the existing ConfirmDialog asks first; a new-tab click (modifier
   * or middle button) keeps this page and its edits, so it passes through.
   */
  const guardNavigation = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!unsavedChanges) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement).closest("a[href]");
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    const href = anchor.getAttribute("href");
    if (!href || anchor.getAttribute("target") === "_blank") return;
    event.preventDefault();
    event.stopPropagation();
    setPendingHref(href);
  };

  return (
    <div className="space-y-5" onClickCapture={guardNavigation}>
      <fieldset disabled={questionLocked} className="space-y-2.5">
        <legend className="flex flex-wrap items-center gap-2 text-sm font-medium">
          How will this project be planned?
          {onboardingUnsaved && <StatusBadge tone="warning">Not saved yet</StatusBadge>}
        </legend>
        <p className="text-xs text-muted-foreground">
          {project
            ? "Choose the description that fits. It decides the next planning steps, and is saved when you save the project."
            : "Available after the project's first save — it is saved with the project from then on."}
        </p>
        <div className="grid gap-2 md:grid-cols-3" role="radiogroup">
          {ONBOARDING_CHOICES.map((choice) => {
            const checked = value === choice.value;
            return (
              <label
                key={choice.value}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors",
                  "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                  checked
                    ? "border-primary bg-primary/[0.05]"
                    : "hover:bg-muted/40",
                  questionLocked && "cursor-default opacity-80"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name={groupName}
                    value={choice.value}
                    checked={checked}
                    onChange={() => onChange(choice.value)}
                    className="size-3.5 accent-[var(--primary)]"
                  />
                  {choice.label}
                </span>
                <span className="pl-5.5 text-xs text-muted-foreground text-pretty">
                  {choice.description}
                </span>
              </label>
            );
          })}
        </div>

        <div>
          <button
            type="button"
            aria-expanded={showAdvanced}
            aria-controls={advancedId}
            onClick={() => setShowAdvanced((open) => !open)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")}
              aria-hidden="true"
            />
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </button>
          {showAdvanced && (
            <div id={advancedId} className="mt-2 grid max-w-md gap-1.5">
              <label htmlFor={`${advancedId}-select`} className="text-xs font-medium">
                Planning Onboarding Mode
              </label>
              <Select
                value={value}
                onValueChange={(next) => onChange(next as PlanningOnboardingMode)}
                disabled={questionLocked}
              >
                <SelectTrigger id={`${advancedId}-select`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ONBOARDING_CHOICES.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {ONBOARDING_TECHNICAL_LABEL[choice.value]}{" "}
                      <span className="font-mono text-muted-foreground">({choice.value})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The same setting as the question above, in its technical form.
              </p>
            </div>
          )}
        </div>
      </fieldset>

      {governance?.controlled && project && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {onboardingPending ? (
            <StatusBadge tone="warning">Planning mode change pending approval</StatusBadge>
          ) : (
            <span>
              Project Setup is controlled. How this project is planned changes only through an approved amendment.
            </span>
          )}
          {governance.canAmend && !onboardingPending && (
            <button
              type="button"
              onClick={() => governance.onAmend("onboarding_mode")}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Request amendment
            </button>
          )}
        </div>
      )}

      {value === "existing_active_project" && !questionLocked && (
        <ExternalScheduleQuestion projectId={projectId} />
      )}

      {unsavedChanges && projectId && (
        <p role="status" className="text-xs text-warning">
          Project Setup has unsaved changes. Save the project before opening the
          Planning Workspace, or your changes here will be lost.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {project ? (
          <SetupStateLine
            project={project}
            hasPublishedSnapshot={position.status === "ready" && Boolean(position.snapshot)}
            finalise={governance?.finalise}
            savedMode={savedValue}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge tone="neutral">{SETUP_STATE_LABEL.draft}</StatusBadge>
            Not saved yet.
          </div>
        )}
        {projectId && (
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={projectSectionHref(projectId, "planning")}>
              Open Planning Workspace
              <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Planning status
        </p>
        {/* While the guided answer is unsaved, show what Save will do instead
            of the (stale) saved status. Presentational only. */}
        {onboardingUnsaved && projectId ? (
          <div role="status" className="rounded-lg border border-dashed border-warning/40 bg-warning/5 px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-warning">Pending save</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              After saving, this project will be:{" "}
              <span className="font-medium text-foreground">
                “{pendingPlanningOutcome(value, position.status === "ready" && Boolean(position.snapshot))}”
              </span>
            </p>
          </div>
        ) : (
          // "Open Planning Workspace" above is the single primary CTA here.
          <PlanningStatus
            projectId={projectId}
            position={projectId ? position : undefined}
            workspaceLink={false}
          />
        )}
      </div>

      <ConfirmDialog
        open={pendingHref !== null}
        onOpenChange={(open) => {
          if (!open) setPendingHref(null);
        }}
        title="Leave without saving?"
        description="Your Project Setup changes — including how this project will be planned — have not been saved. Leaving now discards them. Stay, and save the project first to keep them."
        cancelLabel="Stay on Project Setup"
        confirmLabel="Leave without saving"
        destructive
        onConfirm={() => {
          const href = pendingHref;
          setPendingHref(null);
          if (href) router.push(href);
        }}
      />
    </div>
  );
}

/** Read-only: Draft / Ready for Planning / Controlled, derived from data that exists today. */
function SetupStateLine({
  project,
  hasPublishedSnapshot,
  finalise,
  savedMode,
}: {
  project: Project;
  hasPublishedSnapshot: boolean;
  /** 13.9B: the database-derived control state and the Finalise action. */
  finalise?: SetupFinaliseContext;
  savedMode?: PlanningOnboardingMode;
}) {
  const workflow = useProjectWorkflow(project);
  const [finaliseOpen, setFinaliseOpen] = React.useState(false);
  const required = workflow.statuses.filter((status) => status.id !== "review");
  const outstanding = required.filter((status) => !status.complete);
  // Controlled is derived by the database (first snapshot or finalisation);
  // without that input (e.g. Project Edit) the 13.9A derivation stands.
  const controlledSince = finalise?.control.controlledSince ?? null;
  const state = controlledSince
    ? "controlled"
    : setupStateOf({ setupComplete: outstanding.length === 0, hasPublishedSnapshot });
  const finalisation = finalise?.control.finalisation ?? null;
  const offerFinalise =
    Boolean(finalise?.canFinalise) && !controlledSince && savedMode === "no_formal_schedule";
  const next = outstanding[0];
  const nextLabel = next
    ? workflow.steps.find((step) => step.id === next.id)?.label
    : undefined;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <StatusBadge tone={state === "draft" ? "neutral" : "info"}>
        {SETUP_STATE_LABEL[state]}
      </StatusBadge>
      {state === "draft" && next && (
        <span>
          {outstanding.length} setup step{outstanding.length === 1 ? "" : "s"} outstanding — next:{" "}
          <Link
            href={projectWorkflowHref(project.id, next.id)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {nextLabel ?? "continue setup"}
          </Link>
        </span>
      )}
      {state === "ready" && <span>Every setup step is complete.</span>}
      {state === "controlled" && controlledSince && (
        <span>
          Controlled since {formatDate(controlledSince)} —{" "}
          {finalisation && finalisation.finalisedAt === controlledSince
            ? `Setup Finalisation${finalisation.finalisedByName ? ` by ${finalisation.finalisedByName}` : ""}`
            : "the first Published Planning Snapshot"}
          . Core configuration changes require an amendment.
        </span>
      )}
      {state === "controlled" && !controlledSince && <span>A Published Planning Snapshot exists.</span>}
      {finalisation && (
        <span className="basis-full text-pretty">
          Finalised {formatDate(finalisation.finalisedAt)}
          {finalisation.note ? ` · Note: ${finalisation.note}` : ""} · Reported — not planning governed. No
          Planning Snapshot, PV, EV or SPI was created.
        </span>
      )}
      {offerFinalise && (
        <div className="flex basis-full flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3">
          <p className="max-w-xl text-xs text-muted-foreground text-pretty">{FINALISE_EXPLANATION}</p>
          {state === "ready" ? (
            <Button type="button" size="sm" onClick={() => setFinaliseOpen(true)}>
              Finalise Project Setup
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Complete the setup steps to finalise.</span>
          )}
          <FinaliseSetupDialog
            projectId={project.id}
            open={finaliseOpen}
            onOpenChange={setFinaliseOpen}
            onFinalised={() => finalise?.onFinalised()}
          />
        </div>
      )}
    </div>
  );
}

/** Guidance only — the answer is never saved anywhere. */
function ExternalScheduleQuestion({ projectId }: { projectId?: string }) {
  const groupName = React.useId();
  const [answer, setAnswer] = React.useState<ExternalScheduleAnswer | null>(null);
  const guidance = answer ? externalScheduleGuidance(answer) : null;

  return (
    <fieldset className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <legend className="sr-only">Do you already have an external schedule?</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium" aria-hidden="true">
          Do you already have an external schedule?
        </p>
        <span className="text-[11px] text-muted-foreground">
          Optional · only suggests the next step · not saved
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup">
        {EXTERNAL_SCHEDULE_CHOICES.map((choice) => {
          const checked = answer === choice.value;
          return (
            <label
              key={choice.value}
              className={cn(
                "cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                checked
                  ? "border-primary bg-primary/[0.06] text-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={choice.value}
                checked={checked}
                onChange={() => setAnswer(choice.value)}
                className="sr-only"
              />
              {choice.label}
            </label>
          );
        })}
      </div>
      {guidance && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted-foreground text-pretty">{guidance.explanation}</p>
          {projectId ? (
            <Link
              href={planningViewHref(projectId, guidance.view)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {guidance.action}
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">
              Available in the Planning Workspace once the project is saved.
            </span>
          )}
        </div>
      )}
    </fieldset>
  );
}
