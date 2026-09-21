import assert from "node:assert/strict";
import test from "node:test";

import { monthlyDisplayFigures } from "../monthly-reports/planning-integration.ts";

test("Executive-compatible Monthly figures remain on the report's supplied pinned snapshot", () => {
  const report = {
    plannedProgress: 99,
    actualProgress: 99,
    scheduleVariance: 0,
    spi: 1,
  };
  const pinnedRollup = {
    snapshotId: "snapshot-september-pinned",
    snapshotVersion: 4,
    dataDate: "2026-09-30",
    plannedProgress: 72,
    actualProgress: 61,
    variance: -11,
    spi: 0.84,
    coveragePercent: 95,
  };

  assert.deepEqual(monthlyDisplayFigures(report, pinnedRollup), {
    planned: 72,
    actual: 61,
    variance: -11,
    spi: 0.84,
    planningBacked: true,
    snapshotVersion: 4,
    dataDate: "2026-09-30",
    coveragePercent: 95,
  });
});
