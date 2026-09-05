import { describe, expect, it } from "vitest";

import type { ExceptionInfo } from "../../src/shared/execution-types";
import type { TraceEvent, ValueSnapshot } from "../../src/shared/trace-types";
import { reconstructStates } from "../../src/core/state-reconstructor";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function event(overrides: Partial<TraceEvent> & Pick<TraceEvent, "event" | "frameId" | "function">): TraceEvent {
  return {
    step: overrides.step ?? 1,
    event: overrides.event,
    frameId: overrides.frameId,
    parentFrameId: overrides.parentFrameId ?? null,
    function: overrides.function,
    line: overrides.line ?? 1,
    callDepth: overrides.callDepth ?? 1,
    locals: overrides.locals ?? {},
    stdoutDelta: overrides.stdoutDelta ?? "",
    ...(overrides.eventPayload ? { eventPayload: overrides.eventPayload } : {})
  };
}

describe("reconstructStates", () => {
  it("keeps recursive frames distinct and removes a returned frame after its return state", () => {
    const states = reconstructStates([
      event({ step: 1, event: "call", frameId: 1, function: "factorial", line: 1, locals: { n: int(3) } }),
      event({ step: 2, event: "call", frameId: 2, parentFrameId: 1, function: "factorial", line: 1, callDepth: 2, locals: { n: int(2) } }),
      event({ step: 3, event: "call", frameId: 3, parentFrameId: 2, function: "factorial", line: 1, callDepth: 3, locals: { n: int(1) } }),
      event({
        step: 4,
        event: "return",
        frameId: 3,
        parentFrameId: 2,
        function: "factorial",
        line: 2,
        callDepth: 3,
        locals: { n: int(1) },
        eventPayload: { type: "return", value: int(1) }
      }),
      event({ step: 5, event: "line", frameId: 2, parentFrameId: 1, function: "factorial", line: 3, callDepth: 2, locals: { n: int(2), child: int(1) } }),
      event({
        step: 6,
        event: "return",
        frameId: 2,
        parentFrameId: 1,
        function: "factorial",
        line: 3,
        callDepth: 2,
        locals: { n: int(2), child: int(1) },
        eventPayload: { type: "return", value: int(2) }
      }),
      event({ step: 7, event: "line", frameId: 1, function: "factorial", line: 3, locals: { n: int(3), child: int(2) } }),
      event({
        step: 8,
        event: "return",
        frameId: 1,
        function: "factorial",
        line: 3,
        locals: { n: int(3), child: int(2) },
        eventPayload: { type: "return", value: int(6) }
      })
    ]);

    expect(states[0]?.callStack).toEqual([1]);
    expect(states[1]?.callStack).toEqual([1, 2]);
    expect(states[2]?.callStack).toEqual([1, 2, 3]);
    expect(states[2]?.frames.get(1)?.locals).toEqual({ n: int(3) });
    expect(states[2]?.frames.get(2)?.locals).toEqual({ n: int(2) });

    expect(states[3]?.callStack).toEqual([1, 2, 3]);
    expect(states[3]?.frames.has(3)).toBe(true);
    expect(states[4]?.callStack).toEqual([1, 2]);
    expect(states[4]?.frames.has(3)).toBe(false);
    expect(states[4]?.frames.get(1)?.locals).toEqual({ n: int(3) });
    expect(states[5]?.callStack).toEqual([1, 2]);
    expect(states[6]?.callStack).toEqual([1]);
    expect(states[6]?.frames.has(2)).toBe(false);
    expect(states[7]?.callStack).toEqual([1]);
    expect(states[7]?.frames.has(1)).toBe(true);
    expect(states[7]?.frames.get(1)?.locals).toEqual({ n: int(3), child: int(2) });
  });

  it("accumulates stdout and attaches exception metadata without discarding frame locals", () => {
    const exception: ExceptionInfo = {
      type: "IndexError",
      message: "list index out of range",
      line: 4,
      stack: ["trace"],
      frameId: 2
    };

    const states = reconstructStates([
      event({ step: 1, event: "call", frameId: 1, function: "outer", locals: { label: { type: "str", value: "x", length: 1, truncated: false } }, stdoutDelta: "start\n" }),
      event({ step: 2, event: "call", frameId: 2, parentFrameId: 1, function: "inner", callDepth: 2, locals: { index: int(5) }, stdoutDelta: "inner\n" }),
      event({
        step: 3,
        event: "exception",
        frameId: 2,
        parentFrameId: 1,
        function: "inner",
        line: 4,
        callDepth: 2,
        locals: { index: int(5) },
        stdoutDelta: "",
        eventPayload: { type: "exception", exception }
      })
    ]);

    expect(states[0]?.stdout).toBe("start\n");
    expect(states[1]?.stdout).toBe("start\ninner\n");
    expect(states[2]?.stdout).toBe("start\ninner\n");
    expect(states[2]?.exception).toEqual(exception);
    expect(states[2]?.callStack).toEqual([1, 2]);
    expect(states[2]?.frames.get(1)?.locals).toEqual({
      label: { type: "str", value: "x", length: 1, truncated: false }
    });
    expect(states[2]?.frames.get(2)?.locals).toEqual({ index: int(5) });
  });

  it("does not let later event updates mutate earlier runtime states", () => {
    const states = reconstructStates([
      event({ step: 1, event: "line", frameId: 1, function: "one", locals: { value: int(0) } }),
      event({ step: 2, event: "line", frameId: 1, function: "one", line: 2, locals: { value: int(1) } })
    ]);

    expect(states[0]?.frames.get(1)?.locals).toEqual({ value: int(0) });
    expect(states[1]?.frames.get(1)?.locals).toEqual({ value: int(1) });
  });
});
