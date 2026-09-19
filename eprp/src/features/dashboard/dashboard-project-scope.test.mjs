import assert from "node:assert/strict";
import test from "node:test";

import { dashboardProjectScope } from "./dashboard-project-scope.ts";

const projects = [
  { id: "active-1", name: "Alpha", status: "active", actual: 40, reported: true },
  { id: "active-2", name: "Bravo", status: "planning", actual: 60, reported: true },
  { id: "active-3", name: "Charlie", status: "on_hold", actual: 0, reported: false },
  { id: "archived-1", name: "Alpha", status: "archived", actual: 100, reported: true },
  { id: "archived-2", name: "Legacy", status: "archived", actual: 100, reported: true },
];

test("archived projects are absent from the canonical Dashboard project list", () => {
  const scoped = dashboardProjectScope(projects);

  assert.deepEqual(
    scoped.map((project) => project.id),
    ["active-1", "active-2", "active-3"]
  );
  assert.deepEqual(scoped.map((project) => project.name), ["Alpha", "Bravo", "Charlie"]);
  assert.equal(scoped.some((project) => project.status === "archived"), false);
});

test("archived projects cannot affect Dashboard counts or aggregates", () => {
  const scoped = dashboardProjectScope(projects);
  const reported = scoped.filter((project) => project.reported);
  const actualMean = reported.reduce((sum, project) => sum + project.actual, 0) / reported.length;

  assert.equal(scoped.length, 3);
  assert.equal(reported.length, 2);
  assert.equal(actualMean, 50);
});

test("archived project ids cannot enter Dashboard child collections", () => {
  const scopedIds = new Set(dashboardProjectScope(projects).map((project) => project.id));
  const milestones = [
    { id: "m-active", projectId: "active-1" },
    { id: "m-archived", projectId: "archived-1" },
  ];

  assert.deepEqual(
    milestones.filter((milestone) => scopedIds.has(milestone.projectId)),
    [{ id: "m-active", projectId: "active-1" }]
  );
});
