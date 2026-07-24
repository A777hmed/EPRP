import type { FieldErrors } from "react-hook-form";
import type { z } from "zod";

import type { ProjectFormValues } from "./schemas/project-form";

/**
 * Form structure metadata (Phase 5A validation update): human labels per
 * field, field→section mapping, error flattening for the summary, and
 * per-section completion status.
 */

export const FIELD_LABELS: Record<string, string> = {
  name: "Project Name",
  code: "Project Code",
  shortName: "Project Short Name",
  clientId: "Client",
  contractNumber: "Contract Number",
  purchaseOrderNumber: "Purchase Order Number",
  description: "Project Description",
  projectTypeId: "Project Type",
  contractStartDate: "Contract Start Date",
  plannedStartDate: "Planned Start Date",
  actualStartDate: "Actual Start Date",
  plannedFinishDate: "Planned Finish Date",
  forecastFinishDate: "Forecast Finish Date",
  actualFinishDate: "Actual Finish Date",
  projectManagerId: "Project Manager",
  projectControlManagerId: "Project Control Manager",
  clientRepresentativeId: "Client Representative",
  reportingCoordinatorId: "Reporting Coordinator",
  projectSponsorId: "Project Sponsor",
  status: "Project Status",
  overallStatus: "Overall Status",
  plannedProgress: "Planned Progress",
  actualProgress: "Actual Progress",
  currentPhaseId: "Current Phase",
  priority: "Priority",
  weeklyEnabled: "Reporting Types",
  monthlyEnabled: "Monthly Reporting",
  executiveEnabled: "Executive Reporting",
  weeklyReportingDay: "Weekly Reporting Day",
  monthlyCutoffDay: "Monthly Cut-off Day",
  currency: "Reporting Currency",
  workingWeek: "Working Week",
  timeZone: "Time Zone",
  site: "Project Location",
  country: "Country",
  city: "City",
  clientContactName: "Client Contact Name",
  clientContactEmail: "Client Contact Email",
  clientContactPhone: "Client Contact Phone",
  departments: "Departments",
  projectLogoRef: "Project Logo",
  clientLogoRef: "Client Logo",
  reportHeaderTitle: "Report Header Title",
  reportFooterText: "Report Footer Text",
  reportReferencePrefix: "Report Reference Prefix",
  defaultLanguage: "Default Report Language",
  includeQrCode: "QR Code",
  includeSignatureSection: "Signature Section",
};

export type SectionId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const SECTION_OF_FIELD: Record<string, SectionId> = {
  name: 1, code: 1, shortName: 1, clientId: 1, contractNumber: 1,
  purchaseOrderNumber: 1, description: 1, projectTypeId: 1,
  contractStartDate: 2, plannedStartDate: 2, actualStartDate: 2,
  plannedFinishDate: 2, forecastFinishDate: 2, actualFinishDate: 2,
  projectManagerId: 3, projectControlManagerId: 3, clientRepresentativeId: 3,
  reportingCoordinatorId: 3, projectSponsorId: 3,
  status: 4, overallStatus: 4, plannedProgress: 4, actualProgress: 4,
  currentPhaseId: 4, priority: 4,
  weeklyEnabled: 5, monthlyEnabled: 5, executiveEnabled: 5,
  weeklyReportingDay: 5, monthlyCutoffDay: 5, currency: 5, workingWeek: 5,
  timeZone: 5,
  site: 6, country: 6, city: 6, clientContactName: 6, clientContactEmail: 6,
  clientContactPhone: 6,
  departments: 7,
  projectLogoRef: 8, clientLogoRef: 8, reportHeaderTitle: 8,
  reportFooterText: 8, reportReferencePrefix: 8, defaultLanguage: 8,
  includeQrCode: 8, includeSignatureSection: 8,
};

export function sectionForPath(path: readonly PropertyKey[]): SectionId {
  return SECTION_OF_FIELD[String(path[0])] ?? 1;
}

/** "departments.0.leadName" → "Department 1 — Lead". */
export function labelForPath(path: readonly PropertyKey[]): string {
  const [head, di, sub, si, leaf] = path;
  if (head === "departments" && typeof di === "number") {
    const deptLabel = `Department ${di + 1}`;
    if (sub === "systems" && typeof si === "number") {
      const leafLabel = leaf === "code" ? "Code" : "Name";
      return `${deptLabel} — System ${si + 1} ${leafLabel}`;
    }
    if (sub === "leadName") return `${deptLabel} — Lead`;
    if (sub === "departmentId") return `${deptLabel} — Department`;
    return deptLabel;
  }
  return FIELD_LABELS[String(head)] ?? String(head);
}

export interface SummaryError {
  /** RHF dot path, e.g. "departments.0.leadName". */
  fieldName: string;
  label: string;
  message: string;
}

/** Flatten RHF's nested error object into summary entries (leaf-first). */
export function flattenFormErrors(
  errors: FieldErrors<ProjectFormValues>
): SummaryError[] {
  const results: SummaryError[] = [];

  const visit = (node: unknown, path: (string | number)[]) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const hasChildErrors = Object.keys(record).some(
      (key) =>
        !["message", "type", "types", "ref", "root"].includes(key) &&
        typeof record[key] === "object"
    );
    if (typeof record.message === "string" && !hasChildErrors) {
      results.push({
        fieldName: path.join("."),
        label: labelForPath(path),
        message: record.message,
      });
      return;
    }
    for (const [key, value] of Object.entries(record)) {
      if (["message", "type", "types", "ref"].includes(key)) continue;
      const index = Number(key);
      visit(value, [...path, Number.isNaN(index) ? key : index]);
    }
  };

  for (const [key, value] of Object.entries(errors)) {
    visit(value, [key]);
  }
  return results;
}

/* --------------------------- Section statuses ----------------------------- */

export type SectionStatusKind =
  | "complete"
  | "incomplete"
  | "has-errors"
  | "optional";

export interface SectionStatus {
  kind: SectionStatusKind;
  /** Number of mandatory fields still missing (incomplete sections). */
  missingCount: number;
}

/** Sections with no mandatory fields at all. */
const OPTIONAL_SECTIONS: SectionId[] = [8];

const ALL_SECTIONS: SectionId[] = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Compute each section's status from the final-schema parse of the current
 * values (missing mandatory fields) and RHF's submitted errors.
 */
export function computeSectionStatuses(
  values: ProjectFormValues,
  finalSchema: z.ZodType<ProjectFormValues>,
  errors: FieldErrors<ProjectFormValues>
): Record<SectionId, SectionStatus> {
  const missingBySection = new Map<SectionId, number>();
  const parsed = finalSchema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const section = sectionForPath(issue.path);
      missingBySection.set(section, (missingBySection.get(section) ?? 0) + 1);
    }
  }

  const errorSections = new Set<SectionId>(
    flattenFormErrors(errors).map((e) => sectionForPath(e.fieldName.split(".")))
  );

  const result = {} as Record<SectionId, SectionStatus>;
  for (const id of ALL_SECTIONS) {
    const missingCount = missingBySection.get(id) ?? 0;
    if (errorSections.has(id)) {
      result[id] = { kind: "has-errors", missingCount };
    } else if (missingCount > 0) {
      result[id] = { kind: "incomplete", missingCount };
    } else if (OPTIONAL_SECTIONS.includes(id)) {
      result[id] = { kind: "optional", missingCount: 0 };
    } else {
      result[id] = { kind: "complete", missingCount: 0 };
    }
  }
  return result;
}
