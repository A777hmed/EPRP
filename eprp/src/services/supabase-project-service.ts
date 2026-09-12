import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AssignmentRole,
  DepartmentAssignment,
  OverallStatus,
  Priority,
  Project,
  ProjectDelegation,
  ProjectDisciplineLink,
  ProjectLifecycleStatus,
  ProjectPosition,
  ProjectSite,
  ProjectTeamMember,
  Weekday,
} from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  ProjectContactRow,
  ProjectDelegationRow,
  ProjectDepartmentRow,
  ProjectDisciplineRow,
  ProjectRow,
  ProjectPositionRow,
  ProjectSiteRow,
} from "@/lib/supabase/database.types";
// [reporting-perf] TEMPORARY diagnostic import — remove with src/lib/perf-temp.ts
import { startTimer, timed } from "@/lib/perf-temp";
import type { ProjectService } from "./project-service";
import {
  ReplacePersonError,
  type ReplacePersonInput,
  type ReplacePersonResult,
} from "./replace-person";

/**
 * Supabase-backed project service (Phase 5C). Maps the nested Project model
 * to the `projects` table plus the `project_departments` and
 * `project_contacts` join tables. Activated only when Supabase is
 * configured; the mock service is used otherwise.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `projects.id` is a `uuid` column, so Postgres rejects a malformed id with
 * `22P02 invalid input syntax` rather than returning no rows. Callers cannot
 * tell that apart from a real failure, so an id that cannot possibly exist is
 * treated here as "not found" — the same answer a well-formed but unused id
 * gets. Without this, a bad id in the URL rejects and leaves the page loading
 * forever.
 */
function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

type ProjectInput = Omit<Project, "id" | "createdAt" | "updatedAt">;

const RESPONSIBILITY_ROLES: {
  role: string;
  key: keyof Pick<
    Project,
    | "projectManagerId"
    | "projectControlManagerId"
    | "reportingCoordinatorId"
    | "clientRepresentativeId"
    | "projectSponsorId"
  >;
}[] = [
  { role: "project_manager", key: "projectManagerId" },
  { role: "project_control_manager", key: "projectControlManagerId" },
  { role: "reporting_coordinator", key: "reportingCoordinatorId" },
  { role: "client_representative", key: "clientRepresentativeId" },
  { role: "project_sponsor", key: "projectSponsorId" },
];

const RESPONSIBILITY_COLUMNS = [
  "project_manager_id",
  "project_control_manager_id",
  "reporting_coordinator_id",
  "client_representative_id",
  "project_sponsor_id",
] as const;

function responsibilityUpdateRequested(input: Partial<ProjectInput>): boolean {
  return RESPONSIBILITY_ROLES.some(({ key }) => key in input);
}

function withoutResponsibilityColumns(
  columns: Record<string, unknown>
): Record<string, unknown> {
  const staged = { ...columns };
  for (const column of RESPONSIBILITY_COLUMNS) delete staged[column];
  return staged;
}

function onlyResponsibilityColumns(
  columns: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    RESPONSIBILITY_COLUMNS.filter((column) => column in columns).map(
      (column) => [column, columns[column]]
    )
  );
}

/* ------------------------------- Mapping ---------------------------------- */

/**
 * Map a project payload to its `projects` row columns.
 *
 * **A column is written only when its key is actually present on `input`.**
 * That distinction is the whole point: `Partial<ProjectInput>` is used for
 * relation-only updates (`{ departments }`, `{ disciplines }`, `{ team }`)
 * from the Departments / Systems / Disciplines / Contacts steps, and those
 * must not touch a single Project Info column.
 *
 * The previous version guarded on the *value* (`if (value !== undefined)`)
 * while passing `input.x ?? null`. Since `undefined ?? null` is `null` — not
 * `undefined` — the guard never fired for optional fields, so every partial
 * update silently wrote NULL into 25 columns, including `project_type_id`
 * and `current_phase_id`. Saving the Departments step therefore wiped
 * Project Info, dropping it to 6/8 and re-locking Systems and Disciplines.
 *
 * Key presence still allows an explicit clear: `formValuesToProjectInfoUpdate`
 * always emits every Project Info key, so a field the user emptied arrives as
 * a present-but-undefined key and is correctly written as NULL.
 */
