import { loadPyodide as bundledLoadPyodide } from "pyodide";

import { normalizeSubscriptRelation } from "../core/ast-relations";
import type {
  ExceptionInfo,
  ExecutionRequest,
  ExecutionTerminalResult
} from "../shared/execution-types";
import type { ObjectSnapshot, TraceEvent, ValueSnapshot } from "../shared/trace-types";
import type {
  ExpressionBatch,
  ExpressionPlan,
  ExpressionTracingState
} from "../shared/expression-types";
import type {
  ConditionPlan,
  DecisionBatch,
  DecisionTracingState
} from "../shared/decision-types";
import runtimePrelude from "./python/runtime_prelude.py?raw";
import astAnalyzerSource from "./python/ast_analyzer.py?raw";
import expressionInstrumenterSource from "./python/expression_instrumenter.py?raw";
import expressionRecorderSource from "./python/expression_recorder.py?raw";
import conditionInstrumenterSource from "./python/condition_instrumenter.py?raw";
import decisionRecorderSource from "./python/decision_recorder.py?raw";
import runnerSource from "./python/runner.py?raw";
import serializerSource from "./python/serializer.py?raw";
import tracerSource from "./python/tracer.py?raw";
import objectIdentitySource from "./python/object_identity.py?raw";
import objectTopologySource from "./python/object_topology.py?raw";

export const USER_CODE_FILENAME = "<leetcode-user-code>";
const RUNTIME_PRELUDE_FILENAME = "<leetcode-runtime-prelude>";

export interface PyodideApi {
  runPythonAsync(code: string): Promise<unknown>;
  globals?: {
    set?(name: string, value: unknown): void;
    delete?(name: string): void;
  };
  version?: string;
}

export interface PyodideLoadOptions {
  indexURL: string;
}

export type PyodideLoader = (options: PyodideLoadOptions) => Promise<PyodideApi>;

export interface PyodideRuntimeOptions {
  indexURL?: string;
  loadPyodide?: PyodideLoader;
  onTraceBatch?: (sessionId: string, events: TraceEvent[]) => void;
  onExpressionPlan?: (sessionId: string, plan: ExpressionPlan) => void;
  onExpressionBatch?: (sessionId: string, batches: ExpressionBatch[]) => void;
  onConditionPlan?: (sessionId: string, plan: ConditionPlan) => void;
  onDecisionBatch?: (sessionId: string, batches: DecisionBatch[]) => void;
  onFinished?: (result: ExecutionTerminalResult) => void;
}

export interface PyodideRuntime {
  initialize(): Promise<void>;
  execute(request: ExecutionRequest): Promise<void>;
}

export const DEFAULT_PYODIDE_INDEX_URL = new URL(
  /* @vite-ignore */ "../pyodide/",
  import.meta.url
).href;

