import type { ObjectId, ObjectSnapshot, ValueSnapshot } from "../shared/trace-types";
import type { RuntimeMutation } from "./runtime-mutation";
import type { RuntimeState } from "./runtime-state";
import { cloneValueSnapshot } from "./value-snapshot";
import { connectedComponents, type TopologyEdge } from "./topology/components";
import {
  buildActiveObjectPointers,
  type ObjectPointerVisual
} from "./topology/pointers";
import { rankComponentsByPointerCoverage } from "./topology/ranking";

export type GraphTargetKind = "graph_node" | "external" | "unresolved";

export interface GraphNeighborVisual {
  objectId: ObjectId;
  targetKind: GraphTargetKind;
}

export interface GraphNodeVisual {
  objectId: ObjectId;
  className: "Node";
  label: ValueSnapshot | null;
  neighbors: GraphNeighborVisual[];
  status: "unchanged" | "added" | "changed";
}

export interface GraphEdgeVisual {
  fromObjectId: ObjectId;
  toObjectId: ObjectId;
  targetKind: GraphTargetKind;
  status: "unchanged" | "added" | "removed";
}

export type GraphPointerVisual = ObjectPointerVisual;

export interface GraphComponent {
  componentId: string;
  nodeIds: ObjectId[];
  pointerCount: number;
  role: "main" | "secondary";
}

export interface GraphVisualModel {
  kind: "graph";
  visualId: "graph:Node";
  nodes: GraphNodeVisual[];
  edges: GraphEdgeVisual[];
  components: GraphComponent[];
  pointers: GraphPointerVisual[];
  truncated: boolean;
}

type ReferenceSnapshot = Extract<ValueSnapshot, { type: "reference" }>;
type EdgeStatus = GraphEdgeVisual["status"];

function isReference(value: ValueSnapshot | undefined): value is ReferenceSnapshot {
  return value?.type === "reference";
}

function isGraphNodeCandidate(object: ObjectSnapshot): boolean {
  const neighbors = object.attributes.neighbors;
  return object.className === "Node" &&
    (neighbors?.type === "list" || neighbors?.type === "tuple") &&
    neighbors.items.every((item) => isReference(item) && item.className === "Node");
}

function compareObjectIds(left: ObjectId, right: ObjectId): number {
  return left.localeCompare(right);
}

function compareEdges(left: GraphEdgeVisual, right: GraphEdgeVisual): number {
  return compareObjectIds(left.fromObjectId, right.fromObjectId) ||
    compareObjectIds(left.toObjectId, right.toObjectId);
}

function edgeKey(fromObjectId: ObjectId, toObjectId: ObjectId): string {
  return `${fromObjectId}\u0000${toObjectId}`;
}

function referenceSet(snapshot: ValueSnapshot | undefined): Set<ObjectId> {
  if (snapshot?.type !== "list" && snapshot?.type !== "tuple") {
    return new Set();
  }
  return new Set(
    snapshot.items
      .filter(isReference)
      .map((reference) => reference.objectId)
  );
}

function classifyTarget(
  objectId: ObjectId,
  allObjects: Map<ObjectId, ObjectSnapshot>,
  candidates: ReadonlySet<ObjectId>
): GraphTargetKind {
  if (candidates.has(objectId)) {
    return "graph_node";
  }
  if (allObjects.has(objectId)) {
    return "external";
  }
  return "unresolved";
}

interface EdgeMutationEvidence {
  fromObjectId: ObjectId;
  toObjectId: ObjectId;
  status: EdgeStatus;
}

function neighborMutationEvidence(
  mutations: readonly RuntimeMutation[]
): Map<string, EdgeMutationEvidence> {
  const evidence = new Map<string, EdgeMutationEvidence>();
  for (const mutation of mutations) {
    if (
      mutation.kind !== "object_attribute" ||
      mutation.attribute !== "neighbors" ||
      mutation.before === undefined && mutation.after === undefined
    ) {
      continue;
    }

    const before = referenceSet(mutation.before);
    const after = referenceSet(mutation.after);
    const targets = new Set([...before, ...after]);
    for (const targetId of targets) {
      const status: EdgeStatus = before.has(targetId)
        ? after.has(targetId) ? "unchanged" : "removed"
        : "added";
      if (status === "unchanged") {
        evidence.delete(edgeKey(mutation.objectId, targetId));
        continue;
      }
      evidence.set(edgeKey(mutation.objectId, targetId), {
        fromObjectId: mutation.objectId,
        toObjectId: targetId,
        status
      });
    }
  }
  return evidence;
}

