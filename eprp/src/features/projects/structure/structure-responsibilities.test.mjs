// Phase 2C.3D Wave 1 — Other Project Structure Responsibilities: domain rules,
// Project Setup completion, the in-memory service and the Supabase mapping.
// No database here: runtime behaviour is proved by
// scripts/p0-validation/116_runtime_2c3d_structure_responsibilities.sql.
import assert from "node:assert/strict";
import test from "node:test";

const rules = await import("./structure-responsibilities.ts");
const workflow = await import("../../../config/project-workflow.ts");
const { createInMemoryProjectStructureService } = await import("../../../services/project-structure-service.ts");
const supabase = await import("../../../services/supabase-project-structure-service.ts");
const { mapProjectStructureError, PROJECT_STRUCTURE_MESSAGES } = await import("../../../services/project-structure-errors.ts");
const { mapProjectTeamError } = await import("../../../services/project-team-errors.ts");

const {
  buildTeamDirectory, unitPeople, peopleInput, samePeople, withMember, withoutMember, leadCandidates, reportCandidates,
  unitPeopleIssues, membershipFactsOf, requiresResponsible, responsibilityGaps, unitPeopleSummary,
  memberUnitAssignments, describeMemberUnits,
} = rules;

/* -------------------------------- fixtures -------------------------------- */

const member = (id, extra = {}) => ({ id, projectId: "P", contactId: `c-${id}`, partyId: "eprom", projectRole: `Role ${id}`,
  createdAt: "t", updatedAt: "t", ...extra });
const MEMBERS = [
  member("ahmed"), member("mona", { partyId: "owner" }), member("mostafa"),
  member("dina", { partyId: undefined, projectRole: undefined }), // legacy: needs party + project role
  member("old", { endedAt: "2026-10-01T00:00:00Z" }),
];
const PROJECT = {
  id: "P", code: "ZZ", name: "Demo", status: "planning", structureFamily: "other",
  reporting: { weeklyEnabled: true, monthlyEnabled: true },
  parties: [{ id: "eprom", kind: "eprom", sortOrder: 0 }, { id: "owner", kind: "owner", sortOrder: 1 }],
  members: MEMBERS, projectManagerId: "pm", projectControlManagerId: "pcm", reportingCoordinatorId: "rc",
  departments: [], disciplines: [], team: [],
};
const CONTACTS = ["ahmed", "mona", "mostafa", "dina", "old"].map((id) => ({ id: `c-${id}`, name: id[0].toUpperCase() + id.slice(1) }));
const level = (n, singular) => ({ id: `l${n}`, projectId: "P", levelNumber: n, singularLabel: singular, pluralLabel: `${singular}s`, createdAt: "t", updatedAt: "t" });
const node = (id, levelNumber, parentId, extra = {}) => ({ id, projectId: "P", levelNumber, parentId, name: id, sortOrder: 0,
  weeklyReportingRequired: false, monthlyReportingRequired: false, createdAt: "t", updatedAt: "t", ...extra });
const unitRow = (id, nodeId, memberId, unitRole = "member", endedAt) =>
  ({ id, projectId: "P", nodeId, memberId, unitRole, endedAt, createdAt: "t", updatedAt: "t" });
const reportRow = (id, nodeId, memberId, unitMemberId, reportKind, responsibility, endedAt) =>
  ({ id, projectId: "P", nodeId, memberId, unitMemberId, reportKind, responsibility, endedAt, createdAt: "t", updatedAt: "t" });

const structure = (assignments = { unitMembers: [], reportResponsibilities: [] }) => ({
  projectId: "P", version: "v1",
  levels: [level(1, "Function"), level(2, "Workstream")],
  nodes: [
    node("Civil", 1, undefined, { weeklyReportingRequired: true, code: "CIV" }),
    node("Earthworks", 2, "Civil", { monthlyReportingRequired: true }),
    node("Mech", 1),
    node("Old unit", 1, undefined, { archivedAt: "2026-09-01T00:00:00Z" }),
  ],
  ...(assignments === null ? {} : { assignments }),
});
const civilStaffed = () => ({
  unitMembers: [
    unitRow("u1", "Civil", "ahmed"), unitRow("u2", "Civil", "mona"), unitRow("u3", "Civil", "mostafa"),
    unitRow("u4", "Civil", "ahmed", "lead"),
    unitRow("u0", "Civil", "old", "member", "2026-10-01T00:00:00Z"), // ended: history only
  ],
  reportResponsibilities: [
    reportRow("r1", "Civil", "ahmed", "u1", "weekly", "responsible"),
    reportRow("r2", "Civil", "mona", "u2", "weekly", "backup"),
    reportRow("r0", "Civil", "mostafa", "u3", "weekly", "responsible", "2026-10-02T00:00:00Z"),
  ],
});
const directory = () => buildTeamDirectory(PROJECT, CONTACTS, "Client Co");

