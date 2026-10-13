import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// People Organization Chart (2C.3F). The chart model is pure; the cards and
// both tree views are rendered to static markup with the real components
// (next/link reduced to a plain <a>: no router).

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
const { buildPeopleChart, peopleChartLayout, peopleChartManagers } = await import("./people-chart.ts");
const { PeopleChartTree, PeopleChartOutline } = await import("./components/people-chart/people-chart-tree.tsx");
const { resolveProjectAuthority } = await import("./use-project-authority.ts");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");

/* --------------------------------- fixtures -------------------------------- */

const PARTIES = [
  { id: "p-eprom", kind: "eprom", sortOrder: 0 },
  { id: "p-owner", kind: "owner", sortOrder: 1 },
  { id: "p-sub", kind: "subcontractor", name: "Al Masah Construction Contracting LLC", shortName: "Al Masah", sortOrder: 2 },
];
const CONTACTS = [
  ["pm", "Mohamed Helmy", "Senior Project Manager", "EPROM"],
  ["pcm", "Khaled Fahmy", "Project Control Manager", "EPROM"],
  ["rc", "Nour Adel", "Reporting Coordinator", "EPROM"],
  ["cr", "Dina Samir", "Asset Integrity Lead", "SOPC"],
  ["sp", "Hany Tarek", "Operations Director", "EPROM"],
  ["sub", "Omar Rashed", "Site Supervisor", "Al Masah"],
  ["planner", "Laila Mansour", "Planning Engineer", "EPROM"],
  ["former", "Former Person", "Engineer", "EPROM"],
].map(([id, name, position, organization]) => ({ id, name, position, organization, active: true }));

const member = (id, contactId, extra = {}) => ({
  id, projectId: "prj", contactId, partyId: "p-eprom", projectRole: "Role", createdAt: "t", updatedAt: "t", ...extra,
});
const project = (members, extra = {}) => ({
  id: "prj", code: "MDP-PSAIM-01", name: "PSAIM – SOPC", status: "active", clientId: "c1",
  projectManagerId: "pm", projectControlManagerId: "pcm", reportingCoordinatorId: "rc",
  clientRepresentativeId: "cr", projectSponsorId: "sp", parties: PARTIES, positions: [], team: [], members, ...extra,
});
const chartOf = (proj, options = {}) => buildPeopleChart(proj, { contacts: CONTACTS, clientName: "SOPC", ...options });
/** Every node, depth first. */
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children)]);
const names = (nodes) => nodes.map((node) => node.name);
const tree = (chart, proj, collapsed = new Set()) =>
  renderToStaticMarkup(React.createElement(PeopleChartTree, { chart, project: proj, collapsed, onToggle: () => {} }));
const outline = (chart, proj, collapsed = new Set()) =>
  renderToStaticMarkup(React.createElement(PeopleChartOutline, { chart, project: proj, collapsed, onToggle: () => {} }));
const noRawValues = (markup, label) => assert.doesNotMatch(markup, /\bnull\b|\bundefined\b|NaN|\[object Object\]/, label);

/** A realistic team: PM → PCM → Planner, PM → RC; Client Rep and Sponsor at the top. */
const TEAM = [
  member("m-pm", "pm", { projectRole: "Project Manager" }),
  member("m-pcm", "pcm", { projectRole: "Project Controls Lead", reportsToMemberId: "m-pm" }),
  member("m-rc", "rc", { projectRole: "Reporting Coordinator", reportsToMemberId: "m-pm" }),
  member("m-planner", "planner", { projectRole: "Planner", reportsToMemberId: "m-pcm" }),
  member("m-cr", "cr", { partyId: "p-owner", projectRole: "Client Representative" }),
  member("m-sp", "sp", { projectRole: "Project Sponsor" }),
];

/* ---------------------------------- model --------------------------------- */

