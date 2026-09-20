import { describe, expect, it } from "vitest";

import {
  compareCrossRuns,
  type CrossRunDiffResult
} from "../../src/core/cross-run-diff";
import type {
  BehavioralCheckpoint,
  ChildCallCheckpoint,
  CrossRunFrameProjection,
  DecisionCheckpoint,
  ExpressionCheckpoint,
  MutationCheckpoint
} from "../../src/core/cross-run-checkpoints";
import type {
  CrossRunCoverage,
  PreparedCrossRun
} from "../../src/core/cross-run-diff-types";
import type { AlignmentConfidence } from "../../src/core/cross-run-alignment";
import type { TraceInterpretation } from "../../src/core/trace-interpreter";
import {
  DEFAULT_EXECUTION_LIMITS,
  type TerminationReason
} from "../../src/shared/execution-types";
import type {
  CallFrameModel,
  FrameOccurrence
} from "../../src/shared/call-frame-types";
import type { TraceSession, ValueSnapshot } from "../../src/shared/trace-types";
import type { ComparisonCompatibility } from "../../src/sidepanel/run-comparison-state";
import { buildBehavioralDiffViewModel } from "../../src/sidepanel/behavioral-diff-view";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const reference = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "TreeNode"
});

const compatible: ComparisonCompatibility = { status: "compatible" };

function coverage(overrides: Partial<CrossRunCoverage> = {}): CrossRunCoverage {
  return {
    callFrames: overrides.callFrames ?? "complete",
    decisions: overrides.decisions ?? "complete",
    expressions: overrides.expressions ?? "complete",
    controlFlow: overrides.controlFlow ?? "complete",
    mutations: {
      status: "complete",
      skippedUnstableObjectMutations: 0,
      ...(overrides.mutations ?? {})
    },
    values: {
      incomparableCount: 0,
      ...(overrides.values ?? {})
    }
  };
}

function session(
  sessionId: string,
  options: {
    sourceCode?: string;
    rawTestcase?: string;
    status?: TraceSession["status"];
    terminationReason?: TerminationReason;
    steps?: number[];
  } = {}
): TraceSession {
  const status = options.status ?? "completed";
  const terminationReason = options.terminationReason ?? (
    status === "timeout" ? "hard_timeout" : "normal_return"
  );
  return {
    schemaVersion: 6,
    sessionId,
    sourceCode: options.sourceCode ?? "class Solution:\n    def solve(self, node):\n        return node\n",
    rawTestcase: options.rawTestcase ?? "[1]",
    entrypoint: {
      className: "Solution",
      methodName: "solve",
      parameterCount: 1,
      parameterKinds: ["binary_tree"]
    },
    executionEnvironment: { runtime: "pyodide", pythonVersion: "3.13" },
    status,
    terminationReason,
    events: (options.steps ?? []).map((step) => ({
      step,
      event: "line" as const,
      frameId: 1,
      parentFrameId: null,
      function: "solve",
      line: 3,
      callDepth: 1,
      locals: {},
      stdoutDelta: ""
    })),
    stdout: "",
    limits: DEFAULT_EXECUTION_LIMITS
  };
}

function frame(
  frameId: number,
  functionKey: string,
  checkpoints: BehavioralCheckpoint[],
  options: {
    displayName?: string;
    confidence?: Exclude<AlignmentConfidence, "ambiguous">;
    childFrameIds?: number[];
    callStep?: number;
    arguments?: FrameOccurrence["arguments"];
    exit?: FrameOccurrence["exit"];
  } = {}
): CrossRunFrameProjection {
  const displayName = options.displayName ?? functionKey.split(":").at(-1) ?? functionKey;
  const functionIdentity = {
    key: functionKey,
    displayName,
    confidence: options.confidence ?? "strong"
  } as const;
  const callStep = options.callStep ?? 1;
  const exit = options.exit ?? { status: "returned" as const, step: callStep + 10, value: int(0) };
  return {
    frameId,
    functionIdentity,
    entry: {
      kind: "frame_entry",
      frameId,
      semanticKey: `frame-entry|${functionKey}`,
      runLocalAnchorStep: callStep,
      localSequence: 0,
      functionIdentity,
      arguments: options.arguments ?? []
    },
    checkpoints,
    childFrameIds: options.childFrameIds ?? [],
    exit: {
      kind: "frame_exit",
      frameId,
      semanticKey: "frame-exit",
      runLocalAnchorStep: exit.status === "returned" || exit.status === "exception" || exit.status === "trace_ended"
        ? exit.step
        : undefined,
      localSequence: Number.MAX_SAFE_INTEGER,
      exit
    }
  };
}