function flattenProject(
  input: Partial<ProjectInput>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  /** Write `col` only if the caller mentioned `key` at all. */
  const set = (col: string, key: keyof ProjectInput, value: unknown) => {
    if (!(key in input)) return;
    row[col] = value;
  };

  set("code", "code", input.code);
  set("name", "name", input.name);
  set("short_name", "shortName", input.shortName ?? null);
  set("description", "description", input.description ?? null);
  set("project_type_id", "projectTypeId", input.projectTypeId ?? null);
  set("client_id", "clientId", input.clientId);
  set("contract_number", "contractNumber", input.contractNumber ?? null);
  set("purchase_order_number", "purchaseOrderNumber", input.purchaseOrderNumber ?? null);

  set("contract_start_date", "contractStartDate", input.contractStartDate ?? null);
  set("planned_start_date", "plannedStartDate", input.plannedStartDate);
  set("actual_start_date", "actualStartDate", input.actualStartDate ?? null);
  set("planned_finish_date", "plannedFinishDate", input.plannedFinishDate);
  set("forecast_finish_date", "forecastFinishDate", input.forecastFinishDate ?? null);
  set("actual_finish_date", "actualFinishDate", input.actualFinishDate ?? null);

  set("project_manager_id", "projectManagerId", input.projectManagerId);
  set("project_control_manager_id", "projectControlManagerId", input.projectControlManagerId ?? null);
  set("client_representative_id", "clientRepresentativeId", input.clientRepresentativeId ?? null);
  set("reporting_coordinator_id", "reportingCoordinatorId", input.reportingCoordinatorId ?? null);
  set("project_sponsor_id", "projectSponsorId", input.projectSponsorId ?? null);

  set("status", "status", input.status);
  set("overall_status", "overallStatus", input.overallStatus);
  set("planned_progress", "plannedProgress", input.plannedProgress);
  set("actual_progress", "actualProgress", input.actualProgress);
  set("current_phase_id", "currentPhaseId", input.currentPhaseId ?? null);
  set("priority", "priority", input.priority);

  // The nested groups carry their own presence guard: the key is either
  // absent (relation-only update — write nothing) or fully supplied by
  // Project Info, so these assign directly rather than re-checking presence.
  if (input.reporting) {
    row.weekly_enabled = input.reporting.weeklyEnabled;
    row.monthly_enabled = input.reporting.monthlyEnabled;
    row.executive_enabled = input.reporting.executiveEnabled;
    row.weekly_reporting_day = input.reporting.weeklyReportingDay;
    row.monthly_cutoff_day = input.reporting.monthlyCutoffDay;
    row.milestone_update_approval = input.reporting.milestoneUpdateApproval;
    row.currency = input.reporting.currency;
    row.working_week = input.reporting.workingWeek;
    row.time_zone = input.reporting.timeZone;
  }
  if (input.location) {
    row.site = input.location.site ?? null;
    row.country = input.location.country ?? null;
    row.city = input.location.city ?? null;
  }
  if (input.clientContact) {
    row.client_contact_name = input.clientContact.name ?? null;
    row.client_contact_email = input.clientContact.email ?? null;
    row.client_contact_phone = input.clientContact.phone ?? null;
  }
  if (input.branding) {
    row.project_logo_ref = input.branding.projectLogoRef ?? null;
    row.client_logo_ref = input.branding.clientLogoRef ?? null;
    row.report_header_title = input.branding.reportHeaderTitle ?? null;
    row.report_footer_text = input.branding.reportFooterText ?? null;
    row.report_reference_prefix = input.branding.reportReferencePrefix ?? null;
    row.default_language = input.branding.defaultLanguage;
    row.include_qr_code = input.branding.includeQrCode;
    row.include_signature_section = input.branding.includeSignatureSection;
  }
  return row;
}

/** Wizard-added team rows are told apart from responsibility rows by role. */
const TEAM_ROLE = "team_member";

/**
 * Map the project row set onto the domain model.
 *
 * Exported because the Weekly workspace resolves the signed-in viewer's scope
 * on the server, where the browser client this module otherwise uses does not
 * exist. The mapper itself touches no client, so the server can run its own
 * queries and reuse this — one mapping, not a second one that could drift.
 */
