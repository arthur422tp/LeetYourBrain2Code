import { describe, expect, it } from "vitest";

import {
  compareCrossRuns,
  CROSS_RUN_ALIGNMENT_LOOKAHEAD,
  type CrossRunDivergenceKind
} from "../../src/core/cross-run-diff";
import type {
  CrossRunFrameProjection,
  BehavioralCheckpoint,
  ChildCallCheckpoint,
  DecisionCheckpoint,
  ExpressionCheckpoint,
  LoopExitCheckpoint,
  LoopIterationCheckpoint,
  MutationCheckpoint,
  TransferCheckpoint
} from "../../src/core/cross-run-checkpoints";
import type {
  CrossRunCoverage,
  PreparedCrossRun
} from "../../src/core/cross-run-diff-types";
import type { TraceInterpretation } from "../../src/core/trace-interpreter";
import { DEFAULT_EXECUTION_LIMITS } from "../../src/shared/execution-types";
import type {
  CallFrameModel,
  FrameOccurrence
} from "../../src/shared/call-frame-types";
import type { TraceSession, ValueSnapshot } from "../../src/shared/trace-types";
import type { ComparisonCompatibility } from "../../src/sidepanel/run-comparison-state";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const reference = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "TreeNode"
});

const completeCoverage = (): CrossRunCoverage => ({
  callFrames: "complete",
  decisions: "complete",
  expressions: "complete",
  controlFlow: "complete",
  mutations: {
    status: "complete",
    skippedUnstableObjectMutations: 0
  },
  values: { incomparableCount: 0 }
});

function traceSession(
  sessionId: string,
  status: TraceSession["status"] = "completed",
  terminationReason: TraceSession["terminationReason"] = status === "completed"
    ? "normal_return"
    : status === "timeout"
      ? "hard_timeout"
      : "runtime_exception"
): TraceSession {
  return {
    schemaVersion: 6,
    sessionId,
    sourceCode: "class Solution:\n    def solve(self, value):\n        return value\n",
    rawTestcase: "1",
    entrypoint: {
      className: "Solution",
      methodName: "solve",
      parameterCount: 1,
      parameterKinds: ["value"]
    },
    executionEnvironment: { runtime: "pyodide", pythonVersion: "3.13" },
    status,
    terminationReason,
    events: [],
    stdout: "",
    limits: DEFAULT_EXECUTION_LIMITS
  };
}

function decision(
  frameId: number,
  semanticKey: string,
  step: number,
  truth: boolean,
  source = "value < target"
): DecisionCheckpoint {
  return {
    kind: "decision",
    frameId,
    semanticKey,
    runLocalAnchorStep: step,
    localSequence: step,
    siteKind: "if",
    source,
    occurrenceOrdinal: 1,
    status: "completed",
    truth,
    operands: []
  };
}

function mutation(
  frameId: number,
  semanticKey: string,
  step: number,
  after: ValueSnapshot,
  targetKey = "local:result"
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
  semanticKey: string,
  step: number,
  childFrameId: number,
  displayName = "helper",
  occurrenceOrdinal = 1
): ChildCallCheckpoint {
  return {
    kind: "child_call",
    frameId,
    semanticKey,
    runLocalAnchorStep: step,
    localSequence: step,
    callee: {
      key: `fallback:${displayName}`,
      displayName,
      confidence: "fallback"
    },
    childFrameId,
    occurrenceOrdinal
  };
}

function frame(
  frameId: number,
  displayName: string,
  checkpoints: BehavioralCheckpoint[],
  options: {
    childFrameIds?: number[];
    arguments?: Array<{ name: string; kind: "positional_or_keyword"; value: ValueSnapshot }>;
    exit?: FrameOccurrence["exit"];
    callStep?: number;
  } = {}
): CrossRunFrameProjection {
  const identity = {
    key: `fallback:${displayName}`,
    displayName,
    confidence: "fallback" as const
  };
  const callStep = options.callStep ?? 1;
  return {
    frameId,
    functionIdentity: identity,
    entry: {
      kind: "frame_entry",
      frameId,
      semanticKey: `frame-entry|${identity.key}`,
      runLocalAnchorStep: callStep,
      localSequence: 0,
      functionIdentity: identity,
      arguments: options.arguments ?? []
    },
    checkpoints,
    childFrameIds: options.childFrameIds ?? [],
    exit: {
      kind: "frame_exit",
      frameId,
      semanticKey: "frame-exit",
      runLocalAnchorStep: options.exit?.status === "returned"
        || options.exit?.status === "exception"
        ? options.exit.step
        : options.exit?.status === "trace_ended"
          ? options.exit.step
          : undefined,
      localSequence: Number.MAX_SAFE_INTEGER,
      exit: options.exit ?? { status: "returned", step: callStep + 10, value: int(0) }
    }
  };
}