function quotePython(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

export function buildExecutionScript(request: ExecutionRequest): string {
  return `
import sys
import types

__lc_runtime_namespace = {}
exec(compile(${quotePython(runtimePrelude)}, ${quotePython(
    RUNTIME_PRELUDE_FILENAME
  )}, "exec"), __lc_runtime_namespace, __lc_runtime_namespace)

__lc_ast_analyzer_module = types.ModuleType("ast_analyzer")
exec(compile(${quotePython(astAnalyzerSource)}, "<leetcode-ast-analyzer>", "exec"), vars(__lc_ast_analyzer_module), vars(__lc_ast_analyzer_module))
sys.modules["ast_analyzer"] = __lc_ast_analyzer_module

__lc_expression_instrumenter_module = types.ModuleType("expression_instrumenter")
sys.modules["expression_instrumenter"] = __lc_expression_instrumenter_module
exec(compile(${quotePython(expressionInstrumenterSource)}, "<leetcode-expression-instrumenter>", "exec"), vars(__lc_expression_instrumenter_module), vars(__lc_expression_instrumenter_module))

__lc_object_identity_module = types.ModuleType("object_identity")
exec(compile(${quotePython(objectIdentitySource)}, "<leetcode-object-identity>", "exec"), vars(__lc_object_identity_module), vars(__lc_object_identity_module))
sys.modules["object_identity"] = __lc_object_identity_module

__lc_object_topology_module = types.ModuleType("object_topology")
exec(compile(${quotePython(objectTopologySource)}, "<leetcode-object-topology>", "exec"), vars(__lc_object_topology_module), vars(__lc_object_topology_module))
sys.modules["object_topology"] = __lc_object_topology_module

__lc_serializer_module = types.ModuleType("serializer")
exec(compile(${quotePython(serializerSource)}, "<leetcode-serializer>", "exec"), vars(__lc_serializer_module), vars(__lc_serializer_module))
sys.modules["serializer"] = __lc_serializer_module

__lc_tracer_module = types.ModuleType("tracer")
exec(compile(${quotePython(tracerSource)}, "<leetcode-tracer>", "exec"), vars(__lc_tracer_module), vars(__lc_tracer_module))
sys.modules["tracer"] = __lc_tracer_module

__lc_expression_recorder_module = types.ModuleType("expression_recorder")
sys.modules["expression_recorder"] = __lc_expression_recorder_module
exec(compile(${quotePython(expressionRecorderSource)}, "<leetcode-expression-recorder>", "exec"), vars(__lc_expression_recorder_module), vars(__lc_expression_recorder_module))

__lc_condition_instrumenter_module = types.ModuleType("condition_instrumenter")
sys.modules["condition_instrumenter"] = __lc_condition_instrumenter_module
exec(compile(${quotePython(conditionInstrumenterSource)}, "<leetcode-condition-instrumenter>", "exec"), vars(__lc_condition_instrumenter_module), vars(__lc_condition_instrumenter_module))

__lc_decision_recorder_module = types.ModuleType("decision_recorder")
sys.modules["decision_recorder"] = __lc_decision_recorder_module
exec(compile(${quotePython(decisionRecorderSource)}, "<leetcode-decision-recorder>", "exec"), vars(__lc_decision_recorder_module), vars(__lc_decision_recorder_module))

__lc_runner_module = types.ModuleType("runner")
exec(compile(${quotePython(runnerSource)}, "<leetcode-runner>", "exec"), vars(__lc_runner_module), vars(__lc_runner_module))

__lc_runner_module.run_request(
    ${quotePython(request.sourceCode)},
    ${quotePython(request.rawTestcase)},
    {
        "class_name": ${quotePython(request.entrypoint.className)},
        "method_name": ${quotePython(request.entrypoint.methodName)},
        "parameter_count": ${request.entrypoint.parameterCount},
        "parameter_kinds": ${quotePython(request.entrypoint.parameterKinds)},
    },
    {
        "max_trace_steps": ${request.limits.maxTraceSteps},
        "max_container_items": ${request.limits.maxContainerItems},
        "max_nesting_depth": ${request.limits.maxNestingDepth},
        "max_snapshot_bytes": ${request.limits.maxSnapshotBytes},
        "max_session_bytes": ${request.limits.maxSessionBytes},
        "max_stdout_bytes": ${request.limits.maxStdoutBytes},
        "max_object_nodes": ${request.limits.maxObjectNodes},
        "max_object_attributes": ${request.limits.maxObjectAttributes},
        "max_object_depth": ${request.limits.maxObjectDepth},
        "max_expression_events": ${request.limits.maxExpressionEvents},
        "max_expression_bytes": ${request.limits.maxExpressionBytes},
        "max_decision_events": ${request.limits.maxDecisionEvents},
        "max_decision_bytes": ${request.limits.maxDecisionBytes},
    },
    runtime_globals=__lc_runtime_namespace,
    session_id=${quotePython(request.sessionId)},
    emit_batch=globals().get("__lc_emit_trace_batch"),
    emit_expression_plan=globals().get("__lc_emit_expression_plan"),
    emit_expression_batch=globals().get("__lc_emit_expression_batch"),
    emit_condition_plan=globals().get("__lc_emit_condition_plan"),
    emit_decision_batch=globals().get("__lc_emit_decision_batch"),
)
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapPyodideValue(value: unknown): unknown {
  if (!isRecord(value) || typeof value.toJs !== "function") {
    return value;
  }

  const proxy = value as {
    toJs: (options?: unknown) => unknown;
    destroy?: () => void;
  };
  try {
    return proxy.toJs({ dict_converter: Object.fromEntries });
  } finally {
    proxy.destroy?.();
  }
}

export function toValueSnapshot(value: unknown, depth = 0): ValueSnapshot {
  const unwrapped = unwrapPyodideValue(value);
  if (unwrapped === null || unwrapped === undefined) {
    return { type: "none", value: null };
  }
  if (typeof unwrapped === "boolean") {
    return { type: "bool", value: unwrapped };
  }
  if (typeof unwrapped === "bigint") {
    return { type: "int", value: unwrapped.toString(10) };
  }
  if (typeof unwrapped === "number") {
    if (Number.isInteger(unwrapped) && Number.isFinite(unwrapped)) {
      return { type: "int", value: String(unwrapped) };
    }
    if (Number.isNaN(unwrapped)) {
      return { type: "float", value: "NaN" };
    }
    if (unwrapped === Infinity) {
      return { type: "float", value: "Infinity" };
    }
    if (unwrapped === -Infinity) {
      return { type: "float", value: "-Infinity" };
    }
    return { type: "float", value: unwrapped };
  }
  if (typeof unwrapped === "string") {
    return { type: "str", value: unwrapped, length: unwrapped.length, truncated: false };
  }

  if (depth >= 12) {
    return { type: "unknown", className: typeof unwrapped, repr: String(unwrapped) };
  }
  if (Array.isArray(unwrapped)) {
    const isTuple = isRecord(value) && value.constructor?.name === "PyProxyTuple";
    return {
      type: isTuple ? "tuple" : "list",
      length: unwrapped.length,
      items: unwrapped.map((item) => toValueSnapshot(item, depth + 1)),
      truncated: false
    };
  }
  if (unwrapped instanceof Set) {
    return {
      type: "set",
      length: unwrapped.size,
      items: Array.from(unwrapped, (item) => toValueSnapshot(item, depth + 1)),
      truncated: false
    };
  }
  if (unwrapped instanceof Map) {
    return {
      type: "dict",
      length: unwrapped.size,
      entries: Array.from(unwrapped, ([key, item]) => ({
        key: toValueSnapshot(key, depth + 1),
        value: toValueSnapshot(item, depth + 1)
      })),
      truncated: false
    };
  }
  if (isRecord(unwrapped)) {
    return {
      type: "dict",
      length: Object.keys(unwrapped).length,
      entries: Object.entries(unwrapped).map(([key, item]) => ({
        key: { type: "str", value: key, length: key.length, truncated: false },
        value: toValueSnapshot(item, depth + 1)
      })),
      truncated: false
    };
  }

  return { type: "unknown", className: typeof unwrapped, repr: String(unwrapped) };
}

function errorLine(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/line\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function errorResult(error: unknown, durationMs: number): ExecutionTerminalResult {
  const message = error instanceof Error ? error.message : String(error);
  const type = error instanceof Error && error.name ? error.name : "Error";
  const isSyntaxError = type === "SyntaxError" || /SyntaxError/i.test(message);
  const exception: ExceptionInfo = {
    type,
    message,
    line: errorLine(error),
    stack: error instanceof Error && error.stack ? error.stack.split("\n") : [],
    frameId: null
  };

  return {
    status: isSyntaxError ? "parse_error" : "exception",
    terminationReason: isSyntaxError ? "syntax_error" : "runtime_exception",
    stdout: "",
    durationMs,
    exception
  };
}

function isValueSnapshot(value: unknown): value is ValueSnapshot {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "int":
      return typeof value.value === "string";
    case "float":
      return (
        (typeof value.value === "number" && Number.isFinite(value.value)) ||
        value.value === "NaN" ||
        value.value === "Infinity" ||
        value.value === "-Infinity"
      );
    case "bool":
      return typeof value.value === "boolean";
    case "str":
      return (
        typeof value.value === "string" &&
        typeof value.length === "number" &&
        Number.isInteger(value.length) &&
        value.length >= 0 &&
        typeof value.truncated === "boolean"
      );
    case "none":
      return value.value === null;
    case "list":
    case "tuple":
      return (
        typeof value.length === "number" &&
        Number.isInteger(value.length) &&
        value.length >= 0 &&
        Array.isArray(value.items) &&
        value.items.every((item) => isValueSnapshot(item)) &&
        typeof value.truncated === "boolean"
      );
    case "dict":
      return (
        typeof value.length === "number" &&
        Number.isInteger(value.length) &&
        value.length >= 0 &&
        Array.isArray(value.entries) &&
        value.entries.every(
          (entry) =>
            isRecord(entry) &&
            isValueSnapshot(entry.key) &&
            isValueSnapshot(entry.value)
        ) &&
        typeof value.truncated === "boolean"
      );
    case "set":
      return (
        typeof value.length === "number" &&
        Number.isInteger(value.length) &&
        value.length >= 0 &&
        Array.isArray(value.items) &&
        value.items.every((item) => isValueSnapshot(item)) &&
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
    case "reference":
      return typeof value.objectId === "string" && typeof value.className === "string";
    default:
      return false;
  }
}

function isObjectSnapshot(value: unknown): value is ObjectSnapshot {
  return (
    isRecord(value) &&
    typeof value.objectId === "string" &&
    typeof value.className === "string" &&
    isRecord(value.attributes) &&
    Object.values(value.attributes).every((attribute) => isValueSnapshot(attribute))
  );
}

function normalizeException(value: unknown): ExceptionInfo | undefined {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.message !== "string") {
    return undefined;
  }

  const frameId = value.frame_id ?? value.frameId;
  return {
    type: value.type,
    message: value.message,
    line: typeof value.line === "number" ? value.line : null,
    stack: Array.isArray(value.stack) ? value.stack.filter((item): item is string => typeof item === "string") : [],
    frameId: typeof frameId === "number" ? frameId : null
  };
}

function normalizeExpressionPlan(value: unknown): ExpressionPlan | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.roots) || !Array.isArray(value.expressions)) {
    return undefined;
  }
  if (!value.roots.every((root) => isRecord(root) && typeof root.rootId === "string" &&
    (root.kind === "assignment" || root.kind === "return") && typeof root.expressionExprId === "string" &&
    isRecord(root.span) && typeof root.span.line === "number" && typeof root.span.column === "number" &&
    typeof root.span.endLine === "number" && typeof root.span.endColumn === "number" &&
    (root.kind === "return" || (isRecord(root.target) && typeof root.target.source === "string")))) {
    return undefined;
  }
  if (!value.expressions.every((expression) => isRecord(expression) && typeof expression.exprId === "string" &&
    typeof expression.rootId === "string" && (typeof expression.parentExprId === "string" || expression.parentExprId === null) &&
    ["name", "literal", "subscript", "attribute", "unary", "binary", "call"].includes(String(expression.kind)) &&
    isRecord(expression.span) && typeof expression.span.line === "number" && typeof expression.span.column === "number" &&
    typeof expression.span.endLine === "number" && typeof expression.span.endColumn === "number" &&
    typeof expression.source === "string" && Array.isArray(expression.childExprIds) &&
    expression.childExprIds.every((id) => typeof id === "string"))) {
    return undefined;
  }
  return value as unknown as ExpressionPlan;
}

function normalizeExpressionBatch(value: unknown): ExpressionBatch | null {
  if (!isRecord(value) || !Array.isArray(value.roots)) {
    return null;
  }
  const batchId = value.batch_id ?? value.batchId;
  const anchorStep = value.anchor_step ?? value.anchorStep;
  const frameId = value.frame_id ?? value.frameId;
  if (!Number.isInteger(batchId) || !Number.isInteger(anchorStep) || !Number.isInteger(frameId) ||
    typeof value.line !== "number") {
    return null;
  }
  const roots = value.roots.map((rawRoot) => {
    if (!isRecord(rawRoot)) return null;
    const rootId = rawRoot.root_id ?? rawRoot.rootId;
    const resultExprId = rawRoot.result_expr_id ?? rawRoot.resultExprId;
    const rawEvaluations = rawRoot.evaluations;
    const rawSelections = rawRoot.selection_evidence ?? rawRoot.selectionEvidence;
    if (typeof rootId !== "string" || (rawRoot.status !== "completed" && rawRoot.status !== "partial") ||
      !Array.isArray(rawEvaluations) || (rawSelections !== undefined && !Array.isArray(rawSelections))) return null;
    const evaluations = rawEvaluations.map((rawEvaluation) => {
      if (!isRecord(rawEvaluation)) return null;
      const evaluationId = rawEvaluation.evaluation_id ?? rawEvaluation.evaluationId;
      const exprId = rawEvaluation.expr_id ?? rawEvaluation.exprId;
      if (!Number.isInteger(evaluationId) || typeof exprId !== "string" || !Number.isInteger(rawEvaluation.order) ||
        !isValueSnapshot(rawEvaluation.value)) return null;
      return {
        evaluationId: evaluationId as number,
        exprId,
        order: rawEvaluation.order as number,
        value: rawEvaluation.value
      };
    });
    const selectionEvidence = (rawSelections ?? []).map((rawSelection) => {
      if (!isRecord(rawSelection)) return null;
      const callExprId = rawSelection.call_expr_id ?? rawSelection.callExprId;
      const candidateExprIds = rawSelection.candidate_expr_ids ?? rawSelection.candidateExprIds;
      const selectedCandidateIndex = rawSelection.selected_candidate_index ?? rawSelection.selectedCandidateIndex;
      if (typeof callExprId !== "string" || (rawSelection.function !== "min" && rawSelection.function !== "max") ||
        !Array.isArray(candidateExprIds) || !candidateExprIds.every((id) => typeof id === "string") ||
        !(Number.isInteger(selectedCandidateIndex) || selectedCandidateIndex === null) || !isValueSnapshot(rawSelection.result) ||
        !["resolved", "unsupported_call_shape", "unsupported_value", "ambiguous"].includes(String(rawSelection.status))) return null;
      return {
        callExprId,
        function: rawSelection.function as "min" | "max",
        candidateExprIds,
        result: rawSelection.result,
        selectedCandidateIndex: selectedCandidateIndex as number | null,
        status: rawSelection.status as "resolved" | "unsupported_call_shape" | "unsupported_value" | "ambiguous"
      };
    });
    if (evaluations.some((evaluation) => evaluation === null) || selectionEvidence.some((selection) => selection === null)) return null;
    return { rootId, status: rawRoot.status as "completed" | "partial", evaluations,
      ...(typeof resultExprId === "string" ? { resultExprId } : {}),
      ...(selectionEvidence.length > 0 ? { selectionEvidence } : {}) };
  });
  if (roots.some((root) => root === null)) return null;
  return {
    batchId: batchId as number,
    anchorStep: anchorStep as number,
    frameId: frameId as number,
    line: value.line,
    roots: roots as ExpressionBatch["roots"]
  };
}

function normalizeExpressionTracingState(value: unknown): ExpressionTracingState | undefined {
  if (!isRecord(value) || !["complete", "truncated", "unavailable"].includes(String(value.status)) ||
    (value.reason !== undefined && typeof value.reason !== "string")) {
    return undefined;
  }
  return {
    status: value.status as ExpressionTracingState["status"],
    ...(typeof value.reason === "string" ? { reason: value.reason } : {})
  };
}

function rawField(value: Record<string, unknown>, snake: string, camel: string): unknown {
  return value[snake] ?? value[camel];
}

function normalizeSourceSpan(value: unknown): { line: number; column: number; endLine: number; endColumn: number } | undefined {
  if (!isRecord(value)) return undefined;
  const line = rawField(value, "line", "line");
  const column = rawField(value, "column", "column");
  const endLine = rawField(value, "end_line", "endLine");
  const endColumn = rawField(value, "end_column", "endColumn");
  if (typeof line !== "number" || typeof column !== "number" || typeof endLine !== "number" || typeof endColumn !== "number" ||
    ![line, column, endLine, endColumn].every((item) => Number.isInteger(item) && item >= 0)) {
    return undefined;
  }
  return { line, column, endLine, endColumn };
}

function normalizeConditionStructureHint(value: unknown): ConditionPlan["operands"][number]["structureHint"] | undefined {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.variableName !== "string") return undefined;
  if (value.kind === "list_index") {
    const indexOperandId = rawField(value, "index_operand_id", "indexOperandId");
    return typeof indexOperandId === "string" ? { kind: "list_index", variableName: value.variableName, indexOperandId } : undefined;
  }
  if (value.kind === "matrix_cell") {
    const rowOperandId = rawField(value, "row_operand_id", "rowOperandId");
    const columnOperandId = rawField(value, "column_operand_id", "columnOperandId");
    return typeof rowOperandId === "string" && typeof columnOperandId === "string"
      ? { kind: "matrix_cell", variableName: value.variableName, rowOperandId, columnOperandId }
      : undefined;
  }
  return undefined;
}

export function normalizeConditionPlan(value: unknown): ConditionPlan | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sites) || !Array.isArray(value.conditions) ||
    !Array.isArray(value.operands) || !Array.isArray(value.chains)) return undefined;
  const sites = value.sites.map((raw) => {
    if (!isRecord(raw)) return null;
    const siteId = rawField(raw, "site_id", "siteId");
    const conditionId = rawField(raw, "condition_id", "conditionId");
    const span = normalizeSourceSpan(raw.span);
    const chainId = rawField(raw, "chain_id", "chainId");
    const branchIndex = rawField(raw, "branch_index", "branchIndex");
    return typeof siteId === "string" && (raw.kind === "if" || raw.kind === "elif" || raw.kind === "while") &&
      typeof conditionId === "string" && span && (chainId === undefined || typeof chainId === "string") &&
      (branchIndex === undefined || (typeof branchIndex === "number" && Number.isInteger(branchIndex) && branchIndex >= 0))
      ? { siteId, kind: raw.kind, ...(typeof chainId === "string" ? { chainId } : {}), ...(typeof branchIndex === "number" ? { branchIndex } : {}), conditionId, span }
      : null;
  });
  const conditions = value.conditions.map((raw) => {
    if (!isRecord(raw)) return null;
    const conditionId = rawField(raw, "condition_id", "conditionId");
    const siteId = rawField(raw, "site_id", "siteId");
    const childConditionIds = rawField(raw, "child_condition_ids", "childConditionIds");
    const operandIds = raw.operandIds ?? raw.operand_ids;
    const span = normalizeSourceSpan(raw.span);
    return typeof conditionId === "string" && typeof siteId === "string" &&
      typeof raw.kind === "string" && ["truth_test", "comparison", "not", "and", "or", "opaque"].includes(raw.kind) &&
      typeof raw.source === "string" && span && Array.isArray(childConditionIds) && childConditionIds.every((item) => typeof item === "string") &&
      Array.isArray(operandIds) && operandIds.every((item) => typeof item === "string")
      ? { conditionId, siteId, kind: raw.kind as ConditionPlan["conditions"][number]["kind"], source: raw.source, span, childConditionIds, operandIds }
      : null;
  });
  const operands = value.operands.map((raw) => {
    if (!isRecord(raw)) return null;
    const operandId = rawField(raw, "operand_id", "operandId");
    const conditionId = rawField(raw, "condition_id", "conditionId");
    const hint = raw.structureHint ?? raw.structure_hint;
    const span = normalizeSourceSpan(raw.span);
    return typeof operandId === "string" && typeof conditionId === "string" && typeof raw.source === "string" && span &&
      (hint === undefined || normalizeConditionStructureHint(hint) !== undefined)
      ? { operandId, conditionId, source: raw.source, span, ...(hint ? { structureHint: normalizeConditionStructureHint(hint) } : {}) }
      : null;
  });
  const chains = value.chains.map((raw) => {
    if (!isRecord(raw) || typeof raw.chainId !== "string" && typeof raw.chain_id !== "string" || !Array.isArray(raw.branches)) return null;
    const chainId = rawField(raw, "chain_id", "chainId");
    const branches = raw.branches.map((branch) => {
      if (!isRecord(branch)) return null;
      const branchIndex = rawField(branch, "branch_index", "branchIndex");
      const siteId = rawField(branch, "site_id", "siteId");
      return typeof branchIndex === "number" && Number.isInteger(branchIndex) && branchIndex >= 0 && ["if", "elif", "else"].includes(branch.kind as string) &&
        (siteId === undefined || typeof siteId === "string")
        ? { branchIndex, kind: branch.kind as "if" | "elif" | "else", ...(typeof siteId === "string" ? { siteId } : {}) }
        : null;
    });
    return branches.every((branch) => branch !== null) ? { chainId, branches: branches as ConditionPlan["chains"][number]["branches"] } : null;
  });
  if (sites.some((item) => item === null) || conditions.some((item) => item === null) || operands.some((item) => item === null) || chains.some((item) => item === null)) return undefined;
  return { version: 1, sites: sites as ConditionPlan["sites"], conditions: conditions as ConditionPlan["conditions"], operands: operands as ConditionPlan["operands"], chains: chains as ConditionPlan["chains"] };
}

export function normalizeDecisionBatch(value: unknown): DecisionBatch | null {
  if (!isRecord(value)) return null;
  const batchId = rawField(value, "batch_id", "batchId");
  const anchorStep = rawField(value, "anchor_step", "anchorStep");
  const frameId = rawField(value, "frame_id", "frameId");
  const siteId = rawField(value, "site_id", "siteId");
  const occurrence = rawField(value, "occurrence", "occurrence");
  const conditionRaw = value.condition;
  if (![batchId, anchorStep, frameId, occurrence].every((item) => typeof item === "number" && Number.isInteger(item) && item > 0) || typeof siteId !== "string" ||
    (value.status !== "completed" && value.status !== "partial") || !isRecord(conditionRaw)) return null;
  const conditionId = rawField(conditionRaw, "condition_id", "conditionId");
  const rawEvaluations = conditionRaw.evaluations;
  const rawResults = conditionRaw.condition_results ?? conditionRaw.conditionResults;
  if (typeof conditionId !== "string" || !Array.isArray(rawEvaluations) || !Array.isArray(rawResults)) return null;
  const evaluations = rawEvaluations.map((raw) => {
    if (!isRecord(raw)) return null;
    const operandId = rawField(raw, "operand_id", "operandId");
    return typeof operandId === "string" && typeof raw.order === "number" && Number.isInteger(raw.order) && raw.order > 0 && isValueSnapshot(raw.value)
      ? { operandId, order: raw.order, value: raw.value }
      : null;
  });
  const conditionResults = rawResults.map((raw) => {
    if (!isRecord(raw)) return null;
    const resultConditionId = rawField(raw, "condition_id", "conditionId");
    return typeof resultConditionId === "string" && typeof raw.order === "number" && Number.isInteger(raw.order) && raw.order > 0 && typeof raw.truth === "boolean"
      ? { conditionId: resultConditionId, order: raw.order, truth: raw.truth }
      : null;
  });
  const truth = conditionRaw.truth;
  const outcome = value.outcome;
  if (evaluations.some((item) => item === null) || conditionResults.some((item) => item === null) ||
    (truth !== undefined && typeof truth !== "boolean") ||
    conditionResults.some((item, index, items) => index > 0 && item!.order <= items[index - 1]!.order) ||
    (value.status === "partial" ? outcome !== undefined : typeof outcome !== "string" || !["branch_entered", "branch_not_entered", "loop_body_entered", "loop_exited"].includes(outcome))) return null;
  return {
    batchId: batchId as number, anchorStep: anchorStep as number, frameId: frameId as number, siteId, occurrence: occurrence as number,
    status: value.status,
    condition: { conditionId, evaluations: evaluations as DecisionBatch["condition"]["evaluations"], conditionResults: conditionResults as DecisionBatch["condition"]["conditionResults"], ...(typeof truth === "boolean" ? { truth } : {}) },
    ...(typeof outcome === "string" ? { outcome: outcome as DecisionBatch["outcome"] } : {})
  };
}

export function normalizeDecisionTracingState(value: unknown): DecisionTracingState | undefined {
  if (!isRecord(value) || !["complete", "truncated", "unavailable"].includes(String(value.status)) ||
    (value.reason !== undefined && typeof value.reason !== "string")) return undefined;
  return { status: value.status as DecisionTracingState["status"], ...(typeof value.reason === "string" ? { reason: value.reason } : {}) };
}

export function normalizePythonTraceEvent(value: unknown): TraceEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const eventName = value.event;
  if (
    eventName !== "call" &&
    eventName !== "line" &&
    eventName !== "return" &&
    eventName !== "exception"
  ) {
    return null;
  }
  if (
    typeof value.step !== "number" ||
    typeof value.frame_id !== "number" ||
    typeof value.function !== "string" ||
    typeof value.call_depth !== "number" ||
    !isRecord(value.locals) ||
    typeof value.stdout_delta !== "string" ||
    !Object.values(value.locals).every((local) => isValueSnapshot(local))
  ) {
    return null;
  }

  const eventPayload = isRecord(value.event_payload) ? value.event_payload : undefined;
  let normalizedPayload: TraceEvent["eventPayload"];
  if (eventName === "return" && eventPayload && "return_value" in eventPayload) {
    normalizedPayload = {
      type: "return",
      value: isValueSnapshot(eventPayload.return_value) ? eventPayload.return_value : null
    };
  } else if (eventName === "exception" && eventPayload) {
    const exception = normalizeException(eventPayload.exception);
    if (exception) {
      normalizedPayload = { type: "exception", exception };
    }
  }

  const parentFrameId = value.parent_frame_id ?? value.parentFrameId;
  const objects = Array.isArray(value.objects)
    ? value.objects.filter((object): object is ObjectSnapshot => isObjectSnapshot(object))
    : undefined;
  const objectsTruncated = value.objects_truncated ?? value.objectsTruncated;
  return {
    step: value.step,
    event: eventName,
    frameId: value.frame_id,
    parentFrameId: typeof parentFrameId === "number" ? parentFrameId : null,
    function: value.function,
    line: typeof value.line === "number" ? value.line : null,
    callDepth: value.call_depth,
    locals: value.locals as Record<string, ValueSnapshot>,
    stdoutDelta: value.stdout_delta,
    ...(objects ? { objects } : {}),
    ...(typeof objectsTruncated === "boolean" ? { objectsTruncated } : {}),
    ...(normalizedPayload ? { eventPayload: normalizedPayload } : {})
  };
}

function normalizePythonExecutionResult(
  value: unknown,
  durationMs: number
): { result: ExecutionTerminalResult; events: TraceEvent[] } {
  if (Array.isArray(value)) {
    const [returnValue, stdout] = value;
    return {
      result: {
        status: "completed",
        terminationReason: "normal_return",
        stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
        durationMs,
        returnValue: toValueSnapshot(returnValue)
      },
      events: []
    };
  }

  if (!isRecord(value)) {
    return {
      result: {
        status: "internal_error",
        terminationReason: "tracer_internal_error",
        stdout: "",
        durationMs,
        exception: {
          type: "RuntimeProtocolError",
          message: "Python runner returned a non-object result",
          line: null,
          stack: [],
          frameId: null
        }
      },
      events: []
    };
  }

  const events = Array.isArray(value.events)
    ? value.events
        .map((event) => normalizePythonTraceEvent(event))
        .filter((event): event is TraceEvent => event !== null)
    : [];
  const status = value.status;
  const terminationReason = value.termination_reason;
  const terminalStatuses = new Set([
    "completed",
    "exception",
    "trace_limit",
    "timeout",
    "parse_error",
    "input_error",
    "internal_error"
  ]);
  const allowedReasons = new Set([
    "normal_return",
    "runtime_exception",
    "step_limit",
    "trace_byte_limit",
    "stdout_limit",
    "hard_timeout",
    "syntax_error",
    "unsupported_testcase_format",
    "entrypoint_resolution_failed",
    "worker_initialization_failed",
    "pyodide_initialization_failed",
    "tracer_internal_error"
  ]);
  const normalizedStatus =
    typeof status === "string" && terminalStatuses.has(status)
      ? (status as ExecutionTerminalResult["status"])
      : "internal_error";
  const normalizedReason =
    typeof terminationReason === "string" && allowedReasons.has(terminationReason)
    ? (terminationReason as ExecutionTerminalResult["terminationReason"])
    : "tracer_internal_error";
  const returnValue = value.return_value;
  const exception = normalizeException(value.exception);
  const subscriptRelations = Array.isArray(value.subscript_relations)
    ? value.subscript_relations
        .map((relation) => normalizeSubscriptRelation(relation))
        .filter((relation): relation is NonNullable<typeof relation> => relation !== null)
    : [];
  const expressionPlan = normalizeExpressionPlan(value.expression_plan ?? value.expressionPlan);
  const rawExpressionBatches = value.expression_batches ?? value.expressionBatches;
  const expressionBatches = Array.isArray(rawExpressionBatches)
    ? rawExpressionBatches
        .map((batch) => normalizeExpressionBatch(batch))
        .filter((batch): batch is ExpressionBatch => batch !== null)
    : [];
  const expressionTracing = normalizeExpressionTracingState(
    value.expression_tracing ?? value.expressionTracing
  );
  const conditionPlan = normalizeConditionPlan(value.condition_plan ?? value.conditionPlan);
  const rawDecisionBatches = value.decision_batches ?? value.decisionBatches;
  const decisionBatches = Array.isArray(rawDecisionBatches)
    ? rawDecisionBatches
        .map((batch) => normalizeDecisionBatch(batch))
        .filter((batch): batch is DecisionBatch => batch !== null)
    : [];
  const decisionTracing = normalizeDecisionTracingState(
    value.decision_tracing ?? value.decisionTracing
  );

  return {
    events,
    result: {
      status: normalizedStatus,
      terminationReason: normalizedReason,
      stdout: typeof value.stdout === "string" ? value.stdout : "",
      durationMs: typeof value.duration_ms === "number" ? value.duration_ms : durationMs,
      ...(subscriptRelations.length > 0 ? { subscriptRelations } : {}),
      ...(expressionPlan ? { expressionPlan } : {}),
      ...(expressionBatches.length > 0 ? { expressionBatches } : {}),
      ...(expressionTracing ? { expressionTracing } : {}),
      ...(conditionPlan ? { conditionPlan } : {}),
      ...(decisionBatches.length > 0 ? { decisionBatches } : {}),
      ...(decisionTracing ? { decisionTracing } : {}),
      ...(isValueSnapshot(returnValue) ? { returnValue } : {}),
      ...(exception ? { exception } : {})
    }
  };
}

export function createPyodideRuntime(options: PyodideRuntimeOptions = {}): PyodideRuntime {
  const loadPyodide = options.loadPyodide ?? (bundledLoadPyodide as PyodideLoader);
  const indexURL = options.indexURL ?? DEFAULT_PYODIDE_INDEX_URL;
  let pyodide: PyodideApi | null = null;
  let initialization: Promise<void> | null = null;

  const initialize = async (): Promise<void> => {
    if (pyodide) {
      return;
    }
    if (!initialization) {
      initialization = loadPyodide({ indexURL }).then((loaded) => {
        pyodide = loaded;
      });
    }
    await initialization;
  };

  return {
    initialize,
    async execute(request: ExecutionRequest): Promise<void> {
      await initialize();
      if (!pyodide) {
        throw new Error("Pyodide did not initialize");
      }

      const startedAt = Date.now();
      let streamedEventCount = 0;
      let traceCallbackInstalled = false;
      let expressionPlanCallbackInstalled = false;
      let expressionBatchCallbackInstalled = false;
      let conditionPlanCallbackInstalled = false;
      let decisionBatchCallbackInstalled = false;
      let streamedExpressionPlan = false;
      let streamedExpressionBatches = false;
      let streamedConditionPlan = false;
      let streamedDecisionBatches = false;
      const emitTraceBatch = (sessionId: string, eventsJson: string): void => {
        if (sessionId !== request.sessionId) {
          return;
        }
        try {
          const parsed = JSON.parse(eventsJson) as unknown;
          const events = Array.isArray(parsed)
            ? parsed
                .map((event) => normalizePythonTraceEvent(event))
                .filter((event): event is TraceEvent => event !== null)
            : [];
          if (events.length === 0) {
            return;
          }
          streamedEventCount += events.length;
          options.onTraceBatch?.(sessionId, events);
        } catch {
          // A malformed optional stream must not interrupt the Python run.
        }
      };
      const emitExpressionPlan = (sessionId: string, planJson: string): void => {
        if (sessionId !== request.sessionId) return;
        try {
          const plan = normalizeExpressionPlan(JSON.parse(planJson) as unknown);
          if (!plan) return;
          streamedExpressionPlan = true;
          options.onExpressionPlan?.(sessionId, plan);
        } catch {
          // A malformed optional stream must not interrupt the Python run.
        }
      };
      const emitExpressionBatch = (sessionId: string, batchesJson: string): void => {
        if (sessionId !== request.sessionId) return;
        try {
          const parsed = JSON.parse(batchesJson) as unknown;
          const batches = Array.isArray(parsed)
            ? parsed
                .map((batch) => normalizeExpressionBatch(batch))
                .filter((batch): batch is ExpressionBatch => batch !== null)
            : [];
          if (batches.length === 0) return;
          streamedExpressionBatches = true;
          options.onExpressionBatch?.(sessionId, batches);
        } catch {
          // A malformed optional stream must not interrupt the Python run.
        }
      };
      const emitConditionPlan = (sessionId: string, planJson: string): void => {
        if (sessionId !== request.sessionId) return;
        try {
          const plan = normalizeConditionPlan(JSON.parse(planJson) as unknown);
          if (!plan) return;
          streamedConditionPlan = true;
          options.onConditionPlan?.(sessionId, plan);
        } catch {
          // A malformed optional stream must not interrupt the Python run.
        }
      };
      const emitDecisionBatch = (sessionId: string, batchesJson: string): void => {
        if (sessionId !== request.sessionId) return;
        try {
          const parsed = JSON.parse(batchesJson) as unknown;
          const batches = Array.isArray(parsed)
            ? parsed
                .map((batch) => normalizeDecisionBatch(batch))
                .filter((batch): batch is DecisionBatch => batch !== null)
            : [];
          if (batches.length === 0) return;
          streamedDecisionBatches = true;
          options.onDecisionBatch?.(sessionId, batches);
        } catch {
          // A malformed optional stream must not interrupt the Python run.
        }
      };

      try {
        if (options.onTraceBatch && typeof pyodide.globals?.set === "function") {
          pyodide.globals.set("__lc_emit_trace_batch", emitTraceBatch);
          traceCallbackInstalled = true;
        }
        if (options.onExpressionPlan && typeof pyodide.globals?.set === "function") {
          pyodide.globals.set("__lc_emit_expression_plan", emitExpressionPlan);
          expressionPlanCallbackInstalled = true;
        }
        if (options.onExpressionBatch && typeof pyodide.globals?.set === "function") {
          pyodide.globals.set("__lc_emit_expression_batch", emitExpressionBatch);
          expressionBatchCallbackInstalled = true;
        }
        if (options.onConditionPlan && typeof pyodide.globals?.set === "function") {
          pyodide.globals.set("__lc_emit_condition_plan", emitConditionPlan);
          conditionPlanCallbackInstalled = true;
        }
        if (options.onDecisionBatch && typeof pyodide.globals?.set === "function") {
          pyodide.globals.set("__lc_emit_decision_batch", emitDecisionBatch);
          decisionBatchCallbackInstalled = true;
        }
        const rawResult = await pyodide.runPythonAsync(buildExecutionScript(request));
        const normalized = normalizePythonExecutionResult(
          unwrapPyodideValue(rawResult),
          Date.now() - startedAt
        );
        if (streamedEventCount === 0) {
          const batchSize = 50;
          for (let index = 0; index < normalized.events.length; index += batchSize) {
            options.onTraceBatch?.(
              request.sessionId,
              normalized.events.slice(index, index + batchSize)
            );
          }
        }
        if (!streamedExpressionPlan && normalized.result.expressionPlan) {
          options.onExpressionPlan?.(request.sessionId, normalized.result.expressionPlan);
        }
        if (!streamedExpressionBatches && normalized.result.expressionBatches) {
          options.onExpressionBatch?.(request.sessionId, normalized.result.expressionBatches);
        }
        if (!streamedConditionPlan && normalized.result.conditionPlan) {
          options.onConditionPlan?.(request.sessionId, normalized.result.conditionPlan);
        }
        if (!streamedDecisionBatches && normalized.result.decisionBatches) {
          options.onDecisionBatch?.(request.sessionId, normalized.result.decisionBatches);
        }
        options.onFinished?.(normalized.result);
      } catch (error) {
        options.onFinished?.(errorResult(error, Date.now() - startedAt));
      } finally {
        if (traceCallbackInstalled) {
          pyodide.globals?.delete?.("__lc_emit_trace_batch");
        }
        if (expressionPlanCallbackInstalled) {
          pyodide.globals?.delete?.("__lc_emit_expression_plan");
        }
        if (expressionBatchCallbackInstalled) {
          pyodide.globals?.delete?.("__lc_emit_expression_batch");
        }
        if (conditionPlanCallbackInstalled) {
          pyodide.globals?.delete?.("__lc_emit_condition_plan");
        }
        if (decisionBatchCallbackInstalled) {
          pyodide.globals?.delete?.("__lc_emit_decision_batch");
        }
      }
    }
  };
}
