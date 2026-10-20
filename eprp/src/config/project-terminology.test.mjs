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

/* ---- 13.9B UAT: an amended Project Category must not relabel a PSM project ---- */

const ASSET_INTEGRITY = { id: "t5", name: "Asset Integrity", code: "AI", active: true };

test("an unclassified PSM project keeps Programs & Studies after its category is amended to a non-PSM one", () => {
  // MDP-PSAIM-01: no family; Project Category amended PSAIM-DEMO -> Asset Integrity.
  const legacy = { code: "MDP-PSAIM-01" };
  assert.equal(isPsmProject(legacy, ASSET_INTEGRITY), true);
  assert.equal(hierarchyTermsForProject(legacy, ASSET_INTEGRITY), PSM_HIERARCHY_TERMS);
  assert.equal(hierarchyTermsForProject(legacy, undefined).plural, "Programs & Studies");
  assert.equal(PSM_HIERARCHY_TERMS.plural, "Programs & Studies");
  assert.equal(hierarchyTermsForProject({ code: "PSM-ALPHA" }, ASSET_INTEGRITY), PSM_HIERARCHY_TERMS);
});

test("the code fallback never touches an Other project, a classified project or a non-PSM legacy project", () => {
  // An explicit family always wins over the code.
  assert.equal(isPsmProject({ structureFamily: "other", code: "MDP-PSAIM-01" }, null), false);
  assert.equal(hierarchyTermsForProject({ structureFamily: "other", code: "MDP-PSAIM-01" }, null), DEFAULT_HIERARCHY_TERMS);
  assert.equal(isPsmProject({ structureFamily: "psm", code: "ZZ-1" }, ASSET_INTEGRITY), true);
  // A legacy project with no PSM type and no PSM token keeps Disciplines.
  assert.equal(hierarchyTermsForProject({ code: "MDP-AIM-01" }, ASSET_INTEGRITY), DEFAULT_HIERARCHY_TERMS);
  assert.equal(hierarchyTermsForProject({ code: "PRJ-2025-0007" }, INSPECTION), DEFAULT_HIERARCHY_TERMS);
  // The token must be a whole word (PSAIMX / EPSM are not PSM).
  assert.equal(isPsmProject({ code: "MDP-PSAIMX-01" }, null), false);
  assert.equal(isPsmProject({ code: "EPSM-01" }, null), false);
  assert.equal(isPsmProject({}, null), false);
  assert.equal(isPsmProject({ code: undefined }, undefined), false);
});

test("every project surface resolves wording through the one resolver, passing the project code", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["../features/projects/use-hierarchy-terms.ts", "../features/weekly-reports/use-hierarchy-terms.ts"]) {
    const hook = readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r", "");
    assert.match(hook, /const code = project\?\.code;/, file);
    assert.match(hook, /hierarchyTermsForProject\(\{ code \}, type\)/, file);
    assert.match(hook, /\[projectTypeId, structureFamily, code, records\]/, file);
  }
  // The static workflow / section / nav labels are localised from the same terms.
  const workflow = readFileSync(new URL("../features/projects/use-project-workflow.ts", import.meta.url), "utf8");
  assert.match(workflow, /localizeProjectWorkflowStep\(step, terms\)/);
  const nav = readFileSync(new URL("../features/projects/components/project-section-nav.tsx", import.meta.url), "utf8");
  assert.match(nav, /terms\.plural|terms\)/);
});
