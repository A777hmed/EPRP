import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { subscribeToReturn } from "./use-return-refresh.ts";
import { WEIGHT_SOURCE_CHOICES } from "./working-plan.ts";
import { compactAmendmentToast } from "./amendment-toast.ts";

// Phase 13.11 — final consolidated UAT pass before owner closeout: dialog
// layout, data freshness after an amendment decision, Other-project milestone
// scope wording, and the low-risk polish items.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const PLANNING = "./components/planning/";

/* ------------------------------ Return refresh ----------------------------- */

function fakeEnvironment() {
  let visible = true;
  let listener = () => {};
  return {
    setVisible: (value) => (visible = value),
    fire: () => listener(),
    isVisible: () => visible,
    onVisibilityChange(next) {
      listener = next;
      return () => (listener = () => {});
    },
  };
}

test("return refresh: one re-read per return, none while hidden, none after unsubscribe", () => {
  const environment = fakeEnvironment();
  let clock = 0;
  let returns = 0;
  const stop = subscribeToReturn(() => returns++, { environment, now: () => clock });

  environment.fire(); // visibilitychange …
  environment.fire(); // … and window focus arrive together: counted once
  assert.equal(returns, 1);

  clock = 5_000;
  environment.setVisible(false);
  environment.fire();
  assert.equal(returns, 1, "a hidden tab makes no request");

  environment.setVisible(true);
  environment.fire();
  assert.equal(returns, 2);

  stop();
  clock = 10_000;
  environment.fire();
  assert.equal(returns, 2);
});

test("return refresh: reuses the notification foreground signal; no timer, no polling", () => {
  const hook = read("./use-return-refresh.ts");
  assert.match(hook, /from "@\/features\/notifications\/foreground-poll"/);
  assert.doesNotMatch(hook, /setInterval|setTimeout/);
});

test("freshness: governance, planning position, workspace facts and the planning panels re-read on return", () => {
  assert.match(read("./use-setup-governance.ts"), /\}, \[projectId, version, returned\]\);/);
  assert.match(read("./use-planning-position.ts"), /\}, \[projectId, reloadKey, returned\]\);/);
  assert.match(read(`${PLANNING}planning-workspace.tsx`), /\}, \[project\.id, reloadToken, view, returned\]\);/);
  for (const panel of ["master-plan-panel.tsx", "planning-data-panel.tsx", "baselines-snapshots-panel.tsx"]) {
    assert.match(read(`${PLANNING}${panel}`), /React\.useEffect\(\(\) => load\(\), \[load, returned\]\);/, panel);
  }
});

