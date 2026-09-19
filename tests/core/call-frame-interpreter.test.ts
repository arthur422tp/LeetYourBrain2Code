import { describe, expect, it } from "vitest";

import {
  frameCursorContextAt,
  interpretCallFrames
} from "../../src/core/call-frame-interpreter";
import type {
  CallFrameBatch,
  CallFrameRuntimeUpdate,
  FunctionPlan
} from "../../src/shared/call-frame-types";
import type { TraceEvent, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const none: ValueSnapshot = { type: "none", value: null };

const plan: FunctionPlan = {
  version: 1,
  functions: [
    {
      functionId: "method:Solution.solve:1:0:1",
      kind: "method",
      name: "solve",
      qualifiedName: "Solution.solve",
      span: { line: 1, column: 0, endLine: 1, endColumn: 12 },
      firstBodyLine: 2,
      parameterNames: [],
      parameterKinds: []
    },
    {
      functionId: "function:helper:10:0:2",
      kind: "function",
      name: "helper",
      qualifiedName: "helper",
      span: { line: 10, column: 0, endLine: 10, endColumn: 12 },
      firstBodyLine: 11,
      parameterNames: [],
      parameterKinds: []
    },
    {
      functionId: "function:other:20:0:3",
      kind: "function",
      name: "other",
      qualifiedName: "other",
      span: { line: 20, column: 0, endLine: 20, endColumn: 11 },
      firstBodyLine: 21,
      parameterNames: [],
      parameterKinds: []
    }
  ]
};

function enter(
  updateId: number,
  frameId: number,
  functionName: string,
  functionId: string | undefined,
  parentFrameId: number | null,
  callStep: number,
  depth: number
): CallFrameRuntimeUpdate {
  return {
    updateId,
    kind: "frame_enter",
    frameId,
    parentFrameId,
    functionName,
    ...(functionId ? { functionId } : {}),
    callStep,
    depth,
    arguments: []
  };
}

function returned(updateId: number, frameId: number, exitStep: number, value: ValueSnapshot): CallFrameRuntimeUpdate {
  return { updateId, kind: "frame_return", frameId, exitStep, value };
}

function exception(updateId: number, frameId: number, exitStep: number): CallFrameRuntimeUpdate {
  return {
    updateId,
    kind: "frame_exception",
    frameId,
    exitStep,
    exception: {
      type: "ValueError",
      message: "bad value",
      line: 4,
      stack: [],
      frameId
    }
  };
}

function batch(batchId: number, updates: CallFrameRuntimeUpdate[]): CallFrameBatch {
  return { batchId, updates };
}

function event(step: number, frameId: number, eventName: TraceEvent["event"], functionName = "solve"): TraceEvent {
  return {
    step,
    event: eventName,
    frameId,
    parentFrameId: frameId === 1 ? null : 1,
    function: functionName,
    line: step,
    callDepth: frameId === 1 ? 1 : 2,
    locals: {},
    stdoutDelta: ""
  };
}

describe("call-frame-interpreter", () => {
  it("reconstructs ordered siblings and preserves the first terminal evidence", () => {
    const model = interpretCallFrames({
      events: [event(1, 1, "call"), event(2, 1, "line"), event(3, 2, "call"), event(4, 2, "line"), event(5, 3, "call")],
      functionPlan: plan,
      batches: [
        batch(2, [
          returned(5, 2, 6, int(2)),
          returned(7, 2, 7, int(99))
        ]),
        batch(1, [
          enter(1, 1, "solve", plan.functions[0]!.functionId, null, 1, 1),
          enter(2, 2, "helper", plan.functions[1]!.functionId, 1, 3, 2),
          enter(3, 3, "helper", plan.functions[1]!.functionId, 1, 5, 2)
        ])
      ],
      tracingState: { status: "complete" },
      terminationReason: "normal_return"
    });

    expect(model.roots).toEqual([1]);
    expect(model.byFrameId.get(1)?.childFrameIds).toEqual([2, 3]);
    expect(model.byFrameId.get(2)?.parentFrameId).toBe(1);
    expect(model.byFrameId.get(3)?.parentFrameId).toBe(1);
    expect(model.byFrameId.get(2)?.exit).toEqual({ status: "returned", step: 6, value: int(2) });
    expect(model.byFrameId.get(3)?.exit).toEqual({ status: "trace_ended", reason: "normal_return" });
  });

  it("derives direct, mutual, and non-recursive repeated-call facts from ancestry", () => {
    const a = "function:a:1:0:1";
    const b = "function:b:5:0:2";
    const model = interpretCallFrames({
      events: [],
      batches: [batch(1, [
        enter(1, 1, "a", a, null, 1, 1),
        enter(2, 2, "a", a, 1, 2, 2),
        enter(3, 3, "a", a, 2, 3, 3),
        enter(4, 4, "b", b, 1, 4, 2),
        enter(5, 5, "a", a, 4, 5, 3),
        enter(6, 6, "a", a, null, 6, 1),
        enter(7, 7, "a", undefined, 6, 7, 2)
      ])],
      tracingState: { status: "complete" },
      terminationReason: "normal_return"
    });

    expect(model.byFrameId.get(1)?.recursion).toMatchObject({ isRecursive: false, recursionDepth: 1 });
    expect(model.byFrameId.get(2)?.recursion).toMatchObject({ isRecursive: true, recursionDepth: 2, repeatedAncestorFrameId: 1 });
    expect(model.byFrameId.get(3)?.recursion).toMatchObject({ isRecursive: true, recursionDepth: 3, repeatedAncestorFrameId: 2 });
    expect(model.byFrameId.get(5)?.recursion).toMatchObject({ isRecursive: true, recursionDepth: 2, repeatedAncestorFrameId: 1 });
    expect(model.byFrameId.get(6)?.recursion).toMatchObject({ isRecursive: false, recursionDepth: 1 });
    expect(model.byFrameId.get(7)?.recursion).toMatchObject({ isRecursive: false, recursionDepth: 1 });
  });

  it("uses raw line events for first-user-line steps and projects unclosed frames", () => {
    const model = interpretCallFrames({
      events: [event(10, 1, "call"), event(11, 1, "line"), event(12, 2, "line")],
      batches: [batch(1, [
        enter(1, 1, "solve", undefined, null, 10, 1),
        enter(2, 2, "helper", undefined, 1, 12, 2)
      ])],
      tracingState: { status: "truncated", reason: "call_frame_event_limit" },
      terminationReason: "hard_timeout"
    });

    expect(model.byFrameId.get(1)?.firstUserLineStep).toBe(11);
    expect(model.byFrameId.get(2)?.firstUserLineStep).toBe(12);
    expect(model.byFrameId.get(1)?.exit).toEqual({ status: "trace_ended", reason: "call_frame_event_limit" });
    expect(model.byFrameId.get(2)?.exit).toEqual({ status: "trace_ended", reason: "call_frame_event_limit" });
  });

  it("keeps factual terminal exceptions and ignores malformed terminal-only frames", () => {
    const model = interpretCallFrames({
      events: [event(3, 1, "line")],
      batches: [batch(1, [
        exception(1, 99, 2),
        enter(2, 1, "solve", undefined, null, 1, 1),
        exception(3, 1, 3)
      ])],
      tracingState: { status: "complete" },
      terminationReason: "runtime_exception"
    });

    expect(model.byFrameId.has(99)).toBe(false);
    expect(model.byFrameId.get(1)?.exit).toMatchObject({ status: "exception", step: 3 });
    expect(model.byFrameId.get(1)?.firstUserLineStep).toBe(3);
  });

  it("keeps missing parents factual and distinguishes sequential calls returning None", () => {
    const functionId = "method:Solution.solve:1:0:1";
    const model = interpretCallFrames({
      events: [],
      batches: [batch(1, [
        enter(1, 8, "solve", functionId, 404, 1, 1),
        returned(2, 8, 2, none),
        enter(3, 9, "solve", functionId, null, 3, 1),
        returned(4, 9, 4, none)
      ])],
      tracingState: { status: "complete" },
      terminationReason: "normal_return"
    });

    expect(model.roots).toEqual([8, 9]);
    expect(model.byFrameId.get(8)?.parentFrameId).toBe(404);
    expect(model.byFrameId.get(8)?.exit).toEqual({ status: "returned", step: 2, value: none });
    expect(model.byFrameId.get(9)?.exit).toEqual({ status: "returned", step: 4, value: none });
    expect(model.byFrameId.get(8)?.recursion).toEqual({ isRecursive: false, recursionDepth: 1 });
    expect(model.byFrameId.get(9)?.recursion).toEqual({ isRecursive: false, recursionDepth: 1 });
  });

  it("resolves the cursor from the raw event frame and factual ancestry", () => {
    const model = interpretCallFrames({
      events: [],
      batches: [batch(1, [
        enter(1, 1, "solve", undefined, null, 1, 1),
        enter(2, 2, "helper", undefined, 1, 2, 2),
        enter(3, 3, "nested", undefined, 2, 3, 3)
      ])],
      tracingState: { status: "complete" },
      terminationReason: "normal_return"
    });

    expect(frameCursorContextAt(model, [event(1, 3, "line", "nested")], 0)).toEqual({
      currentFrameId: 3,
      ancestors: [1, 2],
      activeChildPath: [1, 2, 3]
    });
    expect(frameCursorContextAt(model, [event(2, 77, "line", "helper")], 0)).toEqual({
      ancestors: [],
      activeChildPath: []
    });
    expect(frameCursorContextAt(model, [event(1, 3, "line")], -1)).toEqual({
      ancestors: [],
      activeChildPath: []
    });
  });
});