/* ---------------------------- directory and read --------------------------- */

test("the person pool is the ACTIVE project team only, display-ready, never the global People master", () => {
  const { members } = directory();
  assert.deepEqual(members.map((entry) => entry.id), ["ahmed", "dina", "mona", "mostafa"], "ended member excluded, sorted by name");
  const dina = members.find((entry) => entry.id === "dina");
  assert.deepEqual([dina.needsParty, dina.needsProjectRole, dina.accountable, dina.partyLabel, dina.projectRole],
    [true, true, false, undefined, undefined]);
  const mona = members.find((entry) => entry.id === "mona");
  assert.equal(mona.partyLabel, "Owner / Client — Client Co");
  assert.equal(mona.accountable, true);
});

test("a unit's people are read from ACTIVE rows only; ended rows stay history", () => {
  const people = unitPeople(civilStaffed(), "Civil");
  assert.deepEqual(people, {
    nodeId: "Civil", memberIds: ["ahmed", "mona", "mostafa"], leadId: "ahmed",
    weekly: { responsibleId: "ahmed", backupId: "mona" }, monthly: { responsibleId: undefined, backupId: undefined },
  });
  assert.deepEqual(unitPeople(undefined, "Civil").memberIds, []);
  assert.equal(samePeople(peopleInput(people), { ...peopleInput(people), memberIds: ["mostafa", "mona", "ahmed"] }), true);
  assert.equal(samePeople(peopleInput(people), { ...peopleInput(people), weeklyBackupId: undefined }), false);
});

test("removing a member clears only that person's slots; an orphaned Backup is reported, never cleared", () => {
  const draft = peopleInput(unitPeople(civilStaffed(), "Civil"));
  const withoutAhmed = withoutMember(draft, "ahmed");
  assert.deepEqual(withoutAhmed.memberIds, ["mona", "mostafa"]);
  assert.equal(withoutAhmed.leadMemberId, undefined);
  assert.equal(withoutAhmed.weeklyResponsibleId, undefined);
  assert.equal(withoutAhmed.weeklyBackupId, "mona", "the Backup is not silently removed");
  const issues = unitPeopleIssues(withoutAhmed, structure().nodes[0], MEMBERS);
  assert.deepEqual(issues.map((issue) => issue.reason), ["backup_without_responsible"]);
  assert.equal(withMember(withoutAhmed, "ahmed").memberIds.at(-1), "ahmed");
});

/* ------------------------------- candidates ------------------------------- */

test("Lead and reporting candidates: members of THIS unit with a complete membership; never the other slot", () => {
  const draft = { nodeId: "Civil", memberIds: ["ahmed", "mona", "dina"], weeklyResponsibleId: "ahmed" };
  assert.deepEqual(leadCandidates(draft, directory()).map((entry) => entry.id), ["ahmed", "mona"], "Dina (incomplete) and Mostafa (not in unit) excluded");
  assert.deepEqual(reportCandidates(draft, directory(), "weekly", "backup").map((entry) => entry.id), ["mona"], "not the Responsible");
  assert.deepEqual(reportCandidates(draft, directory(), "weekly", "responsible").map((entry) => entry.id), ["ahmed", "mona"]);
});

/* ------------------------------- validation ------------------------------- */

