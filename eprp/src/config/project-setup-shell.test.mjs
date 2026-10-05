// Phase 2C.1b — Project Setup shell: step resolver, draft workflow, new-project
// route and sidebar items, first-save destinations.
// Run with the existing test runtime (resolves @/ and extensionless imports):
//   node --import ./src/features/notifications/test-runtime.mjs --test src/config/project-setup-shell.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateDraftWorkflow,
  evaluateProjectWorkflow,
  firstSaveHref,
  isProjectWorkflowStep,
  NEEDS_SAVED_PROJECT_MESSAGE,
  newProjectSetupNavItems,
  nextStepId,
  previousStepId,
  projectWorkflowPercent,
  projectWorkflowSteps,
  resolveSetupSteps,
  setupFlowFor,
} from "./project-workflow.ts";
import { activeProjectId, isNewProjectRoute } from "./project-sections.ts";
import { relationForSetupStep } from "../features/projects/setup-save.ts";
import {
  clearNewProjectDraft,
  getNewProjectDraft,
  getServerNewProjectDraft,
  setNewProjectDraft,
  subscribeNewProjectDraft,
} from "../features/projects/new-project-draft-store.ts";

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r", "");
const ids = (steps) => steps.map((step) => step.id);
const labels = (steps) => steps.map((step) => step.label);

/** A saved project with every step's data in place. */
function completeProject(overrides = {}) {
  return {
    id: "p1",
    code: "P-1",
    name: "Project",
    clientId: "c1",
    projectTypeId: "t1",
    currentPhaseId: "ph1",
    plannedStartDate: "2026-01-01",
    plannedFinishDate: "2026-12-31",
    projectManagerId: "pm",
    reportingCoordinatorId: "rc",
    departments: [{ departmentId: "d1", reportingRequired: true, systems: [{ id: "s1", name: "S" }] }],
    disciplines: [{ disciplineId: "x1", departmentId: "d1", systemId: "s1" }],
    team: [{ contactId: "k1", departmentId: "d1", assignmentRole: "department_manager" }],
    ...overrides,
  };
}
const DATA = { systems: [], disciplines: [], contacts: [] };

/* -------------------------------- A. Resolver ------------------------------ */

test("A. PSM resolves to the approved seven steps, with Programs & Studies", () => {
  const steps = resolveSetupSteps({ structureFamily: "psm", saved: true });
  assert.deepEqual(ids(steps), ["info", "departments", "systems", "disciplines", "contacts", "team", "review"]);
  assert.deepEqual(labels(steps), [
    "Project Type & Information",
    "Departments",
    "Systems",
    "Programs & Studies",
    "Contacts",
    "Project Team & Responsibilities",
    "Review",
  ]);
  assert.doesNotMatch(labels(steps).join("|"), /\bDisciplines\b/);
  // Unsaved PSM: same steps.
  assert.deepEqual(ids(resolveSetupSteps({ structureFamily: "psm", saved: false })), ids(steps));
});

test("A. legacy (saved, unclassified) is exactly today's seven steps", () => {
  const steps = resolveSetupSteps({ saved: true });
  assert.equal(setupFlowFor({ saved: true }), "legacy");
  assert.deepEqual(
    steps.map(({ id, label, description }) => ({ id, label, description })),
    projectWorkflowSteps.map(({ id, label, description }) => ({ id, label, description }))
  );
  assert.deepEqual(labels(steps), [
    "Project Info", "Departments", "Systems", "Disciplines", "Contacts", "Project Team Summary", "Review",
  ]);
  // Same statuses whether or not the steps are passed explicitly.
  const project = completeProject();
  assert.deepEqual(
    evaluateProjectWorkflow(project, DATA),
    evaluateProjectWorkflow(project, DATA, undefined, undefined, steps)
  );
});

