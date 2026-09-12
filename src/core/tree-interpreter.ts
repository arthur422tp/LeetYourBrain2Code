import type { ObjectId, ObjectSnapshot, ValueSnapshot } from "../shared/trace-types";
import type {
  ObjectAttributeMutation,
  ReferenceMutation,
  RuntimeMutation
} from "./runtime-mutation";
import type { RuntimeState } from "./runtime-state";
import {
  connectedComponents,
  type TopologyEdge
} from "./topology/components";
import {
  buildActiveObjectPointers,
  type ObjectPointerVisual
} from "./topology/pointers";
import { rankComponentsByPointerCoverage } from "./topology/ranking";
import { cloneValueSnapshot } from "./value-snapshot";

export type TreeTargetKind = "none" | "tree_node" | "external" | "unresolved";

export interface TreeNodeVisual {
  objectId: ObjectId;
  className: "TreeNode";
  label: ValueSnapshot | null;
  leftObjectId: ObjectId | null;
  rightObjectId: ObjectId | null;
  leftTargetKind: TreeTargetKind;
  rightTargetKind: TreeTargetKind;
  status: "unchanged" | "added" | "changed" | "detached";
  valueStatus: "unchanged" | "changed";
  leftStatus: "unchanged" | "added" | "removed" | "changed";
  rightStatus: "unchanged" | "added" | "removed" | "changed";
}

export type TreePointerVisual = ObjectPointerVisual;

export interface TreeComponent {
  componentId: string;
  nodeIds: ObjectId[];
  entryNodeIds: ObjectId[];
  pointerCount: number;
  cyclic: boolean;
  sharedChildNodeIds: ObjectId[];
  role: "main" | "detached";
}

export interface TreeVisualModel {
  kind: "tree";
  visualId: "tree:TreeNode";
  nodes: TreeNodeVisual[];
  components: TreeComponent[];
  pointers: TreePointerVisual[];
  truncated: boolean;
}

function isReference(
  value: ValueSnapshot | undefined
): value is Extract<ValueSnapshot, { type: "reference" }> {
  return value?.type === "reference";
}

function isNone(value: ValueSnapshot | undefined): boolean {
  return value?.type === "none";
}

function isTreeNodeCandidate(object: ObjectSnapshot): boolean {
  const left = object.attributes.left;
  const right = object.attributes.right;
  return object.className === "TreeNode" &&
    left !== undefined && right !== undefined &&
    (isNone(left) || isReference(left)) &&
    (isNone(right) || isReference(right));
}

function classifyTarget(
  value: ValueSnapshot,
  allObjects: Map<ObjectId, ObjectSnapshot>,
  candidates: Map<ObjectId, ObjectSnapshot>
): { objectId: ObjectId | null; kind: TreeTargetKind } {
  if (value.type === "none") {
    return { objectId: null, kind: "none" };
  }
  const objectId = (value as Extract<ValueSnapshot, { type: "reference" }>).objectId;
  if (candidates.has(objectId)) {
    return { objectId, kind: "tree_node" };
  }
  if (allObjects.has(objectId)) {
    return { objectId, kind: "external" };
  }
  return { objectId, kind: "unresolved" };
}

function sortedObjectIds(objects: Map<ObjectId, ObjectSnapshot>): ObjectId[] {
  return [...objects.keys()].sort((left, right) => left.localeCompare(right));
}

type TreeTargets = Map<ObjectId, {
  left: { objectId: ObjectId | null; kind: TreeTargetKind };
  right: { objectId: ObjectId | null; kind: TreeTargetKind };
}>;

function buildTargets(
  candidates: Map<ObjectId, ObjectSnapshot>,
  allObjects: Map<ObjectId, ObjectSnapshot>
): TreeTargets {
  const targets: TreeTargets = new Map();
  for (const objectId of sortedObjectIds(candidates)) {
    const object = candidates.get(objectId)!;
    targets.set(objectId, {
      left: classifyTarget(object.attributes.left!, allObjects, candidates),
      right: classifyTarget(object.attributes.right!, allObjects, candidates)
    });
  }
  return targets;
}

