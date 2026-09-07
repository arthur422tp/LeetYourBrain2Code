import type { ObjectId, ObjectSnapshot, ValueSnapshot } from "../shared/trace-types";
import type { ObjectTopologyState } from "./runtime-state";
import { cloneValueSnapshot, valueSnapshotsEqual } from "./value-snapshot";

export interface ObjectAttributeDiff {
  objectId: ObjectId;
  attribute: string;
  kind: "added" | "removed" | "changed";
  before?: ValueSnapshot;
  after?: ValueSnapshot;
}

export interface ObjectDiff {
  addedObjectIds: ObjectId[];
  removedObjectIds: ObjectId[];
  attributeChanges: ObjectAttributeDiff[];
}

function sortedKeys<T>(values: Iterable<T>): T[] {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function cloneObject(object: ObjectSnapshot): ObjectSnapshot {
  return {
    ...object,
    attributes: Object.fromEntries(
      Object.entries(object.attributes).map(([name, snapshot]) => [
        name,
        cloneValueSnapshot(snapshot)
      ])
    )
  };
}

export function diffObjectTopology(
  previous: ObjectTopologyState,
  current: ObjectTopologyState
): ObjectDiff {
  const addedObjectIds = sortedKeys(
    [...current.objects.keys()].filter((objectId) => !previous.objects.has(objectId))
  );
  const removedObjectIds = sortedKeys(
    [...previous.objects.keys()].filter((objectId) => !current.objects.has(objectId))
  );
  const attributeChanges: ObjectAttributeDiff[] = [];

  for (const objectId of sortedKeys(current.objects.keys())) {
    const before = previous.objects.get(objectId);
    const after = current.objects.get(objectId);
    if (!before || !after) {
      continue;
    }

    for (const attribute of sortedKeys([
      ...Object.keys(before.attributes),
      ...Object.keys(after.attributes)
    ]).filter((name, index, names) => names.indexOf(name) === index)) {
      const beforeValue = before.attributes[attribute];
      const afterValue = after.attributes[attribute];
      if (beforeValue === undefined && afterValue !== undefined) {
        attributeChanges.push({
          objectId,
          attribute,
          kind: "added",
          after: cloneValueSnapshot(afterValue)
        });
      } else if (beforeValue !== undefined && afterValue === undefined) {
        attributeChanges.push({
          objectId,
          attribute,
          kind: "removed",
          before: cloneValueSnapshot(beforeValue)
        });
      } else if (
        beforeValue !== undefined &&
        afterValue !== undefined &&
        !valueSnapshotsEqual(beforeValue, afterValue)
      ) {
        attributeChanges.push({
          objectId,
          attribute,
          kind: "changed",
          before: cloneValueSnapshot(beforeValue),
          after: cloneValueSnapshot(afterValue)
        });
      }
    }
  }

  return {
    addedObjectIds,
    removedObjectIds,
    attributeChanges
  };
}

export function cloneObjectTopologyState(state: ObjectTopologyState): ObjectTopologyState {
  return {
    objects: new Map(
      [...state.objects.entries()].map(([objectId, object]) => [objectId, cloneObject(object)])
    ),
    truncated: state.truncated
  };
}
