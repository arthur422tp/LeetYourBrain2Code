import type {
  EntryPoint,
  ExceptionInfo,
  ExecutionLimits,
  ExecutionTerminalResult,
  TraceSessionStatus
} from "./execution-types";

export const TRACE_SCHEMA_VERSION = 1;

export type FloatSnapshotValue = number | "NaN" | "Infinity" | "-Infinity";

export interface IntValueSnapshot {
  type: "int";
  value: string;
}

export interface FloatValueSnapshot {
  type: "float";
  value: FloatSnapshotValue;
}

export interface BoolValueSnapshot {
  type: "bool";
  value: boolean;
}

export interface StringValueSnapshot {
  type: "str";
  value: string;
  length: number;
  truncated: boolean;
}

export interface NoneValueSnapshot {
  type: "none";
  value: null;
}

export interface ListValueSnapshot {
  type: "list";
  length: number;
  items: ValueSnapshot[];
  truncated: boolean;
}

export interface TupleValueSnapshot {
  type: "tuple";
  length: number;
  items: ValueSnapshot[];
  truncated: boolean;
}

export interface DictEntrySnapshot {
  key: ValueSnapshot;
  value: ValueSnapshot;
}

export interface DictValueSnapshot {
  type: "dict";
  length: number;
  entries: DictEntrySnapshot[];
  truncated: boolean;
}

export interface SetValueSnapshot {
  type: "set";
  length: number;
  items: ValueSnapshot[];
  truncated: boolean;
}

export interface UnknownValueSnapshot {
  type: "unknown";
  className: string;
  repr: string;
  truncated?: boolean;
}

export interface CycleValueSnapshot {
  type: "cycle";
  referenceId: string;
}

export type ValueSnapshot =
  | IntValueSnapshot
  | FloatValueSnapshot
  | BoolValueSnapshot
  | StringValueSnapshot
  | NoneValueSnapshot
  | ListValueSnapshot
  | TupleValueSnapshot
  | DictValueSnapshot
  | SetValueSnapshot
  | UnknownValueSnapshot
  | CycleValueSnapshot;

export type TraceEventType = "call" | "line" | "return" | "exception";

export type TraceEventPayload =
  | { type: "return"; value: ValueSnapshot | null }
  | { type: "exception"; exception: ExceptionInfo };

export interface TraceEvent {
  step: number;
  event: TraceEventType;
  frameId: number;
  parentFrameId: number | null;
  function: string;
  line: number | null;
  callDepth: number;
  locals: Record<string, ValueSnapshot>;
  stdoutDelta: string;
  eventPayload?: TraceEventPayload;
}

export interface ExecutionEnvironment {
  runtime: "pyodide";
  pythonVersion: string;
}

export interface TraceSession {
  schemaVersion: number;
  sessionId: string;
  sourceCode: string;
  rawTestcase: string;
  entrypoint: EntryPoint;
  executionEnvironment: ExecutionEnvironment;
  status: TraceSessionStatus;
  terminationReason: ExecutionTerminalResult["terminationReason"];
  events: TraceEvent[];
  stdout: string;
  limits: ExecutionLimits;
  returnValue?: ValueSnapshot | null;
  exception?: ExceptionInfo;
}
