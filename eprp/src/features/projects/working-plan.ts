/**
 * Phase 13.11 — Working Plan hardening (`docs/02` §26.3, §26.4, §26.20;
 * `docs/06` §10A.1–§10A.3).
 *
 * The pure rules of the governed Working Plan: the planning hierarchy built
 * from `planning_work_items` (nodes) and `planning_activities` (tasks and true
 * milestones), level labels, earning-method and reporting-unit inheritance,
 * per-parent weight sums (W1 / W2), calculated effective contributions (W4),
 * explicit weight decisions (W3), the Planning Configuration that Guided and
 * Advanced Planning Setup both edit, and the ONE canonical adapter from real
 * planning data into the 13.10 Planning Engine input.
 *
 * Nothing here reads or writes storage and nothing here is published: the
 * Working Plan is shown only in the Planning Workspace (`02` §26.2 F1), and
 * 13.12 runs the adapter + engine at publish time.
 *
 * Weights: only `localWeightPercent` is a local weight. `weightPercent` is the
 * RECORDED weight (as entered or imported, semantics unreviewed); it is never
 * read as a local weight here. It becomes one only through an explicit,
 * logged `adopt_recorded` decision.
 */

import { proposeNormalisation, WEIGHT_TOLERANCE } from "@/lib/planning-engine/validation";
import type {
  DateWindow,
  EngineActivityInput,
  EngineElementInput,
  EngineNodeInput,
  EnginePlanInput,
  IsoDate,
  Weekday,
} from "@/lib/planning-engine/types";
import type {
  PlanningActivity,
  PlanningEarningMethod,
  PlanningWeightDecisionMode,
  PlanningWeightSource,
  PlanningWorkItem,
  ProjectPlanningSettings,
} from "@/types";

/* ========================================================================== */
/* Vocabulary — business language first (§26.20 rule 6)                      */
/* ========================================================================== */

export const PLANNING_LEVEL_LIMIT = 8;
export const PLANNING_LEVEL_LABEL_MAX = 60;

export interface EarningMethodChoice {
  value: PlanningEarningMethod;
  /** The canonical name, shown as secondary explanation. */
  label: string;
  /** The plain-language guided answer. */
  question: string;
  description: string;
}

export const EARNING_METHOD_CHOICES: readonly EarningMethodChoice[] = [
  {
    value: "percent_complete",
    label: "Percent Complete",
    question: "Percent complete",
    description: "Work earns its confirmed physical % complete.",
  },
  {
    value: "zero_hundred",
    label: "0/100",
    question: "Complete / not complete",
    description: "Work earns nothing until it is finished, then all of it.",
  },
  {
    value: "fifty_fifty",
    label: "50/50",
    question: "Half at start, half at finish",
    description: "Work earns half when it starts and the rest when it finishes.",
  },
  {
    value: "milestone",
    label: "Milestone",
    question: "By milestones",
    description:
      "Progress is earned when milestones are achieved. Tasks then need their own method; weight sits on the milestones.",
  },
];

export const EARNING_METHOD_LABEL: Record<PlanningEarningMethod, string> = {
  percent_complete: "Percent Complete",
  zero_hundred: "0/100",
  fifty_fifty: "50/50",
  milestone: "Milestone",
};

/** The methods a task (not a true milestone) can earn by. */
export const TASK_EARNING_METHODS: readonly PlanningEarningMethod[] = [
  "percent_complete",
  "zero_hundred",
  "fifty_fifty",
];

export const WEIGHT_SOURCE_CHOICES: readonly {
  value: PlanningWeightSource;
  label: string;
  description: string;
}[] = [
  {
    value: "eprp",
    label: "Enter & manage weights in EPRP",
    description: "Project Control enters each item's share of its parent here.",
  },
  {
    value: "imported",
    label: "Imported from the schedule",
    description:
      "Weights arrive with the schedule as proposals and are accepted into EPRP — never applied silently.",
  },
];

/** The label of a 1-based depth: the configured one, else "Level n". */
export function levelLabel(labels: readonly string[] | undefined, depth: number): string {
  const label = labels?.[depth - 1]?.trim();
  return label ? label : `Level ${depth}`;
}

/* ========================================================================== */
/* Planning Configuration (§26.20) — one record, two ways in                  */
/* ========================================================================== */

/** The four 13.11 fields Guided and Advanced Planning Setup both edit. */
export interface PlanningConfigurationDraft {
  levelLabels: string[];
  controlAccountLevel?: number;
  weightSource?: PlanningWeightSource;
  defaultEarningMethod?: PlanningEarningMethod;
}

export function configurationOf(
  settings: Pick<
    ProjectPlanningSettings,
    "levelLabels" | "controlAccountLevel" | "weightSource" | "defaultEarningMethod"
  > | null
): PlanningConfigurationDraft {
  return {
    levelLabels: [...(settings?.levelLabels ?? [])],
    controlAccountLevel: settings?.controlAccountLevel,
    weightSource: settings?.weightSource,
    defaultEarningMethod: settings?.defaultEarningMethod,
  };
}

