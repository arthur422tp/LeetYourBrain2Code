import type { ExceptionInfo } from "./execution-types";
import type { SourceSpan } from "./expression-types";
import type { ValueSnapshot } from "./trace-types";

export type FunctionKind = "function" | "method" | "nested_function";

export type ParameterBindingKind =
  | "positional_only"
  | "positional_or_keyword"
  | "keyword_only"
  | "varargs"
  | "varkw"
  | "unknown";

export interface FunctionDescriptor {
  functionId: string;
  kind: FunctionKind;
  name: string;
  qualifiedName: string;
  span: SourceSpan;
  firstBodyLine: number | null;
  parameterNames: string[];
  parameterKinds: ParameterBindingKind[];
  parentFunctionId?: string;
  parentClassName?: string;
}

export interface FunctionPlan {
  version: 1;
  functions: FunctionDescriptor[];
}

export interface BoundArgumentSnapshot {
  name: string;
  kind: ParameterBindingKind;
  value: ValueSnapshot;
}

export type CallFrameRuntimeUpdate =
  | {
      updateId: number;
      kind: "frame_enter";
      frameId: number;
      parentFrameId: number | null;
      functionName: string;
      functionId?: string;
      callStep: number;
      depth: number;
      arguments: BoundArgumentSnapshot[];
    }
  | {
      updateId: number;
      kind: "frame_return";
      frameId: number;
      exitStep: number;
      value: ValueSnapshot;
    }
  | {
      updateId: number;
      kind: "frame_exception";
      frameId: number;
      exitStep: number;
      exception: ExceptionInfo;
    }
  | {
      updateId: number;
      kind: "frame_trace_ended";
      frameId: number;
      reason: string;
      exitStep?: number;
    };

export interface CallFrameBatch {
  batchId: number;
  updates: CallFrameRuntimeUpdate[];
}

export interface CallFrameTracingState {
  status: "complete" | "truncated" | "unavailable";
  reason?: string;
}

export type FrameExitEvidence = "observed" | "synthesized";

export interface RecursionOccurrenceInfo {
  isRecursive: boolean;
  recursionDepth: number;
  repeatedAncestorFrameId?: number;
  cycleFunctionIds?: string[];
}

export type FrameExit =
  | { status: "active" }
  | { status: "returned"; step: number; value: ValueSnapshot }
  | { status: "exception"; step: number; exception: ExceptionInfo }
  | { status: "trace_ended"; step?: number; reason: string };

export interface FrameOccurrence {
  frameId: number;
  functionId?: string;
  functionName: string;
  parentFrameId: number | null;
  depth: number;
  callStep: number;
  firstUserLineStep?: number;
  arguments: BoundArgumentSnapshot[];
  childFrameIds: number[];
  recursion: RecursionOccurrenceInfo;
  exit: FrameExit;
  /** Whether the terminal exit came from a runtime update or interpreter fallback. */
  exitEvidence?: FrameExitEvidence;
}

export interface CallFrameModel {
  roots: number[];
  byFrameId: Map<number, FrameOccurrence>;
  tracingState: CallFrameTracingState;
}

export interface FrameCursorContext {
  currentFrameId?: number;
  ancestors: number[];
  activeChildPath: number[];
}
