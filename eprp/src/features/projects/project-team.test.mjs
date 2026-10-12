import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import {
  activeMembers,
  leadershipGroups,
  leadershipRolesOf,
  memberDraftIssues,
  PARTY_TEAM_HISTORY_MESSAGE,
  partyHasTeamHistory,
  partyLabel,
  reportsToCandidates,
  teamSections,
  teamWarnings,
  wouldCreateCycle,
} from "./project-team.ts";
import { evaluateProjectWorkflow, resolveSetupSteps } from "../../config/project-workflow.ts";
import { createInMemoryProjectTeamService } from "../../services/project-team-service.ts";
import { mapProjectTeamError, PROJECT_TEAM_MESSAGES } from "../../services/project-team-errors.ts";

const EPROM = { id: "p-eprom", kind: "eprom", sortOrder: 0 };
const OWNER = { id: "p-owner", kind: "owner", sortOrder: 1 };
const sub = (id, name, sortOrder, shortName) => ({ id, kind: "subcontractor", name, shortName, scope: "Works", engagementStatus: "active", sortOrder });
const member = (id, contactId, extra = {}) => ({
  id, projectId: "prj", contactId, partyId: "p-eprom", projectRole: "Engineer", createdAt: "t0", updatedAt: "t0", ...extra,
});

function project(family, { parties = [EPROM, OWNER], members = [], status = "planning" } = {}) {
  return {
    id: "prj", code: "PRJ", name: "Team project", structureFamily: family, status, clientId: "client",
    projectManagerId: "c-pm", projectControlManagerId: "c-pcm", reportingCoordinatorId: "c-rc",
    projectSponsorId: "c-sponsor", clientRepresentativeId: "c-client",
    departments: [], team: [], parties, members, updatedAt: "v1", createdAt: "v0",
  };
}

/* ------------------------------- grouping -------------------------------- */

for (const family of ["psm", "other"]) {
  test(`${family}: zero subcontractors -> exactly EPROM Team and Owner / Client Team`, () => {
    const sections = teamSections(project(family, { members: [member("m1", "c1")] }));
    assert.deepEqual(sections.map((section) => [section.kind, section.title]),
      [["eprom", "EPROM Team"], ["owner", "Owner / Client Team"]]);
    assert.deepEqual(sections[0].members.map((entry) => entry.id), ["m1"]);
  });

  test(`${family}: one and multiple subcontractors get their own team, keyed by party UUID, in configured order`, () => {
    const one = teamSections(project(family, { parties: [EPROM, OWNER, sub("s1", "Alpha Contracting", 0, "ACC")] }));
    assert.deepEqual(one.map((section) => section.key), ["p-eprom", "p-owner", "s1"]);
    assert.equal(one[2].title, "ACC Team");
    const many = teamSections(project(family, {
      parties: [EPROM, OWNER, sub("s2", "Beta Engineering", 1), sub("s1", "Alpha Contracting", 0, "ACC")],
      members: [member("m1", "c1", { partyId: "s2" }), member("m2", "c2", { partyId: "s1" })],
    }));
    assert.deepEqual(many.map((section) => section.title), ["EPROM Team", "Owner / Client Team", "ACC Team", "Beta Engineering Team"]);
    assert.deepEqual(many[3].members.map((entry) => entry.id), ["m1"]);
  });
}

test("PSM and Other produce identical grouping, leadership and warnings for the same data", () => {
  const data = { parties: [EPROM, OWNER, sub("s1", "Alpha", 0)], members: [member("m1", "c1"), member("m2", "c2", { partyId: "s1", reportsToMemberId: "m1" })] };
  for (const fn of [teamSections, leadershipGroups, teamWarnings]) {
    assert.deepEqual(fn(project("psm", data)), fn(project("other", data)));
  }
});

