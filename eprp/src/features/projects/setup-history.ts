/**
 * Phase 13.9B — Step 3: the Project History "Setup & governance" feed.
 *
 * Composed ONLY from the structured source records the database already
 * keeps — no second audit store (`02` §26.24.7):
 *   project_setup_field_changes · project_setup_relation_changes ·
 *   project_setup_amendments · project_classification_corrections ·
 *   project_setup_finalisations · project_reported_progress.
 * Pure: the screen loads the records and supplies value wording.
 */

import type { ClassificationCorrection } from "@/services/classification-correction";
import type { SetupFieldChange, SetupRelationChange } from "@/services/setup-governance-service";
import type { ReportedProgressEntry, SetupFinalisation } from "./reported-progress";
import { AMENDMENT_STATUS_LABEL, type SetupAmendment } from "./setup-amendments";
import { setupFieldEntry } from "./setup-governance";
import { amendmentWording, isStructureAmendment, reportingInputText } from "./structure-amendments";

export type SetupHistoryCategory = "setup" | "amendment" | "classification" | "finalisation" | "reported_progress";

export const SETUP_HISTORY_CATEGORY_LABEL: Record<SetupHistoryCategory, string> = {
  setup: "Setup change",
  amendment: "Amendment",
  classification: "Project Type",
  finalisation: "Finalisation",
  reported_progress: "Reported Progress",
};

export interface SetupHistoryEvent {
  id: string;
  category: SetupHistoryCategory;
  /** What happened, in business words. */
  title: string;
  at: string;
  actor: string;
  /** Field or record the event concerns, where there is one. */
  subject?: string;
  previous?: string;
  next?: string;
  reason?: string;
  note?: string;
}

export interface SetupHistorySources {
  fieldChanges: readonly SetupFieldChange[];
  relationChanges: readonly SetupRelationChange[];
  amendments: readonly SetupAmendment[];
  corrections: readonly ClassificationCorrection[];
  finalisation: SetupFinalisation | null;
  reportedProgress: readonly ReportedProgressEntry[];
}

export interface SetupHistoryWording {
  /** A stored {column: value} in business words (never null / undefined / a raw id). */
  value: (fieldKey: string, value: Readonly<Record<string, unknown>> | null | undefined) => string;
  /** A correction side, e.g. "Other Project · Inspection" or "Not classified". */
  classification: (entry: ClassificationCorrection, side: "old" | "new") => string;
  date: (iso: string) => string;
}

const RELATION_NOUN: Record<SetupRelationChange["relation"], string> = {
  contacts: "Contact",
  sites: "Site",
  parties: "Party",
  departments: "Department",
  disciplines: "Program & Study",
  structure_levels: "Structure level",
  structure_units: "Structure unit",
};

