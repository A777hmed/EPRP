import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activeNodes,
  ancestorsOf,
  archivedNodes,
  buildStructureTree,
  canAcceptChild,
  canArchiveNode,
  canDeleteNode,
  canMoveNode,
  canRestoreNode,
  canSetReportingFlags,
  childrenByParent,
  childrenOf,
  deepestLevelNumber,
  descendantsOf,
  emptyProjectStructure,
  findReportingOverlaps,
  levelConfigurationIssues,
  nodeInputIssues,
  nodesByLevel,
  parentCandidates,
  pathOf,
  reportingNodes,
  reportingOverlapAfter,
  reportingScope,
  rootNodes,
  sortLevels,
  sortNodes,
  structureCompleteness,
} from "./structure-rules.ts";

/* ------------------------------- fixtures ---------------------------------- */

const level = (n, singular, plural = `${singular}s`) => ({
  id: `L${n}`, projectId: "P", levelNumber: n, singularLabel: singular, pluralLabel: plural, createdAt: "", updatedAt: "",
});
const node = (id, levelNumber, parentId, extra = {}) => ({
  id, projectId: "P", levelNumber, parentId, name: extra.name ?? id, code: extra.code, description: undefined,
  sortOrder: extra.sortOrder ?? 0, weeklyReportingRequired: extra.weekly ?? false,
  monthlyReportingRequired: extra.monthly ?? false, archivedAt: extra.archivedAt, createdAt: "", updatedAt: "",
});

/** Package → Area → Discipline → Team, plus a second package and an archived one. */
const FOUR = [level(1, "Package"), level(2, "Area"), level(3, "Discipline"), level(4, "Team")];
const NODES = [
  node("P2", 1, undefined, { name: "Package B" }),
  node("P1", 1, undefined, { name: "Package A", weekly: true }),
  node("A1", 2, "P1", { name: "Area 1" }),
  node("A2", 2, "P1", { name: "area 0" }),
  node("D1", 3, "A1", { name: "Discipline 1", monthly: true }),
  node("E1", 4, "D1", { name: "Team 1" }),
  node("B1", 2, "P2", { name: "Area B" }),
  node("PX", 1, undefined, { name: "Old package", archivedAt: "2026-10-01T00:00:00Z" }),
];
const structure = { projectId: "P", version: "v1", levels: FOUR, nodes: NODES };
const ids = (list) => list.map((entry) => entry.id);

/* -------------------------------- ordering --------------------------------- */

test("empty structure is levels [] and nodes [], never null or seeded", () => {
  const empty = emptyProjectStructure("P", "v1");
  assert.deepEqual(empty, { projectId: "P", version: "v1", levels: [], nodes: [] });
  assert.deepEqual(rootNodes(empty.nodes), []);
  assert.deepEqual(buildStructureTree(empty), []);
  assert.deepEqual(nodesByLevel(empty), new Map());
  assert.equal(deepestLevelNumber(empty.levels), 0);
  assert.deepEqual(structureCompleteness(empty), {
    levelCount: 0, activeRootCount: 0, emptyLevels: [], activeNodeCount: 0, weeklyUnitCount: 0, monthlyUnitCount: 0,
  });
});

test("ordering is deterministic: level, sort order, name (case-insensitive), id", () => {
  assert.deepEqual(sortLevels([FOUR[2], FOUR[0], FOUR[3], FOUR[1]]).map((l) => l.levelNumber), [1, 2, 3, 4]);
  assert.deepEqual(ids(sortNodes(NODES)), ["PX", "P1", "P2", "A2", "A1", "B1", "D1", "E1"]);
  assert.deepEqual(ids(sortNodes([...NODES].reverse())), ids(sortNodes(NODES)));
  const tied = [node("b", 1, undefined, { name: "Same" }), node("a", 1, undefined, { name: "same" })];
  assert.deepEqual(ids(sortNodes(tied)), ["a", "b"]);
  const ordered = [node("x", 1, undefined, { name: "Zed", sortOrder: 1 }), node("y", 1, undefined, { name: "Alpha", sortOrder: 2 })];
  assert.deepEqual(ids(sortNodes(ordered)), ["x", "y"]);
});