function callFrameModel(frames: CrossRunFrameProjection[], roots: number[]): CallFrameModel {
  const parentByChild = new Map<number, number>();
  for (const item of frames) {
    for (const childFrameId of item.childFrameIds) parentByChild.set(childFrameId, item.frameId);
  }
  const occurrences: Array<[number, FrameOccurrence]> = frames.map((item) => [item.frameId, {
    frameId: item.frameId,
    functionName: item.functionIdentity.displayName,
    parentFrameId: parentByChild.get(item.frameId) ?? null,
    depth: parentByChild.has(item.frameId) ? 2 : 1,
    callStep: item.entry.runLocalAnchorStep,
    arguments: item.entry.arguments,
    childFrameIds: [...item.childFrameIds],
    recursion: { isRecursive: false, recursionDepth: 1 },
    exit: item.exit.exit
  }]);
  return {
    roots,
    byFrameId: new Map(occurrences),
    tracingState: { status: "complete" }
  };
}

function prepared(
  frames: CrossRunFrameProjection[],
  options: {
    sessionId?: string;
    roots?: number[];
    session?: Parameters<typeof session>[1];
    coverage?: Partial<CrossRunCoverage>;
  } = {}
): PreparedCrossRun {
  const roots = options.roots ?? [frames[0]?.frameId ?? 1];
  const callFrames = callFrameModel(frames, roots);
  return {
    session: session(options.sessionId ?? "run", options.session),
    interpretation: { callFrames } as TraceInterpretation,
    frames: new Map(frames.map((item) => [item.frameId, item])),
    roots,
    coverage: coverage(options.coverage)
  };
}

function decision(
  frameId: number,
  step: number,
  truth: boolean,
  semanticKey = "decision|if|pointer comparison|1"
): DecisionCheckpoint {
  return {
    kind: "decision",
    frameId,
    semanticKey,
    runLocalAnchorStep: step,
    localSequence: step,
    siteKind: "if",
    source: "pointer comparison",
    occurrenceOrdinal: 1,
    status: "completed",
    truth,
    operands: []
  };
}

function mutation(
  frameId: number,
  step: number,
  targetKey: string,
  after: ValueSnapshot,
  semanticKey = `mutation|${targetKey}|1`
): MutationCheckpoint {
  return {
    kind: "mutation",
    frameId,
    semanticKey,
    runLocalAnchorStep: step,
    localSequence: step,
    mutationKind: "variable",
    targetKey,
    action: "changed",
    after
  };
}

function childCall(
  frameId: number,
  step: number,
  childFrameId: number,
  functionKey: string,
  occurrenceOrdinal = 1
): ChildCallCheckpoint {
  const displayName = functionKey.split(":").at(-1) ?? functionKey;
  return {
    kind: "child_call",
    frameId,
    semanticKey: `child-call|${functionKey}|${occurrenceOrdinal}`,
    runLocalAnchorStep: step,
    localSequence: step,
    callee: { key: functionKey, displayName, confidence: "strong" },
    childFrameId,
    occurrenceOrdinal
  };
}

function expression(
  frameId: number,
  step: number,
  source: string,
  result: ValueSnapshot,
  semanticKey = `expression|return|${source}|1`
): ExpressionCheckpoint {
  return {
    kind: "expression",
    frameId,
    semanticKey,
    runLocalAnchorStep: step,
    localSequence: step,
    rootKind: "return",
    source,
    occurrenceOrdinal: 1,
    status: "completed",
    result,
    selections: [],
    rootId: semanticKey
  };
}

function firstKind(result: CrossRunDiffResult): string | undefined {
  return result.firstDivergence?.kind;
}

