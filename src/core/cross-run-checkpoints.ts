import type {
  BoundArgumentSnapshot,
  FrameExit,
  FrameExitEvidence,
  FrameOccurrence
} from "../shared/call-frame-types";
import type {
  DecisionOutcome,
  DecisionSiteKind
} from "../shared/decision-types";
import type {
  ControlActionEvidence,
  LoopExitReason,
  LoopIterationEvidence,
  LoopKind
} from "../shared/control-flow-types";
import type {
  SelectionEvidence
} from "../shared/expression-types";
import type { TraceSession, ValueSnapshot } from "../shared/trace-types";
import type { TraceInterpretation } from "./trace-interpreter";
import {
  type CrossRunFunctionIdentity,
  type CrossRunFunctionIdentityIndex
} from "./cross-run-alignment";
import {
  type RuntimeMutation,
  type ReferenceMutation
} from "./runtime-mutation";
import { stableCrossRunValueKey } from "./cross-run-value";
import { normalizeCrossRunSource, sliceSourceSpan } from "./source-span-text";

export interface CheckpointBase {
  frameId: number;
  semanticKey: string;
  runLocalAnchorStep?: number;
  localSequence: number;
}

export interface DecisionCheckpoint extends CheckpointBase {
  kind: "decision";
  siteKind: DecisionSiteKind | "unknown";
  source: string;
  occurrenceOrdinal: number;
  status: "completed" | "partial";
  truth?: boolean;
  outcome?: DecisionOutcome;
  operands: Array<{ source: string; value?: ValueSnapshot }>;
}

export interface ExpressionCheckpoint extends CheckpointBase {
  kind: "expression";
  rootKind: "assignment" | "return";
  source: string;
  occurrenceOrdinal: number;
  status: "completed" | "partial";
  result?: ValueSnapshot;
  selections: SelectionEvidence[];
  rootId: string;
}

export interface LoopIterationCheckpoint extends CheckpointBase {
  kind: "loop_iteration";
  loopKind: LoopKind | "unknown";
  source: string;
  iteration: number;
  status: LoopIterationEvidence["status"];
  bindings: Array<{ name: string; value: ValueSnapshot }>;
  terminalAnchorStep: number;
}

export interface TransferCheckpoint extends CheckpointBase {
  kind: "transfer";
  transferKind: ControlActionEvidence["kind"];
  source: string;
  status: ControlActionEvidence["status"];
  actionId: string;
  transferId: string;
  resolvedAnchorStep?: number;
}

export interface LoopExitCheckpoint extends CheckpointBase {
  kind: "loop_exit";
  loopKind: LoopKind;
  source: string;
  reason: LoopExitReason;
  occurrenceOrdinal: number;
}

export type StableMutationKind =
  | "variable"
  | "sequence_element"
  | "mapping_entry"
  | "set_membership"
  | "local_reference";

export type MutationCheckpointAction =
  | "added"
  | "removed"
  | "changed"
  | "bound"
  | "unbound"
  | "redirected";

export interface MutationCheckpoint extends CheckpointBase {
  kind: "mutation";
  mutationKind: StableMutationKind;
  targetKey: string;
  action: MutationCheckpointAction;
  before?: ValueSnapshot;
  after?: ValueSnapshot;
  member?: ValueSnapshot;
  referenceAction?: ReferenceMutation["action"];
}

export interface ChildCallCheckpoint extends CheckpointBase {
  kind: "child_call";
  callee: CrossRunFunctionIdentity;
  childFrameId: number;
  occurrenceOrdinal: number;
}

export type BehavioralCheckpoint =
  | DecisionCheckpoint
  | ExpressionCheckpoint
  | LoopIterationCheckpoint
  | TransferCheckpoint
  | LoopExitCheckpoint
  | MutationCheckpoint
  | ChildCallCheckpoint;

