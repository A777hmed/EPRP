import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The shared contextual-help pattern (`docs/07` §10.13) and its first use, the
// Phase 13.11 Planning experience. Real components rendered to static HTML,
// plus source contracts for what static HTML cannot show (popover content is
// portalled and only mounts when opened).

registerHooks({ resolve(specifier, context, nextResolve) {
  // Node's ESM resolver needs the file entry of Next's CommonJS subpath.
  return nextResolve(specifier === "next/link" ? "next/link.js" : specifier, context);
}, load(url, context, nextLoad) {
  // `.ts` too: the master-data store (contact names in the setup history)
  // reaches services that use parameter properties, which strip-only cannot run.
  if (!/\.tsx?$/.test(url) || url.includes("/node_modules/")) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const { ContextHelp, contextHelpLabel, LabelWithHelp } = await import("./context-help.tsx");
const { PLANNING_HELP } = await import("../../features/projects/components/planning/planning-help.tsx");
const { PlanningSetupPanel } = await import("../../features/projects/components/planning/planning-setup-panel.tsx");

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const PLANNING_DIR = "../../features/projects/components/planning/";
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/* ------------------------------ The component ----------------------------- */

test("trigger: a real button named 'About <topic>', closed by default, opening a dialog popover", () => {
  const html = renderToStaticMarkup(React.createElement(ContextHelp, { topic: "Weight source" }, "Explanation"));
  assert.match(html, /^<button type="button"/);
  assert.match(html, /aria-label="About Weight source"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-state="closed"/);
  assert.equal(contextHelpLabel("Data Date"), "About Data Date");
  // The explanation is not in the page until the user asks for it.
  assert.doesNotMatch(html, /Explanation/);
});

test("trigger: an information icon, never a warning icon; visible focus ring; theme tokens only", () => {
  const html = renderToStaticMarkup(React.createElement(ContextHelp, { topic: "X" }, "y"));
  assert.match(html, /lucide-info/);
  assert.doesNotMatch(html, /triangle-alert|circle-alert|octagon-alert|alert-triangle/);
  assert.match(html, /focus-visible:ring-2/);
  assert.match(html, /text-muted-foreground/);
  assert.doesNotMatch(read("./context-help.tsx"), /#[0-9a-f]{3,6}\b|text-(red|amber|yellow)-/i);
});

test("behaviour: click / Enter / Space open it (Radix popover), not hover-only; fits a phone viewport", () => {
  const source = read("./context-help.tsx");
  assert.match(source, /<PopoverTrigger asChild>/);
  assert.doesNotMatch(source, /onMouseEnter|onPointerEnter|HoverCard|Tooltip/);
  assert.match(source, /collisionPadding=\{16\}/);
  assert.match(source, /w-\[min\(20rem,calc\(100vw-2rem\)\)\]/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  // Optional "Learn more" is a disclosure button with aria-expanded / aria-controls.
  assert.match(source, /aria-expanded=\{moreOpen\}\s+aria-controls=\{moreId\}/);
});

test("LabelWithHelp keeps the label text and its icon together", () => {
  const html = renderToStaticMarkup(React.createElement(LabelWithHelp,
    { help: React.createElement(ContextHelp, { topic: "Local weight" }, "x") }, "Local weight"));
  assert.match(html, /^<span class="inline-flex items-center gap-1">Local weight<button/);
});

// Pre-existing ad-hoc info tooltips (hover-based), to be moved onto
// ContextHelp by their own owning work — listed so no NEW one-off appears.
const LEGACY_AD_HOC_HELP = ["dashboard/components/progress-curve-modal.tsx"];

test("one help component in the app: nothing new builds its own info popover", () => {
  const roots = ["../../features/", "../../app/"];
  const offenders = [];
  for (const root of roots) {
    for (const name of readdirSync(new URL(root, import.meta.url), { recursive: true }).map(String)) {
      if (!name.endsWith(".tsx")) continue;
      const source = read(`${root}${name.replaceAll("\\", "/")}`);
      if (/aria-label=\{?[`"']About /.test(source)) offenders.push(name.replaceAll("\\", "/"));
    }
  }
  assert.deepEqual(offenders, LEGACY_AD_HOC_HELP);
});

/* ----------------------------- Planning Setup ----------------------------- */

const settings = {
  projectId: "p1", onboardingMode: "new_project", planningEnabled: true,
  levelLabels: ["Control Account", "Work Package"], controlAccountLevel: 1,
  weightSource: "eprp", defaultEarningMethod: "percent_complete",
  createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
};
const setup = (overrides = {}) => renderToStaticMarkup(React.createElement(PlanningSetupPanel, {
  projectId: "p1", settings, canManage: true, hasLocalWeights: false, setupHref: "/projects/p1/info#planning-entry",
  onSaved: () => {}, ...overrides,
}));

test("Planning Setup renders one short sentence with correctly spaced words and no stray emphasis", () => {
  const html = setup();
  const visible = text(html);
  assert.match(visible, /How this project's plan is broken down, weighted and measured\./);
  assert.doesNotMatch(visible, /howthis|weightedand|brokendown/i);
  assert.doesNotMatch(html, /<(strong|b)>|font-medium text-foreground">how</);
  // The former long paragraphs are gone from the page itself.
  assert.doesNotMatch(visible, /It does not hold the work itself|Schedule Performance Index|switching loses nothing/);
});

// An incomplete configuration opens for editing at the first guided question.
const unconfigured = { ...settings, levelLabels: [], controlAccountLevel: undefined, weightSource: undefined, defaultEarningMethod: undefined };

test("Planning Setup: help icons on the setup itself, the Guided/Advanced views and the first guided question", () => {
  const html = setup({ settings: unconfigured });
  assert.match(text(html), /Question 1 of 3/);
  for (const label of ["About Planning setup", "About Guided and Advanced", "About Planning levels"]) {
    assert.ok(html.includes(`aria-label="${label}"`), label);
  }
  // Not cluttered: no help beside Save, Discard, Add level or the view buttons.
  assert.equal((html.match(/data-slot="context-help-trigger"/g) ?? []).length, 3);
  assert.ok(!html.includes('aria-label="About Control Account level"'), "asked only once levels are named");
  const named = setup({ settings: { ...unconfigured, levelLabels: ["Control Account"] } });
  assert.ok(named.includes('aria-label="About Control Account level"'));
});

/* ------------------------- Planning Setup: saved state --------------------- */

test("a complete saved configuration opens as its summary: Configured, four facts, an explicit Edit action", () => {
  const html = setup();
  const visible = text(html);
  assert.match(visible, /Configured/);
  assert.match(html, /lucide-circle-check/);
  assert.match(visible, /Edit planning setup/);
  assert.doesNotMatch(visible, /Question 1 of 3|Save planning setup/);
  assert.match(html, /aria-label="Saved planning setup"/);
  for (const [label, value] of [
    ["Breakdown", "Control Account → Work Package"],
    ["Performance reported at", "Control Account"],
    ["Weight source", "Enter & manage weights in EPRP"],
    ["Default earning method", "Percent complete"],
  ]) {
    assert.match(visible, new RegExp(`${label} ${value}`), label);
  }
  // Help keeps working in the summary; the view switch appears only while editing.
  assert.ok(html.includes('aria-label="About Planning setup"'));
  assert.ok(!html.includes('aria-label="Planning setup view"'));
});

test("right after a save the panel confirms it, as a polite status message", () => {
  assert.doesNotMatch(text(setup()), /saved successfully/);
  const html = setup({ justSaved: true });
  assert.match(html, /<p role="status"[^>]*>.*Planning setup saved successfully\.<\/p>/);
});

test("a read-only account sees the saved summary without the Edit action", () => {
  const visible = text(setup({ canManage: false }));
  assert.match(visible, /Configured/);
  assert.doesNotMatch(visible, /Edit planning setup/);
});

test("saving still goes through the one writer, then hands the new version to the workspace", () => {
  const panel = read(`${PLANNING_DIR}planning-setup-panel.tsx`);
  assert.equal(panel.split("planningService.saveConfiguration(").length - 1, 1);
  assert.match(panel, /toast\.success\("Planning setup saved successfully\."\);\s+\/\/[^\n]*\n[^\n]*\n\s+onSaved\(result\.updatedAt\);/);
  assert.doesNotMatch(panel, /setStep\(0\);\s+onSaved/);
  const workspace = read(`${PLANNING_DIR}planning-workspace.tsx`);
  assert.match(workspace, /justSaved=\{savedVersion !== null && savedVersion === facts\.settings\?\.updatedAt\}/);
  assert.match(workspace, /configurationComplete: configurationComplete\(facts\.settings\)/);
});

test("Planning Setup without an onboarding choice still asks for it first (unchanged)", () => {
  assert.match(text(setup({ settings: null })), /First decide how the project will be planned in Project Setup/);
});

/* ----------------------------- Help content -------------------------------- */

test("Planning help content: the required concepts, explained once", () => {
  const help = PLANNING_HELP;
  const bodyText = (concept) => text(renderToStaticMarkup(React.createElement(React.Fragment, null, help[concept].body, help[concept].example ?? null)));
  assert.match(bodyText("planningSetup"), /how this project's plan is structured and measured/);
  assert.match(bodyText("planningSetup"), /Master Plan/);
  assert.match(bodyText("planningSetup"), /PV \(Planned Value\), EV \(Earned Value\) and SPI \(Schedule Performance Index\)/);
  assert.match(bodyText("planningLevels"), /Control Account → Work Package → Activity/);
  assert.match(bodyText("planningLevels"), /not a level created here/);
  assert.match(bodyText("controlAccount"), /rolled up, reviewed and explained/);
  assert.match(bodyText("weightSource"), /VDU = 40% of RBI/);
  assert.match(bodyText("weightSource"), /never rescaled automatically/);
  assert.doesNotMatch(bodyText("weightSource"), /normali[sz]ed automatically(?! )/);
  for (const method of ["Percent complete", "0/100", "50/50", "Milestone"]) {
    assert.match(bodyText("earningMethod"), new RegExp(method.replace("/", "\\/")), method);
  }
  assert.match(bodyText("setupViews"), /Guided asks simple questions one at a time/);
  assert.match(bodyText("setupViews"), /same saved configuration/);
});

test("Planning help is written once: no other Planning file repeats its explanations", () => {
  const phrases = ["Schedule Performance Index", "is not a level created here", "never rescaled automatically",
    "rolled up, reviewed and explained", "blank is never read as 0", "not the date the snapshot was published"];
  for (const name of readdirSync(new URL(PLANNING_DIR, import.meta.url)).filter((n) => n.endsWith(".tsx"))) {
    if (name === "planning-help.tsx") continue;
    const source = read(`${PLANNING_DIR}${name}`);
    for (const phrase of phrases) assert.ok(!source.includes(phrase), `${name} repeats "${phrase}"`);
  }
});

test("help is applied where 13.11 concepts are non-obvious, and only there", () => {
  const uses = (file) => [...read(`${PLANNING_DIR}${file}`).matchAll(/<PlanningHelp concept="(\w+)"/g)].map((m) => m[1]);
  // Master Plan table headers map each help concept to its column once.
  const table = read(`${PLANNING_DIR}master-plan-table.tsx`);
  const headerHelp = table.slice(table.indexOf("const HEADER_HELP"), table.indexOf("};", table.indexOf("const HEADER_HELP")));
  assert.deepEqual([...headerHelp.matchAll(/(\w+): "(\w+)",/g)].map((m) => `${m[1]}=${m[2]}`), [
    "method=earningMethod", "local=localWeight", "contribution=contribution", "children=childrenTotal", "recorded=recordedWeight",
  ]);
  assert.match(table, /<PlanningHelp concept=\{concept\} align=\{numeric \? "center" : "start"\} \/>/);
  assert.deepEqual(uses("master-plan-panel.tsx"), []);
  assert.deepEqual(uses("working-plan-fields.tsx"), ["localWeight", "recordedWeight"]);
  assert.deepEqual(uses("work-item-form-dialog.tsx"), ["controlAccount", "earningMethod"]);
  assert.deepEqual(uses("activity-form-dialog.tsx"), ["earningMethod"]);
  assert.deepEqual(uses("planning-item-history-dialog.tsx"), ["history"]);
  assert.deepEqual(uses("planning-workspace.tsx"), ["dataDate", "readiness"]);
  // Governed / destructive actions keep their own confirmation UX, untouched.
  assert.doesNotMatch(read(`${PLANNING_DIR}weight-decision-dialog.tsx`), /PlanningHelp|ContextHelp/);
  assert.doesNotMatch(read(`${PLANNING_DIR}baselines-snapshots-panel.tsx`), /PlanningHelp|ContextHelp/);
});

test("help is presentation only: it touches no service, engine or stored value", () => {
  for (const file of ["./context-help.tsx", `${PLANNING_DIR}planning-help.tsx`]) {
    const source = read(file);
    assert.doesNotMatch(source, /@\/services|planning-engine|working-plan"|supabase/, file);
  }
});
