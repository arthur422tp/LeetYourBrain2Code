import { describe, expect, it } from "vitest";

import {
  alignCrossRunFrames,
  buildCrossRunFunctionIdentityIndex
} from "../../src/core/cross-run-alignment";
import type { CallFrameModel, FunctionPlan, FrameOccurrence } from "../../src/shared/call-frame-types";

function frame(
  frameId: number,
  functionName: string,
  parentFrameId: number | null = null,
  childFrameIds: number[] = [],
  functionId?: string
): FrameOccurrence {
  return {
    frameId,
    ...(functionId ? { functionId } : {}),
    functionName,
    parentFrameId,
    depth: parentFrameId === null ? 1 : 2,
    callStep: frameId,
    arguments: [],
    childFrameIds,
    recursion: { isRecursive: false, recursionDepth: 1 },
    exit: { status: "active" }
  };
}

function model(frames: FrameOccurrence[], roots: number[] = frames.filter((item) => item.parentFrameId === null).map((item) => item.frameId)): CallFrameModel {
  return {
    roots,
    byFrameId: new Map(frames.map((item) => [item.frameId, item])),
    tracingState: { status: "complete" }
  };
}

function descriptor(
  functionId: string,
  qualifiedName: string,
  parameterNames: string[] = [],
  parameterKinds: FunctionPlan["functions"][number]["parameterKinds"] = []
): FunctionPlan["functions"][number] {
  return {
    functionId,
    kind: "function",
    name: qualifiedName.split(".").at(-1) ?? qualifiedName,
    qualifiedName,
    span: { line: 2, column: 0, endLine: 3, endColumn: 1 },
    firstBodyLine: 3,
    parameterNames,
    parameterKinds
  };
}

function plan(...functions: FunctionPlan["functions"]): FunctionPlan {
  return { version: 1, functions };
}