export interface FrameEntryCheckpoint {
  kind: "frame_entry";
  frameId: number;
  semanticKey: string;
  runLocalAnchorStep: number;
  localSequence: number;
  functionIdentity: CrossRunFunctionIdentity;
  arguments: BoundArgumentSnapshot[];
}

export interface FrameExitCheckpoint {
  kind: "frame_exit";
  frameId: number;
  semanticKey: string;
  runLocalAnchorStep?: number;
  localSequence: number;
  exitEvidence?: FrameExitEvidence;
  exit: FrameExit;
}

export interface CrossRunFrameProjection {
  frameId: number;
  functionIdentity: CrossRunFunctionIdentity;
  entry: FrameEntryCheckpoint;
  checkpoints: BehavioralCheckpoint[];
  childFrameIds: number[];
  exit: FrameExitCheckpoint;
}

export interface CrossRunProjectionCoverage {
  skippedUnstableObjectMutations: number;
  incomparableMutationTargets: number;
}

export interface CrossRunFrameProjectionResult {
  frames: Map<number, CrossRunFrameProjection>;
  roots: number[];
  coverage: CrossRunProjectionCoverage;
}

export const BEHAVIORAL_CHECKPOINT_PRECEDENCE = {
  decision: 0,
  expression: 1,
  loop_iteration: 2,
  transfer: 3,
  loop_exit: 4,
  mutation: 5,
  child_call: 6
} as const;

export type BehavioralCheckpointKind = keyof typeof BEHAVIORAL_CHECKPOINT_PRECEDENCE;

export function behavioralCheckpointPrecedence(kind: BehavioralCheckpointKind): number {
  return BEHAVIORAL_CHECKPOINT_PRECEDENCE[kind];
}

function fallbackIdentity(frame: { functionName: string }): CrossRunFunctionIdentity {
  return {
    key: `fallback:${frame.functionName}`,
    displayName: frame.functionName,
    confidence: "fallback"
  };
}

function sourceForSpan(session: TraceSession, span: Parameters<typeof sliceSourceSpan>[1] | undefined): string {
  return span ? normalizeCrossRunSource(sliceSourceSpan(session.sourceCode, span)) : "";
}

function anchorForExit(exit: FrameExit): number | undefined {
  return exit.status === "returned" || exit.status === "exception" || exit.status === "trace_ended"
    ? exit.step
    : undefined;
}

function mutationProjection(
  mutation: RuntimeMutation,
  coverage: CrossRunProjectionCoverage
): Omit<MutationCheckpoint, "frameId" | "semanticKey" | "localSequence" | "runLocalAnchorStep"> | null {
  switch (mutation.kind) {
    case "variable":
      return {
        kind: "mutation",
        mutationKind: "variable",
        targetKey: `variable:${mutation.variableName}`,
        action: mutation.action,
        ...(mutation.before !== undefined ? { before: mutation.before } : {}),
        ...(mutation.after !== undefined ? { after: mutation.after } : {})
      };
    case "sequence_element":
      return {
        kind: "mutation",
        mutationKind: "sequence_element",
        targetKey: `sequence:${mutation.containerName}:${mutation.index}`,
        action: mutation.action,
        ...(mutation.before !== undefined ? { before: mutation.before } : {}),
        ...(mutation.after !== undefined ? { after: mutation.after } : {})
      };
    case "mapping_entry": {
      const key = stableCrossRunValueKey(mutation.key);
      if (key === null) {
        coverage.incomparableMutationTargets += 1;
        return null;
      }
      return {
        kind: "mutation",
        mutationKind: "mapping_entry",
        targetKey: `mapping:${mutation.containerName}:${key}`,
        action: mutation.action,
        ...(mutation.before !== undefined ? { before: mutation.before } : {}),
        ...(mutation.after !== undefined ? { after: mutation.after } : {})
      };
    }
    case "set_membership": {
      const key = stableCrossRunValueKey(mutation.member);
      if (key === null) {
        coverage.incomparableMutationTargets += 1;
        return null;
      }
      return {
        kind: "mutation",
        mutationKind: "set_membership",
        targetKey: `set:${mutation.containerName}:${key}`,
        action: mutation.action,
        member: mutation.member
      };
    }
    case "reference":
      if (mutation.owner.scope === "local") {
        return {
          kind: "mutation",
          mutationKind: "local_reference",
          targetKey: `local-ref:${mutation.owner.variableName}`,
          action: mutation.action,
          referenceAction: mutation.action
        };
      }
      coverage.skippedUnstableObjectMutations += 1;
      return null;
    case "object_attribute":
    case "object_visibility":
      coverage.skippedUnstableObjectMutations += 1;
      return null;
  }
}