test("freshness: a decision seen on return re-reads the project and the planning approach in Project Setup", () => {
  const view = read("./components/setup/project-setup-view.tsx");
  assert.match(view, /if \(!projectId \|\| governanceState\.loadedFor !== projectId\) return;/);
  assert.match(view, /The first read for a project is its baseline, not a change\./);
  assert.match(view, /reloadProject\(\);\s*setDecisionRevision\(\(revision\) => revision \+ 1\);\s*\}, \[amendmentStates/);
  // The deciding session still reloads at once.
  assert.match(view, /onChanged=\{\(\) => \{\s*governanceState\.reload\(\);\s*reloadProject\(\);/);
  assert.match(read("./use-setup-governance.ts"), /loadedFor: projectId/);
});

/* ------------------------------- Dialog layout ----------------------------- */

test("node and activity dialogs: one column when narrow, two from sm, cells never widen past their track", () => {
  for (const file of ["activity-form-dialog.tsx", "work-item-form-dialog.tsx"]) {
    const dialog = read(`${PLANNING}${file}`);
    assert.match(dialog, /className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 \[&>\*\]:min-w-0"/, file);
    assert.doesNotMatch(dialog, /<SelectTrigger id=/, `${file}: every select fills its cell`);
  }
  const fields = read(`${PLANNING}working-plan-fields.tsx`);
  assert.doesNotMatch(fields, /<SelectTrigger id=/);
  // PSM keeps Department / System / Program & Study; Other keeps its generic Reporting unit.
  assert.match(fields, /Reporting department/);
  assert.match(fields, /<Label htmlFor=\{`\$\{idPrefix\}-unit`\}>Reporting unit<\/Label>/);
});

/* ----------------------------- Milestones (Other) -------------------------- */

test("milestones: an Other Project is not offered a department filter or department/system pickers", () => {
  const panel = read("./components/milestones/milestones-panel.tsx");
  assert.match(panel, /const departmentScoped = project\.structureFamily !== "other";/);
  assert.match(panel, /\{departmentScoped && \(\s*<Select\s+value=\{departmentFilter\}/);
  assert.match(panel, /departmentScoped=\{departmentScoped\}/);
  const form = read("./components/milestones/milestone-form-dialog.tsx");
  assert.match(form, /departmentScoped = true,/);
  assert.match(form, /\{departmentScoped \? \(\s*<>\s*<div className="grid gap-1\.5">\s*<Label htmlFor="milestone-department">/);
  assert.match(form, /<Label htmlFor="milestone-reporting-unit">Reporting unit<\/Label>/);
});

/* ----------------------------------- Polish -------------------------------- */

test("setup amendments: collapsible, counts always visible, open when a decision waits or a notification points here", () => {
  const panel = read("./components/governance/setup-amendments-panel.tsx");
  assert.match(panel, /React\.useState\(actionable\.length > 0 \|\| Boolean\(focused\)\)/);
  assert.match(panel, /Awaiting decision \(\$\{actionable\.length\}\) · My requests \(\$\{ownPending\.length\}\) · All amendments \(\$\{amendments\.length\}\)/);
  assert.match(panel, /aria-expanded=\{open\}/);
  // Collapsing hides the content but keeps the Tabs (and the chosen tab) mounted.
  assert.match(panel, /contentClassName=\{open \? undefined : "hidden"\}/);
  assert.match(panel, /<Tabs id=\{contentId\} value=\{tab\} onValueChange=\{setTab\}>/);
});

test("every amendment toast path uses the one compact toast: title, code · subject, status icon", () => {
  const planning = { fieldKey: "onboarding_mode", targetKey: "", previousValue: {}, proposedValue: {} };
  assert.deepEqual(compactAmendmentToast("approved", { projectCode: "ZZ-UAT-OTHER-GOV-01", amendment: planning }),
    { title: "Amendment approved", context: "ZZ-UAT-OTHER-GOV-01 · Planning approach updated", tone: "approved" });
  assert.deepEqual(compactAmendmentToast("rejected", { projectCode: "ZZ-UAT-OTHER-GOV-01", amendment: planning }),
    { title: "Amendment rejected", context: "ZZ-UAT-OTHER-GOV-01 · Planning approach", tone: "rejected" });
  assert.equal(compactAmendmentToast("approval_needed", { projectCode: "P", amendment: planning }).tone, "approval");
  assert.equal(compactAmendmentToast("submitted", { projectCode: "P", amendment: planning }).context, "P · Planning approach awaits approval");
  // In-page: decide / withdraw, request / amend a field, propose a structure change.
  const panel = read("./components/governance/setup-amendments-panel.tsx");
  assert.match(panel, /result\.status === "stale" \? "stale" : "approved"\)/);
  assert.match(panel, /\(\) => "rejected"\)/);
  assert.match(panel, /\(\) => "withdrawn"\)/);
  for (const file of ["setup-amendments-panel.tsx", "setup-governance-ui.tsx", "propose-structure-change-dialog.tsx"]) {
    const source = read(`./components/governance/${file}`);
    assert.match(source, /showCompactToast\(\{ title, context, tone, duration: CONFIRMATION_TOAST_DURATION_MS \}\);/, file);
    assert.doesNotMatch(source, /toast\.success\(/, file);
  }
});

test("Setup amendment card: header, prominent change, metadata, two-line reason, impact behind View details", () => {
  const panel = read("./components/governance/setup-amendments-panel.tsx");
  const order = ["{/* HEADER */}", "{/* CHANGE */}", "{/* METADATA */}", "{/* REASON */}", "{/* DECISION NOTE */}", "{/* IMPACT */}"]
    .map((marker) => panel.indexOf(marker));
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])), "bands in order");
  assert.match(panel, /<p className="font-semibold text-pretty break-words">\{proposed\}<\/p>/);
  assert.match(panel, /!detailsOpen && "line-clamp-2"/);
  assert.match(panel, /\{detailsOpen && \(\s*<div id=\{detailsId\}>/);
  assert.match(panel, /\{detailsOpen \? "Hide details" : "View details"\}/);
  assert.match(panel, /\{amendment\.decisionComment && \(/);
  // Permissions and states unchanged.
  assert.match(panel, /const canDecide = canDecideAmendment\(amendment, viewer, \{ projectArchived \}\);/);
  assert.match(panel, /You cannot approve your own request\./);
});

test("governed fields explain Request amendment vs Amend", () => {
  const ui = read("./components/governance/setup-governance-ui.tsx");
  assert.match(ui, /Governed field — even administrators require independent approval after\s+Project Setup is controlled\./);
  assert.match(ui, /<strong>Amend<\/strong> is a lighter controlled change/);
  assert.match(ui, /<SetupChangeHelp governed=\{governed\} \/>/);
  assert.match(read("./components/planning-entry.tsx"), /<SetupChangeHelp governed \/>/);
});

test("labels: weight source and the Control Account toggle", () => {
  assert.equal(WEIGHT_SOURCE_CHOICES.find((choice) => choice.value === "eprp").label, "Enter & manage weights in EPRP");
  assert.match(read(`${PLANNING}work-item-form-dialog.tsx`), />Flag this node as a Control Account</);
});

test("Planning Setup history shows the real person · role · date, time — and a reason only when recorded", () => {
  const panel = read(`${PLANNING}planning-setup-panel.tsx`);
  assert.match(panel, /change\.changedByName,\s*change\.changedByRole \? ROLE_LABELS\[change\.changedByRole\] : undefined,\s*formatDateTime\(change\.changedAt\),\s*\]\s*\.filter\(Boolean\)/);
  assert.doesNotMatch(panel, /"Project Control"/, "no invented actor");
  assert.match(panel, /\{change\.reason && \(/);
  const service = read("../../services/planning-service.ts");
  assert.match(service, /client\(\)\.from\("profiles"\)\.select\("id, full_name, role"\)\.in\("id", userIds\)/);
  assert.match(service, /client\(\)\.from\("contacts"\)\.select\("id, name"\)\.in\("id", contactIds\)/);
  assert.match(service, /const name = \(row\.changed_by_contact_id && contactName\.get\(row\.changed_by_contact_id\)\) \|\| profile\?\.full_name;/);
});

test("Master Plan table shell: one rounded frame, scrollbar lifted off the bottom border", () => {
  assert.match(read(`${PLANNING}master-plan-table.tsx`), /<div className="table-frame overflow-hidden rounded-lg border bg-card">/);
  const css = read("../../app/globals.css");
  assert.match(css, /\.table-frame \{\s*padding-bottom: 0\.375rem;\s*\}/);
  assert.match(css, /\.table-frame > \[data-slot="table-container"\]::-webkit-scrollbar-track \{\s*margin-inline: 0\.5rem;/);
});

test("copy: client approval wording; no PV/EV/SPI footer on a no-formal-schedule Master Plan", () => {
  const form = read("./components/milestones/milestone-form-dialog.tsx").replace(/\s+/g, " ");
  assert.match(form, /Whether the client has approved it is reported through a milestone update, not recorded here\./);
  assert.doesNotMatch(form, /Whether they DID/);
  assert.match(read(`${PLANNING}master-plan-panel.tsx`), /\{!noFormalSchedule && \(\s*<p className="text-xs text-muted-foreground">\s*Local weights are each item&apos;s share/);
});

test("archived Master Plan: read-only empty state, no build invitation", () => {
  const panel = read(`${PLANNING}master-plan-panel.tsx`);
  assert.match(panel, /"No Master Plan recorded"/);
  assert.match(panel, /This archived project is read-only\. Historical planning data remains visible, but no new planning items can be added\./);
});

test("no formal schedule: Imports & Review says it once; the Summary aside has no PV/EV/SPI copy", () => {
  const imports = read(`${PLANNING}planning-data-panel.tsx`);
  assert.match(imports, /\{!\(noFormalSchedule && batches\.length === 0\) && \(/);
  const workspace = read(`${PLANNING}planning-workspace.tsx`);
  const aside = workspace.slice(workspace.indexOf('aria-labelledby="how-planning-works"'));
  const noFormal = aside.slice(aside.indexOf('mode === "no_formal_schedule" ?'), aside.indexOf(") : ("));
  assert.ok(noFormal.length > 0);
  assert.doesNotMatch(noFormal, /PV|EV|SPI/);
});
