import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { forecastCurveReasonText, sCurveRows, sCurveSeriesPresent } from "./s-curve.ts";
import {
  overviewReferenceDates,
  PROJECT_DESCRIPTION_SOURCE,
  SCHEDULE_CONDITION_NOT_EVALUATED,
} from "./planning-experience.ts";

// Phase 13.12 closure review — three owner-UAT findings:
//   1. S-curve: the snapshot froze baseline and forecast curves but Project
//      Progress never drew them (a consumer gap — fixed, from frozen data only);
//   2. Overview reference dates: "from Project Setup" was shown beside dates the
//      approved BL0 supersedes — each group is now named by its real source;
//   3. the project description ("AT RISK — …") is labelled as manual text, never
//      the Planning Engine's schedule condition (not evaluated until B4, 13.14).

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

/* --------------------------------- S-curve --------------------------------- */

// Shaped like MDP-PSAIM-01 v7: BL0 and BL1 curves on a weekly grid, the forecast from the Data Date.
const BL0 = [{ date: "2026-08-27", value: 0 }, { date: "2026-09-03", value: 40 }, { date: "2026-10-29", value: 100 }];
const BL1 = [{ date: "2026-08-27", value: 0 }, { date: "2026-09-03", value: 35 }, { date: "2026-10-29", value: 99 }, { date: "2026-11-05", value: 100 }];
const FORECAST = [{ date: "2026-09-30", value: 55.275 }, { date: "2026-10-29", value: 100 }];

test("S-curve rows: every stored point at its own date; no interpolation, no zero for a missing value", () => {
  const rows = sCurveRows({ original: BL0, current: BL1, forecast: FORECAST, dataDate: "2026-09-30", earned: 55.275 });
  assert.deepEqual(rows.map((row) => row.date), ["2026-08-27", "2026-09-03", "2026-09-30", "2026-10-29", "2026-11-05"]);
  assert.deepEqual(rows[2], { date: "2026-09-30", forecast: 55.275, earned: 55.275 }, "no baseline value invented at the Data Date");
  assert.deepEqual(rows[4], { date: "2026-11-05", current: 100 }, "BL0 has no point on BL1's extra date");
  assert.equal(rows[0].forecast, undefined, "the forecast opens at the Data Date, never before it");
  // Every value is exactly a stored one.
  const stored = new Set([...BL0, ...BL1, ...FORECAST].map((point) => point.value).concat(55.275));
  for (const row of rows) for (const key of ["original", "current", "forecast", "earned"]) {
    if (row[key] !== undefined) assert.ok(stored.has(row[key]), `${row.date} ${key}`);
  }
});

test("S-curve series: BLn is drawn only when it is a re-baseline; empty series are not drawn", () => {
  assert.deepEqual(sCurveSeriesPresent({ original: BL0, current: BL1, forecast: FORECAST, dataDate: "2026-09-30", earned: 55.275 }),
    ["original", "current", "forecast", "earned"]);
  // ZZ-UAT-OTHER-GOV-01 v1: BL0 · BL0.
  assert.deepEqual(sCurveSeriesPresent({ original: BL0, current: null, forecast: FORECAST, dataDate: "2026-09-30", earned: 60 }),
    ["original", "forecast", "earned"]);
  assert.deepEqual(sCurveSeriesPresent({ original: [], current: null, forecast: [], dataDate: undefined, earned: null }), []);
  assert.match(forecastCurveReasonText("forecast_missing"), /no forecast finish/);
  assert.equal(forecastCurveReasonText(undefined), null);
});