function addMutationCheckpoints(
  frameId: number,
  interpretation: TraceInterpretation,
  checkpoints: BehavioralCheckpoint[],
  coverage: CrossRunProjectionCoverage,
  nextSequence: () => number
): void {
  const occurrences = new Map<string, number>();
  for (const batch of interpretation.mutationBatches) {
    if (batch.frameId !== frameId) continue;
    for (const mutation of batch.mutations) {
      const projected = mutationProjection(mutation, coverage);
      if (!projected) continue;
      const count = (occurrences.get(projected.targetKey) ?? 0) + 1;
      occurrences.set(projected.targetKey, count);
      checkpoints.push({
        ...projected,
        frameId,
        runLocalAnchorStep: batch.step,
        localSequence: nextSequence(),
        semanticKey: `mutation|${projected.targetKey}|${count}`
      });
    }
  }
}

function addDecisionCheckpoints(
  frameId: number,
  session: TraceSession,
  interpretation: TraceInterpretation,
  checkpoints: BehavioralCheckpoint[],
  nextSequence: () => number
): void {
  const sites = new Map(session.conditionPlan?.sites.map((site) => [site.siteId, site]) ?? []);
  const occurrences = new Map<string, number>();
  const evidence = [...interpretation.decisionEvidence.values()]
    .filter((item) => item.frameId === frameId)
    .sort((left, right) => left.anchorStep - right.anchorStep || left.siteId.localeCompare(right.siteId));
  for (const item of evidence) {
    const source = normalizeCrossRunSource(item.condition.source);
    const siteKind = sites.get(item.siteId)?.kind ?? "unknown";
    const base = `${siteKind}|${source}`;
    const occurrenceOrdinal = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrenceOrdinal);
    checkpoints.push({
      kind: "decision",
      frameId,
      runLocalAnchorStep: item.anchorStep,
      localSequence: nextSequence(),
      semanticKey: `decision|${base}|${occurrenceOrdinal}`,
      siteKind,
      source,
      occurrenceOrdinal,
      status: item.status,
      ...(item.condition.truth !== undefined ? { truth: item.condition.truth } : {}),
      ...(item.outcome ? { outcome: item.outcome } : {}),
      operands: item.condition.operands.map((operand) => ({
        source: normalizeCrossRunSource(operand.source),
        ...(operand.value !== undefined ? { value: operand.value } : {})
      }))
    });
  }
}

function addExpressionCheckpoints(
  frameId: number,
  interpretation: TraceInterpretation,
  checkpoints: BehavioralCheckpoint[],
  nextSequence: () => number
): void {
  const occurrences = new Map<string, number>();
  const evidence = [...interpretation.expressionEvidence.values()]
    .filter((item) => item.frameId === frameId)
    .sort((left, right) => left.anchorStep - right.anchorStep);
  for (const item of evidence) {
    for (const root of [...item.roots].sort((left, right) => left.rootId.localeCompare(right.rootId))) {
      const source = normalizeCrossRunSource(root.tree.source);
      const base = `${root.kind}|${source}`;
      const occurrenceOrdinal = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occurrenceOrdinal);
      const result = root.tree.value;
      checkpoints.push({
        kind: "expression",
        frameId,
        runLocalAnchorStep: item.anchorStep,
        localSequence: nextSequence(),
        semanticKey: `expression|${base}|${occurrenceOrdinal}`,
        rootKind: root.kind,
        source,
        occurrenceOrdinal,
        status: root.status,
        ...(result !== undefined ? { result } : {}),
        selections: root.selections,
        rootId: root.rootId
      });
    }
  }
}

