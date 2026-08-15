/**
 * Executive Report signatories — the snapshot model.
 *
 * THE POINT OF THIS MODULE IS THAT NAMES DO NOT MOVE.
 *
 * A signature block records who signed a document at the moment it was issued.
 * If the block were rebuilt from Contacts on every read, correcting somebody's
 * job title today would rewrite the signature page of a report approved months
 * ago — the document would quietly disagree with the paper copy in the file.
 *
 * So a saved signatory is a COPY: the name and job title are written into
 * `executive_reports.signatories` at save time. `contactId` is kept only as a
 * note of where the name came from and is never re-resolved on read.
 *
 * Until a period is saved, Prepared By still falls back to the derivation in
 * `resolvePreparedBy()` — project responsibility data — so a report that nobody
 * has edited still prints the right preparer rather than a blank line.
 */

import type { PreparedBy } from "./executive-data";

export type SignatoryRole = "prepared" | "reviewed" | "approved";

export const SIGNATORY_ROLES: SignatoryRole[] = ["prepared", "reviewed", "approved"];

export const SIGNATORY_ROLE_LABEL: Record<SignatoryRole, string> = {
  prepared: "Prepared By",
  reviewed: "Reviewed By",
  approved: "Approved By",
};

export const SIGNATORY_ROLE_HINT: Record<SignatoryRole, string> = {
  prepared: "Defaults to each project's Reporting Coordinator until you set one.",
  reviewed: "Nobody is assumed — choose or type the reviewer for this period.",
  approved: "Nobody is assumed — choose or type the approving authority.",
};

/** Prepared By may carry several people; the other two roles normally carry one. */
export const SIGNATORY_ROLE_MULTIPLE: Record<SignatoryRole, boolean> = {
  prepared: true,
  reviewed: true,
  approved: true,
};

export interface Signatory {
  /** Stable within the report — used for list keys, edit and remove. */
  id: string;
  name: string;
  /** Job title / position as it should PRINT, snapshotted at save time. */
  title?: string;
  /** Where the name was picked from. Provenance only — never re-resolved. */
  contactId?: string;
  /** Projects this preparer is responsible for. Prepared By only. */
  projects?: string[];
}

export type SignatorySnapshot = Partial<Record<SignatoryRole, Signatory[]>>;

/* ------------------------------- Identity ---------------------------------- */

let fallbackCounter = 0;

/**
 * An id for a newly added signatory.
 *
 * `crypto.randomUUID` is unavailable on insecure origins, and this runs in the
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

function parseOne(value: unknown): Signatory | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = cleanText(record.name);
  // A signatory with no name is not a signatory. Dropping it is safer than
  // printing an empty line that reads as an unsigned approval.
  if (!name) return null;

  const projects = Array.isArray(record.projects)
    ? record.projects.map(cleanText).filter((entry): entry is string => Boolean(entry))
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
 * The column is JSON, so its shape is not guaranteed by the type system. A
 * malformed entry is dropped rather than allowed to throw — a broken signature
 * block must not take the whole report down with it.
 */
export function parseSignatorySnapshot(value: unknown): SignatorySnapshot {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const snapshot: SignatorySnapshot = {};

  for (const role of SIGNATORY_ROLES) {
    const list = source[role];
    if (!Array.isArray(list)) continue;
    const people = list.map(parseOne).filter((entry): entry is Signatory => entry !== null);
    if (people.length) snapshot[role] = people;
  }

  return snapshot;
}

/** Strip anything that is not part of the stored contract before writing. */
export function serializeSignatorySnapshot(snapshot: SignatorySnapshot): Record<string, unknown> {
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
  people: Signatory[];
  /** Shown in place of a name when none is assigned. */
  placeholder?: string;
  /** True when these names came from the saved snapshot rather than derivation. */
  fromSnapshot: boolean;
}

export type ResolvedSignatories = Record<SignatoryRole, ResolvedRole>;

/**
 * What the document should print for each role.
 *
 * Precedence, per role:
 *   1. the saved snapshot, verbatim — this is what makes a signed report stable
 *   2. Prepared By only: the derivation from project responsibility data
 *   3. a blank line for completion by hand
 *
 * Reviewed and Approved are never guessed. Naming a reviewer the business has
 * not appointed would put a person's name under an approval they never gave.
 */
export function resolveSignatories(
  snapshot: SignatorySnapshot,
  derivedPreparedBy: PreparedBy
): ResolvedSignatories {
  const savedPrepared = snapshot.prepared ?? [];

  const prepared: ResolvedRole = savedPrepared.length
    ? { people: savedPrepared, fromSnapshot: true }
    : {
        people: derivedPreparedBy.people.map((person) => ({
          id: person.contactId,
          contactId: person.contactId,
          name: person.name,
          title: person.title,
          projects: person.projects,
        })),
        placeholder: derivedPreparedBy.placeholder,
        fromSnapshot: false,
      };

  const roleFrom = (role: SignatoryRole): ResolvedRole => {
    const saved = snapshot[role] ?? [];
    return saved.length
      ? { people: saved, fromSnapshot: true }
      : { people: [], fromSnapshot: false };
  };

  return { prepared, reviewed: roleFrom("reviewed"), approved: roleFrom("approved") };
}

/**
 * The snapshot the editor should open with.
 *
 * An unsaved period starts from the DERIVED preparers so the author edits the
 * names the report is already printing, rather than an empty block that would
 * silently drop them on first save.
 */
export function seedSnapshot(
  snapshot: SignatorySnapshot,
  derivedPreparedBy: PreparedBy
): SignatorySnapshot {
  if (snapshot.prepared?.length) return snapshot;
  return {
    ...snapshot,
    prepared: derivedPreparedBy.people.map((person) => ({
      id: person.contactId,
      contactId: person.contactId,
      name: person.name,
      title: person.title,
      projects: person.projects,
    })),
  };
}