test("ended members are history: excluded from sections; a Needs party section appears only for legacy rows", () => {
  const sections = teamSections(project("other", {
    members: [member("m1", "c1", { endedAt: "t1" }), member("m2", "c2", { partyId: undefined, projectRole: undefined })],
  }));
  assert.deepEqual(sections.map((section) => section.kind), ["eprom", "owner", "needs_party"]);
  assert.equal(sections[0].members.length, 0);
  assert.deepEqual(sections[2].members.map((entry) => entry.id), ["m2"]);
  assert.deepEqual(activeMembers(project("psm", { members: [member("m1", "c1", { endedAt: "t1" })] }).members), []);
});

test("leadership: two groups of the existing fixed roles, never called Top Management", () => {
  const groups = leadershipGroups(project("psm"));
  assert.deepEqual(groups.map((group) => [group.title, group.roles.map((role) => role.label)]), [
    ["Project Leadership & Governance", ["Project Sponsor", "Project Manager", "Client Representative"]],
    ["Project Controls & Coordination", ["Project Control Manager", "Reporting Coordinator"]],
  ]);
  assert.doesNotMatch(JSON.stringify(groups), /top management/i);
  assert.deepEqual(leadershipRolesOf(project("psm"), "c-pm"), ["Project Manager"]);
  assert.equal(partyLabel(OWNER, "SOPC"), "Owner / Client — SOPC");
  assert.equal(partyLabel(undefined), "Needs party");
});

/* ------------------------------ Reports To ------------------------------- */

test("Reports To: same-project active members, any party, never self, never a cycle", () => {
  const members = [
    member("m1", "c1"),
    member("m2", "c2", { partyId: "p-owner", reportsToMemberId: "m1" }),
    member("m3", "c3", { partyId: "s1", reportsToMemberId: "m2" }),
    member("m4", "c4", { endedAt: "t1" }),
  ];
  assert.equal(wouldCreateCycle(members, "m1", "m1"), true, "self");
  assert.equal(wouldCreateCycle(members, "m1", "m2"), true, "direct");
  assert.equal(wouldCreateCycle(members, "m1", "m3"), true, "indirect");
  assert.equal(wouldCreateCycle(members, "m3", "m1"), false);
  assert.deepEqual(reportsToCandidates(members, "m1").map((entry) => entry.id), [], "m1 heads the chain");
  assert.deepEqual(reportsToCandidates(members, "m3").map((entry) => entry.id), ["m1", "m2"], "cross-party allowed");
  assert.deepEqual(reportsToCandidates(members).map((entry) => entry.id), ["m1", "m2", "m3"], "new person: any active member");
  // Malformed data never loops forever.
  assert.equal(wouldCreateCycle([member("a", "x", { reportsToMemberId: "b" }), member("b", "y", { reportsToMemberId: "a" })], "z", "a"), false);
});

/* ------------------------- warnings, not blockers ------------------------- */

test("legacy members and missing Reports To are counted as WARNINGS and never block setup completion", () => {
  const legacy = { partyId: undefined, projectRole: undefined };
  const data = project("other", {
    members: [
      member("m1", "c-pm"),                        // Project Manager heads the project
      member("m2", "c-sponsor", legacy),           // Sponsor: Needs party + role
      member("m3", "c1", legacy),
      member("m4", "c2", { reportsToMemberId: "m1" }),
      member("m5", "c3"),
      member("m6", "c4", { endedAt: "t1" }),
    ],
  });
  const warnings = teamWarnings(data);
  assert.deepEqual([warnings.needsParty, warnings.needsProjectRole, warnings.noReportsTo], [2, 2, 2]);
  assert.deepEqual(warnings.messages, ["2 members need Party", "2 members need Project Role", "2 members have no Reports To"]);
  assert.deepEqual(teamWarnings(project("psm", { members: [member("m3", "c1", legacy)] })).messages,
    ["1 member needs Party", "1 member needs Project Role", "1 member has no Reports To"]);
  // Completion is computed exactly as before 2C.3C: membership facts add no check.
  for (const family of ["psm", "other"]) {
    const withLegacy = project(family, { members: data.members });
    const without = project(family, { members: [] });
    const steps = resolveSetupSteps({ structureFamily: family, saved: true });
    const ids = ["contacts", "team"];
    const facts = (p) => evaluateProjectWorkflow(p, { structure: undefined }, (id) => id, undefined, steps)
      .filter((status) => ids.includes(status.id)).map((status) => status.checks);
    assert.deepEqual(facts(withLegacy), facts(without), family);
  }
});

