import { describe, expect, it } from "vitest";

import {
  buildCallFrameStory,
  type CallFrameStoryModel,
  type CallFrameStoryNode
} from "../../src/core/call-frame-story";
import { createCallFrameStory } from "../../src/sidepanel/components/CallFrameStory";
import { createExecutionStory } from "../../src/sidepanel/components/ExecutionStory";
import { buildControlFlowUiModel } from "../../src/core/execution-story";
import { storyInput } from "../fixtures/execution-story";
import type { CallFrameModel, FrameOccurrence } from "../../src/shared/call-frame-types";
import type { FrameEvidenceIndex } from "../../src/core/frame-evidence-index";
import type { TraceEvent, ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const none = (): ValueSnapshot => ({ type: "none", value: null });
const treeNode = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "TreeNode"
});

function node(
  frameId: number,
  name: string,
  depth: number,
  callStep: number,
  overrides: Partial<CallFrameStoryNode> = {}
): CallFrameStoryNode {
  return {
    frameId,
    functionName: name,
    qualifiedName: name,
    displayName: name,
    depth,
    arguments: [],
    callStep,
    exit: { status: "active" },
    atCursor: "active",
    recursion: { isRecursive: false, recursionDepth: 1 },
    childFrameIds: [],
    evidenceCounts: { decisions: 0, loopIterations: 0, expressions: 0, mutations: 0 },
    ...overrides
  };
}

function model(
  nodes: CallFrameStoryNode[],
  currentFrameId: number | undefined,
  currentPath: number[],
  roots: number[] = [nodes[0]?.frameId ?? 1],
  tracingState: CallFrameStoryModel["tracingState"] = { status: "complete" }
): CallFrameStoryModel {
  return {
    roots,
    byFrameId: new Map(nodes.map((item) => [item.frameId, item])),
    ...(currentFrameId === undefined ? {} : { currentFrameId }),
    currentPath,
    tracingState
  };
}

