import type { ControlActionEvidence, ControlFlowBindingSnapshot, ControlFlowPlan, ControlFlowTracingState, ExecutionContextRef, IterationStatus, LoopExitEvidence, LoopExitReason, LoopIterationEvidence, LoopKind, TransferKind } from "../shared/control-flow-types";
import type { ConditionEvidenceNode, DecisionChainOccurrence, DecisionEvidenceByStep } from "../shared/decision-types";
import type { ControlFlowInterpretation } from "./control-flow-interpreter";
import { controlFlowActivationKey } from "./control-flow-scope";

export interface LoopActivationIterationView {
  ordinal: number;
  iteration: LoopIterationEvidence;
}

export interface LoopActivationParentView {
  loopId: string;
  loopKind: LoopKind;
  line: number;
  iteration: number;
}

export interface LoopActivationView {
  activationKey: string;
  frameId: number;
  loopId: string;
  loopKind: LoopKind;
  line: number;
  parentContext: ExecutionContextRef;
  parentLoops: LoopActivationParentView[];
  iterations: LoopActivationIterationView[];
}

export type ExecutionStoryItem =
  | { kind: "iteration_start"; anchorStep: number; ordinal: number; loopId: string; bindings: ControlFlowBindingSnapshot[] }
  | { kind: "decision"; anchorStep: number; siteId: string; source: string; status: "true" | "false" | "partial"; shortCircuited: boolean }
  | { kind: "transfer"; anchorStep: number; actionId: string; transferId: string; transferKind: TransferKind; phase: "observed" | "committed" | "superseded" | "interrupted"; source: string; supersededByActionId?: string }
  | { kind: "iteration_outcome"; anchorStep: number; status: IterationStatus }
  | { kind: "loop_exit"; anchorStep: number; loopId: string; reason: LoopExitReason }
  | { kind: "frame_exit"; anchorStep: number; actionId: string; bareReturn?: boolean };

export interface ControlFlowUiModel {
  currentContext?: ExecutionContextRef;
  currentActivation?: LoopActivationView;
  currentIteration?: LoopActivationIterationView;
  currentActions: ControlActionEvidence[];
  currentLoopExit?: LoopExitEvidence;
  iterationHistory: LoopActivationIterationView[];
  decisionChainOccurrence?: DecisionChainOccurrence;
  storyItems: ExecutionStoryItem[];
  tracingState?: ControlFlowTracingState;
}

export interface BuildControlFlowUiModelInput {
  step: number;
  frameId: number;
  sourceCode: string;
  plan: ControlFlowPlan | undefined;
  controlFlow: ControlFlowInterpretation;
  decisionEvidence: DecisionEvidenceByStep;
  decisionChains: DecisionChainOccurrence[];
  tracingState?: ControlFlowTracingState;
}

function hasShortCircuit(node: ConditionEvidenceNode): boolean {
  return node.status === "short_circuited" || node.children.some(hasShortCircuit);
}

function activationView(input: BuildControlFlowUiModelInput, key: string, loopId: string, context: ExecutionContextRef): LoopActivationView | undefined {
  const descriptor = input.plan?.loops.find(loop => loop.loopId === loopId);
  if (!descriptor) return undefined;
  const own = context.loopStack.findIndex(loop => loop.loopId === loopId);
  const parentContext = { loopStack: own < 0 ? context.loopStack : context.loopStack.slice(0, own) };
  const parentLoops = parentContext.loopStack.flatMap((parent) => {
    const parentDescriptor = input.plan?.loops.find(loop => loop.loopId === parent.loopId);
    return parentDescriptor
      ? [{
          loopId: parent.loopId,
          loopKind: parentDescriptor.kind,
          line: parentDescriptor.span.line,
          iteration: parent.iteration
        }]
      : [];
  });
  return {
    activationKey: key, frameId: input.frameId, loopId, loopKind: descriptor.kind, line: descriptor.span.line,
    parentContext,
    parentLoops,
    iterations: (input.controlFlow.iterationsByActivation.get(key) ?? []).map((iteration, index) => ({ ordinal: index + 1, iteration }))
  };
}

