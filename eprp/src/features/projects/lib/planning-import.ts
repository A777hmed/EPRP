import type { PlanningImportSourceFormat } from "@/types";

/**
 * Planning import: parsing and validation, free of any xlsx or React
 * dependency — the same separation `organization-import.ts` uses. The
 * import wizard component owns reading the file (`XLSX.read`); this module
 * only ever sees plain JS values it is handed.
 *
 * "Never fabricate values": every field below is optional except Activity ID
 * and Activity Name. A column the source file does not carry stays
 * `undefined` on every row — it is never defaulted to a guessed value.
 */

export type PlanningImportField =
  | "activityId"
  | "activityName"
  | "activityType"
  | "wbsParent"
  | "baselineStart"
  | "baselineFinish"
  | "currentStart"
  | "currentFinish"
  | "actualStart"
  | "actualFinish"
  | "originalDuration"
  | "remainingDuration"
  | "plannedPercent"
  | "actualPercent"
  | "physicalPercent"
  | "weightPercent"
  | "status"
  | "milestoneFlag"
  | "plannedValue"
  | "earnedValue";

export const PLANNING_IMPORT_FIELDS: { field: PlanningImportField; label: string; required: boolean }[] = [
  { field: "activityId", label: "Activity ID", required: true },
  { field: "activityName", label: "Activity Name", required: true },
  { field: "activityType", label: "Activity Type", required: false },
  { field: "wbsParent", label: "WBS / Parent", required: false },
  { field: "baselineStart", label: "Baseline Start", required: false },
  { field: "baselineFinish", label: "Baseline Finish", required: false },
  { field: "currentStart", label: "Current/Forecast Start", required: false },
  { field: "currentFinish", label: "Current/Forecast Finish", required: false },
  { field: "actualStart", label: "Actual Start", required: false },
  { field: "actualFinish", label: "Actual Finish", required: false },
  { field: "originalDuration", label: "Original Duration", required: false },
  { field: "remainingDuration", label: "Remaining Duration", required: false },
  { field: "plannedPercent", label: "Planned %", required: false },
  { field: "actualPercent", label: "Actual %", required: false },
  { field: "physicalPercent", label: "Physical %", required: false },
  { field: "weightPercent", label: "Weight %", required: false },
  { field: "status", label: "Status", required: false },
  { field: "milestoneFlag", label: "Milestone", required: false },
  { field: "plannedValue", label: "Planned Value", required: false },
  { field: "earnedValue", label: "Earned Value", required: false },
];

export type ColumnMapping = Partial<Record<PlanningImportField, string | null>>;

/* --------------------------- the EPRP template ---------------------------- */

/** Deterministic: these headers map to fields by exact name, always. */
export const EPRP_TEMPLATE_HEADERS = [
  "Activity ID", "Activity Name", "Activity Type", "WBS / Parent",
  "Baseline Start", "Baseline Finish", "Current Start", "Current Finish",
  "Actual Start", "Actual Finish", "Original Duration", "Remaining Duration",
  "Planned %", "Actual %", "Physical %", "Weight %", "Status", "Milestone",
  "Planned Value", "Earned Value",
] as const;

export const EPRP_TEMPLATE_SAMPLE: Record<string, string> = {
  "Activity ID": "A-1010",
  "Activity Name": "Issue IFC Drawings",
  "Activity Type": "Engineering",
  "WBS / Parent": "WI-01",
  "Baseline Start": "2026-09-01",
  "Baseline Finish": "2026-10-15",
  "Current Start": "2026-09-01",
  "Current Finish": "2026-10-20",
  "Actual Start": "2026-09-03",
  "Actual Finish": "",
  "Original Duration": "44",
  "Remaining Duration": "12",
  "Planned %": "70",
  "Actual %": "60",
  "Physical %": "58",
  "Weight %": "5",
  "Status": "In Progress",
  "Milestone": "No",
  "Planned Value": "50000",
  "Earned Value": "29000",
};

