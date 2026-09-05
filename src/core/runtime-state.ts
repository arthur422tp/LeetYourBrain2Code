import type { ExceptionInfo } from "../shared/execution-types";
import type { ValueSnapshot } from "../shared/trace-types";

export interface FrameState {
  frameId: number;
  parentFrameId: number | null;
  functionName: string;
  line: number | null;
  locals: Record<string, ValueSnapshot>;
  returnValue?: ValueSnapshot | null;
  exception?: ExceptionInfo;
}

export interface RuntimeState {
  step: number;
  activeFrameId: number | null;
  frames: Map<number, FrameState>;
  callStack: number[];
  currentLine: number | null;
  stdout: string;
  exception?: ExceptionInfo;
}