/* ---------------------------------- tree ----------------------------------- */

test("roots, children and the tree, active by default and archived on request", () => {
  assert.deepEqual(ids(rootNodes(NODES)), ["P1", "P2"]);
  assert.deepEqual(ids(rootNodes(NODES, { includeArchived: true })), ["PX", "P1", "P2"]);
  assert.deepEqual(ids(childrenOf(NODES, "P1")), ["A2", "A1"]);
  assert.deepEqual(ids(childrenByParent(NODES).get(null)), ["P1", "P2"]);
  const tree = buildStructureTree(structure);
  assert.deepEqual(tree.map((entry) => entry.node.id), ["P1", "P2"]);
  assert.equal(tree[0].level.singularLabel, "Package");
  assert.deepEqual(tree[0].children.map((entry) => entry.node.id), ["A2", "A1"]);
  assert.equal(tree[0].children[1].children[0].children[0].node.id, "E1");
  assert.equal(tree[0].children[1].children[0].children[0].level.singularLabel, "Team");
});

test("a one-level hierarchy is a flat list of roots", () => {
  const flat = { levels: [level(1, "Work Package")], nodes: [node("W2", 1, undefined, { name: "Beta" }), node("W1", 1, undefined, { name: "Alpha" })] };
  assert.deepEqual(buildStructureTree(flat).map((entry) => [entry.node.id, entry.children.length]), [["W1", 0], ["W2", 0]]);
  assert.deepEqual(canAcceptChild(flat, "W1"), { ok: false, reason: "deepest_level" });
  assert.deepEqual(parentCandidates(flat, 1), []);
  assert.deepEqual(levelConfigurationIssues(flat, [{ id: "L1", levelNumber: 1, singularLabel: "Work Package", pluralLabel: "Work Packages" }]), []);
});

test("active / archived filtering", () => {
  assert.deepEqual(ids(activeNodes(NODES)), ["P1", "P2", "A2", "A1", "B1", "D1", "E1"]);
  assert.deepEqual(ids(archivedNodes(NODES)), ["PX"]);
});

test("ancestor path, full path and descendants", () => {
  assert.deepEqual(ids(ancestorsOf(NODES, "E1")), ["P1", "A1", "D1"]);
  assert.deepEqual(ids(pathOf(NODES, "E1")), ["P1", "A1", "D1", "E1"]);
  assert.deepEqual(ids(ancestorsOf(NODES, "P1")), []);
  assert.deepEqual(ids(descendantsOf(NODES, "P1")), ["A2", "A1", "D1", "E1"]);
  assert.deepEqual(pathOf(NODES, "missing"), []);
  // Corrupt input never loops.
  const loop = [node("a", 2, "b"), node("b", 2, "a")];
  assert.deepEqual(ids(ancestorsOf(loop, "a")), ["b"]);
  assert.deepEqual(ids(descendantsOf(loop, "a")), ["b"]);
});

test("units grouped by level, empty levels included", () => {
  const byLevel = nodesByLevel({ levels: FOUR, nodes: NODES });
  assert.deepEqual([...byLevel.keys()], [1, 2, 3, 4]);
  assert.deepEqual(ids(byLevel.get(2)), ["A2", "A1", "B1"]);
  const sparse = nodesByLevel({ levels: FOUR, nodes: [node("Q", 1)] });
  assert.deepEqual(ids(sparse.get(3)), []);
});

/* ------------------------------- reporting --------------------------------- */

test("Weekly and Monthly operational-input units, active only", () => {
  assert.deepEqual(ids(reportingNodes(NODES, "weekly")), ["P1"]);
  assert.deepEqual(ids(reportingNodes(NODES, "monthly")), ["D1"]);
  const scope = reportingScope(NODES);
  assert.deepEqual([ids(scope.weekly), ids(scope.monthly)], [["P1"], ["D1"]]);
});