/** The draft as it will be saved: labels trimmed, nothing else touched. */
export function cleanConfiguration(draft: PlanningConfigurationDraft): PlanningConfigurationDraft {
  return { ...draft, levelLabels: draft.levelLabels.map((label) => label.trim()) };
}

/** Plain-language problems that stop a save. Empty means saveable. */
export function configurationProblems(draft: PlanningConfigurationDraft): string[] {
  const problems: string[] = [];
  const labels = draft.levelLabels.map((label) => label.trim());
  if (labels.length > PLANNING_LEVEL_LIMIT) {
    problems.push(`A plan has at most ${PLANNING_LEVEL_LIMIT} levels.`);
  }
  if (labels.some((label) => label.length === 0)) {
    problems.push("Every level needs a name.");
  }
  if (labels.some((label) => label.length > PLANNING_LEVEL_LABEL_MAX)) {
    problems.push(`A level name is at most ${PLANNING_LEVEL_LABEL_MAX} characters.`);
  }
  if (draft.controlAccountLevel !== undefined) {
    if (!Number.isInteger(draft.controlAccountLevel) || draft.controlAccountLevel < 1) {
      problems.push("Choose the level performance is reported at.");
    } else if (draft.controlAccountLevel > labels.length) {
      problems.push("The reporting level must be one of the named levels.");
    }
  }
  return problems;
}

/** Every 13.11 question answered — the readiness step is done. */
export function configurationComplete(
  settings: Pick<
    ProjectPlanningSettings,
    "levelLabels" | "controlAccountLevel" | "weightSource" | "defaultEarningMethod"
  > | null
): boolean {
  return Boolean(
    settings &&
      settings.levelLabels.length > 0 &&
      settings.controlAccountLevel !== undefined &&
      settings.weightSource !== undefined &&
      settings.defaultEarningMethod !== undefined
  );
}

export function configurationChanged(
  saved: PlanningConfigurationDraft,
  draft: PlanningConfigurationDraft
): boolean {
  const a = cleanConfiguration(saved);
  const b = cleanConfiguration(draft);
  return (
    a.levelLabels.join("\u0000") !== b.levelLabels.join("\u0000") ||
    a.levelLabels.length !== b.levelLabels.length ||
    a.controlAccountLevel !== b.controlAccountLevel ||
    a.weightSource !== b.weightSource ||
    a.defaultEarningMethod !== b.defaultEarningMethod
  );
}

/**
 * §26.20 rule 4: switching where weights are managed once local weights exist
 * is an explicit act with a reason. The database enforces the same rule.
 */
export function weightSourceChangeNeedsReason(
  saved: PlanningConfigurationDraft,
  draft: PlanningConfigurationDraft,
  hasLocalWeights: boolean
): boolean {
  return (
    hasLocalWeights &&
    saved.weightSource !== undefined &&
    draft.weightSource !== saved.weightSource
  );
}

/** The configuration in plain words, for the "your setup" summary. */
export function describeConfiguration(
  draft: PlanningConfigurationDraft
): { label: string; value: string }[] {
  const labels = draft.levelLabels.map((label) => label.trim()).filter(Boolean);
  return [
    {
      label: "Breakdown",
      value: labels.length > 0 ? labels.join(" → ") : "Not set yet",
    },
    {
      label: "Performance reported at",
      value:
        draft.controlAccountLevel !== undefined && labels[draft.controlAccountLevel - 1]
          ? labels[draft.controlAccountLevel - 1]
          : "Not set yet",
    },
    {
      label: "Weight source",
      value:
        WEIGHT_SOURCE_CHOICES.find((choice) => choice.value === draft.weightSource)?.label ??
        "Not set yet",
    },
    {
      label: "Default earning method",
      value: draft.defaultEarningMethod
        ? (EARNING_METHOD_CHOICES.find((choice) => choice.value === draft.defaultEarningMethod)
            ?.question ?? EARNING_METHOD_LABEL[draft.defaultEarningMethod])
        : "Not set yet",
    },
  ];
}

/* ========================================================================== */
/* The hierarchy (§26.3)                                                      */
/* ========================================================================== */

export interface WorkingPlanNode {
  kind: "node";
  id: string;
  item: PlanningWorkItem;
  /** 1 for a child of the Project. */
  depth: number;
  parent: WorkingPlanNode | null;
  /** Child nodes first, then activities — together they share 100% (H3). */
  children: WorkingPlanElement[];
}

export interface WorkingPlanLeaf {
  kind: "activity";
  id: string;
  activity: PlanningActivity;
  depth: number;
  parent: WorkingPlanNode | null;
  /** Its stored node is not an active node of the plan (archived or missing). */
  detachedFromArchived: boolean;
}