export function rowToProject(
  row: ProjectRow,
  deptRows: ProjectDepartmentRow[],
  disciplineRows: ProjectDisciplineRow[] = [],
  teamRows: ProjectContactRow[] = [],
  delegationRows: ProjectDelegationRow[] = [],
  siteRows: ProjectSiteRow[] = [],
  positionRows: ProjectPositionRow[] = []
): Project {
  const departments: DepartmentAssignment[] = deptRows.map((d) => ({
    departmentId: d.department_id,
    projectDescription: d.project_description ?? undefined,
    leadName: d.lead_name ?? undefined,
    reportingRequired: d.reporting_required,
    systems: (d.systems ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      projectDescription: s.projectDescription,
    })),
  }));

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    shortName: row.short_name ?? undefined,
    description: row.description ?? undefined,
    projectTypeId: row.project_type_id ?? undefined,
    clientId: row.client_id,
    contractNumber: row.contract_number ?? undefined,
    purchaseOrderNumber: row.purchase_order_number ?? undefined,
    contractStartDate: row.contract_start_date ?? undefined,
    plannedStartDate: row.planned_start_date,
    actualStartDate: row.actual_start_date ?? undefined,
    plannedFinishDate: row.planned_finish_date,
    forecastFinishDate: row.forecast_finish_date ?? undefined,
    actualFinishDate: row.actual_finish_date ?? undefined,
    projectManagerId: row.project_manager_id ?? "",
    projectControlManagerId: row.project_control_manager_id ?? undefined,
    clientRepresentativeId: row.client_representative_id ?? undefined,
    reportingCoordinatorId: row.reporting_coordinator_id ?? undefined,
    projectSponsorId: row.project_sponsor_id ?? undefined,
    status: row.status as ProjectLifecycleStatus,
    overallStatus: row.overall_status as OverallStatus,
    plannedProgress: row.planned_progress,
    actualProgress: row.actual_progress,
    currentPhaseId: row.current_phase_id ?? undefined,
    priority: row.priority as Priority,
    reporting: {
      weeklyEnabled: row.weekly_enabled,
      monthlyEnabled: row.monthly_enabled,
      executiveEnabled: row.executive_enabled,
      weeklyReportingDay: row.weekly_reporting_day as Weekday,
      monthlyCutoffDay: row.monthly_cutoff_day,
      milestoneUpdateApproval:
        (row.milestone_update_approval as Project["reporting"]["milestoneUpdateApproval"]) ??
        "manual",
      currency: row.currency,
      workingWeek: row.working_week,
      timeZone: row.time_zone,
    },
    sites: siteRows
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((site) => ({
        id: site.id,
        name: site.name,
        country: site.country ?? undefined,
        city: site.city ?? undefined,
        isPrimary: site.is_primary,
        sortOrder: site.sort_order,
      })),
    positions: positionRows
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((position) => ({
        id: position.id,
        jobTitleId: position.job_title_id,
        contactId: position.contact_id,
        notes: position.notes ?? undefined,
        sortOrder: position.sort_order,
      })),
    location: {
      site: row.site ?? undefined,
      country: row.country ?? undefined,
      city: row.city ?? undefined,
    },
    clientContact: {
      name: row.client_contact_name ?? undefined,
      email: row.client_contact_email ?? undefined,
      phone: row.client_contact_phone ?? undefined,
    },
    departments,
    disciplines: disciplineRows.map((d) => ({
      disciplineId: d.discipline_id,
      departmentId: d.department_id ?? undefined,
      systemId: d.system_id ?? undefined,
    })),
    team: teamRows.map((t) => ({
      contactId: t.contact_id,
      role: t.role === TEAM_ROLE ? undefined : t.role,
      departmentId: t.department_id ?? undefined,
      systemId: t.system_id ?? undefined,
      disciplineId: t.discipline_id ?? undefined,
      assignmentRole: (t.assignment_role ?? undefined) as
        | AssignmentRole
        | undefined,
      functionalTitle: t.functional_title ?? undefined,
      reportsToContactId: t.reports_to_contact_id ?? undefined,
    })),
    delegations: delegationRows.map((d) => ({
      id: d.id,
      departmentId: d.department_id,
      delegateContactId: d.delegate_contact_id,
      responsibilities: d.responsibilities ?? [],
      startDate: d.start_date,
      endDate: d.end_date,
      note: d.note ?? undefined,
      active: d.active,
    })),
    branding: {
      projectLogoRef: row.project_logo_ref ?? undefined,
      clientLogoRef: row.client_logo_ref ?? undefined,
      reportHeaderTitle: row.report_header_title ?? undefined,
      reportFooterText: row.report_footer_text ?? undefined,
      reportReferencePrefix: row.report_reference_prefix ?? undefined,
      defaultLanguage: row.default_language as "en" | "ar",
      includeQrCode: row.include_qr_code,
      includeSignatureSection: row.include_signature_section,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ---------------------------- Join-table writes --------------------------- */

async function replaceProjectSites(
  projectId: string,
  sites: ProjectSite[]
): Promise<void> {
  const sb = client();
  const normalized = sites
    .filter((site) => site.name.trim())
    .map((site, index) => ({
      ...site,
      name: site.name.trim(),
      country: site.country?.trim() || undefined,
      city: site.city?.trim() || undefined,
      sortOrder: index,
    }));

  if (normalized.length === 0) {
    const { error } = await sb
      .from("project_sites")
      .delete()
      .eq("project_id", projectId);
    if (error) throw new Error(error.message);
    return;
  }

  const { data: currentData, error: currentError } = await sb
    .from("project_sites")
    .select("id")
    .eq("project_id", projectId);
  if (currentError) throw new Error(currentError.message);
  const currentIds = new Set(
    ((currentData ?? []) as Pick<ProjectSiteRow, "id">[]).map((row) => row.id)
  );

  const primaryIndex = Math.max(
    0,
    normalized.findIndex((site) => site.isPrimary)
  );
  const rows = normalized.map((site, index) => ({
    id:
      site.id && currentIds.has(site.id)
        ? site.id
        : globalThis.crypto.randomUUID(),
    project_id: projectId,
    name: site.name,
    country: site.country ?? null,
    city: site.city ?? null,
    // Clear first, then promote exactly one row after the upsert so the
    // partial unique index also permits changing the primary site.
    is_primary: false,
    sort_order: index,
  }));

  const { error: clearPrimaryError } = await sb
    .from("project_sites")
    .update({ is_primary: false })
    .eq("project_id", projectId);
  if (clearPrimaryError) throw new Error(clearPrimaryError.message);

  const { error: upsertError } = await sb
    .from("project_sites")
    .upsert(rows, { onConflict: "id" });
  if (upsertError) throw new Error(upsertError.message);

  const keptIds = rows.map((site) => site.id);
  const { error: deleteError } = await sb
    .from("project_sites")
    .delete()
    .eq("project_id", projectId)
    .not("id", "in", `(${keptIds.join(",")})`);
  if (deleteError) throw new Error(deleteError.message);

  const { error: primaryError } = await sb
    .from("project_sites")
    .update({ is_primary: true })
    .eq("project_id", projectId)
    .eq("id", rows[primaryIndex].id);
  if (primaryError) throw new Error(primaryError.message);
}

/**
 * Replace the project's additional positions.
 *
 * Rows carry no meaning beyond (position, person, order), so this is a plain
 * replace rather than the primary-flag dance `project_sites` needs. Rows the
 * caller still holds keep their id, so a reorder or a notes edit updates in
 * place instead of churning the row identity. Neither the Job Title nor the
 * Person master record is written.
 */
async function replaceProjectPositions(
  projectId: string,
  positions: ProjectPosition[]
): Promise<void> {
  const sb = client();
  const normalized = positions
    .filter((position) => position.jobTitleId && position.contactId)
    .map((position, index) => ({
      ...position,
      notes: position.notes?.trim() || undefined,
      sortOrder: index,
    }));

  if (normalized.length === 0) {
    const { error } = await sb
      .from("project_positions")
      .delete()
      .eq("project_id", projectId);
    if (isMissingTable(error)) return;
    if (error) throw new Error(error.message);
    return;
  }

  const { data: currentData, error: currentError } = await sb
    .from("project_positions")
    .select("id")
    .eq("project_id", projectId);
  if (isMissingTable(currentError)) return;
  if (currentError) throw new Error(currentError.message);
  const currentIds = new Set(
    ((currentData ?? []) as Pick<ProjectPositionRow, "id">[]).map(
      (row) => row.id
    )
  );

  const rows = normalized.map((position, index) => ({
    id:
      position.id && currentIds.has(position.id)
        ? position.id
        : globalThis.crypto.randomUUID(),
    project_id: projectId,
    job_title_id: position.jobTitleId,
    contact_id: position.contactId,
    notes: position.notes ?? null,
    sort_order: index,
  }));

  // Remove first: the same person may be moved between positions in one save,
  // and the (project, position, person) unique index would reject the upsert
  // while their previous row still exists.
  const keptIds = rows.map((position) => position.id);
  const { error: deleteError } = await sb
    .from("project_positions")
    .delete()
    .eq("project_id", projectId)
    .not("id", "in", `(${keptIds.join(",")})`);
  if (deleteError) throw new Error(deleteError.message);

  const { error: upsertError } = await sb
    .from("project_positions")
    .upsert(rows, { onConflict: "id" });
  if (upsertError) throw new Error(upsertError.message);
}

async function replaceDepartments(
  projectId: string,
  departments: DepartmentAssignment[]
): Promise<void> {
  const sb = client();
  await sb.from("project_departments").delete().eq("project_id", projectId);
  if (departments.length === 0) return;
  const rows = departments.map((d) => ({
    project_id: projectId,
    department_id: d.departmentId,
    project_description: d.projectDescription ?? null,
    lead_name: d.leadName ?? null,
    reporting_required: d.reportingRequired,
    systems: d.systems.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      projectDescription: s.projectDescription,
    })),
  }));
  const { error } = await sb.from("project_departments").insert(rows);
  if (error) throw new Error(error.message);
}

