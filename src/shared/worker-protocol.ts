import {
  TERMINATION_REASONS,
  TRACE_SESSION_STATUSES,
  type ExecutionTerminalResult,
  type TerminalTraceSessionStatus,
  type TraceSessionStatus,
  type TerminationReason
} from "./execution-types";
import type { ExecutionRequest } from "./execution-types";
import type { TraceEvent } from "./trace-types";
import type { ValueSnapshot } from "./trace-types";
import type {
  ConditionDescriptor,
  ConditionEvaluation,
  ConditionKind,
  ConditionOperandDescriptor,
  ConditionPlan,
  ConditionResult,
  ConditionStructureHint,
  DecisionBatch,
  DecisionChainDescriptor,
  DecisionOutcome,
  DecisionSiteDescriptor,
  DecisionTracingState
} from "./decision-types";
import type {
  ControlFlowBatch,
  ControlFlowPlan,
  ControlFlowRuntimeEvent,
  ControlFlowTracingState,
  ExecutionContextRef,
  LoopExitReason,
  LoopKind,
  TransferKind
} from "./control-flow-types";
import type {
  AssignmentTargetDescriptor,
  ExpressionBatch,
  ExpressionDescriptor,
  ExpressionPlan,
  ExpressionRootDescriptor,
  ExpressionRootEvaluation,
  ExpressionTracingState,
  SelectionEvidence,
  SourceSpan
} from "./expression-types";

export type WorkerInboundMessage = {
  type: "execute";
  request: ExecutionRequest;
};

export type WorkerOutboundMessage =
  | { type: "ready" }
  | { type: "trace_batch"; sessionId: string; events: TraceEvent[] }
  | { type: "expression_plan"; sessionId: string; plan: ExpressionPlan }
  | { type: "expression_batch"; sessionId: string; batches: ExpressionBatch[] }
  | { type: "condition_plan"; sessionId: string; plan: ConditionPlan }
  | { type: "decision_batch"; sessionId: string; batches: DecisionBatch[] }
  | { type: "control_flow_plan"; sessionId: string; plan: ControlFlowPlan }
  | { type: "control_flow_batch"; sessionId: string; batches: ControlFlowBatch[] }
  | {
      type: "execution_finished";
      sessionId: string;
      result: ExecutionTerminalResult;
    }
  | { type: "worker_error"; sessionId?: string; message: string };

