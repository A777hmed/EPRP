import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  formatContribution,
  formatWeight,
  MASTER_PLAN_COLUMNS,
  MASTER_PLAN_BAND_BG,
  MASTER_PLAN_HEAD_BG,
  MASTER_PLAN_ROW_BG,
  MASTER_PLAN_TABLE_CLASS,
  masterPlanBodyCell,
  masterPlanColumnLabel,
  masterPlanColumns,
  masterPlanHeadCell,
  masterPlanItemIndent,
  masterPlanTableMinWidth,
  splitUnitPath,
} from "./master-plan-columns.ts";
import { buildWorkingPlanTree, effectiveContributions, flattenWorkingPlan } from "../../working-plan.ts";

// Phase 13.11 UAT — the Master Plan table, final structure: ONE pinned "Item"
// identity column (name, then code · classification); one strict rule for the
// four numeric columns (right-aligned header and body, same padding, two-line
// header with the help icon glued to its label); one fixed header height;
// separate cell borders and a scroll fade at the pinned edge.
// 13.12 closure polish: Actions pinned on the right at every width; rows are
// two lines high; first-level nodes are group rows; deeper rows indent under
// one guide per level; quiet small-caps headers; compact square tags. The real
// component is rendered with fixture rows. Layout only — no data, weight or
// calculation behaviour changes.

registerHooks({ load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });
const { MasterPlanTable, childrenTotalText } = await import("./master-plan-table.tsx");

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8").replaceAll("\r", "");
const classes = (value) => new Set(value.split(/\s+/));
const NUMERIC = ["local", "contribution", "children", "recorded"];
const ORDER = ["item", "level", "method", "local", "contribution", "children", "recorded", "reports", "actions"];

const P = "MDP-PSAIM-01";
const node = (id, o = {}) => ({ id, projectId: "p", code: `${P}-${id}`, name: id, itemType: "engineering", level: 0,
  sortOrder: 0, isMilestone: false, isControlAccount: false, source: "import", active: true, createdAt: "", updatedAt: "", ...o });
const act = (id, o = {}) => ({ id, projectId: "p", code: `${P}-${id}`, name: id, isMilestone: false, source: "import",
  active: true, createdAt: "", updatedAt: "", ...o });
const tree = buildWorkingPlanTree(
  [
    node("WBS-1", { name: "Engineering and Design", localWeightPercent: 40, weightPercent: 25, sortOrder: 1, isControlAccount: true }),
    node("WBS-2", { name: "HAZOP Study", weightPercent: 25, sortOrder: 2 }),
  ],
  [
    act("A-1", { name: "Data collection", workItemId: "WBS-1", localWeightPercent: 25 }),
    act("A-2", { name: "Final report approved", workItemId: "WBS-1", isMilestone: true }),
  ]
);
const render = (props = {}) => renderToStaticMarkup(React.createElement(MasterPlanTable, {
  tree, rows: flattenWorkingPlan(tree), showRecorded: true, contributions: effectiveContributions(tree),
  levelLabels: ["Control Account"], projectDefault: "percent_complete",
  describeUnit: () => "Process Safety Management → Asset Integrity Management System → Risk-Based Inspection",
  renderActions: () => React.createElement("span", { className: "inline-flex items-center justify-end gap-1" }, "Edit"),
  ...props,
}));
const html = render();
const rowsOf = (markup) => markup.split("<tr").slice(2);
const cellsOf = (row) => row.split("<td").slice(1);
const [wbs1, a1, a2, wbs2] = rowsOf(html).map(cellsOf);

/* -------------------------------- Structure ------------------------------- */

