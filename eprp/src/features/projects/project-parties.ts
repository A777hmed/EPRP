import type { ProjectParty, SubcontractorEngagementStatus } from "@/types";

/** Controlled Engagement Status values (2C.3B). Order is the display order. */
export const SUBCONTRACTOR_ENGAGEMENT_STATUSES = [
  "planned", "active", "suspended", "completed",
] as const satisfies readonly SubcontractorEngagementStatus[];

export const ENGAGEMENT_STATUS_LABELS: Record<SubcontractorEngagementStatus, string> = {
  planned: "Planned",
  active: "Active",
  suspended: "Suspended",
  completed: "Completed",
};

/** Mirrors the database CHECK constraints in the 2C.3A and 2C.3B migrations. */
export const SUBCONTRACTOR_LIMITS = {
  name: 140, shortName: 40, scope: 250, contractReference: 100,
} as const;

export function isEngagementStatus(value: unknown): value is SubcontractorEngagementStatus {
  return typeof value === "string"
    && (SUBCONTRACTOR_ENGAGEMENT_STATUSES as readonly string[]).includes(value);
}

/** Company names are business labels: compared after trim, case-insensitively. */
export function normalizedCompanyName(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/** Indexes of rows whose company name repeats an earlier row's. Blank names are ignored. */
export function duplicateCompanyNameIndexes(names: readonly (string | undefined)[]): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  names.forEach((name, index) => {
    const key = normalizedCompanyName(name);
    if (!key) return;
    if (seen.has(key)) duplicates.push(index);
    seen.add(key);
  });
  return duplicates;
}

/** Card heading: Short Name when available, otherwise Registered Company Name. */
export function subcontractorDisplayName(party: { name?: string; shortName?: string }): string {
  return party.shortName?.trim() || party.name?.trim() || "";
}

/** A saved subcontractor (e.g. from 2C.3A) without Scope / Package or Engagement Status. */
export function subcontractorNeedsCompletion(party: ProjectParty): boolean {
  return party.kind === "subcontractor"
    && (!party.scope?.trim() || !isEngagementStatus(party.engagementStatus));
}

function optionalTrimmed(value: string | undefined, max: number, label: string): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > max) throw new Error(`Enter a subcontractor ${label} of up to ${max} characters.`);
  return trimmed || undefined;
}

/** The editable relation contains subcontractors only. Fixed parties are server-owned. */
export function subcontractorsForSave(parties: readonly ProjectParty[]): ProjectParty[] {
  if (parties.some((party) => !["eprom", "owner", "subcontractor"].includes(party.kind))) {
    throw new Error("Invalid project party type.");
  }
  const rows = parties.filter((party) => party.kind === "subcontractor");
  const ids = rows.flatMap((party) => party.id ? [party.id] : []);
  if (new Set(ids).size !== ids.length) throw new Error("A subcontractor cannot appear twice.");
  if (duplicateCompanyNameIndexes(rows.map((party) => party.name)).length > 0) {
    throw new Error("A subcontractor company name can appear only once per project.");
  }
  return rows.map((party, sortOrder) => {
    const name = party.name?.trim() ?? "";
    if (!name || name.length > SUBCONTRACTOR_LIMITS.name) {
      throw new Error(`Enter a subcontractor name of up to ${SUBCONTRACTOR_LIMITS.name} characters.`);
    }
    const scope = party.scope?.trim() ?? "";
    if (!scope || scope.length > SUBCONTRACTOR_LIMITS.scope) {
      throw new Error(`Enter a subcontractor scope / package of up to ${SUBCONTRACTOR_LIMITS.scope} characters.`);
    }
    if (!isEngagementStatus(party.engagementStatus)) {
      throw new Error("Select an engagement status for every subcontractor.");
    }
    return {
      id: party.id || undefined,
      kind: "subcontractor",
      name,
      shortName: optionalTrimmed(party.shortName, SUBCONTRACTOR_LIMITS.shortName, "short name"),
      scope,
      contractReference: optionalTrimmed(party.contractReference, SUBCONTRACTOR_LIMITS.contractReference, "contract reference"),
      engagementStatus: party.engagementStatus,
      sortOrder,
    };
  });
}

/** Mock persistence mirrors fixed identity, ordering and subcontractor replacement. */
export function persistProjectParties(
  existing: readonly ProjectParty[] | undefined,
  submitted: readonly ProjectParty[] | undefined,
  newId: () => string
): ProjectParty[] {
  const fixed = (["eprom", "owner"] as const).map((kind, sortOrder) => ({
    id: existing?.find((party) => party.kind === kind)?.id ?? newId(),
    kind,
    sortOrder,
  }));
  // Like the database: a save without a parties relation leaves stored rows,
  // including incomplete pre-2C.3B rows, exactly as they are.
  if (submitted === undefined) {
    return [...fixed, ...(existing ?? []).filter((party) => party.kind === "subcontractor")];
  }
  const rows = subcontractorsForSave(submitted);
  for (const row of rows) {
    if (row.id && !existing?.some((party) => party.id === row.id && party.kind === "subcontractor")) {
      throw new Error("Subcontractor identity does not belong to this project. Reload before saving.");
    }
  }
  return [...fixed, ...rows.map((row) => ({ ...row, id: row.id ?? newId() }))];
}
