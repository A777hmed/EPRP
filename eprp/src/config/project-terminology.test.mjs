import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_HIERARCHY_TERMS,
  PSM_HIERARCHY_TERMS,
  hierarchyTermsFor,
  hierarchyTermsForProject,
  isPsmProject,
  isPsmProjectType,
} from "./project-terminology.ts";

const PSAIM = { id: "t1", name: "Process Safety and Asset Integrity", code: "PSAIM-01", active: true };
const AIM = { id: "t2", name: "Asset Integrity Management", code: "AIM-01", active: true };
const INSPECTION = { id: "t3", name: "Inspection", code: "INSP", active: true };
const NAME_ONLY_PSM = { id: "t4", name: "Process Safety Program", active: true };

test("project-type inference is unchanged: PSAIM-01 is PSM, AIM-01 is not", () => {
  assert.equal(isPsmProjectType(PSAIM), true);
  assert.equal(isPsmProjectType(AIM), false);
  assert.equal(isPsmProjectType(INSPECTION), false);
  assert.equal(isPsmProjectType(NAME_ONLY_PSM), true);
  assert.equal(isPsmProjectType(undefined), false);
  assert.equal(hierarchyTermsFor(AIM), DEFAULT_HIERARCHY_TERMS);
});

test("an explicit structureFamily overrides the project-type inference", () => {
  // Classified Other, even though the stored type is a PSM-family row.
  assert.equal(isPsmProject({ structureFamily: "other" }, PSAIM), false);
  // Classified PSM with no category at all still gets PSM wording.
  assert.equal(isPsmProject({ structureFamily: "psm" }, null), true);
  assert.equal(isPsmProject({ structureFamily: "psm" }, INSPECTION), true);
  assert.equal(hierarchyTermsForProject({ structureFamily: "psm" }, undefined), PSM_HIERARCHY_TERMS);
  assert.equal(hierarchyTermsForProject({ structureFamily: "other" }, PSAIM), DEFAULT_HIERARCHY_TERMS);
});

test("a legacy project with no family falls back to the existing inference", () => {
  assert.equal(isPsmProject({}, PSAIM), true);
  assert.equal(isPsmProject({ structureFamily: undefined }, AIM), false);
  assert.equal(isPsmProject(null, PSAIM), true);
  assert.equal(hierarchyTermsForProject({}, PSAIM), PSM_HIERARCHY_TERMS);
  assert.equal(hierarchyTermsForProject({}, AIM), DEFAULT_HIERARCHY_TERMS);
});