test("A. legacy evaluation behaves as before: same checks, gating and percent", () => {
  const project = completeProject();
  const statuses = evaluateProjectWorkflow(project, DATA, (id) => `Dept ${id}`);
  assert.deepEqual(ids(statuses), ids(projectWorkflowSteps));
  assert.ok(statuses.every((status) => status.complete && status.unlocked && status.available));
  assert.equal(projectWorkflowPercent(statuses), 100);
  assert.equal(statuses[6].checks[0].label, "Project Info complete");

  // An incomplete Departments step locks every later step, as before.
  const blocked = evaluateProjectWorkflow({ ...project, departments: [] }, DATA);
  assert.equal(blocked[1].complete, false);
  for (const status of blocked.slice(2)) {
    assert.equal(status.unlocked, false);
    assert.equal(status.blockedBy, "departments");
    assert.equal(status.lockReason, "earlier-step");
  }
});

test("A. Other resolves to one workable Project Structure step — never the generic one", () => {
  const steps = resolveSetupSteps({ structureFamily: "other", saved: true });
  assert.deepEqual(ids(steps), ["info", "structure", "contacts", "team", "review"]);
  assert.deepEqual(labels(steps), [
    "Project Type & Information", "Project Structure", "Contacts", "Project Team & Responsibilities", "Review",
  ]);
  for (const generic of ["departments", "systems", "disciplines"]) assert.ok(!ids(steps).includes(generic));
  // 2C.1c-c: the step is real now — workable, not a "next phase" placeholder.
  assert.notEqual(steps[1].available, false);

  // Evaluated with no structure loaded: incomplete (not an error), and it
  // gates the rest. Detailed completion rules: structure-workflow.test.mjs.
  const statuses = evaluateProjectWorkflow(completeProject({ structureFamily: "other" }), DATA);
  assert.deepEqual(ids(statuses), ids(steps));
  assert.equal(statuses[0].complete, true);
  assert.equal(statuses[1].available, true);
  assert.equal(statuses[1].lockReason, undefined);
  assert.equal(statuses[1].complete, false);
  assert.deepEqual(statuses[1].missing, ["Project structure loaded"]);
  assert.equal(statuses[2].unlocked, false);
  assert.equal(statuses[2].blockedBy, "structure");
  // Other contacts are never measured by the PSM/legacy department checks.
  assert.ok(!statuses[2].checks.some((check) => /department/i.test(check.label)));
});

test("A. a new project with no type chosen shows step 1 only", () => {
  assert.equal(setupFlowFor({ saved: false }), "unclassified");
  assert.deepEqual(ids(resolveSetupSteps({ saved: false })), ["info"]);
  assert.deepEqual(ids(resolveSetupSteps({ structureFamily: "", saved: false })), ["info"]);
});

test("A. groups reserve slots for Project Parties and Organization Chart", () => {
  for (const family of ["psm", "other"]) {
    const steps = resolveSetupSteps({ structureFamily: family, saved: true });
    const groups = steps.map((step) => step.group);
    assert.equal(groups[0], "identity");
    assert.equal(groups.at(-1), "confirm");
    // Project Team & Responsibilities sits in the "people" group, after structure.
    const team = steps.findIndex((step) => step.id === "team");
    assert.equal(steps[team].group, "people");
    assert.ok(groups.indexOf("structure") < team);
  }
});

test("A. step navigation follows the resolved flow; every routable id is valid", () => {
  const other = resolveSetupSteps({ structureFamily: "other", saved: true });
  assert.equal(nextStepId("info", other), "structure");
  assert.equal(nextStepId("structure", other), "contacts");
  assert.equal(previousStepId("contacts", other), "structure");
  assert.equal(nextStepId("systems", other), undefined);
  // Default list is still the legacy one (existing callers unchanged).
  assert.equal(nextStepId("info"), "departments");
  for (const id of ["info", "structure", "departments", "systems", "disciplines", "contacts", "team", "review"]) {
    assert.ok(isProjectWorkflowStep(id), id);
  }
  assert.equal(isProjectWorkflowStep("nope"), false);
  // The structure step owns no Project Setup relation: its writes go through
  // the structure service, never the setup save.
  assert.equal(relationForSetupStep("structure"), null);
});

/* ------------------------------ B. Draft workflow -------------------------- */