function responsibilityRows(
  projectId: string,
  input: Partial<ProjectInput>
) {
  return RESPONSIBILITY_ROLES.filter(({ key }) => key in input)
    .map(({ role, key }) => ({
      project_id: projectId,
      contact_id: input[key],
      role,
      department_id: null,
      system_id: null,
      discipline_id: null,
      assignment_role: null,
      functional_title: null,
      reports_to_contact_id: null,
    }))
    .filter(
      (row): row is typeof row & { contact_id: string } =>
        Boolean(row.contact_id)
    );
}

/**
 * Create missing responsibility-membership rows before fixed project columns
 * are written. Existing rows are retained so an update never removes the last
 * backing membership before its replacement is valid.
 */
async function ensureResponsibilityContacts(
  projectId: string,
  input: Partial<ProjectInput>
): Promise<void> {
  const sb = client();
  const rows = responsibilityRows(projectId, input);
  if (rows.length === 0) return;

  const roles = [...new Set(rows.map((row) => row.role))];
  const { data, error } = await sb
    .from("project_contacts")
    .select("contact_id,role")
    .eq("project_id", projectId)
    .in("role", roles);
  if (error) throw new Error(error.message);

  const existing = new Set(
    ((data ?? []) as Pick<ProjectContactRow, "contact_id" | "role">[]).map(
      (row) => `${row.role}:${row.contact_id}`
    )
  );
  const missing = rows.filter(
    (row) => !existing.has(`${row.role}:${row.contact_id}`)
  );
  if (missing.length === 0) return;

  const { error: insertError } = await sb
    .from("project_contacts")
    .insert(missing);
  if (insertError) throw new Error(insertError.message);
}

/** Remove only obsolete fixed-role rows, after the project row changed. */
async function pruneResponsibilityContacts(
  projectId: string,
  input: Partial<ProjectInput>
): Promise<void> {
  const changed = RESPONSIBILITY_ROLES.filter(({ key }) => key in input);
  if (changed.length === 0) return;

  const sb = client();
  const desiredByRole = new Map(
    changed.map(({ role, key }) => [role, input[key] ?? null])
  );
  const { data, error } = await sb
    .from("project_contacts")
    .select("id,contact_id,role")
    .eq("project_id", projectId)
    .in(
      "role",
      changed.map(({ role }) => role)
    );
  if (error) throw new Error(error.message);

  const obsoleteIds = (
    (data ?? []) as Pick<ProjectContactRow, "id" | "contact_id" | "role">[]
  )
    .filter((row) => desiredByRole.get(row.role) !== row.contact_id)
    .map((row) => row.id);
  if (obsoleteIds.length === 0) return;

  const { error: deleteError } = await sb
    .from("project_contacts")
    .delete()
    .in("id", obsoleteIds);
  if (deleteError) throw new Error(deleteError.message);
}

async function replaceDisciplineLinks(
  projectId: string,
  links: ProjectDisciplineLink[]
): Promise<void> {
  const sb = client();
  await sb.from("project_disciplines").delete().eq("project_id", projectId);
  if (links.length === 0) return;
  const { error } = await sb.from("project_disciplines").insert(
    links.map((link) => ({
      project_id: projectId,
      discipline_id: link.disciplineId,
      department_id: link.departmentId ?? null,
      system_id: link.systemId ?? null,
    }))
  );
  if (error) throw new Error(error.message);
}

