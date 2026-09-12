import { pointerLabelHeight } from "./pointer-label";
import type { TreeVisualModel } from "../../core/tree-interpreter";

// Geometry reserves room above each value for its pointer badges.
export const TREE_NODE_WIDTH = 52;
export const TREE_NODE_HEIGHT = 68;
export const TREE_HORIZONTAL_GAP = 16;
export const TREE_VERTICAL_GAP = 28;
export const TREE_FALLBACK_COLUMNS = 3;

export interface TreeLayoutNode {
  objectId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TreeLayoutEdge {
  fromObjectId: string;
  toObjectId: string;
  field: "left" | "right";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TreeComponentLayout {
  componentId: string;
  mode: "tree" | "fallback";
  width: number;
  height: number;
  nodes: TreeLayoutNode[];
  edges: TreeLayoutEdge[];
}

const horizontalStride = TREE_NODE_WIDTH + TREE_HORIZONTAL_GAP;


function orderedComponents(model: TreeVisualModel): TreeVisualModel["components"] {
  return [...model.components].sort((left, right) =>
    (left.role === "main" ? -1 : 1) - (right.role === "main" ? -1 : 1) ||
    left.componentId.localeCompare(right.componentId)
  );
}

function componentNodes(
  component: TreeVisualModel["components"][number],
  nodeById: Map<string, TreeVisualModel["nodes"][number]>
): TreeVisualModel["nodes"] {
  return [...component.nodeIds]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((objectId) => {
      const node = nodeById.get(objectId);
      return node ? [node] : [];
    });
}

function internalTarget(
  node: TreeVisualModel["nodes"][number],
  field: "left" | "right",
  nodeIds: Set<string>
): string | null {
  const objectId = field === "left" ? node.leftObjectId : node.rightObjectId;
  const targetKind = field === "left" ? node.leftTargetKind : node.rightTargetKind;
  return targetKind === "tree_node" && objectId !== null && nodeIds.has(objectId)
    ? objectId
    : null;
}

function incomingCounts(
  nodes: TreeVisualModel["nodes"],
  nodeIds: Set<string>
): Map<string, number> {
  const incoming = new Map([...nodeIds].map((objectId) => [objectId, 0]));
  for (const node of nodes) {
    for (const field of ["left", "right"] as const) {
      const target = internalTarget(node, field, nodeIds);
      if (target !== null) {
        incoming.set(target, (incoming.get(target) ?? 0) + 1);
      }
    }
  }
  return incoming;
}

function isStrictTree(
  component: TreeVisualModel["components"][number],
  nodes: TreeVisualModel["nodes"]
): boolean {
  if (
    component.cyclic ||
    component.sharedChildNodeIds.length > 0 ||
    component.entryNodeIds.length !== 1
  ) {
    return false;
  }

  const nodeIds = new Set(component.nodeIds);
  const incoming = incomingCounts(nodes, nodeIds);
  const entryNodeId = component.entryNodeIds[0];
  if (entryNodeId === undefined || !nodeIds.has(entryNodeId) || incoming.get(entryNodeId) !== 0) {
    return false;
  }
  return [...nodeIds].every((objectId) =>
    objectId === entryNodeId || incoming.get(objectId) === 1
  );
}

function bounds(nodes: TreeLayoutNode[]): { width: number; height: number } {
  return {
    width: nodes.length === 0
      ? 0
      : Math.max(...nodes.map((node) => node.x + node.width)),
    height: nodes.length === 0
      ? 0
      : Math.max(...nodes.map((node) => node.y + node.height))
  };
}

function strictNodes(
  component: TreeVisualModel["components"][number],
  nodes: TreeVisualModel["nodes"],
  nodeHeight: number
): TreeLayoutNode[] {
  const nodeIds = new Set(component.nodeIds);
  const nodeById = new Map(nodes.map((node) => [node.objectId, node]));
  const visited = new Set<string>();
  type Subtree = { nodes: TreeLayoutNode[]; width: number; rootX: number };
  const place = (objectId: string, depth: number): Subtree => {
    const node = nodeById.get(objectId)!;
    visited.add(objectId);
    const leftId = internalTarget(node, "left", nodeIds);
    const rightId = internalTarget(node, "right", nodeIds);
    const left = leftId !== null && !visited.has(leftId) ? place(leftId, depth + 1) : null;
    const right = rightId !== null && !visited.has(rightId) ? place(rightId, depth + 1) : null;
    const rightOffset = left ? left.width + TREE_HORIZONTAL_GAP : 0;
    const rootX = left && right
      ? (left.rootX + right.rootX + rightOffset) / 2
      : left ? left.rootX + horizontalStride / 2
        : right ? right.rootX - horizontalStride / 2 : 0;
    const offset = Math.max(0, -rootX);
    const descendants = [
      ...(left?.nodes ?? []),
      ...(right?.nodes ?? []).map((item) => ({ ...item, x: item.x + (left ? rightOffset : 0) }))
    ].map((item) => ({ ...item, x: item.x + offset }));
    const root = {
      objectId, x: rootX + offset, y: depth * (nodeHeight + TREE_VERTICAL_GAP),
      width: TREE_NODE_WIDTH, height: nodeHeight
    };
    const placed = [root, ...descendants];
    return { nodes: placed, width: bounds(placed).width, rootX: root.x };
  };
  const rootId = component.entryNodeIds[0]!;
  return place(rootId, 0).nodes.sort((left, right) => left.objectId.localeCompare(right.objectId));
}

function fallbackNodes(nodes: TreeVisualModel["nodes"], nodeHeight: number): TreeLayoutNode[] {
  return nodes.map((node, index) => {
    const column = index % TREE_FALLBACK_COLUMNS;
    const row = Math.floor(index / TREE_FALLBACK_COLUMNS);
    return {
      objectId: node.objectId,
      x: column * horizontalStride,
      y: row * (nodeHeight + TREE_VERTICAL_GAP),
      width: TREE_NODE_WIDTH,
      height: nodeHeight
    };
  });
}

function layoutEdges(
  nodes: TreeVisualModel["nodes"],
  layoutNodes: TreeLayoutNode[],
  component: TreeVisualModel["components"][number]
): TreeLayoutEdge[] {
  const nodeIds = new Set(component.nodeIds);
  const layoutById = new Map(layoutNodes.map((node) => [node.objectId, node]));
  const edges: TreeLayoutEdge[] = [];
  for (const node of nodes) {
    const from = layoutById.get(node.objectId);
    if (!from) {
      continue;
    }
    for (const field of ["left", "right"] as const) {
      const targetId = internalTarget(node, field, nodeIds);
      if (targetId === null) {
        continue;
      }
      const to = layoutById.get(targetId);
      if (!to) {
        continue;
      }
      edges.push({
        fromObjectId: node.objectId,
        toObjectId: targetId,
        field,
        x1: from.x + TREE_NODE_WIDTH / 2,
        y1: from.y + from.height,
        x2: to.x + TREE_NODE_WIDTH / 2,
        y2: to.y + to.height - 44
      });
    }
  }
  return edges;
}

function layoutComponent(
  component: TreeVisualModel["components"][number],
  nodeById: Map<string, TreeVisualModel["nodes"][number]>,
  pointers: TreeVisualModel["pointers"]
): TreeComponentLayout {
  const nodes = componentNodes(component, nodeById);
  const strict = isStrictTree(component, nodes);
  const nodeHeight = 44 + Math.max(24, ...nodes.map((node) => pointerLabelHeight(
    pointers.filter((pointer) => pointer.objectId === node.objectId).map((pointer) => pointer.variableName), 24
  )));
  const layoutNodes = strict ? strictNodes(component, nodes, nodeHeight) : fallbackNodes(nodes, nodeHeight);
  const dimensions = bounds(layoutNodes);
  return {
    componentId: component.componentId,
    mode: strict ? "tree" : "fallback",
    ...dimensions,
    nodes: layoutNodes,
    edges: layoutEdges(nodes, layoutNodes, component)
  };
}

export function layoutTree(model: TreeVisualModel): TreeComponentLayout[] {
  const nodeById = new Map(model.nodes.map((node) => [node.objectId, node]));
  return orderedComponents(model).map((component) => layoutComponent(component, nodeById, model.pointers));
}
