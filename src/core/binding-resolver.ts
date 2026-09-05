import type { FrameState, RuntimeState } from "./runtime-state";
import {
  relationMatchesFrameScope,
  type SubscriptRelation
} from "./ast-relations";
import type { ValueSnapshot } from "../shared/trace-types";

export interface PointerBinding {
  frameId: number;
  variable: string;
  container: string;
  index: number;
  source: "subscript";
  confidence: 1;
}

function activeFrame(state: RuntimeState): FrameState | undefined {
  return state.activeFrameId === null
    ? undefined
    : state.frames.get(state.activeFrameId);
}

function integerValue(snapshot: ValueSnapshot | undefined): number | null {
  if (snapshot?.type !== "int" || !/^-?\d+$/.test(snapshot.value)) {
    return null;
  }
  const value = Number(snapshot.value);
  return Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

function isVisualizableContainer(snapshot: ValueSnapshot | undefined): boolean {
  return snapshot?.type === "list" || snapshot?.type === "tuple";
}

export function resolvePointerBindings(
  relations: SubscriptRelation[],
  state: RuntimeState
): PointerBinding[] {
  const frame = activeFrame(state);
  if (!frame) {
    return [];
  }

  const bindings: PointerBinding[] = [];
  const seen = new Set<string>();
  for (const relation of relations) {
    if (!relationMatchesFrameScope(relation, frame.functionName)) {
      continue;
    }
    const containerSnapshot = frame.locals[relation.container];
    if (!isVisualizableContainer(containerSnapshot)) {
      continue;
    }
    const index = integerValue(frame.locals[relation.index]);
    if (index === null) {
      continue;
    }

    const bindingKey = `${relation.index}\u0000${relation.container}\u0000${index}`;
    if (seen.has(bindingKey)) {
      continue;
    }
    seen.add(bindingKey);
    bindings.push({
      frameId: frame.frameId,
      variable: relation.index,
      container: relation.container,
      index,
      source: "subscript",
      confidence: 1
    });
  }
  return bindings;
}

export const resolveBindings = resolvePointerBindings;
export const bindPointers = resolvePointerBindings;
