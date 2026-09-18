import type { ExecutionContextRef, LoopIterationEvidence } from "../shared/control-flow-types";

export function controlFlowActivationKey(frameId: number, loopId: string, context: ExecutionContextRef): string {
  let ownIndex = -1;
  for (let index = context.loopStack.length - 1; index >= 0; index -= 1) {
    if (context.loopStack[index]!.loopId === loopId) { ownIndex = index; break; }
  }
  const parents = ownIndex >= 0 ? context.loopStack.slice(0, ownIndex) : context.loopStack;
  return `${frameId}:${parents.length ? parents.map(item => `${item.loopId}#${item.iteration}`).join("/") : "root"}>${loopId}`;
}

export function iterationActivationKey(iteration: LoopIterationEvidence): string {
  return controlFlowActivationKey(iteration.frameId, iteration.loopId, iteration.context);
}