test("different reports on one branch are allowed; the same report nested is an overlap", () => {
  // P1 Weekly + D1 Monthly on the same branch: fine.
  assert.deepEqual(findReportingOverlaps(NODES), []);
  assert.deepEqual(reportingOverlapAfter(NODES, { nodeId: "A1", weeklyReportingRequired: true }), ["weekly"]);
  assert.deepEqual(reportingOverlapAfter(NODES, { nodeId: "E1", monthlyReportingRequired: true }), ["monthly"]);
  assert.deepEqual(reportingOverlapAfter(NODES, { nodeId: "A1", monthlyReportingRequired: true }), ["monthly"]);
  assert.deepEqual(reportingOverlapAfter(NODES, { nodeId: "B1", weeklyReportingRequired: true }), []);
  assert.deepEqual(reportingOverlapAfter(NODES, { nodeId: "D1", weeklyReportingRequired: false }), []);
  const nested = [node("x", 1, undefined, { weekly: true }), node("y", 2, "x", { weekly: true })];
  assert.deepEqual(findReportingOverlaps(nested), [{ kind: "weekly", ancestorId: "x", descendantId: "y" }]);
  // Moving an unflagged unit whose descendant is flagged under a flagged parent.
  const move = [...NODES, node("Q2", 2, "P2"), node("Q3", 3, "Q2", { weekly: true })];
  assert.deepEqual(reportingOverlapAfter(move, { nodeId: "Q2", parentId: "P1" }), ["weekly"]);
});

/* ------------------------------ what is allowed ---------------------------- */

test("parent candidates are the active units exactly one level up", () => {
  assert.deepEqual(ids(parentCandidates(structure, 2)), ["P1", "P2"]);
  assert.deepEqual(ids(parentCandidates(structure, 3)), ["A2", "A1", "B1"]);
  assert.deepEqual(parentCandidates(structure, 1), []);
  assert.deepEqual(parentCandidates({ levels: [level(1, "Package")], nodes: NODES }, 2), []);
});

test("accepting a child, moving, archiving, restoring and deleting", () => {
  assert.deepEqual(canAcceptChild(structure, "D1"), { ok: true });
  assert.deepEqual(canAcceptChild(structure, "E1"), { ok: false, reason: "deepest_level" });
  assert.deepEqual(canAcceptChild(structure, "PX"), { ok: false, reason: "archived" });

  assert.deepEqual(canMoveNode(structure, "B1", "P1"), { ok: true });
  assert.deepEqual(canMoveNode(structure, "A1", "P1"), { ok: false, reason: "same_parent" });
  assert.deepEqual(canMoveNode(structure, "D1", "P1"), { ok: false, reason: "wrong_level" });
  assert.deepEqual(canMoveNode(structure, "B1", "PX"), { ok: false, reason: "parent_archived" });

  assert.deepEqual(canArchiveNode(NODES, "E1"), { ok: true });
  assert.deepEqual(canArchiveNode(NODES, "A1"), { ok: false, reason: "active_children" });
  assert.deepEqual(canArchiveNode(NODES, "PX"), { ok: false, reason: "archived" });

  const archivedBranch = NODES.map((n) => (n.id === "D1" || n.id === "E1" ? { ...n, archivedAt: "t", monthlyReportingRequired: false } : n));
  assert.deepEqual(canArchiveNode(archivedBranch, "A1"), { ok: true });
  assert.deepEqual(canRestoreNode(archivedBranch, "E1"), { ok: false, reason: "parent_archived" });
  assert.deepEqual(canRestoreNode(archivedBranch, "D1"), { ok: true });
  assert.deepEqual(canRestoreNode(NODES, "PX"), { ok: true });
  assert.deepEqual(canRestoreNode(NODES, "P1"), { ok: false, reason: "not_archived" });

  assert.deepEqual(canDeleteNode(NODES, "E1"), { ok: true });
  assert.deepEqual(canDeleteNode(archivedBranch, "D1"), { ok: false, reason: "has_children" });

  assert.deepEqual(canSetReportingFlags(NODES, { nodeId: "A1", weeklyReportingRequired: true }), { ok: false, reason: "reporting_overlap" });
  assert.deepEqual(canSetReportingFlags(NODES, { nodeId: "PX", weeklyReportingRequired: true }), { ok: false, reason: "archived" });
  assert.deepEqual(canSetReportingFlags(NODES, { nodeId: "B1", monthlyReportingRequired: true }), { ok: true });
});