function addControlFlowCheckpoints(
  frameId: number,
  session: TraceSession,
  interpretation: TraceInterpretation,
  checkpoints: BehavioralCheckpoint[],
  nextSequence: () => number
): void {
  const loops = new Map(session.controlFlowPlan?.loops.map((loop) => [loop.loopId, loop]) ?? []);
  const transfers = new Map(session.controlFlowPlan?.transfers.map((transfer) => [transfer.transferId, transfer]) ?? []);
  const iterationOccurrences = new Map<string, number>();
  const iterations = interpretation.controlFlow.iterations
    .filter((item) => item.frameId === frameId)
    .sort((left, right) => left.anchorStepStart - right.anchorStepStart || left.iteration - right.iteration);
  for (const item of iterations) {
    const loop = loops.get(item.loopId);
    const loopKind = loop?.kind ?? "unknown";
    const source = sourceForSpan(session, loop?.span);
    const base = `${loopKind}|${source}`;
    const ordinal = (iterationOccurrences.get(base) ?? 0) + 1;
    iterationOccurrences.set(base, ordinal);
    checkpoints.push({
      kind: "loop_iteration",
      frameId,
      runLocalAnchorStep: item.anchorStepStart,
      localSequence: nextSequence(),
      semanticKey: `loop-iteration|${base}|${ordinal}`,
      loopKind,
      source,
      iteration: item.iteration,
      status: item.status,
      bindings: item.bindings,
      terminalAnchorStep: item.anchorStepEnd
    });
  }

  const transferOccurrences = new Map<string, number>();
  const actions = interpretation.controlFlow.actions
    .filter((item) => item.frameId === frameId)
    .sort((left, right) => left.anchorStepObserved - right.anchorStepObserved || left.actionId.localeCompare(right.actionId));
  for (const item of actions) {
    const source = sourceForSpan(session, transfers.get(item.transferId)?.span);
    const base = `${item.kind}|${source}`;
    const ordinal = (transferOccurrences.get(base) ?? 0) + 1;
    transferOccurrences.set(base, ordinal);
    checkpoints.push({
      kind: "transfer",
      frameId,
      runLocalAnchorStep: item.anchorStepObserved,
      localSequence: nextSequence(),
      semanticKey: `transfer|${base}|${ordinal}`,
      transferKind: item.kind,
      source,
      status: item.status,
      actionId: item.actionId,
      transferId: item.transferId,
      ...(item.anchorStepResolved !== undefined ? { resolvedAnchorStep: item.anchorStepResolved } : {})
    });
  }

  const exitOccurrences = new Map<string, number>();
  const exits = interpretation.controlFlow.loopExits
    .filter((item) => item.frameId === frameId)
    .sort((left, right) => left.anchorStep - right.anchorStep || left.loopId.localeCompare(right.loopId));
  for (const item of exits) {
    const source = sourceForSpan(session, loops.get(item.loopId)?.span);
    const base = `${item.loopKind}|${source}`;
    const ordinal = (exitOccurrences.get(base) ?? 0) + 1;
    exitOccurrences.set(base, ordinal);
    checkpoints.push({
      kind: "loop_exit",
      frameId,
      runLocalAnchorStep: item.anchorStep,
      localSequence: nextSequence(),
      semanticKey: `loop-exit|${base}|${ordinal}`,
      loopKind: item.loopKind,
      source,
      reason: item.reason,
      occurrenceOrdinal: ordinal
    });
  }
}