const EPRP_TEMPLATE_MAPPING: ColumnMapping = {
  activityId: "Activity ID",
  activityName: "Activity Name",
  activityType: "Activity Type",
  wbsParent: "WBS / Parent",
  baselineStart: "Baseline Start",
  baselineFinish: "Baseline Finish",
  currentStart: "Current Start",
  currentFinish: "Current Finish",
  actualStart: "Actual Start",
  actualFinish: "Actual Finish",
  originalDuration: "Original Duration",
  remainingDuration: "Remaining Duration",
  plannedPercent: "Planned %",
  actualPercent: "Actual %",
  physicalPercent: "Physical %",
  weightPercent: "Weight %",
  status: "Status",
  milestoneFlag: "Milestone",
  plannedValue: "Planned Value",
  earnedValue: "Earned Value",
};

/* ------------------------- best-effort auto-mapping ------------------------ */

/**
 * Synonyms seen across P6 and MS Project exports. Best-effort only — the
 * brief requires mandatory user confirmation for both formats, so a wrong
 * guess here is corrected in the mapping step, never silently trusted.
 */
const FIELD_SYNONYMS: Record<PlanningImportField, string[]> = {
  activityId: ["activity id", "task id", "id", "activity_id", "task_id"],
  activityName: ["activity name", "task name", "name", "activity_name", "task_name"],
  activityType: ["activity type", "type", "task type"],
  wbsParent: ["wbs", "wbs code", "wbs path", "outline level", "parent", "wbs_code", "summary"],
  baselineStart: ["baseline start", "bl project start", "baseline1 start", "baseline_start"],
  baselineFinish: ["baseline finish", "bl project finish", "baseline1 finish", "baseline_finish"],
  currentStart: ["start", "planned start", "start date", "current start", "forecast start"],
  currentFinish: ["finish", "planned finish", "finish date", "current finish", "forecast finish"],
  actualStart: ["actual start", "act start", "actual_start"],
  actualFinish: ["actual finish", "act finish", "actual_finish"],
  originalDuration: ["original duration", "duration", "orig dur", "original_duration"],
  remainingDuration: ["remaining duration", "rem dur", "remaining_duration"],
  plannedPercent: ["planned % complete", "planned percent complete", "planned %", "schedule % complete"],
  actualPercent: ["actual % complete", "% complete", "duration % complete", "actual %"],
  physicalPercent: ["physical % complete", "physical %", "weighted % complete"],
  weightPercent: ["weight", "weight %", "weightage", "weight percent"],
  status: ["activity status", "status", "task status"],
  milestoneFlag: ["milestone", "is milestone", "activity type is milestone"],
  plannedValue: ["planned value", "pv", "bcws", "planned cost"],
  earnedValue: ["earned value", "ev", "bcwp"],
};

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function guessColumnMapping(
  headers: string[],
  sourceType: PlanningImportSourceFormat
): ColumnMapping {
  if (sourceType === "eprp_excel") {
    // Deterministic: only trust the exact template headers.
    const mapping: ColumnMapping = {};
    for (const [field, header] of Object.entries(EPRP_TEMPLATE_MAPPING)) {
      mapping[field as PlanningImportField] = headers.includes(header as string) ? header : null;
    }
    return mapping;
  }

  const normalisedHeaders = headers.map((h) => ({ raw: h, norm: normaliseHeader(h) }));
  const mapping: ColumnMapping = {};
  for (const { field, } of PLANNING_IMPORT_FIELDS) {
    const synonyms = FIELD_SYNONYMS[field];
    let match = normalisedHeaders.find((h) => synonyms.includes(h.norm));
    if (!match) {
      match = normalisedHeaders.find((h) => h.norm.includes(synonyms[0]));
    }
    mapping[field] = match ? match.raw : null;
  }
  return mapping;
}

/* -------------------------------- parsing --------------------------------- */

