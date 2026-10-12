import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 2C.3D Wave 2 — PSM linkage to canonical project membership.
// SOURCE CONTRACTS for 20261012150000_psm_membership_linkage.sql, the shared
// rules, mock-service parity and the pickers. No database connection here:
// runtime behaviour is proved by
// scripts/p0-validation/117_runtime_2c3d_psm_membership_linkage.sql.

// The mock project service imports modules using TS syntax that Node's
// type-stripping rejects; transpile app sources loaded from here on.
registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const { teamMembershipIssues, PSM_MEMBER_REQUIRED_MESSAGE } = await import("./assignment-rules.ts");
const { membershipEndResponsibility } = await import("./project-team.ts");
const { setupSaveMessage } = await import("./setup-save.ts");
const { createInMemoryProjectTeamService } = await import("../../services/project-team-service.ts");
const { mapProjectTeamError, PROJECT_TEAM_MESSAGES } = await import("../../services/project-team-errors.ts");

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const scripts = new URL("../../../scripts/p0-validation/", import.meta.url);
const read = (dir, name) => readFileSync(new URL(name, dir), "utf8").replaceAll("\r", "");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const FILE = "20261012150000_psm_membership_linkage.sql";
const sql = read(migrations, FILE);
const code = sql.replace(/--[^\n]*/g, "");
/** Top-level statements only: function and DO bodies collapsed. */
const topLevel = code.replace(/\$([a-z_]+)\$[\s\S]*?\$\1\$/g, "$$body$$");
const sorted = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
const fnBody = (name) => {
  const start = code.indexOf(`create function public.${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = code.indexOf("$guard$;", start);
  return code.slice(start, end);
};
const ASSIGNMENT_GUARD = "guard_psm_assignment_membership";
const END_GUARD = "guard_project_member_psm_responsibilities";

/* ------------------------------ migration -------------------------------- */

test("2C.3D Wave 2 is one additive migration directly after Wave 1", () => {
  const files = sorted();
  assert.equal(files.indexOf(FILE), files.indexOf("20261012100000_structure_responsibilities.sql") + 1);
  assert.equal(files.filter((name) => name.startsWith("20261012150000")).length, 1);
  // Additive: no existing function redefined, no table / policy / grant changed.
  assert.doesNotMatch(code, /create or replace|alter table|drop |create policy|alter policy|\bgrant\b/i);
  assert.deepEqual([...code.matchAll(/create function public\.([a-z_]+)\(/g)].map((match) => match[1]), [ASSIGNMENT_GUARD, END_GUARD]);
  for (const earlier of files.slice(0, files.indexOf(FILE))) {
    const text = read(migrations, earlier);
    assert.ok(!text.includes(ASSIGNMENT_GUARD) && !text.includes(END_GUARD), `${earlier} already uses a Wave 2 name`);
  }
  // No data is written: no backfill, no fabricated membership, and the six
  // malformed legacy rows are left exactly as they are.
  assert.doesNotMatch(topLevel, /\b(insert into|update public\.|delete from|truncate)\b/i);
  assert.doesNotMatch(code, /insert into public\.project_members|update public\.project_contacts|delete from public\.project_contacts/);
});

test("both guards are hardened trigger functions clients cannot execute", () => {
  for (const name of [ASSIGNMENT_GUARD, END_GUARD]) {
    assert.match(code, new RegExp(`create function public\\.${name}\\(\\) returns trigger\\s+language plpgsql security definer set search_path = ''`));
    assert.match(code, new RegExp(`revoke execute on function public\\.${name}\\(\\) from public, anon, authenticated, service_role;`));
  }
  assert.match(topLevel, /create trigger guard_psm_assignment_membership\s+before insert or update on public\.project_contacts\s+for each row execute function public\.guard_psm_assignment_membership\(\);/);
  assert.match(topLevel, /create trigger guard_project_member_psm_responsibilities\s+before update on public\.project_members\s+for each row execute function public\.guard_project_member_psm_responsibilities\(\);/);
  // BEFORE row triggers fire alphabetically: this guard answers before Wave 1's
  // unit guard and the 2C.3C write guard, matching the mock's refusal order.
  assert.ok(END_GUARD < "guard_project_member_unit_assignments" && "guard_project_member_unit_assignments" < "guard_project_member_write");
});

test("assignment guard: only department-team rows; unchanged legacy rows pass; same-project ACTIVE member and active person required", () => {
  const body = fnBody(ASSIGNMENT_GUARD);
  assert.match(body, /if not \(new\.role = 'team_member' or new\.department_id is not null or new\.system_id is not null\s+or new\.discipline_id is not null or new\.assignment_role is not null\) then\s+return new;/);
  // An UPDATE that changes none of the assignment's fields is not an edit.
  for (const field of ["project_id", "contact_id", "role", "department_id", "system_id", "discipline_id", "assignment_role", "reports_to_contact_id", "functional_title"]) {
    assert.match(body, new RegExp(`new\\.${field} is not distinct from old\\.${field}`), field);
  }
  assert.match(body, /tg_op = 'UPDATE'/);
  assert.match(body, /from public\.project_members m\s+where m\.project_id = new\.project_id and m\.contact_id = new\.contact_id and m\.ended_at is null/);
  assert.match(body, /\[PSM_MEMBER_REQUIRED\] Only an active member of this project''s team can hold a department assignment\. Add the person to the Project Team first\./);
  assert.match(body, /select c\.active and c\.archived_at is null into v_person_active/);
  assert.match(body, /\[PSM_PERSON_INACTIVE\]/);
  // Refuses only: never writes membership or anything else.
  assert.doesNotMatch(body, /\b(insert|delete)\b|update public\./);
});

test("membership-end guard: archived defers to the write guard; fixed / position first, then department assignments; nothing removed", () => {
  const body = fnBody(END_GUARD);
  assert.ok(body.indexOf("project_is_archived(old.project_id)") < body.indexOf("old.ended_at is null and new.ended_at is not null"));
  assert.match(body, /array\[p\.project_manager_id, p\.project_control_manager_id,\s+p\.reporting_coordinator_id, p\.client_representative_id,\s+p\.project_sponsor_id\]/);
  assert.match(body, /from public\.project_positions pp/);
  assert.match(body, /pc\.role = 'team_member'/);
  assert.ok(body.indexOf("[MEMBER_HAS_PROJECT_RESPONSIBILITY]") < body.indexOf("[MEMBER_HAS_PSM_ASSIGNMENTS]"));
  assert.doesNotMatch(body, /\b(insert|delete)\b|update public\./);
});

test("project_members stays authority-free and Department Manager authority still requires role = team_member", () => {
  // The migration re-proves both on apply.
  assert.match(code, /authorization helper\(s\) read project_members/);
  assert.match(code, /policies read project_members/);
  assert.match(code, /proname = 'is_weekly_department_manager'\) !~ 'pc\\\.role = ''team_member'''/);
  // And defines no authority of its own.
  assert.doesNotMatch(code, /create function public\.(can_|is_|has_|current_)/);
  // No authorization helper anywhere in the migrations reads membership.
  for (const file of sorted()) {
    for (const match of read(migrations, file).matchAll(/create (?:or replace )?function public\.((?:can|is|has)_[a-z_]+)\([\s\S]*?\n\$[a-z_]*\$;/g)) {
      assert.doesNotMatch(match[0], /project_members/, `${file}: ${match[1]}`);
    }
  }
});

test("runtime 117 is local-only, rolled back, and covers every Wave 2 area", () => {
  const runtime = read(scripts, "117_runtime_2c3d_psm_membership_linkage.sql");
  assert.match(runtime, /REFUSING TO RUN: this connection is not local/);
  assert.match(runtime, /\nrollback;\n?$/);
  assert.doesNotMatch(runtime, /\ncommit;/i);
  for (const area of ["01 NEW ASSIGNMENT", "02 INACTIVE", "03 LEGACY", "04 REPLACE PERSON", "05 END MEMBERSHIP", "06 AUTHORITY", "06 MALFORMED", "07 CATALOG"]) {
    assert.ok(runtime.includes(`'${area}'`), area);
  }
});

/* ----------------------------- shared rules ------------------------------ */

const row = (contactId, extra = {}) => ({
  contactId, departmentId: "d1", disciplineId: "s1", assignmentRole: "team_member", reportsToContactId: "dm", ...extra,
});
const active = (contactId, extra = {}) => ({ id: `m-${contactId}`, projectId: "prj", contactId, createdAt: "t", updatedAt: "t", ...extra });

test("teamMembershipIssues: new rows need an ACTIVE member of this project; unchanged legacy rows are never reported", () => {
  const members = [active("dm"), active("member"), active("former", { endedAt: "t1" })];
  const saved = { team: [row("dm", { assignmentRole: "department_manager", reportsToContactId: undefined }), row("legacy")] };
  const issues = (team) => teamMembershipIssues({ team, members }, saved);
  // New assignment for an active member: fine.
  assert.deepEqual(issues([...saved.team, row("member")]), []);
  // Global-only person (no membership) and an ENDED membership: refused.
  for (const contactId of ["global-only", "former"]) {
    assert.deepEqual(issues([...saved.team, row(contactId)]), [{ departmentId: "d1", contactId, message: PSM_MEMBER_REQUIRED_MESSAGE }], contactId);
  }
  // A membership of ANOTHER project is not in this project's members.
  assert.equal(teamMembershipIssues({ team: [row("other")], members: [] }, { team: [] }).length, 1);
  // Legacy non-member row: readable and savable unchanged; removable.
  assert.deepEqual(issues(saved.team), []);
  assert.deepEqual(issues([saved.team[0]]), []);
  // ...but editing it requires membership (title, role, Reports To, scope).
  for (const edit of [{ functionalTitle: "Lead" }, { assignmentRole: "team_member_lead" }, { reportsToContactId: "member" }, { disciplineId: "s2" }]) {
    assert.equal(issues([saved.team[0], { ...saved.team[1], ...edit }]).length, 1, JSON.stringify(edit));
  }
  // Fixed-responsibility mirror rows (role set) keep their own rules.
  assert.deepEqual(issues([...saved.team, { contactId: "pm", role: "project_manager" }]), []);
  // One issue per person and department, however many scope rows.
  assert.equal(issues([...saved.team, row("global-only"), row("global-only", { disciplineId: "s2" })]).length, 1);
  assert.equal(PSM_MEMBER_REQUIRED_MESSAGE, "Only an active member of this project's team can hold a department assignment. Add the person to the Project Team first.");
});

test("membershipEndResponsibility mirrors the database guard's order", () => {
  const project = (extra = {}) => ({ team: [], positions: [], projectManagerId: "pm", ...extra });
  assert.equal(membershipEndResponsibility(project(), "pm"), "project_responsibility");
  assert.equal(membershipEndResponsibility(project({ positions: [{ contactId: "pos" }] }), "pos"), "project_responsibility");
  assert.equal(membershipEndResponsibility(project({ team: [row("dm", { assignmentRole: "department_manager" })] }), "dm"), "psm_assignments");
  // Fixed first, even when the person also holds department assignments.
  assert.equal(membershipEndResponsibility(project({ team: [row("pm")] }), "pm"), "project_responsibility");
  // A fixed-role mirror row alone is not a department assignment.
  assert.equal(membershipEndResponsibility(project({ projectManagerId: undefined, team: [{ contactId: "x", role: "project_manager" }] }), "x"), undefined);
  assert.equal(membershipEndResponsibility(project(), "nobody"), undefined);
});

test("tagged database refusals reach the user as plain sentences", () => {
  assert.equal(setupSaveMessage("[PSM_MEMBER_REQUIRED] Only an active member of this project's team can hold a department assignment. Add the person to the Project Team first."), PSM_MEMBER_REQUIRED_MESSAGE);
  assert.equal(setupSaveMessage("[PSM_PERSON_INACTIVE] This person is inactive.\nSecond line."), "This person is inactive.\nSecond line.");
  assert.equal(setupSaveMessage("Project Setup changed since this page loaded."), "Project Setup changed since this page loaded.");
  for (const [tag, reason] of [["MEMBER_HAS_PSM_ASSIGNMENTS", "has_psm_assignments"], ["MEMBER_HAS_PROJECT_RESPONSIBILITY", "has_project_responsibility"]]) {
    const error = mapProjectTeamError({ message: `[${tag}] database text`, code: "23514" });
    assert.equal(error.reason, reason);
    assert.equal(error.message, PROJECT_TEAM_MESSAGES[reason]);
    assert.doesNotMatch(error.message, /\[|project_contacts|team_member/);
  }
  const supabase = source("../../services/supabase-project-service.ts");
  assert.match(supabase, /PSM_MEMBER_REQUIRED: "not_project_member",\s+PSM_PERSON_INACTIVE: "invalid_replacement",/);
  // Both setup save paths strip the tag.
  assert.match(supabase, /p_relations: relations,\s+\}\);\s+if \(error\) throw new Error\(setupSaveMessage\(error\.message\)\);/);
  assert.match(source("../../services/project-setup-save.ts"), /if \(error\) throw new Error\(setupSaveMessage\(error\.message\)\);/);
});

/* --------------------------- mock-service parity -------------------------- */

function teamMock(project) {
  const state = { ...project, updatedAt: "v1" };
  const service = createInMemoryProjectTeamService({
    read: () => structuredClone(state),
    writeMembers: (_, members) => { state.members = members; state.updatedAt = "v2"; return "v2"; },
    unitAssignments: () => undefined,
  }, { now: () => "now" });
  return (memberId) => service.endMember({ projectId: "prj", version: "v1", memberId }).then(() => "ended", (error) => error.reason);
}

test("mock parity: ending a membership is refused while PSM responsibility exists, with the database's reasons", async () => {
  const base = {
    id: "prj", status: "planning", projectManagerId: "pm", parties: [], positions: [{ contactId: "pos", jobTitleId: "j" }],
    members: ["pm", "pos", "dm", "lead", "member", "mirror", "free"].map((contactId) => active(contactId)),
    team: [
      row("dm", { assignmentRole: "department_manager", reportsToContactId: undefined }),
      row("lead", { assignmentRole: "team_member_lead" }),
      row("member"),
      { contactId: "mirror", role: "project_control_manager" },
    ],
  };
  const end = teamMock(base);
  assert.equal(await end("m-pm"), "has_project_responsibility");
  assert.equal(await end("m-pos"), "has_project_responsibility");
  for (const contactId of ["dm", "lead", "member"]) assert.equal(await end(`m-${contactId}`), "has_psm_assignments", contactId);
  // Not a holder (the mock keeps no fixed column for "mirror") and no assignment: ends.
  assert.equal(await end("m-mirror"), "ended");
  assert.equal(await teamMock(base)("m-free"), "ended");
});

test("mock project service mirrors the database: new / edited assignments need membership; legacy rows stay; duplicate has no team", async () => {
  const { projectService, readMockProject } = await import("../../services/project-service.ts");
  const { projectTeamService } = await import("../../services/project-team-service.ts");
  const { mockContacts } = await import("../../data/mock/master-data.mock.ts");
  const project = (await projectService.getProjects()).find((candidate) =>
    (candidate.team ?? []).some((entry) => !entry.role && entry.departmentId && entry.assignmentRole === "department_manager"));
  assert.ok(project, "a mock PSM project with a Department Manager");
  assert.equal(readMockProject(project.id).members.length, 0, "mock memberships start empty, as no backfill is made");
  const manager = project.team.find((entry) => !entry.role && entry.assignmentRole === "department_manager");
  const outsider = mockContacts.find((contact) => contact.active && !project.team.some((entry) => entry.contactId === contact.id)
    && ![project.projectManagerId, project.projectControlManagerId, project.reportingCoordinatorId, project.clientRepresentativeId, project.projectSponsorId].includes(contact.id));
  const assignment = { contactId: outsider.id, departmentId: manager.departmentId, disciplineId: manager.disciplineId,
    assignmentRole: "team_member", reportsToContactId: manager.contactId };

  // Legacy rows (none of these people is a member) re-save unchanged.
  const resaved = await projectService.updateProject(project.id, { team: project.team }, project.updatedAt);
  // Editing a legacy row requires membership.
  const legacy = project.team.find((entry) => !entry.role && entry.departmentId);
  await assert.rejects(projectService.updateProject(project.id, {
    team: project.team.map((entry) => (entry === legacy ? { ...entry, functionalTitle: "Changed" } : entry)),
  }, resaved.updatedAt), { message: PSM_MEMBER_REQUIRED_MESSAGE });
  // A global-only person is refused...
  await assert.rejects(projectService.updateProject(project.id, { team: [...project.team, assignment] }, resaved.updatedAt),
    { message: PSM_MEMBER_REQUIRED_MESSAGE });
  // ...and so is Replace Person to them in a department.
  await assert.rejects(projectService.replacePerson({ projectId: project.id, fromContactId: manager.contactId, toContactId: outsider.id,
    reason: "test", unit: { kind: "department_assignment", departmentId: manager.departmentId, assignmentRole: "department_manager" } }),
  { reason: "not_project_member" });
  // Once an active member (Party / Project Role complete or not), it succeeds.
  const eprom = readMockProject(project.id).parties.find((party) => party.kind === "eprom");
  const joined = await projectTeamService.addMember({ projectId: project.id, version: resaved.updatedAt, contactId: outsider.id, partyId: eprom.id, projectRole: "Engineer" });
  const assigned = await projectService.updateProject(project.id, { team: [...project.team, assignment] }, joined.version);
  assert.ok(assigned.team.some((entry) => entry.contactId === outsider.id));
  assert.equal(assigned.members.length, 1, "no membership fabricated for anyone else");
  // Ending that membership is now refused; nothing is removed.
  await assert.rejects(projectTeamService.endMember({ projectId: project.id, version: assigned.updatedAt, memberId: joined.memberId }),
    { reason: "has_psm_assignments" });
  assert.ok(readMockProject(project.id).team.some((entry) => entry.contactId === outsider.id));
  // A copy starts with no project team and therefore no department assignments.
  const copy = await projectService.duplicateProject(project.id);
  assert.deepEqual([copy.team, copy.members], [[], []]);
  assert.equal(copy.projectManagerId, project.projectManagerId, "fixed roles are kept");
});

/* ------------------------------- the pickers ------------------------------ */

test("PSM pickers offer active project members only, create nobody, and show the Needs badges", () => {
  const step = source("./components/setup/setup-step-contacts.tsx");
  assert.match(step, /activeMembers\(savedProject\.members\)\.map\(\(member\) => \[member\.contactId, member\]\)/);
  // Department Manager: home-department rule kept, plus membership.
  assert.match(step, /\(record as Contact\)\.departmentId === activeDepartmentId &&\s+isActiveMember\(record\)/);
  // Team Members: everyone but the manager, members only.
  assert.match(step, /record\.id !== activeManager\?\.contactId && isActiveMember\(record\)/);
  assert.equal((step.match(/optionSublabel=\{memberSublabel\}/g) ?? []).length, 2);
  assert.equal((step.match(/optionBadges=\{memberBadges\}/g) ?? []).length, 2);
  assert.equal((step.match(/allowManage=\{false\}/g) ?? []).length, 2);
  for (const text of ['"Needs party"', '"Needs project role"', '"Not on the Project Team"', "partyLabel(", "projectRole"]) {
    assert.ok(step.includes(text), text);
  }
  assert.doesNotMatch(step, /Add Contact|MasterDataDialog|createPresetValues/);
  // Assignment rules unchanged: the same helpers seat the manager and keep rows.
  assert.match(step, /setAssignment\(\s+\{ \.\.\.project, team: nextTeam \},\s+activeDepartmentId,\s+contactId,\s+\{ assignmentRole: "department_manager" \}\s+\)/);
  // Badges are display-only in the shared pickers: options are filtered as before.
  const select = source("../master-data/components/managed-select.tsx");
  assert.match(select, /const available = filter \? activeRecords\.filter\(filter\) : activeRecords;/);
  assert.doesNotMatch(select, /optionBadges\?\.\([^)]*\)\s*\)?\s*\.filter|filter\([^)]*optionBadges/);
});

test("both setup saves check membership before the database, and Replace Person offers members only for department assignments", () => {
  const view = source("./components/setup/project-setup-view.tsx");
  assert.match(view, /\.\.\.validateAssignments\(current\), \.\.\.teamMembershipIssues\(\{ team: current\.team, members: project\.members \}, project\)/);
  const workspace = source("./components/setup/project-info-workspace.tsx");
  assert.match(workspace, /\.\.\.teamMembershipIssues\(\{ team: draft\.team, members: project\.members \}, project\)/);
  const dialog = source("./components/replace-person-dialog.tsx");
  assert.match(dialog, /\(unit\.kind !== "department_assignment" \|\| activeMemberContacts\.has\(record\.id\)\)/);
  assert.match(dialog, /\(project\.members \?\? \[\]\)\.filter\(\(member\) => !member\.endedAt\)/);
});
