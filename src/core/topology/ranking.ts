import type { ObjectId } from "../../shared/trace-types";
import type { ObjectPointerVisual } from "./pointers";
import type { TopologyComponentBase } from "./components";

export interface RankedTopologyComponent extends TopologyComponentBase {
  pointerCount: number;
  role: "main" | "secondary";
}

export function rankComponentsByPointerCoverage(
  components: readonly TopologyComponentBase[],
  pointers: readonly ObjectPointerVisual[]
): RankedTopologyComponent[] {
  const componentByNode = new Map<ObjectId, string>();
  for (const component of components) {
    for (const nodeId of component.nodeIds) {
      componentByNode.set(nodeId, component.componentId);
    }
  }

  const pointerCounts = new Map<string, number>();
  for (const pointer of pointers) {
    if (pointer.objectId === null) {
      continue;
    }
    const componentId = componentByNode.get(pointer.objectId);
    if (componentId !== undefined) {
      pointerCounts.set(componentId, (pointerCounts.get(componentId) ?? 0) + 1);
    }
  }

  const ranked = components.map((component): RankedTopologyComponent => ({
    componentId: component.componentId,
    nodeIds: [...component.nodeIds],
    pointerCount: pointerCounts.get(component.componentId) ?? 0,
    role: "secondary"
  })).sort((left, right) =>
    right.pointerCount - left.pointerCount ||
    right.nodeIds.length - left.nodeIds.length ||
    left.componentId.localeCompare(right.componentId)
  );

  const mainId = ranked[0]?.componentId;
  return ranked.map((component) => ({
    ...component,
    role: component.componentId === mainId ? "main" : "secondary"
  }));
}