export function isTraceSessionStatus(value: unknown): value is TraceSessionStatus {
  return (
    typeof value === "string" &&
    (TRACE_SESSION_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminationReason(value: unknown): value is TerminationReason {
  return (
    typeof value === "string" &&
    (TERMINATION_REASONS as readonly string[]).includes(value)
  );
}

function isTerminalStatus(value: unknown): value is TerminalTraceSessionStatus {
  return isTraceSessionStatus(value) && value !== "running";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSourceSpan(value: unknown): value is SourceSpan {
  return (
    isRecord(value) &&
    isInteger(value.line) &&
    isInteger(value.column) &&
    isInteger(value.endLine) &&
    isInteger(value.endColumn)
  );
}

function isValueSnapshot(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "int":
      return typeof value.value === "string";
    case "float":
      return (
        typeof value.value === "number" ||
        value.value === "NaN" ||
        value.value === "Infinity" ||
        value.value === "-Infinity"
      );
    case "bool":
      return typeof value.value === "boolean";
    case "str":
      return (
        typeof value.value === "string" &&
        isInteger(value.length) &&
        typeof value.truncated === "boolean"
      );
    case "none":
      return value.value === null;
    case "reference":
      return typeof value.objectId === "string" && typeof value.className === "string";
    case "list":
    case "tuple":
    case "set":
      return (
        isInteger(value.length) &&
        Array.isArray(value.items) &&
        value.items.every(isValueSnapshot) &&
        typeof value.truncated === "boolean"
      );
    case "dict":
      return (
        isInteger(value.length) &&
        Array.isArray(value.entries) &&
        value.entries.every(
          (entry) =>
            isRecord(entry) &&
            isValueSnapshot(entry.key) &&
            isValueSnapshot(entry.value)
        ) &&
        typeof value.truncated === "boolean"
      );
    case "unknown":
      return (
        typeof value.className === "string" &&
        typeof value.repr === "string" &&
        (value.truncated === undefined || typeof value.truncated === "boolean")
      );
    case "cycle":
      return typeof value.referenceId === "string";
    default:
      return false;
  }
}

function isStaticStructureHint(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind === "list_index") {
    return typeof value.variableName === "string" && typeof value.indexExprId === "string";
  }

  return (
    value.kind === "matrix_cell" &&
    typeof value.variableName === "string" &&
    typeof value.rowExprId === "string" &&
    typeof value.columnExprId === "string"
  );
}

function isAssignmentTargetDescriptor(value: unknown): value is AssignmentTargetDescriptor {
  if (!isRecord(value) || typeof value.source !== "string" || !isSourceSpan(value.span)) {
    return false;
  }

  if (value.structureHint === undefined) {
    return true;
  }

  if (!isRecord(value.structureHint)) {
    return false;
  }

  if (value.structureHint.kind === "list_index") {
    return (
      typeof value.structureHint.variableName === "string" &&
      typeof value.structureHint.indexSource === "string"
    );
  }

  return (
    value.structureHint.kind === "matrix_cell" &&
    typeof value.structureHint.variableName === "string" &&
    typeof value.structureHint.rowSource === "string" &&
    typeof value.structureHint.columnSource === "string"
  );
}

function isExpressionDescriptor(value: unknown): value is ExpressionDescriptor {
  return (
    isRecord(value) &&
    typeof value.exprId === "string" &&
    typeof value.rootId === "string" &&
    (typeof value.parentExprId === "string" || value.parentExprId === null) &&
    ["name", "literal", "subscript", "attribute", "unary", "binary", "call"].includes(
      value.kind as string
    ) &&
    isSourceSpan(value.span) &&
    typeof value.source === "string" &&
    isStringArray(value.childExprIds) &&
    (value.structureHint === undefined || isStaticStructureHint(value.structureHint))
  );
}

function isExpressionRootDescriptor(value: unknown): value is ExpressionRootDescriptor {
  if (!isRecord(value) || typeof value.rootId !== "string" || typeof value.expressionExprId !== "string") {
    return false;
  }

  if (value.kind === "assignment") {
    return isAssignmentTargetDescriptor(value.target) && isSourceSpan(value.span);
  }

  return value.kind === "return" && isSourceSpan(value.span);
}

function isExpressionPlan(value: unknown): value is ExpressionPlan {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.roots) &&
    value.roots.every(isExpressionRootDescriptor) &&
    Array.isArray(value.expressions) &&
    value.expressions.every(isExpressionDescriptor)
  );
}

function isSelectionEvidence(value: unknown): value is SelectionEvidence {
  return (
    isRecord(value) &&
    typeof value.callExprId === "string" &&
    (value.function === "min" || value.function === "max") &&
    isStringArray(value.candidateExprIds) &&
    isValueSnapshot(value.result) &&
    (value.selectedCandidateIndex === null || isInteger(value.selectedCandidateIndex)) &&
    ["resolved", "unsupported_call_shape", "unsupported_value", "ambiguous"].includes(
      value.status as string
    )
  );
}

function isExpressionRootEvaluation(value: unknown): value is ExpressionRootEvaluation {
  return (
    isRecord(value) &&
    typeof value.rootId === "string" &&
    (value.status === "completed" || value.status === "partial") &&
    Array.isArray(value.evaluations) &&
    value.evaluations.every(
      (evaluation) =>
        isRecord(evaluation) &&
        isInteger(evaluation.evaluationId) &&
        typeof evaluation.exprId === "string" &&
        isInteger(evaluation.order) &&
        isValueSnapshot(evaluation.value)
    ) &&
    (value.resultExprId === undefined || typeof value.resultExprId === "string") &&
    (value.selectionEvidence === undefined ||
      (Array.isArray(value.selectionEvidence) && value.selectionEvidence.every(isSelectionEvidence)))
  );
}

