import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({ resolve(specifier, context, nextResolve) {
  // Node's ESM resolver needs the file name of Next's CommonJS entries.
  const next = { "next/link": "next/link.js", "next/navigation": "next/navigation.js" }[specifier];
  return nextResolve(next ?? specifier, context);
}, load(url, context, nextLoad) {
  // Full transpile (not type-stripping) for this app's TS: the workspace pulls
  // in master-data modules that use syntax strip-only mode rejects.
  const appSource = url.includes("/eprp/src/") && (url.endsWith(".tsx") || url.endsWith(".ts"));
  if (!appSource) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });
const { ProjectTeamWorkspace } = await import("./components/setup/project-team-workspace.tsx");

const EPROM = { id: "p-eprom", kind: "eprom", sortOrder: 0 };
const OWNER = { id: "p-owner", kind: "owner", sortOrder: 1 };
const sub = (id, name, sortOrder, shortName) => ({ id, kind: "subcontractor", name, shortName, scope: "Civil works", engagementStatus: "active", sortOrder });
const member = (id, contactId, extra = {}) => ({
  id, projectId: "prj", contactId, partyId: "p-eprom", projectRole: "Engineer", createdAt: "t0", updatedAt: "t0", ...extra,
});
const contacts = [
  ["c-pm", "Mona PM", "Senior Project Manager"], ["c-pcm", "Karim Controls", "Project Control Manager"],
  ["c-rc", "Nadia Coordinator", "Reporting Coordinator"], ["c-sponsor", "Hany Sponsor", "Operations Director"],
  ["c-client", "Dina Client", "Client Engineer"], ["c1", "Omar Engineer", "Mechanical Engineer"],
  ["c2", "Sara Supervisor", ""], ["c3", "Legacy Person", "Advisor"],
].map(([id, name, position]) => ({ id, name, position, active: true }));

function project(family, { parties = [EPROM, OWNER], members, status = "planning" } = {}) {
  return {
    id: "prj", code: "PRJ", name: "Team project", structureFamily: family, status, clientId: "client",
    projectManagerId: "c-pm", projectControlManagerId: "c-pcm", reportingCoordinatorId: "c-rc",
    projectSponsorId: "c-sponsor", clientRepresentativeId: "c-client",
    departments: [], team: [], parties,
    members: members === undefined ? [member("m-pm", "c-pm"), member("m-client", "c-client", { partyId: "p-owner", reportsToMemberId: "m-pm" })] : members,
    updatedAt: "2026-10-07T10:00:00.000000+00:00", createdAt: "2026-10-01T00:00:00Z",
  };
}

const render = (props) => renderToStaticMarkup(React.createElement(ProjectTeamWorkspace, {
  contacts, clientName: "SOPC", canManage: true, canEditPeople: false, onProjectChanged() {}, ...props,
}));
const sectionsOf = (html) => [...html.matchAll(/data-team-section="([a-z_]+)"/g)].map((match) => match[1]);

for (const family of ["psm", "other"]) {
  test(`${family}: leadership groups, then EPROM and Owner / Client teams; zero subcontractors -> no subcontractor team`, () => {
    const html = render({ project: project(family) });
    assert.match(html, /Project Leadership &amp; Governance/);
    assert.match(html, /Project Controls &amp; Coordination/);
    assert.doesNotMatch(html, /Top Management/i);
    const governance = html.slice(html.indexOf("Project Leadership &amp; Governance"), html.indexOf("Project Controls &amp; Coordination"));
    for (const label of ["Project Sponsor", "Project Manager", "Client Representative"]) assert.match(governance, new RegExp(label));
    const controls = html.slice(html.indexOf("Project Controls &amp; Coordination"));
    for (const label of ["Project Control Manager", "Reporting Coordinator"]) assert.match(controls, new RegExp(label));
    assert.deepEqual(sectionsOf(html), ["eprom", "owner"]);
    assert.match(html, /EPROM Team \(1\)/);
    assert.match(html, /Owner \/ Client Team \(1\)/);
    assert.match(html, /People representing SOPC/);
  });

  test(`${family}: one and multiple subcontractors each get a team section, in configured order`, () => {
    const one = render({ project: project(family, { parties: [EPROM, OWNER, sub("s1", "Alpha Contracting", 0, "ACC")] }) });
    assert.deepEqual(sectionsOf(one), ["eprom", "owner", "subcontractor"]);
    assert.match(one, /ACC Team \(0\)/);
    const many = render({ project: project(family, {
      parties: [EPROM, OWNER, sub("s2", "Beta Engineering", 1), sub("s1", "Alpha Contracting", 0, "ACC")],
      members: [member("m1", "c1", { partyId: "s2", projectRole: "Site Supervisor" })],
    }) });
    assert.deepEqual(sectionsOf(many), ["eprom", "owner", "subcontractor", "subcontractor"]);
    assert.ok(many.indexOf("ACC Team") < many.indexOf("Beta Engineering Team"));
    assert.match(many, /Beta Engineering Team \(1\)/);
  });
}

test("member card: person, authoritative position, Project Role, Reports To, Party and leadership badge", () => {
  const html = render({ project: project("psm") });
  const card = html.slice(html.indexOf('data-member-id="m-client"'));
  assert.match(card, /Dina Client/);
  assert.match(card, /Client Engineer/, "position from the person record");
  assert.match(card, /Reports To<\/dt><dd>Mona PM/);
  assert.match(card, /Owner \/ Client — SOPC/);
  assert.match(card, /Client Representative/, "leadership badge");
  assert.match(html.slice(html.indexOf('data-member-id="m-pm"')), /Senior Project Manager/);
});

test("legacy members show Needs party / Needs project role and the warning counts; warnings do not block", () => {
  const html = render({ project: project("other", { members: [
    member("m-pm", "c-pm"),
    member("m-legacy", "c3", { partyId: undefined, projectRole: undefined }),
    member("m1", "c1"),
  ] }) });
  assert.deepEqual(sectionsOf(html), ["eprom", "owner", "needs_party"]);
  assert.match(html, /1 member needs Party/);
  assert.match(html, /1 member needs Project Role/);
  assert.match(html, /2 members have no Reports To/);
  assert.match(html, /Warnings only — they do not block setup/);
  const legacy = html.slice(html.indexOf('data-member-id="m-legacy"'));
  assert.match(legacy, /Needs project role/);
  assert.match(legacy, /Needs party/);
});

test("ended members are listed as history, not as current team", () => {
  const html = render({ project: project("psm", { members: [member("m-pm", "c-pm"), member("m-old", "c1", { endedAt: "2026-09-01T00:00:00Z" })] }) });
  assert.doesNotMatch(html, /data-member-id="m-old"/);
  assert.match(html, /Former members \(1\)/);
  assert.match(html, /Ended 2026-09-01/);
});

test("Edit Person (global People master) is shown only to People-master authorities", () => {
  // The master-record button names the person from the People store (here the
  // mock store, which does not hold these fixture people): "Edit selected person".
  const editPerson = /aria-label="Edit (selected person|Mona PM|Dina Client)"/g;
  const without = render({ project: project("psm"), canEditPeople: false });
  assert.equal((without.match(editPerson) ?? []).length, 0);
  const withAuthority = render({ project: project("psm"), canEditPeople: true });
  assert.equal((withAuthority.match(editPerson) ?? []).length, 2, "one per member");
});

test("without project responsibility authority (or archived) there are no membership actions", () => {
  const html = render({ project: project("psm"), canManage: false });
  assert.doesNotMatch(html, /Add team member|End Dina Client&#x27;s membership|Edit Dina Client&#x27;s project membership/);
  const managed = render({ project: project("psm") });
  assert.match(managed, /Add team member/);
  assert.match(managed, /aria-label="End Dina Client&#x27;s membership"/);
});

test("a database without the membership table shows a clear unavailable state, not an empty team", () => {
  const html = render({ project: { ...project("psm"), members: undefined } });
  assert.match(html, /Project team membership is not available yet/);
  assert.doesNotMatch(html, /data-team-section/);
});

/* ------------------------------ source wiring ----------------------------- */

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");

test("Contacts step renders the same Project Team for every project type; PSM keeps its scope builder", () => {
  const view = source("./components/setup/project-setup-view.tsx");
  assert.match(view, /\{step === "contacts" && \(\s*<ProjectTeamWorkspace/);
  assert.match(view, /step === "contacts" && !isOther && \(\s*<SetupStepContacts[\s\S]*?canEditPeople=\{canEditPeople\}/);
  assert.match(view, /canManageTeam=\{canManage && savedBaseline\.status !== "archived"\}/);
  assert.match(view, /canEditPeople=\{canEditPeopleMaster\(identity\)\}/);
});

test("direct Edit / Add Person controls are gated on People-master authority everywhere on project setup", () => {
  const authority = source("../auth/people-master-authority.ts");
  assert.match(authority, /return !configured \|\| identity\.isGlobalAuthority;/);
  const form = source("./components/project-form.tsx");
  assert.match(form, /const canEditPeople = usePeopleMasterAuthority\(\);/);
  assert.match(form, /allowManage=\{canEditPeople\}\s+\/>\s+<\/div>[\s\S]*?\{canEditPeople && \(\s+<MasterRecordEditButton\s+kind="contact"/);
  const contactsStep = source("./components/setup/setup-step-contacts.tsx");
  // 2C.3D Wave 2: the PSM pickers choose from the active Project Team only, so
  // they create nobody — no Add Contact, no "Add new person" — for anyone. A
  // new person is added (and, with authority, created) on the Project Team.
  assert.doesNotMatch(contactsStep, /Add Contact|MasterDataDialog|allowManage=\{canEditPeople\}/);
  assert.equal((contactsStep.match(/allowManage=\{false\}/g) ?? []).length, 2);
  assert.match(contactsStep, /canEdit=\{canEditPeople\}/);
  const info = source("./components/setup/project-info-workspace.tsx");
  assert.match(info, /\(section\.id !== "contacts" \|\| canEditPeople\)/);
  const multi = source("../master-data/components/managed-multi-select.tsx");
  assert.match(multi, /allowManage = true,/);
  const dialog = source("./components/setup/project-team-member-dialog.tsx");
  assert.match(dialog, /allowManage=\{canEditPeople\}/);
  const workspace = source("./components/setup/project-team-workspace.tsx");
  assert.match(workspace, /\{canEditPeople && <MasterRecordEditButton kind="contact"/);
});

test("the Contacts step description is neutral for PSM, Other and legacy projects", async () => {
  const { resolveSetupSteps } = await import("../../config/project-workflow.ts");
  for (const structureFamily of ["psm", "other", undefined]) {
    const contacts = resolveSetupSteps({ structureFamily, saved: true }).find((step) => step.id === "contacts");
    assert.equal(contacts.description,
      "The people working on this project, their project party, role and reporting relationship.", String(structureFamily));
    assert.doesNotMatch(contacts.description, /department|discipline/i);
  }
});

test("Project Role is entered per project and never copied from the person's global position", () => {
  const dialog = source("./components/setup/project-team-member-dialog.tsx");
  assert.match(dialog, /projectRole: ""/, "a new membership starts with an empty role");
  assert.doesNotMatch(dialog, /projectRole:\s*\w*\.position|jobTitle/i);
  assert.match(dialog, /maxLength=\{PROJECT_ROLE_MAX\}/);
});