function addChildCallCheckpoints(
  frame: FrameOccurrence,
  identities: CrossRunFunctionIdentityIndex,
  callFrames: Map<number, FrameOccurrence>,
  checkpoints: BehavioralCheckpoint[],
  nextSequence: () => number
): void {
  const occurrences = new Map<string, number>();
  for (const childFrameId of frame.childFrameIds) {
    const child = identities.byFrameId.get(childFrameId);
    if (!child) continue;
    const occurrenceOrdinal = (occurrences.get(child.key) ?? 0) + 1;
    occurrences.set(child.key, occurrenceOrdinal);
    checkpoints.push({
      kind: "child_call",
      frameId: frame.frameId,
      runLocalAnchorStep: callFrames.get(childFrameId)?.callStep,
      localSequence: nextSequence(),
      semanticKey: `child-call|${child.key}|${occurrenceOrdinal}`,
      callee: child,
      childFrameId,
      occurrenceOrdinal
    });
  }
}

function sortCheckpoints(checkpoints: BehavioralCheckpoint[]): BehavioralCheckpoint[] {
  return checkpoints.sort((left, right) => {
    const leftAnchor = left.runLocalAnchorStep ?? Number.MAX_SAFE_INTEGER;
    const rightAnchor = right.runLocalAnchorStep ?? Number.MAX_SAFE_INTEGER;
    return leftAnchor - rightAnchor
      || behavioralCheckpointPrecedence(left.kind) - behavioralCheckpointPrecedence(right.kind)
      || left.localSequence - right.localSequence
      || left.semanticKey.localeCompare(right.semanticKey);
  });
}

function exitCheckpoint(
  frameId: number,
  exit: FrameExit,
  exitEvidence?: FrameExitEvidence
): FrameExitCheckpoint {
  return {
    kind: "frame_exit",
    frameId,
    semanticKey: "frame-exit",
    ...(anchorForExit(exit) !== undefined ? { runLocalAnchorStep: anchorForExit(exit) } : {}),
    localSequence: Number.MAX_SAFE_INTEGER,
    ...(exitEvidence ? { exitEvidence } : {}),
    exit
  };
}

export function projectCrossRunFrames(
  session: TraceSession,
  interpretation: TraceInterpretation,
  identities: CrossRunFunctionIdentityIndex
): CrossRunFrameProjectionResult {
  const frames = new Map<number, CrossRunFrameProjection>();
  const coverage: CrossRunProjectionCoverage = {
    skippedUnstableObjectMutations: 0,
    incomparableMutationTargets: 0
  };

  for (const [frameId, frame] of interpretation.callFrames.byFrameId) {
    const functionIdentity = identities.byFrameId.get(frameId) ?? fallbackIdentity(frame);
    let sequence = 0;
    const nextSequence = (): number => {
      sequence += 1;
      return sequence;
    };
    const checkpoints: BehavioralCheckpoint[] = [];
    addDecisionCheckpoints(frameId, session, interpretation, checkpoints, nextSequence);
    addExpressionCheckpoints(frameId, interpretation, checkpoints, nextSequence);
    addControlFlowCheckpoints(frameId, session, interpretation, checkpoints, nextSequence);
    addMutationCheckpoints(frameId, interpretation, checkpoints, coverage, nextSequence);
    addChildCallCheckpoints(
      frame,
      identities,
      interpretation.callFrames.byFrameId,
      checkpoints,
      nextSequence
    );
    frames.set(frameId, {
      frameId,
      functionIdentity,
      entry: {
        kind: "frame_entry",
        frameId,
        semanticKey: `frame-entry|${functionIdentity.key}`,
        runLocalAnchorStep: frame.callStep,
        localSequence: 0,
        functionIdentity,
        arguments: frame.arguments
      },
      checkpoints: sortCheckpoints(checkpoints),
      childFrameIds: [...frame.childFrameIds],
      exit: exitCheckpoint(frameId, frame.exit, frame.exitEvidence)
    });
  }

  return {
    frames,
    roots: [...interpretation.callFrames.roots],
    coverage
  };
}
