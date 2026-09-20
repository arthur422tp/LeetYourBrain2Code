import { describe, expect, it } from "vitest";

import type { TraceSession } from "../../src/shared/trace-types";
import {
  compareRunCompatibility,
  createRunComparisonState,
  normalizeExecutedTestcase,
  type RunRecord
} from "../../src/sidepanel/run-comparison-state";

function session(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    schemaVersion: 6,
    sessionId: "session-1",
    sourceCode: "class Solution:\n    def solve(self, value):\n        return value\n",
    rawTestcase: "7",
    entrypoint: {
      className: "Solution",
      methodName: "solve",
      parameterCount: 1,
      parameterKinds: ["value"]
    },
    executionEnvironment: { runtime: "pyodide", pythonVersion: "3.13" },
    status: "completed",
    terminationReason: "normal_return",
    events: [],
    stdout: "",
    limits: {
      maxTraceSteps: 10,
      maxContainerItems: 10,
      maxNestingDepth: 4,
      maxSnapshotBytes: 1000,
      maxSessionBytes: 10000,
      maxStdoutBytes: 1000,
      hardTimeoutMs: 100,
      maxObjectNodes: 10,
      maxObjectAttributes: 10,
      maxObjectDepth: 4,
      maxExpressionEvents: 10,
      maxExpressionBytes: 1000,
      maxDecisionEvents: 10,
      maxDecisionBytes: 1000,
      maxControlFlowEvents: 10,
      maxControlFlowBytes: 1000,
      maxCallFrameEvents: 10,
      maxCallFrameBytes: 1000
    },
    ...overrides
  };
}

function run(overrides: Partial<TraceSession> = {}, context: Partial<RunRecord["context"]> = {}): RunRecord {
  return {
    session: session(overrides),
    context: {
      problemSlug: "one",
      problemTitle: "One",
      selectedCaseIndex: 0,
      language: "python",
      ...context
    }
  };
}

describe("run comparison compatibility", () => {
  it("normalizes only carriage-return line endings", () => {
    expect(normalizeExecutedTestcase("  first\r\nsecond\r\n\rthird  "))
      .toBe("  first\nsecond\n\nthird  ");
  });

  it("accepts the same problem, testcase, and entrypoint despite source or status changes", () => {
    expect(compareRunCompatibility(
      run({ sourceCode: "baseline" }),
      run({ sessionId: "session-2", sourceCode: "refactored", status: "timeout", terminationReason: "hard_timeout" })
    )).toEqual({ status: "compatible" });
  });

  it.each([
    ["different problem", run({ sessionId: "session-2" }, { problemSlug: "two" }), "different_problem"],
    ["different testcase", run({ sessionId: "session-2", rawTestcase: "8" }), "different_testcase"],
    ["different entrypoint", run({ sessionId: "session-2", entrypoint: {
      className: "Solution",
      methodName: "other",
      parameterCount: 1,
      parameterKinds: ["value"]
    } }), "different_entrypoint"]
  ] as const)("rejects %s", (_label, current, status) => {
    expect(compareRunCompatibility(run(), current)).toEqual({ status });
  });

  it("recognizes the same captured session before comparing its other fields", () => {
    expect(compareRunCompatibility(run(), run({ rawTestcase: "different" })))
      .toEqual({ status: "same_run" });
  });

  it("reports missing sides and unsupported runtime or schema explicitly", () => {
    expect(compareRunCompatibility(null, run())).toEqual({ status: "no_baseline" });
    expect(compareRunCompatibility(run(), null)).toEqual({ status: "no_current" });
    expect(compareRunCompatibility(
      run({
        sessionId: "session-2",
        executionEnvironment: { runtime: "other", pythonVersion: "unknown" } as unknown as TraceSession["executionEnvironment"]
      }),
      run()
    )).toEqual({ status: "unsupported_runtime" });
    expect(compareRunCompatibility(run({ sessionId: "session-2", schemaVersion: 99 }), run()))
      .toEqual({ status: "unsupported_schema" });
  });
});

describe("run comparison state", () => {
  it("pins the current reference, preserves it across newer current runs, and replaces or clears explicitly", () => {
    const state = createRunComparisonState();
    const first = run();
    const second = run({ sessionId: "session-2" });

    expect(state.pinCurrent()).toBe(false);
    state.setCurrent(first);
    expect(state.pinCurrent()).toBe(true);
    expect(state.get()).toEqual({ baseline: first, current: first });

    state.setCurrent(second);
    expect(state.get()).toEqual({ baseline: first, current: second });
    expect(state.replaceBaseline()).toBe(true);
    expect(state.get().baseline).toBe(second);

    state.clearBaseline();
    expect(state.get().baseline).toBeNull();
    state.setCurrent(first);
    state.clearForProblemChange();
    expect(state.get()).toEqual({ baseline: null, current: null });
  });
});
