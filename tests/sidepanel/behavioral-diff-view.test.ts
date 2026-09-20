import { describe, expect, it } from "vitest";

import {
  buildBehavioralDiffViewModel
} from "../../src/sidepanel/behavioral-diff-view";
import type { CrossRunDiffResult } from "../../src/core/cross-run-diff";
import type { PreparedCrossRun } from "../../src/core/cross-run-diff-types";
import type { TraceSession } from "../../src/shared/trace-types";

function session(id: string, rawTestcase = "1", sourceCode = "source"): TraceSession {
  return {
    schemaVersion: 6,
    sessionId: id,
    sourceCode,
    rawTestcase,
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
      step: 21,
      event: "line",
      frameId: 1,
      parentFrameId: null,
      function: "solve",
      line: 4,
      callDepth: 1,
      locals: {},
      stdoutDelta: ""
    }],
    stdout: "",
    limits: {
      maxTraceSteps: 10,
      maxContainerItems: 10,
      maxNestingDepth: 4,
      maxSnapshotBytes: 1000,
      maxSessionBytes: 1000,
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
    }
  };
}

function prepared(id: string, sourceCode = "source"): PreparedCrossRun {
  return {
    session: session(id, "1", sourceCode),
    interpretation: {} as PreparedCrossRun["interpretation"],
    frames: new Map(),
    roots: [],
    coverage: {
      callFrames: "complete",
      decisions: "complete",
      expressions: "complete",
      controlFlow: "complete",
      mutations: { status: "complete", skippedUnstableObjectMutations: 0 },
      values: { incomparableCount: 0 }
    }
  };
}

function result(overrides: Partial<CrossRunDiffResult> = {}): CrossRunDiffResult {
  return {
    compatibility: { status: "compatible" },
    alignedPrefix: { frameCount: 3, checkpointCount: 8, callPath: ["solve", "search"] },
    coverage: prepared("coverage").coverage,
    ...overrides
  };
}

describe("buildBehavioralDiffViewModel", () => {
  it("maps a factual divergence into neutral labels and an inspectable current step", () => {
    const view = buildBehavioralDiffViewModel(
      prepared("baseline"),
      prepared("current", "refactored source"),
      result({
        firstDivergence: {
          kind: "decision_truth_changed",
          baseline: {
            frameKey: "fallback:search",
            runLocalFrameId: 2,
            step: 18,
            source: "value < target",
            factualText: "decision truth = false"
          },
          current: {
            frameKey: "fallback:search",
            runLocalFrameId: 12,
            step: 21,
            source: "value < target",
            factualText: "decision truth = true"
          },
          alignmentConfidence: "fallback"
        }
      })
    );

    expect(view.summary).toBe("First observed divergence: Decision result changed");
    expect(view.sourceDiffers).toBe(true);
    expect(view.matchedPrefix).toEqual({ frames: 3, checkpoints: 8, callPath: ["solve", "search"] });
    expect(view.divergence).toMatchObject({
      categoryLabel: "Decision result changed",
      currentStep: 21,
      confidence: "fallback"
    });
    expect(view.divergence?.baseline?.factualText).toContain("false");
    expect(view.divergence?.current?.factualText).toContain("true");
    expect(JSON.stringify(view).toLowerCase()).not.toMatch(/\bwrong\b|\bcorrect\b|\broot cause\b|\bfix\b|\bexpected\b/);
  });

  it.each([
    ["no_baseline", "No baseline pinned."],
    ["no_current", "Current run is not available yet."],
    ["different_testcase", "The current testcase differs from the pinned baseline."],
    ["different_problem", "Baseline is for a different problem."],
    ["different_entrypoint", "Baseline uses a different entrypoint."],
    ["unsupported_schema", "Baseline comparison is unavailable for this trace schema."]
  ] as const)("maps compatibility %s", (status, summary) => {
    const compatibility = { status } as CrossRunDiffResult["compatibility"];
    const view = buildBehavioralDiffViewModel(
      status === "no_baseline" ? null : prepared("baseline"),
      status === "no_current" ? null : prepared("current"),
      result({ compatibility })
    );

    expect(view.summary).toBe(summary);
  });

  it("uses the coverage-ended copy when no divergence is supported past the captured prefix", () => {
    const view = buildBehavioralDiffViewModel(
      prepared("baseline"),
      prepared("current"),
      result({ stopReason: "coverage_ended" })
    );

    expect(view.summary).toBe("No divergence observed before comparison coverage ended.");
    expect(view.coverageMessage).toContain("coverage ended");
  });
});