export type WorkingPlanElement = WorkingPlanNode | WorkingPlanLeaf;

export interface WorkingPlanTree {
  /** The Project's direct children: top-level nodes, then activities with no node. */
  roots: WorkingPlanElement[];
  nodes: Map<string, WorkingPlanNode>;
  leaves: Map<string, WorkingPlanLeaf>;
  /** The project has a planning hierarchy (at least one active node). */
  hasHierarchy: boolean;
  /** Activities not attached to an active node. */
  unattached: WorkingPlanLeaf[];
}

export function elementName(element: WorkingPlanElement): string {
  return element.kind === "node"
    ? element.item.name
    : element.activity.name;
}

export function elementCode(element: WorkingPlanElement): string | undefined {
  return element.kind === "node"
    ? element.item.code
    : (element.activity.code ?? element.activity.externalId);
}

function byOrder(a: PlanningWorkItem, b: PlanningWorkItem): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
}

function byActivityOrder(a: PlanningActivity, b: PlanningActivity): number {
  const left = a.code ?? a.externalId ?? a.name;
  const right = b.code ?? b.externalId ?? b.name;
  return left.localeCompare(right);
}

/**
 * The Working Plan as one tree, from ACTIVE rows only (archived items stay in
 * history, never in the plan). A node whose parent is missing or archived is
 * shown at the top level rather than lost; an activity whose node is not an
 * active node is unattached.
 */
export function buildWorkingPlanTree(
  workItems: readonly PlanningWorkItem[],
  activities: readonly PlanningActivity[]
): WorkingPlanTree {
  const active = workItems.filter((item) => item.active).sort(byOrder);
  const nodes = new Map<string, WorkingPlanNode>();
  for (const item of active) {
    nodes.set(item.id, { kind: "node", id: item.id, item, depth: 0, parent: null, children: [] });
  }

  const roots: WorkingPlanElement[] = [];
  for (const node of nodes.values()) {
    const parent = node.item.parentWorkItemId ? nodes.get(node.item.parentWorkItemId) : undefined;
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Depth, guarding a corrupt cycle (the database refuses loops).
  const placed = new Set<string>();
  const assign = (list: WorkingPlanElement[], depth: number) => {
    for (const element of list) {
      if (element.kind !== "node" || placed.has(element.id)) continue;
      placed.add(element.id);
      element.depth = depth;
      assign(element.children, depth + 1);
    }
  };
  assign(roots, 1);
  for (const node of nodes.values()) {
    if (!placed.has(node.id)) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
      roots.push(node);
      assign([node], 1);
    }
  }

  const leaves = new Map<string, WorkingPlanLeaf>();
  const unattached: WorkingPlanLeaf[] = [];
  for (const activity of activities.filter((entry) => entry.active).sort(byActivityOrder)) {
    const node = activity.workItemId ? nodes.get(activity.workItemId) : undefined;
    const leaf: WorkingPlanLeaf = {
      kind: "activity",
      id: activity.id,
      activity,
      depth: node ? node.depth + 1 : 1,
      parent: node ?? null,
      detachedFromArchived: Boolean(activity.workItemId) && !node,
    };
    leaves.set(activity.id, leaf);
    if (node) node.children.push(leaf);
    else {
      unattached.push(leaf);
      roots.push(leaf);
    }
  }

  return { roots, nodes, leaves, hasHierarchy: nodes.size > 0, unattached };
}

/** The direct children of a parent (`null` = the Project). */
export function childrenOf(tree: WorkingPlanTree, parentId: string | null): WorkingPlanElement[] {
  if (parentId === null) return tree.roots;
  return tree.nodes.get(parentId)?.children ?? [];
}

/** Pre-order (parent before children), for a readable table. */
export function flattenWorkingPlan(tree: WorkingPlanTree): WorkingPlanElement[] {
  const out: WorkingPlanElement[] = [];
  const walk = (list: readonly WorkingPlanElement[]) => {
    for (const element of list) {
      out.push(element);
      if (element.kind === "node") walk(element.children);
    }
  };
  walk(tree.roots);
  return out;
}

function ancestors(element: WorkingPlanElement): WorkingPlanNode[] {
  const chain: WorkingPlanNode[] = [];
  let cursor = element.parent;
  while (cursor) {
    chain.push(cursor);
    cursor = cursor.parent;
  }
  return chain;
}

/* ========================================================================== */
/* Earning-method inheritance (§26.4, §26.20)                                 */
/* ========================================================================== */

export type EarningMethodResolution =
  | {
      method: PlanningEarningMethod;
      /** kind: a true milestone always earns by Milestone. */
      source: "kind" | "activity" | "node" | "project";
      fromNodeId?: string;
    }
  | {
      method: null;
      /**
       * not_set — nothing on the path states a method;
       * milestone_default_for_task — the nearest default is Milestone, which a
       * task cannot use, so the task needs its own method.
       */
      reason: "not_set" | "milestone_default_for_task";
      fromNodeId?: string;
    };

