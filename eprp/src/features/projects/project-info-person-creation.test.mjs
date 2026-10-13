import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// 2C.3D Wave 2 consistency (completed with 2C.3E): Project Info never creates
// a Person. A new person joins a project on its Project Team first; Project
// Info, the add-and-link flow and the master-data pages reached from a project
// offer no way to create someone who then fails to be linked (a partial,
// orphan Person) or who holds a role without being on the Project Team.

// The add-and-link module reads two master-data lookups through the
// master-data index, which also exports React components Node cannot load.
// Only those two lookups are stubbed; everything else is the real code.
const MASTER_DATA_STUB = `data:text/javascript,${encodeURIComponent(
  "export const getDisciplineById = () => undefined; export const getSystemById = () => undefined;"
)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/features/master-data") return { url: MASTER_DATA_STUB, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  },
});

const { linkRecordToProject } = await import("./link-record-to-project.ts");
const { projectService, readMockProject } = await import("../../services/project-service.ts");
const { mockDepartments } = await import("../../data/mock/master-data.mock.ts");
const { PROJECT_SETUP_ARCHIVED_MESSAGE } = await import("./setup-save.ts");
const { memberPickerPool, NOT_ON_PROJECT_TEAM } = await import("./project-team.ts");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");

/* ------- Project Information role / position pickers: the Project Team ------ */

const member = (contactId, extra = {}) => ({
  id: `m-${contactId}`, projectId: "prj", contactId, createdAt: "t", updatedAt: "t", ...extra,
});
const POOL_PROJECT = {
  parties: [{ id: "p-eprom", kind: "eprom", sortOrder: 0 }, { id: "p-owner", kind: "owner", sortOrder: 1 }],
  members: [
    member("lead", { partyId: "p-eprom", projectRole: "Civil Lead" }),
    member("legacy"),
    member("client", { partyId: "p-owner" }),
    member("former", { partyId: "p-eprom", projectRole: "Engineer", endedAt: "t1" }),
  ],
};

test("existing project: only ACTIVE members of that project are candidates, described with Party / Project Role / Position and the Needs badges", () => {
  const pool = memberPickerPool(POOL_PROJECT, "Acme Oil");
  for (const contactId of ["lead", "legacy", "client"]) assert.equal(pool.isCandidate(contactId), true, contactId);
  // Non-members: an ended membership, a global-only person, another project's member.
  for (const contactId of ["former", "global-only", "other-project"]) assert.equal(pool.isCandidate(contactId), false, contactId);
  assert.equal(pool.sublabel("lead", "Senior Engineer"), "EPROM · Civil Lead · Senior Engineer");
  assert.equal(pool.sublabel("client"), "Owner / Client — Acme Oil");
  assert.equal(pool.sublabel("legacy"), undefined);
  assert.deepEqual(pool.badges("lead"), []);
  assert.deepEqual(pool.badges("legacy"), ["Needs party", "Needs project role"]);
  assert.deepEqual(pool.badges("client"), ["Needs project role"]);
  // A kept legacy holder who is not a member is marked, never offered.
  assert.deepEqual(pool.badges("global-only"), [NOT_ON_PROJECT_TEAM]);
  assert.equal(memberPickerPool({ members: [], parties: [] }).isCandidate("anyone"), false, "no team, no candidates");
});

test("Project Information pickers use the pool on an existing project only; a new project's creation flow is unchanged", () => {
  const form = source("./components/project-form.tsx");
  // The pool exists only once the project is saved.
  assert.match(form, /const memberPool = React\.useMemo\(\s+\(\) => \(savedProject \? memberPickerPool\(savedProject\) : undefined\),\s+\[savedProject\]\s+\);/);
  // Both person fields (fixed roles and positions) receive it.
  assert.equal((form.match(/allowCreate=\{!savedProject\}\n\s+memberPool=\{memberPool\}/g) ?? []).length, 2);
  // Wired into the shared picker: filter, sublabel and badges — and nothing when absent.
  assert.match(form, /filter=\{memberPool \? \(record\) => memberPool\.isCandidate\(record\.id\) : undefined\}/);
  assert.match(form, /\? \(record\) => memberPool\.sublabel\(record\.id, \(record as Contact\)\.position\)\s+: undefined/);
  assert.match(form, /optionBadges=\{memberPool \? \(record\) => memberPool\.badges\(record\.id\) : undefined\}/);
  // No membership is created anywhere on this path.
  assert.doesNotMatch(form, /projectTeamService|addMember|add_project_member/);
  // The Contacts step uses the very same pool (one rule, two pickers).
  assert.match(source("./components/setup/setup-step-contacts.tsx"), /memberPickerPool\(savedProject, clientName\)/);
});

test("a legacy holder who is not a member stays readable as the current value", () => {
  // The shared picker keeps the current selection in its options and trigger
  // whenever a filter excludes it, unless a caller asks it not to.
  const select = source("../master-data/components/managed-select.tsx");
  assert.match(select, /if \(\s+selected &&\s+!enforceFilter &&\s+!available\.some\(\(record\) => record\.id === selected\.id\)\s+\) \{\s+return \[selected, \.\.\.available\];/);
  const form = source("./components/project-form.tsx");
  const field = form.slice(form.indexOf("function PersonField("), form.indexOf("function SwitchField("));
  assert.doesNotMatch(field, /enforceFilter/);
});

test("project creation still works as before: no team, any person, no membership required", async () => {
  const [first] = await projectService.getProjects();
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = first;
  void _id; void _createdAt; void _updatedAt;
  const created = await projectService.createProject({ ...input, code: `${first.code}-NEW`, status: "planning" });
  assert.ok(created.id && created.id !== first.id);
  assert.equal(created.projectManagerId, first.projectManagerId, "the chosen holder is kept");
  assert.deepEqual(created.members, [], "no membership is created behind the scenes");
});

test("add-and-link never writes a person into a project: no partial link, the project is untouched", async () => {
  const project = (await projectService.getProjects()).find((candidate) => candidate.departments.length > 0 && candidate.status !== "archived");
  assert.ok(project, "an active mock project with a department");
  const before = readMockProject(project.id);
  const departmentId = project.departments[0].departmentId;
  const person = { id: "zz-new-person", name: "ZZ New Person", active: true };
  // Every context that used to try a department assignment, and the project-level one.
  for (const context of [
    { sourceType: "project", parentId: project.id },
    { sourceType: "department", parentId: departmentId },
    { sourceType: "department", parentId: departmentId, departmentId },
  ]) {
    assert.equal(await linkRecordToProject("contact", person, { projectId: project.id, ...context }), false, context.sourceType);
  }
  const after = readMockProject(project.id);
  assert.equal(after.updatedAt, before.updatedAt, "no write at all");
  assert.deepEqual(after.team, before.team);
  assert.deepEqual(after.members, before.members, "no membership created behind the scenes");
});

test("linking existing scope records still works; an archived project still refuses before writing", async () => {
  const projects = await projectService.getProjects();
  const active = projects.find((candidate) => candidate.status !== "archived"
    && mockDepartments.some((department) => !candidate.departments.some((link) => link.departmentId === department.id)));
  const department = mockDepartments.find((candidate) => !active.departments.some((link) => link.departmentId === candidate.id));
  assert.equal(await linkRecordToProject("department", { id: department.id, name: department.name, active: true }, { projectId: active.id }), true);
  assert.ok(readMockProject(active.id).departments.some((link) => link.departmentId === department.id));

  const other = projects.find((candidate) => candidate.id !== active.id && candidate.status !== "archived");
  await projectService.archiveProject(other.id);
  const spare = mockDepartments.find((candidate) => !other.departments.some((link) => link.departmentId === candidate.id));
  await assert.rejects(linkRecordToProject("department", { id: spare.id, name: spare.name, active: true }, { projectId: other.id }),
    { message: PROJECT_SETUP_ARCHIVED_MESSAGE });
});

test("Project Info offers no way to create a Person on an existing project", () => {
  // The Project Info workspace: no Add for Contacts, for anyone.
  const info = source("./components/setup/project-info-workspace.tsx");
  const addPaths = info.slice(info.indexOf("const ADD_PATH"), info.indexOf("};", info.indexOf("const ADD_PATH")));
  assert.match(addPaths, /const ADD_PATH: Record<Exclude<SectionId, "contacts">, string>/);
  assert.doesNotMatch(addPaths, /contacts:/);
  assert.doesNotMatch(info, /\/contacts\/new/);
  assert.match(info, /\{section\.id !== "contacts" && \(/);
  // Department / System / Programs & Studies pages reached from a project: no Add Contact.
  for (const kind of ["department", "system", "discipline"]) {
    const view = source(`../master-data/components/${kind}-detail-view.tsx`);
    assert.match(view, /const addContactHref = context\.projectId \? undefined : withProjectContext\("\/contacts\/new"/, kind);
    assert.equal((view.match(/<Link href=\{addContactHref\}>/g) ?? []).length, 2, kind);
    assert.equal((view.match(/\{addContactHref && \(/g) ?? []).length + (view.match(/addContactHref \? \(/g) ?? []).length, 2,
      `${kind}: both Add Contact buttons render only outside a project`);
  }
  // The add-and-link flow: a person is never linked as a department assignment.
  const links = source("./link-record-to-project.ts");
  assert.match(links, /case "contact":\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+return false;/);
  assert.doesNotMatch(links, /linkContact|team: next/);
  // Fixed-role and position pickers: no inline new Person once the project exists.
  const form = source("./components/project-form.tsx");
  assert.match(form, /allowCreate = true,/);
  assert.match(form, /allowManage=\{canEditPeople && allowCreate\}/);
  assert.equal((form.match(/<PersonField\n\s+control=\{control\}\n\s+allowCreate=\{!savedProject\}/g) ?? []).length, 2,
    "both Project Info person fields");
});

test("existing valid selection still works, and the global People master is unchanged", () => {
  // Project Info still selects existing people, and People-master editors can
  // still open the chosen person.
  const form = source("./components/project-form.tsx");
  assert.match(form, /<ManagedPersonSelect\s+value=\{selectedId\}\s+onChange=\{\(value\) => \{/);
  assert.match(form, /\{canEditPeople && \(\s+<MasterRecordEditButton\s+kind="contact"/);
  // The Contacts step still assigns ACTIVE Project Team members (2C.3D Wave 2).
  const contacts = source("./components/setup/setup-step-contacts.tsx");
  assert.match(contacts, /record\.id !== activeManager\?\.contactId && isActiveMember\(record\)/);
  // The Project Team is where a new person is added (and, with authority, created).
  const memberDialog = source("./components/setup/project-team-member-dialog.tsx");
  assert.match(memberDialog, /allowManage=\{canEditPeople\}/);
  // Outside a project the master-data pages still offer Add Contact.
  const department = source("../master-data/components/department-detail-view.tsx");
  assert.match(department, /withProjectContext\("\/contacts\/new", \{\s+\.\.\.context,\s+sourceType: "department",/);
});

test("archived Project Setup stays read-only (2C.3E unchanged)", () => {
  const view = source("./components/setup/project-setup-view.tsx");
  assert.match(view, /\{project && !readOnly && setupFlowFor\(\{ structureFamily, saved \}\) !== "other" && \(\s+<ProjectInfoWorkspace/);
  assert.match(view, /<SetupEditScope readOnly=\{readOnly\}>\s+<ProjectForm/);
  const departments = source("./components/setup/setup-step-departments.tsx");
  assert.match(departments, /action=\{\s+readOnly \? undefined : \(/);
  const links = source("./link-record-to-project.ts");
  assert.match(links, /if \(isSetupReadOnly\(project\)\) throw new Error\(PROJECT_SETUP_ARCHIVED_MESSAGE\);/);
});