test("B. an unsaved project: step 1 live from form values; later steps locked, no counts", () => {
  const steps = resolveSetupSteps({ structureFamily: "psm", saved: false });
  const empty = evaluateDraftWorkflow({ structureFamily: "psm" }, steps);
  assert.equal(empty[0].unlocked, true);
  assert.equal(empty[0].lockReason, undefined);
  assert.equal(empty[0].complete, false);
  assert.ok(empty[0].total > 0);
  for (const status of empty.slice(1)) {
    assert.equal(status.unlocked, false);
    assert.equal(status.lockReason, "unsaved");
    assert.equal(status.total, 0);
    assert.equal(status.passedCount, 0);
    assert.deepEqual(status.checks, []);
  }
  // Filling step 1 completes it; later steps still wait for the save.
  const filled = evaluateDraftWorkflow(completeProject({ structureFamily: "psm" }), steps);
  assert.equal(filled[0].complete, true);
  assert.ok(filled.slice(1).every((status) => status.lockReason === "unsaved" && !status.unlocked));
  // Overall: only step 1 has anything measurable before the first save.
  assert.equal(projectWorkflowPercent(filled), 100);
  assert.equal(NEEDS_SAVED_PROJECT_MESSAGE, "Available after first save");
});

test("B. an Other draft locks its Project Structure step until the first save", () => {
  const steps = resolveSetupSteps({ structureFamily: "other", saved: false });
  const statuses = evaluateDraftWorkflow({ structureFamily: "other" }, steps);
  assert.equal(statuses[1].id, "structure");
  assert.equal(statuses[1].available, true);
  assert.equal(statuses[1].unlocked, false);
  assert.equal(statuses[1].lockReason, "unsaved");
});

/* --------------------------- C. Route and sidebar -------------------------- */

test("C. /projects/new is detected separately; activeProjectId is unchanged", () => {
  assert.equal(isNewProjectRoute("/projects/new"), true);
  assert.equal(isNewProjectRoute("/projects/new/"), true);
  assert.equal(isNewProjectRoute("/projects/abc"), false);
  assert.equal(isNewProjectRoute("/projects"), false);
  assert.equal(activeProjectId("/projects/new"), undefined);
  assert.equal(activeProjectId("/projects/abc"), "abc");
  assert.equal(activeProjectId("/projects/abc/setup/departments"), "abc");
  assert.equal(activeProjectId("/projects"), undefined);
});

test("C. the draft sidebar never links to a saved-project route", () => {
  for (const family of [undefined, "psm", "other"]) {
    const items = newProjectSetupNavItems(family);
    assert.equal(items[0].id, "info");
    assert.equal(items[0].href, "/projects/new");
    assert.equal(items[0].active, true);
    for (const item of items.slice(1)) {
      assert.equal(item.href, undefined, item.id);
      assert.equal(item.active, false);
      assert.equal(item.disabledReason, "Available after first save");
    }
    assert.ok(items.every((item) => !item.href || item.href === "/projects/new"));
  }
  assert.deepEqual(ids(newProjectSetupNavItems("psm")), ids(resolveSetupSteps({ structureFamily: "psm", saved: false })));
  assert.deepEqual(ids(newProjectSetupNavItems("other")), ["info", "structure", "contacts", "team", "review"]);
});