async function replaceTeam(
  projectId: string,
  team: ProjectTeamMember[]
): Promise<void> {
  const sb = client();

  /*
   * Clearing a team is destructive and irreversible. A caller that had
   * not finished loading — or that read the team back empty while the
   * assignment columns were missing — used to reach here with `[]` and silently
   * wipe the project's team.
   *
   * Callers now omit the key when they do not hold the data, so an empty array
   * here should only ever mean "the user removed everyone". This confirms that
   * intent against the database before removing anything: if rows exist and
   * the caller is asking to clear them, refuse rather than guess. Removing the
   * last member through the UI is represented by a non-empty synchronization
   * until that final explicit removal, so this never treats "not loaded" as
   * authorization to erase membership.
   */
  if (team.length === 0) {
    const { count, error } = await sb
      .from("project_contacts")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("role", TEAM_ROLE);
    if (error) throw new Error(error.message);
    if (count && count > 0) {
      throw new Error(
        "Refusing to clear this project's team: an empty team was submitted while " +
          `${count} member(s) exist. Reload the project and try again — no data was changed.`
      );
    }
    return;
  }

  const base = team.map((member) => ({
    project_id: projectId,
    contact_id: member.contactId,
    role: TEAM_ROLE,
    department_id: member.departmentId ?? null,
    system_id: member.systemId ?? null,
    discipline_id: member.disciplineId ?? null,
  }));
  const withAssignment = team.map((member, index) => ({
    ...base[index],
    // An ordinary Team Member carries no explicit Assignment Role — the UI
    // (`assignment-rules.ts`'s `roleOf`) already treats that as "team_member"
    // for display and scope. Persist that same default explicitly: the RLS
    // predicate `is_department_user()` requires the literal value and NULL
    // never satisfies its `IN` check, so an implicit member would render as
    // editable while every department-scoped write was silently refused.
    assignment_role: member.assignmentRole ?? "team_member",
    functional_title: member.functionalTitle ?? null,
    reports_to_contact_id: member.reportsToContactId ?? null,
  }));

  const { data: currentData, error: currentError } = await sb
    .from("project_contacts")
    .select(
      "id,contact_id,role,department_id,system_id,discipline_id,assignment_role"
    )
    .eq("project_id", projectId)
    .eq("role", TEAM_ROLE);
  if (currentError) throw new Error(currentError.message);

  const assignmentKey = (row: {
    contact_id: string;
    department_id: string | null;
    system_id: string | null;
    discipline_id: string | null;
    assignment_role: string | null;
  }) =>
    JSON.stringify([
      row.contact_id,
      row.department_id,
      row.system_id,
      row.discipline_id,
      row.assignment_role,
    ]);

  const currentRows = (currentData ?? []) as Pick<
    ProjectContactRow,
    | "id"
    | "contact_id"
    | "department_id"
    | "system_id"
    | "discipline_id"
    | "assignment_role"
  >[];
  const existingByAssignment = new Map(
    currentRows.map((row) => [assignmentKey(row), row.id])
  );
  const rows = withAssignment.map((row) => ({
    id: existingByAssignment.get(assignmentKey(row)) ??
      globalThis.crypto.randomUUID(),
    ...row,
  }));

  // Upsert first. If a person's scope changes, the new membership exists before
  // the old row is removed, so the database can enforce the last-membership
  // invariant without breaking legitimate multi-row assignments.
  const { error: upsertError } = await sb
    .from("project_contacts")
    .upsert(rows, { onConflict: "id" });
  if (upsertError) throw new Error(upsertError.message);

  const keptIds = new Set(rows.map((row) => row.id));
  const obsoleteIds = currentRows
    .filter((row) => !keptIds.has(row.id))
    .map((row) => row.id);
  if (obsoleteIds.length === 0) return;

  const { error: deleteError } = await sb
    .from("project_contacts")
    .delete()
    .in("id", obsoleteIds);
  if (deleteError) throw new Error(deleteError.message);
}

/** PostgREST/Postgres "column not found" — the additive migration is pending. */
function isMissingColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /schema cache|does not exist/i.test(error.message ?? "")
  );
}

/**
 * `replace_project_responsibility()` tags every raised message with a stable
 * `[REASON]` prefix (Pass A migration `20260909000001_replace_person_
 * foundation.sql`) precisely so this mapping never has to guess at Postgres's
 * own wording or expose a raw SQLSTATE/UUID to a user. An error that does not
 * carry a recognized tag — a genuinely unexpected failure — falls back to a
 * fully generic message rather than forwarding whatever Postgres said.
 */
const REPLACE_PERSON_TAG_REASON: Record<string, ReplacePersonError["reason"]> = {
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "not_found",
  SAME_PERSON: "same_person",
  INVALID_INPUT: "invalid_replacement",
  INACTIVE_REPLACEMENT: "invalid_replacement",
  REASON_REQUIRED: "reason_required",
  NOT_PROJECT_MEMBER: "not_project_member",
  LAST_MEMBERSHIP_REFERENCED: "last_membership_referenced",
  STALE_ASSIGNMENT: "stale_assignment",
  DUPLICATE_ASSIGNMENT: "duplicate_assignment",
  MANAGER_CONFLICT: "manager_conflict",
};

