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