test("final column structure: one Item column, then Level … Actions", () => {
  assert.deepEqual(masterPlanColumns(true), ORDER);
  assert.deepEqual(masterPlanColumns(false), ORDER.filter((key) => key !== "recorded"));
  assert.equal(MASTER_PLAN_COLUMNS.item.header.join(" "), "Item");
  assert.ok(MASTER_PLAN_COLUMNS.item.width >= 20 && MASTER_PLAN_COLUMNS.item.width <= 24);
  assert.ok(!("code" in MASTER_PLAN_COLUMNS) && !("name" in MASTER_PLAN_COLUMNS), "no separate Code / Name columns");
  assert.equal(masterPlanTableMinWidth(masterPlanColumns(true)),
    ORDER.reduce((sum, key) => sum + MASTER_PLAN_COLUMNS[key].width, 0));
});

test("header, body and <colgroup> come from the same column list", () => {
  const cols = [...html.matchAll(/<col style="width:([\d.]+)rem"\/>/g)].map((m) => Number(m[1]));
  assert.deepEqual(cols, ORDER.map((key) => MASTER_PLAN_COLUMNS[key].width));
  assert.equal((html.match(/<th /g) ?? []).length, ORDER.length);
  for (const row of rowsOf(html)) assert.equal(cellsOf(row).length, ORDER.length);
  assert.match(html, new RegExp(`<table data-slot="table" class="w-full caption-bottom text-sm ${MASTER_PLAN_TABLE_CLASS}"`));
});

/* -------------------------------- Item cell -------------------------------- */

test("Item cell: the name on one line, then a quieter 'code · classification' line; full text on hover", () => {
  assert.match(wbs1[0], /<p class="truncate text-\[13px\] leading-5 text-foreground font-semibold" title="Engineering and Design">Engineering and Design<\/p>/);
  assert.match(wbs1[0], /<p class="min-w-0 truncate text-\[11px\] leading-4 text-muted-foreground" title="MDP-PSAIM-01-WBS-1 · Engineering · Imported"><span class="font-mono tracking-tight">MDP-PSAIM-01-WBS-1<\/span> · Engineering · Imported<\/p>/);
  // The Control Account designation: a compact square tag, never a pill badge.
  assert.match(wbs1[0], /<span class="inline-flex h-4 items-center rounded-sm border px-1 text-\[10px\] font-semibold tracking-wide uppercase border-info\/40 text-info">Control account<\/span>/);
  assert.doesNotMatch(wbs1[0], /data-slot="status-badge"/);
  // An activity reads lighter than its node; a milestone keeps its marker.
  assert.match(a1[0], /<p class="truncate text-\[13px\] leading-5 text-foreground" title="Data collection">/);
  assert.match(a1[0], /title="MDP-PSAIM-01-A-1 · Activity · Imported"/);
  assert.match(a2[0], /aria-label="Milestone"/);
  assert.match(a2[0], /· Milestone · Imported/);
  // Every row is two lines: no multi-line clamp on the name.
  assert.doesNotMatch(html, /line-clamp/);
});

test("hierarchy: first-level nodes are group rows; deeper rows indent under one guide per level", () => {
  const row = (markup, id) => markup.split("<tr").find((part) => part.includes(`title="${id}"`)) ?? "";
  const top = row(html, "Engineering and Design");
  const child = row(html, "Data collection");
  assert.match(top, /data-row-kind="node" data-depth="1"/);
  assert.match(child, /data-row-kind="activity" data-depth="2"/);
  for (const cls of MASTER_PLAN_BAND_BG.split(" ")) assert.ok(classes(/class="([^"]*)"/.exec(cellsOf(top)[1])[1]).has(cls), `band: ${cls}`);
  for (const cls of MASTER_PLAN_ROW_BG.split(" ")) assert.ok(classes(/class="([^"]*)"/.exec(cellsOf(child)[1])[1]).has(cls), `plain: ${cls}`);
  // Indent: 12px, +16px per level; one 1px guide per ancestor, under that ancestor's text.
  assert.deepEqual(masterPlanItemIndent(1), { paddingLeft: 12 });
  const two = masterPlanItemIndent(2);
  assert.equal(two.paddingLeft, 28);
  assert.equal(two.backgroundPosition, "16px 0");
  const three = masterPlanItemIndent(3);
  assert.equal(three.paddingLeft, 44);
  assert.equal(three.backgroundPosition, "16px 0, 32px 0");
  assert.equal(three.backgroundSize, "1px 100%, 1px 100%");
  assert.match(cellsOf(child)[0], /style="padding-left:28px;background-image:linear-gradient\(var\(--border\), var\(--border\)\);background-size:1px 100%;background-position:16px 0;background-repeat:no-repeat"/);
  assert.match(cellsOf(top)[0], /style="padding-left:12px"/);
});

