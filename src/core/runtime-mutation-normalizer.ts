import type { ObjectDiff } from "./object-diff";
import type { FrameDiff, VariableDiff } from "./state-diff";
import type {
  MappingEntryMutation,
  MutationOrigin,
  ObjectAttributeMutation,
  ReferenceMutation,
  RuntimeMutation,
  SequenceElementMutation,
  SetMembershipMutation
} from "./runtime-mutation";
import type { ValueSnapshot } from "../shared/trace-types";
import { cloneValueSnapshot, valueSnapshotKey } from "./value-snapshot";

export interface RuntimeMutationNormalizationInput {
  frameDiff: FrameDiff | null;
  objectDiff: ObjectDiff;
  frameOrigin: MutationOrigin;
  objectOrigin: MutationOrigin;
}

function isReference(
  value: ValueSnapshot | undefined
): value is Extract<ValueSnapshot, { type: "reference" }> {
  return value?.type === "reference";
}

function isNone(value: ValueSnapshot | undefined): boolean {
  return value?.type === "none";
}

function classifyReferenceTransition(
  before: ValueSnapshot | undefined,
  after: ValueSnapshot | undefined
): Pick<ReferenceMutation, "action" | "beforeObjectId" | "afterObjectId"> | null {
  const beforeRef = isReference(before) ? before.objectId : null;
  const afterRef = isReference(after) ? after.objectId : null;
  const beforeAbsentOrNone = before === undefined || isNone(before);
  const afterAbsentOrNone = after === undefined || isNone(after);

  if (afterRef !== null && beforeAbsentOrNone) {
    return { action: "bound", beforeObjectId: null, afterObjectId: afterRef };
  }
  if (beforeRef !== null && afterAbsentOrNone) {
    return { action: "unbound", beforeObjectId: beforeRef, afterObjectId: null };
  }
  if (beforeRef !== null && afterRef !== null && beforeRef !== afterRef) {
    return {
      action: "redirected",
      beforeObjectId: beforeRef,
      afterObjectId: afterRef
    };
  }
  return null;
}

function localVariableMutation(
  diff: VariableDiff,
  frameId: number,
  origin: MutationOrigin
): RuntimeMutation | null {
  if (diff.kind === "unchanged") {
    return null;
  }

  const referenceTransition = classifyReferenceTransition(diff.before, diff.after);
  if (referenceTransition) {
    return {
      kind: "reference",
      origin,
      owner: { scope: "local", frameId, variableName: diff.name },
      ...referenceTransition
    };
  }

  return {
    kind: "variable",
    origin,
    frameId,
    variableName: diff.name,
    action: diff.kind,
    ...(diff.before !== undefined ? { before: cloneValueSnapshot(diff.before) } : {}),
    ...(diff.after !== undefined ? { after: cloneValueSnapshot(diff.after) } : {})
  };
}

function sequenceElementMutation(
  container: Extract<FrameDiff["containerChanges"][number], { kind: "list" | "tuple" }>,
  change: (typeof container.changes)[number],
  frameId: number,
  origin: MutationOrigin
): SequenceElementMutation {
  return {
    kind: "sequence_element",
    origin,
    frameId,
    containerName: container.container,
    containerKind: container.kind,
    index: change.index,
    action: change.kind,
    ...(change.before !== undefined ? { before: cloneValueSnapshot(change.before) } : {}),
    ...(change.after !== undefined ? { after: cloneValueSnapshot(change.after) } : {})
  };
}

function mappingEntryMutation(
  container: Extract<FrameDiff["containerChanges"][number], { kind: "dict" }>,
  change: (typeof container.changes)[number],
  frameId: number,
  origin: MutationOrigin
): MappingEntryMutation {
  return {
    kind: "mapping_entry",
    origin,
    frameId,
    containerName: container.container,
    key: cloneValueSnapshot(change.key),
    action: change.kind,
    ...(change.before !== undefined ? { before: cloneValueSnapshot(change.before) } : {}),
    ...(change.after !== undefined ? { after: cloneValueSnapshot(change.after) } : {})
  };
}

function setMembershipMutation(
  container: Extract<FrameDiff["containerChanges"][number], { kind: "set" }>,
  change: (typeof container.changes)[number],
  frameId: number,
  origin: MutationOrigin
): SetMembershipMutation {
  return {
    kind: "set_membership",
    origin,
    frameId,
    containerName: container.container,
    action: change.kind,
    member: cloneValueSnapshot(change.member)
  };
}

function objectAttributeMutation(
  change: ObjectDiff["attributeChanges"][number],
  origin: MutationOrigin
): RuntimeMutation {
  const referenceTransition = classifyReferenceTransition(change.before, change.after);
  if (referenceTransition) {
    return {
      kind: "reference",
      origin,
      owner: {
        scope: "object_attribute",
        objectId: change.objectId,
        attribute: change.attribute
      },
      ...referenceTransition
    };
  }

  const mutation: ObjectAttributeMutation = {
    kind: "object_attribute",
    origin,
    objectId: change.objectId,
    attribute: change.attribute,
    action: change.kind,
    ...(change.before !== undefined ? { before: cloneValueSnapshot(change.before) } : {}),
    ...(change.after !== undefined ? { after: cloneValueSnapshot(change.after) } : {})
  };
  return mutation;
}

