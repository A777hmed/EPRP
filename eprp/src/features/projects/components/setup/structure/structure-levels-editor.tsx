"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_STRUCTURE_LEVELS } from "@/types/project-structure";
import type { ProjectStructureWorkspaceProps } from "../../../structure/structure-workspace-contract";
import { levelConfigurationIssues, nodesByLevel, archivedNodes, STRUCTURE_LABEL_MAX } from "../../../structure/structure-rules";
import {
  canRemoveDeepestLevel, createLevelsDraft, levelIssueMessage, levelsAreDirty, levelsDraftReducer,
} from "../../../structure/structure-levels-draft";
import { STRUCTURE_PATTERNS, hierarchyLayerName, recognizeStructurePattern, structurePatternName, type StructurePresetId } from "../../../structure/structure-patterns-ui";

/** Level configuration only, over the frozen workspace contract. */
export function StructureLevelsEditor({ structure, canManage, actions }: ProjectStructureWorkspaceProps) {
  const [draft, dispatch] = React.useReducer(levelsDraftReducer, structure, createLevelsDraft);
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [customOpen, setCustomOpen] = React.useState(false);
  const [customSelected, setCustomSelected] = React.useState(false);
  const id = React.useId();
  const formRef = React.useRef<HTMLFormElement>(null);
  const submitting = React.useRef(false);
  const dirty = levelsAreDirty(draft);
  // Comparing the supplied snapshot's identity prevents a dirty draft from
  // being saved through actions that belong to a newer container read.
  const changedOutside = draft.source !== structure;
  if (changedOutside && !draft.saving && (draft.awaitingReload || (!dirty && !draft.stale))) {
    dispatch({ type: "receive", source: structure });
  }
  const blocked = draft.stale || changedOutside;
  const busy = draft.saving || draft.awaitingReload;
  const issues = levelConfigurationIssues(draft.source, draft.levels);
  const active = nodesByLevel(structure);
  const archived = archivedNodes(structure.nodes);
  const removable = canRemoveDeepestLevel(draft);
  const canChoosePattern = canManage && structure.nodes.length === 0;
  const pattern = customSelected ? "custom" : recognizeStructurePattern(draft.levels);

  function choosePattern(patternId: StructurePresetId | "custom") {
    if (!canChoosePattern || busy || blocked) return;
    setTouched({});
    setCustomSelected(patternId === "custom");
    setCustomOpen(patternId === "custom");
    if (patternId === "custom") {
      if (draft.levels.length === 0) dispatch({ type: "append" });
    } else dispatch({ type: "pattern", pattern: patternId });
  }

  React.useEffect(() => {
    if (!dirty || !canManage) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, canManage]);

  function reset() {
    dispatch({ type: "reset", source: structure });
    setTouched({});
    setCustomSelected(false);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !dirty || busy || blocked || submitting.current) return;
    if (issues.length > 0) {
      setTouched(Object.fromEntries(draft.levels.flatMap((level) =>
        ["singularLabel", "pluralLabel"].map((field) => [`${level.levelNumber}-${field}`, true]))));
      const first = issues.find((issue) => issue.field && issue.levelNumber);
      if (first) {
        const input = formRef.current?.elements.namedItem(`${id}-${first.levelNumber}-${first.field}`);
        if (input instanceof HTMLInputElement) input.focus();
      }
      return;
    }
    submitting.current = true;
    dispatch({ type: "saveStarted" });
    try {
      await actions.configureLevels(draft.levels.map((level) => ({
        ...level, singularLabel: level.singularLabel.trim(), pluralLabel: level.pluralLabel.trim(),
      })));
      dispatch({ type: "saveSucceeded" });
      setTouched({});
      toast.success("Hierarchy levels saved");
    } catch (error: unknown) {
      dispatch({ type: "saveFailed", error });
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form ref={formRef} onSubmit={save} noValidate className="min-w-0 space-y-4" aria-label="Hierarchy level configuration" aria-busy={busy}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Step 1 · How is this project organized?</h3>
          <p className="mt-1 text-xs text-muted-foreground">Choose the types of groups this project needs. Actual project groups are added in the next section.</p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{draft.levels.length} of {MAX_STRUCTURE_LEVELS} layers</span>
      </div>

      {canChoosePattern && <fieldset disabled={busy || blocked} className="space-y-2">
        <legend className="text-sm font-medium">Structure pattern</legend>
        <p id={`${id}-pattern-hint`} className="text-xs text-muted-foreground">Choose a starting pattern or use your own names. Nothing is saved until you select Save Changes.</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[...STRUCTURE_PATTERNS, { id: "custom" as const, name: "Custom structure", labels: [] }].map((option) => (
            <Label key={option.id} htmlFor={`${id}-pattern-${option.id}`} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${pattern === option.id && draft.levels.length > 0 ? "border-primary bg-accent/40" : "hover:bg-muted/40"}`}>
              <input id={`${id}-pattern-${option.id}`} name={`${id}-pattern`} type="radio" checked={draft.levels.length > 0 && pattern === option.id} aria-describedby={`${id}-pattern-hint`} className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onChange={() => choosePattern(option.id)} />
              <span className="min-w-0"><span className="block text-sm font-medium">{option.name}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{option.id === "custom" ? "Choose your own group names · 1–4 layers" : `Project → ${option.labels.map(([singular]) => singular).join(" → ")}`}</span></span>
            </Label>
          ))}
        </div>
      </fieldset>}

      {draft.levels.length > 0 && <section className="space-y-2 rounded-md bg-muted/30 p-3" aria-label="Structure preview" aria-live="polite">
        <div className="flex flex-wrap justify-between gap-2"><h4 className="text-xs font-semibold">Structure preview</h4><span className="text-xs text-muted-foreground">{dirty ? "Draft pattern" : "Current pattern"}: {structurePatternName(draft.levels)}</span></div>
        <p className="text-sm font-medium">Project</p>
        <ol className="space-y-1">{draft.levels.map((level) => <li key={level.id ?? `preview-${level.levelNumber}`} style={{ marginInlineStart: `${(level.levelNumber - 1) * 0.75}rem` }} className="flex min-w-0 items-center gap-2 border-l-2 pl-3 text-sm"><span aria-hidden="true" className="w-3 shrink-0 border-t-2" /><span className="break-words">{level.singularLabel || hierarchyLayerName(level.levelNumber)}</span></li>)}</ol>
        <p className="text-xs text-muted-foreground">Structure types define how the project is organized. Actual project groups are added in the next section.</p>
      </section>}

      <details open={customOpen} onToggle={(event) => setCustomOpen(event.currentTarget.open)} className="group space-y-3">
        <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">{canManage ? "Customize hierarchy" : "View hierarchy labels"}</summary>

      {draft.levels.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-5">
          <p className="text-sm font-medium">No structure pattern yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Start with one main grouping. A single layer is a complete, valid structure.</p>
          {canManage && (
            <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={busy || blocked} onClick={() => dispatch({ type: "append" })}>
              <Plus aria-hidden="true" /> Add first grouping
            </Button>
          )}
        </div>
      ) : (
        <ol className="divide-y rounded-lg border">
          {draft.levels.map((level, index) => {
            const activeCount = active.get(level.levelNumber)?.length ?? 0;
            const archivedCount = archived.filter((node) => node.levelNumber === level.levelNumber).length;
            const inUse = activeCount + archivedCount > 0;
            return (
              <li key={level.id ?? `new-${level.levelNumber}`} className="grid min-w-0 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_10rem]">
                <div className="text-sm font-semibold sm:col-span-2 lg:col-span-1 lg:pt-7">{hierarchyLayerName(level.levelNumber)}<span className="mt-1 block text-xs font-normal text-muted-foreground">Level {level.levelNumber}</span></div>
                {(["singularLabel", "pluralLabel"] as const).map((field) => {
                  const fieldKey = `${level.levelNumber}-${field}`;
                  const inputId = `${id}-${fieldKey}`;
                  const issue = issues.find((entry) => entry.levelNumber === level.levelNumber && entry.field === field);
                  const error = touched[fieldKey] && issue ? levelIssueMessage(issue) : null;
                  return (
                    <div key={field} className="min-w-0 space-y-1.5">
                      <Label htmlFor={inputId}>{field === "singularLabel" ? "What is one group called?" : "What are multiple groups called?"}<span className="sr-only"> for {hierarchyLayerName(level.levelNumber)} (required)</span></Label>
                      <Input id={inputId} value={level[field]} required maxLength={STRUCTURE_LABEL_MAX} autoComplete="off" className="min-h-11"
                        readOnly={!canManage} disabled={canManage && (busy || blocked)} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined}
                        onChange={(event) => dispatch({ type: "edit", levelNumber: level.levelNumber, field, value: event.target.value })}
                        onBlur={() => setTouched((previous) => ({ ...previous, [fieldKey]: true }))} />
                      {error && <p id={`${inputId}-error`} className="text-xs text-destructive" role="alert">{error}</p>}
                    </div>
                  );
                })}
                <div className="space-y-1 text-xs text-muted-foreground sm:col-span-2 lg:col-span-1 lg:pt-6">
                  <p className="tabular-nums">{activeCount} active {activeCount === 1 ? level.singularLabel : level.pluralLabel}{archivedCount > 0 && ` · ${archivedCount} archived`}</p>
                  <p>{inUse ? "In use · labels can be renamed" : "Unused level"}</p>
                  {canManage && index === draft.levels.length - 1 && removable ? (
                    <Button type="button" variant="ghost" className="min-h-11 px-2" aria-label={`Remove Level ${level.levelNumber}`} disabled={busy || blocked} onClick={() => dispatch({ type: "removeDeepest" })}>
                      <Trash2 aria-hidden="true" /> Remove layer
                    </Button>
                  ) : canManage && <p>{inUse ? "Cannot remove while in use" : index < draft.levels.length - 1 ? "Remove deeper levels first" : "Keep at least one level"}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canManage && draft.levels.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" className="min-h-11" disabled={busy || blocked || draft.levels.length >= MAX_STRUCTURE_LEVELS} onClick={() => dispatch({ type: "append" })}>
            <Plus aria-hidden="true" /> Add another layer
          </Button>
          <p className="text-xs text-muted-foreground">{draft.levels.length >= MAX_STRUCTURE_LEVELS ? "Maximum of four layers reached." : "Add another layer only if these groups need to be divided further."}</p>
        </div>
      )}
      </details>

      {canManage && (
        <>
          <div aria-live="polite" className="space-y-2 text-sm">
            {draft.error && <p role="alert" className="text-destructive">{draft.error}</p>}
            {blocked && <p role="alert">Your edits are kept. Reload and discard edits to use the current configuration before saving again.</p>}
            {dirty && !blocked && !busy && <p className="text-xs text-muted-foreground">Unsaved changes. {issues.length > 0 ? "Complete both labels with unique names before saving." : "Save the complete hierarchy when ready."}</p>}
            {issues.filter((issue) => !issue.field).map((issue, index) => dirty && <p key={index} role="alert" className="text-destructive">{levelIssueMessage(issue)}</p>)}
            {draft.awaitingReload && <p>Refreshing the configuration…</p>}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            {blocked ? (
              <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => { dispatch({ type: "reload", source: structure }); setTouched({}); setCustomSelected(false); actions.refresh(); }}>Reload and discard edits</Button>
            ) : (
              <Button type="button" variant="outline" className="min-h-11" disabled={!dirty || busy} onClick={reset}>Reset changes</Button>
            )}
            <Button type="submit" className="min-h-11" disabled={!dirty || busy || blocked || issues.length > 0}>{draft.saving ? "Saving…" : "Save Changes"}</Button>
          </div>
        </>
      )}
    </form>
  );
}
