import type { ObjectId } from "../../shared/trace-types";

export interface TopologyEdge {
  fromObjectId: ObjectId;
  toObjectId: ObjectId;
}

export interface TopologyComponentBase {
  componentId: string;
  nodeIds: ObjectId[];
}

function compareObjectIds(left: ObjectId, right: ObjectId): number {
  return left.localeCompare(right);
}

export function connectedComponents(
  nodeIds: readonly ObjectId[],
  edges: readonly TopologyEdge[],
  componentPrefix: string
): TopologyComponentBase[] {
  const orderedNodeIds = [...new Set(nodeIds)].sort(compareObjectIds);
  const adjacency = new Map<ObjectId, Set<ObjectId>>(
    orderedNodeIds.map((objectId) => [objectId, new Set<ObjectId>()])
  );

  for (const edge of edges) {
    if (!adjacency.has(edge.fromObjectId) || !adjacency.has(edge.toObjectId)) {
      continue;
    }
    adjacency.get(edge.fromObjectId)!.add(edge.toObjectId);
    adjacency.get(edge.toObjectId)!.add(edge.fromObjectId);
  }

  const visited = new Set<ObjectId>();
  const components: TopologyComponentBase[] = [];
  for (const start of orderedNodeIds) {
    if (visited.has(start)) {
      continue;
    }

    const queue = [start];
    const componentNodeIds: ObjectId[] = [];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      componentNodeIds.push(current);
      for (const neighbor of [...adjacency.get(current)!].sort(compareObjectIds)) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    componentNodeIds.sort(compareObjectIds);
    components.push({
      componentId: `${componentPrefix}:${componentNodeIds[0]!}`,
      nodeIds: componentNodeIds
    });
  }

  return components.sort((left, right) => left.componentId.localeCompare(right.componentId));
}
