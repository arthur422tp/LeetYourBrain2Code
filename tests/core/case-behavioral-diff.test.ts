import { describe, expect, it, vi } from "vitest";

import type { CrossRunDiffResult } from "../../src/core/cross-run-diff";
import type { PreparedCrossRun } from "../../src/core/cross-run-diff-types";
import {
  compareCaseBehavioralDiff,
  type CaseBehavioralDiffDependencies
} from "../../src/core/case-behavioral-diff";
import type { TraceSession } from "../../src/shared/trace-types";
import type { RunRecord } from "../../src/sidepanel/run-comparison-state";

function run(
  sessionId: string,
  selectedCaseIndex: number,
  overrides: Partial<TraceSession> = {}
): RunRecord {
  return {
    session: {
      sessionId,
      schemaVersion: 6,
      sourceCode: "class Solution:\n    def solve(self, value):\n        return value\n",
      rawTestcase: String(selectedCaseIndex + 1),
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
    },
    context: {
      problemSlug: "same-problem",
      problemTitle: "Same Problem",
      selectedCaseIndex,
      language: "python"
    }
  };
}

function prepared(): PreparedCrossRun {
  return {} as PreparedCrossRun;
}

function diff(overrides: Partial<CrossRunDiffResult> = {}): CrossRunDiffResult {
  return {
    compatibility: { status: "compatible" },
    alignedPrefix: { frameCount: 1, checkpointCount: 2, callPath: ["solve"] },
    coverage: {
      callFrames: "complete",
      decisions: "complete",
      expressions: "complete",
      controlFlow: "complete",
      mutations: { status: "complete", skippedUnstableObjectMutations: 0 },
      values: { incomparableCount: 0 }
    },
    ...overrides
  };
}

function dependencies(
  overrides: Partial<CaseBehavioralDiffDependencies> = {}
): CaseBehavioralDiffDependencies & {
  prepareCrossRun: ReturnType<typeof vi.fn>;
  compareCrossRuns: ReturnType<typeof vi.fn>;
} {
  return {
    prepareCrossRun: vi.fn(() => prepared()),
    compareCrossRuns: vi.fn(() => diff()),
    ...overrides
  } as CaseBehavioralDiffDependencies & {
    prepareCrossRun: ReturnType<typeof vi.fn>;
    compareCrossRuns: ReturnType<typeof vi.fn>;
  };
}

describe("case behavioral diff service", () => {
  it("does not prepare or compare an incompatible pair", () => {
    const prepare = vi.fn();
    const compare = vi.fn();
    const result = compareCaseBehavioralDiff(
      run("left", 0),
      run("right", 0),
      { prepareCrossRun: prepare, compareCrossRuns: compare }
    );

    expect(result.compatibility).toEqual({ status: "same_case" });
    expect(result.leftCaseIndex).toBe(0);
    expect(result.rightCaseIndex).toBe(0);
    expect(result.diff).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
  });

  it("prepares compatible Cases and returns the existing first divergence unchanged", () => {
    const leftPrepared = prepared();
    const rightPrepared = prepared();
    const existingDiff = diff({
      firstDivergence: {
        kind: "decision_truth_changed",
        alignmentConfidence: "strong",
        baseline: { frameKey: "solve", step: 3, factualText: "false" },
        current: { frameKey: "solve", step: 4, factualText: "true" }
      }
    });
    const prepare = vi.fn()
      .mockReturnValueOnce(leftPrepared)
      .mockReturnValueOnce(rightPrepared);
    const compare = vi.fn().mockReturnValue(existingDiff);

    const result = compareCaseBehavioralDiff(
      run("left", 0),
      run("right", 2),
      { prepareCrossRun: prepare, compareCrossRuns: compare }
    );

    expect(result.compatibility).toEqual({ status: "compatible" });
    expect(result.leftCaseIndex).toBe(0);
    expect(result.rightCaseIndex).toBe(2);
    expect(result.diff).toBe(existingDiff);
    expect(prepare).toHaveBeenNthCalledWith(1, expect.objectContaining({ sessionId: "left" }));
    expect(prepare).toHaveBeenNthCalledWith(2, expect.objectContaining({ sessionId: "right" }));
    expect(compare).toHaveBeenCalledWith(leftPrepared, rightPrepared, { status: "compatible" });
  });

  it("preserves no-divergence, coverage, and stop-reason results from the engine", () => {
    const existingDiff = diff({
      coverage: {
        callFrames: "complete",
        decisions: "partial",
        expressions: "complete",
        controlFlow: "complete",
        mutations: { status: "complete", skippedUnstableObjectMutations: 1 },
        values: { incomparableCount: 2 }
      },
      stopReason: "ambiguous_alignment"
    });
    const deps = dependencies({
      compareCrossRuns: vi.fn(() => existingDiff)
    });

    const result = compareCaseBehavioralDiff(
      run("left", 0),
      run("right", 1),
      deps
    );

    expect(result.diff).toBe(existingDiff);
    expect(result.diff?.firstDivergence).toBeUndefined();
    expect(result.diff?.coverage.decisions).toBe("partial");
    expect(result.diff?.stopReason).toBe("ambiguous_alignment");
  });
});
