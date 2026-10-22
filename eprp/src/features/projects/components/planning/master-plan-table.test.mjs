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
  MASTER_PLAN_HEAD_BG,
  MASTER_PLAN_ROW_BG,
  MASTER_PLAN_TABLE_CLASS,
  masterPlanBodyCell,
  masterPlanColumnLabel,
  masterPlanColumns,
  masterPlanHeadCell,
  masterPlanTableMinWidth,
} from "./master-plan-columns.ts";
import { buildWorkingPlanTree, effectiveContributions, flattenWorkingPlan } from "../../working-plan.ts";

// Phase 13.11 UAT — the Master Plan table, final structure: ONE pinned "Item"
// identity column (name, then code · classification); one strict rule for the
// four numeric columns (right-aligned header and body, same padding, two-line
// header with the help icon glued to its label); one fixed header height;
// separate cell borders and a scroll fade at the pinned edge. The real
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

test("Item cell: name first, then a compact 'code · classification' line; full text on hover", () => {
  assert.match(wbs1[0], /<p class="line-clamp-2 text-sm leading-snug break-words font-semibold" title="Engineering and Design">Engineering and Design<\/p>/);
  assert.match(wbs1[0], /<p class="min-w-0 truncate text-xs text-muted-foreground" title="MDP-PSAIM-01-WBS-1 · Engineering · Imported"><span class="font-mono">MDP-PSAIM-01-WBS-1<\/span> · Engineering · Imported<\/p>/);
  assert.match(wbs1[0], /Control Account<\/span>/, "Control Account badge kept, under the name");
  // Activities indent inside the same column; a milestone keeps its marker.
  assert.match(wbs1[0], /style="padding-left:12px"/);
  assert.match(a1[0], /style="padding-left:28px"/);
  assert.match(a1[0], /title="MDP-PSAIM-01-A-1 · Activity · Imported"/);
  assert.match(a2[0], /aria-label="Milestone"/);
  assert.match(a2[0], /· Milestone · Imported/);
});

/* --------------------------- Numeric alignment ----------------------------- */

test("numeric columns: one rule — centred header and body, identical padding, tabular figures", () => {
  assert.deepEqual(Object.keys(MASTER_PLAN_COLUMNS).filter((key) => MASTER_PLAN_COLUMNS[key].numeric), NUMERIC);
  for (const key of NUMERIC) {
    const head = classes(masterPlanHeadCell(key));
    const body = classes(masterPlanBodyCell(key));
    assert.ok(head.has("text-center") && head.has("px-3"), `${key} header`);
    assert.ok(body.has("text-center") && body.has("tabular-nums") && body.has("px-3"), `${key} body`);
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

test("header: one fixed 64px height, every label vertically centred, same type; no random wrapping", () => {
  for (const key of ORDER) {
    const head = classes(masterPlanHeadCell(key));
    for (const cls of ["h-16", "py-0", "align-middle", "text-xs", "leading-4", "font-medium", "border-b",
      "whitespace-nowrap", MASTER_PLAN_HEAD_BG]) {
      assert.ok(head.has(cls), `${key}: ${cls}`);
    }
    assert.ok(!head.has("align-bottom") && !head.has("whitespace-normal"), key);
  }
  // Two 16px lines + 2px gap fit inside h-16 (64px): never clipped.
  assert.ok(Math.max(...ORDER.map((key) => MASTER_PLAN_COLUMNS[key].header.length)) <= 2);
});

/* ------------------------------ Pinned column ------------------------------ */

test("only Item is pinned — from xl — on a solid background, with a divider and a scroll fade", () => {
  const item = classes(masterPlanBodyCell("item"));
  for (const cls of ["xl:sticky", "xl:left-0", "xl:border-r", "z-10", "bg-card", "xl:after:absolute",
    "xl:after:left-[calc(100%+1px)]", "xl:after:w-4", "xl:after:bg-linear-to-r", "xl:after:to-transparent", "xl:after:from-card"]) {
    assert.ok(item.has(cls), cls);
  }
  assert.ok(classes(masterPlanHeadCell("item")).has("z-20"));
  for (const key of ORDER.filter((k) => k !== "item")) {
    assert.ok(![...classes(masterPlanBodyCell(key)), ...classes(masterPlanHeadCell(key))].some((c) => c.includes("sticky")), key);
  }
  for (const value of [MASTER_PLAN_HEAD_BG, MASTER_PLAN_ROW_BG]) assert.doesNotMatch(value, /\/\d+\b/, "solid, never translucent");
  assert.match(html, /^<div class="table-frame overflow-hidden rounded-lg border bg-card"><div data-slot="table-container"/, "one card surface");
});

test("borders are separate and drawn by the cells, so the pinned cell covers them", () => {
  assert.deepEqual([...classes(MASTER_PLAN_TABLE_CLASS)].sort(), ["border-separate", "border-spacing-0", "table-fixed"]);
  for (const key of ORDER) {
    assert.ok(classes(masterPlanHeadCell(key)).has("border-b"), key);
    assert.ok(classes(masterPlanBodyCell(key)).has("group-last/row:border-b-0"), key);
  }
});

/* --------------------------- Reports in, Actions --------------------------- */

test("Reports in: fixed width, one line with ellipsis, full path in the title", () => {
  assert.equal(MASTER_PLAN_COLUMNS.reports.width, 12);
  assert.match(html, /<span class="block truncate" title="Process Safety Management → Asset Integrity Management System → Risk-Based Inspection">/);
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
