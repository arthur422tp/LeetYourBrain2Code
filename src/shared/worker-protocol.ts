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

export type WorkerInboundMessage = {
  type: "execute";
  request: ExecutionRequest;
};

export type WorkerOutboundMessage =
  | { type: "ready" }
  | { type: "trace_batch"; sessionId: string; events: TraceEvent[] }
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
  return typeof value === "object" && value !== null;
}

function isExecutionTerminalResult(value: unknown): value is ExecutionTerminalResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isTerminalStatus(value.status) &&
    isTerminationReason(value.terminationReason) &&
    typeof value.stdout === "string" &&
    typeof value.durationMs === "number"
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
