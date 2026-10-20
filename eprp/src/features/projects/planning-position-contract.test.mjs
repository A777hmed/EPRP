import assert from "node:assert/strict";
import test from "node:test";

import { computeRollupFromActivities, rollupFromOpeningPosition } from "../../lib/planning-rollup.ts";
import {
  PLANNING_POSITION_BASIS_LABEL,
  planningFigureText,
  resolvePlanningPosition,
} from "./planning-position-contract.ts";

/* Phase 13.10 — the planning consumer contract (`docs/02` §26.2, §26.8,
   §26.14). One resolution for Dashboard, Weekly, Monthly, Executive and
   Project Setup; semantic figures; provenance on every position. */

const snapshot = (overrides = {}) => ({
  id: "snap-3",
  projectId: "p1",
  version: 3,
  dataDate: "2026-10-31",
  publishedAt: "2026-11-01T08:00:00Z",
  publishedByContactId: "contact-pc",
  isOpeningSnapshot: false,
  sourceImportBatchId: "batch-7",
  sourceOpeningPositionId: undefined,
  ...overrides,
});

const legacyRollup = computeRollupFromActivities([
  { weightPercent: 60, percentCompletePlanned: 50, percentCompletePhysical: 40, plannedValue: 100, earnedValue: 80 },
  { weightPercent: 40, percentCompletePlanned: 25, percentCompletePhysical: 25, plannedValue: 50, earnedValue: 50 },
]);

const entry = (overrides = {}) => ({
  id: "rp-1",
  projectId: "p1",
  dataDate: "2026-10-15",
  entryKind: "report",
  reportedPlannedPercent: 40,
  reportedActualPercent: 35,
  narrative: null,
  supersedesEntryId: null,
  reason: null,
  isBackdated: false,
  source: "eprp_entry",
  recordedBy: "contact-pc",
  recordedByName: "PC Holder",
  recordedAt: "2026-10-16T09:00:00Z",
  ...overrides,
});

/* ------------------------------- Bases ----------------------------------- */

test("legacy snapshot: its own flat figures, labelled legacy calculation, with full provenance", () => {
  const position = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "new_project",
    snapshot: snapshot(),
    rollup: legacyRollup,
  });
  assert.equal(position.basis, "legacy_snapshot");
  assert.equal(position.label, "Published Planning Snapshot — legacy calculation");
  assert.equal(position.governance, "governed");
  assert.deepEqual(position.plannedProgress, { state: "value", value: 40 });
  assert.deepEqual(position.actualProgress, { state: "value", value: 34 });
  assert.equal(position.spi.state, "value");
  assert.ok(Math.abs(position.spi.value - 130 / 150) < 1e-12, "legacy SPI is the snapshot's EV/PV, never Actual%/Planned%");
  assert.deepEqual(position.provenance, {
    kind: "snapshot",
    projectId: "p1",
    snapshotId: "snap-3",
    snapshotVersion: 3,
    dataDate: "2026-10-31",
    publishedAt: "2026-11-01T08:00:00Z",
    publishedByContactId: "contact-pc",
    source: "schedule_import",
    sourceId: "batch-7",
    calculation: "legacy",
    engineVersion: null,
  });
});

test("legacy snapshot without planned/earned value data: SPI 'Not available', never 0 or 1", () => {
  const rollup = computeRollupFromActivities([{ weightPercent: 100, percentCompletePlanned: 50, percentCompletePhysical: 45 }]);
  const position = resolvePlanningPosition({ projectId: "p1", onboardingMode: "new_project", snapshot: snapshot(), rollup });
  assert.deepEqual(position.spi, { state: "not_available", reason: "no_value_data" });
  assert.equal(planningFigureText(position.spi, "ratio"), "Not available");
});

test("v2 snapshot (13.12+): engine figures, engine version in provenance, coverage 100%", () => {
  const position = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "new_project",
    snapshot: snapshot(),
    rollup: legacyRollup,
    engineFigures: { engineVersion: "1.0.0", pv: 52.04, ev: 49.475 },
  });
  assert.equal(position.basis, "planning_snapshot");
  assert.equal(position.provenance.calculation, "engine");
  assert.equal(position.provenance.engineVersion, "1.0.0");
  assert.equal(position.variance.value.toFixed(3), "-2.565");
  assert.equal(planningFigureText(position.spi, "ratio"), "0.95");
  assert.deepEqual(position.coverage, { state: "value", value: 100 });
});

