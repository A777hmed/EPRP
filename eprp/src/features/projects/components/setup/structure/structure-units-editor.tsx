"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronRight, Circle, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { structureStepChecks } from "@/config/project-workflow";
import type { ProjectStructure } from "@/types/project-structure";
import type { ProjectStructureWorkspaceProps } from "../../../structure/structure-workspace-contract";
import {
  archivedNodes, buildStructureTree, canAcceptChild, canArchiveNode, canDeleteNode, canRestoreNode,
  findLevel, findNode, isActiveNode, reportingScope, structureCompleteness, type StructureTreeNode,
} from "../../../structure/structure-rules";
import { unitLabels, unitPathLabel, unitRuleMessage, type StructureUnitIntent } from "../../../structure/structure-units-ui";
import { StructureUnitDialog } from "./structure-unit-dialog";

/** Named hierarchy, reporting scope and workflow feedback over container-owned data/actions. */
export function StructureUnitsEditor(props: ProjectStructureWorkspaceProps) {
  const { project, structure, canManage } = props;
  const [intent, setIntent] = React.useState<StructureUnitIntent | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [awaitingRead, setAwaitingRead] = React.useState<ProjectStructure | null>(null);
  const [collapsedBranches, setCollapsedBranches] = React.useState<Set<string>>(() => new Set());
  const treeId = React.useId();
  const sectionRef = React.useRef<HTMLElement>(null);
  const rootActionRef = React.useRef<HTMLButtonElement>(null);
  const contextualActionRef = React.useRef<HTMLButtonElement | null>(null);
  const rowActionRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const refreshing = awaitingRead === structure;
  const scope = reportingScope(structure.nodes);
  const archived = archivedNodes(structure.nodes);
  const facts = structureCompleteness(structure);
  const roots = unitLabels(structure, 1);
  const checks = structureStepChecks(project, { structure });
  const missing = checks.filter((entry) => !entry.passed);
  const tree = buildStructureTree(structure, { includeArchived: showArchived });
  const canWrite = canManage && !refreshing;

  function returnFocus() {
    const contextualTrigger = contextualActionRef.current;
    contextualActionRef.current = null;
    if (contextualTrigger?.isConnected && !contextualTrigger.disabled) {
      contextualTrigger.focus();
      return;
    }
    const rowId = intent?.mode === "create" ? intent.parentId : intent?.node.id;
    const trigger = rowId ? rowActionRefs.current.get(rowId) : rootActionRef.current;
    if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    else if (rootActionRef.current?.isConnected && !rootActionRef.current.disabled) rootActionRef.current.focus();
    else sectionRef.current?.focus();
  }

  function toggleBranch(id: string) {
    setCollapsedBranches((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function renderBranch(entries: StructureTreeNode[], depth = 0) {
    return entries.map(({ node, level, children }) => {
      const labels = unitLabels(structure, node.levelNumber);
      const active = isActiveNode(node);
      const childLevel = findLevel(structure.levels, node.levelNumber + 1);
      const parent = findNode(structure.nodes, node.parentId);
      const parentType = node.parentId ? unitLabels(structure, node.levelNumber - 1).singular : null;
      const childRule = canAcceptChild(structure, node.id);
      const archiveRule = canArchiveNode(structure.nodes, node.id);
      const restoreRule = canRestoreNode(structure.nodes, node.id);
      const deleteRule = canDeleteNode(structure.nodes, node.id);
      const hasBranch = children.length > 0 || (canManage && childLevel && childRule.ok);
      const expanded = !collapsedBranches.has(node.id);
      const branchId = `${treeId}-branch-${node.id}`;
      return (
        <li key={node.id} className="relative min-w-0" data-structure-unit={node.id}>
          {depth > 0 && <span aria-hidden="true" className="absolute -left-3 top-6 w-3 border-t-2 border-border sm:-left-4 sm:w-4" />}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-md border bg-card p-3" aria-label={`${labels.singular}: ${node.name}`}>
            <div className="min-w-0">
              <div className="flex min-w-0 items-start gap-2">
                {hasBranch && <Button type="button" variant="ghost" className="-ml-1 -mt-1 size-11 shrink-0" aria-expanded={expanded} aria-controls={expanded ? branchId : undefined} aria-label={`${expanded ? "Collapse" : "Expand"} ${labels.singular} ${node.name} branch`} onClick={() => toggleBranch(node.id)}>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</Button>}
                <div className="min-w-0 space-y-1"><span className="block break-words text-sm font-semibold">{node.name}</span>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {node.code && <span className="break-all text-xs text-muted-foreground">{node.code}</span>}
                <span className="text-xs text-muted-foreground">{level?.singularLabel ?? labels.singular}</span>
                <span className="rounded border px-1.5 py-0.5 text-xs">{active ? "Active" : "Archived"}</span></div>
                </div>
              </div>
              {parentType && <p className="mt-1 break-words text-xs text-muted-foreground" title={unitPathLabel(structure, node.id)}>Parent {parentType}: {parent?.name ?? "Not available"}</p>}
              {node.description && <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground" title={node.description}>{node.description}</p>}
            </div>
            <div className="col-span-2 flex flex-wrap gap-2 text-xs lg:col-span-1 lg:col-start-1">
              <span className={`rounded border px-2 py-0.5 ${node.weeklyReportingRequired && active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>{node.weeklyReportingRequired && active ? "Weekly input required" : "Weekly input —"}</span>
              <span className={`rounded border px-2 py-0.5 ${node.monthlyReportingRequired && active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>{node.monthlyReportingRequired && active ? "Monthly input required" : "Monthly input —"}</span>
              {hasBranch && !expanded && <span className="self-center text-muted-foreground">{children.length} {childLevel?.pluralLabel ?? "child groups"} · collapsed</span>}
            </div>
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button ref={(element) => { if (element) rowActionRefs.current.set(node.id, element); else rowActionRefs.current.delete(node.id); }} type="button" variant="ghost" className="col-start-2 row-start-1 size-11" disabled={!canWrite} aria-label={`Actions for ${labels.singular} ${node.name}`}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]" onCloseAutoFocus={(event) => { if (intent) event.preventDefault(); }}>
                  {childLevel && <DropdownMenuItem className="min-h-11 whitespace-normal" disabled={!childRule.ok} title={!childRule.ok ? unitRuleMessage(childRule.reason) : undefined} onSelect={() => setIntent({ mode: "create", levelNumber: childLevel.levelNumber, parentId: node.id })}>Add {childLevel.singularLabel} under {node.name}</DropdownMenuItem>}
                  <DropdownMenuItem className="min-h-11" onSelect={() => setIntent({ mode: "details", node })}>Edit {labels.singular}</DropdownMenuItem>
                  {active && <DropdownMenuItem className="min-h-11" onSelect={() => setIntent({ mode: "reporting", node })}>Reporting input</DropdownMenuItem>}
                  {active && node.parentId && <DropdownMenuItem className="min-h-11" onSelect={() => setIntent({ mode: "move", node })}>Move {labels.singular}</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  {active ? <DropdownMenuItem className="min-h-11" disabled={!archiveRule.ok} title={!archiveRule.ok ? unitRuleMessage(archiveRule.reason) : undefined} onSelect={() => setIntent({ mode: "archive", node })}>Archive {labels.singular}</DropdownMenuItem>
                    : <DropdownMenuItem className="min-h-11" disabled={!restoreRule.ok} title={!restoreRule.ok ? unitRuleMessage(restoreRule.reason) : undefined} onSelect={() => setIntent({ mode: "restore", node })}>Restore {labels.singular}</DropdownMenuItem>}
                  <DropdownMenuItem className="min-h-11" variant="destructive" disabled={!deleteRule.ok} title={!deleteRule.ok ? unitRuleMessage(deleteRule.reason) : undefined} onSelect={() => setIntent({ mode: "delete", node })}>Delete {labels.singular}</DropdownMenuItem>
                  {(!archiveRule.ok && active && archiveRule.reason === "active_children") && <p className="max-w-64 px-2 py-1 text-xs text-muted-foreground">Archive the active children first.</p>}
                  {(!restoreRule.ok && !active) && <p className="max-w-64 px-2 py-1 text-xs text-muted-foreground">{unitRuleMessage(restoreRule.reason)}</p>}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {hasBranch && expanded && <ul id={branchId} className="relative ml-3 min-w-0 space-y-3 border-l-2 border-border pb-1 pl-3 pt-3 sm:ml-6 sm:pl-4" aria-label={`${node.name} children`}>
            {renderBranch(children, depth + 1)}
            {canManage && childLevel && childRule.ok && <li key={`add:${node.id}`} className="relative min-w-0">
              <span aria-hidden="true" className="absolute -left-3 top-5 w-3 border-t-2 border-border sm:-left-4 sm:w-4" />
              <Button type="button" variant="outline" className="min-h-11 max-w-full whitespace-normal text-left" disabled={!canWrite} aria-label={`Add ${childLevel.singularLabel} under ${node.name}`} onClick={(event) => { contextualActionRef.current = event.currentTarget; setIntent({ mode: "create", levelNumber: childLevel.levelNumber, parentId: node.id }); }}><Plus aria-hidden="true" /> Add {childLevel.singularLabel}</Button>
            </li>}
          </ul>}
        </li>
      );
    });
  }

  const completionLabel = (label: string) => {
    const display: Record<string, string> = {
      "At least one structure level defined": "Hierarchy types configured",
      "At least one active top-level unit": `At least one active ${roots.singular}`,
      "Every structure level has an active unit": "Every hierarchy type has active items",
      "At least one unit owes Weekly input": "Weekly input owner selected",
      "At least one unit owes Monthly input": "Monthly input owner selected",
    };
    return display[label] ?? label;
  };
  const completionHint = (hint: string | undefined) => hint === "Add a unit at the first level." ? `Add your first ${roots.singular}.`
    : hint?.replace("Add an active unit to:", "Add active items to:").replace(/\bunits\b/g, "items");

  return (
    <section ref={sectionRef} tabIndex={-1} className="min-w-0 space-y-4 border-t pt-4 focus-visible:outline-2 focus-visible:outline-ring" aria-label="Project hierarchy">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="text-sm font-semibold">Step 2 · Build your project structure</h3>
          <p className="mt-1 text-xs text-muted-foreground">Add the actual project groups and arrange them in the hierarchy below.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {archived.length > 0 && <Button type="button" variant="outline" className="min-h-11" aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide" : "Show"} archived ({archived.length})</Button>}
          {canManage && structure.levels.length > 0 && (facts.activeNodeCount > 0 || tree.length > 0) && <Button ref={rootActionRef} type="button" variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => setIntent({ mode: "create", levelNumber: 1 })}><Plus aria-hidden="true" /> Add {roots.singular}</Button>}
        </div>
      </div>
      {structure.levels.length === 0 ? <p className="text-sm text-muted-foreground">Configure the hierarchy types above, then add their actual items.</p>
        : tree.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4"><p className="text-sm font-medium">{canManage ? `Add your first ${roots.singular}` : `No active ${roots.plural} yet`}</p>
            <p className="mt-1 text-sm text-muted-foreground">{roots.plural} are the actual project groups of type {roots.singular} at Level 1. Give each group its own name, then add its children.</p>
            {canManage && <Button ref={rootActionRef} type="button" className="mt-3 min-h-11" disabled={!canWrite} onClick={() => setIntent({ mode: "create", levelNumber: 1 })}><Plus aria-hidden="true" /> Add {roots.singular}</Button>}
          </div>
        ) : <ul className="min-w-0 space-y-4" aria-label={roots.plural}>{renderBranch(tree)}</ul>}
      {structure.levels.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground tabular-nums" aria-label="Reporting input summary">
          <span>Weekly input owners: {scope.weekly.length}{!project.reporting.weeklyEnabled && " · reporting disabled"}</span>
          <span>Monthly input owners: {scope.monthly.length}{!project.reporting.monthlyEnabled && " · reporting disabled"}</span>
        </div>
      )}
      {refreshing && <p role="status" className="text-sm text-muted-foreground">Refreshing the hierarchy…</p>}
      <div className="space-y-2 border-t pt-3" aria-live="polite" aria-label="Project Structure completion">
        <p className="text-sm font-medium">{missing.length === 0 ? "Project Structure requirements complete" : `${missing.length} requirement${missing.length === 1 ? "" : "s"} remaining`}</p>
        {missing.length === 0 && <p className="text-xs text-muted-foreground">Continue to Contacts using the Project Setup workflow.</p>}
        <ul className="space-y-1.5">{checks.map((entry) => (
          <li key={entry.label} className="flex items-start gap-2 text-xs">
            {entry.passed ? <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <Circle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
            <span><span className="sr-only">{entry.passed ? "Complete: " : "Required: "}</span>{completionLabel(entry.label)}{!entry.passed && <span className="block text-muted-foreground">{completionHint(entry.hint)}</span>}</span>
          </li>
        ))}</ul>
      </div>
      {intent && <StructureUnitDialog key={intent.mode === "create" ? `create-${intent.levelNumber}-${intent.parentId ?? "root"}` : `${intent.mode}-${intent.node.id}`} {...props} intent={intent} onReturnFocus={returnFocus} onClose={() => setIntent(null)} onSaved={() => { if (intent.mode === "create" && intent.parentId) setCollapsedBranches((current) => { const next = new Set(current); next.delete(intent.parentId!); return next; }); setAwaitingRead(structure); setIntent(null); }} onReload={() => { setAwaitingRead(structure); setIntent(null); }} />}
    </section>
  );
}