test("the desired state is validated exactly like the database writer", () => {
  const civil = structure().nodes[0], earth = structure().nodes[1], mech = structure().nodes[2], archived = structure().nodes[3];
  const reasons = (input, unit = civil) => unitPeopleIssues({ nodeId: unit.id, memberIds: [], ...input }, unit, MEMBERS).map((i) => i.reason);
  assert.deepEqual(reasons({ memberIds: ["ahmed", "ahmed"] }), ["invalid_people"]);
  assert.deepEqual(reasons({ memberIds: ["mona"], leadMemberId: "ahmed" }), ["lead_not_unit_member"]);
  assert.deepEqual(reasons({ memberIds: ["mona"], weeklyResponsibleId: "ahmed" }), ["responsible_not_unit_member"]);
  assert.deepEqual(reasons({ memberIds: ["mona"], weeklyBackupId: "mona" }), ["backup_without_responsible"]);
  assert.deepEqual(reasons({ memberIds: ["mona"], weeklyResponsibleId: "mona", weeklyBackupId: "mona" }), ["same_person"]);
  assert.deepEqual(reasons({ memberIds: ["mona"], monthlyResponsibleId: "mona" }), ["unit_not_reporting"], "Civil owes no Monthly input");
  assert.deepEqual(reasons({ memberIds: ["mona"], weeklyResponsibleId: "mona" }, earth), ["unit_not_reporting"], "Earthworks owes no Weekly input");
  assert.deepEqual(reasons({ memberIds: ["mona"] }, mech), []);
  assert.deepEqual(reasons({ memberIds: ["mona"] }, archived), ["unit_archived"]);
  assert.deepEqual(reasons({ memberIds: ["old"] }), ["member_not_active"]);
  assert.deepEqual(reasons({ memberIds: ["stranger"] }), ["member_not_active"]);
  assert.deepEqual(reasons({ memberIds: ["dina"] }), [], "an incomplete legacy member may be a normal unit member");
  for (const slot of ["leadMemberId", "weeklyResponsibleId"]) {
    assert.deepEqual(reasons({ memberIds: ["dina", "mona"], [slot]: "dina" }), ["membership_incomplete"], slot);
  }
  assert.deepEqual(reasons({ memberIds: ["dina", "mona"], weeklyResponsibleId: "mona", weeklyBackupId: "dina" }), ["membership_incomplete"]);
  assert.deepEqual(unitPeopleIssues({ nodeId: "x", memberIds: [] }, undefined, MEMBERS).map((i) => i.reason), ["not_found"]);
  // The UI's directory facts give the same verdicts.
  assert.deepEqual(unitPeopleIssues({ nodeId: "Civil", memberIds: ["dina"], leadMemberId: "dina" }, civil, membershipFactsOf(directory()))
    .map((i) => i.reason), ["membership_incomplete"]);
  for (const issue of unitPeopleIssues({ nodeId: "Civil", memberIds: ["mona"], weeklyBackupId: "mona" }, civil, MEMBERS)) {
    assert.equal(issue.message, PROJECT_STRUCTURE_MESSAGES[issue.reason]);
  }
});

/* ------------------------- completion and warnings ------------------------ */

test("a missing Responsible blocks only when the project uses the report AND the unit owes it", () => {
  const civil = structure().nodes[0];
  assert.equal(requiresResponsible({ weeklyEnabled: true, monthlyEnabled: true }, civil, "weekly"), true);
  assert.equal(requiresResponsible({ weeklyEnabled: false, monthlyEnabled: true }, civil, "weekly"), false);
  assert.equal(requiresResponsible({ weeklyEnabled: true, monthlyEnabled: true }, civil, "monthly"), false);
  assert.equal(requiresResponsible({ weeklyEnabled: true, monthlyEnabled: true }, { ...civil, archivedAt: "x" }, "weekly"), false);
  const gaps = responsibilityGaps(PROJECT.reporting, structure());
  assert.deepEqual(gaps.weekly.map((n) => n.id), ["Civil"]);
  assert.deepEqual(gaps.monthly.map((n) => n.id), ["Earthworks"]);
  assert.deepEqual(gaps.withoutLead.map((n) => n.id), ["Civil", "Earthworks", "Mech"], "archived units are not counted");
  const staffed = responsibilityGaps(PROJECT.reporting, structure(civilStaffed()));
  assert.deepEqual([staffed.weekly.length, staffed.monthly.map((n) => n.id)], [0, ["Earthworks"]]);
});