/**
 * The method an activity earns by: its own, else the nearest node default,
 * else the project default. Inheritance stops at the nearest stated default.
 */
export function resolveEarningMethod(
  leaf: Pick<WorkingPlanLeaf, "activity" | "parent">,
  projectDefault?: PlanningEarningMethod
): EarningMethodResolution {
  const { activity } = leaf;
  if (activity.isMilestone) {
    return { method: "milestone", source: activity.earningMethod ? "activity" : "kind" };
  }
  if (activity.earningMethod) return { method: activity.earningMethod, source: "activity" };

  let cursor = leaf.parent;
  while (cursor) {
    const method = cursor.item.earningMethod;
    if (method) {
      return method === "milestone"
        ? { method: null, reason: "milestone_default_for_task", fromNodeId: cursor.id }
        : { method, source: "node", fromNodeId: cursor.id };
    }
    cursor = cursor.parent;
  }
  if (projectDefault) {
    return projectDefault === "milestone"
      ? { method: null, reason: "milestone_default_for_task" }
      : { method: projectDefault, source: "project" };
  }
  return { method: null, reason: "not_set" };
}

/** The method a NODE's work inherits (its own default, else the nearest one above). */
export function inheritedNodeMethod(
  node: Pick<WorkingPlanNode, "item" | "parent">,
  projectDefault?: PlanningEarningMethod
): { method: PlanningEarningMethod; source: "node" | "project"; fromNodeId?: string } | null {
  let cursor: Pick<WorkingPlanNode, "item" | "parent"> | null = node;
  while (cursor) {
    if (cursor.item.earningMethod) {
      return { method: cursor.item.earningMethod, source: "node", fromNodeId: cursor.item.id };
    }
    cursor = cursor.parent;
  }
  return projectDefault ? { method: projectDefault, source: "project" } : null;
}

/* ========================================================================== */
/* Reporting-unit mapping (§26.3 H6)                                          */
/* ========================================================================== */

export type ReportingUnit =
  | { family: "psm"; departmentId: string; systemId?: string; disciplineId?: string }
  | { family: "other"; structureNodeId: string };

type UnitColumns = Pick<
  PlanningWorkItem,
  "departmentId" | "systemId" | "disciplineId" | "structureNodeId"
>;

/** The mapping stored on one node or activity, or `null` when it states none. */
export function ownReportingUnit(item: UnitColumns): ReportingUnit | null {
  if (item.structureNodeId) return { family: "other", structureNodeId: item.structureNodeId };
  if (item.departmentId) {
    return {
      family: "psm",
      departmentId: item.departmentId,
      systemId: item.systemId,
      disciplineId: item.disciplineId,
    };
  }
  return null;
}

export type ReportingUnitResolution =
  | { unit: ReportingUnit; source: "own" | "inherited"; fromNodeId?: string }
  /** Unmapped work reports in a project-level section (H6). */
  | { unit: null; source: "project_level" };

/** Children inherit their nearest ancestor's mapping unless they override it. */
export function resolveReportingUnit(element: WorkingPlanElement): ReportingUnitResolution {
  const own = ownReportingUnit(element.kind === "node" ? element.item : element.activity);
  if (own) return { unit: own, source: "own" };
  for (const node of ancestors(element)) {
    const unit = ownReportingUnit(node.item);
    if (unit) return { unit, source: "inherited", fromNodeId: node.id };
  }
  return { unit: null, source: "project_level" };
}

/* ========================================================================== */
/* Weights (§26.4 W1–W5)                                                      */
/* ========================================================================== */

export function localWeightOf(element: WorkingPlanElement): number | undefined {
  return element.kind === "node" ? element.item.localWeightPercent : element.activity.localWeightPercent;
}

export function recordedWeightOf(element: WorkingPlanElement): number | undefined {
  return element.kind === "node" ? element.item.weightPercent : element.activity.weightPercent;
}

function isValidWeight(weight: number): boolean {
  return Number.isFinite(weight) && weight >= 0 && weight <= 100;
}

export type ParentWeightStatus = "complete" | "incomplete" | "empty";

export interface ParentWeightSummary {
  /** `null` = the Project. */
  parentId: string | null;
  parentName: string;
  childCount: number;
  /** Σ of the entered local weights. */
  enteredTotal: number;
  /** Children with no local weight. */
  missing: string[];
  invalid: string[];
  /** Children with no local weight but a recorded one that could be adopted. */
  recordedAvailable: number;
  status: ParentWeightStatus;
}

