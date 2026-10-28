/**
 * Phase 13.9B — Step 3: Project Setup amendments, presentation logic.
 *
 * Pure functions only (no React, no service). They decide what the screens
 * OFFER; the database decides what is ALLOWED (`request_ / decide_ /
 * withdraw_project_setup_amendment()`, `guard_project_setup_controlled`), so a
 * mistake here can only hide an action or surface a refusal, never widen
 * authority. Docs: `02` §26.24.2–§26.24.4, `07` §10.12.
 */

import type { PlanningOnboardingMode } from "@/types";
import { weekdayOptions, currencyOptions, workingWeekOptions, timeZoneOptions } from "./options";
import { ONBOARDING_CHOICES } from "./planning-experience";
import { setupFieldEntry, type SetupFieldClass, type SetupFieldRegistryEntry } from "./setup-governance";

/* ----------------------------- amendment model ---------------------------- */

export type AmendmentStatus = "applied" | "pending" | "approved" | "rejected" | "withdrawn" | "stale";
/** "frozen" is derived, never stored: a pending request on an archived project (B24). */
export type AmendmentDisplayStatus = AmendmentStatus | "frozen";

/** One row of `project_setup_amendments`, as the services return it. */
export interface SetupAmendment {
  id: string;
  projectId: string;
  fieldKey: string;
  /**
   * Empty for a field amendment. For a structure amendment (Step 4) the target
   * it changes — `unit:<id>`, `levels`, `department:<id>`, … — see
   * structure-amendments.ts.
   */
  targetKey: string;
  amendmentClass: "lightweight" | "governed";
  /**
   * The authoritative value the server read at request time, {column: value};
   * for a structure amendment, the target's state.
   */
  previousValue: Record<string, unknown>;
  proposedValue: Record<string, unknown>;
  reason: string;
  impactCode: string | null;
  impactWarning: string;
  requestedBy: string;
  requestedByName: string | null;
  requestedAt: string;
  status: AmendmentStatus;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
}

export const AMENDMENT_STATUS_LABEL: Record<AmendmentDisplayStatus, string> = {
  applied: "Applied",
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  stale: "Stale — nothing applied",
  frozen: "Frozen — project archived",
};

export const AMENDMENT_STATUS_TONE: Record<AmendmentDisplayStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  applied: "success",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
  stale: "warning",
  frozen: "neutral",
};

export function amendmentDisplayStatus(
  amendment: Pick<SetupAmendment, "status">,
  context: { projectArchived: boolean }
): AmendmentDisplayStatus {
  return amendment.status === "pending" && context.projectArchived ? "frozen" : amendment.status;
}

export interface AmendmentViewer {
  /** The signed-in profile (auth user) id; "" when unknown. */
  profileId: string;
  /** System Administrator or Project Control Admin. */
  isGlobalAuthority: boolean;
}

export function isOwnAmendment(amendment: Pick<SetupAmendment, "requestedBy">, viewer: AmendmentViewer): boolean {
  return Boolean(viewer.profileId) && amendment.requestedBy === viewer.profileId;
}

/** Approve / Reject: a DIFFERENT Project Control Admin or System Administrator, never on an archived project (B12, B24). */
export function canDecideAmendment(
  amendment: Pick<SetupAmendment, "status" | "requestedBy">,
  viewer: AmendmentViewer,
  context: { projectArchived: boolean }
): boolean {
  return (
    amendment.status === "pending" &&
    !context.projectArchived &&
    viewer.isGlobalAuthority &&
    Boolean(viewer.profileId) &&
    !isOwnAmendment(amendment, viewer)
  );
}

/**
 * Withdraw: only the REQUESTER, while the request is pending and the project
 * is not archived. An approver who did not make the request decides it
 * (Approve / Reject) and is never offered Withdraw. (The database still lets a
 * Project Control Admin / System Administrator withdraw — it stays
 * authoritative — but the application does not offer it.)
 */
export function canWithdrawAmendment(
  amendment: Pick<SetupAmendment, "status" | "requestedBy">,
  viewer: AmendmentViewer,
  context: { projectArchived: boolean }
): boolean {
  return amendment.status === "pending" && !context.projectArchived && isOwnAmendment(amendment, viewer);
}

/**
 * The pending FIELD request per field, so a field shows "Pending approval" and
 * cannot be amended twice. Structure requests are keyed by target instead
 * (`pendingStructureTargets`).
 */
