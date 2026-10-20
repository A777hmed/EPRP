import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B — Step 3: services + Project Setup governance UI + Reported
// Progress UI + History. SOURCE / PRESENTATION CONTRACTS. The database is
// authoritative; these prove what the screens OFFER and how they hand off to
// the service. Runtime behaviour: scripts/p0-validation/123–125.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const amendments = await import("./setup-amendments.ts");
const progress = await import("./reported-progress.ts");
const history = await import("./setup-history.ts");
const { SETUP_FIELD_REGISTRY } = await import("./setup-governance.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
const migration = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8").replaceAll("\r", "");

const FORM = "./components/project-form.tsx";
const SETUP_VIEW = "./components/setup/project-setup-view.tsx";
const UI = "./components/governance/setup-governance-ui.tsx";
const PANEL = "./components/governance/setup-amendments-panel.tsx";
const ENTRY = "./components/planning-entry.tsx";
const BASELINES = "./components/planning/baselines-snapshots-panel.tsx";
const RP_PANEL = "./components/progress/reported-progress-panel.tsx";
const PROGRESS = "./components/progress/project-progress-view.tsx";
const CLASSIFICATION = "./components/project-classification.tsx";

const amendment = (extra = {}) => ({
  id: "a1", projectId: "p", fieldKey: "code", amendmentClass: "governed", previousValue: { code: "A" },
  proposedValue: { code: "B" }, reason: "r", impactCode: "REPORT_IDENTITY", impactWarning: "w",
  requestedBy: "u-requester", requestedByName: "Requester", requestedAt: "2026-10-17T08:00:00Z", status: "pending",
  decidedBy: null, decidedByName: null, decidedAt: null, decisionComment: null, ...extra,
});
const PCA = { profileId: "u-pca", isGlobalAuthority: true };
const REQUESTER_SA = { profileId: "u-requester", isGlobalAuthority: true };
const ASSIGNED = { profileId: "u-assigned", isGlobalAuthority: false };

/* -------------------------- Controlled vs not ----------------------------- */

test("before Controlled every field is editable, exactly as before 13.9B", () => {
  for (const entry of SETUP_FIELD_REGISTRY) {
    assert.equal(amendments.fieldPresentation(entry.fieldKey, false), "editable", entry.fieldKey);
  }
});

test("once Controlled, presentation follows the field class", () => {
  assert.equal(amendments.fieldPresentation("description", true), "editable"); // free / logged
  assert.equal(amendments.fieldPresentation("status", true), "editable");
  assert.equal(amendments.fieldPresentation("name", true), "amend"); // lightweight
  assert.equal(amendments.fieldPresentation("actual_start_date", true), "amend");
  assert.equal(amendments.fieldPresentation("code", true), "request"); // governed
  assert.equal(amendments.fieldPresentation("forecast_finish_date", true), "request");
  assert.equal(amendments.fieldPresentation("onboarding_mode", true), "request");
  assert.equal(amendments.fieldPresentation("structure_family", true), "correction");
  assert.equal(amendments.fieldPresentation("priority", true), "retired");
  assert.equal(amendments.presentationForClass("superseded"), "request");
  assert.equal(amendments.presentationForClass("planning_owned"), "request");
});

test("every lightweight / governed field the Setup form edits is wrapped, so Save can never carry a change to it", () => {
  const form = source(FORM);
  for (const [key, ui] of Object.entries(amendments.SETUP_FIELD_UI)) {
    if (ui.formFields.length === 0) continue;
    assert.ok(form.includes(`<GovernedField fieldKey="${key}">`), `${key} is not governed in the form`);
  }
  // Inert control inside a disabled fieldset — the value stays legible.
  assert.match(source(UI), /<fieldset disabled className="m-0 min-w-0 border-0 p-0/);
  // The onboarding mode is never upserted by the ordinary save once Controlled.
  assert.match(form, /if \(!projectId \|\| governance\?\.controlled\) return;/);
  // The Planning Entry question is read-only once Controlled.
  assert.match(form, /readOnly=\{isSetupReadOnly\(project\) \|\| Boolean\(governance\?\.controlled\)\}/);
});

test("the Setup page holds the form until the control state is known, and fails closed on an error", () => {
  const view = source(SETUP_VIEW);
  assert.match(view, /governanceState\.status === "loading"/);
  assert.match(view, /governanceState\.status === "error"/);
  assert.match(view, /Project Setup control could not be checked/);
  assert.match(view, /<ControlledSetupBanner/);
  assert.match(source(UI), /Project Setup is controlled\./);
  assert.match(source(UI), /Core configuration changes require an amendment\./);
  // Amend only for the Project Setup authority, never on an archived project.
  assert.match(view, /canAmend: canManage && !readOnly/);
});

/* ---------------------------- amendment paths ----------------------------- */

test("amendable fields and the proposed value in its stored form", () => {
  assert.equal(amendments.amendableField("description"), undefined); // free: edit directly
  assert.equal(amendments.amendableField("priority"), undefined); // retired
  assert.equal(amendments.amendableField("structure_family"), undefined); // SA correction only
  assert.equal(amendments.amendableField("name").entry.fieldClass, "lightweight");
  assert.equal(amendments.amendableField("currency").entry.fieldClass, "governed");
  assert.deepEqual(amendments.proposedColumnValue("short_name", { short_name: "  " }), { short_name: null });
  assert.deepEqual(amendments.proposedColumnValue("monthly_cutoff_day", { monthly_cutoff_day: "20" }), { monthly_cutoff_day: 20 });
  assert.deepEqual(
    amendments.proposedColumnValue("project_category", { project_type_id: "c1", project_category_detail: "x" }, { categoryAllowsCustomName: () => false }),
    { project_type_id: "c1", project_category_detail: null });
  assert.equal(amendments.sameColumnValue({ a: 1, b: null }, { b: null, a: 1 }), true);
  assert.equal(amendments.sameColumnValue({ a: 1 }, { a: 2 }), false);
});

test("the Amend dialog reads the current value on open, sends it back as the base, and states the class", () => {
  const ui = source(UI);
  assert.match(ui, /setupGovernanceService\s*\.getFieldValue\(projectId, fieldKey\)/);
  assert.match(ui, /expectedValue: current,/);
  for (const text of ["Applies immediately", "Requires approval", "You cannot approve your own request.",
    "Submit for approval", "Apply amendment", "Impact"]) {
    assert.ok(ui.includes(text), text);
  }
  // A lightweight amendment is adopted as the form's saved value at once.
  assert.match(source(FORM), /if \(!updated \|\| amendment\.status !== "applied"\) return;/);
  assert.match(source(FORM), /form\.resetField\(key, \{ defaultValue: fresh\[key\] as never \}\)/);
});

test("value wording never shows null, undefined or a raw id", () => {
  const lookups = { clientName: (id) => (id === "c1" ? "SOPC" : undefined), formatDate: (iso) => `D(${iso})` };
  assert.equal(amendments.formatSetupValue("contract_number", { contract_number: null }), "Not set");
  assert.equal(amendments.formatSetupValue("weekly_enabled", { weekly_enabled: false }), "Disabled");
  assert.equal(amendments.formatSetupValue("client_id", { client_id: "c1" }, lookups), "SOPC");
  assert.equal(amendments.formatSetupValue("client_id", { client_id: "zz" }, lookups), "Selected client");
  assert.equal(amendments.formatSetupValue("planned_start_date", { planned_start_date: "2026-01-01" }, lookups), "D(2026-01-01)");
  assert.equal(amendments.formatSetupValue("onboarding_mode", { onboarding_mode: "no_formal_schedule" }) !== "no_formal_schedule", true);
  assert.equal(amendments.formatSetupValue("code", null), "Not set");
});

/* --------------------- approvals: self, stale, frozen ---------------------- */

test("self-approval is never offered, for any role; a different global authority may decide", () => {
  const open = { projectArchived: false };
  assert.equal(amendments.canDecideAmendment(amendment(), REQUESTER_SA, open), false);
  assert.equal(amendments.canDecideAmendment(amendment(), PCA, open), true);
  assert.equal(amendments.canDecideAmendment(amendment(), ASSIGNED, open), false);
  assert.equal(amendments.canDecideAmendment(amendment(), { profileId: "", isGlobalAuthority: true }, open), false);
  assert.equal(amendments.canWithdrawAmendment(amendment(), { profileId: "u-requester", isGlobalAuthority: false }, open), true);
  assert.equal(amendments.canWithdrawAmendment(amendment(), ASSIGNED, open), false);
  // UAT fix: an approver who is not the requester is never offered Withdraw (they Approve or Reject).
  assert.equal(amendments.canWithdrawAmendment(amendment(), PCA, open), false);
  const panel = source(PANEL);
  assert.match(panel, /canDecideAmendment\(amendment, viewer, \{ projectArchived \}\)/);
  assert.match(panel, /You cannot approve your own request\./);
});

test("pending / stale / frozen states and the archived exclusion", () => {
  const archived = { projectArchived: true };
  assert.equal(amendments.amendmentDisplayStatus(amendment(), archived), "frozen");
  assert.equal(amendments.AMENDMENT_STATUS_LABEL.frozen, "Frozen — project archived");
  assert.equal(amendments.amendmentDisplayStatus(amendment({ status: "stale" }), archived), "stale");
  assert.equal(amendments.amendmentDisplayStatus(amendment(), { projectArchived: false }), "pending");
  assert.equal(amendments.canDecideAmendment(amendment(), PCA, archived), false);
  assert.equal(amendments.canWithdrawAmendment(amendment(), REQUESTER_SA, archived), false);
  const pending = amendments.pendingAmendmentsByField([amendment(), amendment({ id: "a2", fieldKey: "name", status: "applied" })]);
  assert.deepEqual([...pending.keys()], ["code"]);
  const panel = source(PANEL);
  assert.match(panel, /The value changed after this request — nothing was applied\./);
  // The cross-project queue never lists an archived project's request or the viewer's own.
  const service = source("../../services/setup-governance-service.ts");
  assert.match(service, /\.neq\("requested_by", viewerProfileId\)/);
  assert.match(service, /\.filter\(\(row\) => row\.projects\.status !== "archived"\)/);
});

test("database refusals reach the user as the sentence the database wrote", () => {
  const service = source("../../services/setup-governance-service.ts");
  assert.match(service, /const tagged = \/\^\\\[\[A-Z_\]\+\\\]\\s\*\(\[\\s\\S\]\+\)\$\//);
  assert.match(service, /known: databaseSentence\(error\),/);
});

/* ------------------------- first-anchor confirmation ----------------------- */

test("the first governed anchor needs the explicit confirmation; later snapshots do not; no_formal offers neither", () => {
  const panel = source(BASELINES);
  assert.ok(panel.includes(
    '"Publishing the first governed Planning Snapshot will make Project Setup Controlled. " +\n  "Core Project Setup configuration will require amendments afterward."'));
  assert.match(panel, /confirmSetupControl: firstAnchor && anchorConfirmed,/);
  assert.match(panel, /\(firstAnchor && !anchorConfirmed\) \|\|/);
  assert.match(panel, /firstAnchor \? setPromoteConfirmOpen\(true\) : void promoteOpening\(false\)/);
  assert.match(panel, /onConfirm=\{\(\) => promoteOpening\(true\)\}/);
  assert.match(panel, /canManage && !needsOpening && !noFormalSchedule/);
  assert.doesNotMatch(panel, /confirmSetupControl: true/);
});

/* ------------------------------- Finalise UI ------------------------------- */

test("Finalise is offered only for an authorised, not-Controlled no_formal_schedule project, with the owner's wording", () => {
  const entry = source(ENTRY);
  assert.match(entry, /Boolean\(finalise\?\.canFinalise\) && !controlledSince && savedMode === "no_formal_schedule"/);
  assert.match(entry, /Complete the setup steps to finalise\./);
  assert.doesNotMatch(entry, /Setup field control is not enforced yet/);
  const dialog = source("./components/governance/finalise-setup-dialog.tsx");
  assert.ok(dialog.includes("This project does not use a formal governed schedule. Finalising locks core Setup configuration under"));
  assert.ok(dialog.includes("amendment control. It does not create a Planning Snapshot or SPI."));
  assert.match(dialog, /disabled=\{!confirmed \|\| saving\}/);
  assert.match(source(SETUP_VIEW), /canFinalise: canManage && !readOnly/);
  assert.doesNotMatch(dialog, /unfinali[sz]e|reopen|revert/i);
});

/* ---------------------------- Reported Progress ---------------------------- */

const entry = (id, dataDate, entryKind = "report", supersedesEntryId = null, extra = {}) => ({
  id, projectId: "p", dataDate, entryKind, supersedesEntryId, reportedPlannedPercent: null,
  reportedActualPercent: entryKind === "withdrawal" ? null : 10, narrative: "n", reason: null,
  isBackdated: false, source: "eprp_entry", recordedBy: "u", recordedByName: "U", recordedAt: `${dataDate}T09:00:00Z`, ...extra,
});

test("chains per Data Date, current-head actions and a final withdrawal", () => {
  const E1 = entry("E1", "2026-10-01"), C1 = entry("C1", "2026-10-01", "correction", "E1"),
    E2 = entry("E2", "2026-10-05"), W2 = entry("W2", "2026-10-05", "withdrawal", "E2");
  const all = [E1, C1, E2, W2];
  const chains = progress.reportedProgressChains(all);
  assert.deepEqual(chains.map((c) => [c.dataDate, c.entries.map((e) => e.id), c.withdrawn]),
    [["2026-10-05", ["E2", "W2"], true], ["2026-10-01", ["E1", "C1"], false]]);
  assert.equal(progress.canActOnEntry(C1, all), true);
  assert.equal(progress.canActOnEntry(E1, all), false); // superseded
  assert.equal(progress.canActOnEntry(W2, all), false); // a withdrawal is final
  assert.equal(progress.latestValidDataDate(all), "2026-10-01");
  assert.equal(progress.isBackdatedDate("2026-09-20", all), true);
  assert.equal(progress.isBackdatedDate("2026-10-03", all), false);
  assert.equal(progress.reportedProgressChainFor(all, "2026-10-05").withdrawn, true);
});

test("Reported Progress UI: authority, writability, SPI N/A and the actions on the current head only", () => {
  const panel = source(RP_PANEL);
  assert.match(panel, /const canWrite = writable && authority\.resolved && authority\.canManageOperations;/);
  assert.match(panel, /isReportedProgressWritable\(\{/);
  assert.match(panel, /canWrite && canActOnEntry\(chain\.head, entries\)/);
  assert.match(panel, /<PlanningFact label="SPI" value=\{REPORTED_PROGRESS_SPI\}/);
  assert.match(panel, /\{REPORTED_PROGRESS_LABEL\}/);
  assert.match(panel, /Update Reported Progress/);
  // Future dates are refused in the project's time zone; back-dating asks for a reason.
  assert.match(panel, /max=\{today\}/);
  assert.match(panel, /Back-dated — earlier than the latest report of/);
  assert.match(panel, /This Data Date was withdrawn and is closed\. It cannot be reported again\./);
  // Withdrawal: a destructive, explained, final confirmation with a mandatory reason.
  assert.match(panel, /A withdrawal is final: it cannot be corrected or withdrawn again/);
  assert.match(panel, /confirmLabel="Withdraw entry"\s+destructive/);
  // Project Progress uses the real stream for not-governed projects; the placeholder is gone.
  const view = source(PROGRESS);
  assert.match(view, /<ReportedProgressPanel\s+project=\{project\}\s+onboardingMode=\{mode\}/);
  assert.doesNotMatch(view, /Not recorded in EPRP yet/);
  assert.match(view, /hasPublishedSnapshot=\{false\} frozen \/>/);
});

/* ------------------------ legacy classification UI ------------------------- */

test("legacy classification: System Administrator only, Controlled only, through the correction path (never an amendment)", () => {
  const view = source(SETUP_VIEW);
  assert.match(view, /Boolean\(savedBaseline\) && !savedBaseline\?\.structureFamily && controlled && identity\.isAdmin && !readOnly/);
  assert.match(view, /onClassifyLegacy=\{legacyBootstrap \? handleCorrectProjectType : undefined\}/);
  assert.match(view, /!readOnly && !controlled \? handleClassify : undefined/);
  const bar = source(CLASSIFICATION);
  assert.match(bar, /state === "legacy" && !onClassify && onClassifyLegacy &&/);
  assert.match(bar, /Classify legacy project/);
  assert.match(bar, /mode = "correct"/);
  assert.match(source(FORM), /mode="legacy"/);
  assert.doesNotMatch(code(CLASSIFICATION), /requestAmendment|project_setup_amendments/);
});

/* --------------------- Contacts / Sites / Parties history ------------------ */

test("Contacts, Sites and Parties changes are recorded and appear in Project History", () => {
  const sql = migration("20261018090000_project_setup_relation_history.sql");
  for (const table of ["project_contacts", "project_sites", "project_parties"]) {
    assert.match(sql, new RegExp(`create trigger log_project_setup_relation_change\\s+after insert or update or delete on public\\.${table}`));
  }
  assert.match(sql, /create unique index project_setup_relation_changes_one_per_tx/);
  assert.equal(history.relationSummary("sites", { name: "Site A", country: "Egypt", city: "Cairo", is_primary: true }), "Site A (Egypt, Cairo) · primary");
  assert.equal(history.relationSummary("contacts", { contact_name: "Ali", role: "team_member", functional_title: "Inspector" }), "Ali — Inspector");
  assert.equal(history.relationSummary("parties", null), "—");
});

/* ------------------------------ History feed ------------------------------- */

test("the History feed is composed from the structured records only, newest first", () => {
  const wording = { value: (key, value) => (value ? JSON.stringify(value) : "Not set"), classification: (e, side) => (side === "old" ? (e.oldFamily ?? "Not classified") : e.newFamily), date: (iso) => iso };
  const events = history.composeSetupHistory({
    fieldChanges: [{ id: "f1", projectId: "p", fieldKey: "city", previousValue: { city: "A" }, newValue: { city: "B" }, changedBy: "u", changedByName: "U", changedAt: "2026-10-17T01:00:00Z" }],
    relationChanges: [{ id: "r1", projectId: "p", relation: "sites", action: "removed", previousValue: { name: "S" }, newValue: null, changedBy: "u", changedByName: null, changedAt: "2026-10-17T02:00:00Z" }],
    amendments: [
      amendment({ status: "stale", decidedAt: "2026-10-17T04:00:00Z", requestedAt: "2026-10-17T03:00:00Z" }),
      amendment({ id: "a3", fieldKey: "name", amendmentClass: "lightweight", status: "applied", requestedAt: "2026-10-17T05:00:00Z" }),
    ],
    corrections: [{ id: "c1", projectId: "p", newFamily: "psm", correctionKind: "legacy_bootstrap", reason: "rollout", correctedAt: "2026-10-17T06:00:00Z" }],
    finalisation: { id: "fin", projectId: "p", finalisedAt: "2026-10-17T07:00:00Z", finalisedByName: "X", note: null },
    reportedProgress: [entry("E9", "2026-10-10", "withdrawal", "E8", { reason: "wrong", recordedAt: "2026-10-17T08:00:00Z" })],
  }, wording);
  assert.deepEqual(events.map((event) => event.category),
    ["reported_progress", "finalisation", "classification", "amendment", "amendment", "amendment", "setup", "setup"]);
  assert.match(events[0].title, /withdrawn for 2026-10-10 — final/);
  assert.equal(events[2].title, "Legacy project classified");
  assert.equal(events[2].previous, "Not classified");
  assert.match(events[4].title, /recorded stale/);
  assert.equal(events[4].actor, "EPRP (stale check)");
  assert.equal(events[6].title, "Site removed");
  const component = source("./components/governance/setup-governance-history.tsx");
  for (const call of ["listFieldChanges", "listRelationChanges", "listProjectAmendments", "listClassificationCorrections",
    "getControlState", "listReportedProgress"]) {
    assert.ok(component.includes(call), call);
  }
  assert.match(source("./components/sections/project-section-view.tsx"), /<SetupGovernanceHistory project=\{project\} \/>/);
});

test("approvers see a cross-project queue that links to the project's Setup (no separate app)", () => {
  const queue = source("../dashboard/components/setup-amendment-queue.tsx");
  assert.match(queue, /identity\.resolved && identity\.isGlobalAuthority && Boolean\(identity\.profileId\)/);
  // 13.9B Step 4: a structure request opens the step that shows its target.
  assert.match(queue, /projectWorkflowHref\(\s*project\.id,[\s\S]*?structureAmendmentStep\(amendment\.fieldKey\)\) \|\| "info"\s*\)/);
  assert.match(source("../dashboard/dashboard-view.tsx"), /<SetupAmendmentQueue \/>/);
  assert.match(source("../auth/use-current-identity.ts"), /profileId: userId,/);
});

test("readiness gate: the button needs Ready (every required step complete); the database deliberately does not re-evaluate it (B15)", () => {
  const entry = source(ENTRY);
  // Ready = every setup step except Review is complete; only then is the button a button.
  assert.match(entry, /const required = workflow\.statuses\.filter\(\(status\) => status\.id !== "review"\);/);
  assert.match(entry, /setupStateOf\(\{ setupComplete: outstanding\.length === 0, hasPublishedSnapshot \}\)/);
  assert.match(entry, /\{state === "ready" \? \(\s*<Button type="button" size="sm" onClick=\{\(\) => setFinaliseOpen\(true\)\}>\s*Finalise Project Setup/);
  assert.match(entry, /Complete the setup steps to finalise\./);
  // The database enforces authority, confirmation, archived, uniqueness (B15, closed 2026-10-16) — not readiness.
  const finalise = migration("20261017090000_project_setup_finalise_reported_progress.sql");
  const body = finalise.slice(finalise.indexOf("function public.finalise_project_setup("));
  assert.match(body, /\[NOT_AUTHORIZED\]/);
  assert.match(body, /\[FINALISE_CONFIRMATION_REQUIRED\]/);
  assert.match(body, /\[PROJECT_ARCHIVED\]/);
  assert.match(body, /\[SETUP_ALREADY_FINALISED\]/);
  assert.doesNotMatch(body.slice(0, body.indexOf("$fn$;") > 0 ? body.indexOf("$fn$;") : 4000), /current_phase_id|project_manager_id|reporting_coordinator_id|structure_levels/);
});
