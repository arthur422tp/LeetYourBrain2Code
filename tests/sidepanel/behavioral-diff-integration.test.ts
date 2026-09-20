import { describe, expect, it, vi } from "vitest";

import {
  compareCrossRuns,
  type CrossRunDiffResult
} from "../../src/core/cross-run-diff";
import type { CrossRunCoverage } from "../../src/core/cross-run-diff-types";
import type { TraceInterpretation } from "../../src/core/trace-interpreter";
import { DEFAULT_EXECUTION_LIMITS } from "../../src/shared/execution-types";
import type { TraceSession } from "../../src/shared/trace-types";
import {
  buildBehavioralDiffViewModel,
  type BehavioralDiffViewModel
} from "../../src/sidepanel/behavioral-diff-view";
import { createBehavioralDiff } from "../../src/sidepanel/components/BehavioralDiff";
import { createBaselineControls } from "../../src/sidepanel/components/BaselineControls";
import { createTraceVisualizer } from "../../src/sidepanel/components/TraceVisualizer";
import {
  compareRunCompatibility,
  createRunComparisonState,
  type RunRecord
} from "../../src/sidepanel/run-comparison-state";

const completeCoverage: CrossRunCoverage = {
  callFrames: "complete",
  decisions: "complete",
  expressions: "complete",
  controlFlow: "complete",
  mutations: { status: "complete", skippedUnstableObjectMutations: 0 },
  values: { incomparableCount: 0 }
};

function session(
  id: string,
  options: { sourceCode?: string; rawTestcase?: string } = {}
): TraceSession {
  return {
    schemaVersion: 6,
    sessionId: id,
    sourceCode: options.sourceCode ?? "class Solution:\n    def solve(self, value):\n        return value\n",
    rawTestcase: options.rawTestcase ?? "1",
    entrypoint: {
      className: "Solution",
      methodName: "solve",
      parameterCount: 1,
      parameterKinds: ["value"]
    },
    executionEnvironment: { runtime: "pyodide", pythonVersion: "3.13" },
    status: "completed",
    terminationReason: "normal_return",
    events: [
      {
        step: 1,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "solve",
        line: 2,
        callDepth: 1,
        locals: {},
        stdoutDelta: ""
      },
      {
        step: 2,
        event: "line",
        frameId: 1,
        parentFrameId: null,
        function: "solve",
        line: 3,
        callDepth: 1,
        locals: {},
        stdoutDelta: ""
      }
    ],
    stdout: "",
    limits: DEFAULT_EXECUTION_LIMITS
  };
}

function prepared(trace: TraceSession) {
  const callFrames = {
    roots: [],
    byFrameId: new Map(),
    tracingState: { status: "complete" as const }
  };
  return {
    session: trace,
    interpretation: { callFrames } as unknown as TraceInterpretation,
    frames: new Map(),
    roots: [],
    coverage: completeCoverage
  };
}

function runRecord(trace: TraceSession, caseIndex = 0): RunRecord {
  return {
    session: trace,
    context: {
      problemSlug: "same-problem",
      problemTitle: "Same Problem",
      selectedCaseIndex: caseIndex,
      language: "python"
    }
  };
}

function divergentModel(currentStep = 2): BehavioralDiffViewModel {
  const result: CrossRunDiffResult = {
    compatibility: { status: "compatible" },
    alignedPrefix: { frameCount: 1, checkpointCount: 1, callPath: ["solve"] },
    firstDivergence: {
      kind: "decision_truth_changed",
      alignmentConfidence: "strong",
      baseline: { frameKey: "solve", step: 1, factualText: "false" },
      current: { frameKey: "solve", step: currentStep, factualText: "true" }
    },
    coverage: completeCoverage
  };
  return buildBehavioralDiffViewModel(
    prepared(session("baseline")),
    prepared(session("current")),
    result,
    { baselineLabel: "Baseline · Case 1", currentLabel: "Current · Case 1" }
  );
}