describe("cross-run behavioral acceptance scenarios", () => {
  it("reports an opposite-pointer mutation before the later return", () => {
    const baseline = prepared([
      frame(1, "method:Solution.search", [
        decision(1, 2, false),
        mutation(1, 3, "variable:left", int(4)),
      ], { displayName: "search", exit: { status: "returned", step: 9, value: int(0) } })
    ]);
    const current = prepared([
      frame(11, "method:Solution.search", [
        decision(11, 20, false),
        mutation(11, 30, "variable:right", int(4)),
      ], { displayName: "search", exit: { status: "returned", step: 90, value: int(0) } })
    ], { sessionId: "current" });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(firstKind(result)).toBe("mutation_presence_changed");
    expect(result.firstDivergence?.current?.factualText).toContain("variable:right");
    expect(result.firstDivergence?.current?.factualText).not.toContain("returned");
  });

  it("reports decision truth changes with a navigable current raw anchor", () => {
    const baseline = prepared([
      frame(1, "method:Solution.search", [decision(1, 2, false)])
    ]);
    const current = prepared([
      frame(11, "method:Solution.search", [decision(11, 42, true)])
    ], { sessionId: "current", session: { steps: [42] } });

    const result = compareCrossRuns(baseline, current, compatible);
    const view = buildBehavioralDiffViewModel(baseline, current, result);

    expect(firstKind(result)).toBe("decision_truth_changed");
    expect(view.divergence?.currentStep).toBe(42);
  });

  it("aligns recursive TreeNode frames across shifted sources without treating object IDs as arguments", () => {
    const functionKey = "method:Solution.maxDepth";
    const baseline = prepared([
      frame(1, functionKey, [childCall(1, 3, 2, functionKey)], {
        displayName: "maxDepth",
        childFrameIds: [2],
        arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("baseline-root") }]
      }),
      frame(2, functionKey, [
        expression(2, 4, "node.left", int(1)),
      ], {
        displayName: "maxDepth",
        callStep: 3,
        arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("baseline-left") }],
        exit: { status: "returned", step: 6, value: int(1) }
      })
    ], { sessionId: "baseline", session: { sourceCode: "class Solution:\n    def maxDepth(self, node):\n        return 1\n" } });
    const current = prepared([
      frame(11, functionKey, [childCall(11, 30, 12, functionKey)], {
        displayName: "maxDepth",
        childFrameIds: [12],
        arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("current-root") }]
      }),
      frame(12, functionKey, [
        expression(12, 40, "node.value", int(1)),
      ], {
        displayName: "maxDepth",
        callStep: 30,
        arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("current-left") }],
        exit: { status: "returned", step: 60, value: int(1) }
      })
    ], { sessionId: "current", session: { sourceCode: "class Solution:\n\n    def maxDepth(self, node):\n        return 1\n" } });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(result.alignedPrefix.callPath).toEqual(["maxDepth", "maxDepth"]);
    expect(firstKind(result)).toBe("expression_structure_changed");
    expect(firstKind(result)).not.toBe("frame_argument_changed");

    const returnOnlyCurrent = prepared([
      frame(11, functionKey, [childCall(11, 30, 12, functionKey)], {
        displayName: "maxDepth",
        childFrameIds: [12],
        arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("current-root") }]
      }),
      frame(12, functionKey, [], {
        displayName: "maxDepth",
        callStep: 30,
        arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("current-left") }],
        exit: { status: "returned", step: 60, value: int(2) }
      })
    ], { sessionId: "current-return" });
    const returnOnlyBaseline = prepared([
      frame(1, functionKey, [childCall(1, 3, 2, functionKey)], {
        displayName: "maxDepth",
        childFrameIds: [2],
        arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("baseline-root") }]
      }),
      frame(2, functionKey, [], {
        displayName: "maxDepth",
        callStep: 3,
        arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("baseline-left") }],
        exit: { status: "returned", step: 6, value: int(1) }
      })
    ], { sessionId: "baseline-return" });
    const returnOnly = compareCrossRuns(returnOnlyBaseline, returnOnlyCurrent, compatible);
    expect(firstKind(returnOnly)).toBe("return_value_changed");
  });

  it("reports an additional recursive child call as observed evidence", () => {
    const functionKey = "method:Solution.maxDepth";
    const baseline = prepared([
      frame(1, functionKey, [childCall(1, 2, 2, functionKey)], {
        displayName: "maxDepth",
        childFrameIds: [2]
      }),
      frame(2, functionKey, [], { displayName: "maxDepth", callStep: 2 })
    ]);
    const current = prepared([
      frame(11, functionKey, [
        childCall(11, 20, 12, functionKey, 1),
        childCall(11, 40, 13, functionKey, 2)
      ], {
        displayName: "maxDepth",
        childFrameIds: [12, 13]
      }),
      frame(12, functionKey, [], { displayName: "maxDepth", callStep: 20 }),
      frame(13, functionKey, [], { displayName: "maxDepth", callStep: 40 })
    ], { sessionId: "current" });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(firstKind(result)).toBe("child_call_extra");
    expect(buildBehavioralDiffViewModel(baseline, current, result).summary)
      .toContain("Additional child call observed");
    expect(buildBehavioralDiffViewModel(baseline, current, result).summary)
      .not.toMatch(/missing base case|infinite recursion/i);
  });

  it("keeps an equivalent refactor neutral while exposing the source difference", () => {
    const baseline = prepared([
      frame(1, "method:Solution.solve", [decision(1, 2, true)])
    ], { session: { sourceCode: "def solve(value):\n    return value\n" } });
    const current = prepared([
      frame(11, "method:Solution.solve", [decision(11, 20, true)])
    ], {
      sessionId: "current",
      session: { sourceCode: "def solve(value):\n\n    result = value\n    return result\n" }
    });

    const result = compareCrossRuns(baseline, current, compatible);
    const view = buildBehavioralDiffViewModel(baseline, current, result);

    expect(result.firstDivergence).toBeUndefined();
    expect(view.sourceDiffers).toBe(true);
    expect(view.summary).toBe("No behavioral divergence observed in comparable captured evidence.");
  });

  it("does not align checkpoints for a different testcase", () => {
    const baseline = prepared([frame(1, "method:Solution.solve", [decision(1, 2, false)])], {
      session: { rawTestcase: "1" }
    });
    const current = prepared([frame(11, "method:Solution.solve", [decision(11, 20, true)])], {
      sessionId: "current",
      session: { rawTestcase: "2" }
    });

    const result = compareCrossRuns(baseline, current, { status: "different_testcase" });

    expect(result.firstDivergence).toBeUndefined();
    expect(result.alignedPrefix).toEqual({ frameCount: 0, checkpointCount: 0, callPath: [] });
  });

  it("keeps timeout output factual instead of inferring TLE or infinite recursion", () => {
    const baseline = prepared([
      frame(1, "method:Solution.solve", [], {
        exit: { status: "returned", step: 8, value: int(1) }
      })
    ]);
    const current = prepared([
      frame(11, "method:Solution.solve", [], {
        exit: { status: "trace_ended", reason: "hard_timeout", step: 80 }
      })
    ], {
      sessionId: "timeout",
      session: { status: "timeout", terminationReason: "hard_timeout", steps: [80] }
    });

    const result = compareCrossRuns(baseline, current, compatible);
    const view = buildBehavioralDiffViewModel(baseline, current, result);

    expect(firstKind(result)).toBe("frame_exit_status_changed");
    expect(view.summary).toContain("Frame outcome changed");
    expect(view.summary).not.toMatch(/TLE|infinite recursion/i);
    expect(view.divergence?.current?.factualText).toContain("frame trace_ended");
  });

  it("keeps a known decision divergence when later evidence is partial", () => {
    const baseline = prepared([
      frame(1, "method:Solution.solve", [decision(1, 2, false)])
    ]);
    const current = prepared([
      frame(11, "method:Solution.solve", [decision(11, 20, true)])
    ], {
      sessionId: "partial",
      coverage: { expressions: "partial" }
    });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(firstKind(result)).toBe("decision_truth_changed");
    expect(result.coverage.expressions).toBe("partial");
  });

  it("stops on ambiguous fallback roots without choosing an arbitrary pairing", () => {
    const baseline = prepared([
      frame(1, "fallback:helper", [], { displayName: "helper", confidence: "fallback" }),
      frame(2, "fallback:helper", [], { displayName: "helper", confidence: "fallback" })
    ], { roots: [1, 2] });
    const current = prepared([
      frame(11, "fallback:helper", [], { displayName: "helper", confidence: "fallback" }),
      frame(12, "fallback:helper", [], { displayName: "helper", confidence: "fallback" })
    ], { sessionId: "current", roots: [11, 12] });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(result.firstDivergence).toBeUndefined();
    expect(result.stopReason).toBe("ambiguous_alignment");
    expect(result.alignedPrefix.frameCount).toBe(0);
  });
});
