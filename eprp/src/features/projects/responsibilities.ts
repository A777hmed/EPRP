import type { Contact, JobTitle, Project } from "@/types";

/**
 * The project's responsibility list, as one thing.
 *
 * Project Responsibility is two storage shapes wearing one hat: the five fixed
 * roles are columns on `projects`, and the open-ended ones are rows in
 * `project_positions`. That split is a persistence detail — to the business
 * there is a single list of "who is responsible for what on this project".
 *
 * This module is the one place that flattens the two into that single list.
 * Nothing here touches storage, so Contacts & Responsibilities, the Project
 * Team Summary, the Organization Chart and reporting can all read the same
 * derivation later instead of each re-deriving it and drifting. None of those
 * integrations exist yet; this only makes them possible.
 */

/** A fixed responsibility, stored as its own column on `projects`. */
export interface FixedResponsibilityMeta {
  /** Column/field name, identical on `Project` and on the form values. */
  field:
    | "projectManagerId"
    | "projectControlManagerId"
    | "clientRepresentativeId"
    | "reportingCoordinatorId"
    | "projectSponsorId";
  label: string;
  /** Whether the final schema demands it. */
  required: boolean;
}

export type FixedResponsibilityField = FixedResponsibilityMeta["field"];

/**
 * The five fixed roles, in presentation order.
 *
 * Order is deliberate rather than alphabetical: it follows the reporting line
 * the business reads it in. This list is closed — a new open-ended role belongs
 * in `project_positions`, not here.
 */
export const FIXED_RESPONSIBILITIES: readonly FixedResponsibilityMeta[] = [
  { field: "projectManagerId", label: "Project Manager", required: true },
  {
    field: "projectControlManagerId",
    label: "Project Control Manager",
    required: true,
  },
  {
    field: "clientRepresentativeId",
    label: "Client Representative",
    required: false,
  },
  {
    field: "reportingCoordinatorId",
    label: "Reporting Coordinator",
    required: true,
  },
  { field: "projectSponsorId", label: "Project Sponsor", required: false },
];

/** One additional position, as stored and as the form holds it mid-edit. */
export interface ResponsibilityPositionInput {
  id?: string;
  jobTitleId?: string;
  contactId?: string;
  notes?: string;
}

/**
 * The minimum a caller has to supply. Both `Project` and the project form's
 * values satisfy the fixed half directly, since the field names match; the
 * form passes its `additionalPositions` array as `positions`.
 */
export interface ResponsibilitySource {
  projectManagerId?: string;
  projectControlManagerId?: string;
  clientRepresentativeId?: string;
  reportingCoordinatorId?: string;
  projectSponsorId?: string;
  positions?: ResponsibilityPositionInput[];
}

/** One row of the unified responsibility list. */
export interface ResponsibilityEntry {
  /** Which storage this row came from — drives what may be done to it. */
  kind: "fixed" | "additional";
  /** Stable React key, and a stable handle for later consumers. */
  key: string;
  /** The role as displayed, e.g. "Project Manager" or "Delegate Manager". */
  roleLabel: string;
  /** Set on fixed rows only — the column that holds the person. */
  fixedField?: FixedResponsibilityField;
  /** Set on additional rows only — index into the source `positions` array. */
  positionIndex?: number;
  /** Set on additional rows only — the managed Job Title behind `roleLabel`. */
  jobTitleId?: string;
  /** "" when the role is unfilled, which only optional fixed roles may be. */
  contactId: string;
  /** Only additional rows can carry one; fixed roles have nowhere to store it. */
  notes?: string;
  /** A fixed role is part of the project's shape and cannot be removed. */
  deletable: boolean;
  /** Whether leaving it unfilled blocks a final save. */
  required: boolean;
}

/**
 * Flatten a project (or in-progress form values) into the unified list.
 *
 * Fixed roles come first and always appear, filled or not — an empty Project
 * Manager is information, not an absence. Additional positions follow in their
 * stored order. `jobTitleName` resolves the managed Job Title; an unresolved id
 * falls back to a visible placeholder rather than silently rendering blank.
 */
export function projectResponsibilities(
  source: ResponsibilitySource,
  jobTitleName: (jobTitleId: string) => string | undefined
): ResponsibilityEntry[] {
  const fixed: ResponsibilityEntry[] = FIXED_RESPONSIBILITIES.map((meta) => ({
    kind: "fixed",
    key: `fixed:${meta.field}`,
    roleLabel: meta.label,
    fixedField: meta.field,
    contactId: source[meta.field] ?? "",
    deletable: false,
    required: meta.required,
  }));

  const additional: ResponsibilityEntry[] = (source.positions ?? []).map(
    (position, index) => ({
      kind: "additional",
      // Persisted rows key on their id; an unsaved row keys on its slot, which
      // is stable for as long as it exists.
      key: position.id ? `position:${position.id}` : `position:new:${index}`,
      roleLabel:
        (position.jobTitleId ? jobTitleName(position.jobTitleId) : undefined) ??
        "Position not set",
      positionIndex: index,
      jobTitleId: position.jobTitleId,
      contactId: position.contactId ?? "",
      notes: position.notes?.trim() || undefined,
      deletable: true,
      required: true,
    })
  );

  return [...fixed, ...additional];
}

/** Convenience overload for callers holding a loaded `Project`. */
export function responsibilitiesForProject(
  project: Project,
  jobTitles: JobTitle[]
): ResponsibilityEntry[] {
  return projectResponsibilities(
    { ...project, positions: project.positions },
    (id) => jobTitles.find((title) => title.id === id)?.name
  );
}

/**
 * How a responsibility row reads: the person's name and the company they
 * belong to, both resolved from the one Person record so neither is duplicated
 * onto the project.
 */
export function responsibilityPerson(
  entry: ResponsibilityEntry,
  contacts: Contact[]
): { name?: string; organization?: string; position?: string } {
  const contact = contacts.find((record) => record.id === entry.contactId);
  if (!contact) return {};
  return {
    name: contact.name,
    organization: contact.organization?.trim() || undefined,
    position: contact.position?.trim() || undefined,
  };
}