test("Opening Position snapshot: declared figures, SPI N/A — even if engine figures were passed", () => {
  const position = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "existing_active_project",
    snapshot: snapshot({ id: "snap-1", version: 1, isOpeningSnapshot: true, sourceImportBatchId: undefined, sourceOpeningPositionId: "op-1" }),
    rollup: rollupFromOpeningPosition({ plannedProgressPercent: 18, actualProgressPercent: 15 }),
    engineFigures: { engineVersion: "1.0.0", pv: 1, ev: 1 },
  });
  assert.equal(position.basis, "opening_position");
  assert.deepEqual(position.spi, { state: "not_applicable", reason: "declared_position" });
  assert.equal(position.provenance.source, "opening_position");
  assert.equal(position.provenance.sourceId, "op-1");
  assert.equal(position.provenance.calculation, "declared");
  assert.equal(planningFigureText(position.variance, "points"), "-3 pts");
});

test("C4: no published plan is 'No published plan' on every figure — never 0%", () => {
  const position = resolvePlanningPosition({ projectId: "p1", onboardingMode: "new_project", snapshot: null, rollup: null });
  assert.equal(position.basis, "none");
  assert.equal(position.governance, "awaiting-snapshot");
  assert.equal(position.provenance, null);
  for (const key of ["plannedProgress", "actualProgress", "variance", "spi", "coverage"]) {
    assert.deepEqual(position[key], { state: "not_available", reason: "no_published_plan" }, key);
  }
  assert.equal(planningFigureText(position.plannedProgress, "percent"), "No published plan");
});

test("a project with no Planning settings row yet reads 'No published plan'", () => {
  const position = resolvePlanningPosition({ projectId: "p1", onboardingMode: null, snapshot: null, rollup: null });
  assert.equal(position.basis, "none");
});

/* --------------------------- no_formal_schedule -------------------------- */

test("no_formal_schedule: the latest Reported Progress entry, labelled not planning governed, SPI N/A", () => {
  const position = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "no_formal_schedule",
    snapshot: null,
    rollup: null,
    reportedProgress: [entry(), entry({ id: "rp-2", dataDate: "2026-10-29", reportedPlannedPercent: 50, reportedActualPercent: 42 })],
  });
  assert.equal(position.basis, "reported");
  assert.equal(position.label, "Reported — not planning governed");
  assert.equal(position.governance, "not-governed");
  assert.deepEqual(position.plannedProgress, { state: "value", value: 50 });
  assert.deepEqual(position.actualProgress, { state: "value", value: 42 });
  assert.deepEqual(position.variance, { state: "value", value: -8 });
  assert.deepEqual(position.spi, { state: "not_applicable", reason: "not_planning_governed" });
  assert.equal(planningFigureText(position.spi, "ratio"), "N/A");
  assert.deepEqual(position.provenance, {
    kind: "reported_progress",
    projectId: "p1",
    entryId: "rp-2",
    dataDate: "2026-10-29",
    recordedAt: "2026-10-16T09:00:00Z",
    recordedBy: "contact-pc",
    recordedByName: "PC Holder",
    source: "eprp_entry",
  });
});

test("no_formal_schedule: valid with no entry yet — figures 'Not available', never fabricated", () => {
  const position = resolvePlanningPosition({ projectId: "p1", onboardingMode: "no_formal_schedule", snapshot: null, rollup: null });
  assert.equal(position.basis, "reported");
  assert.equal(position.provenance, null);
  assert.equal(position.actualProgress.state, "not_available");
  assert.equal(position.spi.state, "not_applicable");
});

test("no_formal_schedule: reported planned % not stated → variance not available, actual still shown", () => {
  const position = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "no_formal_schedule",
    snapshot: null,
    rollup: null,
    reportedProgress: [entry({ reportedPlannedPercent: null })],
  });
  assert.equal(position.plannedProgress.state, "not_available");
  assert.deepEqual(position.actualProgress, { state: "value", value: 35 });
  assert.equal(position.variance.state, "not_available");
});