export function pendingAmendmentsByField(amendments: readonly SetupAmendment[]): Map<string, SetupAmendment> {
  const pending = new Map<string, SetupAmendment>();
  for (const amendment of amendments) {
    if (amendment.status === "pending" && !amendment.targetKey) pending.set(amendment.fieldKey, amendment);
  }
  return pending;
}

/* --------------------------- field presentation --------------------------- */

/**
 * How a field is presented. Before Controlled every field is "editable" —
 * exactly as before 13.9B.
 */
export type FieldPresentation = "editable" | "amend" | "request" | "correction" | "retired" | "superseded";

/**
 * 13.12: once the original baseline (BL0) is approved, a field whose
 * registered future class is "superseded" (Planned Start / Finish) is
 * superseded — nobody edits or amends it; the database refuses both.
 */
export function fieldPresentation(fieldKey: string, controlled: boolean, supersededByBl0 = false): FieldPresentation {
  if (!controlled) return "editable";
  const entry = setupFieldEntry(fieldKey);
  if (!entry) return "editable";
  if (supersededByBl0 && entry.futureClass === "superseded" && entry.futureSlice === "13.12") return "superseded";
  return presentationForClass(entry.fieldClass);
}

export function presentationForClass(fieldClass: SetupFieldClass): FieldPresentation {
  switch (fieldClass) {
    case "free_logged":
      return "editable";
    case "lightweight":
      return "amend";
    case "governed":
    // 13.12 / 13.14 states are not active yet; were they, they would still
    // never be a direct edit.
    case "superseded":
    case "planning_owned":
      return "request";
    case "system_admin_correction":
      return "correction";
    case "retired":
      return "retired";
  }
}

/* ------------------------------ field inputs ------------------------------ */

export type SetupFieldInput =
  | { kind: "text"; maxLength?: number }
  | { kind: "date" }
  | { kind: "number"; min: number; max: number }
  | { kind: "switch" }
  | { kind: "select"; options: readonly { value: string; label: string }[] }
  | { kind: "client" }
  | { kind: "category" };

export interface SetupFieldUi {
  /** The Project Setup form fields that hold this key's columns, in column order. */
  formFields: readonly string[];
  input: SetupFieldInput;
}

const asOptions = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

/**
 * Every amendable column key (lightweight or governed) the Project Setup form
 * edits. `milestone_update_approval` has no Setup field today, so it is not
 * offered here; the database still governs it.
 */
export const SETUP_FIELD_UI: Readonly<Record<string, SetupFieldUi>> = {
  name: { formFields: ["name"], input: { kind: "text", maxLength: 200 } },
  short_name: { formFields: ["shortName"], input: { kind: "text", maxLength: 80 } },
  contract_number: { formFields: ["contractNumber"], input: { kind: "text", maxLength: 100 } },
  purchase_order_number: { formFields: ["purchaseOrderNumber"], input: { kind: "text", maxLength: 100 } },
  actual_start_date: { formFields: ["actualStartDate"], input: { kind: "date" } },
  actual_finish_date: { formFields: ["actualFinishDate"], input: { kind: "date" } },
  code: { formFields: ["code"], input: { kind: "text", maxLength: 40 } },
  client_id: { formFields: ["clientId"], input: { kind: "client" } },
  project_category: { formFields: ["projectTypeId", "projectCategoryDetail"], input: { kind: "category" } },
  onboarding_mode: {
    formFields: [],
    input: { kind: "select", options: ONBOARDING_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })) },
  },
  weekly_enabled: { formFields: ["weeklyEnabled"], input: { kind: "switch" } },
  monthly_enabled: { formFields: ["monthlyEnabled"], input: { kind: "switch" } },
  executive_enabled: { formFields: ["executiveEnabled"], input: { kind: "switch" } },
  weekly_reporting_day: { formFields: ["weeklyReportingDay"], input: { kind: "select", options: weekdayOptions } },
  monthly_cutoff_day: { formFields: ["monthlyCutoffDay"], input: { kind: "number", min: 1, max: 28 } },
  working_week: { formFields: ["workingWeek"], input: { kind: "select", options: asOptions(workingWeekOptions) } },
  time_zone: { formFields: ["timeZone"], input: { kind: "select", options: asOptions(timeZoneOptions) } },
  currency: { formFields: ["currency"], input: { kind: "select", options: asOptions(currencyOptions) } },
  contract_start_date: { formFields: ["contractStartDate"], input: { kind: "date" } },
  forecast_finish_date: { formFields: ["forecastFinishDate"], input: { kind: "date" } },
  planned_start_date: { formFields: ["plannedStartDate"], input: { kind: "date" } },
  planned_finish_date: { formFields: ["plannedFinishDate"], input: { kind: "date" } },
};

