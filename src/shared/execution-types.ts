import type { StaticRelation, ValueSnapshot } from "./trace-types";
import type {
  ExpressionBatch,
  ExpressionPlan,
  ExpressionTracingState
} from "./expression-types";
import type {
  ConditionPlan,
  DecisionBatch,
  DecisionTracingState
} from "./decision-types";
import type {
  ControlFlowBatch,
  ControlFlowPlan,
  ControlFlowTracingState
} from "./control-flow-types";

export const TRACE_SESSION_STATUSES = [
  "running",
  "completed",
  "exception",
  "trace_limit",
  "timeout",
  "parse_error",
  "input_error",
  "internal_error"
] as const;

export type TraceSessionStatus = (typeof TRACE_SESSION_STATUSES)[number];

export const TERMINATION_REASONS = [
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
] as const;

export type TerminationReason = (typeof TERMINATION_REASONS)[number];

export type ParameterKind = "value" | "linked_list" | "binary_tree" | "graph_node";

export interface EntryPoint {
  className: string;
  methodName: string;
  parameterCount: number;
  parameterKinds: ParameterKind[];
}

export interface ExecutionLimits {
  maxTraceSteps: number;
  maxContainerItems: number;
  maxNestingDepth: number;
  maxSnapshotBytes: number;
  maxSessionBytes: number;
  maxStdoutBytes: number;
  hardTimeoutMs: number;
  maxObjectNodes: number;
  maxObjectAttributes: number;
  maxObjectDepth: number;
  maxExpressionEvents: number;
  maxExpressionBytes: number;
  maxDecisionEvents: number;
  maxDecisionBytes: number;
  maxControlFlowEvents: number;
  maxControlFlowBytes: number;
}

export const DEFAULT_EXECUTION_LIMITS: Readonly<ExecutionLimits> = {
  maxTraceSteps: 10_000,
  maxContainerItems: 1_000,
  maxNestingDepth: 12,
  maxSnapshotBytes: 256_000,
  maxSessionBytes: 8_000_000,
  maxStdoutBytes: 64_000,
  hardTimeoutMs: 5_000,
  maxObjectNodes: 200,
  maxObjectAttributes: 20,
  maxObjectDepth: 32,
  maxExpressionEvents: 20_000,
  maxExpressionBytes: 2_000_000,
  maxDecisionEvents: 20_000,
  maxDecisionBytes: 2_000_000,
  maxControlFlowEvents: 20_000,
  maxControlFlowBytes: 2_000_000
};

export interface ExecutionRequest {
  sessionId: string;
  sourceCode: string;
  rawTestcase: string;
  entrypoint: EntryPoint;
  limits: ExecutionLimits;
}

export interface ExceptionInfo {
  type: string;
  message: string;
  line: number | null;
  stack: string[];
  frameId: number | null;
}

export type TerminalTraceSessionStatus = Exclude<TraceSessionStatus, "running">;

export interface ExecutionTerminalResult {
  status: TerminalTraceSessionStatus;
  terminationReason: TerminationReason;
  stdout: string;
  durationMs: number;
  subscriptRelations?: StaticRelation[];
  expressionPlan?: ExpressionPlan;
  expressionBatches?: ExpressionBatch[];
  expressionTracing?: ExpressionTracingState;
  conditionPlan?: ConditionPlan;
  decisionBatches?: DecisionBatch[];
  decisionTracing?: DecisionTracingState;
  controlFlowPlan?: ControlFlowPlan;
  controlFlowBatches?: ControlFlowBatch[];
  controlFlowTracing?: ControlFlowTracingState;
  returnValue?: ValueSnapshot | null;
  exception?: ExceptionInfo;
}