function callFrameModel(frames: CrossRunFrameProjection[], roots: number[]): CallFrameModel {
  const parentByChild = new Map<number, number>();
  for (const item of frames) {
    for (const childFrameId of item.childFrameIds) parentByChild.set(childFrameId, item.frameId);
  }
  const byFrameId = new Map<number, FrameOccurrence>();
  for (const item of frames) {
    byFrameId.set(item.frameId, {
      frameId: item.frameId,
      functionName: item.functionIdentity.displayName,
      parentFrameId: parentByChild.get(item.frameId) ?? null,
      depth: parentByChild.has(item.frameId) ? 2 : 1,
      callStep: item.entry.runLocalAnchorStep,
      arguments: item.entry.arguments,
      childFrameIds: [...item.childFrameIds],
      recursion: { isRecursive: false, recursionDepth: 1 },
      exit: item.exit.exit
    });
  }
  return {
    roots,
    byFrameId,
    tracingState: { status: "complete" }
  };
}

function prepared(
  frames: CrossRunFrameProjection[],
  roots: number[] = [frames[0]?.frameId ?? 1],
  options: {
    sessionId?: string;
    status?: TraceSession["status"];
    terminationReason?: TraceSession["terminationReason"];
    coverage?: Partial<CrossRunCoverage>;
  } = {}
): PreparedCrossRun {
  const session = traceSession(options.sessionId ?? "run", options.status, options.terminationReason);
  const model = callFrameModel(frames, roots);
  const coverage = {
    ...completeCoverage(),
    ...options.coverage,
    mutations: {
      ...completeCoverage().mutations,
      ...(options.coverage?.mutations ?? {})
    },
    values: {
      ...completeCoverage().values,
      ...(options.coverage?.values ?? {})
    }
  };
  return {
    session,
    interpretation: { callFrames: model } as TraceInterpretation,
    frames: new Map(frames.map((item) => [item.frameId, item])),
    roots,
    coverage
  };
}

const compatible: ComparisonCompatibility = { status: "compatible" };

function kind(result: ReturnType<typeof compareCrossRuns>): CrossRunDivergenceKind | undefined {
  return result.firstDivergence?.kind;
}

type CoverageBoundaryCheckpointKind =
  | "decision"
  | "expression"
  | "loop_iteration"
  | "transfer"
  | "loop_exit"
  | "mutation";

function coverageBoundaryCheckpoint(
  kind: CoverageBoundaryCheckpointKind,
  frameId: number
): BehavioralCheckpoint {
  const base = {
    frameId,
    runLocalAnchorStep: 2,
    localSequence: 2
  };
  switch (kind) {
    case "decision":
      return {
        ...base,
        kind: "decision",
        semanticKey: "decision|if|value < target|1",
        siteKind: "if",
        source: "value < target",
        occurrenceOrdinal: 1,
        status: "completed",
        truth: false,
        operands: []
      } satisfies DecisionCheckpoint;
    case "expression":
      return {
        ...base,
        kind: "expression",
        semanticKey: "expression|return|value|1",
        rootKind: "return",
        source: "value",
        occurrenceOrdinal: 1,
        status: "completed",
        result: int(1),
        selections: [],
        rootId: "return-value"
      } satisfies ExpressionCheckpoint;
    case "loop_iteration":
      return {
        ...base,
        kind: "loop_iteration",
        semanticKey: "loop-iteration|for|for value in values|1",
        loopKind: "for",
        source: "for value in values",
        iteration: 1,
        status: "completed",
        bindings: [],
        terminalAnchorStep: 3
      } satisfies LoopIterationCheckpoint;
    case "transfer":
      return {
        ...base,
        kind: "transfer",
        semanticKey: "transfer|break|break|1",
        transferKind: "break",
        source: "break",
        status: "committed",
        actionId: "action-1",
        transferId: "transfer-1"
      } satisfies TransferCheckpoint;
    case "loop_exit":
      return {
        ...base,
        kind: "loop_exit",
        semanticKey: "loop-exit|for|for value in values|1",
        loopKind: "for",
        source: "for value in values",
        reason: "exhausted",
        occurrenceOrdinal: 1
      } satisfies LoopExitCheckpoint;
    case "mutation":
      return mutation(frameId, "mutation|local:result|1", 2, int(1));
  }
}

