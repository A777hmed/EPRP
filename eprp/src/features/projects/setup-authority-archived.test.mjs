import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 2C.3E — authority-bearing assignment rules + archived Project Setup
// read-only. SOURCE CONTRACTS for
// 20261012180000_setup_authority_and_archived_read_only.sql, the authority
// rule the screens use, mock-service parity and the read-only setup UI. No
// database connection here: runtime behaviour is proved by
// scripts/p0-validation/118_runtime_2c3e_setup_authority_archived.sql.

// The mock project service imports modules using TS syntax that Node's
// type-stripping rejects; transpile app sources loaded from here on.
registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const { resolveProjectAuthority } = await import("./use-project-authority.ts");
const { PROJECT_SETUP_ARCHIVED_MESSAGE, isSetupReadOnly, setupSaveMessage } = await import("./setup-save.ts");
const { mapProjectTypeCorrectionError, PROJECT_TYPE_CORRECTION_MESSAGES } = await import("../../services/classification-correction.ts");

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const scripts = new URL("../../../scripts/p0-validation/", import.meta.url);
const read = (dir, name) => readFileSync(new URL(name, dir), "utf8").replaceAll("\r", "");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const FILE = "20261012180000_setup_authority_and_archived_read_only.sql";
const sql = read(migrations, FILE);
const code = sql.replace(/--[^\n]*/g, "");
/** Top-level statements only: function and DO bodies collapsed. */
const topLevel = code.replace(/\$([a-z_]+)\$[\s\S]*?\$\1\$/g, "$$body$$");
const sorted = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
const fnBody = (name) => {
  const start = code.indexOf(`create function public.${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  return code.slice(start, code.indexOf("$guard$;", start));
};
const GUARDS = ["guard_archived_project_setup", "guard_archived_project_update", "guard_project_authority_rows"];
const SETUP_TABLES = ["project_departments", "project_disciplines", "project_contacts", "project_delegations",
  "project_positions", "project_sites", "project_parties"];

/* ------------------------------ migration -------------------------------- */

test("2C.3E is one additive migration directly after 2C.3D Wave 2", () => {
  const files = sorted();
  assert.equal(files.indexOf(FILE), files.indexOf("20261012150000_psm_membership_linkage.sql") + 1);
  assert.equal(files.filter((name) => name.startsWith("20261012180000")).length, 1);
  // Additive: no existing function, table, policy or grant changed.
  assert.doesNotMatch(code, /create or replace|alter table|drop |create policy|alter policy|\bgrant\b/i);
  assert.deepEqual([...code.matchAll(/create function public\.([a-z_]+)\(/g)].map((match) => match[1]), GUARDS);
  for (const earlier of files.slice(0, files.indexOf(FILE))) {
    const text = read(migrations, earlier);
    for (const name of [...GUARDS, "block_archived_project_setup"]) assert.ok(!text.includes(name), `${earlier} already uses ${name}`);
  }
  // No data is written: no backfill, and no existing row (the malformed MDP
  // rows, the stale ZZ-P0TEST-PRJ coordinator row) is normalised.
  assert.doesNotMatch(topLevel, /\b(insert into|update public\.|delete from|truncate)\b/i);
});

test("every guard is a hardened trigger function clients cannot execute", () => {
  for (const name of GUARDS) {
    assert.match(code, new RegExp(`create function public\\.${name}\\(\\) returns trigger\\s+language plpgsql security definer set search_path = ''`));
    assert.match(code, new RegExp(`revoke execute on function public\\.${name}\\(\\) from public, anon, authenticated, service_role;`));
    assert.doesNotMatch(fnBody(name), /\b(insert into|delete from)\b|update public\./, `${name} only refuses`);
  }
});

test("archived Project Setup: the project row and all seven setup tables refuse, with the existing tag; archiving still works", () => {
  const install = sql.slice(sql.indexOf("do $install$"), sql.indexOf("$install$;", sql.indexOf("do $install$")));
  assert.deepEqual([...install.matchAll(/'(project_[a-z_]+)'/g)].map((match) => match[1]), SETUP_TABLES);
  assert.match(install, /create trigger block_archived_project_setup before insert or update or delete on public\.%I/);
  assert.match(topLevel, /create trigger block_archived_project_setup\s+before update on public\.projects\s+for each row execute function public\.guard_archived_project_update\(\);/);
  const rows = fnBody("guard_archived_project_setup");
  // Both ends of an UPDATE; INSERT has no OLD, DELETE no NEW.
  assert.match(rows, /case when tg_op = 'INSERT' then null else old\.project_id end/);
  assert.match(rows, /case when tg_op = 'DELETE' then null else new\.project_id end/);
  assert.match(rows, /p\.status = 'archived'/);
  const row = fnBody("guard_archived_project_update");
  // Only an ALREADY archived project is refused, so archiving itself passes.
  assert.match(row, /if old\.status = 'archived' then/);
  assert.doesNotMatch(row, /new\.status/);
  for (const body of [rows, row]) {
    assert.match(body, /raise exception '\[PROJECT_ARCHIVED\] This project is archived; its setup is read-only\.'\s+using errcode = '42501'/);
  }
  // "block_" sorts before every existing BEFORE guard on these tables.
  for (const existing of ["enforce_project_classification", "guard_psm_assignment_membership", "guard_project_party_identity",
    "invalidate_setup_project_version", "set_updated_at", "trg_project_position_membership"]) {
    assert.ok("block_archived_project_setup" < existing, existing);
  }
});

test("Project Control / Reporting Coordinator authority rows must match the named holder at commit", () => {
  assert.match(topLevel, /create constraint trigger guard_project_authority_rows\s+after insert or update on public\.project_contacts\s+deferrable initially deferred\s+for each row/);
  assert.match(topLevel, /create constraint trigger guard_project_authority_rows\s+after update of project_control_manager_id, reporting_coordinator_id on public\.projects\s+deferrable initially deferred\s+for each row/);
  const body = fnBody("guard_project_authority_rows");
  // Only the two authority-bearing, UNSCOPED fixed-role rows — the exact rows
  // is_project_control_planning() / is_report_coordinator() read.
  assert.match(body, /new\.role in \('project_control_manager', 'reporting_coordinator'\)\s+and new\.department_id is null and new\.system_id is null\s+and new\.discipline_id is null and new\.assignment_role is null/);
  assert.match(body, /when 'project_control_manager' then p\.project_control_manager_id\s+else p\.reporting_coordinator_id end/);
  assert.match(body, /\[AUTHORITY_HOLDER_MISMATCH\]/);
});

test("authority sources unchanged; descriptive assignments stay authority-free (post-check + every migration)", () => {
  assert.match(code, /authorization helper\(s\) read descriptive assignments/);
  assert.match(code, /policies read descriptive assignments/);
  assert.match(code, /Department Manager authority no longer requires role = team_member/);
  assert.match(code, /Project Control \/ Planning authority source changed/);
  assert.match(code, /Reporting Coordinator must not hold Project Setup authority/);
  assert.doesNotMatch(code, /create function public\.(can_|is_|has_|current_)/);
  const descriptive = /project_members|project_parties|project_positions|project_delegations|project_structure_unit_members|project_structure_report_responsibilities|reports_to|functional_title|project_role/;
  let checked = 0;
  for (const file of sorted()) {
    for (const match of read(migrations, file).matchAll(/create (?:or replace )?function public\.((?:can|is|has)_[a-z_]+)\([\s\S]*?\n\$[a-z_]*\$;/g)) {
      checked += 1;
      assert.doesNotMatch(match[0], descriptive, `${file}: ${match[1]}`);
    }
  }
  assert.ok(checked > 20, `authorization helpers inspected: ${checked}`);
});

test("runtime 118 is local-only, rolled back, and covers every 2C.3E area", () => {
  const runtime = read(scripts, "118_runtime_2c3e_setup_authority_archived.sql");
  assert.match(runtime, /REFUSING TO RUN: this connection is not local/);
  assert.match(runtime, /\nrollback;\n?$/);
  assert.doesNotMatch(runtime, /\ncommit;/i);
  for (const area of ["01 ARCHIVED PSM", "02 ARCHIVED OTHER", "03 LIFECYCLE", "04 AUTHORITY", "05 ZERO AUTHORITY",
    "05 MALFORMED", "06 CHANGE", "07 HOLDER", "08 CATALOG"]) {
    assert.ok(runtime.includes(`'${area}'`), area);
  }
});

/* ------------------------ the authority rule (screens) --------------------- */

const project = (extra = {}) => ({
  id: "prj", code: "PRJ", name: "P", status: "active", structureFamily: "psm",
  projectManagerId: "pm", projectControlManagerId: "pcm", reportingCoordinatorId: "rc",
  clientRepresentativeId: "client", projectSponsorId: "sponsor", departments: [], parties: [],
  members: [
    { id: "m-w", projectId: "prj", contactId: "w", partyId: "p-eprom", projectRole: "Senior Engineer", createdAt: "t", updatedAt: "t" },
    { id: "m-r", projectId: "prj", contactId: "r", partyId: "p-eprom", projectRole: "Engineer", reportsToMemberId: "m-w", createdAt: "t", updatedAt: "t" },
  ],
  positions: [{ contactId: "pos", jobTitleId: "j" }],
  team: [{ contactId: "dm", departmentId: "d1", assignmentRole: "department_manager" }],
  updatedAt: "v1", ...extra,
});
const as = (contactId, isGlobalAuthority = false, extra = {}) => resolveProjectAuthority(project(extra), { contactId, isGlobalAuthority });

test("membership, Party, Project Role, Reports To and positions grant no authority", () => {
  for (const contactId of ["w", "r", "pos"]) {
    const authority = as(contactId);
    assert.equal(authority.canManageOperations, false, contactId);
    assert.equal(authority.canManageReporting, false, contactId);
    assert.equal(authority.holdsOperations, false, contactId);
  }
  // The rule never reads them at all.
  const rule = source("./use-project-authority.ts");
  const resolver = rule.slice(rule.indexOf("export function resolveProjectAuthority("), rule.indexOf("export function useProjectAuthority("));
  assert.doesNotMatch(resolver, /members|partyId|projectRole|reportsTo|positions|unitMembers|reportResponsibilities/);
});

test("Project Control / Planning is project-scoped; Reporting Coordinator and Department Manager keep their own scope", () => {
  assert.deepEqual(
    [as("pcm").canManageOperations, as("pcm").canManageReporting, as("pcm").holdsOperations], [true, true, true]);
  // Another project (not its holder): nothing.
  const elsewhere = as("pcm", false, { projectControlManagerId: "someone-else", reportingCoordinatorId: "x" });
  assert.deepEqual([elsewhere.canManageOperations, elsewhere.canManageReporting], [false, false]);
  // Reporting Coordinator: reporting only — never Project Setup.
  assert.deepEqual([as("rc").canManageReporting, as("rc").canManageOperations, as("rc").holdsOperations], [true, false, false]);
  // Department Manager: no setup / reporting management from the project page.
  assert.deepEqual([as("dm").canManageOperations, as("dm").canManageReporting, as("dm").canAccessProject], [false, false, true]);
  // Global authority manages every active project.
  assert.equal(as("nobody", true).canManageOperations, true);
});

test("changing or removing a named holder changes authority at once", () => {
  assert.equal(as("pcm", false, { projectControlManagerId: "z" }).canManageOperations, false);
  assert.equal(as("z", false, { projectControlManagerId: "z" }).canManageOperations, true);
  assert.equal(as("rc", false, { reportingCoordinatorId: undefined }).canManageReporting, false);
});

test("an archived project: nobody manages it; its setup managers may still VIEW setup", () => {
  for (const [contactId, global] of [["pcm", false], ["admin", true]]) {
    const authority = as(contactId, global, { status: "archived" });
    assert.equal(authority.archived, true);
    assert.equal(authority.canManageOperations, false);
    assert.equal(authority.canManageReporting, false);
    assert.equal(authority.holdsOperations, true, "read-only Project Setup");
  }
  assert.equal(as("w", false, { status: "archived" }).holdsOperations, false);
  assert.equal(isSetupReadOnly({ status: "archived" }), true);
  assert.equal(isSetupReadOnly({ status: "active" }), false);
});

/* ------------------------------ refusals ---------------------------------- */

test("the database's archived refusal reaches users as the same plain sentence everywhere", () => {
  assert.equal(PROJECT_SETUP_ARCHIVED_MESSAGE, "This project is archived; its setup is read-only.");
  assert.ok(sql.includes(`[PROJECT_ARCHIVED] ${PROJECT_SETUP_ARCHIVED_MESSAGE}`), "same words as the database");
  assert.equal(setupSaveMessage(`[PROJECT_ARCHIVED] ${PROJECT_SETUP_ARCHIVED_MESSAGE}`), PROJECT_SETUP_ARCHIVED_MESSAGE);
  const correction = mapProjectTypeCorrectionError({ message: "[PROJECT_ARCHIVED] database text", code: "42501" });
  assert.equal(correction.reason, "project_archived");
  assert.equal(correction.message, PROJECT_TYPE_CORRECTION_MESSAGES.project_archived);
  const supabase = source("../../services/supabase-project-service.ts");
  assert.match(supabase, /\/\/ 2C\.3E: archived Project Setup is read-only\.\s+PROJECT_ARCHIVED: "project_archived",/);
  assert.match(source("../../services/replace-person.ts"), /\| "project_archived";/);
});

test("project creation names every fixed holder in ONE transaction (the setup patch), never a staged authority row", () => {
  const supabase = source("../../services/supabase-project-service.ts");
  const create = supabase.slice(supabase.indexOf("  async createProject(input) {"), supabase.indexOf("  async updateProject("));
  assert.match(create, /rpc\("save_project_setup_patch", \{\s+p_project: row\.id,\s+p_expected_updated_at: staged\.updated_at,\s+p_columns: fixedColumns,\s+p_relations: \{\},/);
  assert.doesNotMatch(create, /\.update\(fixedColumns\)|ensureResponsibilityContacts|pruneResponsibilityContacts/);
  assert.doesNotMatch(supabase, /function ensureResponsibilityContacts|function pruneResponsibilityContacts/);
});

test("mock services refuse an archived project's setup exactly as the database does; archiving and duplicating still work", async () => {
  const { projectService, readMockProject } = await import("../../services/project-service.ts");
  const [first] = await projectService.getProjects();
  const archived = await projectService.archiveProject(first.id);
  assert.equal(archived.status, "archived");
  await assert.rejects(projectService.updateProject(first.id, { name: "Changed" }, archived.updatedAt),
    { message: PROJECT_SETUP_ARCHIVED_MESSAGE });
  await assert.rejects(projectService.replacePerson({ projectId: first.id, fromContactId: first.projectManagerId,
    toContactId: "someone-else", reason: "test", unit: { kind: "fixed_responsibility", responsibilityField: "projectManagerId" } }),
  { reason: "project_archived" });
  await assert.rejects(projectService.correctProjectType({ projectId: first.id, expectedUpdatedAt: archived.updatedAt,
    newFamily: "other", projectTypeId: "t", reason: "test" }), { reason: "project_archived" });
  assert.equal(readMockProject(first.id).name, first.name, "nothing changed");
  const copy = await projectService.duplicateProject(first.id);
  assert.equal(copy.status, "planning", "a copy of an archived project is a new, active project");
});

/* ------------------------------- the screens ------------------------------- */

test("archived Project Setup is shown read-only — never refused as 'not a manager', never with live controls", () => {
  const view = source("./components/setup/project-setup-view.tsx");
  // Page: the managers of an archived project get the read-only wizard.
  assert.match(view, /if \(projectId && authority\.resolved && !authority\.holdsOperations\) \{/);
  assert.match(view, /readOnly=\{authority\.resolved && authority\.archived\}/);
  // Info step: notice, disabled scope, no second editor, no classify / positions / correction save.
  // (13.9B places the Controlled banner and the amendments record between them.)
  assert.match(view, /\{readOnly && <ArchivedSetupNotice \/>\}[\s\S]*?\{\/\*[\s\S]*?\*\/\}\s+<SetupEditScope readOnly=\{readOnly\}>\s+<ProjectForm/);
  assert.match(view, /onSavePositions=\{project && !readOnly \? handleSavePositions : undefined\}/);
  // (13.9B: once Controlled the System Administrator bootstrap replaces it.)
  assert.match(view, /savedBaseline && !savedBaseline\.structureFamily && !readOnly( && !controlled)? \? handleClassify : undefined/);
  // (13.9B Step 4: nor once Setup is Controlled — the structure is governed on its own steps.)
  assert.match(view, /\{project && !readOnly( && !controlled)? && setupFlowFor\(\{ structureFamily, saved \}\) !== "other" && \(\s+<ProjectInfoWorkspace/);
  assert.equal((view.match(/^\s+assertWritable\(\);$/gm) ?? []).length, 5, "every Project Information save handler refuses");
  // Steps: save refuses first; every step viewable; PSM editors disabled; Other editors use canManage.
  assert.match(view, /const save = async \(\): Promise<boolean> => \{\s+if \(readOnly\) \{\s+toast\.error\(PROJECT_SETUP_ARCHIVED_MESSAGE\);\s+return false;/);
  assert.match(view, /if \(!status\.unlocked && !readOnly\) \{/);
  for (const editor of ["SetupStepDepartments", "SetupStepSystems", "SetupStepDisciplines", "SetupStepContacts"]) {
    // 13.9B Step 4: the PSM structure editors are also disabled once Setup is Controlled (governed).
    // (13.9B Step 4: Departments presents its own governed mode; Systems / Programs & Studies stay disabled when governed.)
    assert.match(view, new RegExp(`<SetupEditScope readOnly=\\{readOnly( \\|\\| governed)?\\}>\\s+<${editor}`), editor);
  }
  assert.match(view, /function SetupEditScope\([\s\S]+?<fieldset\s+disabled=\{readOnly\}/);
  assert.match(view, /canManageStructure=\{canManage && savedBaseline\.status !== "archived"\}/);
  assert.match(view, /canManageTeam=\{canManage && savedBaseline\.status !== "archived"\}/);
  assert.match(view, /canEditPeople=\{canEditPeopleMaster\(identity\) && !readOnly\}/);
  // Footer: navigation only.
  const footer = view.slice(view.indexOf("{readOnly ? ("), view.indexOf("Finish setup"));
  assert.match(footer, /Next/);
  assert.match(footer, /Back to Project/);
  assert.ok(footer.indexOf(") : (") < footer.indexOf("onClick={save}"), "Save only on the writable branch");
  // No Add Department link (it would link a new record to the archived project).
  const departments = source("./components/setup/setup-step-departments.tsx");
  // (13.9B Step 4: a Controlled project shows "Request department" instead; archived still shows nothing.)
  assert.match(departments, /action=\{\s+readOnly \? undefined : governed \? \(/);
});

test("other entry points: edit route, dialogs and add-and-link all refuse an archived project", () => {
  const edit = source("./components/project-form-view.tsx");
  assert.ok(edit.indexOf("authority.archived") < edit.indexOf("!authority.canManageOperations"), "archived is explained first");
  assert.match(edit, /title="This project is archived"/);
  const replace = source("./components/replace-person-dialog.tsx");
  assert.match(replace, /const canConfirm = !archived && Boolean\(toContactId\)/);
  const member = source("./components/setup/project-team-member-dialog.tsx");
  assert.match(member, /const save = async \(\) => \{\s+\/\/ 2C\.3E[^\n]*\n\s+if \(isSetupReadOnly\(project\)\) \{\s+toast\.error\(PROJECT_SETUP_ARCHIVED_MESSAGE\);\s+return;/);
  const links = source("./link-record-to-project.ts");
  assert.match(links, /if \(isSetupReadOnly\(project\)\) throw new Error\(PROJECT_SETUP_ARCHIVED_MESSAGE\);/);
  // Project section pages gate every mutation on canManageOperations, which is
  // false for every role on an archived project.
  const sections = source("./components/sections/project-section-view.tsx");
  assert.match(sections, /\{authority\.canManageOperations && \(\s+<ReplacePersonDialog/);
});
