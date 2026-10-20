import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// Phase 13.9A — Planning Experience Foundation (docs/02 §26.20.1, §26.23).
// Pure presentation rules (planning-experience.ts) plus SOURCE CONTRACTS for
// the sidebar, the Planning Workspace, Project Setup, Project Progress and the
// guided onboarding question. UI / IA only: no migration, no new storage.

const {
  ONBOARDING_CHOICES,
  EXTERNAL_SCHEDULE_CHOICES,
  showLegacyPerformanceBadge,
  pendingPlanningOutcome,
  PLANNING_WORKSPACE_VIEWS,
  externalScheduleGuidance,
  nextReadinessStep,
  planningGovernanceOf,
  planningReadinessSteps,
  planningViewHref,
  resolvePlanningView,
  setupStateOf,
  snapshotFigures,
} = await import("./planning-experience.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
/** Source without comments, so a contract is about what renders, not what is explained. */
const code = (path) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------ Guided question --------------------------- */

test("the guided question maps onto the three EXISTING onboarding values, in order", () => {
  assert.deepEqual(
    ONBOARDING_CHOICES.map((choice) => [choice.label, choice.value]),
    [
      ["Start planning in EPRP", "new_project"],
      ["Project is already running", "existing_active_project"],
      ["No formal schedule", "no_formal_schedule"],
    ]
  );
  for (const choice of ONBOARDING_CHOICES) assert.ok(choice.description.length > 20, choice.value);
  // The values match the database CHECK constraint exactly.
  const migration = readFileSync(
    new URL("../../../supabase/migrations/20260913000001_planning_foundation.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /onboarding_mode in \('new_project', 'existing_active_project', 'no_formal_schedule'\)/);
});

test("external-schedule answers are guidance only and route to the approved sections", () => {
  assert.deepEqual(EXTERNAL_SCHEDULE_CHOICES.map((c) => c.value), ["p6", "excel", "not-yet", "build-in-eprp"]);
  assert.equal(externalScheduleGuidance("p6").view, "imports");
  assert.equal(externalScheduleGuidance("excel").view, "imports");
  assert.equal(externalScheduleGuidance("not-yet").view, "baselines");
  assert.equal(externalScheduleGuidance("build-in-eprp").view, "master-plan");
});

test("the external-schedule answer is never persisted", () => {
  const entry = source("./components/planning-entry.tsx");
  const question = entry.slice(entry.indexOf("function ExternalScheduleQuestion("));
  assert.match(question, /React\.useState<ExternalScheduleAnswer \| null>/);
  assert.doesNotMatch(entry, /upsertSettings|defaultImportSource|default_import_source|planningService/);
  // The form still saves only the onboarding mode, exactly as before.
  const form = source("./components/project-form.tsx");
  assert.match(form, /await planningService\.upsertSettings\(\{ projectId, onboardingMode \}\);/);
  assert.doesNotMatch(form, /defaultImportSource/);
});

test("Show advanced edits the same onboarding value, never a copy", () => {
  const entry = source("./components/planning-entry.tsx");
  assert.equal((entry.match(/onChange\(choice\.value\)/g) ?? []).length, 1);
  assert.match(entry, /onValueChange=\{\(next\) => onChange\(next as PlanningOnboardingMode\)\}/);
  assert.doesNotMatch(entry, /useState<PlanningOnboardingMode>/);
});

/* ----------------------------- Workspace sections ------------------------- */

test("the Planning Workspace has exactly four URL-addressable sections", () => {
  assert.deepEqual(
    PLANNING_WORKSPACE_VIEWS.map((view) => view.label),
    ["Summary", "Master Plan", "Imports & Review", "Baselines & Snapshots"]
  );
  assert.equal(resolvePlanningView(null), "summary");
  assert.equal(resolvePlanningView("imports"), "imports");
  assert.equal(resolvePlanningView("planning-data"), "imports"); // old bookmark
  assert.equal(resolvePlanningView("overview"), "summary");
  assert.equal(resolvePlanningView("milestones"), "summary"); // removed tab
  assert.equal(resolvePlanningView("performance"), "summary"); // removed tab
  assert.equal(planningViewHref("p1", "summary"), "/projects/p1/planning");
  assert.equal(planningViewHref("p1", "baselines"), "/projects/p1/planning?view=baselines");
});

test("the workspace drops the Milestones / Performance tabs and the stat cards", () => {
  const workspace = source("./components/planning/planning-workspace.tsx");
  assert.doesNotMatch(workspace, /value="milestones"|value="performance"|Performance &amp; Variance|StatCard/);
  assert.doesNotMatch(workspace, /Planning Data/);
  assert.match(workspace, /variant="line"/);
  assert.match(workspace, /url\.searchParams\.set\("view", next\)/);
  // 13.9 archived notice unchanged.
  assert.match(workspace, /isPlanningControlReadOnly\(project\) && <ArchivedPlanningNotice \/>/);
  // No invented baseline or unpublished-change values in the header strip.
  assert.doesNotMatch(workspace, /BL0|BLn|unpublished/i);
});

/* ---------------------------------- Readiness ---------------------------- */

const facts = (overrides = {}) => ({
  onboardingMode: "new_project",
  onboardingSaved: true,
  hasPlanData: false,
  hasOpeningDraft: false,
  hasPublishedSnapshot: false,
  ...overrides,
});
const states = (steps) => steps.map((step) => `${step.id}:${step.state}`);

test("new project readiness: onboarding → plan → publish, from existing data only", () => {
  assert.deepEqual(states(planningReadinessSteps(facts())), ["onboarding:done", "plan:next", "publish:pending"]);
  assert.deepEqual(states(planningReadinessSteps(facts({ hasPlanData: true }))), ["onboarding:done", "plan:done", "publish:next"]);
  const done = planningReadinessSteps(facts({ hasPlanData: true, hasPublishedSnapshot: true }));
  assert.deepEqual(states(done), ["onboarding:done", "plan:done", "publish:done"]);
  assert.equal(nextReadinessStep(done), undefined);
  assert.deepEqual(states(planningReadinessSteps(facts({ onboardingSaved: false }))), ["onboarding:next", "plan:pending", "publish:pending"]);
});

test("already-running readiness: Opening Position, then Snapshot V1; the schedule is optional", () => {
  const start = planningReadinessSteps(facts({ onboardingMode: "existing_active_project" }));
  assert.deepEqual(states(start), ["onboarding:done", "opening:next", "publish:pending", "plan:pending"]);
  assert.equal(start.find((s) => s.id === "opening").target, "baselines");
  assert.equal(start.find((s) => s.id === "plan").optional, true);
  const promoted = planningReadinessSteps(facts({ onboardingMode: "existing_active_project", hasPublishedSnapshot: true }));
  assert.deepEqual(states(promoted), ["onboarding:done", "opening:done", "publish:done", "plan:pending"]);
  assert.equal(nextReadinessStep(promoted), undefined); // optional step never becomes "next"
});

test("no-formal-schedule readiness asks nothing beyond the choice itself", () => {
  assert.deepEqual(states(planningReadinessSteps(facts({ onboardingMode: "no_formal_schedule" }))), ["onboarding:done"]);
});

test("future-slice questions are not part of the 13.9A checklist", () => {
  const ids = new Set(
    ["new_project", "existing_active_project", "no_formal_schedule"].flatMap((mode) =>
      planningReadinessSteps(facts({ onboardingMode: mode })).map((step) => step.id)
    )
  );
  assert.deepEqual([...ids].sort(), ["onboarding", "opening", "plan", "publish"]);
  const titles = ["new_project", "existing_active_project", "no_formal_schedule"]
    .flatMap((mode) => planningReadinessSteps(facts({ onboardingMode: mode })))
    .map((step) => step.title)
    .join(" | ");
  assert.doesNotMatch(titles, /weight|earning|manpower|resource|look-ahead|baseline/i);
});

/* --------------------------- Governance and setup state ------------------- */

test("governance: a snapshot governs; otherwise awaiting, or not governed for no formal schedule", () => {
  assert.equal(planningGovernanceOf("new_project", true), "governed");
  assert.equal(planningGovernanceOf("no_formal_schedule", true), "governed");
  assert.equal(planningGovernanceOf("new_project", false), "awaiting-snapshot");
  assert.equal(planningGovernanceOf("existing_active_project", false), "awaiting-snapshot");
  assert.equal(planningGovernanceOf("no_formal_schedule", false), "not-governed");
});

test("setup state is derived and presentational: Draft → Ready → Controlled", () => {
  assert.equal(setupStateOf({ setupComplete: false, hasPublishedSnapshot: false }), "draft");
  assert.equal(setupStateOf({ setupComplete: true, hasPublishedSnapshot: false }), "ready");
  assert.equal(setupStateOf({ setupComplete: true, hasPublishedSnapshot: true }), "controlled");
  // 13.9A locked nothing; 13.9B now enforces control, derived by the database
  // (first snapshot or finalisation) and shown as such.
  const entry = source("./components/planning-entry.tsx");
  assert.doesNotMatch(entry, /Setup field control is not enforced yet/);
  assert.match(entry, /Controlled since \{formatDate\(controlledSince\)\}/);
});

/* ------------------------------- Snapshot figures ------------------------- */

test("snapshot figures are displayed, never computed; absence is a dash; Opening SPI is N/A", () => {
  assert.deepEqual(
    snapshotFigures({ plannedProgress: 40, actualProgress: 37.26, variance: -2.74, spi: 0.9312, isOpeningSnapshot: false }),
    { planned: "40%", earned: "37.3%", variance: "-2.7 pts", spi: "0.93" }
  );
  assert.deepEqual(
    snapshotFigures({ plannedProgress: null, actualProgress: null, variance: null, spi: null, isOpeningSnapshot: false }),
    { planned: "—", earned: "—", variance: "—", spi: "N/A" }
  );
  assert.equal(
    snapshotFigures({ plannedProgress: 50, actualProgress: 45, variance: -5, spi: 0.9, isOpeningSnapshot: true }).spi,
    "N/A"
  );
  assert.equal(
    snapshotFigures({ plannedProgress: 10, actualProgress: 12, variance: 2, spi: 1.2, isOpeningSnapshot: false }).variance,
    "+2 pts"
  );
});

/* ------------------------------ Sidebar contract -------------------------- */

test("the project sidebar shows Planning Workspace and the approved grouping", () => {
  const nav = source("../../components/layout/project-nav-group.tsx");
  assert.match(nav, /planning: "Planning & Control"/);
  for (const id of ["kpis", "milestones", "deliverables"]) assert.match(nav, new RegExp(`${id}: "Planning & Control"`));
  for (const id of ["departments", "systems", "disciplines"]) assert.match(nav, new RegExp(`${id}: "Project Structure"`));
  assert.match(nav, /contacts: "Setup"/); // kept reachable, not Project Structure
  assert.match(nav, /const GROUP_ORDER = \[\s+"Setup",\s+"Planning & Control",\s+"Reporting",\s+"Project Structure",\s+"Records",\s+\]/);
  assert.doesNotMatch(nav, /Master \/ Reference Data/);
  const sections = source("../../config/project-sections.ts");
  assert.match(sections, /id: "planning",\s+label: "Planning Workspace"/);
});

/* --------------------------- Project Setup contract ----------------------- */

test("Project Setup has the nine approved sections and no Priority or performance cards", () => {
  const form = code("./components/project-form.tsx");
  const titles = [...form.matchAll(/title="(\d)\. ([^"]+)"/g)].map((m) => `${m[1]}. ${m[2]}`);
  assert.deepEqual(titles, [
    "1. Basic Information & Classification",
    "2. Contract & Reference Dates",
    "3. Project Responsibility",
    "4. Project Lifecycle",
    "5. Planning Entry",
    "6. Reporting Configuration",
    "7. Contact & Location",
    "8. Scope & Structure",
    "9. Branding & Report Settings",
  ]);
  assert.doesNotMatch(form, /name="priority"|Status &amp; Progress|Status & Progress"|GovernedPerformancePanel/);
  assert.match(form, /name="currentPhaseId" label="Project Lifecycle Phase"/);
  // Portfolio / Reporting Group sits in section 1.
  const section1 = form.slice(form.indexOf('title="1. '), form.indexOf('title="2. '));
  assert.match(section1, /name="portfolioGroupId"/);
  // The stored Priority still round-trips unchanged through the form values.
  const schema = source("./schemas/project-form.ts");
  assert.match(schema, /priority: project\.priority,/);
  assert.match(schema, /priority: values\.priority,/);
});

test("Opening Position actions live only in Baselines & Snapshots", () => {
  const files = readdirSync(new URL("./components/", import.meta.url), { recursive: true })
    .filter((name) => String(name).endsWith(".tsx"))
    .map((name) => String(name).replaceAll("\\", "/"));
  const writers = files.filter((name) =>
    /openingPositionId:|<OpeningPositionDialog/.test(source(`./components/${name}`))
  );
  assert.deepEqual(writers, ["planning/baselines-snapshots-panel.tsx"]);
});

test("no Priority badge remains on the project header", () => {
  assert.doesNotMatch(source("./components/project-summary-header.tsx"), /PriorityBadge|project\.priority/);
});

/* -------------------------- Project Progress contract --------------------- */

test("Project Progress is read-only and never reads typed project progress", () => {
  const view = code("./components/progress/project-progress-view.tsx");
  assert.doesNotMatch(view, /project\.plannedProgress|project\.actualProgress|projectSpi|\/edit/);
  assert.doesNotMatch(view, /Update progress|Update Reported Progress/);
  // 13.9B: the not-governed state is the Reported Progress panel, which owns
  // the label and the one write action (never on a governed project).
  assert.match(view, /<ReportedProgressPanel/);
  const panel = code("./components/progress/reported-progress-panel.tsx");
  assert.match(panel, /\{REPORTED_PROGRESS_LABEL\}/);
  assert.doesNotMatch(panel, /project\.plannedProgress|project\.actualProgress|projectSpi/);
  assert.match(view, /Awaiting first Published Planning Snapshot/);
  const section = code("./components/sections/project-section-view.tsx");
  assert.doesNotMatch(section, /Update progress|projectSpi|ProgressComparison/);
  assert.match(section, /<ProjectProgressView project=\{project\} position=\{position\} \/>/);
  // The Overview page no longer shows typed progress or a percent-ratio SPI.
  const details = source("./components/project-details-view.tsx");
  assert.doesNotMatch(details, /projectSpi|ProgressComparison|formatVariance/);
});

/* ------------------- Hardening: no silent loss of setup edits ------------- */

test("an unsaved guided answer counts as unsaved Project Setup work", () => {
  const form = code("./components/project-form.tsx");
  assert.match(form, /const onboardingUnsaved = onboardingMode !== savedOnboardingMode;/);
  assert.match(form, /const hasUnsavedWork = formState\.isDirty \|\| masterTouched \|\| onboardingUnsaved;/);
  // The stored baseline moves only on load and after a successful save.
  assert.match(form, /setOnboardingMode\(settings\.onboardingMode\);\s+setSavedOnboardingMode\(settings\.onboardingMode\);/);
  assert.match(form, /const stored = await planningService\.upsertSettings\(\{ projectId, onboardingMode \}\);\s+setSavedOnboardingMode\(stored\.onboardingMode\);/);
  // Planning Entry is told about every kind of unsaved work.
  assert.match(form, /unsavedChanges=\{hasUnsavedWork\}\s+onboardingUnsaved=\{onboardingUnsaved\}/);
});

test("Planning Entry links never navigate away silently while the form is dirty", () => {
  const entry = code("./components/planning-entry.tsx");
  // One capture handler over the whole section covers every 13.9A link:
  // Open Planning Workspace, the guidance links, the next setup step and
  // the Planning Status links.
  assert.match(entry, /<div className="space-y-5" onClickCapture=\{guardNavigation\}>/);
  const guard = entry.slice(entry.indexOf("const guardNavigation"), entry.indexOf("return (", entry.indexOf("const guardNavigation")));
  assert.match(guard, /if \(!unsavedChanges\) return;/);
  assert.match(guard, /event\.preventDefault\(\);\s+event\.stopPropagation\(\);\s+setPendingHref\(href\);/);
  // New-tab clicks keep this page (and its edits) and pass through.
  assert.match(guard, /event\.button !== 0 \|\| event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey/);
  // The existing design-system ConfirmDialog decides; "Leave" is the explicit choice.
  assert.match(entry, /<ConfirmDialog\s+open=\{pendingHref !== null\}/);
  assert.match(entry, /title="Leave without saving\?"/);
  assert.match(entry, /if \(href\) router\.push\(href\);/);
  // The unsaved state is visible, never implied saved.
  assert.match(entry, /\{onboardingUnsaved && <StatusBadge tone="warning">Not saved yet<\/StatusBadge>\}/);
  assert.match(entry, /Project Setup has unsaved changes\./);
});

test("a new, unsaved project is not asked a planning question it would not keep", () => {
  const entry = code("./components/planning-entry.tsx");
  assert.match(entry, /const questionLocked = readOnly \|\| !project;/);
  assert.match(entry, /<fieldset disabled=\{questionLocked\}/);
  assert.match(entry, /Available after the project's first save/);
});

/* ------------------------- UAT corrections (13.9A) ------------------------ */

test("the legacy overallStatus badge never contradicts a governed planning state", () => {
  assert.equal(showLegacyPerformanceBadge("awaiting-snapshot"), false);
  assert.equal(showLegacyPerformanceBadge("governed"), false);
  assert.equal(showLegacyPerformanceBadge(undefined), false); // still loading: show nothing
  assert.equal(showLegacyPerformanceBadge("not-governed"), true);
  const header = code("./components/project-summary-header.tsx");
  assert.match(header, /<ProjectStatusBadge status=\{project\.status\} \/>/); // lifecycle badge kept
  assert.match(header, /\{showLegacyPerformanceBadge\(governance\) && \(\s+<OverallStatusBadge status=\{project\.overallStatus\} \/>\s+\)\}/);
  // One planning read, shared with the Planning Status strip.
  assert.match(header, /<PlanningStatus projectId=\{project\.id\} position=\{position\}/);
});

test("the active workspace tab carries an unclipped accent underline, no pill fill", () => {
  const workspace = code("./components/planning/planning-workspace.tsx");
  assert.match(workspace, /group-data-horizontal\/tabs:after:bottom-0 group-data-horizontal\/tabs:after:h-\[3px\]/);
  assert.match(workspace, /after:bg-primary/);
  assert.match(workspace, /data-active:font-semibold data-active:text-primary dark:data-active:text-primary/);
  assert.doesNotMatch(workspace, /data-active:bg-(?!transparent)/);
});

test("the Summary side note is short and secondary", () => {
  const workspace = code("./components/planning/planning-workspace.tsx");
  const aside = workspace.slice(workspace.indexOf("<aside"), workspace.indexOf("</aside>"));
  assert.match(aside, /How Planning works/);
  assert.equal((aside.match(/<li>/g) ?? []).length, 3);
  assert.match(aside, /Published Planning Snapshot is the governed source/);
  assert.match(aside, /calculated — never typed in/);
  assert.match(aside, /Master Plan, Imports &amp; Review and Baselines &amp; Snapshots/);
  // A light supporting container: border token, card radius, near-transparent
  // tint — never the old filled, shadowed card.
  assert.match(aside, /className="self-start rounded-xl border bg-muted\/10 p-3 text-xs text-muted-foreground lg:p-4"/);
  assert.doesNotMatch(aside, /shadow|bg-card|bg-muted\/(?!10)/);
});

test("Planning Entry has one Planning Workspace CTA; the status links only to Project Progress", () => {
  const status = code("./components/planning/planning-status.tsx");
  // The no-snapshot workspace link is optional and off in Planning Entry.
  assert.match(status, /workspaceLink = true,/);
  assert.match(status, /\{workspaceLink && \(\s+<Link\s+href=\{projectSectionHref\(projectId, "planning"\)\}/);
  assert.match(status, /View Project Progress/);
  const entry = code("./components/planning-entry.tsx");
  assert.match(entry, /<PlanningStatus\s+projectId=\{projectId\}\s+position=\{projectId \? position : undefined\}\s+workspaceLink=\{false\}\s+\/>/);
  assert.equal((entry.match(/Open Planning Workspace/g) ?? []).length, 1);
});

test("Project Progress pending states: honest S-curve empty state, one exceptions note, legacy wording", () => {
  const view = code("./components/progress/project-progress-view.tsx");
  // S-curve: no future series legend, swatches or chart frame — an empty state.
  assert.match(view, /S-Curve not available yet/);
  assert.match(view, /Original Baseline, Current\s+Baseline, Forecast and Earned curves automatically once governed\s+time-phased planning data is available/);
  assert.doesNotMatch(view, /CURVE_SERIES|swatch|BL0 — original baseline/);
  // Exceptions: one section-level explanation, a subtle per-row marker.
  assert.equal((view.match(/calculated by the Planning Engine from\s+governed schedule data/g) ?? []).length, 1);
  assert.doesNotMatch(view, /Calculated once the Planning Engine is live/);
  assert.match(view, /<PendingEngineMarker \/>/);
  for (const row of ["Late activities", "Overdue activities", "Forecast finish vs BL0 / BLn", "Key milestone exposure"]) {
    assert.match(view, new RegExp(row.replace("/", "\\/")));
  }
  // Legacy wording, with its explanation; schedule condition still not derived.
  for (const file of ["./components/progress/project-progress-view.tsx", "./components/planning/planning-status.tsx"]) {
    const text = code(file);
    assert.match(text, />Legacy snapshot</);
    assert.doesNotMatch(text, /Legacy calculation/);
    assert.match(text, /Published before the governed Planning Engine calculation model\./);
  }
  assert.match(view, /label="Snapshot coverage"/);
  assert.match(view, /label="Schedule condition"[\s\S]*?Not derived yet/);
});

test("an unsaved onboarding choice shows its pending outcome, not the stale saved status", () => {
  assert.equal(pendingPlanningOutcome("no_formal_schedule", false), "Reported — not planning governed");
  assert.match(pendingPlanningOutcome("new_project", false), /awaiting its first Published Planning Snapshot/);
  assert.match(pendingPlanningOutcome("existing_active_project", false), /Opening Position as Snapshot V1/);
  // A published snapshot keeps governing whatever the choice.
  assert.equal(pendingPlanningOutcome("no_formal_schedule", true), "Still governed by its Published Planning Snapshot");
  const entry = code("./components/planning-entry.tsx");
  assert.match(entry, /\{onboardingUnsaved && projectId \? \(/);
  assert.match(entry, /Pending save/);
  assert.match(entry, /After saving, this project will be:/);
  // Presentational: no new write, and the saved status component is untouched.
  assert.doesNotMatch(entry, /planningService|upsertSettings/);
  assert.doesNotMatch(code("./components/planning/planning-status.tsx"), /Pending save|pendingPlanningOutcome/);
});

test("UAT bug: Save Draft and Save both persist the onboarding mode and clear the pending state", () => {
  const form = code("./components/project-form.tsx");
  const draft = form.slice(form.indexOf("const performSaveDraft"), form.indexOf("const resolveFirstSave"));
  // Save Draft now writes it — after the project row saved, before "Draft saved".
  assert.match(draft, /await onSaveDraft\(values\);[\s\S]*await persistOnboardingMode\(\);\s+toast\.success\("Draft saved"\);/);
  const submit = form.slice(form.indexOf("const performSubmit"), form.indexOf("const onValid"));
  assert.match(submit, /await onSubmit\(values\);[\s\S]*await persistOnboardingMode\(\);/);
  // One writer; success moves the stored baseline (clears "Not saved yet" and Pending Save).
  const persist = form.slice(form.indexOf("const persistOnboardingMode"), form.indexOf("const onValid"));
  assert.match(persist, /const stored = await planningService\.upsertSettings\(\{ projectId, onboardingMode \}\);\s+setSavedOnboardingMode\(stored\.onboardingMode\);/);
  assert.equal((form.match(/planningService\.upsertSettings\(/g) ?? []).length, 1);
  // The saved Planning Status re-reads when the stored value changes.
  assert.match(form, /savedValue=\{savedOnboardingMode\}/);
  assert.match(code("./components/planning-entry.tsx"), /usePlanningPosition\(projectId, savedValue\)/);
  assert.match(code("./use-planning-position.ts"), /\}, \[projectId, reloadKey\]\);/);
});

test("no-formal-schedule wording: no snapshot implied; Weekly/Monthly never own reported progress", () => {
  const section = code("./components/sections/project-section-view.tsx");
  assert.match(section, /usePlanningPosition\(section === "kpis" \? projectId : undefined\)/);
  assert.match(section, /"Project progress is reported without a governed Planning Snapshot\."/);
  assert.match(section, /description=\{description\}/);
  const view = code("./components/progress/project-progress-view.tsx");
  // 13.9B delivered the workflow the 13.9A placeholder announced.
  assert.doesNotMatch(view, /available in EPRP yet/);
  assert.doesNotMatch(view, /progress is described in the project&apos;s Weekly and Monthly/);
  assert.doesNotMatch(view, /Update Reported Progress/);
  const panel = code("./components/progress/reported-progress-panel.tsx");
  assert.match(panel, /\{REPORTED_PROGRESS_LABEL\}/);
  assert.match(panel, /<PlanningFact label="SPI" value=\{REPORTED_PROGRESS_SPI\}/);
  assert.match(panel, /Weekly and Monthly reports do not own this figure\./);
});

test("archived Summary is planning history, never an actionable readiness workflow", () => {
  const workspace = code("./components/planning/planning-workspace.tsx");
  assert.match(workspace, /\{archived \? \(\s+<ArchivedPlanningHistory onOpen=\{selectView\} \/>\s+\) : \(\s+<PlanningSummary/);
  const history = workspace.slice(workspace.indexOf("function ArchivedPlanningHistory("), workspace.indexOf("const STEP_ICON"));
  assert.match(history, /Planning history/);
  assert.match(history, /This project is archived\. Its Working Plan, imports, baselines and\s+Published Planning Snapshots remain available for historical reference\./);
  // Read-only navigation only: no readiness steps, no next step, no setup link.
  assert.match(history, /View \{view\.label\}/);
  assert.doesNotMatch(history, /planningReadinessSteps|NextStepAction|projectWorkflowHref|Decide how|bring this project under/);
  assert.deepEqual(
    PLANNING_WORKSPACE_VIEWS.filter((view) => view.id !== "summary").map((view) => view.label),
    ["Master Plan", "Imports & Review", "Baselines & Snapshots"]
  );
  // The 13.9 banner and the archive-aware panels are unchanged.
  assert.match(workspace, /isPlanningControlReadOnly\(project\) && <ArchivedPlanningNotice \/>/);
  assert.match(code("./components/sections/project-section-view.tsx"), /canManage=\{authority\.canManageOperations\}/);
  assert.match(code("./use-project-authority.ts"), /canManageOperations: !archived && holdsOperations/);
});

test("the header shows a planning approach only when one is stored", () => {
  const workspace = code("./components/planning/planning-workspace.tsx");
  assert.match(workspace, /facts\.settings \? \(\s+onboardingChoice\(facts\.settings\.onboardingMode\)\.label\s+\) : \(\s+<span className="font-normal text-muted-foreground">Not chosen yet<\/span>/);
  // ...which matches the readiness rule: the onboarding step is done only when stored.
  assert.equal(planningReadinessSteps(facts({ onboardingSaved: false }))[0].state, "next");
  assert.equal(planningReadinessSteps(facts({ onboardingSaved: true }))[0].state, "done");
});

/* ---------------------- Tablet (768–1023px) hardening ---------------------- */

test("inside a project at tablet width the global rail collapses (existing collapse, reused)", () => {
  const hook = code("../../components/layout/use-compact-viewport.ts");
  assert.match(hook, /COMPACT_VIEWPORT_QUERY = "\(min-width: 768px\) and \(max-width: 1023\.98px\)"/);
  const rail = code("../../components/layout/app-sidebar.tsx");
  assert.match(rail, /const compact = useCompactViewport\(\);/);
  assert.match(rail, /const category = !insideProject \? "global" : compact \? "project-compact" : "project";/);
  assert.match(rail, /if \(previousRef\.current === category\) return;\s+previousRef\.current = category;\s+setOpen\(category === "global"\);/);
  // The project column uses the very same band definition.
  const project = code("../../components/layout/project-context-sidebar.tsx");
  assert.match(project, /import \{ useCompactViewport \} from "\.\/use-compact-viewport";/);
  assert.doesNotMatch(project, /window\.matchMedia\(/);
});

test("the workspace tab row scrolls in one row with edge fades, never wraps", () => {
  const workspace = code("./components/planning/planning-workspace.tsx");
  assert.match(workspace, /<ScrollableTabRow activeKey=\{view\}>/);
  const row = workspace.slice(workspace.indexOf("function ScrollableTabRow("), workspace.indexOf("function WorkspaceHeaderStrip("));
  assert.match(row, /overflow-x-auto/);
  assert.match(row, /bg-linear-to-r from-card/);
  assert.match(row, /bg-linear-to-l from-card/);
  assert.match(row, /edges\.right \? "opacity-100" : "opacity-0"/);
  assert.match(row, /new ResizeObserver\(measure\)/);
  assert.match(row, /el\.scrollTo\(/); // keeps the active tab in view, horizontally only
  assert.doesNotMatch(row, /scrollIntoView|flex-wrap/);
  assert.doesNotMatch(workspace, /<TabsList[^>]*flex-wrap/);
});

test("13.9A adds no migration", () => {
  const names = readdirSync(new URL("../../../supabase/migrations/", import.meta.url));
  // Every migration after 13.9 belongs to a later slice (13.9B onwards), never to 13.9A.
  const LATER = ["20261016090000_project_setup_governance_core.sql",
    "20261017090000_project_setup_finalise_reported_progress.sql",
    "20261018090000_project_setup_relation_history.sql",
    "20261019090000_project_setup_structure_governance.sql",
    "20261020090000_project_setup_amendment_notifications.sql",
    // 13.9B UAT: notification Clear history (a 13.9B migration, not 13.9A).
    "20261021090000_notification_history_clear.sql"];
  assert.ok(names.every((name) => name <= "20261014090000_planning_control_archived_read_only.sql" || LATER.includes(name)),
    "no 13.9A migration after 13.9");
});
