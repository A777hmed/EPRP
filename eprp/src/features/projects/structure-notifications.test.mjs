import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B — structure governance notifications are the SAME notification
// contract as field amendments: one trigger, one table, one composer, one
// toast. This proves the composition (bell item + toast + deep link) for EVERY
// governed structure action; scripts/p0-validation/128 proves, on the database,
// who is notified and when, for the same actions.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const notify = await import("./setup-amendment-notifications.ts");
const model = await import("../notifications/model.ts");
const feed = await import("../notifications/toast-feed.ts");
const structure = await import("./structure-amendments.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const project = { id: PROJECT_ID, code: "MDP-PSAIM-01", name: "Pump Station" };
const IMPACT = "Changes the reporting structure. Approved reports keep the structure they were approved with.";
const AMENDMENT_ID = "22222222-2222-4222-8222-222222222222";

const structureAmendment = (fieldKey, previousValue, proposedValue, over = {}) => ({
  id: AMENDMENT_ID, projectId: PROJECT_ID, fieldKey, targetKey: "target:1", amendmentClass: "governed",
  previousValue, proposedValue, reason: "Browser UAT – governed structure test", impactCode: "STRUCTURE_SCOPE", impactWarning: IMPACT,
  requestedBy: "x", requestedByName: "UAT Project Control Admin", requestedAt: "2026-10-18T19:10:00Z", status: "pending",
  decidedBy: null, decidedByName: null, decidedAt: null, decisionComment: null, ...over,
});
const compose = (eventType, amendment, over = {}) => notify.composeAmendmentNotification({
  row: { id: "33333333-3333-4333-8333-333333333333", eventType, projectId: PROJECT_ID, sourceId: AMENDMENT_ID, actorName: null,
         createdAt: "2026-10-18T19:10:00Z", readAt: null, ...over },
  amendment, project, lookups: {}, formatDateTime: (iso) => `@${iso.slice(0, 16)}`,
});

// One representative request per governed structure action (the shape the database stores).
const CASES = [
  // PSM — Departments
  { name: "add department", key: "structure_departments", previous: { assignment: null },
    proposed: { action: "add_department", department_id: "d1", system_ids: [], reporting_required: true, labels: { target: "Civil", systems: [] } },
    title: "Add department · Civil", from: "Not in the project", to: "No systems · reports" },
  { name: "remove department", key: "structure_departments", previous: { assignment: { reporting_required: true } },
    proposed: { action: "remove_department", department_id: "d1", labels: { target: "HSE", current_systems: ["Crude Distillation Unit"], current_reporting_required: true } },
    title: "Remove department · HSE", from: "Crude Distillation Unit · reports", to: "Removed from the project" },
  { name: "change a department's systems", key: "structure_departments", previous: { assignment: { reporting_required: true } },
    proposed: { action: "set_department_scope", department_id: "d1", system_ids: ["s1", "s2"], reporting_required: false,
                labels: { target: "Process", systems: ["CDU", "Tank Farm"], current_systems: ["CDU"], current_reporting_required: true } },
    title: "Change department scope · Process", from: "CDU · reports", to: "CDU, Tank Farm · does not report" },
  // PSM — Programs & Studies
  { name: "add a Program & Study", key: "structure_disciplines", previous: { assignment: null },
    proposed: { action: "add_discipline", discipline_id: "p1", department_id: "d1", system_id: "s1", labels: { target: "Corrosion Study", department: "Process", system: "CDU" } },
    title: "Add Program & Study · Corrosion Study", from: "Not in the project", to: "Process · CDU" },
  { name: "move a Program & Study", key: "structure_disciplines", previous: { assignment: { department_id: "d1" } },
    proposed: { action: "move_discipline", discipline_id: "p1", department_id: "d1", system_id: "s2",
                labels: { target: "Corrosion Study", department: "Process", system: "Tank Farm", current_department: "Process", current_system: "CDU" } },
    title: "Move Program & Study · Corrosion Study", from: "Process · CDU", to: "Process · Tank Farm" },
  { name: "remove a Program & Study", key: "structure_disciplines", previous: { assignment: { department_id: "d1" } },
    proposed: { action: "remove_discipline", discipline_id: "p1", labels: { target: "Corrosion Study", current_department: "Process", current_system: "CDU" } },
    title: "Remove Program & Study · Corrosion Study", from: "Process · CDU", to: "Removed from the project" },
  // Other project — units
  { name: "add a unit", key: "structure_units", previous: { parent: { name: "Area 1" } },
    proposed: { action: "add", level_number: 2, parent_id: "a1", name: "Pipe Rack", code: "WP1", weekly_reporting_required: true, monthly_reporting_required: false,
                labels: { target: "Pipe Rack", level: "Work Package", parent: "Area 1" } },
    title: "Add Work Package · Pipe Rack", from: "Not in the structure", to: "Pipe Rack (WP1) under Area 1 · Weekly input" },
  { name: "rename a unit", key: "structure_units", previous: { unit: { name: "U1", code: null } },
    proposed: { action: "rename", unit_id: "u1", name: "Unit One", code: "U-1", labels: { target: "U1", level: "Unit" } },
    title: "Rename Unit · U1", from: "U1", to: "Unit One (U-1)" },
  { name: "move a unit", key: "structure_units", previous: { unit: { name: "U2" } },
    proposed: { action: "move", unit_id: "u2", parent_id: "a2", labels: { target: "U2", level: "Unit", current_parent: "A1", parent: "A2" } },
    title: "Move Unit · U2", from: "Under A1", to: "Under A2" },
  { name: "archive a unit", key: "structure_units", previous: { unit: { name: "U3" } },
    proposed: { action: "archive", unit_id: "u3", labels: { target: "U3", level: "Unit" } },
    title: "Archive Unit · U3", from: "Active", to: "Archived (owes no reporting input)" },
  { name: "restore a unit", key: "structure_units", previous: { unit: { name: "U3" } },
    proposed: { action: "restore", unit_id: "u3", labels: { target: "U3", level: "Unit" } },
    title: "Restore Unit · U3", from: "Archived", to: "Active" },
  { name: "change a unit's reporting input", key: "structure_units",
    previous: { unit: { name: "A1", weekly_reporting_required: false, monthly_reporting_required: false } },
    proposed: { action: "set_reporting_scope", unit_id: "a1", weekly_reporting_required: true, monthly_reporting_required: true, labels: { target: "A1", level: "Area" } },
    title: "Change reporting input · A1", from: "No reporting input", to: "Weekly and Monthly input" },
  // Other project — levels
  { name: "add a level", key: "structure_levels", previous: { level_count: 2 },
    proposed: { action: "add_level", level_number: 3, singular_label: "Package", plural_label: "Packages", labels: { target: "Package" } },
    title: "Add level 3 · Package", from: "2 levels", to: "New deepest level: Package / Packages" },
  { name: "rename a level", key: "structure_levels", previous: { level: { singular_label: "Unit", plural_label: "Units" } },
    proposed: { action: "rename_level", level_number: 2, singular_label: "Work Package", plural_label: "Work Packages", labels: { target: "Unit" } },
    title: "Rename level 2 · Unit", from: "Unit / Units", to: "Work Package / Work Packages" },
  { name: "remove a level", key: "structure_levels", previous: { level: { singular_label: "Package", plural_label: "Packages" } },
    proposed: { action: "remove_level", level_number: 3, labels: { target: "Package" } },
    title: "Remove level 3 · Package", from: "Package / Packages", to: "Removed (it has no units)" },
];

// The one-line request: actions whose title does not say the result add "→ result".
const WITH_RESULT = new Set(["rename", "move", "set_reporting_scope", "rename_level", "set_department_scope", "move_discipline"]);
const requestLine = (entry) => (WITH_RESULT.has(entry.proposed.action) ? `${entry.title} → ${entry.to}` : entry.title);
const rows = (item) => Object.fromEntries(item.details.map((detail) => [detail.label, detail.value]));
const labels = (item) => item.details.map((detail) => detail.label);

/* --------------------------------- submit ---------------------------------- */

test("every governed structure action composes an actionable, structured approver notification", () => {
  assert.equal(CASES.length, 15);
  for (const entry of CASES) {
    const amendment = structureAmendment(entry.key, entry.previous, entry.proposed);
    const item = compose("amendment_submitted", amendment);
    const label = entry.name;
    assert.equal(item.title, "Approval required", label);
    assert.equal(item.category, "approvals", label);
    // One structured card: requester, request, project, time, reason. No impact text in the card.
    assert.deepEqual(labels(item), ["Requested by", "Request", "Project", "Requested", "Reason"], label);
    assert.deepEqual(rows(item), {
      "Requested by": "UAT Project Control Admin",
      Request: requestLine(entry),
      Project: "MDP-PSAIM-01 · Pump Station",
      Requested: "@2026-10-18T19:10",
      Reason: "Browser UAT – governed structure test",
    }, label);
    assert.ok(!JSON.stringify(item).includes(IMPACT), `${label}: the impact text stays on the deep-linked request`);
    assert.doesNotMatch(JSON.stringify(item.details) + item.description, /null|undefined|\[object|unit_id|department_id/, label);
    // The toast: title, what was requested, who and which project. No raw ids.
    assert.deepEqual(item.toast, {
      title: "Approval required",
      description: `${notify.clipToastLine(requestLine(entry))}\nRequested by UAT Project Control Admin · Pump Station`,
      actionLabel: "View request",
    }, label);
  }
});

test("the deep link targets the exact pending request", () => {
  const item = compose("amendment_submitted", structureAmendment(CASES[0].key, CASES[0].previous, CASES[0].proposed));
  assert.deepEqual(item.target, { type: "setup_amendment", id: AMENDMENT_ID, projectId: PROJECT_ID });
  assert.equal(model.notificationHref(item.target), `/projects/${PROJECT_ID}/setup/info?amendment=${AMENDMENT_ID}`);
  // The destination lists structure requests beside field amendments, highlights this one and opens Awaiting decision.
  const panel = code("./components/governance/setup-amendments-panel.tsx");
  assert.match(panel, /amendmentWording\(amendment,/);
  assert.match(panel, /focused\s*\?\s*actionable\.some\(\(amendment\) => amendment\.id === focused\.id\) \? "approvals" : "all"/);
  assert.match(code("./components/setup/project-setup-view.tsx"), /focusAmendmentId=\{focusAmendmentId\}/);
});

/* -------------------------------- decisions -------------------------------- */

test("approved: the requester is told what was applied, by whom and when", () => {
  for (const entry of CASES) {
    const amendment = structureAmendment(entry.key, entry.previous, entry.proposed,
      { status: "approved", decidedByName: "Executive Review (Temporary)", decidedAt: "2026-10-18T20:00:00Z" });
    const item = compose("amendment_approved", amendment);
    assert.equal(item.title, "Request approved", entry.name);
    assert.deepEqual(labels(item), ["Request", "Requested by", "Decision by", "Project", "Requested", "Decision time"], entry.name);
    assert.deepEqual(rows(item), {
      Request: requestLine(entry), "Requested by": "UAT Project Control Admin", "Decision by": "Executive Review (Temporary)",
      Project: "MDP-PSAIM-01 · Pump Station", Requested: "@2026-10-18T19:10", "Decision time": "@2026-10-18T20:00",
    }, entry.name);
    assert.equal(item.toast.title, "Request approved", entry.name);
    assert.equal(item.toast.description, `${notify.clipToastLine(requestLine(entry))}\nApproved by Executive Review (Temporary) · Pump Station`, entry.name);
    assert.equal(item.toast.actionLabel, "View details", entry.name);
  }
});

test("rejected: the mandatory reason travels in the card; the toast stays compact", () => {
  for (const entry of CASES) {
    const amendment = structureAmendment(entry.key, entry.previous, entry.proposed,
      { status: "rejected", decidedByName: "Executive Review (Temporary)", decidedAt: "2026-10-18T20:00:00Z", decisionComment: "Civil works need Department C." });
    const item = compose("amendment_rejected", amendment);
    assert.equal(item.title, "Request rejected", entry.name);
    assert.deepEqual(labels(item), ["Request", "Requested by", "Decision by", "Project", "Requested", "Decision time", "Reason"], entry.name);
    assert.equal(rows(item)["Decision by"], "Executive Review (Temporary)", entry.name);
    assert.equal(rows(item)["Decision time"], "@2026-10-18T20:00", entry.name);
    assert.equal(rows(item).Reason, "Civil works need Department C.", entry.name);
    assert.equal(item.toast.title, "Request rejected", entry.name);
    assert.equal(item.toast.description, `${notify.clipToastLine(requestLine(entry))}\nRejected by Executive Review (Temporary) · Pump Station`, entry.name);
  }
});

test("stale and frozen: the requester is told nothing was applied / the project is archived", () => {
  const entry = CASES[1];
  const stale = compose("amendment_stale", structureAmendment(entry.key, entry.previous, entry.proposed,
    { status: "stale", decisionComment: "The structure changed after this request; nothing was applied." }));
  assert.equal(stale.title, "Request not applied");
  assert.deepEqual(labels(stale), ["Request", "Requested by", "Project", "Requested", "Outcome", "Detail"]);
  assert.match(rows(stale).Outcome, /^Nothing was applied: the underlying value changed after the request\.$/);
  assert.equal(rows(stale).Detail, "The structure changed after this request; nothing was applied.");
  assert.deepEqual(stale.toast, { title: "Request not applied", description: "Remove department · HSE\nNot applied: the value changed · Pump Station", actionLabel: "View details" });
  const frozen = compose("amendment_frozen", structureAmendment(entry.key, entry.previous, entry.proposed));
  assert.equal(frozen.title, "Request frozen");
  assert.match(rows(frozen).Outcome, /archived while the request was pending/);
  assert.equal(frozen.toast.title, "Request frozen");
  assert.equal(frozen.toast.description, "Remove department · HSE\nProject archived · Pump Station");
  // Every outcome opens the same exact request.
  for (const item of [stale, frozen]) assert.equal(model.notificationHref(item.target), `/projects/${PROJECT_ID}/setup/info?amendment=${AMENDMENT_ID}`);
});

/* ----------------------------- toasts and gating --------------------------- */

test("a new structure approval and a requester result both toast once; the backlog never replays", () => {
  // The session starts after the request was made (19:10), so the request is sign-in backlog.
  const now = () => Date.parse("2026-10-18T19:15:00Z");
  const gate = feed.createToastGate(now);
  const submitted = compose("amendment_submitted", structureAmendment(CASES[0].key, CASES[0].previous, CASES[0].proposed), { id: "n-new" });
  const approved = compose("amendment_approved", structureAmendment(CASES[1].key, CASES[1].previous, CASES[1].proposed,
    { status: "approved", decidedByName: "PCA" }), { id: "n-result", createdAt: "2026-10-18T19:20:00Z" });
  // Sign-in backlog: recorded, silent.
  assert.deepEqual(gate.observe([submitted]), { show: [], overflow: 0 });
  // A later arrival toasts once (top-centre, same system); the same id never repeats.
  const second = gate.observe([submitted, approved]);
  assert.deepEqual(second.show.map((entry) => entry.id), ["n-result"]);
  assert.equal(second.show[0].toast.title, "Request approved");
  assert.deepEqual(gate.observe([submitted, approved]), { show: [], overflow: 0 });
  assert.equal(feed.TOAST_POSITION, "top-center");
});

/* ------------------------- one coherent shared path ------------------------ */

test("structure and field requests share one trigger, one table, one composer and one toast", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261020090000_project_setup_amendment_notifications.sql", import.meta.url), "utf8").replaceAll("\r", "");
  // The event source filters on class and status only — never on a field or structure key.
  const event = sql.slice(sql.indexOf("function public.notify_setup_amendment_event"), sql.indexOf("create trigger notify_setup_amendment_event"));
  assert.match(event, /new\.status = 'pending' and new\.amendment_class = 'governed'/);
  assert.doesNotMatch(event, /field_key|target_key|structure_/);
  // The structure request function inserts the same governed, pending row the trigger watches.
  const request = readFileSync(new URL("../../../supabase/migrations/20261019090000_project_setup_structure_governance.sql", import.meta.url), "utf8");
  assert.match(request, /project_id, field_key, target_key, amendment_class, previous_value, proposed_value, reason,[\s\S]*?'governed',[\s\S]*?'pending'/);
  // No second notification framework: the composer and the service are the ones the field path uses.
  const service = code("../../services/setup-notification-service.ts");
  assert.match(service, /composeAmendmentNotification\(/);
  assert.doesNotMatch(service, /structure_(units|levels|departments|disciplines)/);
  for (const file of ["./components/governance/psm-scope-governance-panel.tsx", "./components/governance/structure-governance-panel.tsx"]) {
    assert.doesNotMatch(code(file), /user_notifications|NotificationService|toast\(/, file);
  }
  // Every structure action is covered by the shared wording.
  assert.deepEqual([...structure.STRUCTURE_FIELD_KEYS].sort(),
    ["structure_departments", "structure_disciplines", "structure_levels", "structure_units"]);
  assert.deepEqual([...new Set(CASES.map((entry) => entry.key))].sort(), [...structure.STRUCTURE_FIELD_KEYS].sort());
});