describe("cross-run function identity", () => {
  it("keeps a strong identity stable when only source spans shift", () => {
    const baselineModel = model([frame(1, "solve", null, [], "baseline-solve")]);
    const currentModel = model([frame(11, "solve", null, [], "current-solve")]);
    const baselinePlan = plan(descriptor("baseline-solve", "Solution.solve", ["value"], ["positional_or_keyword"]));
    const currentPlan = plan(descriptor("current-solve", "Solution.solve", ["value"], ["positional_or_keyword"]));

    const baselineIdentity = buildCrossRunFunctionIdentityIndex(baselineModel, baselinePlan).byFrameId.get(1)!;
    const currentIdentity = buildCrossRunFunctionIdentityIndex(currentModel, currentPlan).byFrameId.get(11)!;

    expect(baselineIdentity).toEqual(currentIdentity);
    expect(alignCrossRunFrames(baselineModel, currentModel, baselinePlan, currentPlan).pairs)
      .toMatchObject([{ baselineFrameId: 1, currentFrameId: 11, confidence: "strong" }]);
  });

  it("aligns direct and mutual recursion through parent and occurrence ordinal", () => {
    const directBaseline = model([
      frame(1, "f", null, [2], "f-1"),
      frame(2, "f", 1, [3], "f-1"),
      frame(3, "f", 2, [], "f-1")
    ]);
    const directCurrent = model([
      frame(11, "f", null, [12], "f-2"),
      frame(12, "f", 11, [13], "f-2"),
      frame(13, "f", 12, [], "f-2")
    ]);
    const baselinePlan = plan(descriptor("f-1", "Module.f"));
    const currentPlan = plan(descriptor("f-2", "Module.f"), descriptor("g-2", "Module.g"));

    const direct = alignCrossRunFrames(directBaseline, directCurrent, baselinePlan, currentPlan);
    expect(direct.pairs).toHaveLength(3);
    expect(direct.pairs.map((pair) => [pair.baselineChildOrdinal, pair.currentChildOrdinal]))
      .toEqual([[1, 1], [1, 1], [1, 1]]);

    const mutualBaseline = model([
      frame(21, "f", null, [22], "f-1"),
      frame(22, "g", 21, [23], "g-1"),
      frame(23, "f", 22, [], "f-1")
    ]);
    const mutualCurrent = model([
      frame(31, "f", null, [32], "f-2"),
      frame(32, "g", 31, [33], "g-2"),
      frame(33, "f", 32, [], "f-2")
    ]);
    const mutual = alignCrossRunFrames(mutualBaseline, mutualCurrent, plan(
      descriptor("f-1", "Module.f"),
      descriptor("g-1", "Module.g")
    ), plan(
      descriptor("f-2", "Module.f"),
      descriptor("g-2", "Module.g")
    ));
    expect(mutual.pairs.map((pair) => pair.functionKey)).toEqual([
      expect.stringContaining("Module.f"),
      expect.stringContaining("Module.g"),
      expect.stringContaining("Module.f")
    ]);
    expect(mutual.stop).toBeUndefined();
  });

  it("keeps repeated same-function siblings separate by occurrence ordinal", () => {
    const baseline = model([
      frame(1, "solve", null, [2, 3], "solve-1"),
      frame(2, "helper", 1, [], "helper-1"),
      frame(3, "helper", 1, [], "helper-1")
    ]);
    const current = model([
      frame(11, "solve", null, [12, 13], "solve-2"),
      frame(12, "helper", 11, [], "helper-2"),
      frame(13, "helper", 11, [], "helper-2")
    ]);
    const functionPlanBaseline = plan(descriptor("solve-1", "Solution.solve"), descriptor("helper-1", "Solution.helper"));
    const functionPlanCurrent = plan(descriptor("solve-2", "Solution.solve"), descriptor("helper-2", "Solution.helper"));

    const result = alignCrossRunFrames(baseline, current, functionPlanBaseline, functionPlanCurrent);
    expect(result.pairs.filter((pair) => pair.baselineFrameId !== 1)).toMatchObject([
      { baselineFrameId: 2, currentFrameId: 12, baselineChildOrdinal: 1, currentChildOrdinal: 1 },
      { baselineFrameId: 3, currentFrameId: 13, baselineChildOrdinal: 2, currentChildOrdinal: 2 }
    ]);
  });

  it("distinguishes same short names under different qualified parents and renamed functions", () => {
    const baseline = model([frame(1, "helper", null, [], "helper-a")]);
    const current = model([frame(11, "helper", null, [], "helper-b")]);
    const result = alignCrossRunFrames(
      baseline,
      current,
      plan(descriptor("helper-a", "SolutionA.solve.helper")),
      plan(descriptor("helper-b", "SolutionB.solve.helper"))
    );

    expect(result.pairs).toEqual([]);
    expect(result.stop?.reason).toBe("unmatched_function");
  });

  it("uses fallback runtime names with reduced confidence when plans are missing", () => {
    const result = alignCrossRunFrames(
      model([frame(1, "solve")]),
      model([frame(11, "solve")])
    );

    expect(result.pairs).toMatchObject([{
      baselineFrameId: 1,
      currentFrameId: 11,
      confidence: "fallback"
    }]);
  });

  it("stops instead of choosing between ambiguous fallback roots", () => {
    const result = alignCrossRunFrames(
      model([frame(1, "helper"), frame(2, "helper")]),
      model([frame(11, "helper"), frame(12, "helper")])
    );

    expect(result.pairs).toEqual([]);
    expect(result.stop?.reason).toBe("ambiguous_fallback");
  });

  it("pairs inserted same-function calls by ordinal and leaves the unmatched occurrence explicit", () => {
    const baseline = model([
      frame(1, "solve", null, [2, 3], "solve-1"),
      frame(2, "helper", 1, [], "helper-1"),
      frame(3, "helper", 1, [], "helper-1")
    ]);
    const current = model([
      frame(11, "solve", null, [12, 13, 14], "solve-2"),
      frame(12, "helper", 11, [], "helper-2"),
      frame(13, "helper", 11, [], "helper-2"),
      frame(14, "helper", 11, [], "helper-2")
    ]);
    const result = alignCrossRunFrames(
      baseline,
      current,
      plan(descriptor("solve-1", "Solution.solve"), descriptor("helper-1", "Solution.helper")),
      plan(descriptor("solve-2", "Solution.solve"), descriptor("helper-2", "Solution.helper"))
    );

    expect(result.pairs.filter((pair) => pair.baselineFrameId !== 1)).toMatchObject([
      { baselineFrameId: 2, currentFrameId: 12, baselineChildOrdinal: 1, currentChildOrdinal: 1 },
      { baselineFrameId: 3, currentFrameId: 13, baselineChildOrdinal: 2, currentChildOrdinal: 2 }
    ]);
    expect(result.stop?.reason).toBe("unmatched_function");
    expect(result.stop?.currentFrameIds).toEqual([14]);
  });
});
