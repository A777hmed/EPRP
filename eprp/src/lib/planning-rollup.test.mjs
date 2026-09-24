import assert from "node:assert/strict";
import test from "node:test";

import { rollupFromOpeningPosition } from "./planning-rollup.ts";

/* --------------------------- rollupFromOpeningPosition ----------------------- */

test("opening-position rollup: a fully declared position reports real, non-zero figures", () => {
  const rollup = rollupFromOpeningPosition({ plannedProgressPercent: 18, actualProgressPercent: 15 });
  assert.equal(rollup.plannedProgress, 18);
  assert.equal(rollup.actualProgress, 15);
  assert.equal(rollup.variance, -3);
  assert.equal(rollup.coveragePercent, 100);
});

test("opening-position rollup: a figure never declared is null, never coerced to 0", () => {
  const rollup = rollupFromOpeningPosition({ plannedProgressPercent: 18 });
  assert.equal(rollup.plannedProgress, 18);
  assert.equal(rollup.actualProgress, null);
  assert.equal(rollup.variance, null);
  assert.equal(rollup.coveragePercent, 0);
});

test("opening-position rollup: nothing declared at all is null/null, never 0/0", () => {
  const rollup = rollupFromOpeningPosition({});
  assert.equal(rollup.plannedProgress, null);
  assert.equal(rollup.actualProgress, null);
  assert.equal(rollup.coveragePercent, 0);
});
