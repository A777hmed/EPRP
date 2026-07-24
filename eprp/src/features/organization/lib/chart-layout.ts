import type { OrganizationPositionNode } from "@/types";

/**
 * Deterministic top-down layout for an organization chart.
 *
 * Coordinates are computed here and never persisted — the database stores
 * only `parentPositionId` and `sortOrder` (OC-2), so the same tree always
 * lays out the same way and there is no stored geometry to drift.
 */

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 76;
const H_GAP = 28;
const V_GAP = 56;
/** Breathing room around the whole chart. */
const PADDING = 40;

export interface LayoutNode {
  id: string;
  /** Top-left corner, in chart space. */
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  parentId?: string;
  node: OrganizationPositionNode;
}

export interface LayoutEdge {
  id: string;
  fromId: string;
  toId: string;
  /** Elbow path in chart space, ready for an SVG `d` attribute. */
  path: string;
}

export interface ChartLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** Bounding box of the laid-out chart, including padding. */
  width: number;
  height: number;
}

/**
 * Lay out one or more trees side by side.
 *
 * Leaves are placed left to right in sibling order; a parent is centred over
 * its children. Several roots simply continue the same cursor, so unrelated
 * trees sit next to each other rather than overlapping.
 */
export function layoutChart(roots: OrganizationPositionNode[]): ChartLayout {
  const nodes: LayoutNode[] = [];
  let leafCursor = 0;

  const place = (
    node: OrganizationPositionNode,
    depth: number,
    parentId?: string
  ): LayoutNode => {
    const y = depth * (NODE_HEIGHT + V_GAP);
    let x: number;

    if (node.children.length === 0) {
      x = leafCursor * (NODE_WIDTH + H_GAP);
      leafCursor += 1;
    } else {
      const placed = node.children.map((child) =>
        place(child, depth + 1, node.id)
      );
      // Centre the parent over the span of its children.
      const first = placed[0];
      const last = placed[placed.length - 1];
      x = (first.x + last.x) / 2;
    }

    const laid: LayoutNode = {
      id: node.id,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      depth,
      parentId,
      node,
    };
    nodes.push(laid);
    return laid;
  };

  for (const root of roots) place(root, 0);

  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  // Shift everything into positive space and add padding.
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  for (const node of nodes) {
    node.x = node.x - minX + PADDING;
    node.y = node.y - minY + PADDING;
  }

  const width =
    Math.max(...nodes.map((n) => n.x + n.width)) + PADDING;
  const height =
    Math.max(...nodes.map((n) => n.y + n.height)) + PADDING;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: LayoutEdge[] = [];
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId);
    if (!parent) continue;
    edges.push({
      id: `${parent.id}->${node.id}`,
      fromId: parent.id,
      toId: node.id,
      path: elbowPath(parent, node),
    });
  }

  // Document order drives paint order; keep it stable for smooth updates.
  nodes.sort((a, b) => a.depth - b.depth || a.x - b.x);

  return { nodes, edges, width, height };
}

/**
 * Orthogonal connector: down out of the parent, across, then down into the
 * child. Straight segments read better than curves for reporting lines.
 */
function elbowPath(parent: LayoutNode, child: LayoutNode): string {
  const startX = parent.x + parent.width / 2;
  const startY = parent.y + parent.height;
  const endX = child.x + child.width / 2;
  const endY = child.y;
  const midY = startY + (endY - startY) / 2;
  return `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
}

/**
 * The scale and offset that fit `layout` inside a viewport, capped at 1 so a
 * small chart is never blown up beyond its natural size.
 */
export function fitToViewport(
  layout: { width: number; height: number },
  viewport: { width: number; height: number },
  maxScale = 1
): { scale: number; offsetX: number; offsetY: number } {
  if (
    layout.width <= 0 ||
    layout.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  const scale = Math.min(
    viewport.width / layout.width,
    viewport.height / layout.height,
    maxScale
  );
  // Centre whatever space is left over.
  const offsetX = (viewport.width - layout.width * scale) / 2;
  const offsetY = (viewport.height - layout.height * scale) / 2;
  return { scale, offsetX, offsetY };
}

/**
 * Zoom about a point in viewport space, so the content under the cursor
 * stays put.
 */
export function zoomAbout(
  current: { scale: number; offsetX: number; offsetY: number },
  nextScale: number,
  point: { x: number; y: number }
): { scale: number; offsetX: number; offsetY: number } {
  const ratio = nextScale / current.scale;
  return {
    scale: nextScale,
    offsetX: point.x - (point.x - current.offsetX) * ratio,
    offsetY: point.y - (point.y - current.offsetY) * ratio,
  };
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}