function objectWasAdded(
  mutations: readonly RuntimeMutation[],
  objectId: ObjectId
): boolean {
  return mutations.some((mutation) =>
    mutation.kind === "object_visibility" &&
    mutation.objectId === objectId &&
    mutation.action === "appeared"
  );
}

function objectWasChanged(
  mutations: readonly RuntimeMutation[],
  objectId: ObjectId
): boolean {
  return mutations.some((mutation) => {
    if (mutation.kind === "reference") {
      return mutation.owner.scope === "object_attribute" &&
        mutation.owner.objectId === objectId;
    }
    return mutation.kind === "object_attribute" && mutation.objectId === objectId;
  });
}

function buildEdges(
  candidates: Map<ObjectId, ObjectSnapshot>,
  allObjects: Map<ObjectId, ObjectSnapshot>,
  mutations: readonly RuntimeMutation[]
): GraphEdgeVisual[] {
  const candidateIds = new Set(candidates.keys());
  const evidence = neighborMutationEvidence(mutations);
  const currentEdges = new Map<string, GraphEdgeVisual>();

  for (const objectId of [...candidates.keys()].sort(compareObjectIds)) {
    const neighbors = candidates.get(objectId)!.attributes.neighbors;
    if (neighbors?.type !== "list" && neighbors?.type !== "tuple") {
      continue;
    }
    for (const item of neighbors.items) {
      if (!isReference(item)) {
        continue;
      }
      const key = edgeKey(objectId, item.objectId);
      if (currentEdges.has(key)) {
        continue;
      }
      currentEdges.set(key, {
        fromObjectId: objectId,
        toObjectId: item.objectId,
        targetKind: classifyTarget(item.objectId, allObjects, candidateIds),
        status: evidence.get(key)?.status ?? "unchanged"
      });
    }
  }

  for (const mutation of evidence.values()) {
    const key = edgeKey(mutation.fromObjectId, mutation.toObjectId);
    if (currentEdges.has(key) || mutation.status !== "removed") {
      continue;
    }
    currentEdges.set(key, {
      fromObjectId: mutation.fromObjectId,
      toObjectId: mutation.toObjectId,
      targetKind: classifyTarget(mutation.toObjectId, allObjects, candidateIds),
      status: "removed"
    });
  }

  return [...currentEdges.values()].sort(compareEdges);
}

function buildNodes(
  candidates: Map<ObjectId, ObjectSnapshot>,
  allObjects: Map<ObjectId, ObjectSnapshot>,
  mutations: readonly RuntimeMutation[]
): GraphNodeVisual[] {
  const candidateIds = new Set(candidates.keys());
  return [...candidates.keys()].sort(compareObjectIds).map((objectId) => {
    const object = candidates.get(objectId)!;
    const neighbors = object.attributes.neighbors;
    const orderedNeighbors = neighbors?.type === "list" || neighbors?.type === "tuple"
      ? neighbors.items.filter(isReference).map((reference) => ({
        objectId: reference.objectId,
        targetKind: classifyTarget(reference.objectId, allObjects, candidateIds)
      }))
      : [];

    return {
      objectId,
      className: "Node",
      label: object.attributes.val === undefined
        ? null
        : cloneValueSnapshot(object.attributes.val),
      neighbors: orderedNeighbors,
      status: objectWasAdded(mutations, objectId)
        ? "added"
        : objectWasChanged(mutations, objectId)
          ? "changed"
          : "unchanged"
    };
  });
}

export function buildGraphVisuals(
  runtime: RuntimeState,
  mutations: RuntimeMutation[]
): GraphVisualModel[] {
  const allObjects = runtime.objectTopology.objects;
  const candidates = new Map(
    [...allObjects.entries()]
      .filter(([, object]) => isGraphNodeCandidate(object))
  );
  if (candidates.size === 0) {
    return [];
  }

  const nodes = buildNodes(candidates, allObjects, mutations);
  const edges = buildEdges(candidates, allObjects, mutations);
  const internalEdges: TopologyEdge[] = edges
    .filter((edge) => edge.targetKind === "graph_node")
    .map(({ fromObjectId, toObjectId }) => ({ fromObjectId, toObjectId }));
  const baseComponents = connectedComponents(
    nodes.map((node) => node.objectId),
    internalEdges,
    "graph-component"
  );
  const pointers = buildActiveObjectPointers(runtime, new Set(candidates.keys()), mutations);
  const components = rankComponentsByPointerCoverage(baseComponents, pointers);

  return [{
    kind: "graph",
    visualId: "graph:Node",
    nodes,
    edges,
    components,
    pointers,
    truncated: runtime.objectTopology.truncated
  }];
}