test("Project Team & Responsibilities carries the blockers; Project Structure does not", () => {
  const evaluate = (project, struct) => workflow.evaluateProjectWorkflow(project,
    { systems: [], disciplines: [], contacts: [], structure: { structure: struct } });
  const statusOf = (statuses, id) => statuses.find((status) => status.id === id);
  const empty = evaluate(PROJECT, structure());
  const team = statusOf(empty, "team");
  assert.deepEqual(team.missing, [
    "Weekly Responsible assigned for every Weekly input unit",
    "Monthly Responsible assigned for every Monthly input unit",
  ]);
  assert.match(team.checks.find((c) => !c.passed).hint, /Assign a Weekly Responsible for: Civil\./);
  const structureStep = statusOf(empty, "structure");
  assert.ok(structureStep.checks.every((c) => !/Responsible/.test(c.label)), "no people checks on Project Structure");
  // Weekly staffed: only Monthly remains; a missing Lead / Backup never adds a check.
  const weeklyOnly = statusOf(evaluate(PROJECT, structure(civilStaffed())), "team");
  assert.deepEqual(weeklyOnly.missing, ["Monthly Responsible assigned for every Monthly input unit"]);
  // A report type the project does not use adds no check at all.
  const noMonthly = statusOf(evaluate({ ...PROJECT, reporting: { weeklyEnabled: true, monthlyEnabled: false } }, structure(civilStaffed())), "team");
  assert.equal(noMonthly.complete, true);
  assert.ok(noMonthly.checks.every((c) => !/Monthly/.test(c.label)));
  // Fail closed when people cannot be read; say so while loading.
  assert.deepEqual(statusOf(evaluate(PROJECT, structure(null)), "team").missing, ["Structure responsibilities available"]);
  const loading = workflow.evaluateProjectWorkflow(PROJECT, { systems: [], disciplines: [], contacts: [], structure: { structure: null } });
  assert.ok(statusOf(loading, "team").missing.includes("Structure responsibilities loaded"));
  // PSM / legacy team steps are untouched.
  const psm = workflow.evaluateProjectWorkflow({ ...PROJECT, structureFamily: "psm", team: [] }, { systems: [], disciplines: [], contacts: [] });
  assert.deepEqual(statusOf(psm, "team").checks.map((c) => c.label), ["Project team assembled"]);
});

/* -------------------------------- summaries ------------------------------- */

test("unit summaries: Lead, member count, and Weekly / Monthly lines only where the unit owes input", () => {
  const struct = structure(civilStaffed());
  const civil = unitPeopleSummary(struct.nodes[0], struct, directory(), PROJECT.reporting);
  assert.deepEqual(civil, { leadName: "Ahmed", memberCount: 3,
    weekly: { responsibleName: "Ahmed", backupName: "Mona", required: true }, monthly: undefined });
  const earth = unitPeopleSummary(struct.nodes[1], struct, directory(), PROJECT.reporting);
  assert.deepEqual(earth, { leadName: undefined, memberCount: 0, weekly: undefined,
    monthly: { responsibleName: undefined, backupName: undefined, required: true } });
  assert.equal(unitPeopleSummary(struct.nodes[0], structure(null), directory(), PROJECT.reporting), undefined);
});

test("the reverse view: a member's units, Lead role and reporting responsibilities, in structure order", () => {
  const struct = structure(civilStaffed());
  assert.equal(describeMemberUnits(memberUnitAssignments(struct, "ahmed")), "Civil (Lead, Weekly Responsible)");
  assert.equal(describeMemberUnits(memberUnitAssignments(struct, "mona")), "Civil (Weekly Backup)");
  assert.equal(describeMemberUnits(memberUnitAssignments(struct, "mostafa")), "Civil", "the ended responsibility is history");
  assert.equal(describeMemberUnits(memberUnitAssignments(struct, "old")), "", "ended unit row is not shown");
  assert.deepEqual(memberUnitAssignments(structure(null), "ahmed"), []);
});

/* ---------------------------- in-memory service --------------------------- */

function memory() {
  let tick = 0;
  const next = () => new Date(Date.UTC(2026, 9, 12, 0, 0, tick++)).toISOString();
  const projects = {
    P: { structureFamily: "other", status: "active", version: next(), members: MEMBERS },
    ARC: { structureFamily: "other", status: "archived", version: next(), members: MEMBERS },
  };
  const service = createInMemoryProjectStructureService({
    projects: { read: async (id) => (projects[id] ? { ...projects[id] } : undefined), advance: async (id) => (projects[id].version = next()) },
    now: next,
  });
  return { service, projects };
}
const reasonOf = async (promise) => promise.then(() => "accepted", (error) => error.reason);

async function seeded() {
  const { service, projects } = memory();
  const version = () => projects.P.version;
  await service.configureLevels({ projectId: "P", expectedVersion: version(), levels: [
    { levelNumber: 1, singularLabel: "Function", pluralLabel: "Functions" },
    { levelNumber: 2, singularLabel: "Workstream", pluralLabel: "Workstreams" }] });
  const civil = await service.createNode({ projectId: "P", levelNumber: 1, name: "Civil", weeklyReportingRequired: true });
  const earth = await service.createNode({ projectId: "P", levelNumber: 2, parentId: civil.id, name: "Earthworks", monthlyReportingRequired: true });
  const leaf = await service.createNode({ projectId: "P", levelNumber: 1, name: "Spare" });
  const save = (input) => service.saveUnitResponsibilities({ projectId: "P", expectedVersion: version(), memberIds: [], ...input });
  return { service, projects, version, civil, earth, leaf, save };
}