test("Earning method and Reports in: the value never truncates behind a qualifier", () => {
  // The inherited marker sits on its own quiet line.
  assert.match(wbs1[2], /<span class="block truncate">Percent Complete<\/span><span class="block truncate text-\[11px\] leading-4 text-muted-foreground">Inherited<\/span>/);
  assert.doesNotMatch(html, /\(inherited\)<\/span>/);
  // The reporting unit first, the path above it beneath.
  assert.deepEqual(splitUnitPath("A → B → C"), { unit: "C", path: "A → B" });
  assert.deepEqual(splitUnitPath("WP-01"), { unit: "WP-01", path: "" });
});

/* --------------------------- Numeric alignment ----------------------------- */

test("numeric columns: one rule — right-aligned header and body, identical padding, tabular figures", () => {
  assert.deepEqual(Object.keys(MASTER_PLAN_COLUMNS).filter((key) => MASTER_PLAN_COLUMNS[key].numeric), NUMERIC);
  for (const key of NUMERIC) {
    const head = classes(masterPlanHeadCell(key));
    const body = classes(masterPlanBodyCell(key));
    assert.ok(head.has("text-right") && head.has("px-3") && !head.has("text-center"), `${key} header`);
    assert.ok(body.has("text-right") && body.has("tabular-nums") && body.has("px-3"), `${key} body`);
  }
  for (const key of ["item", "level", "method", "reports"]) {
    const head = classes(masterPlanHeadCell(key));
    assert.ok(!head.has("text-center") && !head.has("text-right"), `${key} stays left-aligned`);
  }
});

test("stacked headers: two explicit block lines 2px apart; help icon after the second line's text", () => {
  const stacked = ["method", ...NUMERIC];
  for (const key of stacked) {
    const [first, second] = MASTER_PLAN_COLUMNS[key].header;
    assert.ok(first && second, `${key} is two lines`);
    const re = new RegExp(
      `<span data-slot="header-label" class="block"><span class="block">${first}</span><span class="block mt-0\\.5">${second}\u00a0` +
        '<span class="inline-flex h-4 items-center align-top"><button[^>]*aria-label="About [^"]+"'
    );
    assert.match(html, re, key);
    assert.equal(masterPlanColumnLabel(key), `${first} ${second}`);
  }
  assert.deepEqual(MASTER_PLAN_COLUMNS.method.header, ["Earning", "method"]);
  for (const key of ["item", "level", "reports", "actions"]) {
    assert.equal(MASTER_PLAN_COLUMNS[key].header.length, 1, `${key} stays one line`);
  }
  assert.doesNotMatch(read("./master-plan-table.tsx"), /LabelWithHelp/, "no flex wrapper that could float the icon");
});

test("numeric values: '25%', '—' and '25% · 1 missing' are plain right-aligned text, no padded badge", () => {
  const dash = '<span class="text-muted-foreground">—</span>';
  assert.ok(wbs1[3].endsWith(">40%</td>"));
  assert.ok(a1[3].endsWith(">25%</td>"));
  assert.ok(a2[3].endsWith(`>${dash}</td>`), "milestone with no local weight");
  assert.ok(a1[5].endsWith(`>${dash}</td>`), "children total not applicable to an activity");
  assert.ok(wbs2[3].endsWith(`>${dash}</td>`), "node with no local weight");
  assert.match(wbs1[5], /<span class="whitespace-nowrap font-medium text-warning">25% · 1 missing<\/span>/);
  assert.doesNotMatch(wbs1[5], /data-slot="status-badge"/);
  assert.equal(formatWeight(undefined), null);
  assert.equal(formatWeight(25), "25%");
  assert.equal(formatContribution(1.6000000001), "1.6%");
});

