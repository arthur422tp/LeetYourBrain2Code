import { describe, expect, it } from "vitest";

import { buildCallFrameStory } from "../../src/core/call-frame-story";
import type {
  CallFrameModel,
  FrameOccurrence,
  FunctionPlan,
  RecursionOccurrenceInfo
} from "../../src/shared/call-frame-types";
import type { FrameEvidenceIndex } from "../../src/core/frame-evidence-index";
import type { TraceEvent, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function frame(
  frameId: number,
  functionName: string,
  parentFrameId: number | null,
  callStep: number,
  childFrameIds: number[] = [],
  overrides: Partial<FrameOccurrence> = {}
): FrameOccurrence {
  return {
    frameId,
    functionName,
    parentFrameId,
    depth: parentFrameId === null ? 1 : 2,
    callStep,
    arguments: [],
    childFrameIds,
    recursion: { isRecursive: false, recursionDepth: 1 },
    exit: { status: "active" },
    ...overrides
  };
}

function callFrames(frames: FrameOccurrence[], roots: number[] = [frames[0]!.frameId]): CallFrameModel {
  return {
    roots,
    byFrameId: new Map(frames.map((item) => [item.frameId, item])),
    tracingState: { status: "complete" }
  };
}

function evidence(frameIds: number[], counts: Partial<Record<"decisions" | "loops" | "expressions" | "mutations", number>> = {}): FrameEvidenceIndex {
  return new Map(frameIds.map((frameId) => [frameId, {
    frameId,
    childFrameIds: [],
    decisionAnchors: Array.from({ length: counts.decisions ?? 0 }, (_, index) => index + 1),
    controlFlowIterationRefs: Array.from({ length: counts.loops ?? 0 }, (_, index) => ({
      loopId: `loop-${index + 1}`,
      iteration: index + 1,
      anchorStepStart: index + 10
    })),
    expressionAnchors: Array.from({ length: counts.expressions ?? 0 }, (_, index) => index + 20),
    mutationAnchors: Array.from({ length: counts.mutations ?? 0 }, (_, index) => index + 30)
  }]));
}

function event(step: number, frameId: number, functionName = "solve"): TraceEvent {
  return {
    step,
    event: "line",
    frameId,
    parentFrameId: frameId === 1 ? null : 1,
    function: functionName,
    line: step,
    callDepth: frameId === 1 ? 1 : 2,
    locals: {},
    stdoutDelta: ""
  };
}

function plan(...descriptors: FunctionPlan["functions"]): FunctionPlan {
  return { version: 1, functions: descriptors };
}

describe("call-frame-story", () => {
  it("projects qualified labels, runtime ordering, cursor context, and indexed evidence counts", () => {
    const root = frame(1, "solve", null, 10, [2, 3], {
      functionId: "method:Solution.solve",
      firstUserLineStep: 11,
      arguments: [{ name: "n", kind: "positional_or_keyword", value: int(3) }],
      exit: { status: "returned", step: 100, value: int(3) }
    });
    const helper = frame(2, "helper", 1, 20, [], {
      functionId: "function:Solution.helper",
      exit: { status: "returned", step: 30, value: int(1) }
    });
    const sibling = frame(3, "helper", 1, 40, [], {
      functionId: "function:Solution.helper",
      exit: { status: "returned", step: 50, value: int(2) }
    });
    const model = buildCallFrameStory({
      callFrames: callFrames([root, helper, sibling]),
      frameEvidenceIndex: evidence([1, 2, 3], { decisions: 2, loops: 1, expressions: 3, mutations: 4 }),
      functionPlan: plan(
        {
          functionId: "method:Solution.solve",
          kind: "method",
          name: "solve",
          qualifiedName: "Solution.solve",
          span: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          firstBodyLine: 2,
          parameterNames: ["self", "n"],
          parameterKinds: ["positional_or_keyword", "positional_or_keyword"]
        },
        {
          functionId: "function:Solution.helper",
          kind: "function",
          name: "helper",
          qualifiedName: "Solution.helper",
          span: { line: 2, column: 0, endLine: 2, endColumn: 1 },
          firstBodyLine: 3,
          parameterNames: [],
          parameterKinds: []
        }
      ),
      events: [event(20, 2, "helper")],
      currentRawIndex: 0
    });

    expect(model.roots).toEqual([1]);
    expect(model.byFrameId.get(1)?.childFrameIds).toEqual([2, 3]);
    expect(model.byFrameId.get(2)?.qualifiedName).toBe("Solution.helper");
    expect(model.byFrameId.get(2)?.evidenceCounts).toEqual({
      decisions: 2,
      loopIterations: 1,
      expressions: 3,
      mutations: 4
    });
    expect(model.currentFrameId).toBe(2);
    expect(model.currentPath).toEqual([1, 2]);
    expect(model.byFrameId.get(1)?.arguments).toEqual(root.arguments);
  });

  it("derives temporal status from raw step values without inventing an exit moment", () => {
    const returned = frame(1, "solve", null, 10, [], {
      exit: { status: "returned", step: 50, value: int(2) }
    });
    const events = [event(5, 99), event(10, 1), event(40, 1), event(50, 1), event(60, 1)];
    const at = (currentRawIndex: number) => buildCallFrameStory({
      callFrames: callFrames([returned]),
      frameEvidenceIndex: evidence([1]),
      events,
      currentRawIndex
    }).byFrameId.get(1)!.atCursor;

    expect(at(0)).toBe("not_started");
    expect(at(1)).toBe("active");
    expect(at(2)).toBe("active");
    expect(at(3)).toBe("exited");
    expect(at(4)).toBe("exited");
    expect(buildCallFrameStory({
      callFrames: callFrames([returned]),
      frameEvidenceIndex: evidence([1]),
      events,
      currentRawIndex: -1
    }).byFrameId.get(1)?.atCursor).toBe("unknown");
  });

  it("keeps trace-ended status conservative when no exit step was captured", () => {
    const ended = frame(1, "solve", null, 10, [], {
      exit: { status: "trace_ended", reason: "hard_timeout" }
    });
    const other = frame(2, "other", null, 10, [], {
      exit: { status: "trace_ended", reason: "hard_timeout" }
    });
    const model = callFrames([ended, other], [1, 2]);

    const current = buildCallFrameStory({
      callFrames: model,
      frameEvidenceIndex: evidence([1, 2]),
      events: [event(20, 1)],
      currentRawIndex: 0
    });
    expect(current.byFrameId.get(1)?.atCursor).toBe("active");
    expect(current.byFrameId.get(2)?.atCursor).toBe("unknown");
  });

  it("copies direct and mutual recursion metadata and keeps same-name lexical functions distinct", () => {
    const directRecursion: RecursionOccurrenceInfo = {
      isRecursive: true,
      recursionDepth: 3,
      repeatedAncestorFrameId: 1,
      cycleFunctionIds: ["function:f", "function:f"]
    };
    const mutualRecursion: RecursionOccurrenceInfo = {
      isRecursive: true,
      recursionDepth: 2,
      repeatedAncestorFrameId: 1,
      cycleFunctionIds: ["function:even", "function:odd", "function:even"]
    };
    const outerVisit = frame(4, "visit", null, 40, [], {
      functionId: "function:outer.visit",
      recursion: { isRecursive: false, recursionDepth: 1 }
    });
    const otherVisit = frame(5, "visit", null, 50, [], {
      functionId: "function:other.visit",
      recursion: { isRecursive: false, recursionDepth: 1 }
    });
    const model = buildCallFrameStory({
      callFrames: callFrames([
        frame(1, "f", null, 1, [2], { functionId: "function:f" }),
        frame(2, "f", 1, 2, [3], { functionId: "function:f", recursion: { ...directRecursion } }),
        frame(3, "even", 2, 3, [], { functionId: "function:even", recursion: { ...mutualRecursion } }),
        outerVisit,
        otherVisit
      ], [1, 4, 5]),
      frameEvidenceIndex: evidence([1, 2, 3, 4, 5]),
      functionPlan: plan(
        {
          functionId: "function:outer.visit",
          kind: "nested_function",
          name: "visit",
          qualifiedName: "outer.visit",
          span: { line: 1, column: 0, endLine: 1, endColumn: 1 },
          firstBodyLine: 1,
          parameterNames: [],
          parameterKinds: []
        },
        {
          functionId: "function:other.visit",
          kind: "nested_function",
          name: "visit",
          qualifiedName: "other.visit",
          span: { line: 2, column: 0, endLine: 2, endColumn: 1 },
          firstBodyLine: 2,
          parameterNames: [],
          parameterKinds: []
        }
      ),
      events: [],
      currentRawIndex: -1
    });

    expect(model.byFrameId.get(2)?.recursion).toEqual(directRecursion);
    expect(model.byFrameId.get(3)?.recursion).toEqual(mutualRecursion);
    expect(model.byFrameId.get(4)?.qualifiedName).toBe("outer.visit");
    expect(model.byFrameId.get(5)?.qualifiedName).toBe("other.visit");
    expect(model.byFrameId.get(4)?.functionId).not.toBe(model.byFrameId.get(5)?.functionId);
  });

  it("preserves factual general call-stack depth for presentation", () => {
    const model = buildCallFrameStory({
      callFrames: callFrames([frame(8, "helper", null, 8, [], { depth: 3 })]),
      frameEvidenceIndex: evidence([8]),
      events: [],
      currentRawIndex: -1
    });

    expect(model.byFrameId.get(8)).toHaveProperty("depth", 3);
  });
});