test("C. the sidebar shell shows the setup column on /projects/new without a project id", () => {
  const sidebar = source("../components/layout/project-context-sidebar.tsx");
  assert.match(sidebar, /if \(!projectId && !isNewProjectRoute\(pathname\)\) return null;/);
  const nav = source("../components/layout/project-nav-group.tsx");
  assert.match(nav, /if \(!projectId && isNewProjectRoute\(pathname\)\) \{\s+return \(\s+<NewProjectSetupNav/);
  const draftNav = nav.slice(nav.indexOf("export function NewProjectSetupNav("), nav.indexOf("export function ProjectContextNav("));
  assert.match(draftNav, /newProjectSetupNavItems\(draft\.structureFamily\)/);
  // No saved-project sections or hrefs are built in the draft navigation.
  assert.doesNotMatch(draftNav, /projectSectionHref|projectWorkflowHref|activeProjectId/);
  assert.match(nav, /New Project/);
  assert.match(nav, /Not saved yet/);
  // The rail and mobile sheet treat /projects/new as inside a project too.
  const rail = source("../components/layout/app-sidebar.tsx");
  assert.match(rail, /Boolean\(activeProjectId\(pathname\)\) \|\| isNewProjectRoute\(pathname\)/);
  assert.match(rail, /isMobile && \(projectId \|\| isNewProjectRoute\(pathname\)\) &&/);
});

test("C. the draft store publishes the chosen type and clears", () => {
  let calls = 0;
  const unsubscribe = subscribeNewProjectDraft(() => calls++);
  assert.deepEqual(getServerNewProjectDraft(), {});
  setNewProjectDraft({ structureFamily: "psm" });
  assert.equal(getNewProjectDraft().structureFamily, "psm");
  setNewProjectDraft({ structureFamily: "psm" }); // unchanged: no notification
  setNewProjectDraft({ structureFamily: "other" });
  clearNewProjectDraft();
  assert.deepEqual(getNewProjectDraft(), {});
  assert.equal(calls, 3);
  unsubscribe();
  setNewProjectDraft({ structureFamily: "psm" });
  assert.equal(calls, 3);
  clearNewProjectDraft();
  // The form publishes only for a new project, and clears on unmount.
  const form = source("../features/projects/components/project-form.tsx");
  assert.match(form, /if \(!isNewProject\) return;\s+setNewProjectDraft\(\{ structureFamily: structureFamily \|\| undefined \}\);/);
  assert.match(form, /return \(\) => clearNewProjectDraft\(\);/);
});

/* -------------------------- D. First-save transition ----------------------- */

test("D. first save lands on the flow's next step (Create) or step 1 (Save Draft)", () => {
  assert.equal(firstSaveHref("p1", "psm", "create"), "/projects/p1/setup/departments");
  assert.equal(firstSaveHref("p1", "other", "create"), "/projects/p1/setup/structure");
  assert.equal(firstSaveHref("p1", "psm", "draft"), "/projects/p1/setup/info");
  assert.equal(firstSaveHref("p1", "other", "draft"), "/projects/p1/setup/info");
});

test("D. creation replaces /projects/new in history — no push back to an empty form", () => {
  const view = source("../features/projects/components/setup/project-setup-view.tsx");
  assert.match(view, /router\.replace\(firstSaveHref\(created\.id, values\.structureFamily, "create"\)\);/);
  assert.match(view, /router\.replace\(firstSaveHref\(created\.id, values\.structureFamily, "draft"\)\);/);
  assert.doesNotMatch(view, /router\.push\([^)]*created\.id/);
  // The saved info step continues to this project's own next step.
  assert.match(view, /router\.push\(projectWorkflowHref\(project\.id, next \?\? "info"\)\);/);
  const formView = source("../features/projects/components/project-form-view.tsx");
  assert.match(formView, /router\.replace\(`\/projects\/\$\{created\.id\}`\);/);
  assert.doesNotMatch(formView, /router\.push\(`\/projects\/\$\{created\.id\}`\)/);
});

test("D. the new-project tracker is shown with the form and on the Project Type screen", () => {
  const view = source("../features/projects/components/setup/project-setup-view.tsx");
  assert.match(view, /\(values\) => <DraftWorkflowNav draft=\{formValuesToProjectInput\(values\)\} \/>/);
  assert.doesNotMatch(view, /Step \$\{index \+ 1\} of/);
  const form = source("../features/projects/components/project-form.tsx");
  const classify = form.slice(form.indexOf('if (classificationPhase === "classify") {'), form.indexOf("const classificationState"));
  assert.match(classify, /\{renderHeader\?\.\(watchedValues\)\}/);
  assert.match(form, /<form onSubmit=\{handleSubmit\(onValid, onInvalid\)\} noValidate className="space-y-6">\s+\{renderHeader\?\.\(watchedValues\)\}/);
});