test("Project Progress draws the S-curve from the snapshot's frozen curves only — no engine, no Working Plan", () => {
  const view = code("./components/progress/project-progress-view.tsx");
  assert.match(view, /<SnapshotSCurve snapshot=\{snapshot\} \/>/);
  const chart = code("./components/progress/snapshot-s-curve.tsx");
  assert.match(chart, /planningService\.listBaselineCurve\(v2\.bl0BaselineId\)/);
  assert.match(chart, /sameBaseline \? Promise\.resolve\(null\) : planningService\.listBaselineCurve\(v2\.blnBaselineId\)/);
  assert.match(chart, /planningService\.listSnapshotForecastCurve\(snapshot\.id\)/);
  assert.doesNotMatch(chart, /planning-engine|calculatePlanPerformance|forecastCurve\(|baselineCurve\(|listActivities|listWorkItems/);
  // Not v2: says why, draws nothing.
  assert.match(chart, /if \(!v2\) \{\s*return \(\s*<PendingCurve title="No S-curve for this snapshot">/);
  // Reduced motion and an accessible description.
  assert.match(chart, /isAnimationActive=\{!reduced\}/);
  assert.match(chart, /role="img"\s+aria-label=\{`S-curve from Published Planning Snapshot v\$\{snapshot\.version\}/);
});

/* ------------------------- Overview reference dates ------------------------- */

const MDP = { plannedStartDate: "2026-01-01", plannedFinishDate: "2026-12-15", actualStartDate: "2026-01-01", forecastFinishDate: "2026-12-29" };
const v7 = { version: 7, calculation: "engine", v2: { bl0BaselineId: "bl0", blnBaselineId: "bl1",
  bl0FinishDate: "2026-10-28", blnFinishDate: "2026-10-31", forecastFinishDate: "2026-10-31" } };

test("Overview dates on a governed project come from the Published Planning Snapshot, named as such", () => {
  const groups = overviewReferenceDates(MDP, v7);
  assert.deepEqual(groups[0], {
    source: "snapshot",
    caption: "From Published Planning Snapshot v7",
    dates: [
      { label: "Original baseline finish (BL0)", value: "2026-10-28" },
      { label: "Current baseline finish", value: "2026-10-31" },
      { label: "Forecast finish", value: "2026-10-31" },
    ],
  });
  // Recorded actuals stay, captioned with their own source; the superseded Planned / typed forecast are not shown.
  assert.deepEqual(groups[1], { source: "setup", caption: "Recorded in Project Setup", dates: [{ label: "Actual start", value: "2026-01-01" }] });
  const all = groups.flatMap((group) => group.dates.map((date) => date.value));
  assert.ok(!all.includes("2026-12-15") && !all.includes("2026-12-29"), "Project Setup's planned / typed forecast finish never shown as the plan");
  assert.ok(!groups.some((group) => group.source === "snapshot" && /Project Setup/.test(group.caption)));
});

test("Overview dates: BL0 only reads 'Baseline finish (BL0)'; no or a legacy snapshot keeps Project Setup's dates, captioned so", () => {
  const other = overviewReferenceDates({}, { version: 1, calculation: "engine", v2: { bl0BaselineId: "b", blnBaselineId: "b", bl0FinishDate: "2026-12-31", blnFinishDate: "2026-12-31", forecastFinishDate: "2026-12-31" } });
  assert.deepEqual(other, [{ source: "snapshot", caption: "From Published Planning Snapshot v1",
    dates: [{ label: "Baseline finish (BL0)", value: "2026-12-31" }, { label: "Forecast finish", value: "2026-12-31" }] }]);
  for (const snapshot of [null, { version: 3, calculation: "legacy" }, { version: 1, calculation: "declared" }]) {
    const [group] = overviewReferenceDates(MDP, snapshot);
    assert.equal(group.source, "setup");
    assert.equal(group.caption, "Reference dates from Project Setup");
    assert.deepEqual(group.dates.map((date) => date.label), ["Start", "Planned finish", "Forecast finish"]);
  }
  const header = code("./components/project-summary-header.tsx");
  assert.match(header, /overviewReferenceDates\(project, position\.status === "ready" \? position\.snapshot : null\)/);
  assert.match(header, /position\.status === "loading"\s*\?\s*\[\]/, "superseded dates never flash while loading");
  assert.match(header, /<span className="text-muted-foreground\/80">\{group\.caption\}<\/span>/);
  assert.doesNotMatch(header, /Reference dates from Project Setup/, "the caption comes from the source, not a fixed string");
});

/* ------------------ Manual description vs engine condition ------------------ */

test("the project description is labelled manual text, never the engine's schedule condition", () => {
  assert.equal(PROJECT_DESCRIPTION_SOURCE, "Project description · entered manually in Project Setup");
  const details = code("./components/project-details-view.tsx");
  assert.match(details, /\{PROJECT_DESCRIPTION_SOURCE\}\s*<\/p>\s*<p className="text-sm text-muted-foreground text-pretty">\s*\{project\.description \?\? "No description provided\."\}/);
  assert.match(details, /Not a calculated schedule condition\. The schedule condition comes only from the Planning Engine\./);
  // The engine's own condition stays "not evaluated" (B4 → 13.14); nothing here derives one.
  assert.equal(SCHEDULE_CONDITION_NOT_EVALUATED, "Not evaluated — thresholds pending B4");
  for (const file of ["./components/project-details-view.tsx", "./components/project-summary-header.tsx", "./components/progress/snapshot-s-curve.tsx"]) {
    assert.doesNotMatch(code(file), /\b(on_track|at_risk|behind)\b|"At Risk"|"On Track"/, file);
  }
});
