"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle2, Minus, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LabelWithHelp } from "@/components/shared";
import { ROLE_LABELS } from "@/config/permissions";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { planningService } from "@/services/planning-service";
import type {
  PlanningConfigurationChange,
  PlanningEarningMethod,
  PlanningWeightSource,
  ProjectPlanningSettings,
} from "@/types";
import {
  cleanConfiguration,
  configurationChanged,
  configurationComplete,
  configurationOf,
  configurationProblems,
  describeConfiguration,
  EARNING_METHOD_CHOICES,
  EARNING_METHOD_LABEL,
  PLANNING_LEVEL_LIMIT,
  WEIGHT_SOURCE_CHOICES,
  weightSourceChangeNeedsReason,
  type PlanningConfigurationDraft,
} from "../../working-plan";
import { PlanningHelp } from "./planning-help";

type Mode = "guided" | "advanced";
type GuidedStep = 0 | 1 | 2 | 3;

const FIELD_LABEL: Record<PlanningConfigurationChange["fieldKey"], string> = {
  level_labels: "Breakdown levels",
  control_account_level: "Reporting level",
  weight_source: "Weights",
  default_earning_method: "Progress earned",
};

function changeValue(field: PlanningConfigurationChange["fieldKey"], value: unknown): string {
  if (value === null || value === undefined) return "not set";
  if (field === "level_labels") return Array.isArray(value) && value.length > 0 ? value.join(" → ") : "none";
  if (field === "weight_source") return WEIGHT_SOURCE_CHOICES.find((c) => c.value === value)?.label ?? String(value);
  if (field === "default_earning_method") return EARNING_METHOD_LABEL[value as PlanningEarningMethod] ?? String(value);
  return `Level ${String(value)}`;
}