function mapReplacePersonError(error: {
  message?: string;
} | null): ReplacePersonError {
  const match = /^\[(\w+)]\s*(.*)$/.exec(error?.message ?? "");
  if (match) {
    const [, tag, text] = match;
    const reason = REPLACE_PERSON_TAG_REASON[tag] ?? "invalid_replacement";
    return new ReplacePersonError(
      reason,
      text || "The replacement could not be completed."
    );
  }
  return new ReplacePersonError(
    "invalid_replacement",
    "The replacement could not be completed. No changes were made."
  );
}

async function replaceDelegations(
  projectId: string,
  delegations: ProjectDelegation[]
): Promise<void> {
  const sb = client();
  const { error: clearError } = await sb
    .from("project_delegations")
    .delete()
    .eq("project_id", projectId);
  if (clearError && !isMissingTable(clearError)) {
    throw new Error(clearError.message);
  }
  if (isMissingTable(clearError)) {
    // Nothing to store: the absent table changes nothing.
    if (delegations.length === 0) return;
    // Real delegations would be lost — refuse rather than drop them.
    throw new Error(
      "Delegations cannot be saved yet — the pending migration " +
        "20260804000001_project_contact_assignments.sql has not been applied. " +
        "Apply it, then save again. No data was changed."
    );
  }
  if (delegations.length === 0) return;
  const { error } = await sb.from("project_delegations").insert(
    delegations.map((delegation) => ({
      project_id: projectId,
      department_id: delegation.departmentId,
      delegate_contact_id: delegation.delegateContactId,
      responsibilities: delegation.responsibilities,
      start_date: delegation.startDate,
      end_date: delegation.endDate,
      note: delegation.note ?? null,
      active: delegation.active,
    }))
  );
  if (error) throw new Error(error.message);
}

/* ------------------------------- Reads ------------------------------------ */

async function fetchDepartmentRows(
  projectIds: string[]
): Promise<Map<string, ProjectDepartmentRow[]>> {
  const grouped = new Map<string, ProjectDepartmentRow[]>();
  if (projectIds.length === 0) return grouped;
  const { data, error } = await client()
    .from("project_departments")
    .select("*")
    .in("project_id", projectIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ProjectDepartmentRow[]) {
    const list = grouped.get(row.project_id) ?? [];
    list.push(row);
    grouped.set(row.project_id, list);
  }
  return grouped;
}

async function fetchDisciplineRows(
  projectIds: string[]
): Promise<Map<string, ProjectDisciplineRow[]>> {
  const grouped = new Map<string, ProjectDisciplineRow[]>();
  if (projectIds.length === 0) return grouped;
  const { data, error } = await client()
    .from("project_disciplines")
    .select("*")
    .in("project_id", projectIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ProjectDisciplineRow[]) {
    grouped.set(row.project_id, [...(grouped.get(row.project_id) ?? []), row]);
  }
  return grouped;
}

async function fetchTeamRows(
  projectIds: string[]
): Promise<Map<string, ProjectContactRow[]>> {
  const grouped = new Map<string, ProjectContactRow[]>();
  if (projectIds.length === 0) return grouped;
  const { data, error } = await client()
    .from("project_contacts")
    .select("*")
    .eq("role", TEAM_ROLE)
    .in("project_id", projectIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ProjectContactRow[]) {
    grouped.set(row.project_id, [...(grouped.get(row.project_id) ?? []), row]);
  }
  return grouped;
}

/**
 * True when the failure is simply that the delegations table has not been
 * created yet. The migration for it is additive and may not be applied, so a
 * read must degrade to "no delegations" rather than break every project page.
 * Any other error still propagates.
 */
function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  // PostgREST schema-cache miss, or Postgres undefined_table.
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /schema cache|does not exist/i.test(error.message ?? "")
  );
}

async function fetchDelegationRows(
  projectIds: string[]
): Promise<Map<string, ProjectDelegationRow[]>> {
  const grouped = new Map<string, ProjectDelegationRow[]>();
  if (projectIds.length === 0) return grouped;
  const { data, error } = await client()
    .from("project_delegations")
    .select("*")
    .in("project_id", projectIds);
  if (isMissingTable(error)) return grouped;
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ProjectDelegationRow[]) {
    grouped.set(row.project_id, [...(grouped.get(row.project_id) ?? []), row]);
  }
  return grouped;
}

async function fetchProjectPositionRows(
  projectIds: string[]
): Promise<Map<string, ProjectPositionRow[]>> {
  const grouped = new Map<string, ProjectPositionRow[]>();
  if (projectIds.length === 0) return grouped;
  const { data, error } = await client()
    .from("project_positions")
    .select("*")
    .in("project_id", projectIds)
    .order("sort_order", { ascending: true });
  // Missing table means the additive migration has not been applied yet; the
  // project still loads and simply shows no additional positions.
  if (isMissingTable(error)) return grouped;
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ProjectPositionRow[]) {
    grouped.set(row.project_id, [...(grouped.get(row.project_id) ?? []), row]);
  }
  return grouped;
}

async function fetchProjectSiteRows(
  projectIds: string[]
): Promise<Map<string, ProjectSiteRow[]>> {
  const grouped = new Map<string, ProjectSiteRow[]>();
  if (projectIds.length === 0) return grouped;
  const { data, error } = await client()
    .from("project_sites")
    .select("*")
    .in("project_id", projectIds)
    .order("sort_order", { ascending: true });
  if (isMissingTable(error)) return grouped;
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ProjectSiteRow[]) {
    grouped.set(row.project_id, [...(grouped.get(row.project_id) ?? []), row]);
  }
  return grouped;
}

