import { describe, expect, it } from "vitest";

import {
  compareCaseBehavioralDiff
} from "../../src/core/case-behavioral-diff";
import type {
  BehavioralCheckpoint,
  ChildCallCheckpoint,
  CrossRunFrameProjection,
  DecisionCheckpoint,
  LoopIterationCheckpoint,
  MutationCheckpoint
} from "../../src/core/cross-run-checkpoints";
import {
  type CrossRunCoverage,
  type PreparedCrossRun
} from "../../src/core/cross-run-diff-types";
import type { TraceInterpretation } from "../../src/core/trace-interpreter";
import { DEFAULT_EXECUTION_LIMITS } from "../../src/shared/execution-types";
import type {
  CallFrameModel,
  FrameOccurrence
} from "../../src/shared/call-frame-types";
import type { TraceSession, ValueSnapshot } from "../../src/shared/trace-types";
import type { RunRecord } from "../../src/sidepanel/run-comparison-state";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

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

function traceSession(
  sessionId: string,
  overrides: Partial<TraceSession> = {}
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
    status: "completed",
    terminationReason: "normal_return",
    events: [],
    stdout: "",
    limits: DEFAULT_EXECUTION_LIMITS,
    ...overrides
  };
}

function frame(
  frameId: number,
  displayName: string,
  checkpoints: BehavioralCheckpoint[],
  options: {
    childFrameIds?: number[];
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
      arguments: []
    },
    checkpoints,
    childFrameIds: options.childFrameIds ?? [],
    exit: {
      kind: "frame_exit",
      frameId,
      semanticKey: "frame-exit",
      runLocalAnchorStep: options.exit?.status === "returned"
        || options.exit?.status === "exception"
        || options.exit?.status === "trace_ended"
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
  return { roots, byFrameId, tracingState: { status: "complete" } };
}

function prepared(
  frames: CrossRunFrameProjection[],
  options: {
    sessionId: string;
    session?: Partial<TraceSession>;
    roots?: number[];
    coverage?: Partial<CrossRunCoverage>;
  }
): PreparedCrossRun {
  const roots = options.roots ?? [frames[0]?.frameId ?? 1];
  return {
    session: traceSession(options.sessionId, options.session),
    interpretation: { callFrames: callFrameModel(frames, roots) } as TraceInterpretation,
    frames: new Map(frames.map((item) => [item.frameId, item])),
    roots,
    coverage: coverage(options.coverage)
  };
}

function runRecord(
  sessionId: string,
  selectedCaseIndex: number,
  overrides: Partial<TraceSession> = {}
): RunRecord {
  return {
    session: traceSession(sessionId, overrides),
    context: {
      problemSlug: "same-problem",
      problemTitle: "Same Problem",
      selectedCaseIndex,
      language: "python"
    }
  };
}

function compareFixtures(
  left: RunRecord,
  right: RunRecord,
  leftPrepared: PreparedCrossRun,
  rightPrepared: PreparedCrossRun
) {
  return compareCaseBehavioralDiff(left, right, {
    prepareCrossRun: (session) => session.sessionId === left.session.sessionId
      ? leftPrepared
      : rightPrepared
  });
}

function decision(frameId: number, step: number, truth: boolean): DecisionCheckpoint {
  return {
    kind: "decision",
    frameId,
    semanticKey: "decision|if|value < target|1",
    runLocalAnchorStep: step,
    localSequence: step,
    siteKind: "if",
    source: "value < target",
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
  value: number
): MutationCheckpoint {
  return {
    kind: "mutation",
    frameId,
    semanticKey: `mutation|${targetKey}|1`,
    runLocalAnchorStep: step,
    localSequence: step,
    mutationKind: "variable",
    targetKey,
    action: "changed",
    after: int(value)
  };
}

function childCall(
  frameId: number,
  step: number,
  childFrameId: number,
  functionName: string,
  occurrenceOrdinal = 1
): ChildCallCheckpoint {
  return {
    kind: "child_call",
    frameId,
    semanticKey: `child-call|fallback:${functionName}|${occurrenceOrdinal}`,
    runLocalAnchorStep: step,
    localSequence: step,
    callee: {
      key: `fallback:${functionName}`,
      displayName: functionName,
      confidence: "fallback"
    },
    childFrameId,
    occurrenceOrdinal
  };
}

function iteration(frameId: number, step: number, ordinal: number): LoopIterationCheckpoint {
  return {
    kind: "loop_iteration",
    frameId,
    semanticKey: `loop-iteration|for|for value in values|${ordinal}`,
    runLocalAnchorStep: step,
    localSequence: step,
    loopKind: "for",
    source: "for value in values",
    iteration: ordinal,
    status: "completed",
    bindings: [],
    terminalAnchorStep: step + 1
  };
}

describe("case-to-case behavioral diff scenarios", () => {
  it("reports decision divergence for the same source across Cases", () => {
    const left = runRecord("decision-left", 0);
    const right = runRecord("decision-right", 1);
    const result = compareFixtures(
      left,
      right,
      prepared([frame(1, "solve", [decision(1, 2, false)])], { sessionId: left.session.sessionId }),
      prepared([frame(11, "solve", [decision(11, 20, true)])], { sessionId: right.session.sessionId })
    );

    expect(result.compatibility).toEqual({ status: "compatible" });
    expect(result.diff?.firstDivergence?.kind).toBe("decision_truth_changed");
  });

  it("reports the first stable mutation before a later return difference", () => {
    const left = runRecord("mutation-left", 0);
    const right = runRecord("mutation-right", 1);
    const result = compareFixtures(
      left,
      right,
      prepared([frame(1, "solve", [
        decision(1, 2, false),
        mutation(1, 3, "local:result", 1)
      ])], { sessionId: left.session.sessionId }),
      prepared([frame(11, "solve", [
        decision(11, 20, false),
        mutation(11, 30, "local:result", 2)
      ], { exit: { status: "returned", step: 100, value: int(9) } })], { sessionId: right.session.sessionId })
    );

    expect(result.diff?.firstDivergence?.kind).toBe("mutation_value_changed");
  });

  it("reports an extra child call as call behavior evidence", () => {
    const left = runRecord("call-left", 0);
    const right = runRecord("call-right", 1);
    const result = compareFixtures(
      left,
      right,
      prepared([
        frame(1, "solve", [childCall(1, 2, 2, "helper")], { childFrameIds: [2] }),
        frame(2, "helper", [], { callStep: 2 })
      ], { sessionId: left.session.sessionId }),
      prepared([
        frame(11, "solve", [
          childCall(11, 20, 12, "helper"),
          childCall(11, 30, 13, "helper", 2)
        ], { childFrameIds: [12, 13] }),
        frame(12, "helper", [], { callStep: 20 }),
        frame(13, "helper", [], { callStep: 30 })
      ], { sessionId: right.session.sessionId })
    );

    expect(result.diff?.firstDivergence?.kind).toBe("child_call_extra");
  });

  it("reports an extra loop iteration as control-flow evidence", () => {
    const left = runRecord("loop-left", 0);
    const right = runRecord("loop-right", 1);
    const result = compareFixtures(
      left,
      right,
      prepared([frame(1, "solve", [iteration(1, 2, 1)])], { sessionId: left.session.sessionId }),
      prepared([frame(11, "solve", [iteration(11, 20, 1), iteration(11, 30, 2)])], { sessionId: right.session.sessionId })
    );

    expect(["iteration_status_changed", "loop_exit_reason_changed"]).toContain(
      result.diff?.firstDivergence?.kind
    );
  });

  it("keeps return-versus-exception as termination evidence", () => {
    const left = runRecord("return-left", 0);
    const right = runRecord("exception-right", 1, {
      status: "exception",
      terminationReason: "runtime_exception"
    });
    const result = compareFixtures(
      left,
      right,
      prepared([frame(1, "solve", [], {
        exit: { status: "returned", step: 4, value: int(1) }
      })], { sessionId: left.session.sessionId }),
      prepared([frame(11, "solve", [], {
        exit: {
          status: "exception",
          step: 20,
          exception: { type: "ValueError", message: "bad value", line: 3, stack: [], frameId: 11 }
        }
      })], {
        sessionId: right.session.sessionId,
        session: { status: "exception", terminationReason: "runtime_exception" }
      })
    );

    expect(["frame_exit_status_changed", "session_outcome_changed"]).toContain(
      result.diff?.firstDivergence?.kind
    );
  });

  it("reports no observed divergence for identical captured behavior", () => {
    const left = runRecord("same-left", 0);
    const right = runRecord("same-right", 1);
    const result = compareFixtures(
      left,
      right,
      prepared([frame(1, "solve", [decision(1, 2, false)])], { sessionId: left.session.sessionId }),
      prepared([frame(11, "solve", [decision(11, 20, false)])], { sessionId: right.session.sessionId })
    );

    expect(result.diff?.firstDivergence).toBeUndefined();
    expect(result.diff?.stopReason).toBeUndefined();
  });

  it("rejects same captured Case indexes before alignment", () => {
    const left = runRecord("same-case-left", 0);
    const right = runRecord("same-case-right", 0);
    const result = compareFixtures(
      left,
      right,
      prepared([frame(1, "solve", [])], { sessionId: left.session.sessionId }),
      prepared([frame(11, "solve", [])], { sessionId: right.session.sessionId })
    );

    expect(result.compatibility).toEqual({ status: "same_case" });
    expect(result.diff).toBeUndefined();
  });

  it("rejects a source edit between Case captures without cross-run alignment", () => {
    const left = runRecord("source-left", 0, { sourceCode: "source A" });
    const right = runRecord("source-right", 1, { sourceCode: "source B" });
    const result = compareFixtures(
      left,
      right,
      prepared([frame(1, "solve", [decision(1, 2, false)])], { sessionId: left.session.sessionId }),
      prepared([frame(11, "solve", [decision(11, 20, true)])], { sessionId: right.session.sessionId })
    );

    expect(result.compatibility).toEqual({ status: "different_source" });
    expect(result.diff).toBeUndefined();
  });

  it("stops instead of guessing an ambiguous recursive alignment", () => {
    const left = runRecord("ambiguous-left", 0);
    const right = runRecord("ambiguous-right", 1);
    const result = compareFixtures(
      left,
      right,
      prepared([frame(1, "solve", [
        mutation(1, 1, "local:a", 1),
        mutation(1, 2, "local:x", 1),
        mutation(1, 3, "local:x", 1)
      ])], { sessionId: left.session.sessionId }),
      prepared([frame(11, "solve", [mutation(11, 20, "local:x", 1)])], { sessionId: right.session.sessionId })
    );

    expect(result.diff?.firstDivergence).toBeUndefined();
    expect(result.diff?.stopReason).toBe("ambiguous_alignment");
  });

  it("preserves an earlier divergence while exposing later partial coverage", () => {
    const left = runRecord("partial-left", 0);
    const right = runRecord("partial-right", 1);
    const result = compareFixtures(
      left,
      right,
      prepared([frame(1, "solve", [decision(1, 2, false)])], {
        sessionId: left.session.sessionId,
        coverage: { decisions: "partial" }
      }),
      prepared([frame(11, "solve", [decision(11, 20, true)])], {
        sessionId: right.session.sessionId,
        coverage: { decisions: "partial" }
      })
    );

    expect(result.diff?.firstDivergence?.kind).toBe("decision_truth_changed");
    expect(result.diff?.coverage.decisions).toBe("partial");
  });
});