test("in-memory: the per-unit save applies only differences, ends instead of deleting, and keeps unchanged rows", async () => {
  const { service, civil, save } = await seeded();
  await save({ nodeId: civil.id, memberIds: ["ahmed", "mona", "mostafa"], leadMemberId: "ahmed", weeklyResponsibleId: "ahmed", weeklyBackupId: "mona" });
  let people = (await service.getStructure("P")).assignments;
  const backupRow = people.reportResponsibilities.find((row) => row.responsibility === "backup").id;
  const ahmedMember = people.unitMembers.find((row) => row.memberId === "ahmed" && row.unitRole === "member").id;
  // New Lead + new Responsible; the Backup and every member row are unchanged.
  await save({ nodeId: civil.id, memberIds: ["ahmed", "mona", "mostafa"], leadMemberId: "mostafa", weeklyResponsibleId: "mostafa", weeklyBackupId: "mona" });
  people = (await service.getStructure("P")).assignments;
  const active = unitPeople(people, civil.id);
  assert.deepEqual([active.leadId, active.weekly.responsibleId, active.weekly.backupId], ["mostafa", "mostafa", "mona"]);
  assert.equal(people.reportResponsibilities.find((row) => row.responsibility === "backup" && !row.endedAt).id, backupRow);
  assert.equal(people.unitMembers.find((row) => row.memberId === "ahmed" && row.unitRole === "member" && !row.endedAt).id, ahmedMember);
  assert.ok(people.unitMembers.some((row) => row.unitRole === "lead" && row.memberId === "ahmed" && row.endedAt), "old Lead kept as history");
  assert.ok(people.reportResponsibilities.some((row) => row.memberId === "ahmed" && row.endedAt), "old Responsible kept as history");
});

test("in-memory: refusals match the database (stale, rules, archived, flag-off, archive, delete)", async () => {
  const { service, projects, civil, earth, leaf, save } = await seeded();
  assert.equal(await reasonOf(service.saveUnitResponsibilities({ projectId: "P", expectedVersion: "old", nodeId: civil.id, memberIds: [] })), "stale");
  assert.equal(await reasonOf(save({ nodeId: civil.id, memberIds: ["dina"], leadMemberId: "dina" })), "membership_incomplete");
  assert.equal(await reasonOf(save({ nodeId: earth.id, memberIds: ["mona"], weeklyResponsibleId: "mona" })), "unit_not_reporting");
  assert.equal(await reasonOf(service.saveUnitResponsibilities({ projectId: "ARC", expectedVersion: projects.ARC.version, nodeId: civil.id, memberIds: [] })), "project_archived");
  assert.equal(await reasonOf(save({ nodeId: civil.id, memberIds: ["dina", "ahmed"], weeklyResponsibleId: "ahmed" })), "accepted");
  const current = async (id) => (await service.getStructure("P")).nodes.find((n) => n.id === id);
  assert.equal(await reasonOf(service.setReportingFlags(await current(civil.id), { weeklyReportingRequired: false })), "weekly_responsibility_exists");
  assert.equal(await reasonOf(service.archiveNode(await current(civil.id))), "unit_has_active_people", "people are refused first, as in the database");
  assert.equal(await reasonOf(save({ nodeId: leaf.id, memberIds: ["mona"] })), "accepted");
  assert.equal(await reasonOf(service.archiveNode(await current(leaf.id))), "unit_has_active_people");
  assert.equal(await reasonOf(save({ nodeId: leaf.id, memberIds: [] })), "accepted");
  assert.equal(await reasonOf(service.deleteNode(await current(leaf.id))), "unit_has_people_history");
  assert.equal(await reasonOf(service.archiveNode(await current(leaf.id))), "accepted", "archive once the people are ended");
});

/* ----------------------------- Supabase mapping --------------------------- */