/** The registry entry and its UI, for an amendable column key; undefined otherwise. */
export function amendableField(fieldKey: string): { entry: SetupFieldRegistryEntry; ui: SetupFieldUi } | undefined {
  const entry = setupFieldEntry(fieldKey);
  const ui = SETUP_FIELD_UI[fieldKey];
  if (!entry || !ui || entry.kind !== "column") return undefined;
  if (entry.fieldClass !== "lightweight" && entry.fieldClass !== "governed") return undefined;
  return { entry, ui };
}

/* ------------------------------ value handling ---------------------------- */

/**
 * The proposed value in the stored form, {column: value}: blank text becomes
 * NULL, numbers are numbers, the custom category name only travels with a
 * category that accepts one.
 */
export function proposedColumnValue(
  fieldKey: string,
  draft: Readonly<Record<string, unknown>>,
  options: { categoryAllowsCustomName?: (categoryId: string) => boolean } = {}
): Record<string, unknown> {
  const entry = setupFieldEntry(fieldKey);
  if (!entry) throw new Error(`Unknown Project Setup field: ${fieldKey}`);
  const out: Record<string, unknown> = {};
  for (const column of entry.targetColumns) {
    const raw = draft[column];
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      out[column] = trimmed === "" ? null : trimmed;
    } else if (typeof raw === "number") {
      out[column] = Number.isFinite(raw) ? raw : null;
    } else {
      out[column] = raw ?? null;
    }
  }
  if (fieldKey === "monthly_cutoff_day" && typeof out.monthly_cutoff_day === "string") {
    const parsed = Number(out.monthly_cutoff_day);
    out.monthly_cutoff_day = Number.isFinite(parsed) ? parsed : null;
  }
  if (fieldKey === "project_category") {
    const categoryId = out.project_type_id;
    const allows = typeof categoryId === "string" && options.categoryAllowsCustomName?.(categoryId);
    if (!allows) out.project_category_detail = null;
  }
  return out;
}

/** Whether two {column: value} objects hold the same value (JSON-equal, key order ignored). */
export function sameColumnValue(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) return false;
  }
  return true;
}

export interface SetupValueLookups {
  clientName?: (id: string) => string | undefined;
  categoryName?: (id: string) => string | undefined;
  formatDate?: (iso: string) => string;
}

/** A stored value in business words — never "null", "undefined" or a raw id. */
export function formatSetupValue(
  fieldKey: string,
  value: Readonly<Record<string, unknown>> | null | undefined,
  lookups: SetupValueLookups = {}
): string {
  if (!value) return "Not set";
  const ui = SETUP_FIELD_UI[fieldKey];
  const entry = setupFieldEntry(fieldKey);
  const columns = entry?.targetColumns ?? Object.keys(value);
  const first = value[columns[0]];
  if (fieldKey === "project_category") {
    const id = value.project_type_id;
    if (typeof id !== "string" || !id) return "Not set";
    const name = lookups.categoryName?.(id) ?? "Selected category";
    const detail = value.project_category_detail;
    return typeof detail === "string" && detail ? `${name} · ${detail}` : name;
  }
  if (first === null || first === undefined || first === "") return "Not set";
  switch (ui?.input.kind) {
    case "switch":
      return first === true ? "Enabled" : "Disabled";
    case "date":
      return typeof first === "string" ? (lookups.formatDate ? lookups.formatDate(first) : first) : "Not set";
    case "client":
      return typeof first === "string" ? (lookups.clientName?.(first) ?? "Selected client") : "Not set";
    case "select": {
      const option = ui.input.options.find((candidate) => candidate.value === String(first));
      return option?.label ?? String(first);
    }
    default:
      return String(first);
  }
}

/** The onboarding mode value object the database stores for that key. */
export function onboardingValue(mode: PlanningOnboardingMode): Record<string, unknown> {
  return { onboarding_mode: mode };
}