/* ------------------------------ One project ------------------------------- */

/**
 * Read one project and its six child collections. Always a real read — no
 * cache, no sharing. Mutations use this directly so a write is never followed
 * by a snapshot taken before it.
 */
async function loadProjectById(id: string): Promise<Project | null> {
  if (!isUuid(id)) return null;
  // [reporting-perf] TEMPORARY — see src/lib/perf-temp.ts. Remove with it.
  const doneTotal = startTimer("getProjectById.TOTAL");
  const { data, error } = await timed("getProjectById.baseRow", async () =>
    client().from("projects").select("*").eq("id", id).maybeSingle()
  );
  if (error) throw new Error(error.message);
  if (!data) {
    doneTotal();
    return null;
  }
  const row = data as ProjectRow;
  const doneGroup = startTimer("getProjectById.childGroup");
  const [
    deptRows,
    disciplineRows,
    teamRows,
    delegationRows,
    siteRows,
    positionRows,
  ] = await Promise.all([
    timed("getProjectById.departments", () => fetchDepartmentRows([row.id])),
    timed("getProjectById.disciplines", () => fetchDisciplineRows([row.id])),
    timed("getProjectById.team", () => fetchTeamRows([row.id])),
    timed("getProjectById.delegations", () => fetchDelegationRows([row.id])),
    timed("getProjectById.sites", () => fetchProjectSiteRows([row.id])),
    timed("getProjectById.positions", () => fetchProjectPositionRows([row.id])),
  ]);
  doneGroup();
  doneTotal();
  return rowToProject(
    row,
    deptRows.get(row.id) ?? [],
    disciplineRows.get(row.id) ?? [],
    teamRows.get(row.id) ?? [],
    delegationRows.get(row.id) ?? [],
    siteRows.get(row.id) ?? [],
    positionRows.get(row.id) ?? []
  );
}

/**
 * Reads for the SAME project that are already in flight, shared rather than
 * repeated.
 *
 * One project screen asks for the project from several places at once. Opening
 * the Overview measured four concurrent `getProjectById` resolutions — twenty
 * eight PostgREST requests — because `ProjectSectionView` and
 * `ProjectDetailsView` each load it and React's development Strict Mode runs
 * every effect twice. Departments and Systems measured two. They are the same
 * question, asked in the same tick, by the same account.
 *
 * This is request deduplication, NOT a cache. An entry lives only while its
 * request is in flight and is removed the moment it settles, so:
 *   - the next caller after it settles issues a real read; nothing is stale;
 *   - a failure is never shared beyond the callers already waiting on it;
 *   - nothing survives a navigation, a sign-out, or an account change, so no
 *     project data can cross between users.
 * Authorization is untouched: this is still one PostgREST read under the
 * caller's own token, and Row Level Security decides what it returns.
 */
const inFlightProjects = new Map<string, Promise<Project | null>>();

function loadProjectByIdShared(id: string): Promise<Project | null> {
  const pending = inFlightProjects.get(id);
  if (pending) return pending;

  const request = loadProjectById(id).finally(() => {
    inFlightProjects.delete(id);
  });
  inFlightProjects.set(id, request);
  return request;
}

/* ------------------------------- Service ---------------------------------- */