test("no_formal_schedule: a correction supersedes; a withdrawal falls back to the previous Data Date", () => {
  const corrected = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "no_formal_schedule",
    snapshot: null,
    rollup: null,
    reportedProgress: [entry(), entry({ id: "rp-1c", entryKind: "correction", supersedesEntryId: "rp-1", reportedActualPercent: 37, reason: "typo" })],
  });
  assert.equal(corrected.provenance.entryId, "rp-1c");
  assert.deepEqual(corrected.actualProgress, { state: "value", value: 37 });

  const withdrawn = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "no_formal_schedule",
    snapshot: null,
    rollup: null,
    reportedProgress: [
      entry(),
      entry({ id: "rp-2", dataDate: "2026-10-29" }),
      entry({ id: "rp-2w", dataDate: "2026-10-29", entryKind: "withdrawal", supersedesEntryId: "rp-2", reportedActualPercent: null, reportedPlannedPercent: null, reason: "wrong" }),
    ],
  });
  assert.equal(withdrawn.provenance.entryId, "rp-1");
});

test("no_formal_schedule: a historical report period sees only entries on or before its end", () => {
  const position = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "no_formal_schedule",
    snapshot: null,
    rollup: null,
    reportedProgress: [entry(), entry({ id: "rp-2", dataDate: "2026-10-29", reportedActualPercent: 42 })],
    asOf: "2026-10-20",
  });
  assert.equal(position.provenance.entryId, "rp-1");
});

test("a published snapshot governs whatever the onboarding mode (§26.14)", () => {
  const position = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "no_formal_schedule",
    snapshot: snapshot(),
    rollup: legacyRollup,
    reportedProgress: [entry()],
  });
  assert.equal(position.basis, "legacy_snapshot");
  assert.equal(position.governance, "governed");
});

/* ------------------------- Safety / immutability ------------------------- */

test("a snapshot belonging to another project is never used", () => {
  const position = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "new_project",
    snapshot: snapshot({ projectId: "p2" }),
    rollup: legacyRollup,
  });
  assert.equal(position.basis, "none");
});

test("historical: a report pinned to an older snapshot keeps that snapshot's figures after a newer publish", () => {
  const pinned = { projectId: "p1", onboardingMode: "new_project", snapshot: snapshot({ id: "snap-2", version: 2, dataDate: "2026-09-30" }), rollup: legacyRollup };
  const before = JSON.stringify(resolvePlanningPosition(pinned));
  // A later publish exists, but the pinned input is unchanged — so is the answer.
  resolvePlanningPosition({ ...pinned, snapshot: snapshot({ id: "snap-9", version: 9 }) });
  assert.equal(JSON.stringify(resolvePlanningPosition(pinned)), before);
  assert.equal(resolvePlanningPosition(pinned).provenance.snapshotId, "snap-2");
});

test("archived projects: reads are unaffected — the contract resolves the same position", () => {
  // 13.9: archived projects refuse every planning write at the data boundary;
  // their published history stays fully readable. The contract has no
  // archive input because nothing about a read changes.
  const input = { projectId: "p1", onboardingMode: "new_project", snapshot: snapshot(), rollup: legacyRollup };
  assert.deepEqual(resolvePlanningPosition(input), resolvePlanningPosition(structuredClone(input)));
});

test("null safety: undefined optional inputs never surface as raw null/undefined figures", () => {
  const position = resolvePlanningPosition({
    projectId: "p1",
    onboardingMode: "new_project",
    snapshot: snapshot({ dataDate: undefined, publishedByContactId: undefined, sourceImportBatchId: undefined }),
    rollup: null,
  });
  for (const key of ["plannedProgress", "actualProgress", "variance", "spi", "coverage"]) {
    assert.ok(["value", "not_available", "not_applicable"].includes(position[key].state), key);
  }
  assert.equal(position.provenance.dataDate, null);
  assert.equal(position.provenance.source, "manual");
  assert.equal(position.provenance.publishedByContactId, null);
});

test("display text: rounding conventions match the existing surfaces; absence is words, never 0", () => {
  assert.equal(planningFigureText({ state: "value", value: 52.04 }, "percent"), "52%");
  assert.equal(planningFigureText({ state: "value", value: 49.475 }, "percent"), "49.5%");
  assert.equal(planningFigureText({ state: "value", value: 4 }, "points"), "+4 pts");
  assert.equal(planningFigureText({ state: "value", value: 0.950711 }, "ratio"), "0.95");
  assert.equal(planningFigureText({ state: "not_applicable", reason: "pv_zero" }, "ratio"), "N/A");
  assert.equal(PLANNING_POSITION_BASIS_LABEL.none, "No published plan");
});