function transferSource(input: BuildControlFlowUiModelInput, action: ControlActionEvidence): string | undefined {
  const span = input.plan?.transfers.find(item => item.transferId === action.transferId)?.span;
  if (!span) return undefined;
  // Python AST columns are UTF-8 byte offsets, not JavaScript character offsets.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const lines = input.sourceCode.split("\n").slice(span.line - 1, span.endLine);
  return lines.map((line, index) => decoder.decode(encoder.encode(line).slice(index === 0 ? span.column : 0, index === lines.length - 1 ? span.endColumn : undefined))).join("\n").trim() || undefined;
}

function itemRank(item: ExecutionStoryItem): number {
  switch (item.kind) {
    case "iteration_start": return 0;
    case "decision": return 1;
    case "transfer": return item.phase === "observed" ? 2 : 3;
    case "iteration_outcome": return 4;
    case "loop_exit": return 5;
    case "frame_exit": return 6;
  }
}

export function buildControlFlowUiModel(input: BuildControlFlowUiModelInput): ControlFlowUiModel {
  const { controlFlow, step, frameId } = input;
  const currentContext = controlFlow.contextByStep.get(step);
  const deepest = currentContext?.loopStack.at(-1);
  const exactExit = controlFlow.loopExits
    .filter(exit => exit.frameId === frameId && exit.anchorStep === step)
    .sort((a, b) => b.context.loopStack.length - a.context.loopStack.length)[0];
  let activation = deepest && currentContext
    ? activationView(input, controlFlowActivationKey(frameId, deepest.loopId, currentContext), deepest.loopId, currentContext)
    : undefined;
  if (activation && activation.iterations.length === 0) activation = undefined;
  // An exit anchor describes the loop that closed, even when its parent remains active.
  // Exit contexts retain the parent occurrence after their own stack entry is removed.
  if (exactExit) {
    const key = controlFlowActivationKey(frameId, exactExit.loopId, exactExit.context);
    activation = activationView(input, key, exactExit.loopId, exactExit.context);
  }
  const history = activation?.iterations ?? [];
  let currentIteration = history.find(item => item.iteration.iteration === deepest?.iteration && item.iteration.anchorStepStart <= step && step <= item.iteration.anchorStepEnd);
  if (exactExit) currentIteration = history.filter(item => item.iteration.anchorStepEnd <= step).at(-1);
  const iteration = currentIteration?.iteration;
  const matches = (context: ExecutionContextRef, evidenceFrame: number) => evidenceFrame === frameId && !!activation && controlFlowActivationKey(frameId, activation.loopId, context) === activation.activationKey;
  const sameOccurrence = (context: ExecutionContextRef) => !!iteration && context.loopStack.some(item => item.loopId === iteration.loopId && item.iteration === iteration.iteration);
  const inIteration = (anchor: number) => !!iteration && iteration.anchorStepStart <= anchor && anchor <= iteration.anchorStepEnd;
  // Include the full lifecycle of a selected action, even when resolution lands on the next raw step.
  const actions = controlFlow.actions.filter(action => iteration
    ? matches(action.context, action.frameId) && sameOccurrence(action.context) && inIteration(action.anchorStepObserved)
    : !activation && action.frameId === frameId && (action.anchorStepObserved === step || action.anchorStepResolved === step));
  let currentLoopExit: LoopExitEvidence | undefined = exactExit;
  if (!currentLoopExit && activation && history.length) {
    const end = history.at(-1)!.iteration.anchorStepEnd;
    const exits = controlFlow.loopExits.filter(exit => exit.loopId === activation.loopId && matches(exit.context, exit.frameId) && exit.anchorStep >= end);
    const nextStart = Math.min(...controlFlow.iterations.filter(item => item.frameId === frameId && item.loopId === activation.loopId && item.anchorStepStart > end).map(item => item.anchorStepStart));
    currentLoopExit = exits.find(exit => exit.anchorStep < nextStart);
  }
  const decisionChainOccurrence = iteration ? input.decisionChains.find(chain =>
    matches(chain.context, chain.frameId) && sameOccurrence(chain.context) && chain.anchorStepStart <= step && step <= chain.anchorStepEnd &&
    chain.anchorStepStart <= iteration.anchorStepEnd && chain.anchorStepEnd >= iteration.anchorStepStart
  ) : undefined;
  const storyItems: ExecutionStoryItem[] = [];
  if (currentIteration && iteration) {
    storyItems.push({ kind: "iteration_start", anchorStep: iteration.anchorStepStart, ordinal: currentIteration.ordinal, loopId: iteration.loopId, bindings: iteration.bindings });
    for (const decision of input.decisionEvidence.values()) {
      if (!matches(decision.context, decision.frameId) || !sameOccurrence(decision.context) || !inIteration(decision.anchorStep)) continue;
      storyItems.push({ kind: "decision", anchorStep: decision.anchorStep, siteId: decision.siteId, source: decision.condition.source, status: decision.status === "partial" || decision.condition.truth === undefined ? "partial" : decision.condition.truth ? "true" : "false", shortCircuited: hasShortCircuit(decision.condition) });
    }
    storyItems.push({ kind: "iteration_outcome", anchorStep: iteration.anchorStepEnd, status: iteration.status });
  }
  for (const action of actions) {
    const common = { kind: "transfer" as const, actionId: action.actionId, transferId: action.transferId, transferKind: action.kind, source: transferSource(input, action) ?? action.kind, supersededByActionId: action.supersededByActionId };
    storyItems.push({ ...common, anchorStep: action.anchorStepObserved, phase: "observed" });
    if (action.status !== "observed" && action.anchorStepResolved !== undefined) {
      storyItems.push({ ...common, anchorStep: action.anchorStepResolved, phase: action.status });
      if (action.kind === "return" && action.status === "committed") storyItems.push({ kind: "frame_exit", anchorStep: action.anchorStepResolved, actionId: action.actionId, bareReturn: transferSource(input, action) === "return" });
    }
  }
  if (currentLoopExit) storyItems.push({ kind: "loop_exit", anchorStep: currentLoopExit.anchorStep, loopId: currentLoopExit.loopId, reason: currentLoopExit.reason });
  storyItems.sort((a, b) => a.anchorStep - b.anchorStep || itemRank(a) - itemRank(b));
  return { currentContext, currentActivation: activation, currentIteration, currentActions: actions, currentLoopExit, iterationHistory: history, decisionChainOccurrence, storyItems, tracingState: input.tracingState };
}