function isExpressionBatch(value: unknown): value is ExpressionBatch {
  return (
    isRecord(value) &&
    isInteger(value.batchId) &&
    isInteger(value.anchorStep) &&
    isInteger(value.frameId) &&
    isInteger(value.line) &&
    Array.isArray(value.roots) &&
    value.roots.every(isExpressionRootEvaluation)
  );
}

function isExpressionTracingState(value: unknown): value is ExpressionTracingState {
  return (
    isRecord(value) &&
    ["complete", "truncated", "unavailable"].includes(value.status as string) &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

function isConditionKind(value: unknown): value is ConditionKind {
  return ["truth_test", "comparison", "not", "and", "or", "opaque"].includes(value as string);
}

function isDecisionSiteKind(value: unknown): boolean {
  return value === "if" || value === "elif" || value === "while";
}

function isDecisionOutcome(value: unknown): value is DecisionOutcome {
  return ["branch_entered", "branch_not_entered", "loop_body_entered", "loop_exited"].includes(value as string);
}

function isConditionStructureHint(value: unknown): value is ConditionStructureHint {
  if (!isRecord(value)) return false;
  if (value.kind === "list_index") {
    return typeof value.variableName === "string" && typeof value.indexOperandId === "string";
  }
  return value.kind === "matrix_cell" &&
    typeof value.variableName === "string" &&
    typeof value.rowOperandId === "string" &&
    typeof value.columnOperandId === "string";
}

function isConditionOperandDescriptor(value: unknown): value is ConditionOperandDescriptor {
  return isRecord(value) &&
    typeof value.operandId === "string" &&
    typeof value.conditionId === "string" &&
    typeof value.source === "string" &&
    isSourceSpan(value.span) &&
    (value.structureHint === undefined || isConditionStructureHint(value.structureHint));
}

function isConditionDescriptor(value: unknown): value is ConditionDescriptor {
  return isRecord(value) &&
    typeof value.conditionId === "string" &&
    typeof value.siteId === "string" &&
    isConditionKind(value.kind) &&
    typeof value.source === "string" &&
    isSourceSpan(value.span) &&
    isStringArray(value.childConditionIds) &&
    isStringArray(value.operandIds);
}

function isDecisionSiteDescriptor(value: unknown): value is DecisionSiteDescriptor {
  return isRecord(value) &&
    typeof value.siteId === "string" &&
    isDecisionSiteKind(value.kind) &&
    (value.chainId === undefined || typeof value.chainId === "string") &&
    (value.branchIndex === undefined || (isInteger(value.branchIndex) && value.branchIndex >= 0)) &&
    typeof value.conditionId === "string" &&
    isSourceSpan(value.span);
}

function isDecisionChainDescriptor(value: unknown): value is DecisionChainDescriptor {
  return isRecord(value) && typeof value.chainId === "string" && Array.isArray(value.branches) &&
    value.branches.every((branch) => isRecord(branch) && isInteger(branch.branchIndex) && branch.branchIndex >= 0 &&
      ["if", "elif", "else"].includes(branch.kind as string) &&
      (branch.siteId === undefined || typeof branch.siteId === "string"));
}

function isConditionPlan(value: unknown): value is ConditionPlan {
  return isRecord(value) && value.version === 1 &&
    Array.isArray(value.sites) && value.sites.every(isDecisionSiteDescriptor) &&
    Array.isArray(value.conditions) && value.conditions.every(isConditionDescriptor) &&
    Array.isArray(value.operands) && value.operands.every(isConditionOperandDescriptor) &&
    Array.isArray(value.chains) && value.chains.every(isDecisionChainDescriptor);
}

function isConditionResult(value: unknown): value is ConditionResult {
  return isRecord(value) && typeof value.conditionId === "string" &&
    isInteger(value.order) && value.order > 0 && typeof value.truth === "boolean";
}

function isDecisionOperandEvaluation(value: unknown): boolean {
  return isRecord(value) && typeof value.operandId === "string" &&
    isInteger(value.order) && value.order > 0 && isValueSnapshot(value.value);
}

function isConditionEvaluation(value: unknown): value is ConditionEvaluation {
  if (!isRecord(value) || typeof value.conditionId !== "string" || !Array.isArray(value.evaluations) ||
    !value.evaluations.every(isDecisionOperandEvaluation) || !Array.isArray(value.conditionResults) ||
    !value.conditionResults.every(isConditionResult) ||
    (value.truth !== undefined && typeof value.truth !== "boolean")) return false;
  return value.conditionResults.every((result, index, results) => index === 0 || result.order > results[index - 1]!.order);
}

export function isExecutionContextRef(value: unknown): value is ExecutionContextRef {
  return isRecord(value) && Array.isArray(value.loopStack) && value.loopStack.every((item) =>
    isRecord(item) && typeof item.loopId === "string" && isPositiveInteger(item.iteration)
  );
}

function isLoopKind(value: unknown): value is LoopKind {
  return value === "for" || value === "while";
}

function isTransferKind(value: unknown): value is TransferKind {
  return value === "break" || value === "continue" || value === "return";
}

function isLoopExitReason(value: unknown): value is LoopExitReason {
  return ["exhausted", "condition_false", "break", "function_return", "exception", "trace_ended"].includes(value as string);
}

function isForTargetDescriptor(value: unknown): boolean {
  return isRecord(value) && typeof value.source === "string" && isSourceSpan(value.span) &&
    isStringArray(value.bindingNames) && typeof value.capturable === "boolean";
}

function isControlFlowPlan(value: unknown): value is ControlFlowPlan {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.loops) || !Array.isArray(value.transfers)) {
    return false;
  }
  const loopsValid = value.loops.every((loop) => isRecord(loop) && typeof loop.loopId === "string" &&
    isLoopKind(loop.kind) && isSourceSpan(loop.span) &&
    (loop.target === undefined || isForTargetDescriptor(loop.target)));
  const transfersValid = value.transfers.every((transfer) => isRecord(transfer) &&
    typeof transfer.transferId === "string" && isTransferKind(transfer.kind) && isSourceSpan(transfer.span) &&
    (transfer.targetLoopId === undefined || typeof transfer.targetLoopId === "string"));
  return loopsValid && transfersValid;
}