/* --------------------------------- Header ---------------------------------- */

test("header: one fixed 56px height, every label vertically centred, quiet small caps; no random wrapping", () => {
  for (const key of ORDER) {
    const head = classes(masterPlanHeadCell(key));
    for (const cls of ["h-14", "py-0", "align-middle", "text-[11px]", "leading-4", "font-medium", "uppercase",
      "tracking-wide", "text-muted-foreground", "border-b", "whitespace-nowrap", MASTER_PLAN_HEAD_BG]) {
      assert.ok(head.has(cls), `${key}: ${cls}`);
    }
    assert.ok(!head.has("align-bottom") && !head.has("whitespace-normal"), key);
  }
  // Two 16px lines + 2px gap fit inside h-14 (56px): never clipped.
  assert.ok(Math.max(...ORDER.map((key) => MASTER_PLAN_COLUMNS[key].header.length)) <= 2);
});

test("rows: one height (two lines), every cell vertically centred on its own solid background", () => {
  for (const key of ORDER) {
    const body = classes(masterPlanBodyCell(key));
    for (const cls of ["h-[3.25rem]", "align-middle", "border-b", "bg-card"]) assert.ok(body.has(cls), `${key}: ${cls}`);
    assert.ok(classes(masterPlanBodyCell(key, "band")).has("bg-[color-mix(in_oklab,var(--muted)_32%,var(--card))]"), key);
  }
  // Hover and keyboard focus inside a row look the same; the table row itself paints nothing.
  assert.match(MASTER_PLAN_ROW_BG, /group-hover\/row:bg-\S+ group-has-\[:focus-visible\]\/row:bg-/);
  assert.match(html, /<tr data-slot="table-row" class="[^"]*group\/row hover:bg-transparent"/);
});

/* ------------------------------ Pinned column ------------------------------ */

test("Item is pinned on the left from xl, Actions on the right at every width — solid, with a divider and a scroll fade", () => {
  const item = classes(masterPlanBodyCell("item"));
  for (const cls of ["xl:sticky", "xl:left-0", "xl:border-r", "z-10", "bg-card", "xl:after:absolute",
    "xl:after:left-[calc(100%+1px)]", "xl:after:w-4", "xl:after:bg-linear-to-r", "xl:after:to-transparent", "xl:after:from-card"]) {
    assert.ok(item.has(cls), cls);
  }
  // Actions can never be scrolled out of reach.
  const actions = classes(masterPlanBodyCell("actions"));
  for (const cls of ["sticky", "right-0", "border-l", "z-10", "bg-card", "before:absolute", "before:right-[calc(100%+1px)]",
    "before:w-4", "before:bg-linear-to-l", "before:to-transparent", "before:from-card"]) {
    assert.ok(actions.has(cls), cls);
  }
  assert.ok([...actions].every((c) => !c.startsWith("xl:sticky")), "pinned at every width, not only from xl");
  assert.ok(classes(masterPlanHeadCell("item")).has("z-20") && classes(masterPlanHeadCell("actions")).has("z-20"));
  for (const key of ORDER.filter((k) => k !== "item" && k !== "actions")) {
    assert.ok(![...classes(masterPlanBodyCell(key)), ...classes(masterPlanHeadCell(key))].some((c) => c.includes("sticky")), key);
  }
  for (const value of [MASTER_PLAN_HEAD_BG, MASTER_PLAN_ROW_BG, MASTER_PLAN_BAND_BG]) {
    assert.doesNotMatch(value, /\/\d+\b/, "solid, never translucent");
  }
  assert.match(html, /^<div class="table-frame overflow-hidden rounded-lg border bg-card"><div data-slot="table-container"/, "one card surface");
});

