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

/** Level configuration only, over the frozen workspace contract. */
export function StructureLevelsEditor({ structure, canManage, actions }: ProjectStructureWorkspaceProps) {
  const [draft, dispatch] = React.useReducer(levelsDraftReducer, structure, createLevelsDraft);
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
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
          <h3 className="text-sm font-semibold">Step 1 · Configure hierarchy levels</h3>
          <p className="mt-1 text-xs text-muted-foreground">Levels define the types of hierarchy; units are the actual items within those levels. Name each type from broadest to deepest. Both labels are required.</p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{draft.levels.length} of {MAX_STRUCTURE_LEVELS} levels</span>
      </div>

      {draft.levels.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-5">
          <p className="text-sm font-medium">No structure levels yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Define the hierarchy types for this project before adding the actual items.</p>
          {canManage && (
            <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={busy || blocked} onClick={() => dispatch({ type: "append" })}>
              <Plus aria-hidden="true" /> Add first level
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
              <li key={level.id ?? `new-${level.levelNumber}`} className="grid min-w-0 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_10rem]">
                <div className="text-sm font-semibold sm:col-span-2 lg:col-span-1 lg:pt-7">Level {level.levelNumber}</div>
                {(["singularLabel", "pluralLabel"] as const).map((field) => {
                  const fieldKey = `${level.levelNumber}-${field}`;
                  const inputId = `${id}-${fieldKey}`;
                  const issue = issues.find((entry) => entry.levelNumber === level.levelNumber && entry.field === field);
                  const error = touched[fieldKey] && issue ? levelIssueMessage(issue) : null;
                  return (
                    <div key={field} className="min-w-0 space-y-1.5">
                      <Label htmlFor={inputId}>{field === "singularLabel" ? "Singular label" : "Plural label"}<span className="sr-only"> for Level {level.levelNumber} (required)</span></Label>
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
                      <Trash2 aria-hidden="true" /> Remove level
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
            <Plus aria-hidden="true" /> Append level
          </Button>
          <p className="text-xs text-muted-foreground">{draft.levels.length >= MAX_STRUCTURE_LEVELS ? "Maximum of four levels reached." : "New levels are added below the deepest level."}</p>
        </div>
      )}

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
              <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => { dispatch({ type: "reload", source: structure }); setTouched({}); actions.refresh(); }}>Reload and discard edits</Button>
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