describe("compareCrossRuns", () => {
  it("exports the bounded lookahead and finds a later mutation difference after a matching decision", () => {
    expect(CROSS_RUN_ALIGNMENT_LOOKAHEAD).toBe(8);
    const baseline = prepared([
      frame(1, "solve", [
        decision(1, "decision|if|value < target|1", 2, false),
        mutation(1, "mutation|local:result|1", 3, int(1))
      ])
    ]);
    const current = prepared([
      frame(11, "solve", [
        decision(11, "decision|if|value < target|1", 20, false),
        mutation(11, "mutation|local:result|1", 30, int(2))
      ])
    ], [11], { sessionId: "current" });

    expect(kind(compareCrossRuns(baseline, current, compatible))).toBe("mutation_value_changed");
  });

  it("reports changed decision truth before later evidence", () => {
    const baseline = prepared([frame(1, "solve", [decision(1, "decision|if|value < target|1", 2, false)])]);
    const current = prepared([frame(11, "solve", [decision(11, "decision|if|value < target|1", 20, true)])], [11], { sessionId: "current" });

    expect(kind(compareCrossRuns(baseline, current, compatible))).toBe("decision_truth_changed");
  });

  it("recurses into a child before comparing a later parent mutation", () => {
    const baseline = prepared([
      frame(1, "solve", [
        childCall(1, "child-call|fallback:helper|1", 2, 2),
        mutation(1, "mutation|local:result|1", 8, int(1))
      ], { childFrameIds: [2] }),
      frame(2, "helper", [mutation(2, "mutation|local:result|1", 4, int(1))], { callStep: 2 })
    ]);
    const current = prepared([
      frame(11, "solve", [
        childCall(11, "child-call|fallback:helper|1", 20, 12),
        mutation(11, "mutation|local:result|1", 80, int(1))
      ], { childFrameIds: [12] }),
      frame(12, "helper", [mutation(12, "mutation|local:result|1", 40, int(2))], { callStep: 20 })
    ], [11], { sessionId: "current" });

    const result = compareCrossRuns(baseline, current, compatible);
    expect(kind(result)).toBe("mutation_value_changed");
    expect(result.firstDivergence?.baseline?.runLocalFrameId).toBe(2);
    expect(result.alignedPrefix.callPath).toEqual(["solve", "helper"]);
  });

  it("finds a recursive return difference at the child frame", () => {
    const baseline = prepared([
      frame(1, "solve", [childCall(1, "child-call|fallback:solve|1", 2, 2)], { childFrameIds: [2] }),
      frame(2, "solve", [], { callStep: 2, exit: { status: "returned", step: 3, value: int(1) } })
    ]);
    const current = prepared([
      frame(11, "solve", [childCall(11, "child-call|fallback:solve|1", 20, 12)], { childFrameIds: [12] }),
      frame(12, "solve", [], { callStep: 20, exit: { status: "returned", step: 30, value: int(2) } })
    ], [11], { sessionId: "current" });

    const result = compareCrossRuns(baseline, current, compatible);
    expect(kind(result)).toBe("return_value_changed");
    expect(result.firstDivergence?.baseline?.runLocalFrameId).toBe(2);
  });

  it("reports an extra child call before a later parent checkpoint", () => {
    const baseline = prepared([
      frame(1, "solve", [
        childCall(1, "child-call|fallback:helper|1", 2, 2),
        mutation(1, "mutation|local:result|1", 5, int(1))
      ], { childFrameIds: [2] }),
      frame(2, "helper", [], { callStep: 2 })
    ]);
    const current = prepared([
      frame(11, "solve", [
        childCall(11, "child-call|fallback:helper|1", 20, 12),
        childCall(11, "child-call|fallback:helper|2", 30, 13, "helper", 2),
        mutation(11, "mutation|local:result|1", 50, int(1))
      ], { childFrameIds: [12, 13] }),
      frame(12, "helper", [], { callStep: 20 }),
      frame(13, "helper", [], { callStep: 30 })
    ], [11], { sessionId: "current" });

    expect(kind(compareCrossRuns(baseline, current, compatible))).toBe("child_call_extra");
  });

  it("keeps a normalized source refactor aligned", () => {
    const baseline = prepared([frame(1, "solve", [decision(1, "decision|if|value < target|1", 2, false, "value < target")])]);
    const current = prepared([frame(11, "solve", [decision(11, "decision|if|value < target|1", 20, false, "value < target")])], [11], { sessionId: "current" });
    current.session.sourceCode = "class Solution:\n    # inserted line\n    def solve(self, value):\n        return value\n";

    const result = compareCrossRuns(baseline, current, compatible);
    expect(result.firstDivergence).toBeUndefined();
  });

  it("distinguishes timeout from a returned frame without diagnosing the cause", () => {
    const baseline = prepared([frame(1, "solve", [], { exit: { status: "returned", step: 4, value: int(1) } })]);
    const current = prepared([frame(11, "solve", [], { exit: { status: "trace_ended", reason: "hard_timeout" } })], [11], {
      sessionId: "current",
      status: "timeout",
      terminationReason: "hard_timeout"
    });

    const result = compareCrossRuns(baseline, current, compatible);
    expect(kind(result)).toBe("frame_exit_status_changed");
    expect(JSON.stringify(result)).not.toMatch(/infinite|wrong|bug/i);
  });

  it("does not treat run-local TreeNode reference IDs as a value difference", () => {
    const baseline = prepared([frame(1, "solve", [], {
      arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("obj-1") }]
    })]);
    const current = prepared([frame(11, "solve", [], {
      arguments: [{ name: "node", kind: "positional_or_keyword", value: reference("obj-99") }]
    })], [11], { sessionId: "current" });

    const result = compareCrossRuns(baseline, current, compatible);
    expect(result.firstDivergence).toBeUndefined();
    expect(result.coverage.values.incomparableCount).toBe(1);
  });

  it("uses session outcome as a secondary boundary after a comparable prefix", () => {
    const baseline = prepared([frame(1, "solve", [decision(1, "decision|if|value < target|1", 2, false)])]);
    const current = prepared([frame(11, "solve", [decision(11, "decision|if|value < target|1", 20, false)])], [11], {
      sessionId: "current",
      status: "exception",
      terminationReason: "runtime_exception"
    });
    const result = compareCrossRuns(baseline, current, compatible);
    expect(kind(result)).toBe("session_outcome_changed");
    expect(result.alignedPrefix.checkpointCount).toBe(1);
  });

  it("keeps an early decision divergence ahead of a later return difference", () => {
    const baseline = prepared([frame(1, "solve", [decision(1, "decision|if|value < target|1", 2, false)], {
      exit: { status: "returned", step: 10, value: int(1) }
    })]);
    const current = prepared([frame(11, "solve", [decision(11, "decision|if|value < target|1", 20, true)], {
      exit: { status: "returned", step: 100, value: int(999) }
    })], [11], { sessionId: "current" });

    expect(kind(compareCrossRuns(baseline, current, compatible))).toBe("decision_truth_changed");
  });

  it("stops at the coverage boundary when no earlier divergence is supported", () => {
    const baseline = prepared([frame(1, "solve", [decision(1, "decision|if|value < target|1", 2, false)])], [1], {
      coverage: { decisions: "partial" }
    });
    const current = prepared([frame(11, "solve", [decision(11, "decision|if|value < target|1", 20, false)])], [11], {
      sessionId: "current",
      coverage: { decisions: "partial" }
    });

    const result = compareCrossRuns(baseline, current, compatible);
    expect(result.firstDivergence).toBeUndefined();
    expect(result.stopReason).toBe("coverage_ended");
  });

  it.each([
    { kind: "decision" as const, coverage: { decisions: "partial" as const } },
    { kind: "expression" as const, coverage: { expressions: "partial" as const } },
    { kind: "loop_iteration" as const, coverage: { controlFlow: "partial" as const } },
    { kind: "transfer" as const, coverage: { controlFlow: "partial" as const } },
    { kind: "loop_exit" as const, coverage: { controlFlow: "partial" as const } },
    {
      kind: "mutation" as const,
      coverage: { mutations: { status: "partial" as const, skippedUnstableObjectMutations: 0 } }
    }
  ])("stops instead of reporting missing $kind evidence when its channel is incomplete", ({ kind: checkpointKind, coverage }) => {
    const baseline = prepared([
      frame(1, "solve", [coverageBoundaryCheckpoint(checkpointKind, 1)])
    ]);
    const current = prepared([frame(11, "solve", [])], [11], {
      sessionId: "current",
      coverage
    });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(result.firstDivergence).toBeUndefined();
    expect(result.stopReason).toBe("coverage_ended");
  });

  it("stops instead of reporting a missing child call when call-frame evidence is incomplete", () => {
    const baseline = prepared([
      frame(1, "solve", [childCall(1, "child-call|fallback:helper|1", 2, 2)], {
        childFrameIds: [2]
      }),
      frame(2, "helper", [], { callStep: 2 })
    ]);
    const current = prepared([frame(11, "solve", [])], [11], {
      sessionId: "current",
      coverage: { callFrames: "partial" }
    });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(result.firstDivergence).toBeUndefined();
    expect(result.stopReason).toBe("coverage_ended");
  });

  it("stops instead of treating a synthetic call-frame limit exit as a changed frame outcome", () => {
    const baseline = prepared([
      frame(1, "solve", [], { exit: { status: "returned", step: 4, value: int(3) } })
    ]);
    const current = prepared([
      frame(11, "solve", [], {
        exit: { status: "trace_ended", step: 4, reason: "call_frame_event_limit" }
      })
    ], [11], {
      sessionId: "current",
      coverage: { callFrames: "partial" }
    });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(result.firstDivergence).toBeUndefined();
    expect(result.stopReason).toBe("coverage_ended");
  });

  it("allows frame outcome comparison when session termination independently proves the boundary", () => {
    const baseline = prepared([
      frame(1, "solve", [], { exit: { status: "returned", step: 4, value: int(3) } })
    ]);
    const current = prepared([
      frame(11, "solve", [], {
        exit: { status: "trace_ended", step: 4, reason: "call_frame_event_limit" }
      })
    ], [11], {
      sessionId: "timeout",
      status: "timeout",
      terminationReason: "hard_timeout",
      coverage: { callFrames: "partial" }
    });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(kind(result)).toBe("frame_exit_status_changed");
  });

  it("reports a different observed child function as child_call_changed", () => {
    const baseline = prepared([
      frame(1, "solve", [childCall(1, "child-call|fallback:helper|1", 2, 2)], {
        childFrameIds: [2]
      }),
      frame(2, "helper", [], { callStep: 2 })
    ]);
    const current = prepared([
      frame(11, "solve", [childCall(11, "child-call|fallback:validate|1", 20, 12, "validate")], {
        childFrameIds: [12]
      }),
      frame(12, "validate", [], { callStep: 20 })
    ], [11], { sessionId: "current" });

    const result = compareCrossRuns(baseline, current, compatible);

    expect(kind(result)).toBe("child_call_changed");
    expect(result.firstDivergence?.baseline?.factualText).toContain("helper");
    expect(result.firstDivergence?.current?.factualText).toContain("validate");
  });

  it("stops instead of guessing when lookahead has repeated candidates", () => {
    const baseline = prepared([frame(1, "solve", [
      mutation(1, "mutation|local:a|1", 1, int(1)),
      mutation(1, "mutation|local:x|1", 2, int(1)),
      mutation(1, "mutation|local:x|1", 3, int(1))
    ])]);
    const current = prepared([frame(11, "solve", [
      mutation(11, "mutation|local:x|1", 20, int(1))
    ])], [11], { sessionId: "current" });

    const result = compareCrossRuns(baseline, current, compatible);
    expect(result.firstDivergence).toBeUndefined();
    expect(result.stopReason).toBe("ambiguous_alignment");
  });

  it("short-circuits incompatible and same-run comparisons", () => {
    const baseline = prepared([frame(1, "solve", [])]);
    const current = prepared([frame(11, "solve", [mutation(11, "mutation|local:x|1", 2, int(2))])], [11], {
      sessionId: "current"
    });

    const incompatible = compareCrossRuns(baseline, current, { status: "different_testcase" });
    expect(incompatible.firstDivergence).toBeUndefined();
    expect(incompatible.alignedPrefix.frameCount).toBe(0);

    const sameRun = compareCrossRuns(baseline, baseline, { status: "same_run" });
    expect(sameRun.firstDivergence).toBeUndefined();
    expect(sameRun.alignedPrefix.frameCount).toBe(0);
  });
});