test("a new or edited membership needs Party and a 1-80 character Project Role", () => {
  assert.deepEqual(memberDraftIssues({ partyId: "p", projectRole: "Engineer" }), {});
  assert.deepEqual(Object.keys(memberDraftIssues({ projectRole: "  " }, { requirePerson: true })).sort(),
    ["contactId", "partyId", "projectRole"]);
  assert.match(memberDraftIssues({ partyId: "p", projectRole: "x".repeat(81) }).projectRole, /80/);
  assert.deepEqual(memberDraftIssues({ partyId: "p", projectRole: "x".repeat(80) }), {});
});

/* ---------------------------- in-memory service --------------------------- */

function harness(initial) {
  let current = structuredClone(initial);
  let version = 1;
  let ids = 0;
  const service = createInMemoryProjectTeamService({
    read: () => structuredClone(current),
    writeMembers: (_id, members) => { current = { ...current, members, updatedAt: `v${++version}` }; return current.updatedAt; },
  }, { newId: () => `new-${++ids}`, now: () => "now" });
  return { service, get: () => current };
}

test("mock service mirrors the database: add, stale, one active, party, Reports To, end, rejoin", async () => {
  const { service, get } = harness(project("psm", { parties: [EPROM, OWNER, sub("s1", "Alpha", 0)] }));
  const added = await service.addMember({ projectId: "prj", version: "v1", contactId: "c1", partyId: "p-eprom", projectRole: " Lead " });
  assert.equal(get().members[0].projectRole, "Lead");
  await assert.rejects(service.addMember({ projectId: "prj", version: "v1", contactId: "c2", partyId: "p-eprom", projectRole: "x" }), { reason: "stale" });
  await assert.rejects(service.addMember({ projectId: "prj", version: added.version, contactId: "c1", partyId: "p-eprom", projectRole: "x" }), { reason: "already_member" });
  await assert.rejects(service.addMember({ projectId: "prj", version: added.version, contactId: "c2", partyId: "elsewhere", projectRole: "x" }), { reason: "party_invalid" });
  await assert.rejects(service.addMember({ projectId: "prj", version: added.version, contactId: "c2", partyId: "", projectRole: "x" }), { reason: "party_required" });
  const second = await service.addMember({ projectId: "prj", version: added.version, contactId: "c2", partyId: "s1", projectRole: "Supervisor", reportsToMemberId: added.memberId });
  await assert.rejects(service.updateMember({ projectId: "prj", version: second.version, memberId: added.memberId, partyId: "p-eprom", projectRole: "Lead", reportsToMemberId: added.memberId }), { reason: "self_report" });
  await assert.rejects(service.updateMember({ projectId: "prj", version: second.version, memberId: added.memberId, partyId: "p-eprom", projectRole: "Lead", reportsToMemberId: second.memberId }), { reason: "reports_to_cycle" });
  await assert.rejects(service.endMember({ projectId: "prj", version: second.version, memberId: added.memberId }), { reason: "has_active_reports" });
  const ended = await service.endMember({ projectId: "prj", version: second.version, memberId: second.memberId });
  const rejoined = await service.addMember({ projectId: "prj", version: ended.version, contactId: "c2", partyId: "p-owner", projectRole: "Client Engineer" });
  assert.equal(get().members.filter((entry) => entry.contactId === "c2").length, 2, "history kept");
  assert.ok(rejoined.version);
});

