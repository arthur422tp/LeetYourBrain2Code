import type { ObjectDiff } from "./object-diff";
import type { FrameDiff, VariableDiff } from "./state-diff";
import type { MutationOrigin, RuntimeMutation } from "./runtime-mutation";
import type { ValueSnapshot } from "../shared/trace-types";
import { cloneValueSnapshot } from "./value-snapshot";

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

function localVariableMutation(
  diff: VariableDiff,
  frameId: number,
  origin: MutationOrigin
): RuntimeMutation | null {
  if (diff.kind === "unchanged") {
    return null;
  }

  const beforeRef = isReference(diff.before) ? diff.before.objectId : null;
  const afterRef = isReference(diff.after) ? diff.after.objectId : null;
  const beforeAbsentOrNone = diff.before === undefined || isNone(diff.before);
  const afterAbsentOrNone = diff.after === undefined || isNone(diff.after);

  if (afterRef !== null && beforeAbsentOrNone) {
    return {
      kind: "reference",
      origin,
      owner: { scope: "local", frameId, variableName: diff.name },
      action: "bound",
      beforeObjectId: null,
      afterObjectId: afterRef
    };
  }
  if (beforeRef !== null && afterAbsentOrNone) {
    return {
      kind: "reference",
      origin,
      owner: { scope: "local", frameId, variableName: diff.name },
      action: "unbound",
      beforeObjectId: beforeRef,
      afterObjectId: null
    };
  }
  if (beforeRef !== null && afterRef !== null && beforeRef !== afterRef) {
    return {
      kind: "reference",
      origin,
      owner: { scope: "local", frameId, variableName: diff.name },
      action: "redirected",
      beforeObjectId: beforeRef,
      afterObjectId: afterRef
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

export function normalizeRuntimeMutations(
  input: RuntimeMutationNormalizationInput
): RuntimeMutation[] {
  const mutations = input.frameDiff
    ? input.frameDiff.variables
      .map((diff) => localVariableMutation(diff, input.frameDiff!.frameId, input.frameOrigin))
      .filter((mutation): mutation is RuntimeMutation => mutation !== null)
    : [];

  return mutations.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  );
}
