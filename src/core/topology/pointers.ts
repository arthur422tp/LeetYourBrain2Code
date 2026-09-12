import type { RuntimeMutation, ReferenceMutation } from "../runtime-mutation";
import type { RuntimeState } from "../runtime-state";
import type { ObjectId, ValueSnapshot } from "../../shared/trace-types";

export interface ObjectPointerVisual {
  variableName: string;
  objectId: ObjectId | null;
  status: "unchanged" | "moved" | "added" | "removed";
}

function isReference(
  value: ValueSnapshot | undefined
): value is Extract<ValueSnapshot, { type: "reference" }> {
  return value?.type === "reference";
}

function activeFrame(runtime: RuntimeState) {
  return runtime.activeFrameId === null
    ? undefined
    : runtime.frames.get(runtime.activeFrameId);
}

function localReferenceMutation(
  mutations: readonly RuntimeMutation[],
  frameId: number,
  variableName: string
): ReferenceMutation | undefined {
  return mutations.find((mutation): mutation is ReferenceMutation =>
    mutation.kind === "reference" &&
    mutation.owner.scope === "local" &&
    mutation.owner.frameId === frameId &&
    mutation.owner.variableName === variableName
  );
}

function pointerStatus(
  mutation: ReferenceMutation | undefined
): ObjectPointerVisual["status"] {
  if (!mutation) {
    return "unchanged";
  }
  switch (mutation.action) {
    case "bound":
      return "added";
    case "unbound":
      return "removed";
    case "redirected":
      return "moved";
  }
}

export function buildActiveObjectPointers(
  runtime: RuntimeState,
  candidateObjectIds: ReadonlySet<ObjectId>,
  mutations: readonly RuntimeMutation[]
): ObjectPointerVisual[] {
  const frame = activeFrame(runtime);
  if (!frame) {
    return [];
  }

  const pointers: ObjectPointerVisual[] = Object.entries(frame.locals)
    .filter(([, value]) => isReference(value) && candidateObjectIds.has(value.objectId))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([variableName, value]) => ({
      variableName,
      objectId: (value as Extract<ValueSnapshot, { type: "reference" }>).objectId,
      status: pointerStatus(localReferenceMutation(mutations, frame.frameId, variableName))
    }));

  for (const mutation of mutations) {
    if (mutation.kind !== "reference" || mutation.owner.scope !== "local") {
      continue;
    }
    if (
      mutation.owner.frameId !== frame.frameId ||
      mutation.action !== "unbound" ||
      mutation.beforeObjectId === null ||
      !candidateObjectIds.has(mutation.beforeObjectId)
    ) {
      continue;
    }

    const variableName = mutation.owner.variableName;
    if (pointers.some((pointer) => pointer.variableName === variableName)) {
      continue;
    }
    pointers.push({ variableName, objectId: null, status: "removed" });
  }

  return pointers.sort((left, right) =>
    left.variableName.localeCompare(right.variableName) ||
    (left.objectId ?? "").localeCompare(right.objectId ?? "")
  );
}