const ACTION_VERB: Record<SetupRelationChange["action"], string> = {
  added: "added",
  changed: "changed",
  removed: "removed",
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** A relation image in a few words: "Port Said (Egypt, Port Said · primary)". */
export function relationSummary(relation: SetupRelationChange["relation"], image: Record<string, unknown> | null): string {
  if (!image) return "—";
  if (relation === "departments") {
    const systems = Array.isArray(image.systems) ? image.systems.filter((name) => typeof name === "string") : [];
    return `${text(image.department_name) ?? "Department"} — ${systems.length ? systems.join(", ") : "no systems"} · ${image.reporting_required === true ? "reports" : "does not report"}`;
  }
  if (relation === "disciplines") {
    const place = [text(image.department_name), text(image.system_name)].filter(Boolean).join(" · ");
    return `${text(image.discipline_name) ?? "Program & Study"}${place ? ` — ${place}` : ""}`;
  }
  if (relation === "structure_levels") {
    return `Level ${String(image.level_number ?? "")}: ${text(image.singular_label) ?? ""} / ${text(image.plural_label) ?? ""}`;
  }
  if (relation === "structure_units") {
    const name = `${text(image.name) ?? "Unit"}${text(image.code) ? ` (${text(image.code)})` : ""}`;
    const where = text(image.parent_name) ? ` under ${text(image.parent_name)}` : "";
    const state = image.archived === true ? "archived" : reportingInputText(image.weekly_reporting_required, image.monthly_reporting_required);
    return `${text(image.level_label) ?? "Unit"} ${name}${where} · ${state}`;
  }
  if (relation === "sites") {
    const place = [text(image.country), text(image.city)].filter(Boolean).join(", ");
    return `${text(image.name) ?? "Site"}${place ? ` (${place})` : ""}${image.is_primary === true ? " · primary" : ""}`;
  }
  if (relation === "parties") {
    const parts = [text(image.scope), text(image.engagement_status), text(image.contract_reference)].filter(Boolean);
    return `${text(image.name) ?? "Party"}${parts.length ? ` — ${parts.join(" · ")}` : ""}`;
  }
  const role = text(image.functional_title) ?? text(image.assignment_role)?.replace(/_/g, " ") ?? text(image.role)?.replace(/_/g, " ");
  return `${text(image.contact_name) ?? "Contact"}${role ? ` — ${role}` : ""}`;
}

/**
 * Before / after of one relation change. When only free attributes changed
 * (a unit's description or display order, a department's lead or project
 * description), the summaries would read the same, so the changed attribute
 * is named.
 */
function relationChangeSides(change: SetupRelationChange): { previous?: string; next?: string } {
  const previous = change.previousValue ? relationSummary(change.relation, change.previousValue) : undefined;
  const next = change.newValue ? relationSummary(change.relation, change.newValue) : undefined;
  if (!previous || !next || previous !== next || !change.previousValue || !change.newValue) return { previous, next };
  const before = change.previousValue;
  const after = change.newValue;
  const free: [string, string][] =
    change.relation === "structure_units"
      ? [["description", "Description"], ["sort_order", "Display order"]]
      : change.relation === "departments"
        ? [["lead_name", "Lead"], ["project_description", "Project description"]]
        : [];
  const detail = (image: Record<string, unknown>) =>
    free
      .filter(([key]) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
      .map(([key, name]) => `${name}: ${key === "sort_order" && typeof image[key] === "number" ? (image[key] as number) + 1 : text(image[key]) ?? "not set"}`)
      .join(" · ");
  const changed = detail(before);
  return changed ? { previous: `${previous} · ${changed}`, next: `${next} · ${detail(after)}` } : { previous, next };
}

const actorOf = (name: string | null | undefined, fallback: string) => (name && name.trim() ? name : fallback);
const fieldLabel = (fieldKey: string) => setupFieldEntry(fieldKey)?.label ?? fieldKey.replace(/_/g, " ");
const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

/** Every governance event of one project, newest first. */
export function composeSetupHistory(sources: SetupHistorySources, wording: SetupHistoryWording): SetupHistoryEvent[] {
  const events: SetupHistoryEvent[] = [];

  for (const change of sources.fieldChanges) {
    events.push({
      id: `field:${change.id}`,
      category: "setup",
      title: `${fieldLabel(change.fieldKey)} changed`,
      at: change.changedAt,
      actor: actorOf(change.changedByName, "Project Control"),
      subject: fieldLabel(change.fieldKey),
      previous: wording.value(change.fieldKey, change.previousValue),
      next: wording.value(change.fieldKey, change.newValue),
    });
  }

  for (const change of sources.relationChanges) {
    const sides = relationChangeSides(change);
    events.push({
      id: `relation:${change.id}`,
      category: "setup",
      title: `${RELATION_NOUN[change.relation] ?? "Setup record"} ${ACTION_VERB[change.action]}`,
      at: change.changedAt,
      actor: actorOf(change.changedByName, "Project Control"),
      subject: relationSummary(change.relation, change.newValue ?? change.previousValue),
      previous: sides.previous,
      next: sides.next,
    });
  }

  for (const amendment of sources.amendments) {
    const structure = isStructureAmendment(amendment);
    const { subject: label, previous, proposed } = amendmentWording(amendment, wording.value);
    const requester = actorOf(amendment.requestedByName, "Project Control");
    if (amendment.status === "applied") {
      events.push({
        id: `amendment:${amendment.id}`,
        category: "amendment",
        title: `${label} amended (applied with a reason)`,
        at: amendment.requestedAt,
        actor: requester,
        subject: label,
        previous,
        next: proposed,
        reason: amendment.reason,
      });
      continue;
    }
    events.push({
      id: `amendment:${amendment.id}:request`,
      category: "amendment",
      title: `${structure ? "Structure change" : "Amendment"} requested: ${label}`,
      at: amendment.requestedAt,
      actor: requester,
      subject: label,
      previous,
      next: proposed,
      reason: amendment.reason,
      note: amendment.impactWarning,
    });
    if (amendment.status !== "pending" && amendment.decidedAt) {
      events.push({
        id: `amendment:${amendment.id}:decision`,
        category: "amendment",
        title:
          amendment.status === "stale"
            ? `${structure ? "Structure change" : "Amendment"} recorded stale: ${label} — the ${structure ? "structure" : "value"} had changed, nothing was applied`
            : `${structure ? "Structure change" : "Amendment"} ${AMENDMENT_STATUS_LABEL[amendment.status].toLowerCase()}: ${label}`,
        at: amendment.decidedAt,
        actor: actorOf(amendment.decidedByName, amendment.status === "stale" ? "EPRP (stale check)" : "Project Control Admin"),
        subject: label,
        previous: amendment.status === "approved" ? previous : undefined,
        next: amendment.status === "approved" ? proposed : undefined,
        note: amendment.decisionComment ?? undefined,
      });
    }
  }

  for (const correction of sources.corrections) {
    const bootstrap = correction.correctionKind === "legacy_bootstrap";
    events.push({
      id: `classification:${correction.id}`,
      category: "classification",
      title: bootstrap ? "Legacy project classified" : "Project Type corrected",
      at: correction.correctedAt,
      actor: actorOf(correction.correctedByName, "System Administrator"),
      subject: "Project Type",
      previous: wording.classification(correction, "old"),
      next: wording.classification(correction, "new"),
      reason: correction.reason,
    });
  }

  if (sources.finalisation) {
    events.push({
      id: `finalisation:${sources.finalisation.id}`,
      category: "finalisation",
      title: "Project Setup finalised — Setup is controlled; no Planning Snapshot or SPI created",
      at: sources.finalisation.finalisedAt,
      actor: actorOf(sources.finalisation.finalisedByName, "Project Control"),
      note: sources.finalisation.note ?? undefined,
    });
  }

  for (const entry of sources.reportedProgress) {
    const date = wording.date(entry.dataDate);
    const values = `Actual ${pct(entry.reportedActualPercent)}${entry.reportedPlannedPercent !== null ? ` · Planned ${pct(entry.reportedPlannedPercent)}` : ""}`;
    events.push({
      id: `reported:${entry.id}`,
      category: "reported_progress",
      title:
        entry.entryKind === "report"
          ? `Reported Progress recorded for ${date}${entry.isBackdated ? " (back-dated)" : ""}`
          : entry.entryKind === "correction"
            ? `Reported Progress corrected for ${date}`
            : `Reported Progress withdrawn for ${date} — final`,
      at: entry.recordedAt,
      actor: actorOf(entry.recordedByName, "Project Control"),
      next: entry.entryKind === "withdrawal" ? undefined : values,
      reason: entry.reason ?? undefined,
      note: entry.narrative ?? undefined,
    });
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}