/** A choice card: radio semantics, business wording first. */
function ChoiceCard({
  name,
  checked,
  disabled,
  onSelect,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
        checked && "border-primary bg-primary/[0.04]",
        disabled && "cursor-not-allowed opacity-70"
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-1 accent-primary"
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function LevelLabelsEditor({
  labels,
  onChange,
  disabled,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2">
      {labels.length === 0 && <p className="text-xs text-muted-foreground">No levels yet.</p>}
      {labels.map((label, index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">Level {index + 1}</span>
          <Input
            aria-label={`Level ${index + 1} name`}
            value={label}
            disabled={disabled}
            maxLength={60}
            onChange={(event) => onChange(labels.map((current, i) => (i === index ? event.target.value : current)))}
            placeholder={index === 0 ? "e.g. Control Account" : "e.g. Work Package"}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || labels.length >= PLANNING_LEVEL_LIMIT}
          onClick={() => onChange([...labels, ""])}
        >
          <Plus data-icon="inline-start" aria-hidden="true" /> Add level
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || labels.length === 0}
          onClick={() => onChange(labels.slice(0, -1))}
        >
          <Minus data-icon="inline-start" aria-hidden="true" /> Remove last level
        </Button>
      </div>
    </div>
  );
}

/**
 * Phase 13.11 — Planning Setup on Planning Workspace → Summary (`docs/02`
 * §26.20, `docs/07` §10.10).
 *
 * Guided and Advanced are two views of ONE Planning Configuration: the same
 * draft, the same four canonical fields, the same writer
 * (`save_planning_configuration()`). Switching view loses nothing; the guided
 * answers are pre-filled from the configuration and never stored anywhere
 * else. No calculated value is asked for or accepted. The onboarding mode is
 * Project Setup's (13.9B governance) and is not written here.
 */
export function PlanningSetupPanel({
  projectId,
  settings,
  canManage,
  hasLocalWeights,
  setupHref,
  justSaved = false,
  onSaved,
}: {
  projectId: string;
  /** `null` until the onboarding choice is saved in Project Setup. */
  settings: ProjectPlanningSettings | null;
  canManage: boolean;
  hasLocalWeights: boolean;
  setupHref: string;
  /** This configuration is the one the user has just saved: confirm it. */
  justSaved?: boolean;
  /** Called with the saved row's new version after a successful save. */
  onSaved: (updatedAt: string) => void;
}) {
  const saved = React.useMemo(() => configurationOf(settings), [settings]);
  const [draft, setDraft] = React.useState<PlanningConfigurationDraft>(saved);
  const [mode, setMode] = React.useState<Mode>("guided");
  const [step, setStep] = React.useState<GuidedStep>(0);
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [history, setHistory] = React.useState<PlanningConfigurationChange[] | undefined>();
  const [showHistory, setShowHistory] = React.useState(false);
  // A complete, saved configuration opens as its summary ("Configured");
  // editing is an explicit choice. An incomplete one opens for editing.
  const savedComplete = configurationComplete(settings);
  const [editing, setEditing] = React.useState(() => !savedComplete);

  // A newly saved configuration replaces the draft: the parent remounts this
  // panel with `key={settings.updatedAt}`.

  React.useEffect(() => {
    if (!showHistory) return;
    let cancelled = false;
    planningService.listConfigurationChanges(projectId).then(
      (rows) => !cancelled && setHistory(rows),
      () => !cancelled && setHistory([])
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, showHistory, settings?.updatedAt]);

  if (!settings) {
    return (
      <section id="planning-setup" aria-labelledby="planning-setup-title" className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
        <h2 id="planning-setup-title" className="text-sm font-semibold">
          Planning setup
        </h2>
        <p className="mt-1 text-xs text-muted-foreground text-pretty">
          First decide how the project will be planned in{" "}
          <Link href={setupHref} className="font-medium text-primary underline-offset-2 hover:underline">
            Project Setup
          </Link>
          . The breakdown, weights and progress questions follow.
        </p>
      </section>
    );
  }

  const set = <K extends keyof PlanningConfigurationDraft>(key: K, value: PlanningConfigurationDraft[K]) =>
    setDraft((current) => {
      const next = { ...current, [key]: value };
      // The reporting level must stay one of the named levels.
      if (key === "levelLabels" && next.controlAccountLevel !== undefined && next.controlAccountLevel > next.levelLabels.length) {
        next.controlAccountLevel = undefined;
      }
      return next;
    });

  const problems = configurationProblems(draft);
  const dirty = configurationChanged(saved, draft);
  const needsReason = weightSourceChangeNeedsReason(saved, draft, hasLocalWeights);
  const readOnly = !canManage;
  const labels = draft.levelLabels.map((label) => label.trim());

  const save = async () => {
    if (problems.length > 0 || !dirty || (needsReason && !reason.trim())) return;
    setSaving(true);
    try {
      const clean = cleanConfiguration(draft);
      const result = await planningService.saveConfiguration({
        projectId,
        levelLabels: clean.levelLabels,
        controlAccountLevel: clean.controlAccountLevel,
        weightSource: clean.weightSource,
        defaultEarningMethod: clean.defaultEarningMethod,
        expectedUpdatedAt: settings.updatedAt,
        reason: reason.trim() || undefined,
      });
      toast.success("Planning setup saved successfully.");
      // The parent reloads and remounts this panel on the new version; a
      // complete configuration then opens as its saved summary.
      onSaved(result.updatedAt);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the planning setup.");
    } finally {
      setSaving(false);
    }
  };

  const saveBar = (
    <div className="grid gap-3">
      {needsReason && (
        <div className="grid gap-1.5">
          <Label htmlFor="planning-setup-reason">Reason for changing where weights are managed</Label>
          <Textarea
            id="planning-setup-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Local weights already exist; say why the source changes"
          />
        </div>
      )}
      {problems.length > 0 && (
        <ul className="text-xs text-destructive">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={readOnly || saving || !dirty || problems.length > 0 || (needsReason && !reason.trim())}
        >
          {saving ? "Saving…" : "Save planning setup"}
        </Button>
        {dirty && !readOnly && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(saved)} disabled={saving}>
            Discard changes
          </Button>
        )}
        {readOnly && (
          <span className="text-xs text-muted-foreground">Project Control sets up planning for this project.</span>
        )}
      </div>
    </div>
  );

  const guided = [
    {
      title: "How is the project broken down?",
      help: "planningLevels" as const,
      why: "Name the planning levels from the top.",
      body: (
        <div className="grid gap-4">
          <LevelLabelsEditor labels={draft.levelLabels} onChange={(next) => set("levelLabels", next)} disabled={readOnly} />
          {labels.filter(Boolean).length > 0 && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">
                <LabelWithHelp help={<PlanningHelp concept="controlAccount" />}>
                  At which level is performance reported and explained?
                </LabelWithHelp>
              </legend>
              {labels.map((label, index) =>
                label ? (
                  <ChoiceCard
                    key={index}
                    name="planning-setup-ca"
                    checked={draft.controlAccountLevel === index + 1}
                    disabled={readOnly}
                    onSelect={() => set("controlAccountLevel", index + 1)}
                    title={label}
                    description={`Level ${index + 1}`}
                  />
                ) : null
              )}
            </fieldset>
          )}
        </div>
      ),
    },
    {
      title: "Are weights managed in EPRP or imported from the schedule?",
      help: "weightSource" as const,
      why: "A weight is an item's share of its parent.",
      body: (
        <fieldset className="grid gap-2">
          <legend className="sr-only">Weight source</legend>
          {WEIGHT_SOURCE_CHOICES.map((choice) => (
            <ChoiceCard
              key={choice.value}
              name="planning-setup-weights"
              checked={draft.weightSource === choice.value}
              disabled={readOnly}
              onSelect={() => set("weightSource", choice.value as PlanningWeightSource)}
              title={choice.label}
              description={choice.description}
            />
          ))}
        </fieldset>
      ),
    },
    {
      title: "How is progress earned?",
      help: "earningMethod" as const,
      why: "The default for activities; any part of the plan can differ.",
      body: (
        <fieldset className="grid gap-2">
          <legend className="sr-only">Default earning method</legend>
          {EARNING_METHOD_CHOICES.map((choice) => (
            <ChoiceCard
              key={choice.value}
              name="planning-setup-method"
              checked={draft.defaultEarningMethod === choice.value}
              disabled={readOnly}
              onSelect={() => set("defaultEarningMethod", choice.value)}
              title={choice.question}
              description={choice.description}
            />
          ))}
        </fieldset>
      ),
    },
  ];

  return (
    <section id="planning-setup" aria-labelledby="planning-setup-title" className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="planning-setup-title" className="text-sm font-semibold">
            <LabelWithHelp help={<PlanningHelp concept="planningSetup" />}>Planning setup</LabelWithHelp>
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground text-pretty">
            How this project&apos;s plan is broken down, weighted and measured.
          </p>
        </div>
        {!editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Configured
            </span>
            {canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(saved);
                  setStep(0);
                  setEditing(true);
                }}
              >
                <Pencil data-icon="inline-start" aria-hidden="true" />
                Edit planning setup
              </Button>
            )}
          </div>
        ) : (
        <div className="flex items-center gap-1">
          {savedComplete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                setDraft(saved);
                setReason("");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          )}
          <div role="group" aria-label="Planning setup view" className="inline-flex rounded-lg border p-0.5 text-xs">
          {(["guided", "advanced"] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={mode === view}
              onClick={() => setMode(view)}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium",
                mode === view ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {view === "guided" ? "Guided" : "Advanced"}
            </button>
          ))}
          </div>
          <PlanningHelp concept="setupViews" align="end" />
        </div>
        )}
      </div>

      {justSaved && (
        <p role="status" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-success">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          Planning setup saved successfully.
        </p>
      )}

      {!editing ? (
        <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-lg border p-3 text-sm sm:grid-cols-2" aria-label="Saved planning setup">
          {describeConfiguration(saved).map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="font-medium text-pretty">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : mode === "guided" ? (
        <div className="mt-4 grid gap-4">
          {step < 3 ? (
            <div className="grid gap-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Question {step + 1} of 3
              </p>
              <div>
                <h3 className="text-sm font-semibold">
                  <LabelWithHelp help={<PlanningHelp concept={guided[step].help} />}>{guided[step].title}</LabelWithHelp>
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{guided[step].why}</p>
              </div>
              {guided[step].body}
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setStep((step - 1) as GuidedStep)}>
                    <ArrowLeft data-icon="inline-start" aria-hidden="true" /> Back
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => setStep((step + 1) as GuidedStep)}>
                  {step === 2 ? "Review" : "Next"} <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <h3 className="text-sm font-semibold">Your planning setup</h3>
              <dl className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
                {describeConfiguration(draft).map((row) => (
                  <div key={row.label}>
                    <dt className="text-xs text-muted-foreground">{row.label}</dt>
                    <dd className="font-medium">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep(0)}>
                  <ArrowLeft data-icon="inline-start" aria-hidden="true" /> Change an answer
                </Button>
              </div>
              {saveBar}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <LabelWithHelp className="text-sm font-medium" help={<PlanningHelp concept="planningLevels" />}>
              Planning level labels
            </LabelWithHelp>
            <LevelLabelsEditor labels={draft.levelLabels} onChange={(next) => set("levelLabels", next)} disabled={readOnly} />
          </div>
          <div className="grid gap-1.5">
            <LabelWithHelp help={<PlanningHelp concept="controlAccount" />}>
              <Label htmlFor="planning-setup-ca-level">Control Account level</Label>
            </LabelWithHelp>
            <Select
              value={draft.controlAccountLevel ? String(draft.controlAccountLevel) : "none"}
              disabled={readOnly}
              onValueChange={(value) => set("controlAccountLevel", value === "none" ? undefined : Number(value))}
            >
              <SelectTrigger id="planning-setup-ca-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {labels.map((label, index) => (
                  <SelectItem key={index} value={String(index + 1)} disabled={!label}>
                    {index + 1} — {label || "unnamed"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <LabelWithHelp help={<PlanningHelp concept="weightSource" />}>
              <Label htmlFor="planning-setup-weight-source">Weight source</Label>
            </LabelWithHelp>
            <Select
              value={draft.weightSource ?? "none"}
              disabled={readOnly}
              onValueChange={(value) => set("weightSource", value === "none" ? undefined : (value as PlanningWeightSource))}
            >
              <SelectTrigger id="planning-setup-weight-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {WEIGHT_SOURCE_CHOICES.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <LabelWithHelp help={<PlanningHelp concept="earningMethod" />}>
              <Label htmlFor="planning-setup-method">Default earning method</Label>
            </LabelWithHelp>
            <Select
              value={draft.defaultEarningMethod ?? "none"}
              disabled={readOnly}
              onValueChange={(value) =>
                set("defaultEarningMethod", value === "none" ? undefined : (value as PlanningEarningMethod))
              }
            >
              <SelectTrigger id="planning-setup-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {EARNING_METHOD_CHOICES.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label} — {choice.question.toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">{saveBar}</div>
        </div>
      )}

      <div className="mt-4 border-t pt-3">
        <button
          type="button"
          onClick={() => setShowHistory((open) => !open)}
          aria-expanded={showHistory}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          {showHistory ? "Hide setup history" : "Show setup history"}
        </button>
        {showHistory &&
          (history === undefined ? (
            <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No changes recorded yet.</p>
          ) : (
            <ol className="mt-2 divide-y rounded-lg border text-xs">
              {history.map((change) => (
                <li key={change.id} className="space-y-0.5 px-3 py-2">
                  <p>
                    <span className="font-medium">{FIELD_LABEL[change.fieldKey]}</span>:{" "}
                    {changeValue(change.fieldKey, change.previousValue)} → {changeValue(change.fieldKey, change.newValue)}
                  </p>
                  {/* Person · role · date, time — only what the audit row really holds. */}
                  <p className="text-muted-foreground tabular-nums">
                    {[
                      change.changedByName,
                      change.changedByRole ? ROLE_LABELS[change.changedByRole] : undefined,
                      formatDateTime(change.changedAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {change.reason && (
                    <p className="text-muted-foreground text-pretty">Reason: {change.reason}</p>
                  )}
                </li>
              ))}
            </ol>
          ))}
      </div>
    </section>
  );
}