function frameOccurrence(
  frameId: number,
  name: string,
  parentFrameId: number | null,
  callStep: number,
  childFrameIds: number[] = [],
  overrides: Partial<FrameOccurrence> = {}
): FrameOccurrence {
  return {
    frameId,
    functionName: name,
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

function callFrameModel(frames: FrameOccurrence[], tracingState: CallFrameModel["tracingState"] = { status: "complete" }): CallFrameModel {
  return {
    roots: frames.filter((frame) => frame.parentFrameId === null).map((frame) => frame.frameId),
    byFrameId: new Map(frames.map((frame) => [frame.frameId, frame])),
    tracingState
  };
}

function evidence(frameIds: number[]): FrameEvidenceIndex {
  return new Map(frameIds.map((frameId) => [frameId, {
    frameId,
    childFrameIds: [],
    decisionAnchors: [],
    controlFlowIterationRefs: [],
    expressionAnchors: [],
    mutationAnchors: []
  }]));
}

function traceEvent(step: number, frameId: number, functionName: string): TraceEvent {
  return {
    step,
    event: "line",
    frameId,
    parentFrameId: frameId === 1 ? null : frameId - 1,
    function: functionName,
    line: step,
    callDepth: frameId,
    locals: {},
    stdoutDelta: ""
  };
}

describe("Call-Frame story product scenarios", () => {
  it("renders direct recursion as distinct factual frames and navigable call steps", () => {
    const frames = [1, 2, 3, 4].map((frameId) => node(
      frameId,
      "f",
      frameId,
      frameId * 10,
      {
        childFrameIds: frameId < 4 ? [frameId + 1] : [],
        exit: { status: "returned", step: 50 + frameId, value: int(frameId - 1) },
        recursion: frameId === 1
          ? { isRecursive: false, recursionDepth: 1 }
          : { isRecursive: true, recursionDepth: frameId, repeatedAncestorFrameId: 1 }
      }
    ));
    const steps: number[] = [];
    const handle = createCallFrameStory({ model: model(frames, 4, [1, 2, 3, 4]), onNavigateStep: (step) => steps.push(step) });

    expect([...handle.element.querySelectorAll<HTMLElement>(".call-frame-story__tree-row")]
      .map((row) => row.dataset.frameId)).toEqual(["1", "2", "3", "4"]);
    expect(handle.element.querySelector('.call-frame-story__tree-row[data-frame-id="1"] .call-frame-story__tree-recursion')).toBeNull();
    expect(handle.element.querySelectorAll(".call-frame-story__tree-recursion")).toHaveLength(3);
    for (const frameId of [1, 2, 3, 4]) {
      handle.element.querySelector<HTMLButtonElement>(`[data-frame-id="${frameId}"][data-frame-action="entry"]`)!.click();
    }
    expect(steps).toEqual([10, 20, 30, 40]);
    expect(handle.element.textContent).toContain("At this step: active");
    expect(handle.element.textContent).toContain("Observed later: returned 3");
    handle.dispose();
  });

  it("keeps binary-tree arguments compact and avoids semantic DFS claims", () => {
    const frames = [
      node(1, "Solution.maxDepth", 1, 10, {
        childFrameIds: [2, 3],
        arguments: [{ name: "root", kind: "positional_or_keyword", value: treeNode("obj-1") }]
      }),
      node(2, "Solution.maxDepth", 2, 20, {
        arguments: [{ name: "root", kind: "positional_or_keyword", value: treeNode("obj-2") }]
      }),
      node(3, "Solution.maxDepth", 2, 30, {
        arguments: [{ name: "root", kind: "positional_or_keyword", value: none() }],
        atCursor: "exited",
        exit: { status: "returned", step: 35, value: int(0) }
      })
    ];
    const handle = createCallFrameStory({ model: model(frames, 2, [1, 2]), onNavigateStep: () => { } });
    const text = handle.element.textContent ?? "";

    expect(text).toContain("root=TreeNode@obj-1");
    expect(text).toContain("root=None");
    expect(text).not.toMatch(/DFS|left subtree|right subtree|correctness/i);
    handle.dispose();
  });

  it("keeps recursive control-flow evidence inside the active frame boundary", () => {
    const callFrame = model([
      node(1, "helper", 1, 10, { childFrameIds: [2] }),
      node(2, "helper", 2, 20, { recursion: { isRecursive: true, recursionDepth: 2, repeatedAncestorFrameId: 1 } })
    ], 2, [1, 2]);
    const controlFlowInput = storyInput();
    controlFlowInput.frameId = 2;
    const history = controlFlowInput.controlFlow.iterationsByActivation.get("1:f1#2>f2")!;
    controlFlowInput.controlFlow.iterationsByActivation = new Map([["2:f1#2>f2", history]]);
    const handle = createExecutionStory({
      model: { callFrame, controlFlow: buildControlFlowUiModel(controlFlowInput) },
      onNavigateStep: () => { }
    });

    expect(handle.element.textContent).toContain("Current frame");
    expect(handle.element.textContent).toContain("Call Tree");
    expect(handle.element.textContent).toContain("Inside this frame");
    expect(handle.element.textContent).toContain("FOR · line 2");
    expect(handle.element.textContent).toContain("Iteration #2");
    handle.dispose();
  });

  it("renders mutual recursion from concrete cycle metadata without warnings", () => {
    const frames = [
      node(1, "even", 1, 10, {
        childFrameIds: [2],
        recursion: { isRecursive: false, recursionDepth: 1 }
      }),
      node(2, "odd", 2, 20, {
        childFrameIds: [3],
        recursion: { isRecursive: true, recursionDepth: 2, repeatedAncestorFrameId: 1, cycleFunctionIds: ["even", "odd", "even"] }
      }),
      node(3, "even", 3, 30, {
        recursion: { isRecursive: true, recursionDepth: 2, repeatedAncestorFrameId: 1, cycleFunctionIds: ["even", "odd", "even"] }
      })
    ];
    const handle = createCallFrameStory({ model: model(frames, 3, [1, 2, 3]), onNavigateStep: () => { } });

    expect(handle.element.textContent).toContain("even()")
    expect(handle.element.textContent).toContain("odd()");
    expect(handle.element.textContent).toContain("recursive · depth 2");
    expect(handle.element.textContent).not.toMatch(/warning|root cause|infinite recursion/i);
    expect(handle.element.querySelector('.call-frame-story__tree-row[data-frame-id="3"]')?.dataset.currentPath).toBe("true");
    handle.dispose();
  });

  it("keeps sequential same-named helpers separate and non-recursive", () => {
    const frames = [
      node(1, "solve", 1, 10, { childFrameIds: [2, 3] }),
      node(2, "helper", 2, 20, { arguments: [{ name: "value", kind: "positional_or_keyword", value: int(1) }] }),
      node(3, "helper", 2, 30, { arguments: [{ name: "value", kind: "positional_or_keyword", value: int(2) }] })
    ];
    const handle = createCallFrameStory({ model: model(frames, 1, [1]), onNavigateStep: () => { } });
    const rows = [...handle.element.querySelectorAll<HTMLElement>(".call-frame-story__tree-row")];

    expect(rows.map((row) => row.dataset.frameId)).toEqual(["1", "2", "3"]);
    expect(handle.element.querySelectorAll(".call-frame-story__tree-recursion")).toHaveLength(0);
    expect(handle.element.textContent).toContain("helper(value=1)");
    expect(handle.element.textContent).toContain("helper(value=2)");
    handle.dispose();
  });

  it("keeps handled and propagated exceptions factual at each frame", () => {
    const exception = { type: "ValueError", message: "bad input", line: 7 };
    const handled = createCallFrameStory({
      model: model([
        node(1, "parent", 1, 10, { childFrameIds: [2], exit: { status: "returned", step: 70, value: int(7) } }),
        node(2, "child", 2, 20, { exit: { status: "exception", step: 30, exception } })
      ], 1, [1]),
      onNavigateStep: () => { }
    });
    expect(handled.element.textContent).toContain("parent() → 7");
    expect(handled.element.textContent).toContain("child() ⚠ ValueError");
    expect(handled.element.textContent).not.toContain("root cause");
    handled.dispose();

    const propagated = createCallFrameStory({
      model: model([
        node(1, "solve", 1, 10, { childFrameIds: [2], exit: { status: "exception", step: 80, exception } }),
        node(2, "middle", 2, 20, { childFrameIds: [3], exit: { status: "exception", step: 70, exception } }),
        node(3, "inner", 3, 30, { exit: { status: "exception", step: 60, exception } })
      ], 3, [1, 2, 3]),
      onNavigateStep: () => { }
    });
    expect(propagated.element.textContent).toContain("solve() ⚠ ValueError");
    expect(propagated.element.textContent).toContain("middle() ⚠ ValueError");
    expect(propagated.element.textContent).toContain("inner() ⚠ ValueError");
    propagated.dispose();
  });

  it("shows a trace-limited prefix without inventing a return value", () => {
    const handle = createCallFrameStory({
      model: model([
        node(1, "solve", 1, 10, { childFrameIds: [2], exit: { status: "trace_ended", reason: "hard_timeout" } }),
        node(2, "helper", 2, 20, { exit: { status: "trace_ended", reason: "hard_timeout" } })
      ], 2, [1, 2], [1], { status: "truncated", reason: "call_frame_event_limit" }),
      onNavigateStep: () => { }
    });
    const text = handle.element.textContent ?? "";

    expect(text).toContain("Call-frame tracing truncated · call_frame_event_limit");
    expect(text).toContain("… trace ended");
    expect(text).toContain("hard_timeout");
    expect(text).not.toMatch(/→ \d|infinite recursion/i);
    handle.dispose();
  });

  it("does not fabricate a current frame when raw tracing continues beyond truncated frame evidence", () => {
    const callFrames = callFrameModel([
      frameOccurrence(1, "solve", null, 10, [], { exit: { status: "trace_ended", reason: "call_frame_event_limit" } })
    ], { status: "truncated", reason: "call_frame_event_limit" });
    const story = buildCallFrameStory({
      callFrames,
      frameEvidenceIndex: evidence([1]),
      events: [traceEvent(50, 99, "unseen")],
      currentRawIndex: 0
    });
    const handle = createCallFrameStory({ model: story, onNavigateStep: () => { } });

    expect(story.currentFrameId).toBeUndefined();
    expect(handle.element.querySelector(".call-frame-story__current")?.textContent)
      .toContain("No call-frame evidence for this step.");
    expect(handle.element.textContent).toContain("Call-frame tracing truncated");
    handle.dispose();
  });
});