function internalTargets(targets: TreeTargets): Map<ObjectId, ObjectId[]> {
  const result = new Map<ObjectId, ObjectId[]>();
  for (const [objectId, target] of targets) {
    result.set(objectId, [target.left, target.right]
      .filter((edge): edge is { objectId: ObjectId; kind: "tree_node" } =>
        edge.kind === "tree_node" && edge.objectId !== null
      )
      .map((edge) => edge.objectId));
  }
  return result;
}

function containsCycle(
  candidates: Map<ObjectId, ObjectSnapshot>,
  targets: Map<ObjectId, ObjectId[]>
): boolean {
  const visiting = new Set<ObjectId>();
  const visited = new Set<ObjectId>();

  const visit = (objectId: ObjectId): boolean => {
    if (visiting.has(objectId)) {
      return true;
    }
    if (visited.has(objectId)) {
      return false;
    }
    visiting.add(objectId);
    for (const targetId of [...(targets.get(objectId) ?? [])].sort((left, right) => left.localeCompare(right))) {
      if (visit(targetId)) {
        return true;
      }
    }
    visiting.delete(objectId);
    visited.add(objectId);
    return false;
  };

  return sortedObjectIds(candidates).some((objectId) => visit(objectId));
}

function componentData(
  candidates: Map<ObjectId, ObjectSnapshot>,
  targets: TreeTargets
): { components: Array<Omit<TreeComponent, "role" | "pointerCount">>; incoming: Map<ObjectId, number> } {
  const incoming = new Map<ObjectId, number>();
  const directed = internalTargets(targets);

  for (const objectId of candidates.keys()) {
    incoming.set(objectId, 0);
  }

  const edges: TopologyEdge[] = [];
  for (const [objectId, targetIds] of directed) {
    for (const targetId of targetIds) {
      edges.push({ fromObjectId: objectId, toObjectId: targetId });
      incoming.set(targetId, (incoming.get(targetId) ?? 0) + 1);
    }
  }

  const components = connectedComponents(
    sortedObjectIds(candidates),
    edges,
    "tree-component"
  ).map((component): Omit<TreeComponent, "role" | "pointerCount"> => {
    const { nodeIds } = component;
    const componentNodeIds = new Set(nodeIds);
    return {
      componentId: `tree-component:${nodeIds[0]!}`,
      nodeIds,
      entryNodeIds: nodeIds.filter((objectId) => incoming.get(objectId) === 0),
      cyclic: containsCycle(
        new Map(nodeIds.map((objectId) => [objectId, candidates.get(objectId)!])),
        new Map(nodeIds.map((objectId) => [
          objectId,
          (directed.get(objectId) ?? []).filter((targetId) => componentNodeIds.has(targetId))
        ]))
      ),
      sharedChildNodeIds: nodeIds.filter((objectId) => (incoming.get(objectId) ?? 0) > 1)
    };
  });
  return { components, incoming };
}

function buildPointers(
  runtime: RuntimeState,
  candidates: Map<ObjectId, ObjectSnapshot>,
  mutations: RuntimeMutation[]
): TreePointerVisual[] {
  return buildActiveObjectPointers(runtime, new Set(candidates.keys()), mutations);
}

function objectAttributeMutation(
  mutations: RuntimeMutation[],
  objectId: ObjectId,
  attribute: string
): ReferenceMutation | ObjectAttributeMutation | undefined {
  return mutations.find((mutation): mutation is ReferenceMutation | ObjectAttributeMutation => {
    if (mutation.kind === "reference") {
      return mutation.owner.scope === "object_attribute" &&
        mutation.owner.objectId === objectId &&
        mutation.owner.attribute === attribute;
    }
    return mutation.kind === "object_attribute" &&
      mutation.objectId === objectId &&
      mutation.attribute === attribute;
  });
}

function fieldStatus(
  mutation: ReferenceMutation | ObjectAttributeMutation | undefined
): TreeNodeVisual["leftStatus"] {
  if (!mutation) {
    return "unchanged";
  }
  if (mutation.kind === "reference") {
    switch (mutation.action) {
      case "bound":
        return "added";
      case "unbound":
        return "removed";
      case "redirected":
        return "changed";
    }
  }
  return mutation.action;
}

