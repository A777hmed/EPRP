import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Project Responsibility grouped by holder party — presentation only. The
// rule is pure; the cards and group sections are rendered to static markup
// with the real components (next/link reduced to a plain <a>: no router).

const NEXT_LINK_STUB = `data:text/javascript,${encodeURIComponent(
  "export default function Link(props) { return globalThis.__renderNextLink(props); }"
)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/link") return { url: NEXT_LINK_STUB, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!(url.endsWith(".tsx") || (url.includes("/eprp/src/") && url.endsWith(".ts")))) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  },
});

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
globalThis.__renderNextLink = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
const { groupResponsibilities, holderGroup, holderPartyLabel, savedHolderOf, RESPONSIBILITY_GROUP_ORDER } = await import("./responsibility-groups.ts");
const { projectResponsibilities } = await import("./responsibilities.ts");
const { ResponsibilityCard, ResponsibilityGroupSection } = await import("./components/responsibility-cards.tsx");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");

const member = (contactId, partyId, extra = {}) => ({ id: `m-${contactId}`, projectId: "prj", contactId, partyId, projectRole: "Role", createdAt: "t", updatedAt: "t", ...extra });
const PARTIES = [
  { id: "p-eprom", kind: "eprom", sortOrder: 0 }, { id: "p-owner", kind: "owner", sortOrder: 1 },
  { id: "p-sub", kind: "subcontractor", name: "Sub Co", sortOrder: 2 },
];
const SAVED = {
  id: "prj", status: "active", parties: PARTIES,
  projectManagerId: "pm", projectControlManagerId: "pcm", reportingCoordinatorId: "rc",
  clientRepresentativeId: "client", projectSponsorId: "legacy",
  members: [member("pm", "p-eprom"), member("pcm", "p-eprom"), member("rc", "p-eprom"), member("client", "p-owner"),
    member("legacy", undefined), member("sub", "p-sub"), member("former", "p-eprom", { endedAt: "t1" })],
  positions: [{ id: "pos-1", jobTitleId: "jt", contactId: "sub", sortOrder: 0 }],
};
const entriesOf = (values) => projectResponsibilities(values, () => "Site Representative");

/* -------------------------------- the rule -------------------------------- */

test("a holder's group is the party of their ACTIVE membership on this project", () => {
  assert.equal(holderGroup(SAVED, "pm"), "eprom");
  assert.equal(holderGroup(SAVED, "client"), "client");
  assert.equal(holderGroup(SAVED, "sub"), "subcontractor");
  // No party, an ended membership, or no membership at all: not recorded.
  for (const contactId of ["legacy", "former", "global-only"]) assert.equal(holderGroup(SAVED, contactId), "party_not_recorded", contactId);
  assert.equal(holderGroup(SAVED, ""), "unassigned");
  // A new project has no Project Team yet.
  assert.equal(holderGroup(null, "pm"), "assigned");
  assert.equal(holderGroup(null, ""), "unassigned");
  // The card's party metadata uses the same membership.
  assert.deepEqual(["pm", "client", "sub", "legacy", "former", "global-only"].map((id) => holderPartyLabel(SAVED, id)),
    ["EPROM", "Owner / Client", "Sub Co", undefined, undefined, undefined]);
  assert.equal(holderPartyLabel(null, "pm"), undefined);
});

test("groups come in a fixed order, keep the cards' order, and lose no card", () => {
  const entries = entriesOf({ ...SAVED, positions: [...SAVED.positions, { jobTitleId: "jt", contactId: "", sortOrder: 1 }] });
  const groups = groupResponsibilities(entries, { savedProject: SAVED });
  assert.deepEqual(groups.map((group) => group.key), ["eprom", "client", "subcontractor", "party_not_recorded", "unassigned"]);
  assert.deepEqual(groups.find((group) => group.key === "eprom").entries.map((entry) => entry.roleLabel),
    ["Project Manager", "Project Control Manager", "Reporting Coordinator"]);
  assert.equal(groups.flatMap((group) => group.entries).length, entries.length, "every responsibility is shown exactly once");
  for (const key of groups.map((group) => group.key)) assert.ok(RESPONSIBILITY_GROUP_ORDER.includes(key));
});

test("visibility: EPROM and Client always on a saved project; Subcontractor with a subcontractor party; the rest only with cards", () => {
  const noSubs = { ...SAVED, parties: PARTIES.slice(0, 2), clientRepresentativeId: "", projectSponsorId: "", positions: [] };
  const groups = groupResponsibilities(entriesOf(noSubs), { savedProject: noSubs });
  assert.deepEqual(groups.map((group) => [group.key, group.entries.length]),
    [["eprom", 3], ["client", 0], ["unassigned", 2]]);
  // A subcontractor party with no holder still shows its (empty) group.
  const withParty = { ...noSubs, parties: PARTIES };
  assert.deepEqual(groupResponsibilities(entriesOf(withParty), { savedProject: withParty }).map((group) => group.key),
    ["eprom", "client", "subcontractor", "unassigned"]);
  // A new project: only "Assigned" and "Unassigned", never empty party groups.
  const fresh = { projectManagerId: "pm", projectControlManagerId: "", reportingCoordinatorId: "", clientRepresentativeId: "", projectSponsorId: "", positions: [] };
  assert.deepEqual(groupResponsibilities(entriesOf(fresh), { savedProject: null }).map((group) => [group.key, group.entries.length]),
    [["assigned", 1], ["unassigned", 4]]);
});

test("a row being edited stays in the group it was saved in; it moves only when editing ends", () => {
  const draft = { ...SAVED, positions: [...SAVED.positions, { jobTitleId: "jt", contactId: "pm", sortOrder: 1 }] };
  const entries = entriesOf(draft);
  const newRow = entries.find((entry) => entry.key === "position:new:1");
  assert.equal(savedHolderOf(newRow, SAVED), "", "never saved");
  const editing = groupResponsibilities(entries, { savedProject: SAVED, editingKey: newRow.key });
  assert.ok(editing.find((group) => group.key === "unassigned").entries.includes(newRow), "still where it started while being edited");
  const done = groupResponsibilities(entries, { savedProject: SAVED, editingKey: null });
  assert.ok(done.find((group) => group.key === "eprom").entries.includes(newRow), "then grouped by its new holder's party");
  const pm = entries.find((entry) => entry.fixedField === "projectManagerId");
  assert.equal(savedHolderOf(pm, SAVED), "pm");
  assert.equal(savedHolderOf(pm, null), "");
});

/* ------------------------------- the markup -------------------------------- */

const CONTACTS = [
  { id: "pm", name: "Mohamed Helmy", position: "Project Director", organization: "EPROM", active: true },
  { id: "sub", name: "Omar Rashed", position: "Site Supervisor", organization: "Al Masah Construction", active: true },
];
const card = (entry, props = {}) => renderToStaticMarkup(React.createElement(ResponsibilityCard, {
  entry, contacts: CONTACTS, busy: false, locked: false, onEdit: () => {}, teamHref: "/projects/prj/team", ...props,
}));

test("the card keeps its content, badges and actions; the holder is the prominent line", () => {
  const entries = entriesOf(SAVED);
  const pm = card(entries.find((entry) => entry.fixedField === "projectManagerId"), { locked: true });
  assert.match(pm, /Project Manager/);
  assert.match(pm, /<p class="[^"]*font-semibold text-foreground[^"]*" title="Mohamed Helmy">Mohamed Helmy<\/p>/);
  assert.match(pm, /Project Director/);
  assert.match(pm, /EPROM/);
  assert.match(pm, />Governed</);
  assert.match(pm, /aria-label="Project Manager is already assigned — reassign it from Replace Person"/);
  // The governed footer: one compact line; the full sentence stays as tooltip and link name.
  assert.match(pm, /title="Already assigned — use Replace Person in Team &amp; Responsibilities to change it."/);
  assert.match(pm, /<a href="\/projects\/prj\/team" aria-label="Already assigned — use Replace Person in Team &amp; Responsibilities to change it\."/);
  assert.match(pm, /<span class="truncate">Assigned<\/span>/);
  assert.match(pm, />Replace Person<\/a>/);
  assert.doesNotMatch(pm, />use Replace Person in Team/, "no long repeated sentence on every card");
  // Role is a small label; job title and party are one metadata line.
  assert.match(pm, /<p class="mr-0\.5 min-w-0 truncate text-xs font-medium text-muted-foreground">Project Manager<\/p>/);
  const withParty = card(entries.find((entry) => entry.fixedField === "projectManagerId"), { party: "EPROM" });
  assert.match(withParty, />Project Director · EPROM</);
  const flagged = card(entries.find((entry) => entry.fixedField === "projectSponsorId"), { needsParty: true });
  assert.match(flagged, />Needs party</);
  // Optional, Additional and Required badges; Remove only where it existed.
  const sponsor = card(entriesOf({ ...SAVED, projectSponsorId: "" }).find((entry) => entry.fixedField === "projectSponsorId"));
  assert.match(sponsor, />Optional</);
  assert.match(sponsor, />Not assigned</);
  assert.doesNotMatch(sponsor, />—</, "no column of dashes for an unfilled role");
  const position = card(entries.find((entry) => entry.kind === "additional"), { onDelete: () => {} });
  assert.match(position, />Additional</);
  assert.match(position, /aria-label="Remove Site Representative"/);
  const vacantRequired = card(entriesOf({ ...SAVED, projectManagerId: "" }).find((entry) => entry.fixedField === "projectManagerId"));
  assert.match(vacantRequired, />Required</);
  assert.doesNotMatch(card(entries[0]), /aria-label="Remove/, "fixed roles are never removable");
});

test("Replace Person: an active project's assigned cards offer it; an archived project's cards do not", () => {
  const ARCHIVED = { ...SAVED, status: "archived" };
  const entries = entriesOf(SAVED);
  const fixed = entries.find((entry) => entry.fixedField === "projectManagerId");
  const position = entries.find((entry) => entry.kind === "additional");

  // Active: the governed footer links to Team & Responsibilities.
  for (const entry of [fixed, position]) {
    const active = card(entry, { locked: true, party: "EPROM" });
    assert.match(active, /<a href="\/projects\/prj\/team"[^>]*>.*Replace Person<\/a>/, entry.key);
  }

  // Archived: same holder, role, badges and "Assigned" — but no action at all.
  for (const entry of [fixed, position]) {
    const archived = card(entry, { locked: true, party: "EPROM", teamHref: "/projects/prj/team", archived: true });
    assert.doesNotMatch(archived, /<a\b/, `${entry.key}: nothing to follow`);
    assert.doesNotMatch(archived, /Replace Person/, `${entry.key}: not offered, not even as help text`);
    assert.match(archived, new RegExp(`>${entry.roleLabel}</p>`));
    assert.match(archived, new RegExp(`title="${entry.kind === "fixed" ? "Mohamed Helmy" : "Omar Rashed"}"`));
    assert.match(archived, />Governed</);
    assert.match(archived, /<span class="truncate">Assigned<\/span>/);
    assert.match(archived, /title="This project is archived; its setup is read-only\."/);
    assert.match(archived, new RegExp(`disabled="" aria-label="${entry.roleLabel} is read-only — this project is archived"`));
  }
  assert.match(card(position, { onDelete: () => {}, archived: true }), /disabled="" aria-label="Site Representative is read-only — this project is archived"[^>]*><svg[^>]*lucide-trash/);

  // The form decides "archived" from the saved project's status, for both card kinds.
  const form = source("./components/project-form.tsx");
  assert.match(form, /const archived = isSetupReadOnly\(savedProject\);/);
  assert.equal((form.match(/archived=\{archived\}/g) ?? []).length, 2);
  // The governed-card rule itself is unchanged: an archived project's holders still read as assigned.
  const archivedGroups = groupResponsibilities(entriesOf(ARCHIVED), { savedProject: ARCHIVED });
  assert.deepEqual(archivedGroups.map((group) => group.key), groupResponsibilities(entries, { savedProject: SAVED }).map((group) => group.key));
});

test("a section is a slim heading (icon, name, count, subtitle, accent rule) over the cards — no tinted panel", () => {
  const filled = renderToStaticMarkup(React.createElement(ResponsibilityGroupSection, { groupKey: "subcontractor", count: 1 },
    React.createElement("div", { "data-card": "x" })));
  assert.match(filled, /<section aria-labelledby="responsibility-group-subcontractor" data-responsibility-group="subcontractor" class="space-y-3">/);
  assert.match(filled, /<h4 id="responsibility-group-subcontractor"[^>]*>Subcontractor<\/h4>/);
  assert.match(filled, />1<span class="sr-only"> responsibility<\/span>/);
  assert.match(filled, /Held by members of a subcontractor&#x27;s team\./);
  assert.match(filled, /bg-chart-2\/12 text-chart-2/, "colour on the icon only");
  assert.match(filled, /absolute -bottom-px left-0 h-0\.5 w-10 rounded-full bg-chart-2/, "a short accent on the divider");
  assert.doesNotMatch(filled, /rounded-xl border|bg-chart-\d\/\[0\.|bg-primary\/\[0\./, "no large tinted container");
  assert.ok(filled.includes('<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div data-card="x">'), "one / two / three columns");
  // "Needs Party Assignment" is a compact data-quality notice, not a party heading.
  const notice = renderToStaticMarkup(React.createElement(ResponsibilityGroupSection, { groupKey: "party_not_recorded", count: 1 }));
  assert.match(notice, /role="note" class="flex items-start gap-2 rounded-md border border-warning\/30 bg-warning\/\[0\.04\] px-3 py-2"/);
  assert.match(notice, /Complete it on the Project Team\./);
  assert.doesNotMatch(notice, /border-b pb-2/);
  const empty = renderToStaticMarkup(React.createElement(ResponsibilityGroupSection, { groupKey: "client", count: 0 }));
  assert.match(empty, /No Owner \/ Client team member holds a responsibility yet\./);
  assert.doesNotMatch(empty, /grid gap-3/);
  for (const [key, title] of [["eprom", "EPROM"], ["client", "Client"], ["party_not_recorded", "Needs Party Assignment"],
    ["assigned", "Assigned"], ["unassigned", "Unassigned Responsibilities"]]) {
    assert.match(renderToStaticMarkup(React.createElement(ResponsibilityGroupSection, { groupKey: key, count: 2 })), new RegExp(`>${title}</h4>`), key);
  }
});

/* ------------------------------- the wiring -------------------------------- */

test("Project Information renders party groups of the same cards; editing, saving and governance are untouched", () => {
  const form = source("./components/project-form.tsx");
  assert.match(form, /groupResponsibilities\(entries, \{ savedProject, editingKey: editingRow \}\)/);
  assert.match(form, /<ResponsibilityGroupSection\s+key=\{group\.key\}\s+groupKey=\{group\.key\}\s+count=\{group\.entries\.length\}\s+>\s+\{group\.entries\.map\(renderEntry\)\}/);
  // The same resting card, the same lock rules, the same editors (spanning the group).
  assert.equal((form.match(/<ResponsibilityCard\b/g) ?? []).length, 2);
  assert.match(form, /isFixedResponsibilityOccupied\(savedProject, entry\.fixedField\)/);
  assert.match(form, /isProjectPositionOccupied\(entry\.positionId\)/);
  assert.equal((form.match(/shadow-sm col-span-full"/g) ?? []).length, 2);
  assert.match(form, /onDelete=\{locked \? undefined : \(\) => onDeleteRow\(index\)\}/);
  assert.equal((form.match(/party=\{holderPartyLabel\(savedProject, entry\.contactId\)\}/g) ?? []).length, 2);
  assert.equal((form.match(/needsParty=\{holderGroup\(savedProject, entry\.contactId\) === "party_not_recorded"\}/g) ?? []).length, 2);
  // Cards, not a table or list.
  const cards = source("./components/responsibility-cards.tsx");
  assert.doesNotMatch(cards + form.slice(form.indexOf("function ResponsibilityList("), form.indexOf("function AddPositionButton(")),
    /<table|<Table|<ul|<ol/);
});