/** W1 / W2 for one parent's direct children (nodes and activities together). */
export function parentWeightSummary(
  parent: WorkingPlanNode | null,
  children: readonly WorkingPlanElement[]
): ParentWeightSummary {
  let enteredTotal = 0;
  const missing: string[] = [];
  const invalid: string[] = [];
  let recordedAvailable = 0;
  for (const child of children) {
    const weight = localWeightOf(child);
    if (weight === undefined || weight === null) {
      missing.push(elementName(child));
      if (typeof recordedWeightOf(child) === "number") recordedAvailable += 1;
      continue;
    }
    if (!isValidWeight(weight)) {
      invalid.push(elementName(child));
      continue;
    }
    enteredTotal += weight;
  }
  const status: ParentWeightStatus =
    children.length === 0
      ? "empty"
      : missing.length === 0 && invalid.length === 0 && Math.abs(enteredTotal - 100) <= WEIGHT_TOLERANCE
        ? "complete"
        : "incomplete";
  return {
    parentId: parent ? parent.id : null,
    parentName: parent ? parent.item.name : "Project",
    childCount: children.length,
    enteredTotal,
    missing,
    invalid,
    recordedAvailable,
    status,
  };
}

/** Every parent of the plan — the Project first, then each node in tree order. */
export function allParentSummaries(tree: WorkingPlanTree): ParentWeightSummary[] {
  const summaries = [parentWeightSummary(null, tree.roots)];
  for (const element of flattenWorkingPlan(tree)) {
    if (element.kind === "node") summaries.push(parentWeightSummary(element, element.children));
  }
  return summaries;
}

/**
 * Effective project contribution (W4): the product of the local weights on
 * the path, in percent of the Project. Calculated, never entered, never
 * stored. `null` when any weight on the path is missing or invalid — absence
 * is never shown as 0.
 */
export function effectiveContributions(tree: WorkingPlanTree): Map<string, number | null> {
  const result = new Map<string, number | null>();
  const walk = (list: readonly WorkingPlanElement[], parentFraction: number | null) => {
    for (const element of list) {
      const weight = localWeightOf(element);
      const fraction =
        parentFraction === null || weight === undefined || weight === null || !isValidWeight(weight)
          ? null
          : parentFraction * (weight / 100);
      result.set(element.id, fraction === null ? null : fraction * 100);
      if (element.kind === "node") walk(element.children, fraction);
    }
  };
  walk(tree.roots, 1);
  return result;
}

/* ========================================================================== */
/* Explicit weight decisions (§26.4 W3)                                       */
/* ========================================================================== */

export interface WeightDecisionChild {
  kind: "node" | "activity";
  id: string;
  name: string;
  /** The stored local weight the decision starts from (`null` = none). */
  before: number | null;
  recorded: number | null;
  after: number;
}

export type WeightDecisionProposal =
  | {
      ok: true;
      mode: PlanningWeightDecisionMode;
      parentId: string | null;
      children: WeightDecisionChild[];
    }
  | { ok: false; reason: string };

const THOUSANDTHS = 1000;
const FULL = 100 * THOUSANDTHS;

/**
 * Integer thousandths that total exactly 100.000: each share floored, then
 * the remaining thousandths go to the largest remainders (earlier children
 * first on a tie). Every result is within 0.001 of its exact value — the same
 * check `record_planning_weight_decision()` applies.
 */
