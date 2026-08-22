/**
 * Parsing and serialisation for a report's sign-off snapshot.
 *
 * WHY THIS LIVES IN `lib/` RATHER THAN BESIDE THE EXECUTIVE COPY
 *   `features/executive-reports/executive-signatories.ts` holds the same
 *   parsing logic, but it imports `PreparedBy` from `executive-data.ts`, which
 *   imports from `@/types`. Pulling it into the Weekly service would drag the
 *   Executive data layer into the Weekly bundle, and importing it from
 *   `@/types` would close a module cycle.
 *
 *   This module has NO imports beyond the shared types, so both report tiers
 *   can depend on it safely. The Executive module is deliberately left
 *   untouched; the two are structurally identical, which is what allows the
 *   same editor component to serve both.
 *
 * WHAT A SNAPSHOT IS
 *   A copy of the name and job title as they should PRINT, taken at save time.
 *   `contactId` records only where the name was picked from and is never
 *   re-resolved, so renaming, archiving or deleting a Contact cannot rewrite a
 *   report that has already been signed.
 */

import type {
  ReportSignatory,
  ReportSignatoryRole,
  SignatorySnapshot,
} from "@/types";

export const SIGNATORY_ROLES: ReportSignatoryRole[] = [
  "prepared",
  "reviewed",
  "approved",
];

export const SIGNATORY_ROLE_LABEL: Record<ReportSignatoryRole, string> = {
  prepared: "Prepared By",
  reviewed: "Reviewed By",
  approved: "Approved By",
};

/* ------------------------------- Identity ---------------------------------- */

let fallbackCounter = 0;

/**
 * An id for a newly added signatory.
 *
 * `crypto.randomUUID` is unavailable on insecure origins and this runs in the
 * browser, so a counter-based fallback keeps the editor working rather than
 * throwing while somebody is midway through a signature block.
 */
export function newSignatoryId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }
  fallbackCounter += 1;
  return `sig-${Date.now().toString(36)}-${fallbackCounter}`;
}

/* -------------------------------- Parsing ---------------------------------- */

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseOne(value: unknown): ReportSignatory | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = cleanText(record.name);
  // A signatory with no name is not a signatory. Dropping it is safer than
  // printing an empty line that reads as an unsigned approval.
  if (!name) return null;

  const projects = Array.isArray(record.projects)
    ? record.projects
        .map(cleanText)
        .filter((entry): entry is string => Boolean(entry))
    : undefined;

  return {
    id: cleanText(record.id) ?? newSignatoryId(),
    name,
    title: cleanText(record.title),
    contactId: cleanText(record.contactId),
    projects: projects && projects.length ? projects : undefined,
  };
}

/**
 * Read the stored snapshot defensively.
 *
 * The column is JSON, so its shape is not guaranteed by the type system even
 * with the database check constraint in place. A malformed entry is dropped
 * rather than allowed to throw — a broken signature block must not take the
 * whole report down with it.
 */
export function parseSignatorySnapshot(value: unknown): SignatorySnapshot {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const snapshot: SignatorySnapshot = {};

  for (const role of SIGNATORY_ROLES) {
    const list = source[role];
    if (!Array.isArray(list)) continue;
    const people = list
      .map(parseOne)
      .filter((entry): entry is ReportSignatory => entry !== null);
    if (people.length) snapshot[role] = people;
  }

  return snapshot;
}

/** Strip anything that is not part of the stored contract before writing. */
export function serializeSignatorySnapshot(
  snapshot: SignatorySnapshot
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const role of SIGNATORY_ROLES) {
    const people = snapshot[role];
    if (!people?.length) continue;
    out[role] = people.map((person) => ({
      id: person.id,
      name: person.name,
      ...(person.title ? { title: person.title } : {}),
      ...(person.contactId ? { contactId: person.contactId } : {}),
      ...(person.projects?.length ? { projects: person.projects } : {}),
    }));
  }
  return out;
}

export function isSnapshotEmpty(snapshot: SignatorySnapshot): boolean {
  return SIGNATORY_ROLES.every((role) => !snapshot[role]?.length);
}

/* ------------------------------- Resolution -------------------------------- */

export interface ResolvedRole {
  people: ReportSignatory[];
  /** True when these names came from the saved snapshot rather than a default. */
  fromSnapshot: boolean;
}

export type ResolvedSignatories = Record<ReportSignatoryRole, ResolvedRole>;

/**
 * What the document should print for each role.
 *
 * Precedence for Prepared By:
 *   1. the saved snapshot, verbatim — this is what makes a signed report stable
 *   2. the project's Reporting Coordinator, passed in by the caller
 *   3. a blank line for completion by hand
 *
 * Reviewed and Approved are NEVER guessed. Naming a reviewer the business has
 * not appointed would put a person's name under an approval they never gave.
 * The logged-in account is never used for any role — who is looking at a report
 * says nothing about who prepared it.
 */
export function resolveSignatories(
  snapshot: SignatorySnapshot,
  defaultPrepared: ReportSignatory[] = []
): ResolvedSignatories {
  const savedPrepared = snapshot.prepared ?? [];

  return {
    prepared: savedPrepared.length
      ? { people: savedPrepared, fromSnapshot: true }
      : { people: defaultPrepared, fromSnapshot: false },
    reviewed: {
      people: snapshot.reviewed ?? [],
      fromSnapshot: Boolean(snapshot.reviewed?.length),
    },
    approved: {
      people: snapshot.approved ?? [],
      fromSnapshot: Boolean(snapshot.approved?.length),
    },
  };
}

/**
 * The snapshot the editor should open with.
 *
 * An unsaved report starts from the project's Reporting Coordinator so the
 * author edits the name the report is already printing, rather than an empty
 * block that would silently drop it on first save.
 */
export function seedSnapshot(
  snapshot: SignatorySnapshot,
  defaultPrepared: ReportSignatory[] = []
): SignatorySnapshot {
  if (snapshot.prepared?.length) return snapshot;
  if (!defaultPrepared.length) return snapshot;
  return { ...snapshot, prepared: defaultPrepared };
}
