import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 2C.3E follow-up — a HELD project-level responsibility (fixed role or
// project position) is replaced only by an ACTIVE member of the same project.
// SOURCE CONTRACTS for 20261013090000_responsibility_holder_membership.sql,
// the shared rule, mock-service parity and the Replace Person picker. Runtime
// behaviour: scripts/p0-validation/119_runtime_2c3e_holder_membership.sql.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const { responsibilityHolderIssues, isActiveProjectMember, HOLDER_MEMBER_REQUIRED_MESSAGE } = await import("./project-team.ts");
const { PSM_MEMBER_REQUIRED_MESSAGE } = await import("./assignment-rules.ts");

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const scripts = new URL("../../../scripts/p0-validation/", import.meta.url);
const read = (dir, name) => readFileSync(new URL(name, dir), "utf8").replaceAll("\r", "");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const FILE = "20261013090000_responsibility_holder_membership.sql";
const sql = read(migrations, FILE);
const code = sql.replace(/--[^\n]*/g, "");
const topLevel = code.replace(/\$([a-z_]+)\$[\s\S]*?\$\1\$/g, "$$body$$");
const sorted = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
const fnBody = (name) => {
  const start = code.indexOf(`create function public.${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  return code.slice(start, code.indexOf("$guard$;", start));
};
const GUARDS = ["guard_fixed_holder_replacement", "guard_position_holder_replacement"];
const TAG = "[HOLDER_MEMBER_REQUIRED] Only an active member of this project''s team can take over this responsibility. Add the person to the Project Team first.";

/* ------------------------------ migration -------------------------------- */

test("one additive migration directly after 2C.3E; two hardened guards, no data, no authority change", () => {
  const files = sorted();
  assert.equal(files.indexOf(FILE), files.indexOf("20261012180000_setup_authority_and_archived_read_only.sql") + 1);
  assert.doesNotMatch(code, /create or replace|alter table|drop |create policy|alter policy|\bgrant\b/i);
  assert.deepEqual([...code.matchAll(/create function public\.([a-z_]+)\(/g)].map((match) => match[1]), GUARDS);
  assert.doesNotMatch(topLevel, /\b(insert into|update public\.|delete from|truncate)\b/i);
  for (const name of GUARDS) {
    assert.match(code, new RegExp(`create function public\\.${name}\\(\\) returns trigger\\s+language plpgsql security definer set search_path = ''`));
    assert.match(code, new RegExp(`revoke execute on function public\\.${name}\\(\\) from public, anon, authenticated, service_role;`));
    assert.ok(fnBody(name).includes(TAG), name);
    assert.doesNotMatch(fnBody(name), /\b(insert into|delete from)\b|update public\./, `${name} only refuses`);
  }
  // Replace Person itself is not redefined: its history and tags are unchanged.
  assert.doesNotMatch(code, /replace_project_responsibility\s*\(/);
});

test("only a REPLACEMENT is checked: held -> someone else, who must be an ACTIVE member of the SAME project", () => {
  const fixed = fnBody("guard_fixed_holder_replacement");
  for (const column of ["project_manager_id", "project_control_manager_id", "reporting_coordinator_id",
    "client_representative_id", "project_sponsor_id"]) {
    assert.match(fixed, new RegExp(`\\(new\\.${column}, old\\.${column}\\)`), column);
  }
  assert.match(fixed, /where h\.previous_holder is not null\s+and h\.next_holder is not null\s+and h\.next_holder is distinct from h\.previous_holder/);
  assert.match(fixed, /m\.project_id = new\.id and m\.contact_id = h\.next_holder and m\.ended_at is null/);
  const position = fnBody("guard_position_holder_replacement");
  assert.match(position, /old\.contact_id is not null\s+and new\.contact_id is not null\s+and new\.contact_id is distinct from old\.contact_id/);
  assert.match(position, /m\.project_id = new\.project_id and m\.contact_id = new\.contact_id and m\.ended_at is null/);
  assert.match(topLevel, /create trigger guard_fixed_holder_replacement\s+before update of project_manager_id, project_control_manager_id, reporting_coordinator_id,\s+client_representative_id, project_sponsor_id\s+on public\.projects/);
  assert.match(topLevel, /create trigger guard_position_holder_replacement\s+before update of contact_id on public\.project_positions/);
  // The archived guard (2C.3E) still answers first on both tables.
  assert.ok("block_archived_project_setup" < "guard_fixed_holder_replacement");
  assert.ok("block_archived_project_setup" < "guard_position_holder_replacement");
  assert.match(code, /an authorization helper reads project_members/);
});

test("runtime 119 is local-only, rolled back, and covers every area", () => {
  const runtime = read(scripts, "119_runtime_2c3e_holder_membership.sql");
  assert.match(runtime, /REFUSING TO RUN: this connection is not local/);
  assert.match(runtime, /\nrollback;\n?$/);
  assert.doesNotMatch(runtime, /\ncommit;/i);
  for (const area of ["01 REPLACE FIXED", "02 BYPASS", "03 POSITION", "04 PSM UNCHANGED", "05 ARCHIVED", "06 NEW PROJECT", "07 CATALOG"]) {
    assert.ok(runtime.includes(`'${area}'`), area);
  }
});

/* ------------------------------ shared rule ------------------------------- */

const member = (contactId, extra = {}) => ({ id: `m-${contactId}`, projectId: "prj", contactId, createdAt: "t", updatedAt: "t", ...extra });
const EXISTING = {
  projectManagerId: "pm", projectControlManagerId: "pcm", reportingCoordinatorId: undefined,
  clientRepresentativeId: "client", projectSponsorId: "sponsor",
  positions: [{ id: "pos-1", jobTitleId: "j", contactId: "pm", sortOrder: 0 }],
  members: [member("pm"), member("pcm"), member("next"), member("former", { endedAt: "t1" })],
};

test("the rule: a non-member, an ended member or another project's member cannot take over; an active member can", () => {
  assert.equal(HOLDER_MEMBER_REQUIRED_MESSAGE, TAG.slice("[HOLDER_MEMBER_REQUIRED] ".length).replace("''", "'"));
  assert.equal(isActiveProjectMember(EXISTING, "next"), true);
  for (const contactId of ["former", "global-only", "other-project", undefined]) {
    assert.equal(isActiveProjectMember(EXISTING, contactId), false, String(contactId));
  }
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { projectManagerId: "global-only" }), ["global-only"]);
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { projectManagerId: "former" }), ["former"]);
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { projectManagerId: "next" }), []);
  // Not replacements (unchanged): a vacant fixed role filled, a role cleared, the same holder.
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { reportingCoordinatorId: "global-only" }), []);
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { clientRepresentativeId: undefined }), []);
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { projectManagerId: "pm" }), []);
  // A NEW position needs an active member too — and that alone is sufficient.
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { positions: [...EXISTING.positions, { jobTitleId: "j", contactId: "global-only", sortOrder: 1 }] }), ["global-only"]);
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { positions: [...EXISTING.positions, { jobTitleId: "j", contactId: "former", sortOrder: 1 }] }), ["former"]);
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { positions: [...EXISTING.positions, { jobTitleId: "j", contactId: "next", sortOrder: 1 }] }), []);
  // A held position moving to a non-member is a replacement.
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { positions: [{ ...EXISTING.positions[0], contactId: "global-only" }] }), ["global-only"]);
  assert.deepEqual(responsibilityHolderIssues(EXISTING, { positions: [{ ...EXISTING.positions[0], contactId: "next" }] }), []);
});

/* --------------------------- mock-service parity --------------------------- */

test("mock Replace Person and Project Information refuse a non-member exactly as the database does", async () => {
  const { projectService, readMockProject } = await import("../../services/project-service.ts");
  const { projectTeamService } = await import("../../services/project-team-service.ts");
  const projects = await projectService.getProjects();
  // A project whose Project Manager is set and which has someone with a project
  // row (a department assignment) who is NOT a member yet (mock teams start empty).
  const project = projects.find((candidate) => candidate.projectManagerId
    && (candidate.team ?? []).some((row) => !row.role && row.contactId !== candidate.projectManagerId));
  assert.ok(project, "a mock project with a PM and an assigned non-member");
  const candidate = project.team.find((row) => !row.role && row.contactId !== project.projectManagerId).contactId;
  const fixed = { kind: "fixed_responsibility", responsibilityField: "projectManagerId" };

  // Replace Person: a person with a project row but no membership is refused.
  await assert.rejects(projectService.replacePerson({ projectId: project.id, unit: fixed,
    fromContactId: project.projectManagerId, toContactId: candidate, reason: "test" }),
  { reason: "not_project_member", message: HOLDER_MEMBER_REQUIRED_MESSAGE });
  // Project Information: the same bypass through a save is refused too.
  await assert.rejects(projectService.updateProject(project.id, { projectManagerId: candidate }, readMockProject(project.id).updatedAt),
    { message: HOLDER_MEMBER_REQUIRED_MESSAGE });
  assert.equal(readMockProject(project.id).projectManagerId, project.projectManagerId, "nothing changed");

  // Once an ACTIVE member of this project, the same replacement succeeds, with history.
  const eprom = readMockProject(project.id).parties.find((party) => party.kind === "eprom");
  await projectTeamService.addMember({ projectId: project.id, version: readMockProject(project.id).updatedAt,
    contactId: candidate, partyId: eprom.id, projectRole: "Engineer" });
  const result = await projectService.replacePerson({ projectId: project.id, unit: fixed,
    fromContactId: project.projectManagerId, toContactId: candidate, reason: "test" });
  assert.ok(result.historyId);
  assert.equal(readMockProject(project.id).projectManagerId, candidate);

  // Active membership ALONE is sufficient: a member with no other project row
  // takes the role over, and receives a new position in Project Information.
  const { mockContacts } = await import("../../data/mock/master-data.mock.ts");
  const fixedHolders = [project.projectManagerId, project.projectControlManagerId, project.reportingCoordinatorId,
    project.clientRepresentativeId, project.projectSponsorId];
  const unassigned = mockContacts.filter((contact) => contact.active && contact.id !== candidate
    && !fixedHolders.includes(contact.id) && !(project.team ?? []).some((row) => row.contactId === contact.id));
  const [memberOnly, outsider] = unassigned;
  assert.ok(memberOnly && outsider, "two mock people with no row on this project");
  await projectTeamService.addMember({ projectId: project.id, version: readMockProject(project.id).updatedAt,
    contactId: memberOnly.id, partyId: eprom.id, projectRole: "Planner" });
  await projectService.replacePerson({ projectId: project.id, unit: fixed,
    fromContactId: candidate, toContactId: memberOnly.id, reason: "test" });
  assert.equal(readMockProject(project.id).projectManagerId, memberOnly.id);
  const positions = readMockProject(project.id).positions ?? [];
  await assert.rejects(projectService.updateProject(project.id,
    { positions: [...positions, { jobTitleId: "jt", contactId: outsider.id, sortOrder: positions.length }] },
    readMockProject(project.id).updatedAt), { message: HOLDER_MEMBER_REQUIRED_MESSAGE });
  const withPosition = await projectService.updateProject(project.id,
    { positions: [...positions, { jobTitleId: "jt", contactId: memberOnly.id, sortOrder: positions.length }] },
    readMockProject(project.id).updatedAt);
  assert.ok(withPosition.positions.some((position) => position.contactId === memberOnly.id));
  assert.equal(readMockProject(project.id).members.length, 2, "only the two memberships added above; none behind the scenes");

  // PSM department-assignment Replace Person keeps its Wave 2 refusal.
  const manager = (project.team ?? []).find((row) => !row.role && row.assignmentRole === "department_manager");
  if (manager) {
    const outsider = (project.team ?? []).find((row) => !row.role && row.contactId !== manager.contactId && row.contactId !== candidate);
    if (outsider) {
      await assert.rejects(projectService.replacePerson({ projectId: project.id, fromContactId: manager.contactId,
        toContactId: outsider.contactId, reason: "test",
        unit: { kind: "department_assignment", departmentId: manager.departmentId, assignmentRole: "department_manager" } }),
      { reason: "not_project_member", message: PSM_MEMBER_REQUIRED_MESSAGE });
    }
  }

  // Archived: refused first, whoever the replacement is.
  await projectService.archiveProject(project.id);
  await assert.rejects(projectService.replacePerson({ projectId: project.id, unit: fixed,
    fromContactId: memberOnly.id, toContactId: candidate, reason: "test" }), { reason: "project_archived" });
});

/* --------------------------- picker and mapping ---------------------------- */

test("Replace Person offers active members of THIS project only, for every kind; the current holder stays readable", () => {
  const dialog = source("./components/replace-person-dialog.tsx");
  // Active membership alone: no other project row is required any more.
  assert.match(dialog, /record\.id !== currentContactId &&\s+activeMemberContacts\.has\(record\.id\)\s+\)/);
  assert.doesNotMatch(dialog, /hasProjectAssignment/);
  assert.doesNotMatch(dialog, /unit\.kind !== "department_assignment"/, "no kind is exempt any more");
  assert.match(dialog, /\(project\.members \?\? \[\]\)\.filter\(\(member\) => !member\.endedAt\)/);
  // The person being replaced is shown from the People record, member or not.
  assert.match(dialog, /<p className="font-medium">\{currentContact\?\.name \?\? "Unknown"\}<\/p>/);
  const supabase = source("../../services/supabase-project-service.ts");
  assert.match(supabase, /HOLDER_MEMBER_REQUIRED: "not_project_member",/);
});

/* ------------- member-sufficient eligibility (20261013120000) -------------- */

const ELIGIBILITY = "20261013120000_member_eligibility_for_responsibilities.sql";
const eligibility = read(migrations, ELIGIBILITY);
const bodyBetween = (text, open, close) => {
  const start = text.indexOf(open);
  assert.ok(start >= 0, `missing: ${open}`);
  const from = start + open.length;
  return text.slice(from, text.indexOf(close, from));
};

test("eligibility: three existing functions redefined, directly after the holder guards; no data, no policy, no grant", () => {
  const files = sorted();
  assert.equal(files.indexOf(ELIGIBILITY), files.indexOf(FILE) + 1);
  assert.deepEqual([...eligibility.matchAll(/create or replace function public\.([a-z_]+)\(/gi)].map((match) => match[1]),
    ["replace_project_responsibility", "guard_fixed_project_responsibility_membership", "guard_project_position_membership"]);
  const withoutBodies = eligibility.replace(/--[^\n]*/g, "").replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, "$$body$$");
  assert.doesNotMatch(withoutBodies, /\b(insert into|update public\.|delete from|truncate|create policy|alter policy|grant|revoke|alter table|drop )/i);
});

test("eligibility: Replace Person is its last definition except the two pre-checks, which now require an ACTIVE member", () => {
  const previous = bodyBetween(read(migrations, "20260926000003_project_setup_writer_serialization.sql"),
    "create or replace function public.replace_project_responsibility(", "$fn$;");
  const previousBody = previous.slice(previous.indexOf("$fn$") + "$fn$".length);
  const current = bodyBetween(eligibility, "AS $function$", "$function$");
  const memberCheck = /    -- 2C\.3E: an ACTIVE member[\s\S]*?    end if;/g;
  const checks = current.match(memberCheck) ?? [];
  assert.equal(checks.length, 2);
  for (const check of checks) {
    assert.match(check, /from public\.project_members m\s+where m\.project_id = p_project and m\.contact_id = p_to_contact and m\.ended_at is null/);
    assert.match(check, /\[NOT_PROJECT_MEMBER\] Only an active member of this project''s team can take over this responsibility\./);
  }
  // Remove both checks from each version: everything else is identical.
  const oldCheck = /    if not exists \(\n      select 1 from public\.project_contacts\n       where project_id = p_project and contact_id = p_to_contact\n    \) then\n      raise exception '\[NOT_PROJECT_MEMBER\][^\n]*\n        using errcode = 'foreign_key_violation';\n    end if;/g;
  assert.equal((previousBody.match(oldCheck) ?? []).length, 2, "the previous definition had exactly two row checks");
  assert.equal(current.replace(memberCheck, "<CHECK>").trim(), previousBody.replace(oldCheck, "<CHECK>").trim(),
    "history, authority, compare-and-swap and every other check unchanged");
});

test("eligibility: fixed holders accept a project row OR an active member; positions need an active member; unchanged rows are never re-checked", () => {
  const fixed = bodyBetween(eligibility, "create or replace function public.guard_fixed_project_responsibility_membership()", "$guard$;");
  assert.match(fixed, /from public\.project_contacts pc[\s\S]+?for key share;\s+if not found then[\s\S]+?from public\.project_members m\s+where m\.project_id = new\.id\s+and m\.contact_id = holder\s+and m\.ended_at is null\s+for share;/);
  const position = bodyBetween(eligibility, "create or replace function public.guard_project_position_membership()", "$guard$;");
  assert.doesNotMatch(position, /project_contacts/, "a project_contacts row is no longer required");
  assert.match(position, /if tg_op = 'UPDATE'\s+and new\.contact_id is not distinct from old\.contact_id/);
  assert.match(position, /if tg_op = 'INSERT' and exists \(\s+select 1 from public\.project_positions p/);
  assert.match(position, /from public\.project_members m\s+where m\.project_id = new\.project_id\s+and m\.contact_id = new\.contact_id\s+and m\.ended_at is null\s+for share;/);
  assert.match(position, /\[HOLDER_MEMBER_REQUIRED\]/);
  assert.match(eligibility, /an authorization helper reads project_members/);
});

test("runtime 120 is local-only, rolled back, and covers both paths", () => {
  const runtime = read(scripts, "120_runtime_2c3e_member_eligibility.sql");
  assert.match(runtime, /REFUSING TO RUN: this connection is not local/);
  assert.match(runtime, /\nrollback;\n?$/);
  assert.doesNotMatch(runtime, /\ncommit;/i);
  for (const area of ["01 REPLACE FIXED", "02 NEW POSITION", "03 REPLACE POSITION", "04 AUTHORITY", "05 PSM UNCHANGED",
    "06 ARCHIVED", "07 NEW PROJECT", "08 CATALOG"]) {
    assert.ok(runtime.includes(`'${area}'`), area);
  }
});
