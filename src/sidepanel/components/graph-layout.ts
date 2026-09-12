import type { ObjectId } from "../../shared/trace-types";
import type {
  GraphEdgeVisual,
  GraphVisualModel
} from "../../core/graph-interpreter";

export const GRAPH_NODE_SIZE = 44;
export const GRAPH_LAYOUT_ITERATIONS = 160;

const IDEAL_EDGE_LENGTH = 92;
const REPULSION = 3200;
const SPRING = 0.025;
const DAMPING = 0.82;
const STEP = 0.12;
const PADDING = 28;
const COLLISION_GAP = 10;
const COLLISION_PASSES = 64;

export interface GraphLayoutNode {
  objectId: ObjectId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayoutConnection {
  key: string;
  fromObjectId: ObjectId;
  toObjectId: ObjectId;
  reciprocal: boolean;
  reverseFromObjectId?: ObjectId;
  reverseToObjectId?: ObjectId;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GraphComponentLayout {
  componentId: string;
  mode: "force" | "fallback";
  width: number;
  height: number;
  nodes: GraphLayoutNode[];
  connections: GraphLayoutConnection[];
}

interface SimulationNode {
  objectId: ObjectId;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Force {
  x: number;
  y: number;
}

function compareObjectIds(left: ObjectId, right: ObjectId): number {
  return left.localeCompare(right);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededPoint(objectId: ObjectId): { x: number; y: number } {
  const xHash = fnv1a(`x:${objectId}`);
  const yHash = fnv1a(`y:${objectId}`);
  return {
    x: 40 + (xHash % 200),
    y: 40 + (yHash % 180)
  };
}

function deterministicAxis(leftId: ObjectId, rightId: ObjectId): { x: number; y: number } {
  const angle = (fnv1a(`axis:${leftId}:${rightId}`) % 360) * Math.PI / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function edgeKey(fromObjectId: ObjectId, toObjectId: ObjectId): string {
  return `${fromObjectId}\u0000${toObjectId}`;
}

function directedEdgeComparator(left: GraphEdgeVisual, right: GraphEdgeVisual): number {
  return compareObjectIds(left.fromObjectId, right.fromObjectId) ||
    compareObjectIds(left.toObjectId, right.toObjectId);
}

function orderedComponents(model: GraphVisualModel): GraphVisualModel["components"] {
  return [...model.components].sort((left, right) =>
    (left.role === "main" ? -1 : 1) - (right.role === "main" ? -1 : 1) ||
    left.componentId.localeCompare(right.componentId)
  );
}

function finiteSimulation(nodes: readonly SimulationNode[]): boolean {
  return nodes.every((node) =>
    Number.isFinite(node.x) && Number.isFinite(node.y) &&
    Number.isFinite(node.vx) && Number.isFinite(node.vy)
  );
}

function physicalEdges(
  edges: readonly GraphEdgeVisual[],
  nodeIds: ReadonlySet<ObjectId>
): Array<[ObjectId, ObjectId]> {
  const pairs = new Map<string, [ObjectId, ObjectId]>();
  for (const edge of edges) {
    if (
      edge.targetKind !== "graph_node" ||
      !nodeIds.has(edge.fromObjectId) ||
      !nodeIds.has(edge.toObjectId)
    ) {
      continue;
    }
    const [left, right] = [edge.fromObjectId, edge.toObjectId].sort(compareObjectIds);
    const key = `${left}\u0000${right}`;
    if (!pairs.has(key)) {
      pairs.set(key, [left, right]);
    }
  }
  return [...pairs.values()].sort(([leftFrom, leftTo], [rightFrom, rightTo]) =>
    compareObjectIds(leftFrom, rightFrom) || compareObjectIds(leftTo, rightTo)
  );
}

function applyCollisionSeparation(nodes: SimulationNode[]): void {
  const minimumDistance = GRAPH_NODE_SIZE + COLLISION_GAP;
  for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
    let changed = false;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (!Number.isFinite(distance)) {
          return;
        }
        if (distance >= minimumDistance) {
          continue;
        }
        if (distance < 0.0001) {
          const axis = deterministicAxis(left.objectId, right.objectId);
          dx = axis.x;
          dy = axis.y;
          distance = 1;
        }
        const shift = (minimumDistance - distance) / 2 + 0.001;
        const unitX = dx / distance;
        const unitY = dy / distance;
        left.x -= unitX * shift;
        left.y -= unitY * shift;
        right.x += unitX * shift;
        right.y += unitY * shift;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
}

function normalize(nodes: SimulationNode[]): void {
  if (nodes.length === 0) {
    return;
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  for (const node of nodes) {
    node.x = node.x - minX + PADDING;
    node.y = node.y - minY + PADDING;
  }
}

function simulate(
  objectIds: readonly ObjectId[],
  edges: readonly GraphEdgeVisual[]
): SimulationNode[] {
  const nodes = objectIds
    .slice()
    .sort(compareObjectIds)
    .map((objectId): SimulationNode => {
      const seed = seededPoint(objectId);
      return { objectId, x: seed.x, y: seed.y, vx: 0, vy: 0 };
    });
  const nodeById = new Map(nodes.map((node) => [node.objectId, node]));
  const nodeIds = new Set(objectIds);
  const springs = physicalEdges(edges, nodeIds);

  for (let iteration = 0; iteration < GRAPH_LAYOUT_ITERATIONS; iteration += 1) {
    const forces = new Map<ObjectId, Force>(
      nodes.map((node) => [node.objectId, { x: 0, y: 0 }])
    );

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distanceSquared = dx * dx + dy * dy;
        if (!Number.isFinite(distanceSquared)) {
          return nodes;
        }
        if (distanceSquared < 0.0001) {
          const axis = deterministicAxis(left.objectId, right.objectId);
          dx = axis.x;
          dy = axis.y;
          distanceSquared = 1;
        }
        const distance = Math.sqrt(distanceSquared);
        const magnitude = Math.min(REPULSION / Math.max(distanceSquared, 0.0001), 800);
        const unitX = dx / distance;
        const unitY = dy / distance;
        const leftForce = forces.get(left.objectId)!;
        const rightForce = forces.get(right.objectId)!;
        leftForce.x -= unitX * magnitude;
        leftForce.y -= unitY * magnitude;
        rightForce.x += unitX * magnitude;
        rightForce.y += unitY * magnitude;
      }
    }

    for (const [fromObjectId, toObjectId] of springs) {
      const from = nodeById.get(fromObjectId)!;
      const to = nodeById.get(toObjectId)!;
      let dx = to.x - from.x;
      let dy = to.y - from.y;
      let distance = Math.hypot(dx, dy);
      if (!Number.isFinite(distance)) {
        return nodes;
      }
      if (distance < 0.0001) {
        const axis = deterministicAxis(fromObjectId, toObjectId);
        dx = axis.x;
        dy = axis.y;
        distance = 1;
      }
      const magnitude = (distance - IDEAL_EDGE_LENGTH) * SPRING;
      const unitX = dx / distance;
      const unitY = dy / distance;
      const fromForce = forces.get(fromObjectId)!;
      const toForce = forces.get(toObjectId)!;
      fromForce.x += unitX * magnitude;
      fromForce.y += unitY * magnitude;
      toForce.x -= unitX * magnitude;
      toForce.y -= unitY * magnitude;
    }

    for (const node of nodes) {
      const force = forces.get(node.objectId)!;
      node.vx = (node.vx + force.x * STEP) * DAMPING;
      node.vy = (node.vy + force.y * STEP) * DAMPING;
      node.x += node.vx * STEP;
      node.y += node.vy * STEP;
    }
  }

  applyCollisionSeparation(nodes);
  normalize(nodes);
  return nodes;
}

function fallbackNodes(objectIds: readonly ObjectId[]): SimulationNode[] {
  const ordered = objectIds.slice().sort(compareObjectIds);
  const radius = Math.max(64, ordered.length * 30);
  const center = radius + PADDING;
  const nodes = ordered.map((objectId, index): SimulationNode => {
    const angle = (2 * Math.PI * index) / Math.max(ordered.length, 1);
    return {
      objectId,
      x: center + radius * Math.cos(angle) - GRAPH_NODE_SIZE / 2,
      y: center + radius * Math.sin(angle) - GRAPH_NODE_SIZE / 2,
      vx: 0,
      vy: 0
    };
  });
  normalize(nodes);
  return nodes;
}

function bounds(nodes: readonly GraphLayoutNode[]): { width: number; height: number } {
  return {
    width: nodes.length === 0
      ? 0
      : Math.max(...nodes.map((node) => node.x + node.width)) + PADDING,
    height: nodes.length === 0
      ? 0
      : Math.max(...nodes.map((node) => node.y + node.height)) + PADDING
  };
}

// Simple cycles have an unambiguous perimeter order. Preserve that order
// instead of allowing a force simulation to fold the ring across itself.
function cycleNodes(objectIds: ObjectId[], edges: GraphEdgeVisual[]): SimulationNode[] | null {
  if (objectIds.length < 3) return null;
  const adjacent = new Map(objectIds.map((id) => [id, [] as ObjectId[]]));
  for (const [from, to] of physicalEdges(edges, new Set(objectIds))) {
    if (from === to) return null;
    adjacent.get(from)!.push(to);
    adjacent.get(to)!.push(from);
  }
  if ([...adjacent.values()].some((neighbors) => neighbors.length !== 2)) return null;
  const order: ObjectId[] = [];
  let current = objectIds[0]!;
  let previous: ObjectId | undefined;
  while (!order.includes(current)) {
    order.push(current);
    const next = adjacent.get(current)!.slice().sort(compareObjectIds)
      .find((id) => id !== previous)!;
    previous = current;
    current = next;
  }
  if (order.length !== objectIds.length || current !== order[0]) return null;
  const radius = IDEAL_EDGE_LENGTH / (2 * Math.sin(Math.PI / order.length));
  const nodes = order.map((objectId, index) => {
    const angle = -3 * Math.PI / 4 + index * 2 * Math.PI / order.length;
    return { objectId, x: radius * Math.cos(angle), y: radius * Math.sin(angle), vx: 0, vy: 0 };
  });
  normalize(nodes);
  return nodes;
}

function presentationConnections(
  edges: readonly GraphEdgeVisual[],
  layoutById: ReadonlyMap<ObjectId, GraphLayoutNode>,
  nodeIds: ReadonlySet<ObjectId>
): GraphLayoutConnection[] {
  const relevant = edges
    .filter((edge) =>
      edge.targetKind === "graph_node" &&
      nodeIds.has(edge.fromObjectId) &&
      nodeIds.has(edge.toObjectId) &&
      layoutById.has(edge.fromObjectId) &&
      layoutById.has(edge.toObjectId)
    )
    .sort(directedEdgeComparator);
  const edgeByKey = new Map(relevant.map((edge) => [
    edgeKey(edge.fromObjectId, edge.toObjectId),
    edge
  ]));
  const connections: GraphLayoutConnection[] = [];
  const handled = new Set<string>();

  for (const edge of relevant) {
    const key = edgeKey(edge.fromObjectId, edge.toObjectId);
    if (handled.has(key)) {
      continue;
    }
    const reverseKey = edgeKey(edge.toObjectId, edge.fromObjectId);
    const reverse = edge.fromObjectId === edge.toObjectId
      ? undefined
      : edgeByKey.get(reverseKey);
    const from = reverse && compareObjectIds(edge.fromObjectId, edge.toObjectId) > 0
      ? reverse.fromObjectId
      : edge.fromObjectId;
    const to = reverse && compareObjectIds(edge.fromObjectId, edge.toObjectId) > 0
      ? reverse.toObjectId
      : edge.toObjectId;
    const fromNode = layoutById.get(from)!;
    const toNode = layoutById.get(to)!;

    if (reverse) {
      handled.add(key);
      handled.add(reverseKey);
      connections.push({
        key: `${from}↔${to}`,
        fromObjectId: from,
        toObjectId: to,
        reciprocal: true,
        reverseFromObjectId: to,
        reverseToObjectId: from,
        x1: fromNode.x + fromNode.width / 2,
        y1: fromNode.y + fromNode.height / 2,
        x2: toNode.x + toNode.width / 2,
        y2: toNode.y + toNode.height / 2
      });
      continue;
    }

    handled.add(key);
    connections.push({
      key: `${edge.fromObjectId}→${edge.toObjectId}`,
      fromObjectId: edge.fromObjectId,
      toObjectId: edge.toObjectId,
      reciprocal: false,
      x1: fromNode.x + fromNode.width / 2,
      y1: fromNode.y + fromNode.height / 2,
      x2: toNode.x + toNode.width / 2,
      y2: toNode.y + toNode.height / 2
    });
  }

  return connections;
}

function layoutComponent(
  model: GraphVisualModel,
  component: GraphVisualModel["components"][number],
  nodeById: ReadonlyMap<ObjectId, GraphVisualModel["nodes"][number]>
): GraphComponentLayout {
  const objectIds = component.nodeIds
    .filter((objectId) => nodeById.has(objectId))
    .sort(compareObjectIds);
  const simulation = cycleNodes(objectIds, model.edges) ?? simulate(objectIds, model.edges);
  const mode = finiteSimulation(simulation) ? "force" : "fallback";
  const positioned = mode === "force" ? simulation : fallbackNodes(objectIds);
  const layoutNodes = positioned
    .map((node): GraphLayoutNode => ({
      objectId: node.objectId,
      x: node.x,
      y: node.y,
      width: GRAPH_NODE_SIZE,
      height: GRAPH_NODE_SIZE
    }))
    .sort((left, right) => compareObjectIds(left.objectId, right.objectId));
  const layoutById = new Map(layoutNodes.map((node) => [node.objectId, node]));
  const dimensions = bounds(layoutNodes);

  return {
    componentId: component.componentId,
    mode,
    ...dimensions,
    nodes: layoutNodes,
    connections: presentationConnections(
      model.edges,
      layoutById,
      new Set(objectIds)
    )
  };
}

export function layoutGraph(model: GraphVisualModel): GraphComponentLayout[] {
  const nodeById = new Map(model.nodes.map((node) => [node.objectId, node]));
  return orderedComponents(model).map((component) =>
    layoutComponent(model, component, nodeById)
  );
}
