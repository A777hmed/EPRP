import type {
  OrganizationPosition,
  OrganizationPositionNode,
} from "@/types";

/**
 * Pure hierarchy helpers for organization charts.
 *
 * Kept free of any I/O so both the mock and Supabase services share exactly
 * one implementation of the tree rules, and so those rules can be exercised
 * on their own.
 */

/**
 * Assemble a flat position list into a tree.
 *
 * The tree is always derived, never stored — the database holds only
 * `parentPositionId` and `sortOrder`.
 */
export function buildPositionTree(
  positions: OrganizationPosition[]
): OrganizationPositionNode[] {
  const nodes = new Map<string, OrganizationPositionNode>();
  for (const position of positions) {
    nodes.set(position.id, {
      ...structuredClone(position),
      children: [],
      depth: 0,
    });
  }

  const roots: OrganizationPositionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentPositionId
      ? nodes.get(node.parentPositionId)
      : undefined;
    // A position whose parent is missing from this list (archived, filtered
    // out) is treated as a root, so no branch silently disappears.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRecursive = (list: OrganizationPositionNode[], depth: number) => {
    list.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)
    );
    for (const node of list) {
      node.depth = depth;
      sortRecursive(node.children, depth + 1);
    }
  };
  sortRecursive(roots, 0);

  return roots;
}

/**
 * Whether `candidateParentId` sits inside the subtree rooted at
 * `positionId` — the check that stops a move from creating a cycle.
 *
 * The database enforces that a parent lives in the same chart, but it cannot
 * see cycles, so this runs before every move.
 */
export function wouldCreateCycle(
  positions: OrganizationPosition[],
  positionId: string,
  candidateParentId: string | undefined
): boolean {
  if (!candidateParentId) return false;
  if (candidateParentId === positionId) return true;

  const byId = new Map(positions.map((position) => [position.id, position]));
  let cursor = byId.get(candidateParentId);
  const seen = new Set<string>();
  while (cursor?.parentPositionId) {
    // Already-corrupt data must not hang the walk.
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    if (cursor.parentPositionId === positionId) return true;
    cursor = byId.get(cursor.parentPositionId);
  }
  return false;
}

/** Every descendant of a position, for cascading a soft delete down a branch. */
export function collectDescendantIds(
  positions: OrganizationPosition[],
  positionId: string
): Set<string> {
  const collected = new Set<string>([positionId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const position of positions) {
      if (
        position.parentPositionId &&
        collected.has(position.parentPositionId) &&
        !collected.has(position.id)
      ) {
        collected.add(position.id);
        grew = true;
      }
    }
  }
  return collected;
}

/**
 * A copy of the tree in which collapsed nodes keep their place but lose
 * their children, so the layout draws them as leaves.
 *
 * Collapsing is a view concern — nothing about it is persisted, and the
 * underlying parentage is untouched.
 */
export function pruneCollapsed(
  roots: OrganizationPositionNode[],
  collapsedIds: ReadonlySet<string>
): OrganizationPositionNode[] {
  const visit = (node: OrganizationPositionNode): OrganizationPositionNode => ({
    ...node,
    children: collapsedIds.has(node.id) ? [] : node.children.map(visit),
  });
  return roots.map(visit);
}

/** Direct child count for every position, taken from the unpruned tree. */
export function childCountById(
  roots: OrganizationPositionNode[]
): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: OrganizationPositionNode) => {
    counts.set(node.id, node.children.length);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return counts;
}

/**
 * Sibling ids in their new order after nudging one of them.
 *
 * Returns the input unchanged when the move would fall off either end, so
 * callers can skip a no-op write.
 */
export function reorderSiblingIds(
  orderedIds: string[],
  positionId: string,
  direction: "up" | "down"
): string[] {
  const index = orderedIds.indexOf(positionId);
  if (index === -1) return orderedIds;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= orderedIds.length) return orderedIds;

  const next = [...orderedIds];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * The positions that share a parent with `positionId`, in display order —
 * the group a reorder operates on.
 */
export function siblingsOf(
  positions: OrganizationPosition[],
  positionId: string
): OrganizationPosition[] {
  const position = positions.find((candidate) => candidate.id === positionId);
  if (!position) return [];
  const parentId = position.parentPositionId ?? undefined;
  return positions
    .filter(
      (candidate) => (candidate.parentPositionId ?? undefined) === parentId
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}