function largestRemainder(numerators: readonly number[], denominator: number): number[] {
  const floors = numerators.map((n) => Math.floor(n / denominator));
  const order = numerators
    .map((n, index) => ({ index, remainder: n - floors[index] * denominator }))
    .filter((entry) => entry.remainder > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let spare = FULL - floors.reduce((sum, value) => sum + value, 0);
  for (const entry of order) {
    if (spare <= 0) break;
    floors[entry.index] += 1;
    spare -= 1;
  }
  return floors.map((value) => value / THOUSANDTHS);
}

function toThousandths(weight: number | null): number {
  return weight === null ? 0 : Math.round(weight * THOUSANDTHS);
}

/**
 * The proposal for one parent's children, by mode. The engine's
 * `proposeNormalisation()` decides whether the mode applies (W3); the result
 * is rounded to the stored precision so it totals exactly 100%.
 * `adopt_recorded` proposes the recorded weight as the local weight for every
 * child that has a recorded weight and no local weight — nothing else moves.
 */
export function proposeWeightDecision(
  parentId: string | null,
  children: readonly WorkingPlanElement[],
  mode: PlanningWeightDecisionMode
): WeightDecisionProposal {
  const base = children.map((child) => ({
    kind: child.kind,
    id: child.id,
    name: elementName(child),
    before: localWeightOf(child) ?? null,
    recorded: recordedWeightOf(child) ?? null,
  }));
  if (base.length === 0) return { ok: false, reason: "There are no child weights to decide." };

  if (mode === "adopt_recorded") {
    const adoptable = base.filter((child) => child.before === null && child.recorded !== null);
    if (adoptable.length === 0) {
      return { ok: false, reason: "No child without a local weight has a recorded weight to adopt." };
    }
    return {
      ok: true,
      mode,
      parentId,
      children: adoptable.map((child) => ({ ...child, after: child.recorded as number })),
    };
  }

  const engine = proposeNormalisation(
    parentId,
    base.map((child) => ({ id: child.id, localWeight: child.before })),
    mode
  );
  if (!engine.ok) return { ok: false, reason: engine.reason };

  if (mode === "proportional_rescale") {
    const allEntered = base.every((child) => child.before !== null);
    const total = base.reduce((sum, child) => sum + (child.before ?? 0), 0);
    if (allEntered && Math.abs(total - 100) <= WEIGHT_TOLERANCE) {
      return { ok: false, reason: "These weights already total 100%; there is nothing to normalise." };
    }
  }

  const after =
    mode === "equal_split"
      ? largestRemainder(base.map(() => FULL), base.length)
      : (() => {
          const scaled = base.map((child) => toThousandths(child.before));
          const total = scaled.reduce((sum, value) => sum + value, 0);
          return largestRemainder(scaled.map((value) => value * FULL), total);
        })();

  return {
    ok: true,
    mode,
    parentId,
    children: base.map((child, index) => ({ ...child, after: after[index] })),
  };
}

/** The RPC payload of a proposal: `{kind, id, before, after}` per child. */
export function weightDecisionPayload(
  children: readonly WeightDecisionChild[]
): { kind: "node" | "activity"; id: string; before: number | null; after: number }[] {
  return children.map(({ kind, id, before, after }) => ({ kind, id, before, after }));
}

/* ========================================================================== */
/* Working Plan checks                                                        */
/* ========================================================================== */

export type WorkingPlanFindingCode =
  | "W1_CHILD_TOTAL"
  | "W2_MISSING_WEIGHT"
  | "WEIGHT_INVALID"
  | "EMPTY_NODE"
  | "ACTIVITY_UNATTACHED"
  | "EARNING_METHOD_MISSING"
  | "MILESTONE_NOT_ZERO_DURATION"
  | "MILESTONE_CARRIES_WEIGHT"
  | "RECORDED_WEIGHT_UNREVIEWED"
  | "CONFIGURATION_INCOMPLETE";

export interface WorkingPlanFinding {
  code: WorkingPlanFindingCode;
  /** `blocking` will stop the first v2 publish (13.12); `advisory` informs. */
  severity: "blocking" | "advisory";
  /** The element the finding is about; `null` for the Project. */
  elementId: string | null;
  elementName: string;
  message: string;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

/**
 * Structural checks of the Working Plan — what the editor shows now and what
 * publish validation (13.12) will refuse. Date, Data Date and progress checks
 * (C2, §26.6 rule 3) need a Data Date and belong to publish.
 */
export function workingPlanFindings(
  tree: WorkingPlanTree,
  settings: Pick<
    ProjectPlanningSettings,
    "levelLabels" | "controlAccountLevel" | "weightSource" | "defaultEarningMethod"
  > | null
): WorkingPlanFinding[] {
  const findings: WorkingPlanFinding[] = [];
  if (tree.roots.length === 0) return findings;

  if (!configurationComplete(settings)) {
    findings.push({
      code: "CONFIGURATION_INCOMPLETE",
      severity: "advisory",
      elementId: null,
      elementName: "Project",
      message: "Planning Setup is not complete: set the breakdown, weights and how progress is earned.",
    });
  }

  for (const summary of allParentSummaries(tree)) {
    const id = summary.parentId;
    if (summary.status === "empty") {
      findings.push({
        code: "EMPTY_NODE",
        severity: "blocking",
        elementId: id,
        elementName: summary.parentName,
        message: `${summary.parentName}: has no work under it to carry its weight.`,
      });
      continue;
    }
    if (summary.invalid.length > 0) {
      findings.push({
        code: "WEIGHT_INVALID",
        severity: "blocking",
        elementId: id,
        elementName: summary.parentName,
        message: `${summary.parentName}: weight out of range for ${summary.invalid.join(", ")}.`,
      });
    }
    if (summary.missing.length > 0) {
      findings.push({
        code: "W2_MISSING_WEIGHT",
        severity: "blocking",
        elementId: id,
        elementName: summary.parentName,
        message: `${summary.parentName}: weight missing for ${summary.missing.join(", ")}.`,
      });
    } else if (summary.invalid.length === 0 && Math.abs(summary.enteredTotal - 100) > WEIGHT_TOLERANCE) {
      findings.push({
        code: "W1_CHILD_TOTAL",
        severity: "blocking",
        elementId: id,
        elementName: summary.parentName,
        message: `${summary.parentName}: child weights total ${formatPercent(summary.enteredTotal)}.`,
      });
    }
    if (summary.recordedAvailable > 0) {
      findings.push({
        code: "RECORDED_WEIGHT_UNREVIEWED",
        severity: "advisory",
        elementId: id,
        elementName: summary.parentName,
        message: `${summary.parentName}: ${summary.recordedAvailable} recorded weight${summary.recordedAvailable === 1 ? "" : "s"} not yet reviewed into local weights.`,
      });
    }
  }

  for (const leaf of tree.leaves.values()) {
    const { activity } = leaf;
    if (tree.hasHierarchy && !leaf.parent) {
      findings.push({
        code: "ACTIVITY_UNATTACHED",
        severity: "blocking",
        elementId: leaf.id,
        elementName: activity.name,
        message: leaf.detachedFromArchived
          ? `${activity.name}: its planning node is archived; attach it to an active node.`
          : `${activity.name}: not attached to a planning node.`,
      });
    }
    const method = resolveEarningMethod(leaf, settings?.defaultEarningMethod);
    if (method.method === null) {
      findings.push({
        code: "EARNING_METHOD_MISSING",
        severity: "blocking",
        elementId: leaf.id,
        elementName: activity.name,
        message:
          method.reason === "milestone_default_for_task"
            ? `${activity.name}: a task cannot earn by milestones; set its own earning method.`
            : `${activity.name}: no earning method set or inherited.`,
      });
    }
    if (activity.isMilestone) {
      if (
        activity.plannedStartDate &&
        activity.plannedFinishDate &&
        activity.plannedStartDate !== activity.plannedFinishDate
      ) {
        findings.push({
          code: "MILESTONE_NOT_ZERO_DURATION",
          severity: "blocking",
          elementId: leaf.id,
          elementName: activity.name,
          message: `${activity.name}: a true milestone starts and finishes on the same date.`,
        });
      }
      if ((activity.localWeightPercent ?? 0) > 0) {
        findings.push({
          code: "MILESTONE_CARRIES_WEIGHT",
          severity: "advisory",
          elementId: leaf.id,
          elementName: activity.name,
          message: `${activity.name}: a milestone carries weight only when its work package earns through milestones.`,
        });
      }
    }
  }
  return findings;
}

/* ========================================================================== */
/* Database refusals, worded for people                                       */
/* ========================================================================== */

const REFUSALS: readonly [RegExp, string][] = [
  [/\[STALE\]/, "The Working Plan changed since this page loaded. Reload and try again — nothing was saved."],
  [/\[REASON_REQUIRED\]/, "This change needs a reason."],
  [/\[INVALID_DECISION\]/, "That weight decision no longer matches the plan. Reload and decide again."],
  [/\[ONBOARDING_NOT_CHOSEN\]/, "Decide how the project will be planned in Project Setup first."],
  [/\[NOT_PLANNING_GOVERNED\]/, "This project has no formal schedule. Change the Planning Approach in Project Setup before changing its plan."],
  [/\[INVALID_CONFIGURATION\]/, "The reporting level must be one of the named levels."],
  [/\[NODE_NOT_MILESTONE\]/, "A planning node is never a milestone. Add a milestone activity under the node instead."],
  [/\[NODE_ARCHIVED\]/, "That planning node is archived. Attach the activity to an active node."],
  [/\[ACTIVITY_DETACH\]/, "An attached activity stays attached to a planning node. Move it to another node instead."],
  [/\[REPORTING_UNIT_FAMILY\]/, "That reporting unit does not match the project type: PSM projects map to Departments, Systems and Programs & Studies; Other Projects to their Project Structure units."],
  [/\[REPORTING_UNIT_ARCHIVED\]/, "That Project Structure unit is archived. Choose an active unit."],
  [/\[REPORTING_UNIT_INCOMPLETE\]/, "A System or Program & Study mapping needs its Department."],
  [/\[REPORTING_UNIT_NOT_IN_PROJECT\]/, "That reporting unit is not part of this project's structure."],
  [/planning_activities_kind_method_consistent/, "The Milestone method is for true milestones only, and a true milestone earns only by the Milestone method."],
  [/local_weight_range/, "A local weight is between 0 and 100."],
  [/project_planning_settings_level_labels_valid/, "Level names are 1–60 characters, at most eight levels."],
  [/project_planning_settings_control_account_level_valid/, "The reporting level must be one of the named levels."],
];

/**
 * The user-facing sentence for a 13.11 Working Plan refusal, or `undefined`
 * when the failure is not one of them (the caller's generic wording applies).
 */
export function workingPlanRefusalMessage(error: {
  message?: string | null;
  details?: string | null;
}): string | undefined {
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return REFUSALS.find(([pattern]) => pattern.test(text))?.[1];
}

/* ========================================================================== */
/* The canonical adapter: Working Plan → Planning Engine input               */
/* ========================================================================== */

/**
 * The PROVISIONAL BLn window until 13.12: the activity's own as-built
 * baseline columns (recorded from the schedule). 13.12 replaces it with the
 * approved Baseline Revision's dates; `docs/06` §10A.3 — baseline dates are
 * never edited on the activity.
 */
export function recordedActivityBaseline(activity: PlanningActivity): DateWindow {
  return { start: activity.baselineStartDate ?? null, finish: activity.baselineFinishDate ?? null };
}

export interface EngineAdapterOptions {
  projectId: string;
  dataDate: IsoDate;
  /** The project's working week (`parseWorkingWeek(project.reporting.workingWeek)`). */
  workingWeek: readonly Weekday[];
  projectDefaultEarningMethod?: PlanningEarningMethod;
  /** BLn per activity. Defaults to {@link recordedActivityBaseline}. */
  baselineFor?: (activity: PlanningActivity) => DateWindow;
  /** BL0 per activity (slip only). Absent until 13.12. */
  originalBaselineFor?: (activity: PlanningActivity) => DateWindow | null;
  /** Key-milestone flag (13.15). */
  isKeyMilestone?: (activity: PlanningActivity) => boolean;
}

export type EngineAdapterResult =
  | { status: "ready"; plan: EnginePlanInput; findings: WorkingPlanFinding[] }
  /** The plan cannot be handed to the engine faithfully; nothing is dropped or guessed. */
  | { status: "blocked"; findings: WorkingPlanFinding[] };

/** Findings that make an engine input impossible to build faithfully. */
const ADAPTER_BLOCKING: readonly WorkingPlanFindingCode[] = [
  "ACTIVITY_UNATTACHED",
  "EARNING_METHOD_MISSING",
];

/**
 * The ONE mapping from real planning data to `EnginePlanInput` (13.10). Same
 * shape for PSM and Other Projects: the reporting-unit mapping never enters
 * the hierarchy or its weights (§26.3 H6).
 *
 * - nodes → engine nodes with their LOCAL weight and Control Account flag;
 * - activities → engine activities with their resolved earning method,
 *   forecast (`planned*` dates), actuals, and confirmed physical % complete;
 * - a missing local weight stays missing (the engine's W2 names it) — the
 *   recorded `weightPercent` is never substituted;
 * - an unattached activity in a project with a hierarchy, or an activity with
 *   no earning method, blocks the adapter: it is never dropped silently.
 */
export function toEnginePlanInput(
  workItems: readonly PlanningWorkItem[],
  activities: readonly PlanningActivity[],
  options: EngineAdapterOptions
): EngineAdapterResult {
  const tree = buildWorkingPlanTree(workItems, activities);
  const findings = workingPlanFindings(tree, {
    levelLabels: [],
    controlAccountLevel: undefined,
    weightSource: undefined,
    defaultEarningMethod: options.projectDefaultEarningMethod,
  }).filter((finding) => finding.code !== "CONFIGURATION_INCOMPLETE");

  if (findings.some((finding) => ADAPTER_BLOCKING.includes(finding.code))) {
    return { status: "blocked", findings };
  }

  const baselineFor = options.baselineFor ?? recordedActivityBaseline;
  const toActivity = (leaf: WorkingPlanLeaf): EngineActivityInput => {
    const { activity } = leaf;
    const method = resolveEarningMethod(leaf, options.projectDefaultEarningMethod);
    return {
      kind: "activity",
      id: activity.id,
      code: activity.code ?? activity.externalId ?? null,
      name: activity.name,
      localWeight: activity.localWeightPercent ?? null,
      // Checked above: every activity resolves a method here.
      earningMethod: method.method as PlanningEarningMethod,
      baseline: baselineFor(activity),
      originalBaseline: options.originalBaselineFor?.(activity) ?? null,
      forecast: { start: activity.plannedStartDate ?? null, finish: activity.plannedFinishDate ?? null },
      actual: { start: activity.actualStartDate ?? null, finish: activity.actualFinishDate ?? null },
      percentComplete: activity.percentCompletePhysical ?? null,
      isKeyMilestone: options.isKeyMilestone?.(activity) ?? false,
    };
  };
  const toElement = (element: WorkingPlanElement): EngineElementInput => {
    if (element.kind === "activity") return toActivity(element);
    const node: EngineNodeInput = {
      kind: "node",
      id: element.id,
      code: element.item.code,
      name: element.item.name,
      localWeight: element.item.localWeightPercent ?? null,
      isControlAccount: element.item.isControlAccount,
      children: element.children.map(toElement),
    };
    return node;
  };

  return {
    status: "ready",
    plan: {
      projectId: options.projectId,
      dataDate: options.dataDate,
      workingWeek: [...options.workingWeek],
      children: tree.roots.map(toElement),
    },
    findings,
  };
}