export interface ParsedImportRow {
  rowNumber: number;
  activityId: string;
  activityName: string;
  activityType?: string;
  wbsParent?: string;
  baselineStart?: string;
  baselineFinish?: string;
  currentStart?: string;
  currentFinish?: string;
  actualStart?: string;
  actualFinish?: string;
  originalDuration?: number;
  remainingDuration?: number;
  plannedPercent?: number;
  actualPercent?: number;
  physicalPercent?: number;
  weightPercent?: number;
  status?: string;
  isMilestone: boolean;
  plannedValue?: number;
  earnedValue?: number;
  /** Every mapped raw cell value, verbatim — becomes planning_import_rows.raw_data. */
  rawData: Record<string, unknown>;
}

function cellText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return isoDate(value);
  const text = String(value).trim();
  return text ? text : undefined;
}

function cellNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(n) ? n : undefined;
}

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Accepts a `Date` (when the sheet was read with `cellDates: true`), an Excel
 * serial number (fallback for cells that did not get date-formatted), or
 * free text in a handful of common schedule-export formats. Returns
 * `undefined` — never a fabricated date — when nothing recognisable is found.
 */
function cellDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (value instanceof Date) return isoDate(value);
  if (typeof value === "number") {
    return isoDate(new Date(EXCEL_EPOCH_MS + value * 86400000));
  }
  const text = String(value).trim();
  if (!text) return undefined;
  // ISO or slash/dash forms Date.parse already understands.
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(text)) return isoDate(direct);
  // "01-Oct-26" / "1-Oct-2026" style, common in P6 exports.
  const monthNames = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
  const match = new RegExp(`^(\\d{1,2})[- ](${monthNames})[a-z]*[- ](\\d{2,4})$`, "i").exec(text);
  if (match) {
    const day = Number(match[1]);
    const monthIndex = monthNames.split("|").indexOf(match[2].toLowerCase());
    const yearRaw = Number(match[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const parsed = new Date(Date.UTC(year, monthIndex, day));
    if (!Number.isNaN(parsed.getTime())) return isoDate(parsed);
  }
  return undefined;
}

const TRUE_VALUES = new Set(["yes", "y", "true", "1", "milestone"]);

function cellBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = cellText(value)?.toLowerCase();
  return text ? TRUE_VALUES.has(text) : false;
}

export function parseImportRows(
  rawRows: Record<string, unknown>[],
  mapping: ColumnMapping
): ParsedImportRow[] {
  const at = (row: Record<string, unknown>, field: PlanningImportField) => {
    const header = mapping[field];
    return header ? row[header] : undefined;
  };

  return rawRows.map((row, index) => {
    const rawData: Record<string, unknown> = {};
    for (const { field } of PLANNING_IMPORT_FIELDS) {
      const header = mapping[field];
      if (header) rawData[field] = row[header];
    }

    return {
      rowNumber: index + 2, // header is row 1 in the source file
      activityId: cellText(at(row, "activityId")) ?? "",
      activityName: cellText(at(row, "activityName")) ?? "",
      activityType: cellText(at(row, "activityType")),
      wbsParent: cellText(at(row, "wbsParent")),
      baselineStart: cellDate(at(row, "baselineStart")),
      baselineFinish: cellDate(at(row, "baselineFinish")),
      currentStart: cellDate(at(row, "currentStart")),
      currentFinish: cellDate(at(row, "currentFinish")),
      actualStart: cellDate(at(row, "actualStart")),
      actualFinish: cellDate(at(row, "actualFinish")),
      originalDuration: cellNumber(at(row, "originalDuration")),
      remainingDuration: cellNumber(at(row, "remainingDuration")),
      plannedPercent: cellNumber(at(row, "plannedPercent")),
      actualPercent: cellNumber(at(row, "actualPercent")),
      physicalPercent: cellNumber(at(row, "physicalPercent")),
      weightPercent: cellNumber(at(row, "weightPercent")),
      status: cellText(at(row, "status")),
      isMilestone: cellBoolean(at(row, "milestoneFlag")),
      plannedValue: cellNumber(at(row, "plannedValue")),
      earnedValue: cellNumber(at(row, "earnedValue")),
      rawData,
    };
  });
}

/* ------------------------------- validation -------------------------------- */

export type ImportIssueSeverity = "error" | "warning";

export interface ImportIssue {
  severity: ImportIssueSeverity;
  rowNumber?: number;
  code?: string;
  message: string;
}