/* ------------------------------- validation -------------------------------- */

const levelInput = (n, singular, id) => ({ id, levelNumber: n, singularLabel: singular, pluralLabel: `${singular}s` });

test("level configuration: 1..4 contiguous, labelled, unique", () => {
  const empty = { levels: [], nodes: [] };
  assert.deepEqual(levelConfigurationIssues(empty, []), [{ code: "level_count" }]);
  assert.deepEqual(levelConfigurationIssues(empty, [1, 2, 3, 4, 5].map((n) => levelInput(n, `L${n}`))), [{ code: "level_limit" }]);
  assert.deepEqual(levelConfigurationIssues(empty, [levelInput(1, "A"), levelInput(3, "C")]), [{ code: "level_gap" }]);
  assert.deepEqual(levelConfigurationIssues(empty, [levelInput(1, " ")]).map((i) => i.code), ["label_required"]);
  assert.deepEqual(levelConfigurationIssues(empty, [levelInput(1, "x".repeat(61))]).map((i) => i.code), ["label_too_long", "label_too_long"]);
  assert.deepEqual(levelConfigurationIssues(empty, [levelInput(1, "Area"), levelInput(2, "AREA")]).map((i) => i.code), ["duplicate_label", "duplicate_label"]);
  assert.deepEqual(levelConfigurationIssues(empty, [1, 2, 3, 4].map((n) => levelInput(n, `L${n}`))), []);
});

test("level configuration once units exist: rename in place, append, remove only unused deepest", () => {
  const used = { levels: [level(1, "Plant"), level(2, "Unit")], nodes: [node("p", 1), node("u", 2, "p")] };
  const rename = [levelInput(1, "Site", "L1"), levelInput(2, "Unit", "L2")];
  assert.deepEqual(levelConfigurationIssues(used, rename), []);
  assert.deepEqual(levelConfigurationIssues(used, [...rename, levelInput(3, "Equipment Type")]), []);
  // Inserting a middle level re-purposes level 2: refused.
  // (It also moves a kept id onto an appended number; the RPC reports the
  // in-use level first, and so does the mock's issue priority.)
  assert.deepEqual(levelConfigurationIssues(used, [levelInput(1, "Plant", "L1"), levelInput(2, "Zone"), levelInput(3, "Unit", "L2")]).map((i) => i.code), ["level_in_use", "new_level_has_id"]);
  // Removing a level that has units: refused.
  assert.deepEqual(levelConfigurationIssues(used, [levelInput(1, "Plant", "L1")]).map((i) => i.code), ["level_in_use"]);
  // Removing the deepest unused level: fine.
  const withSpare = { levels: [...used.levels, level(3, "Equipment Type")], nodes: used.nodes };
  assert.deepEqual(levelConfigurationIssues(withSpare, rename), []);
});

test("new unit validation mirrors the database rules", () => {
  const codes = (input) => nodeInputIssues(structure, input).map((issue) => issue.code);
  assert.deepEqual(codes({ levelNumber: 1, name: "Package C" }), []);
  assert.deepEqual(codes({ levelNumber: 1, name: " " }), ["name_required"]);
  assert.deepEqual(codes({ levelNumber: 1, name: "package a" }), ["duplicate_name"]);
  assert.deepEqual(codes({ levelNumber: 2, parentId: "P2", name: "Area 1" }), []);
  assert.deepEqual(codes({ levelNumber: 2, name: "Orphan" }), ["parent_required"]);
  assert.deepEqual(codes({ levelNumber: 1, parentId: "P1", name: "Rooted" }), ["parent_not_allowed"]);
  assert.deepEqual(codes({ levelNumber: 3, parentId: "P1", name: "Skip" }), ["parent_level"]);
  assert.deepEqual(codes({ levelNumber: 2, parentId: "PX", name: "Under archived" }), ["parent_archived"]);
  assert.deepEqual(codes({ levelNumber: 5, name: "Too deep" }), ["level_undefined"]);
  assert.deepEqual(codes({ levelNumber: 2, parentId: "P1", name: "Area 9", weeklyReportingRequired: true }), ["reporting_overlap"]);
  assert.deepEqual(codes({ levelNumber: 2, parentId: "P1", name: "Area 9", monthlyReportingRequired: true }), []);
  const coded = { ...structure, nodes: [...NODES, node("C1", 1, undefined, { name: "Coded", code: "PKG-1" })] };
  assert.deepEqual(nodeInputIssues(coded, { levelNumber: 1, name: "Other", code: "pkg-1" }).map((i) => i.code), ["duplicate_code"]);
});