export const supabaseProjectService: ProjectService = {
  async getProjects() {
    const { data, error } = await client()
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ProjectRow[];
    const ids = rows.map((r) => r.id);
    const [
      deptRows,
      disciplineRows,
      teamRows,
      delegationRows,
      siteRows,
      positionRows,
    ] = await Promise.all([
      fetchDepartmentRows(ids),
      fetchDisciplineRows(ids),
      fetchTeamRows(ids),
      fetchDelegationRows(ids),
      fetchProjectSiteRows(ids),
      fetchProjectPositionRows(ids),
    ]);
    return rows.map((row) =>
      rowToProject(
        row,
        deptRows.get(row.id) ?? [],
        disciplineRows.get(row.id) ?? [],
        teamRows.get(row.id) ?? [],
        delegationRows.get(row.id) ?? [],
        siteRows.get(row.id) ?? [],
        positionRows.get(row.id) ?? []
      )
    );
  },

  async getProjectById(id) {
    return loadProjectByIdShared(id);
  },

  async createProject(input) {
    const columns = flattenProject(input);
    const { data, error } = await client()
      .from("projects")
      .insert(withoutResponsibilityColumns(columns))
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const row = data as ProjectRow;

    // A fixed holder cannot be stored until the same-project membership row
    // exists. Keep every committed state valid: stage the project with null
    // holders, add the memberships, then set the fixed columns.
    await ensureResponsibilityContacts(row.id, input);
    const fixedColumns = onlyResponsibilityColumns(columns);
    if (Object.keys(fixedColumns).length > 0) {
      const { error: responsibilityError } = await client()
        .from("projects")
        .update(fixedColumns)
        .eq("id", row.id);
      if (responsibilityError) throw new Error(responsibilityError.message);
    }
    await pruneResponsibilityContacts(row.id, input);

    await replaceDepartments(row.id, input.departments);
    await replaceDisciplineLinks(row.id, input.disciplines ?? []);
    await replaceTeam(row.id, input.team ?? []);
    await replaceDelegations(row.id, input.delegations ?? []);
    await replaceProjectSites(row.id, input.sites ?? []);
    await replaceProjectPositions(row.id, input.positions ?? []);
    const created = await loadProjectById(row.id);
    if (!created) throw new Error("Project was created but could not be read back.");
    return created;
  },

  async updateProject(id, input) {
    const columns = flattenProject(input);
    const updatesResponsibilities = responsibilityUpdateRequested(input);

    // Add backing membership before the fixed column can reference it. Old
    // memberships are pruned only after the project row no longer needs them.
    if (updatesResponsibilities) {
      await ensureResponsibilityContacts(id, input);
    }

    // A relation-only update maps to zero columns; skip the no-op UPDATE
    // rather than issuing an empty PATCH.
    if (Object.keys(columns).length > 0) {
      const { error } = await client()
        .from("projects")
        .update(columns)
        .eq("id", id);
      if (error) throw new Error(error.message);
    }

    if (updatesResponsibilities) {
      await pruneResponsibilityContacts(id, input);
    }

    // Each relation is replaced only when the caller explicitly supplied it.
    // `in` rather than truthiness so an intentional `[]` (clear them all,
    // from that relation's own step) is honoured instead of ignored.
    if ("departments" in input && input.departments) {
      await replaceDepartments(id, input.departments);
    }
    if ("disciplines" in input && input.disciplines) {
      await replaceDisciplineLinks(id, input.disciplines);
    }
    if ("team" in input && input.team) {
      await replaceTeam(id, input.team);
    }
    if ("delegations" in input && input.delegations) {
      await replaceDelegations(id, input.delegations);
    }
    if ("positions" in input && input.positions) {
      await replaceProjectPositions(id, input.positions);
    }
    if ("sites" in input && input.sites) {
      await replaceProjectSites(id, input.sites);
    }
    const updated = await loadProjectById(id);
    if (!updated) throw new Error(`Project ${id} not found`);
    return updated;
  },

  async duplicateProject(id) {
    const source = await loadProjectById(id);
    if (!source) throw new Error(`Project ${id} not found`);
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...rest
    } = source;
    void _id;
    void _createdAt;
    void _updatedAt;
    return supabaseProjectService.createProject({
      ...rest,
      code: `${source.code}-COPY`,
      name: `${source.name} (Copy)`,
      status: "planning",
    });
  },

  async archiveProject(id) {
    const { error } = await client()
      .from("projects")
      .update({
        status: "archived",
        active: false,
        archived_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    const archived = await loadProjectById(id);
    if (!archived) throw new Error(`Project ${id} not found`);
    return archived;
  },

  /**
   * Probe the two additive schema objects with zero-row selects. Cheap, and
   * it lets the UI disable the affected editors up front instead of letting a
   * save fail after the user has typed.
   */
  async getAssignmentSupport() {
    const sb = client();
    const [columns, delegations] = await Promise.all([
      sb.from("project_contacts").select("assignment_role").limit(0),
      sb.from("project_delegations").select("id").limit(0),
    ]);
    return {
      assignmentColumns: !isMissingColumn(columns.error),
      delegations: !isMissingTable(delegations.error),
    };
  },

  async getUsedCodes(excludeId) {
    const { data, error } = await client().from("projects").select("id, code");
    if (error) throw new Error(error.message);
    return ((data ?? []) as { id: string; code: string }[])
      .filter((p) => p.id !== excludeId)
      .map((p) => p.code.toUpperCase());
  },

  /**
   * Replace Person, Pass A. One RPC call — see `replace_project_
   * responsibility()` in `20260909000001_replace_person_foundation.sql` for
   * the authoritative validation, authorization, reporting-line repoint and
   * history write, all inside one Postgres transaction. This wrapper only
   * shapes the three unit kinds into the function's flat parameter list and
   * maps a refusal to a {@link ReplacePersonError}; it performs no separate
   * writes of its own.
   */
  async replacePerson(input: ReplacePersonInput): Promise<ReplacePersonResult> {
    const { projectId, unit, fromContactId, toContactId, reason } = input;

    let responsibilityRole: string | null = null;
    if (unit.kind === "fixed_responsibility") {
      const meta = RESPONSIBILITY_ROLES.find(
        (candidate) => candidate.key === unit.responsibilityField
      );
      if (!meta) {
        throw new ReplacePersonError(
          "invalid_replacement",
          "Unrecognized responsibility."
        );
      }
      responsibilityRole = meta.role;
    }

    const { data, error } = await client().rpc("replace_project_responsibility", {
      p_project: projectId,
      p_unit_kind: unit.kind,
      p_from_contact: fromContactId,
      p_to_contact: toContactId,
      p_responsibility_role: responsibilityRole,
      p_department_id: unit.kind === "department_assignment" ? unit.departmentId : null,
      p_assignment_role: unit.kind === "department_assignment" ? unit.assignmentRole : null,
      p_position_id: unit.kind === "project_position" ? unit.positionId : null,
      // The RPC re-validates trimmed-non-empty itself (REASON_REQUIRED); this
      // trim is only so an all-whitespace value reads the same refusal a
      // blank one would, one round trip earlier.
      p_reason: reason.trim(),
    });
    if (error) throw mapReplacePersonError(error);

    const result = data as {
      historyId: string;
      rowsUpdated: number;
      reportsRepointed: number;
      delegationsAsDelegate: number;
      delegationsRequiringReview: number;
    };
    return {
      historyId: result.historyId,
      unitKind: unit.kind,
      rowsUpdated: result.rowsUpdated,
      reportsRepointed: result.reportsRepointed,
      delegationsAsDelegate: result.delegationsAsDelegate,
      delegationsRequiringReview: result.delegationsRequiringReview,
    };
  },
};
