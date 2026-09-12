import type { StaticRelation, ValueSnapshot } from "./trace-types";

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

export type ParameterKind = "value" | "linked_list" | "binary_tree";

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
  maxObjectDepth: 32
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
  returnValue?: ValueSnapshot | null;
  exception?: ExceptionInfo;
}
