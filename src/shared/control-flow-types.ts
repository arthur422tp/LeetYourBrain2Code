import type { SourceSpan } from "./expression-types";
import type { ValueSnapshot } from "./trace-types";

export type LoopKind = "for" | "while";
export type TransferKind = "break" | "continue" | "return";

export interface ForTargetDescriptor {
  source: string;
  span: SourceSpan;
  bindingNames: string[];
  capturable: boolean;
}

export interface LoopSiteDescriptor {
  loopId: string;
  kind: LoopKind;
  span: SourceSpan;
  target?: ForTargetDescriptor;
}

export interface TransferSiteDescriptor {
  transferId: string;
  kind: TransferKind;
  span: SourceSpan;
  targetLoopId?: string;
}

export interface ControlFlowPlan {
  version: 1;
  loops: LoopSiteDescriptor[];
  transfers: TransferSiteDescriptor[];
}

export interface LoopOccurrenceRef {
  loopId: string;
  iteration: number;
}

export interface ExecutionContextRef {
  loopStack: LoopOccurrenceRef[];
}

export interface ControlFlowBindingSnapshot {
  name: string;
  value: ValueSnapshot;
}

export type LoopExitReason =
  | "exhausted"
  | "condition_false"
  | "break"
  | "function_return"
  | "exception"
  | "trace_ended";

export interface ControlFlowRuntimeEventBase {
  eventId: number;
  anchorStep: number;
  frameId: number;
  context: ExecutionContextRef;
}

export type ControlFlowRuntimeEvent =
  | (ControlFlowRuntimeEventBase & {
      kind: "iteration_begin";
      loopId: string;
      loopKind: LoopKind;
      iteration: number;
      bindings: ControlFlowBindingSnapshot[];
    })
  | (ControlFlowRuntimeEventBase & {
      kind: "iteration_complete";
      loopId: string;
      iteration: number;
    })
  | (ControlFlowRuntimeEventBase & {
      kind: "transfer_observed";
      actionId: string;
      transferId: string;
      transferKind: TransferKind;
      targetLoopId?: string;
    })
  | (ControlFlowRuntimeEventBase & {
      kind: "transfer_status";
      actionId: string;
      status: "committed" | "superseded" | "interrupted";
      supersededByActionId?: string;
    })
  | (ControlFlowRuntimeEventBase & {
      kind: "loop_exit";
      loopId: string;
      loopKind: LoopKind;
      reason: LoopExitReason;
    });

export interface ControlFlowBatch {
  batchId: number;
  events: ControlFlowRuntimeEvent[];
}

export interface ControlFlowTracingState {
  status: "complete" | "truncated" | "unavailable";
  reason?: string;
}

export type IterationStatus =
  | "completed"
  | "continued"
  | "broke"
  | "function_returned"
  | "interrupted";

export interface LoopIterationEvidence {
  frameId: number;
  loopId: string;
  iteration: number;
  context: ExecutionContextRef;
  anchorStepStart: number;
  anchorStepEnd: number;
  bindings: ControlFlowBindingSnapshot[];
  status: IterationStatus;
  exitActionId?: string;
}

export interface ControlActionEvidence {
  actionId: string;
  transferId: string;
  kind: TransferKind;
  frameId: number;
  context: ExecutionContextRef;
  anchorStepObserved: number;
  anchorStepResolved?: number;
  targetLoopId?: string;
  status: "observed" | "committed" | "superseded" | "interrupted";
  supersededByActionId?: string;
}

export interface LoopExitEvidence {
  frameId: number;
  loopId: string;
  loopKind: LoopKind;
  context: ExecutionContextRef;
  anchorStep: number;
  reason: LoopExitReason;
}