test("Supabase: the writer receives one unit's complete desired state; cleared slots are null", () => {
  assert.deepEqual(supabase.saveUnitResponsibilitiesRpcArgs({
    projectId: "P", expectedVersion: "v", nodeId: "N", memberIds: ["a", "b", "a"], weeklyResponsibleId: "a",
  }), {
    p_project: "P", p_expected_updated_at: "v", p_node: "N", p_members: ["a", "b"], p_lead: null,
    p_weekly_responsible: "a", p_weekly_backup: null, p_monthly_responsible: null, p_monthly_backup: null,
  });
  assert.deepEqual(supabase.unitMemberFromRow({ id: "u", project_id: "P", node_id: "N", member_id: "m", unit_role: "lead",
    ended_at: null, created_by: null, created_at: "c", updated_at: "u" }),
    { id: "u", projectId: "P", nodeId: "N", memberId: "m", unitRole: "lead", endedAt: undefined, createdAt: "c", updatedAt: "u" });
  assert.deepEqual(supabase.reportResponsibilityFromRow({ id: "r", project_id: "P", node_id: "N", member_id: "m", unit_member_id: "u",
    report_kind: "monthly", responsibility: "backup", ended_at: "e", created_by: null, created_at: "c", updated_at: "u" }),
    { id: "r", projectId: "P", nodeId: "N", memberId: "m", unitMemberId: "u", reportKind: "monthly", responsibility: "backup",
      endedAt: "e", createdAt: "c", updatedAt: "u" });
});

function fakeClient(responses) {
  const from = (table) => {
    const builder = new Proxy({}, { get(_, prop) {
      if (prop === "then") {
        const answer = responses[table]?.shift() ?? { data: [], error: null };
        return (resolve, reject) => Promise.resolve(answer).then(resolve, reject);
      }
      return () => builder;
    } });
    return builder;
  };
  return { from, rpc: async () => responses.rpc?.shift() ?? { data: null, error: null } };
}

test("Supabase: a database without the 2C.3D tables still loads the structure, without people", async () => {
  const version = { data: { id: "P", updated_at: "v" }, error: null };
  const missing = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.project_structure_unit_members' in the schema cache" } };
  const service = supabase.createSupabaseProjectStructureService(() => fakeClient({
    projects: [version, version], project_structure_unit_members: [missing], project_structure_report_responsibilities: [missing],
  }));
  const loaded = await service.getStructure("P");
  assert.equal(loaded.assignments, undefined);
  assert.deepEqual([loaded.levels, loaded.nodes], [[], []]);
  const unavailable = supabase.createSupabaseProjectStructureService(() => fakeClient({
    rpc: [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }],
  }));
  assert.equal(await reasonOf(unavailable.saveUnitResponsibilities({ projectId: "P", expectedVersion: "v", nodeId: "N", memberIds: [] })),
    "responsibilities_unavailable");
});