function categoryRank(mutation: RuntimeMutation): number {
  if (mutation.kind === "reference") {
    return mutation.owner.scope === "local" ? 0 : 6;
  }
  return {
    variable: 1,
    sequence_element: 2,
    mapping_entry: 3,
    set_membership: 4,
    object_visibility: 5,
    object_attribute: 7
  }[mutation.kind];
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function mutationSortKey(mutation: RuntimeMutation): string {
  switch (mutation.kind) {
    case "reference":
      return mutation.owner.scope === "local"
        ? `${mutation.owner.frameId}\u0000${mutation.owner.variableName}`
        : `${mutation.owner.objectId}\u0000${mutation.owner.attribute}`;
    case "variable":
      return `${mutation.frameId}\u0000${mutation.variableName}`;
    case "sequence_element":
      return `${mutation.frameId}\u0000${mutation.containerName}\u0000${mutation.index}`;
    case "mapping_entry":
      return `${mutation.frameId}\u0000${mutation.containerName}\u0000${valueSnapshotKey(mutation.key)}`;
    case "set_membership":
      return `${mutation.frameId}\u0000${mutation.containerName}\u0000${valueSnapshotKey(mutation.member)}`;
    case "object_visibility":
      return mutation.objectId;
    case "object_attribute":
      return `${mutation.objectId}\u0000${mutation.attribute}`;
  }
}

function compareMutationKeys(left: RuntimeMutation, right: RuntimeMutation): number {
  if (left.kind === "reference" && right.kind === "reference" &&
      left.owner.scope === "local" && right.owner.scope === "local") {
    return compareNumbers(left.owner.frameId, right.owner.frameId) ||
      compareStrings(left.owner.variableName, right.owner.variableName);
  }
  if (left.kind === "variable" && right.kind === "variable") {
    return compareNumbers(left.frameId, right.frameId) ||
      compareStrings(left.variableName, right.variableName);
  }
  if (left.kind === "sequence_element" && right.kind === "sequence_element") {
    return compareNumbers(left.frameId, right.frameId) ||
      compareStrings(left.containerName, right.containerName) ||
      compareNumbers(left.index, right.index);
  }
  if (left.kind === "mapping_entry" && right.kind === "mapping_entry") {
    return compareNumbers(left.frameId, right.frameId) ||
      compareStrings(left.containerName, right.containerName) ||
      compareStrings(valueSnapshotKey(left.key), valueSnapshotKey(right.key));
  }
  if (left.kind === "set_membership" && right.kind === "set_membership") {
    return compareNumbers(left.frameId, right.frameId) ||
      compareStrings(left.containerName, right.containerName) ||
      compareStrings(valueSnapshotKey(left.member), valueSnapshotKey(right.member));
  }
  if (left.kind === "object_visibility" && right.kind === "object_visibility") {
    return compareStrings(left.objectId, right.objectId);
  }
  if (left.kind === "reference" && right.kind === "reference" &&
      left.owner.scope === "object_attribute" && right.owner.scope === "object_attribute") {
    return compareStrings(left.owner.objectId, right.owner.objectId) ||
      compareStrings(left.owner.attribute, right.owner.attribute);
  }
  if (left.kind === "object_attribute" && right.kind === "object_attribute") {
    return compareStrings(left.objectId, right.objectId) ||
      compareStrings(left.attribute, right.attribute);
  }
  return compareStrings(mutationSortKey(left), mutationSortKey(right)) ||
    compareStrings(JSON.stringify(left), JSON.stringify(right));
}

export function normalizeRuntimeMutations(
  input: RuntimeMutationNormalizationInput
): RuntimeMutation[] {
  const mutations: RuntimeMutation[] = [];
  const frameDiff = input.frameDiff;

  if (frameDiff) {
    const granularContainers = new Set(
      frameDiff.containerChanges.map((change) => change.container)
    );

    for (const variable of frameDiff.variables) {
      if (variable.kind === "changed" && granularContainers.has(variable.name)) {
        continue;
      }
      const mutation = localVariableMutation(variable, frameDiff.frameId, input.frameOrigin);
      if (mutation) {
        mutations.push(mutation);
      }
    }

    for (const container of frameDiff.containerChanges) {
      if (container.kind === "list" || container.kind === "tuple") {
        for (const change of container.changes) {
          mutations.push(sequenceElementMutation(container, change, frameDiff.frameId, input.frameOrigin));
        }
      } else if (container.kind === "dict") {
        for (const change of container.changes) {
          mutations.push(mappingEntryMutation(container, change, frameDiff.frameId, input.frameOrigin));
        }
      } else {
        const setContainer = container as Extract<
          FrameDiff["containerChanges"][number],
          { kind: "set" }
        >;
        for (const change of setContainer.changes) {
          mutations.push(setMembershipMutation(setContainer, change, frameDiff.frameId, input.frameOrigin));
        }
      }
    }
  }

  for (const objectId of input.objectDiff.addedObjectIds) {
    mutations.push({
      kind: "object_visibility",
      origin: input.objectOrigin,
      objectId,
      action: "appeared"
    });
  }
  for (const objectId of input.objectDiff.removedObjectIds) {
    mutations.push({
      kind: "object_visibility",
      origin: input.objectOrigin,
      objectId,
      action: "disappeared"
    });
  }
  for (const change of input.objectDiff.attributeChanges) {
    mutations.push(objectAttributeMutation(change, input.objectOrigin));
  }

  return mutations.sort((left, right) =>
    categoryRank(left) - categoryRank(right) || compareMutationKeys(left, right)
  );
}
