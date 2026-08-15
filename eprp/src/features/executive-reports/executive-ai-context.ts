/**
 * Build the minimum structured context the AI assistant needs.
 *
 * Client-safe and provider-agnostic: this file holds no key, contacts no
 * service and knows nothing about any vendor. It exists so the browser sends a
 * SUMMARY of what is already on screen rather than anything resembling a data
 * export — the caps here mirror the schema the API route enforces.
 *
 * Everything included is data the reader already holds: row-level security
 * delivered it to build the report they are looking at.
 */

import { bySeverity, EXEC_HEALTH_META, EXEC_HEALTH_ORDER, MONTHLY_BASIS_META, NO_MOVEMENT } from "./executive-data";
import type { AttentionItem, ProjectExecutiveRow } from "./executive-data";
import type { ExecutiveDocumentModel } from "./executive-document";

export type RewriteMode =
  | "improve"
  | "professional"
  | "executive"
  | "concise"
  | "summarize"
  | "expand"
  | "grammar"
  | "simplify";

/** Mirrors `ExecutiveAiContext` in the server module. */
export interface AiContextPayload {
  monthLabel: string;
  projectCount: number;
  approvedCount: number;
  provisional: boolean;
  planned?: number;
  actual?: number;
  variance?: number;
  healthCounts: { label: string; count: number }[];
  projects: {
    name: string;
    client?: string;
    planned?: number;
    actual?: number;
    variance?: number;
    health: string;
    basis: string;
    keyConcern?: string;
    movement?: string;
    nextMilestone?: string;
  }[];
  achievements: string[];
  risks: string[];
  decisions: string[];
  clientDependencies: string[];
  milestones: string[];
  notes: string[];
}

const MAX_ITEMS = 12;
const MAX_PROJECTS = 40;

function texts(items: AttentionItem[], withProject: boolean): string[] {
  return [...items]
    .sort(bySeverity)
    .slice(0, MAX_ITEMS)
    .map((item) => {
      const parts = [item.text.trim()];
      if (withProject) parts.push(`(${item.projectName})`);
      parts.push(`[priority ${item.priorityLabel}, status ${item.statusLabel}]`);
      if (item.dueDate) parts.push(`[due ${item.dueDate}${item.overdue ? ", overdue" : ""}]`);
      return parts.join(" ");
    });
}

function movementText(row: ProjectExecutiveRow): string | undefined {
  if (row.movement.length === 0) return NO_MOVEMENT;
  return row.movement.map((item) => `${item.label}: ${item.text}`).join("; ");
}

export function buildAiContext(model: ExecutiveDocumentModel): AiContextPayload {
  const rows = model.rows.slice(0, MAX_PROJECTS);
  const multi = rows.length > 1;

  return {
    monthLabel: model.monthLabel,
    projectCount: model.aggregate.totalProjects,
    approvedCount: model.aggregate.contributing,
    provisional: model.aggregate.noApprovedBasis,
    // The provisional figures are sent when no approved basis exists, and the
    // `provisional` flag above tells the assistant to caveat them.
    planned: model.aggregate.planned ?? model.aggregate.provisionalPlanned,
    actual: model.aggregate.actual ?? model.aggregate.provisionalActual,
    variance: model.aggregate.variance ?? model.aggregate.provisionalVariance,
    healthCounts: EXEC_HEALTH_ORDER.filter((health) => model.aggregate.health[health] > 0).map((health) => ({
      label: EXEC_HEALTH_META[health].label,
      count: model.aggregate.health[health],
    })),
    projects: rows.map((row) => ({
      name: row.projectName,
      client: row.clientName,
      planned: row.planned,
      actual: row.actual,
      variance: row.variance,
      health: row.reading.label,
      basis: MONTHLY_BASIS_META[row.basis].label,
      keyConcern: row.keyConcern?.text,
      movement: movementText(row),
      nextMilestone: row.nextMilestone
        ? `${row.nextMilestone.title}${row.nextMilestone.date ? ` (${row.nextMilestone.date})` : ""}`
        : undefined,
    })),
    achievements: texts(rows.flatMap((row) => row.achievements), multi),
    risks: texts(rows.flatMap((row) => row.risks), multi),
    decisions: texts(rows.flatMap((row) => row.decisions), multi),
    clientDependencies: texts(rows.flatMap((row) => row.clientActions), multi),
    milestones: model.milestones
      .filter((row) => row.statusLabel !== "Completed")
      .slice(0, MAX_ITEMS)
      .map((row) => `${row.title}${row.date ? ` — ${row.date}` : ""} (${row.projectName}, ${row.sourceLabel})`),
    // Only notes the author flagged for the summary. An Executive Note is
    // authored judgement and never joins the narrative by default.
    notes: model.notes
      .filter((note) => note.includeInSummary)
      .slice(0, MAX_ITEMS)
      .map((note) => note.body.trim()),
  };
}