test("every 2C.3D database tag maps to fixed plain language; membership-end refusals too", () => {
  const tags = {
    UNIT_HAS_ACTIVE_PEOPLE: "unit_has_active_people", WEEKLY_RESPONSIBILITY_EXISTS: "weekly_responsibility_exists",
    MONTHLY_RESPONSIBILITY_EXISTS: "monthly_responsibility_exists", UNIT_HAS_PEOPLE_HISTORY: "unit_has_people_history",
    LEAD_NOT_UNIT_MEMBER: "lead_not_unit_member", RESPONSIBLE_NOT_UNIT_MEMBER: "responsible_not_unit_member",
    BACKUP_WITHOUT_RESPONSIBLE: "backup_without_responsible", SAME_PERSON: "same_person",
    MEMBERSHIP_INCOMPLETE: "membership_incomplete", MEMBER_NOT_ACTIVE: "member_not_active", UNIT_NOT_FOUND: "not_found",
    UNIT_ARCHIVED: "unit_archived", UNIT_NOT_REPORTING: "unit_not_reporting", UNIT_MEMBER_IS_LEAD: "unit_member_is_lead",
    UNIT_MEMBER_HAS_RESPONSIBILITY: "unit_member_has_responsibility", ASSIGNMENT_ENDED: "assignment_history",
    ASSIGNMENT_IMMUTABLE: "assignment_history", ASSIGNMENT_HISTORY_PRESERVED: "assignment_history",
    ASSIGNMENT_MUST_START_ACTIVE: "assignment_history", INVALID_INPUT: "invalid_people",
  };
  for (const [tag, reason] of Object.entries(tags)) {
    const mapped = mapProjectStructureError({ message: `[${tag}] raw database sentence`, code: "23514" });
    assert.equal(mapped.reason, reason, tag);
    assert.doesNotMatch(mapped.message, /raw database sentence|\[|project_structure/);
  }
  const fk = mapProjectStructureError({ code: "23503", message: 'update or delete on table "project_structure_nodes" violates foreign key constraint "project_structure_unit_members_node_same_project"' });
  assert.equal(fk.reason, "unit_has_people_history", "even a raw FK backstop becomes a domain message");
  assert.equal(mapProjectTeamError({ message: "[MEMBER_HAS_UNIT_RESPONSIBILITY] x" }).reason, "has_unit_responsibility");
  assert.equal(mapProjectTeamError({ message: "[MEMBER_HAS_UNIT_ASSIGNMENTS] x" }).reason, "has_unit_assignments");
});

/* ------------------- mock-mode parity: ending a membership ----------------- */

const { createInMemoryProjectTeamService } = await import("../../../services/project-team-service.ts");
const { membershipEndBlocker } = rules;
// The database guard's tags, mapped by the real service's own error mapper.
const DB_REASON = {
  unit_responsibility: mapProjectTeamError({ message: "[MEMBER_HAS_UNIT_RESPONSIBILITY] x" }).reason,
  unit_assignments: mapProjectTeamError({ message: "[MEMBER_HAS_UNIT_ASSIGNMENTS] x" }).reason,
};

test("membershipEndBlocker mirrors the database guard: roles first, then plain membership; history never blocks", () => {
  const assignments = {
    unitMembers: [
      unitRow("a", "Civil", "ahmed"), unitRow("b", "Civil", "ahmed", "lead"),
      unitRow("c", "Civil", "mona"), unitRow("d", "Civil", "mostafa"),
      unitRow("e", "Earthworks", "lina"), unitRow("f", "Mech", "omar"), unitRow("g", "Mech", "omar", "lead"),
      unitRow("h", "Mech", "old", "member", "2026-10-01T00:00:00Z"),
    ],
    reportResponsibilities: [
      reportRow("r1", "Civil", "mona", "c", "weekly", "backup"),
      reportRow("r2", "Earthworks", "lina", "e", "monthly", "responsible"),
      reportRow("r3", "Civil", "mostafa", "d", "weekly", "responsible", "2026-10-02T00:00:00Z"),
    ],
  };
  assert.equal(membershipEndBlocker(assignments, "ahmed"), "unit_responsibility", "Lead (and member)");
  assert.equal(membershipEndBlocker(assignments, "mona"), "unit_responsibility", "Weekly Backup");
  assert.equal(membershipEndBlocker(assignments, "lina"), "unit_responsibility", "Monthly Responsible");
  assert.equal(membershipEndBlocker(assignments, "omar"), "unit_responsibility", "Lead without a reporting role");
  assert.equal(membershipEndBlocker(assignments, "mostafa"), "unit_assignments", "ended responsibility; still a member");
  assert.equal(membershipEndBlocker(assignments, "old"), undefined, "ended rows are history");
  assert.equal(membershipEndBlocker(assignments, "nobody"), undefined);
  assert.equal(membershipEndBlocker(undefined, "ahmed"), undefined);
  assert.deepEqual(DB_REASON, { unit_responsibility: "has_unit_responsibility", unit_assignments: "has_unit_assignments" });
});

/** A team mock over one project, with whatever unit people the scenario needs. */
function teamMock(assignments, members = MEMBERS.map((entry) => ({ ...entry }))) {
  const project = { ...PROJECT, status: "planning", members, updatedAt: "v1" };
  const service = createInMemoryProjectTeamService({
    read: () => ({ ...project, members: project.members.map((entry) => ({ ...entry })) }),
    writeMembers: (_, next) => {
      project.members = next;
      project.updatedAt = `v${Number(project.updatedAt.slice(1)) + 1}`;
      return project.updatedAt;
    },
    unitAssignments: () => assignments,
  }, { now: () => "2026-10-12T12:00:00Z" });
  const end = (memberId, version = project.updatedAt) => reasonOf(service.endMember({ projectId: "P", version, memberId }));
  return { project, end };
}

test("mock parity: the in-memory team service refuses ending a membership with the database's own reasons", async () => {
  const scenarios = [
    ["Unit Lead + Weekly Responsible", "ahmed", "unit_responsibility"],
    ["Weekly Backup", "mona", "unit_responsibility"],
    ["plain unit member (ended responsibility is history)", "mostafa", "unit_assignments"],
  ];
  for (const [label, memberId, blocker] of scenarios) {
    assert.equal(await teamMock(civilStaffed()).end(memberId), DB_REASON[blocker], label);
  }
  const monthly = { unitMembers: [unitRow("u", "Earthworks", "ahmed")],
    reportResponsibilities: [reportRow("r", "Earthworks", "ahmed", "u", "monthly", "responsible")] };
  assert.equal(await teamMock(monthly).end("ahmed"), DB_REASON.unit_responsibility, "Monthly Responsible");
  const monthlyBackup = { unitMembers: [unitRow("u", "Earthworks", "ahmed"), unitRow("v", "Earthworks", "mona")],
    reportResponsibilities: [reportRow("r", "Earthworks", "mona", "v", "monthly", "responsible"),
      reportRow("s", "Earthworks", "ahmed", "u", "monthly", "backup")] };
  assert.equal(await teamMock(monthlyBackup).end("ahmed"), DB_REASON.unit_responsibility, "Monthly Backup");
  const leadOnly = { unitMembers: [unitRow("u", "Mech", "ahmed"), unitRow("v", "Mech", "ahmed", "lead")], reportResponsibilities: [] };
  assert.equal(await teamMock(leadOnly).end("ahmed"), DB_REASON.unit_responsibility, "Unit Lead without a reporting role");
  // Ended rows never block; a member with no unit rows ends normally.
  assert.equal(await teamMock(civilStaffed()).end("dina"), "accepted");
  // Database order: the version check first, then the unit rules, then active reports.
  assert.equal(await teamMock(civilStaffed()).end("ahmed", "old-version"), "stale");
  const reporting = MEMBERS.map((entry) => ({ ...entry, reportsToMemberId: entry.id === "mona" ? "ahmed" : undefined }));
  assert.equal(await teamMock(civilStaffed(), reporting).end("ahmed"), DB_REASON.unit_responsibility, "unit guard before Reports To");
  assert.equal(await teamMock({ unitMembers: [], reportResponsibilities: [] }, reporting).end("ahmed"), "has_active_reports");
  // No structure people known (PSM / legacy, or none loaded): unchanged 2C.3C behaviour.
  assert.equal(await teamMock(undefined).end("ahmed"), "accepted");
});

test("mock end-to-end: the in-memory structure and team services share one store and refuse together", async () => {
  let tick = 0;
  const next = () => new Date(Date.UTC(2026, 9, 12, 1, 0, tick++)).toISOString();
  const project = { ...PROJECT, status: "planning", members: MEMBERS.map((entry) => ({ ...entry })), updatedAt: next() };
  const structureService = createInMemoryProjectStructureService({
    projects: {
      read: () => ({ structureFamily: "other", status: project.status, version: project.updatedAt, members: project.members }),
      advance: () => (project.updatedAt = next()),
    },
    now: next,
  });
  const team = createInMemoryProjectTeamService({
    read: () => ({ ...project, members: project.members.map((entry) => ({ ...entry })) }),
    writeMembers: (_, members) => {
      project.members = members;
      return (project.updatedAt = next());
    },
    unitAssignments: async (id) => (await structureService.getStructure(id)).assignments,
  }, { now: next });
  const end = (memberId) => reasonOf(team.endMember({ projectId: "P", version: project.updatedAt, memberId }));
  const save = (input) => structureService.saveUnitResponsibilities({ projectId: "P", expectedVersion: project.updatedAt, ...input });

  await structureService.configureLevels({ projectId: "P", expectedVersion: project.updatedAt,
    levels: [{ levelNumber: 1, singularLabel: "Function", pluralLabel: "Functions" }] });
  const civil = await structureService.createNode({ projectId: "P", levelNumber: 1, name: "Civil", weeklyReportingRequired: true });
  await save({ nodeId: civil.id, memberIds: ["ahmed", "mona"], leadMemberId: "ahmed", weeklyResponsibleId: "ahmed" });
  assert.equal(await end("ahmed"), "has_unit_responsibility");
  assert.equal(await end("mona"), "has_unit_assignments");
  // Remove everyone from the unit explicitly; the history stays and no longer blocks.
  await save({ nodeId: civil.id, memberIds: [] });
  assert.equal(await end("mona"), "accepted");
  assert.equal(await end("ahmed"), "accepted");
  const history = (await structureService.getStructure("P")).assignments;
  assert.ok(history.unitMembers.length === 3 && history.unitMembers.every((row) => row.endedAt), "ended rows kept as history");
});

test("the default mock wiring reads the units' people from the in-memory structure service; Supabase is untouched", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../../services/project-team-service.ts", import.meta.url), "utf8").replaceAll("\r", "");
  assert.match(source, /async unitAssignments\(projectId\) \{\s+const \{ projectStructureService \} = await import\("\.\/project-structure-service"\);\s+return projectStructureService\.getStructure\(projectId\)\.then\(\(structure\) => structure\.assignments, \(\) => undefined\);/);
  // The Supabase path is untouched: the database guard decides there.
  const supabasePath = source.slice(source.indexOf("export function createSupabaseProjectTeamService"), source.indexOf("/* ------------------------------ in-memory mock"));
  assert.doesNotMatch(supabasePath, /membershipEndBlocker|unitAssignments/);
});
