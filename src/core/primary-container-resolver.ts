import type { PointerBinding } from "./binding-resolver";
import { relationMatchesFrameScope, type StaticRelation } from "./ast-relations";
import type { FrameDiff } from "./state-diff";
import type { FrameState, RuntimeState } from "./runtime-state";
import type { ValueSnapshot } from "../shared/trace-types";

export interface ContainerSelection {
  primary: string | null;
  secondary: string[];
}

function activeFrame(state: RuntimeState): FrameState | undefined {
  return state.activeFrameId === null
    ? undefined
    : state.frames.get(state.activeFrameId);
}

function isContainer(snapshot: ValueSnapshot | undefined): boolean {
  return snapshot?.type === "list" ||
    snapshot?.type === "tuple" ||
    snapshot?.type === "dict" ||
    snapshot?.type === "set";
}

export function selectPrimaryContainers(
  state: RuntimeState,
  bindings: PointerBinding[],
  diff: FrameDiff,
  relations: StaticRelation[] = []
): ContainerSelection {
  const frame = activeFrame(state);
  if (!frame) {
    return { primary: null, secondary: [] };
  }

  const allContainers: string[] = [];
  const addCandidate = (name: string): void => {
    if (!isContainer(frame.locals[name]) || allContainers.includes(name)) {
      return;
    }
    allContainers.push(name);
  };

  for (const binding of bindings) {
    if (binding.frameId === frame.frameId) {
      addCandidate(binding.container);
    }
  }
  if (diff.frameId === frame.frameId) {
    for (const change of diff.containerChanges) {
      addCandidate(change.container);
    }
  }
  for (const [name, snapshot] of Object.entries(frame.locals)) {
    if (isContainer(snapshot)) {
      addCandidate(name);
    }
  }

  const bindingContainers = bindings
    .filter((binding) => binding.frameId === frame.frameId)
    .map((binding) => binding.container);
  const changedContainers = diff.frameId === frame.frameId
    ? diff.containerChanges.map((change) => change.container)
    : [];
  const activeLineContainers = relations
    .filter((relation) =>
      relation.kind !== "membership" &&
      state.currentLine !== null &&
      relation.line === state.currentLine &&
      relationMatchesFrameScope(relation, frame.functionName) &&
      bindings.some((binding) =>
        binding.frameId === frame.frameId &&
        binding.container === relation.container &&
        binding.variable === relation.index
      )
    )
    .map((relation) => relation.container);
  const prioritizedContainers = relations.length > 0
    ? [...activeLineContainers, ...changedContainers, ...bindingContainers]
    : [...bindingContainers, ...changedContainers];
  const primary = prioritizedContainers.find((name) => allContainers.includes(name)) ?? null;
  return {
    primary,
    secondary: allContainers.filter((name) => name !== primary)
  };
}

export const resolvePrimaryContainers = selectPrimaryContainers;
