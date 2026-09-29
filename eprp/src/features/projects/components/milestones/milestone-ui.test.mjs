import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { milestoneStates, registerProgress } from "../../milestone-state.ts";
import { milestoneFormInput } from "./milestone-form-input.ts";

const milestone = (type, overrides = {}) => ({
  id: `m-${type}`,
  projectId: "project-1",
  code: `M-${type}`,
  name: `${type} milestone`,
  priority: "high",
  type,
  source: "manual",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  clientApprovalRequired: false,
  isAdvancePayment: false,
  ...overrides,
});

const approved = (id, overrides = {}) => ({
  id: `u-${id}`,
  milestoneId: id,
  source: "weekly",
  status: "in_progress",
  approvalStatus: "approved",
  isRegression: false,
  submittedAt: "2026-09-01T00:00:00Z",
  ...overrides,
});

test("new milestone keeps the existing priority and type defaults", () => {
  const input = milestoneFormInput();
  assert.equal(input.priority, "medium");
  assert.equal(input.type, "technical");
  assert.equal(input.code, "");
});

test("editing preserves hidden priority and all three persisted milestone types", () => {
  for (const type of ["technical", "contractual", "commercial"]) {
    const input = milestoneFormInput(
      milestone(type, {
        priority: "critical",
        paymentPercent: type === "commercial" ? 10 : undefined,
        paymentAmount: type === "commercial" ? 1000 : undefined,
      })
    );
    const edited = { ...input, name: "Revised milestone" };
    assert.equal(edited.priority, "critical");
    assert.equal(edited.type, type);
    if (type === "commercial") {
      assert.equal(edited.paymentPercent, "10");
      assert.equal(edited.paymentAmount, "1000");
    }
  }
});

test("commercial payment remains separate from technical and contractual physical progress", () => {
  const rows = [
    milestone("technical", { weightPercent: 50 }),
    milestone("contractual", { weightPercent: 50 }),
    milestone("commercial", { paymentPercent: 10, paymentAmount: 1000 }),
  ];
  const updates = [
    approved("m-technical", { progressPercent: 40 }),
    approved("m-contractual", { progressPercent: 60 }),
    approved("m-commercial", { paymentStatus: "received" }),
  ];
  const states = milestoneStates(rows, updates);
  const result = registerProgress(states);
  assert.equal(result.physicalPercent, 50);
  assert.equal(result.commercialPercent, 100);
  assert.equal(result.commercialValue, 1000);
  assert.equal(result.receivedValue, 1000);
});

test("project labels change while the kpis route and milestone type control remain", () => {
  const text = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
  const sections = text("../../../../config/project-sections.ts");
  const overviewNav = text("../project-section-nav.tsx");
  const overview = text("../project-details-view.tsx");
  const page = text("../sections/project-section-view.tsx");
  const form = text("./milestone-form-dialog.tsx");
  const register = text("./milestones-panel.tsx");
  const service = text("../../../../services/milestone-service.ts");

  assert.match(sections, /id: "kpis",\s*label: "Project Progress"/);
  assert.match(sections, /return `\/projects\/\$\{projectId\}\/\$\{section\}`/);
  assert.match(overviewNav, /id: "kpis", label: "Project Progress"/);
  assert.match(overview, /<Section id="kpis">[\s\S]*?title="Project Progress"/);
  assert.match(page, /case "kpis":[\s\S]*?return <KpiSection/);
  assert.match(page, /title="Project Progress"/);
  assert.match(form, /<Label htmlFor="milestone-type">Milestone type<\/Label>/);
  assert.match(form, /const TYPES: MilestoneType\[\] = \["technical", "contractual", "commercial"\]/);
  assert.match(service, /milestone_type: input\.type/);
  assert.match(register, /<Select value=\{typeFilter\}/);
  assert.doesNotMatch(form, /milestone-priority|Priority \/ criticality/);
  assert.doesNotMatch(register, /PRIORITY_META|milestone\.priority/);
});