describe("behavioral diff Side Panel integration", () => {
  it("renders factual baseline/current evidence and navigates the current raw cursor", () => {
    const model = divergentModel();
    const onInspectCurrent = vi.fn();
    const handle = createBehavioralDiff({ model, onInspectCurrent });

    expect(handle.element.querySelector("h3")?.textContent).toBe("Baseline · Case 1");
    expect(handle.element.textContent).toContain("Current · Case 1");
    expect(handle.element.textContent).toContain("Decision result changed");
    expect(handle.element.querySelector("#behavioral-diff-inspect-current")).not.toBeNull();
    handle.element.querySelector<HTMLButtonElement>("#behavioral-diff-inspect-current")?.click();
    expect(onInspectCurrent).toHaveBeenCalledWith(2);
    expect(handle.element.querySelectorAll("button").length).toBe(1);
    handle.dispose();
  });

  it("keeps the diff panel disclosure and semantics while the model refreshes", () => {
    const handle = createTraceVisualizer(session("current"), { comparison: divergentModel() });
    const panel = handle.element.querySelector<HTMLDetailsElement>(
      ".trace-viewer__behavioral-diff-panel"
    )!;
    panel.open = true;
    const title = panel.querySelector(".trace-viewer__panel-title")!;

    handle.setBehavioralDiff({
      ...divergentModel(),
      summary: "No behavioral divergence observed in comparable captured evidence.",
      divergence: undefined
    });

    expect(handle.element.querySelector<HTMLDetailsElement>(
      ".trace-viewer__behavioral-diff-panel"
    )).toBe(panel);
    expect(panel.open).toBe(true);
    expect(title.textContent).toContain("no divergence observed");
    expect(panel.querySelector("h2")?.textContent).toBe("Behavioral Diff");
    handle.dispose();
  });

  it("shows source-only refactors as neutral captured evidence", () => {
    const baseline = prepared(session("baseline", {
      sourceCode: "class Solution:\n    def solve(self, value):\n        return value\n"
    }));
    const current = prepared(session("current", {
      sourceCode: "class Solution:\n    def solve(self, value):\n        result = value\n        return result\n"
    }));
    const result = compareCrossRuns(baseline, current, { status: "compatible" });
    const model = buildBehavioralDiffViewModel(baseline, current, result);
    const handle = createBehavioralDiff({ model, onInspectCurrent: vi.fn() });

    expect(model.sourceDiffers).toBe(true);
    expect(model.summary).toBe("No behavioral divergence observed in comparable captured evidence.");
    expect(handle.element.textContent).toContain("Source differs from baseline.");
    expect(handle.element.textContent).not.toMatch(/correct|wrong|bug|root cause/i);
    handle.dispose();
  });

  it("keeps incompatible testcase comparisons factual and performs no alignment", () => {
    const baselineTrace = session("baseline", { rawTestcase: "1" });
    const currentTrace = session("current", { rawTestcase: "2" });
    const baseline = runRecord(baselineTrace, 0);
    const current = runRecord(currentTrace, 1);
    const compatibility = compareRunCompatibility(baseline, current);
    const baselinePrepared = prepared(baselineTrace);
    const currentPrepared = prepared(currentTrace);
    const result = compareCrossRuns(baselinePrepared, currentPrepared, compatibility);
    const model = buildBehavioralDiffViewModel(baselinePrepared, currentPrepared, result);

    expect(compatibility).toEqual({ status: "different_testcase" });
    expect(result.alignedPrefix).toEqual({ frameCount: 0, checkpointCount: 0, callPath: [] });
    expect(model.summary).toBe("The current testcase differs from the pinned baseline.");
    expect(model.divergence).toBeUndefined();
  });

  it("uses real buttons, semantic headings, and text evidence for accessibility", () => {
    const controls = createBaselineControls({
      model: {
        hasCurrent: true,
        hasBaseline: true,
        caseLabel: "Case 1",
        baselineStatus: "completed",
        sourceDiffers: true
      },
      onPin: vi.fn(),
      onReplace: vi.fn(),
      onClear: vi.fn()
    });
    for (const id of ["baseline-pin", "baseline-replace", "baseline-clear"]) {
      expect(controls.element.querySelector<HTMLButtonElement>(`#${id}`)?.type).toBe("button");
    }

    const diff = createBehavioralDiff({
      model: {
        ...divergentModel(),
        summary: "Comparison stopped because the next evidence could not be aligned safely.",
        coverageMessage: "Decision evidence is partial.",
        divergence: undefined
      },
      onInspectCurrent: vi.fn()
    });
    expect(diff.element.querySelector("h2")?.textContent).toBe("Behavioral Diff");
    expect(diff.element.querySelectorAll("h3").length).toBeGreaterThanOrEqual(2);
    expect(diff.element.textContent).toContain("Decision evidence is partial.");
    expect(diff.element.className).not.toMatch(/green|red/);
    controls.dispose();
    diff.dispose();
  });

  it("releases replaced, cleared, and problem-switched baseline references", () => {
    const state = createRunComparisonState();
    const first = runRecord(session("first"));
    const second = runRecord(session("second"));

    state.setCurrent(first);
    expect(state.pinCurrent()).toBe(true);
    expect(state.get().baseline).toBe(first);
    state.setCurrent(second);
    expect(state.replaceBaseline()).toBe(true);
    expect(state.get().baseline).toBe(second);
    expect(state.get().baseline).not.toBe(first);

    state.clearBaseline();
    expect(state.get().baseline).toBeNull();
    state.setCurrent(first);
    state.clearForProblemChange();
    expect(state.get()).toEqual({ baseline: null, current: null });
  });
});