test("mock service: legacy rows end without completion, but an edit must complete Party and Role; archived is read-only", async () => {
  const legacy = member("legacy", "c-sponsor", { partyId: undefined, projectRole: undefined });
  const { service } = harness(project("other", { members: [legacy] }));
  await assert.rejects(service.updateMember({ projectId: "prj", version: "v1", memberId: "legacy", partyId: "p-eprom", projectRole: "" }), { reason: "project_role_required" });
  // 2C.3D Wave 2: while they still hold Project Sponsor, ending is refused...
  await assert.rejects(service.endMember({ projectId: "prj", version: "v1", memberId: "legacy" }), { reason: "has_project_responsibility" });
  // ...and once that is reassigned, an incomplete legacy membership still ends without completion.
  const released = harness({ ...project("other", { members: [legacy] }), projectSponsorId: undefined });
  const ended = await released.service.endMember({ projectId: "prj", version: "v1", memberId: "legacy" });
  assert.ok(ended.version);
  const archived = harness(project("psm", { status: "archived", members: [member("m1", "c1")] }));
  await assert.rejects(archived.service.endMember({ projectId: "prj", version: "v1", memberId: "m1" }), { reason: "project_archived" });
});

test("party removal is blocked by any current or ended team history, with the approved sentence", () => {
  const members = [member("m1", "c1", { partyId: "s1", endedAt: "t1" })];
  assert.equal(partyHasTeamHistory(members, "s1"), true);
  assert.equal(partyHasTeamHistory(members, "s2"), false);
  assert.equal(PARTY_TEAM_HISTORY_MESSAGE, "This subcontractor cannot be removed because project team history exists.");
});

test("mock Project Information refuses removing a subcontractor with ended team history (friendly sentence)", async () => {
  // The mock project service imports modules using TS syntax that Node's
  // type-stripping rejects; transpile app sources loaded from here on.
  registerHooks({ load(url, context, nextLoad) {
    if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  } });
  const { projectService, readMockProject } = await import("../../services/project-service.ts");
  const { projectTeamService } = await import("../../services/project-team-service.ts");
  const [first] = await projectService.getProjects();
  const withSub = await projectService.updateProject(first.id, {
    parties: [{ kind: "subcontractor", name: "ZZ Team History Co", scope: "Civil", engagementStatus: "active", sortOrder: 0 }],
  }, first.updatedAt);
  const subParty = withSub.parties.find((party) => party.kind === "subcontractor");
  const added = await projectTeamService.addMember({ projectId: first.id, version: withSub.updatedAt,
    contactId: "contact-zz-history", partyId: subParty.id, projectRole: "Site Supervisor" });
  const ended = await projectTeamService.endMember({ projectId: first.id, version: added.version, memberId: added.memberId });
  await assert.rejects(projectService.updateProject(first.id, { parties: [] }, ended.version),
    { message: PARTY_TEAM_HISTORY_MESSAGE });
  assert.ok(readMockProject(first.id).parties.some((party) => party.id === subParty.id), "the party is kept");
});

test("database refusals map to fixed plain-language messages; no database text leaks", () => {
  const cases = [
    [{ message: "[REPORTS_TO_CYCLE] This Reports To would create a reporting loop.", code: "23514" }, "reports_to_cycle"],
    [{ message: "[SELF_REPORT] x", code: "23514" }, "self_report"],
    [{ message: "[PROJECT_ARCHIVED] x", code: "42501" }, "project_archived"],
    [{ message: "[STALE] x", code: "PT409" }, "stale"],
    [{ message: "duplicate key value violates unique constraint \"project_members_one_active\"", code: "23505" }, "already_member"],
    [{ message: "insert or update on table \"project_members\" violates foreign key constraint \"project_members_party_same_project\"", code: "23503" }, "party_invalid"],
    [{ message: "new row violates row-level security policy for table \"project_members\"", code: "42501" }, "not_authorized"],
    [{ message: "Could not find the function public.add_project_member", code: "PGRST202" }, "unavailable"],
    [{ message: "something unexpected", code: "XX000" }, "failed"],
  ];
  for (const [error, reason] of cases) {
    const mapped = mapProjectTeamError(error);
    assert.equal(mapped.reason, reason, error.message);
    assert.equal(mapped.message, PROJECT_TEAM_MESSAGES[reason]);
    assert.doesNotMatch(mapped.message, /project_members|constraint|violates|\[/);
  }
});