test("the project root renders, even before anyone joins the team", () => {
  const empty = project([]);
  const chart = chartOf(empty);
  assert.deepEqual([chart.roots.length, chart.memberCount, chart.reportingLines, chart.warnings], [0, 0, 0, []]);
  for (const markup of [tree(chart, empty), outline(chart, empty)]) {
    assert.match(markup, /data-people-chart-root/);
    assert.match(markup, />MDP-PSAIM-01</);
    assert.match(markup, />PSAIM – SOPC</);
    assert.match(markup, /Not classified · 0 people · 0 reporting lines/);
    noRawValues(markup);
  }
});

test("one top-level person sits directly under the project", () => {
  const proj = project([member("m-pm", "pm", { projectRole: "Project Manager" })]);
  const chart = chartOf(proj);
  assert.deepEqual(names(chart.roots), ["Mohamed Helmy"]);
  assert.equal(chart.roots[0].issues.length, 0, "the Project Manager heads the project: no Reports To is expected");
  const markup = tree(chart, proj);
  assert.match(markup, /data-people-card="m-pm"/);
  assert.match(markup, /data-people-chart-row/);
  assert.doesNotMatch(markup, /left-1\/2"|right-1\/2"|inset-x-0"/, "a single child has no sibling bus");
});

test("several top-level people: leadership first, then party, then name — each shown once", () => {
  const proj = project([
    member("m-z", "planner", { projectRole: "Planner" }),
    member("m-sub", "sub", { partyId: "p-sub", projectRole: "Site Supervisor" }),
    member("m-cr", "cr", { partyId: "p-owner", projectRole: "Client Representative" }),
    member("m-pm", "pm", { projectRole: "Project Manager" }),
    member("m-sp", "sp", { projectRole: "Project Sponsor" }),
  ]);
  const chart = chartOf(proj);
  assert.deepEqual(names(chart.roots), ["Hany Tarek", "Mohamed Helmy", "Dina Samir", "Laila Mansour", "Omar Rashed"]);
  assert.equal(flatten(chart.roots).length, 5);
  // Five leaves at the top hang in two columns either side of one line.
  assert.deepEqual(peopleChartLayout(chart.roots), { hang: chart.roots, row: [] });
  const markup = tree(chart, proj);
  assert.match(markup, /data-people-chart-hang/);
  assert.equal((markup.match(/data-people-card=/g) ?? []).length, 5);
  // Party chips: EPROM, the client's name, the subcontractor's short name.
  assert.match(markup, /title="Party: EPROM"/);
  assert.match(markup, /title="Party: SOPC"/);
  assert.match(markup, /title="Party: Al Masah"/);
  assert.match(markup, /data-party="subcontractor"/);
});

test("nested Reports To builds the hierarchy; the outline and chart show the same people", () => {
  const proj = project(TEAM);
  const chart = chartOf(proj);
  assert.deepEqual(names(chart.roots), ["Hany Tarek", "Mohamed Helmy", "Dina Samir"]);
  const pm = chart.roots[1];
  assert.deepEqual(names(pm.children), ["Khaled Fahmy", "Nour Adel"], "PCM before RC (leadership order)");
  assert.deepEqual(names(pm.children[0].children), ["Laila Mansour"]);
  assert.deepEqual(pm.children[0].reportsTo, { memberId: "m-pm", name: "Mohamed Helmy" });
  assert.equal(pm.descendantCount, 3);
  assert.equal(chart.reportingLines, 3);
  assert.deepEqual(pm.responsibilities, ["Project Manager"]);
  assert.deepEqual(peopleChartManagers(chart), ["m-pm", "m-pcm"]);

  const markup = tree(chart, proj);
  assert.match(markup, /aria-expanded="true" aria-label="Hide Mohamed Helmy&#x27;s 2 direct reports"/);
  assert.match(markup, /title="2 direct reports · 3 in total"/);
  assert.match(markup, /<span class="sr-only">Reports to Mohamed Helmy\.<\/span>/);
  assert.equal((markup.match(/data-people-card=/g) ?? []).length, 6);
  noRawValues(markup);
  const outlined = outline(chart, proj);
  assert.equal((outlined.match(/data-people-card=/g) ?? []).length, 6);
  assert.match(outlined, />2 direct reports</);

  // Collapsing a manager hides their whole branch, and says how many are hidden.
  const folded = tree(chart, proj, new Set(["m-pm"]));
  assert.equal((folded.match(/data-people-card=/g) ?? []).length, 3);
  assert.match(folded, /aria-expanded="false" aria-label="Show Mohamed Helmy&#x27;s 2 direct reports"/);
  assert.match(outline(chart, proj, new Set(["m-pm"])), /2 direct reports<span class="tabular-nums">· 3 in total<\/span>/);
});

test("active members only: ended memberships are left out (and counted), never re-parented", () => {
  const proj = project([
    ...TEAM,
    member("m-former", "former", { endedAt: "2026-09-01T00:00:00Z", reportsToMemberId: "m-pm" }),
  ]);
  const chart = chartOf(proj);
  assert.ok(!flatten(chart.roots).some((node) => node.contactId === "former"));
  assert.equal(chart.memberCount, 6);
  assert.equal(chart.endedCount, 1);
  assert.equal(chart.roots[1].descendantCount, 3, "the ended member is not under the Project Manager");
});

test("missing or stale Reports To: shown at the top level and flagged; the PM and Sponsor are not", () => {
  const proj = project([
    member("m-pm", "pm", { projectRole: "Project Manager" }),
    member("m-sp", "sp", { projectRole: "Project Sponsor" }),
    member("m-pcm", "pcm", { projectRole: "Project Controls Lead" }),
    member("m-former", "former", { endedAt: "2026-09-01T00:00:00Z" }),
    member("m-rc", "rc", { projectRole: "Reporting Coordinator", reportsToMemberId: "m-former" }),
    member("m-planner", "planner", { projectRole: "Planner", reportsToMemberId: "m-gone" }),
  ]);
  const chart = chartOf(proj);
  assert.equal(chart.roots.length, 5, "everyone without a valid manager is top-level");
  const issuesOf = (contactId) => flatten(chart.roots).find((node) => node.contactId === contactId).issues;
  assert.deepEqual(issuesOf("pm"), []);
  assert.deepEqual(issuesOf("sp"), []);
  assert.deepEqual(issuesOf("pcm"), ["no_reports_to"]);
  assert.deepEqual(issuesOf("rc"), ["reports_to_unavailable"], "an ended manager");
  assert.deepEqual(issuesOf("planner"), ["reports_to_unavailable"], "an unknown manager");
  assert.deepEqual(chart.warnings, ["1 person has no Reports To", "2 people report to someone no longer on the team"]);
  const markup = tree(chart, proj);
  assert.match(markup, />No Reports To</);
  assert.match(markup, />Reports To not on team</);
  noRawValues(markup);
});

test("missing Party / Project Role (legacy rows) are flagged on the card, never shown as null", () => {
  const proj = project([
    member("m-pm", "pm", { projectRole: undefined }),
    member("m-sp", "sp", { partyId: undefined, projectRole: undefined }),
    member("m-cr", "cr", { partyId: "p-deleted", projectRole: "Client Representative" }),
  ]);
  const chart = chartOf(proj);
  const byContact = Object.fromEntries(flatten(chart.roots).map((node) => [node.contactId, node]));
  assert.deepEqual(byContact.sp.issues, ["needs_party", "needs_project_role"]);
  assert.equal(byContact.sp.party, "needs_party");
  assert.equal(byContact.sp.partyLabel, undefined);
  assert.deepEqual(byContact.cr.issues, ["no_reports_to", "needs_party"], "a party id that no longer resolves");
  assert.deepEqual(byContact.pm.issues, ["needs_project_role"]);
  assert.deepEqual(chart.warnings, ["1 person has no Reports To", "2 people need a party", "2 people need a project role"]);
  const markup = tree(chart, proj);
  assert.match(markup, />Needs party</);
  assert.match(markup, />Needs project role</);
  assert.match(markup, /data-party="needs_party"/);
  noRawValues(markup);
  // An unknown person and long text stay safe: a fallback name, truncation with the full text as title.
  const longName = "Abdelrahman Mohamed Abdelaziz El-Sayed Abou El-Fotouh (Senior Consultant, Integrity)";
  const odd = project([member("m-x", "nobody", { projectRole: "A".repeat(80) }), member("m-y", "long")]);
  const oddChart = buildPeopleChart(odd, { contacts: [...CONTACTS, { id: "long", name: longName, active: true }] });
  const oddMarkup = tree(oddChart, odd);
  assert.match(oddMarkup, />Unknown person</);
  assert.match(oddMarkup, new RegExp(`class="mt-0\\.5 truncate[^"]*" title="${longName.replace(/[()]/g, "\\$&")}"`));
  assert.match(oddMarkup, /class="truncate text-xs font-medium text-muted-foreground" title="A{80}"/);
  noRawValues(oddMarkup);
});

test("cycle safety: self-reference, loops and branches hanging off a loop all render, each person once", () => {
  const proj = project([
    member("m-self", "sp", { reportsToMemberId: "m-self" }),
    // A two-person loop, and a three-person loop with someone reporting into it.
    member("m-a", "pm", { reportsToMemberId: "m-b" }),
    member("m-b", "pcm", { reportsToMemberId: "m-a" }),
    member("m-c", "rc", { reportsToMemberId: "m-d" }),
    member("m-d", "cr", { reportsToMemberId: "m-e" }),
    member("m-e", "planner", { reportsToMemberId: "m-c" }),
    member("m-f", "sub", { partyId: "p-sub", reportsToMemberId: "m-d" }),
  ]);
  const chart = chartOf(proj);
  const all = flatten(chart.roots);
  assert.equal(all.length, 7, "nobody lost, nobody duplicated");
  assert.equal(new Set(all.map((node) => node.memberId)).size, 7);
  const byId = Object.fromEntries(all.map((node) => [node.memberId, node]));
  assert.deepEqual(byId["m-self"].issues, ["reports_to_self"]);
  for (const id of ["m-a", "m-b", "m-c", "m-d", "m-e"]) assert.ok(byId[id].issues.includes("reporting_loop"), id);
  assert.ok(!byId["m-f"].issues.includes("reporting_loop"), "reporting INTO a loop is not being in it");
  // Each loop is broken once, at the member who sorts first (leadership first:
  // the Project Manager, then the Client Representative); the rest keep their lines.
  assert.deepEqual(names(chart.roots), ["Hany Tarek", "Mohamed Helmy", "Dina Samir"]);
  assert.deepEqual(names(byId["m-a"].children), ["Khaled Fahmy"]);
  assert.deepEqual(names(byId["m-d"].children), ["Nour Adel", "Omar Rashed"], "the loop's rest, and the branch into it");
  assert.deepEqual(names(byId["m-c"].children), ["Laila Mansour"]);
  assert.equal(chart.reportingLines, 4);
  assert.deepEqual(chart.warnings, [
    "1 person is recorded as reporting to themselves",
    "5 people are in a reporting loop",
  ]);
  const markup = tree(chart, proj);
  assert.match(markup, />Reports to self</);
  assert.match(markup, />Reporting loop</);
  assert.equal((markup.match(/data-people-card=/g) ?? []).length, 7);
  noRawValues(markup);
  assert.equal((outline(chart, proj).match(/data-people-card=/g) ?? []).length, 7);
});

test("PSM, Other and legacy projects use the same chart model — never the structure, departments or contacts rows", () => {
  const base = project(TEAM);
  const psm = { ...base, structureFamily: "psm", team: [
    // PSM department assignments carry their own Reports To; the chart ignores them.
    { contactId: "planner", departmentId: "d1", reportsToContactId: "cr" },
    { contactId: "pcm", role: "project_control_manager" },
  ] };
  const other = { ...base, structureFamily: "other", structure: { nodes: [{ id: "n1", parentId: null }] } };
  const shape = (chart) => JSON.stringify(chart);
  assert.equal(shape(chartOf(psm)), shape(chartOf(base)));
  assert.equal(shape(chartOf(other)), shape(chartOf(base)));
  assert.match(tree(chartOf(psm), psm), /PSM Project · 6 people · 3 reporting lines/);
  assert.match(tree(chartOf(other), other), /Other Project · 6 people · 3 reporting lines/);

  const model = source("./people-chart.ts");
  for (const forbidden of [/\.team\b/, /structure/i, /project_contacts|projectContacts/, /organization-chart|organizationChart/]) {
    assert.doesNotMatch(model.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), forbidden, `the model never reads ${forbidden}`);
  }
  assert.doesNotMatch(source("./components/people-chart/people-org-chart.tsx"), /structureFamily ===|isOther|setupFlowFor/,
    "one chart for every project type");
});