export interface ImportValidationResult {
  rows: ParsedImportRow[];
  issues: ImportIssue[];
  stats: { total: number; errorRows: number; warningRows: number };
  canImport: boolean;
}

const PERCENT_FIELDS: (keyof ParsedImportRow)[] = [
  "plannedPercent", "actualPercent", "physicalPercent", "weightPercent",
];

/**
 * Every rule the brief lists as blocking. `existingCodes` (Master Plan work
 * item codes already in the project) lets the broken-parent-reference check
 * also catch a WBS/Parent that matches neither this file nor the plan —
 * "where detectable", not a full hierarchy resolver.
 */
export function validateImportRows(
  rows: ParsedImportRow[],
  existingCodes: Set<string> = new Set()
): ImportValidationResult {
  const issues: ImportIssue[] = [];
  const seenIds = new Map<string, number>();
  const idsInFile = new Set(rows.map((r) => r.activityId).filter(Boolean));
  const rowsWithError = new Set<number>();
  const rowsWithWarning = new Set<number>();

  const flag = (severity: ImportIssueSeverity, rowNumber: number | undefined, code: string, message: string) => {
    issues.push({ severity, rowNumber, code, message });
    if (rowNumber !== undefined) (severity === "error" ? rowsWithError : rowsWithWarning).add(rowNumber);
  };

  if (rows.length === 0) {
    issues.push({ severity: "error", code: "empty", message: "The file has no data rows." });
  }

  for (const row of rows) {
    if (!row.activityId) {
      flag("error", row.rowNumber, "missing_id", `Row ${row.rowNumber}: missing Activity ID.`);
    } else {
      const firstSeenAt = seenIds.get(row.activityId);
      if (firstSeenAt !== undefined) {
        flag("error", row.rowNumber, "duplicate_id",
          `Row ${row.rowNumber}: duplicate Activity ID "${row.activityId}" (first seen at row ${firstSeenAt}).`);
      } else {
        seenIds.set(row.activityId, row.rowNumber);
      }
    }

    if (!row.activityName) {
      flag("error", row.rowNumber, "missing_name", `Row ${row.rowNumber}: missing Activity Name.`);
    }

    if (row.currentStart && row.currentFinish && row.currentStart > row.currentFinish) {
      flag("error", row.rowNumber, "finish_before_start",
        `Row ${row.rowNumber}: Current Finish is before Current Start.`);
    }
    if (row.baselineStart && row.baselineFinish && row.baselineStart > row.baselineFinish) {
      flag("error", row.rowNumber, "baseline_finish_before_start",
        `Row ${row.rowNumber}: Baseline Finish is before Baseline Start.`);
    }
    if (row.actualStart && row.actualFinish && row.actualStart > row.actualFinish) {
      flag("error", row.rowNumber, "actual_finish_before_start",
        `Row ${row.rowNumber}: Actual Finish is before Actual Start.`);
    }

    for (const field of PERCENT_FIELDS) {
      const value = row[field] as number | undefined;
      if (value !== undefined && (value < 0 || value > 100)) {
        flag("error", row.rowNumber, "percent_out_of_range",
          `Row ${row.rowNumber}: ${field} (${value}) is outside 0–100.`);
      }
    }

    if (row.wbsParent && !idsInFile.has(row.wbsParent) && !existingCodes.has(row.wbsParent)) {
      flag("warning", row.rowNumber, "unresolved_parent",
        `Row ${row.rowNumber}: WBS/Parent "${row.wbsParent}" does not match any activity in this file or the existing Master Plan — it will be imported unlinked.`);
    }

    if (!row.activityType) {
      flag("warning", row.rowNumber, "missing_type",
        `Row ${row.rowNumber}: no Activity Type in the source — will default to "Activity".`);
    }
  }

  const total = rows.length;
  return {
    rows,
    issues,
    stats: { total, errorRows: rowsWithError.size, warningRows: rowsWithWarning.size },
    canImport: total > 0 && issues.every((issue) => issue.severity !== "error"),
  };
}