function isControlFlowRuntimeEvent(value: unknown): value is ControlFlowRuntimeEvent {
  if (!isRecord(value) || !isPositiveInteger(value.eventId) || !isPositiveInteger(value.anchorStep) ||
    !isPositiveInteger(value.frameId) || !isExecutionContextRef(value.context) || typeof value.kind !== "string") {
    return false;
  }
  if (value.kind === "iteration_begin") {
    return typeof value.loopId === "string" && isLoopKind(value.loopKind) && isPositiveInteger(value.iteration) &&
      Array.isArray(value.bindings) && value.bindings.every((binding) => isRecord(binding) &&
        typeof binding.name === "string" && isValueSnapshot(binding.value));
  }
  if (value.kind === "iteration_complete") {
    return typeof value.loopId === "string" && isPositiveInteger(value.iteration);
  }
  if (value.kind === "transfer_observed") {
    return typeof value.actionId === "string" && typeof value.transferId === "string" &&
      isTransferKind(value.transferKind) && (value.targetLoopId === undefined || typeof value.targetLoopId === "string");
  }
  if (value.kind === "transfer_status") {
    return typeof value.actionId === "string" &&
      (value.status === "committed" || value.status === "superseded" || value.status === "interrupted") &&
      (value.status === "superseded"
        ? typeof value.supersededByActionId === "string"
        : value.supersededByActionId === undefined);
  }
  return value.kind === "loop_exit" && typeof value.loopId === "string" && isLoopKind(value.loopKind) &&
    isLoopExitReason(value.reason);
}

function isControlFlowBatch(value: unknown): value is ControlFlowBatch {
  if (!isRecord(value) || !isPositiveInteger(value.batchId) || !Array.isArray(value.events) ||
    !value.events.every(isControlFlowRuntimeEvent)) return false;
  return value.events.every((event, index, events) => index === 0 || event.eventId > events[index - 1]!.eventId);
}