test("archived project: the chart stays visible and offers no mutation", () => {
  const archived = project(TEAM, { status: "archived" });
  const chart = chartOf(archived);
  const markup = tree(chart, archived);
  assert.match(markup, /data-people-chart-root/);
  assert.match(markup, />Archived</);
  assert.equal((markup.match(/data-people-card=/g) ?? []).length, 6);
  assert.doesNotMatch(markup, /<a\b|<input|<select|<textarea|<form/, "the chart itself only expands and collapses");
  const buttons = markup.match(/<button[^>]*>/g) ?? [];
  assert.ok(buttons.length > 0 && buttons.every((button) => /aria-expanded=/.test(button)), "every button is a branch toggle");

  // The one link out — to the Project Team — follows the Project Team's own edit authority.
  const view = source("./components/people-chart/people-org-chart.tsx");
  assert.match(view, /authority\.canManageOperations \? \(\s*<Button variant="outline" size="sm" asChild>\s*<Link href=\{teamHref\}>Edit on Project Team<\/Link>/);
  assert.match(view, /This project is archived\. The chart is read-only\./);
  const controller = { contactId: "pcm", isGlobalAuthority: false };
  assert.equal(resolveProjectAuthority(project(TEAM), controller).canManageOperations, true);
  assert.equal(resolveProjectAuthority(archived, controller).canManageOperations, false, "so no edit link on an archived project");
  assert.equal(resolveProjectAuthority(archived, { contactId: null, isGlobalAuthority: true }).canManageOperations, false);
});

test("chart placement grants no authority", () => {
  // Make the planner everyone's manager, at the top of the chart.
  const promoted = project(TEAM.map((entry) => entry.contactId === "planner"
    ? { ...entry, reportsToMemberId: undefined }
    : { ...entry, reportsToMemberId: "m-planner" }));
  const chart = chartOf(promoted);
  assert.deepEqual(names(chart.roots), ["Laila Mansour"]);
  assert.equal(chart.roots[0].descendantCount, 5);
  const planner = { contactId: "planner", isGlobalAuthority: false };
  for (const proj of [promoted, project(TEAM), project([])]) {
    const authority = resolveProjectAuthority(proj, planner);
    assert.deepEqual([authority.canManageOperations, authority.canManageReporting, authority.canAccessProject, authority.holdsOperations],
      [false, false, false, false], "a chart position is not an assignment");
  }
  // Nothing on a node speaks of permission, and the model imports no authority rule.
  assert.deepEqual(Object.keys(chart.roots[0]).sort(), [
    "children", "company", "contactId", "descendantCount", "issues", "jobTitle", "memberId", "name",
    "party", "partyLabel", "projectRole", "reportsTo", "responsibilities",
  ]);
  const model = source("./people-chart.ts");
  assert.doesNotMatch(model, /assignment-rules|use-project-authority|can_manage|canManage|identity/);
  assert.match(source("./components/people-chart/people-org-chart.tsx"), /Reporting lines describe the team; they grant no access\./);
});

test("the Organization Chart page opens on People; the Phase 2A position chart stays as its own tab", () => {
  const section = source("./components/sections/organization-chart-section.tsx");
  assert.match(section, /<Tabs defaultValue="people">/);
  assert.match(section, /<TabsTrigger value="people">People<\/TabsTrigger>\s*<TabsTrigger value="positions">Position Chart<\/TabsTrigger>/);
  assert.match(section, /<TabsContent value="people"[^>]*>\s*<PeopleOrgChart project=\{project\} \/>/);
  assert.match(section, /<TabsContent value="positions"[\s\S]*<OrgChartView project=\{project\} \/>/);
  assert.match(section, /It does not define who\s+reports to whom/);
  // Reports To is edited only on the Project Team: the People chart has no editor of its own.
  const chartFiles = ["./components/people-chart/people-org-chart.tsx", "./components/people-chart/people-chart-tree.tsx",
    "./components/people-chart/people-chart-card.tsx"].map(source).join("\n");
  assert.doesNotMatch(chartFiles, /projectTeamService|updateMember|update_project_member|reportsToCandidates|onDrop|draggable/);
});

test("layout rule: leaf reports hang either side of the line, sub-teams sit side by side below", () => {
  const leaf = (id) => ({ memberId: id, children: [] });
  const team = (id) => ({ memberId: id, children: [leaf(`${id}-report`)] });
  const ids = ({ hang, row }) => ({ hang: hang.map((node) => node.memberId), row: row.map((node) => node.memberId) });
  assert.deepEqual(ids(peopleChartLayout([leaf("a"), leaf("b")])), { hang: [], row: ["a", "b"] });
  assert.deepEqual(ids(peopleChartLayout([leaf("a"), leaf("b"), leaf("c")])), { hang: ["a", "b", "c"], row: [] });
  assert.deepEqual(ids(peopleChartLayout([leaf("a"), team("t")])), { hang: [], row: ["a", "t"] });
  assert.deepEqual(ids(peopleChartLayout([team("t1"), leaf("a"), team("t2"), leaf("b")])), { hang: ["a", "b"], row: ["t1", "t2"] });

  // Hanging rows: the line stops at the last row's middle; an odd last row has one card.
  const line = (end) => new RegExp(`absolute top-0 left-\\[calc\\(50%-0\\.5px\\)\\] w-px bg-muted-foreground/30 ${end}`, "g");
  const flat = project(["pm", "pcm", "rc", "planner", "sub"].map((contactId) => member(`m-${contactId}`, contactId)));
  const flatMarkup = tree(chartOf(flat), flat);
  assert.equal((flatMarkup.match(line("h-full")) ?? []).length, 2);
  assert.equal((flatMarkup.match(line("h-1/2")) ?? []).length, 1);
  // Next to sub-teams the line runs on through the hanging rows to them.
  const mixed = project([
    member("m-pm", "pm"), member("m-pcm", "pcm", { reportsToMemberId: "m-pm" }),
    member("m-rc", "rc", { reportsToMemberId: "m-pm" }), member("m-sub", "sub", { reportsToMemberId: "m-pm" }),
    member("m-planner", "planner", { reportsToMemberId: "m-pcm" }),
  ]);
  const mixedMarkup = tree(chartOf(mixed), mixed);
  assert.match(mixedMarkup, /data-people-chart-hang/);
  assert.equal((mixedMarkup.match(line("h-1/2")) ?? []).length, 0);
  assert.ok(mixedMarkup.indexOf('data-people-card="m-rc"') < mixedMarkup.indexOf('data-people-card="m-pcm"'), "leaves hang above the sub-team row");
});
