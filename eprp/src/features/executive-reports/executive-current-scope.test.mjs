import assert from "node:assert/strict";
import test from "node:test";

import { currentExecutiveScope } from "./executive-current-scope.ts";

const projects = [
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `current-${index + 1}`,
    status: index === 0 ? "planning" : index === 1 ? "on_hold" : "active",
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `legacy-${index + 1}`,
    status: "archived",
  })),
];

test("current Executive scope contains the six non-archived demo projects", () => {
  const scoped = currentExecutiveScope(projects);

  assert.equal(scoped.length, 6);
  assert.deepEqual(
    scoped.map((project) => project.id),
    ["current-1", "current-2", "current-3", "current-4", "current-5", "current-6"]
  );
  assert.equal(scoped.some((project) => project.status === "archived"), false);
});

test("archived projects cannot enter current Executive child collections", () => {
  const scopedIds = new Set(currentExecutiveScope(projects).map((project) => project.id));
  const milestones = [
    { id: "m-current", projectId: "current-1" },
    { id: "m-legacy", projectId: "legacy-1" },
  ];

  assert.deepEqual(
    milestones.filter((milestone) => scopedIds.has(milestone.projectId)),
    [{ id: "m-current", projectId: "current-1" }]
  );
});