function isControlFlowTracingState(value: unknown): value is ControlFlowTracingState {
  return isRecord(value) && ["complete", "truncated", "unavailable"].includes(value.status as string) &&
    (value.reason === undefined || typeof value.reason === "string");
}

function isDecisionBatch(value: unknown): value is DecisionBatch {
  return isRecord(value) && isInteger(value.batchId) && value.batchId > 0 &&
    isInteger(value.anchorStep) && value.anchorStep > 0 && isInteger(value.frameId) && value.frameId > 0 &&
    typeof value.siteId === "string" && isInteger(value.occurrence) && value.occurrence > 0 &&
    (value.status === "completed" || value.status === "partial") && isConditionEvaluation(value.condition) &&
    (value.status === "partial" ? value.outcome === undefined : isDecisionOutcome(value.outcome)) &&
    (value.context === undefined || isExecutionContextRef(value.context));
}

function isDecisionTracingState(value: unknown): value is DecisionTracingState {
  return isRecord(value) && ["complete", "truncated", "unavailable"].includes(value.status as string) &&
    (value.reason === undefined || typeof value.reason === "string");
}

function isExecutionTerminalResult(value: unknown): value is ExecutionTerminalResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isTerminalStatus(value.status) &&
    isTerminationReason(value.terminationReason) &&
    typeof value.stdout === "string" &&
    typeof value.durationMs === "number" &&
    (value.expressionPlan === undefined || isExpressionPlan(value.expressionPlan)) &&
    (value.expressionBatches === undefined ||
      (Array.isArray(value.expressionBatches) && value.expressionBatches.every(isExpressionBatch))) &&
    (value.expressionTracing === undefined || isExpressionTracingState(value.expressionTracing))
    && (value.conditionPlan === undefined || isConditionPlan(value.conditionPlan))
    && (value.decisionBatches === undefined || (Array.isArray(value.decisionBatches) && value.decisionBatches.every(isDecisionBatch)))
    && (value.decisionTracing === undefined || isDecisionTracingState(value.decisionTracing))
    && (value.controlFlowPlan === undefined || isControlFlowPlan(value.controlFlowPlan))
    && (value.controlFlowBatches === undefined || (Array.isArray(value.controlFlowBatches) && value.controlFlowBatches.every(isControlFlowBatch)))
    && (value.controlFlowTracing === undefined || isControlFlowTracingState(value.controlFlowTracing))
  );
}

export function isWorkerOutboundMessage(value: unknown): value is WorkerOutboundMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "ready":
      return true;
    case "trace_batch":
      return (
        typeof value.sessionId === "string" && Array.isArray(value.events)
      );
    case "expression_plan":
      return typeof value.sessionId === "string" && isExpressionPlan(value.plan);
    case "expression_batch":
      return (
        typeof value.sessionId === "string" &&
        Array.isArray(value.batches) &&
        value.batches.every(isExpressionBatch)
      );
    case "condition_plan":
      return typeof value.sessionId === "string" && isConditionPlan(value.plan);
    case "decision_batch":
      return typeof value.sessionId === "string" && Array.isArray(value.batches) && value.batches.every(isDecisionBatch);
    case "control_flow_plan":
      return typeof value.sessionId === "string" && isControlFlowPlan(value.plan);
    case "control_flow_batch":
      return typeof value.sessionId === "string" && Array.isArray(value.batches) && value.batches.every(isControlFlowBatch);
    case "execution_finished":
      return (
        typeof value.sessionId === "string" &&
        isExecutionTerminalResult(value.result)
      );
    case "worker_error":
      return (
        (value.sessionId === undefined || typeof value.sessionId === "string") &&
        typeof value.message === "string"
      );
    default:
      return false;
  }
}

export function isWorkerInboundMessage(value: unknown): value is WorkerInboundMessage {
  return (
    isRecord(value) &&
    value.type === "execute" &&
    isRecord(value.request) &&
    typeof value.request.sessionId === "string"
  );
}
