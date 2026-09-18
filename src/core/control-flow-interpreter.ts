import { iterationActivationKey } from "./control-flow-scope";
import type { TerminationReason, TraceSessionStatus } from "../shared/execution-types";
import type {
  ControlActionEvidence,
  ControlFlowBatch,
  ControlFlowPlan,
  ControlFlowRuntimeEvent,
  ExecutionContextRef,
  LoopExitEvidence,
  LoopIterationEvidence
} from "../shared/control-flow-types";
import type { RuntimeState } from "./runtime-state";

export interface TraceTerminationContext {
  status: TraceSessionStatus;
  terminationReason: TerminationReason;
}

export interface ControlFlowInterpretation {
  iterations: LoopIterationEvidence[];
  actions: ControlActionEvidence[];
  loopExits: LoopExitEvidence[];
  contextByStep: Map<number, ExecutionContextRef>;
  iterationsByLoop: Map<string, LoopIterationEvidence[]>;
  iterationsByActivation: Map<string, LoopIterationEvidence[]>;
}

interface OpenIteration extends Omit<LoopIterationEvidence, "status"> {
  status: LoopIterationEvidence["status"] | "open";
}

interface ActiveLoopRuntime {
  frameId: number;
  loopId: string;
  loopKind: "for" | "while";
  context: ExecutionContextRef;
  lastAnchorStep: number;
}

export function controlFlowLoopKey(frameId: number, loopId: string): string {
  return `${frameId}:${loopId}`;
}

function cloneContext(context: ExecutionContextRef): ExecutionContextRef {
  return { loopStack: context.loopStack.map((item) => ({ ...item })) };
}

function occurrenceKey(frameId: number, loopId: string, iteration: number): string {
  return `${frameId}:${loopId}:${iteration}`;
}

function runtimeEvents(batches: ControlFlowBatch[]): ControlFlowRuntimeEvent[] {
  const ordered: Array<{ event: ControlFlowRuntimeEvent; order: number }> = [];
  [...batches].sort((left, right) => left.batchId - right.batchId).forEach((batch) => {
    batch.events.forEach((event, index) => ordered.push({ event, order: ordered.length + index }));
  });
  return ordered
    .sort((left, right) => left.event.eventId - right.event.eventId || left.order - right.order)
    .map((item) => item.event);
}