function objectWasAdded(
  mutations: RuntimeMutation[],
  objectId: ObjectId
): boolean {
  return mutations.some((mutation) =>
    mutation.kind === "object_visibility" &&
    mutation.objectId === objectId &&
    mutation.action === "appeared"
  );
}

function objectWasChanged(
  mutations: RuntimeMutation[],
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

function directlyDetachedObjectIds(
  candidates: Map<ObjectId, ObjectSnapshot>,
  targets: TreeTargets,
  mutations: RuntimeMutation[]
): Set<ObjectId> {
  const incoming = new Map<ObjectId, number>();
  for (const target of internalTargets(targets).values()) {
    for (const objectId of target) {
      incoming.set(objectId, (incoming.get(objectId) ?? 0) + 1);
    }
  }

  const detached = new Set<ObjectId>();
  for (const mutation of mutations) {
    if (
      mutation.kind !== "reference" ||
      mutation.owner.scope !== "object_attribute" ||
      (mutation.owner.attribute !== "left" && mutation.owner.attribute !== "right") ||
      (mutation.action !== "unbound" && mutation.action !== "redirected") ||
      mutation.beforeObjectId === null ||
      mutation.beforeObjectId === mutation.afterObjectId
    ) {
      continue;
    }
    if (candidates.has(mutation.beforeObjectId) && (incoming.get(mutation.beforeObjectId) ?? 0) === 0) {
      detached.add(mutation.beforeObjectId);
    }
  }
  return detached;
}

function rankComponents(
  components: Array<Omit<TreeComponent, "role" | "pointerCount">>,
  pointers: TreePointerVisual[]
): TreeComponent[] {
  const ranked = rankComponentsByPointerCoverage(
    components.map(({ componentId, nodeIds }) => ({ componentId, nodeIds })),
    pointers
  );
  const componentById = new Map(components.map((component) => [component.componentId, component]));
  return ranked.map((rankedComponent): TreeComponent => ({
    ...componentById.get(rankedComponent.componentId)!,
    pointerCount: rankedComponent.pointerCount,
    role: rankedComponent.role === "main" ? "main" : "detached"
  }));
}

export function buildTreeVisuals(
  runtime: RuntimeState,
  mutations: RuntimeMutation[]
): TreeVisualModel[] {
  const allObjects = runtime.objectTopology.objects;
  const candidates = new Map(
    [...allObjects.entries()]
      .filter(([, object]) => isTreeNodeCandidate(object))
  );
  if (candidates.size === 0) {
    return [];
  }

  const targets = buildTargets(candidates, allObjects);
  const detached = directlyDetachedObjectIds(candidates, targets, mutations);
  const nodes = sortedObjectIds(candidates).map((objectId): TreeNodeVisual => {
    const object = candidates.get(objectId)!;
    const target = targets.get(objectId)!;
    const valueStatus = objectAttributeMutation(mutations, objectId, "val")
      ? "changed"
      : "unchanged";
    const leftStatus = fieldStatus(objectAttributeMutation(mutations, objectId, "left"));
    const rightStatus = fieldStatus(objectAttributeMutation(mutations, objectId, "right"));
    return {
      objectId,
      className: "TreeNode",
      label: object.attributes.val === undefined
        ? null
        : cloneValueSnapshot(object.attributes.val),
      leftObjectId: target.left.objectId,
      rightObjectId: target.right.objectId,
      leftTargetKind: target.left.kind,
      rightTargetKind: target.right.kind,
      status: objectWasAdded(mutations, objectId)
        ? "added"
        : detached.has(objectId)
          ? "detached"
          : objectWasChanged(mutations, objectId)
            ? "changed"
            : "unchanged",
      valueStatus,
      leftStatus,
      rightStatus
    };
  });
  const pointers = buildPointers(runtime, candidates, mutations);
  const { components } = componentData(candidates, targets);
  return [{
    kind: "tree",
    visualId: "tree:TreeNode",
    nodes,
    components: rankComponents(components, pointers),
    pointers,
    truncated: runtime.objectTopology.truncated
  }];
}
