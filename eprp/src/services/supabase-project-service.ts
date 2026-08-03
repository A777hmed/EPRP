import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DepartmentAssignment,
  OverallStatus,
  Priority,
  Project,
  ProjectDisciplineLink,
  ProjectLifecycleStatus,
  ProjectTeamMember,
  Weekday,
} from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  ProjectContactRow,
  ProjectDepartmentRow,
  ProjectDisciplineRow,
  ProjectRow,
} from "@/lib/supabase/database.types";
import type { ProjectService } from "./project-service";

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

function rowToProject(
  row: ProjectRow,
  deptRows: ProjectDepartmentRow[],
  disciplineRows: ProjectDisciplineRow[] = [],
  teamRows: ProjectContactRow[] = []
): Project {
  const departments: DepartmentAssignment[] = deptRows.map((d) => ({
    departmentId: d.department_id,
    leadName: d.lead_name ?? undefined,
    reportingRequired: d.reporting_required,
    systems: (d.systems ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
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
    projectManagerId: row.project_manager_id,
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
      currency: row.currency,
      workingWeek: row.working_week,
      timeZone: row.time_zone,
    },
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
    lead_name: d.leadName ?? null,
    reporting_required: d.reportingRequired,
    systems: d.systems.map((s) => ({ id: s.id, name: s.name, code: s.code })),
  }));
  const { error } = await sb.from("project_departments").insert(rows);
  if (error) throw new Error(error.message);
}

async function replaceContacts(
  projectId: string,
  input: Pick<
    ProjectInput,
    | "projectManagerId"
    | "projectControlManagerId"
    | "reportingCoordinatorId"
    | "clientRepresentativeId"
    | "projectSponsorId"
  >
): Promise<void> {
  const sb = client();
  // Only the responsibility rows — wizard team rows are replaced separately,
  // so saving the project form must not wipe the team.
  await sb
    .from("project_contacts")
    .delete()
    .eq("project_id", projectId)
    .in(
      "role",
      RESPONSIBILITY_ROLES.map(({ role }) => role)
    );
  const rows = RESPONSIBILITY_ROLES.map(({ role, key }) => ({
    project_id: projectId,
    contact_id: input[key],
    role,
    department_id: null,
    system_id: null,
    discipline_id: null,
  })).filter((r) => Boolean(r.contact_id));
  if (rows.length === 0) return;
  const { error } = await sb.from("project_contacts").insert(rows);
  if (error) throw new Error(error.message);
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
  await sb
    .from("project_contacts")
    .delete()
    .eq("project_id", projectId)
    .eq("role", TEAM_ROLE);
  if (team.length === 0) return;
  const { error } = await sb.from("project_contacts").insert(
    team.map((member) => ({
      project_id: projectId,
      contact_id: member.contactId,
      role: TEAM_ROLE,
      department_id: member.departmentId ?? null,
      system_id: member.systemId ?? null,
      discipline_id: member.disciplineId ?? null,
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
    const [deptRows, disciplineRows, teamRows] = await Promise.all([
      fetchDepartmentRows(ids),
      fetchDisciplineRows(ids),
      fetchTeamRows(ids),
    ]);
    return rows.map((row) =>
      rowToProject(
        row,
        deptRows.get(row.id) ?? [],
        disciplineRows.get(row.id) ?? [],
        teamRows.get(row.id) ?? []
      )
    );
  },

  async getProjectById(id) {
    if (!isUuid(id)) return null;
    const { data, error } = await client()
      .from("projects")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as ProjectRow;
    const [deptRows, disciplineRows, teamRows] = await Promise.all([
      fetchDepartmentRows([row.id]),
      fetchDisciplineRows([row.id]),
      fetchTeamRows([row.id]),
    ]);
    return rowToProject(
      row,
      deptRows.get(row.id) ?? [],
      disciplineRows.get(row.id) ?? [],
      teamRows.get(row.id) ?? []
    );
  },

  async createProject(input) {
    const { data, error } = await client()
      .from("projects")
      .insert(flattenProject(input))
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const row = data as ProjectRow;
    await replaceDepartments(row.id, input.departments);
    await replaceContacts(row.id, input);
    await replaceDisciplineLinks(row.id, input.disciplines ?? []);
    await replaceTeam(row.id, input.team ?? []);
    const created = await supabaseProjectService.getProjectById(row.id);
    if (!created) throw new Error("Project was created but could not be read back.");
    return created;
  },

  async updateProject(id, input) {
    const columns = flattenProject(input);
    // A relation-only update maps to zero columns; skip the no-op UPDATE
    // rather than issuing an empty PATCH.
    if (Object.keys(columns).length > 0) {
      const { error } = await client()
        .from("projects")
        .update(columns)
        .eq("id", id);
      if (error) throw new Error(error.message);
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
    // Responsibility contacts are Project Info fields, so they follow the
    // Project Info payload — never a relation-only update.
    if ("projectManagerId" in input) {
      await replaceContacts(id, input as ProjectInput);
    }

    const updated = await supabaseProjectService.getProjectById(id);
    if (!updated) throw new Error(`Project ${id} not found`);
    return updated;
  },

  async duplicateProject(id) {
    const source = await supabaseProjectService.getProjectById(id);
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
    const archived = await supabaseProjectService.getProjectById(id);
    if (!archived) throw new Error(`Project ${id} not found`);
    return archived;
  },

  async getUsedCodes(excludeId) {
    const { data, error } = await client().from("projects").select("id, code");
    if (error) throw new Error(error.message);
    return ((data ?? []) as { id: string; code: string }[])
      .filter((p) => p.id !== excludeId)
      .map((p) => p.code.toUpperCase());
  },
};