export function buildControlFlowEvidence(
  _plan: ControlFlowPlan | undefined,
  batches: ControlFlowBatch[],
  runtimeStates: RuntimeState[],
  termination?: TraceTerminationContext
): ControlFlowInterpretation {
  const iterationsById = new Map<string, OpenIteration>();
  const activeIterations = new Map<string, OpenIteration>();
  const activeLoops = new Map<string, ActiveLoopRuntime>();
  const actions = new Map<string, ControlActionEvidence>();
  const loopExits: LoopExitEvidence[] = [];
  const loopExitKeys = new Set<string>();
  const events = runtimeEvents(batches);
  const lastCapturedStep = Math.max(
    0,
    ...runtimeStates.map((state) => state.step),
    ...events.map((event) => event.anchorStep)
  );

  const findOccurrence = (frameId: number, loopId: string, context: ExecutionContextRef): OpenIteration | undefined => {
    const matching = [...context.loopStack].reverse().find((item) => item.loopId === loopId);
    if (!matching) return undefined;
    return activeIterations.get(occurrenceKey(frameId, matching.loopId, matching.iteration));
  };

  const markIteration = (
    frameId: number,
    context: ExecutionContextRef,
    loopId: string,
    status: LoopIterationEvidence["status"],
    anchorStep: number,
    actionId?: string
  ): void => {
    const iteration = findOccurrence(frameId, loopId, context);
    if (!iteration || iteration.status !== "open") return;
    iteration.status = status;
    iteration.anchorStepEnd = Math.max(iteration.anchorStepEnd, anchorStep);
    if (actionId) iteration.exitActionId = actionId;
    activeIterations.delete(occurrenceKey(frameId, iteration.loopId, iteration.iteration));
  };

  for (const event of events) {
    if (event.kind === "iteration_begin") {
      const key = occurrenceKey(event.frameId, event.loopId, event.iteration);
      if (!iterationsById.has(key)) {
        const iteration: OpenIteration = {
          frameId: event.frameId,
          loopId: event.loopId,
          iteration: event.iteration,
          context: cloneContext(event.context),
          anchorStepStart: event.anchorStep,
          anchorStepEnd: event.anchorStep,
          bindings: event.bindings.map((binding) => ({ name: binding.name, value: binding.value })),
          status: "open"
        };
        iterationsById.set(key, iteration);
        activeIterations.set(key, iteration);
      }
      activeLoops.set(controlFlowLoopKey(event.frameId, event.loopId), {
        frameId: event.frameId,
        loopId: event.loopId,
        loopKind: event.loopKind,
        context: cloneContext(event.context),
        lastAnchorStep: event.anchorStep
      });
      continue;
    }
    if (event.kind === "iteration_complete") {
      const key = occurrenceKey(event.frameId, event.loopId, event.iteration);
      const iteration = activeIterations.get(key);
      if (iteration && iteration.status === "open") {
        iteration.status = "completed";
        iteration.anchorStepEnd = Math.max(iteration.anchorStepEnd, event.anchorStep);
        activeIterations.delete(key);
      }
      continue;
    }
    if (event.kind === "transfer_observed") {
      actions.set(event.actionId, {
        actionId: event.actionId,
        transferId: event.transferId,
        kind: event.transferKind,
        frameId: event.frameId,
        context: cloneContext(event.context),
        anchorStepObserved: event.anchorStep,
        ...(event.targetLoopId ? { targetLoopId: event.targetLoopId } : {}),
        status: "observed"
      });
      continue;
    }
    if (event.kind === "transfer_status") {
      const action = actions.get(event.actionId);
      if (!action) continue;
      action.status = event.status;
      action.anchorStepResolved = event.anchorStep;
      if (event.supersededByActionId) action.supersededByActionId = event.supersededByActionId;
      if (event.status === "committed") {
        if (action.kind === "continue" && action.targetLoopId) {
          markIteration(action.frameId, action.context, action.targetLoopId, "continued", event.anchorStep, action.actionId);
        } else if (action.kind === "break" && action.targetLoopId) {
          markIteration(action.frameId, action.context, action.targetLoopId, "broke", event.anchorStep, action.actionId);
        } else if (action.kind === "return") {
          for (const item of action.context.loopStack) {
            markIteration(action.frameId, action.context, item.loopId, "function_returned", event.anchorStep, action.actionId);
          }
        }
      }
      continue;
    }
    const exit: LoopExitEvidence = {
      frameId: event.frameId,
      loopId: event.loopId,
      loopKind: event.loopKind,
      context: cloneContext(event.context),
      anchorStep: event.anchorStep,
      reason: event.reason
    };
    const exitKey = `${exit.frameId}:${exit.loopId}:${exit.anchorStep}:${exit.reason}`;
    if (!loopExitKeys.has(exitKey)) {
      loopExitKeys.add(exitKey);
      loopExits.push(exit);
    }
    activeLoops.delete(controlFlowLoopKey(event.frameId, event.loopId));
    if (event.reason === "break") markIteration(event.frameId, event.context, event.loopId, "broke", event.anchorStep);
    if (event.reason === "function_return") markIteration(event.frameId, event.context, event.loopId, "function_returned", event.anchorStep);
    if (event.reason === "exception" || event.reason === "trace_ended") markIteration(event.frameId, event.context, event.loopId, "interrupted", event.anchorStep);
  }

  const needsInterruption = termination?.status === "timeout" || termination?.status === "trace_limit" || termination?.status === "internal_error" || termination?.status === "exception";
  if (needsInterruption) {
    const reason = termination?.status === "exception" ? "exception" : "trace_ended";
    for (const iteration of activeIterations.values()) {
      if (iteration.status !== "open") continue;
      iteration.status = "interrupted";
      iteration.anchorStepEnd = lastCapturedStep;
    }
    activeIterations.clear();

    const activeLoopList = [...activeLoops.values()].sort((left, right) =>
      right.context.loopStack.length - left.context.loopStack.length
      || right.lastAnchorStep - left.lastAnchorStep
    );
    for (const loop of activeLoopList) {
      const exit: LoopExitEvidence = {
        frameId: loop.frameId,
        loopId: loop.loopId,
        loopKind: loop.loopKind,
        context: cloneContext(loop.context),
        anchorStep: lastCapturedStep,
        reason
      };
      const exitKey = `${exit.frameId}:${exit.loopId}:${exit.anchorStep}:${exit.reason}`;
      if (!loopExitKeys.has(exitKey)) {
        loopExitKeys.add(exitKey);
        loopExits.push(exit);
      }
    }
    activeLoops.clear();
  }

  for (const iteration of activeIterations.values()) {
    if (iteration.status === "open") {
      iteration.status = "interrupted";
      iteration.anchorStepEnd = lastCapturedStep;
    }
  }
  activeIterations.clear();

  const iterations = [...iterationsById.values()].filter((iteration): iteration is LoopIterationEvidence => iteration.status !== "open");
  const contextByStep = new Map<number, ExecutionContextRef>();
  for (const state of runtimeStates) {
    const matching = iterations
      .filter((iteration) => iteration.anchorStepStart <= state.step && state.step <= iteration.anchorStepEnd)
      .sort((left, right) => right.context.loopStack.length - left.context.loopStack.length);
    contextByStep.set(state.step, matching[0] ? cloneContext(matching[0].context) : { loopStack: [] });
  }
  const iterationsByLoop = new Map<string, LoopIterationEvidence[]>();
  for (const iteration of iterations) {
    const key = controlFlowLoopKey(iteration.frameId, iteration.loopId);
    const history = iterationsByLoop.get(key) ?? [];
    history.push(iteration);
    iterationsByLoop.set(key, history);
  }
  for (const history of iterationsByLoop.values()) history.sort((left, right) => left.iteration - right.iteration || left.anchorStepStart - right.anchorStepStart);

  const iterationsByActivation = new Map<string, LoopIterationEvidence[]>();
  for (const iteration of iterations) {
    const key = iterationActivationKey(iteration);
    const history = iterationsByActivation.get(key) ?? [];
    history.push(iteration);
    iterationsByActivation.set(key, history);
  }
  for (const history of iterationsByActivation.values()) history.sort((a, b) => a.anchorStepStart - b.anchorStepStart);

  return {
    iterationsByActivation,
    iterations,
    actions: [...actions.values()],
    loopExits,
    contextByStep,
    iterationsByLoop
  };
}
