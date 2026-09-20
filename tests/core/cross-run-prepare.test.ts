import { describe, expect, it } from "vitest";

import { interpretTraceSession } from "../../src/core/trace-session-interpreter";
import {
  prepareCrossRun,
  type CrossRunCoverage
} from "../../src/core/cross-run-prepare";
import { DEFAULT_EXECUTION_LIMITS } from "../../src/shared/execution-types";
import type { TraceSession, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function session(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    schemaVersion: 6,
    sessionId: "prepare-session",
    sourceCode: "class Solution:\n    def solve(self, value):\n        return value\n",
    rawTestcase: "1",
    entrypoint: {
      className: "Solution",
      methodName: "solve",
      parameterCount: 1,
      parameterKinds: ["value"]
    },
    executionEnvironment: { runtime: "pyodide", pythonVersion: "3.13" },
    status: "completed",
    terminationReason: "normal_return",
    events: [{
      step: 1,
      event: "line",
      frameId: 1,
      parentFrameId: null,
      function: "solve",
      line: 3,
      callDepth: 1,
      locals: { value: int(1) },
      stdoutDelta: ""
    }],
    stdout: "",
    limits: DEFAULT_EXECUTION_LIMITS,
    functionPlan: {
      version: 1,
      functions: [{
        functionId: "method:Solution.solve",
        kind: "method",
        name: "solve",
        qualifiedName: "Solution.solve",
        span: { line: 2, column: 4, endLine: 3, endColumn: 20 },
        firstBodyLine: 3,
        parameterNames: ["self", "value"],
        parameterKinds: ["positional_or_keyword", "positional_or_keyword"]
      }]
    },
    callFrameBatches: [{
      batchId: 1,
      updates: [{
        updateId: 1,
        kind: "frame_enter",
        frameId: 1,
        parentFrameId: null,
        functionName: "solve",
        functionId: "method:Solution.solve",
        callStep: 1,
        depth: 1,
        arguments: [{ name: "value", kind: "positional_or_keyword", value: int(1) }]
      }, {
        updateId: 2,
        kind: "frame_return",
        frameId: 1,
        exitStep: 1,
        value: int(1)
      }]
    }],
    callFrameTracing: { status: "complete" },
    expressionTracing: { status: "complete" },
    decisionTracing: { status: "complete" },
    controlFlowTracing: { status: "complete" },
    returnValue: int(1),
    ...overrides
  };
}

describe("prepareCrossRun", () => {
  it("reuses an existing interpretation and derives a stable prepared projection", () => {
    const trace = session();
    const interpretation = interpretTraceSession(trace);
    const mutationBatchesBefore = interpretation.mutationBatches;

    const prepared = prepareCrossRun(trace, interpretation);

    expect(prepared.session).toBe(trace);
    expect(prepared.interpretation).toBe(interpretation);
    expect(prepared.frames).toEqual(expect.any(Map));
    expect([...prepared.frames.keys()]).toEqual([1]);
    expect(prepared.roots).toEqual([1]);
    expect(prepared.coverage.callFrames).toBe("complete");
    expect(prepared.coverage.mutations.status).toBe("complete");
    expect(interpretation.mutationBatches).toBe(mutationBatchesBefore);
  });

  it("makes missing or truncated evidence explicit in coverage", () => {
    const trace = session({
      status: "trace_limit",
      terminationReason: "step_limit",
      expressionTracing: { status: "truncated", reason: "expression_limit" },
      decisionTracing: { status: "unavailable", reason: "decision_channel_missing" },
      controlFlowTracing: undefined
    });

    const prepared = prepareCrossRun(trace);
    const coverage: CrossRunCoverage = prepared.coverage;

    expect(coverage.callFrames).toBe("complete");
    expect(coverage.expressions).toBe("partial");
    expect(coverage.decisions).toBe("unavailable");
    expect(coverage.controlFlow).toBe("unavailable");
    expect(coverage.mutations.status).toBe("partial");
    expect(coverage.values.incomparableCount).toBe(0);
  });
});