test("completeness primitives are facts, not a verdict", () => {
  assert.deepEqual(structureCompleteness(structure), {
    levelCount: 4, activeRootCount: 2, emptyLevels: [], activeNodeCount: 7, weeklyUnitCount: 1, monthlyUnitCount: 1,
  });
  assert.deepEqual(structureCompleteness({ levels: FOUR, nodes: [node("Q", 1)] }).emptyLevels, [2, 3, 4]);
});

test("no PSM fallback: the rules know nothing about departments, systems, disciplines or Planning", () => {
  const source = readFileSync(new URL("./structure-rules.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /department|\bsystems?\b|discipline|planning|wbs/i);
  assert.match(source, /^import \{[\s\S]+?\} from "@\/types\/project-structure";/m);
  assert.doesNotMatch(source, /from "@\/services|from "react"/);
});

test("an appended level never carries an id once units exist (as the committed RPC requires)", () => {
  const used = { levels: [level(1, "Plant"), level(2, "Unit")], nodes: [node("p", 1), node("u", 2, "p")] };
  const kept = [levelInput(1, "Plant", "L1"), levelInput(2, "Unit", "L2")];
  assert.deepEqual(levelConfigurationIssues(used, [...kept, levelInput(3, "Team", "L1")]).map((i) => i.code), ["new_level_has_id"]);
  assert.deepEqual(levelConfigurationIssues(used, [...kept, levelInput(3, "Team", "some-other-id")]).map((i) => i.code), ["new_level_has_id"]);
  assert.deepEqual(levelConfigurationIssues(used, [...kept, levelInput(3, "Team")]), []);
  // With no units yet, ids are ignored — exactly as the RPC ignores them.
  assert.deepEqual(levelConfigurationIssues({ levels: used.levels, nodes: [] }, [...kept, levelInput(3, "Team", "L1")]), []);
});

test("move and restore preflight the active name / code conflicts the database would refuse", () => {
  const nodes = [
    node("P1", 1, undefined, { name: "Package A" }),
    node("P2", 1, undefined, { name: "Package B" }),
    node("A1", 2, "P1", { name: "Area 1", code: "AR-1" }),
    node("B1", 2, "P2", { name: "area 1" }),
    node("OLD", 2, "P2", { name: "Area 1", code: "ar-1", archivedAt: "t" }),
    node("OLD2", 2, "P2", { name: "Area 9", code: "AR-1", archivedAt: "t" }),
    node("OLD3", 1, undefined, { name: "package a", archivedAt: "t" }),
  ];
  const s = { levels: FOUR, nodes };
  // Moving Area 1 under Package B, which already has an active "area 1".
  assert.deepEqual(canMoveNode(s, "A1", "P2"), { ok: false, reason: "duplicate_name" });
  // An archived unit may move next to a same-named active one (it is not checked while archived).
  assert.deepEqual(canMoveNode({ levels: FOUR, nodes: [...nodes, node("OLD4", 2, "P1", { name: "area 1", archivedAt: "t" })] }, "OLD4", "P2"), { ok: true });
  // Restoring under a sibling that took the name, or with a code now in use.
  assert.deepEqual(canRestoreNode(nodes, "OLD"), { ok: false, reason: "duplicate_name" });
  assert.deepEqual(canRestoreNode(nodes, "OLD2"), { ok: false, reason: "duplicate_code" });
  assert.deepEqual(canRestoreNode(nodes, "OLD3"), { ok: false, reason: "duplicate_name" });
  assert.deepEqual(canRestoreNode(nodes.filter((n) => n.id !== "A1"), "OLD2"), { ok: true });
});