export interface ControlFlowOutlineIteration {
  ordinal: number;
  rawIteration: number;
  anchorStepStart: number;
  anchorStepEnd: number;
  status: IterationStatus;
}
export interface ControlFlowOutlineGroup {
  activationKey: string;
  frameId: number;
  loopId: string;
  loopKind: LoopKind;
  line: number;
  iterations: ControlFlowOutlineIteration[];
}
export function buildControlFlowOutlineGroups(plan: ControlFlowPlan | undefined, controlFlow: ControlFlowInterpretation): ControlFlowOutlineGroup[] {
  const groups: ControlFlowOutlineGroup[] = [];
  for (const [activationKey, history] of controlFlow.iterationsByActivation) {
    const first = history[0]; if (!first) continue;
    const loop = plan?.loops.find(loop => loop.loopId === first.loopId); if (!loop) continue;
    groups.push({
activationKey, frameId: first.frameId, loopId: first.loopId, loopKind: loop.kind, line: loop.span.line,
      iterations: history.map((iteration, index) => ({ ordinal: index + 1, rawIteration: iteration.iteration, anchorStepStart: iteration.anchorStepStart, anchorStepEnd: iteration.anchorStepEnd, status: iteration.status }))
});
  }
  return groups.sort((a, b) => a.iterations[0]!.anchorStepStart - b.iterations[0]!.anchorStepStart);
}