test("borders are separate and drawn by the cells, so the pinned cell covers them; the table closes on its own hairline", () => {
  assert.deepEqual([...classes(MASTER_PLAN_TABLE_CLASS)].sort(), ["border-separate", "border-spacing-0", "table-fixed"]);
  for (const key of ORDER) {
    assert.ok(classes(masterPlanHeadCell(key)).has("border-b"), key);
    // 13.12 closure: the last row keeps its bottom hairline, so the table ends on a line above the
    // inset scrollbar instead of running into it (the "cropped bottom edge").
    assert.ok(classes(masterPlanBodyCell(key)).has("border-b"), key);
    assert.ok(!classes(masterPlanBodyCell(key)).has("group-last/row:border-b-0"), key);
  }
  // The scrollbar: inset, no arrow buttons; the standard thin scrollbar only where ::-webkit-scrollbar does not exist
  // (Chromium ignores every ::-webkit-scrollbar rule once scrollbar-width is set).
  const css = readFileSync(new URL("../../../../app/globals.css", import.meta.url), "utf8").replaceAll("\r", "");
  const frame = css.slice(css.indexOf(".table-frame {"), css.indexOf("Notification toasts (13.9B UAT polish)"));
  assert.match(frame, /@supports not selector\(::-webkit-scrollbar\) \{\s*\.table-frame > \[data-slot="table-container"\] \{\s*scrollbar-width: thin;/);
  assert.match(frame, /::-webkit-scrollbar-track \{\s*margin-inline: 0\.5rem;/);
  assert.match(frame, /::-webkit-scrollbar-button \{\s*display: none;/);
  const rules = frame.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((rules.match(/scrollbar-width/g) ?? []).length, 1, "never set unconditionally");
});

/* --------------------------- Reports in, Actions --------------------------- */

test("Reports in: fixed width, the unit over its path (each one line with ellipsis), full path in the title", () => {
  assert.equal(MASTER_PLAN_COLUMNS.reports.width, 11.5);
  assert.match(html, /<span class="block min-w-0" title="Process Safety Management → Asset Integrity Management System → Risk-Based Inspection"><span class="block truncate">Risk-Based Inspection<\/span><span class="block truncate text-\[11px\] leading-4 text-muted-foreground">Process Safety Management → Asset Integrity Management System<\/span><\/span>/);
});

test("Actions: a visible, centred header, with every row's actions centred beneath it", () => {
  assert.match(html, /<th [^>]*class="[^"]*text-center[^"]*"[^>]*><span data-slot="header-label" class="block"><span class="block">Actions<\/span><\/span><\/th>/);
  assert.ok(classes(masterPlanBodyCell("actions")).has("text-center"));
  const panel = read("./master-plan-panel.tsx");
  assert.equal((panel.match(/inline-flex items-center justify-end/g) ?? []).length, 2, "read-only History and Edit/⋯ alike");
});

/* ------------------------------- Boundaries -------------------------------- */

test("layout only: the panel hands the table the same data; nothing here writes", () => {
  const panel = read("./master-plan-panel.tsx");
  assert.match(panel, /<MasterPlanTable\s+tree=\{tree\}\s+rows=\{rows\}\s+showRecorded=\{showRecorded\}\s+contributions=\{contributions\}/);
  for (const file of ["./master-plan-table.tsx", "./master-plan-columns.ts"]) {
    assert.doesNotMatch(read(file), /@\/services|planningService|planning-engine/, file);
  }
  assert.equal(childrenTotalText({ status: "empty", enteredTotal: 0, missing: [] }), "No work yet");
});
