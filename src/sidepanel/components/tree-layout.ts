import type { TreeVisualModel } from "../../core/tree-interpreter";

export const TREE_NODE_WIDTH = 104;
// A TreeNode card contains pointer, value, identity, left, and right rows.
// Keep the layout height in sync with that rendered card so descendants are
// not painted into the card or clipped by the canvas bounds.
export const TREE_NODE_HEIGHT = 104;
export const TREE_HORIZONTAL_GAP = 32;
export const TREE_VERTICAL_GAP = 72;
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
const verticalStride = TREE_NODE_HEIGHT + TREE_VERTICAL_GAP;

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
  nodes: TreeVisualModel["nodes"]
): TreeLayoutNode[] {
  const nodeIds = new Set(component.nodeIds);
  const nodeById = new Map(nodes.map((node) => [node.objectId, node]));
  const positions = new Map<string, { slot: number; depth: number }>();
  let nextSlot = 0;

  const place = (objectId: string, depth: number): void => {
    const node = nodeById.get(objectId);
    if (!node || positions.has(objectId)) {
      return;
    }
    const left = internalTarget(node, "left", nodeIds);
    const right = internalTarget(node, "right", nodeIds);
    if (left !== null) {
      place(left, depth + 1);
    }
    positions.set(objectId, { slot: nextSlot, depth });
    nextSlot += 1;
    if (right !== null) {
      place(right, depth + 1);
    }
  };

  const entryNodeId = [...component.entryNodeIds].sort((left, right) => left.localeCompare(right))[0];
  if (entryNodeId !== undefined) {
    place(entryNodeId, 0);
  }
  for (const node of nodes) {
    if (!positions.has(node.objectId)) {
      place(node.objectId, 0);
    }
  }

  return nodes.map((node) => {
    const position = positions.get(node.objectId)!;
    return {
      objectId: node.objectId,
      x: position.slot * horizontalStride,
      y: position.depth * verticalStride,
      width: TREE_NODE_WIDTH,
      height: TREE_NODE_HEIGHT
    };
  });
}

function fallbackNodes(nodes: TreeVisualModel["nodes"]): TreeLayoutNode[] {
  return nodes.map((node, index) => {
    const column = index % TREE_FALLBACK_COLUMNS;
    const row = Math.floor(index / TREE_FALLBACK_COLUMNS);
    return {
      objectId: node.objectId,
      x: column * horizontalStride,
      y: row * verticalStride,
      width: TREE_NODE_WIDTH,
      height: TREE_NODE_HEIGHT
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
        y1: from.y + TREE_NODE_HEIGHT,
        x2: to.x + TREE_NODE_WIDTH / 2,
        y2: to.y
      });
    }
  }
  return edges;
}

function layoutComponent(
  component: TreeVisualModel["components"][number],
  nodeById: Map<string, TreeVisualModel["nodes"][number]>
): TreeComponentLayout {
  const nodes = componentNodes(component, nodeById);
  const strict = isStrictTree(component, nodes);
  const layoutNodes = strict ? strictNodes(component, nodes) : fallbackNodes(nodes);
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
  return orderedComponents(model).map((component) => layoutComponent(component, nodeById));
}
