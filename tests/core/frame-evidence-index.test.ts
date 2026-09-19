import { describe, expect, it } from "vitest";

import { buildFrameEvidenceIndex } from "../../src/core/frame-evidence-index";
import { interpretCallFrames } from "../../src/core/call-frame-interpreter";
import type { CallFrameBatch } from "../../src/shared/call-frame-types";
import type { DecisionEvidenceByStep } from "../../src/shared/decision-types";
import type { ExpressionEvidenceByStep } from "../../src/shared/expression-types";
import type { TraceEvent, ValueSnapshot } from "../../src/shared/trace-types";
import type { ControlFlowInterpretation } from "../../src/core/control-flow-interpreter";
import type { LoopIterationEvidence } from "../../src/shared/control-flow-types";
import type { RuntimeMutation } from "../../src/core/runtime-mutation";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

const events: TraceEvent[] = [
  {
    step: 1,
    event: "call",
    frameId: 1,
    parentFrameId: null,
    function: "solve",
    line: 1,
    callDepth: 1,
    locals: {},
    stdoutDelta: ""
  },
  {
    step: 2,
    event: "line",
    frameId: 2,
    parentFrameId: 1,
    function: "helper",
    line: 2,
    callDepth: 2,
    locals: {},
    stdoutDelta: ""
  },
  {
    step: 20,
    event: "line",
    frameId: 4,
    parentFrameId: null,
    function: "other",
    line: 4,
    callDepth: 1,
    locals: {},
    stdoutDelta: ""
  }
];

const batches: CallFrameBatch[] = [{
  batchId: 1,
  updates: [
    {
      updateId: 1,
      kind: "frame_enter",
      frameId: 1,
      parentFrameId: null,
      functionName: "solve",
      functionId: "solve",
      callStep: 1,
      depth: 1,
      arguments: []
    },
    {
      updateId: 2,
      kind: "frame_enter",
      frameId: 2,
      parentFrameId: 1,
      functionName: "helper",
      functionId: "helper",
      callStep: 2,
      depth: 2,
      arguments: []
    },
    {
      updateId: 3,
      kind: "frame_enter",
      frameId: 3,
      parentFrameId: 2,
      functionName: "nested",
      functionId: "nested",
      callStep: 3,
      depth: 3,
      arguments: []
    },
    {
      updateId: 4,
      kind: "frame_enter",
      frameId: 4,
      parentFrameId: null,
      functionName: "other",
      functionId: "other",
      callStep: 20,
      depth: 1,
      arguments: []
    }
  ]
}];

const decisionEvidence: DecisionEvidenceByStep = new Map([
  [10, { frameId: 2, anchorStep: 10 } as never],
  [11, { frameId: 2, anchorStep: 11 } as never],
  [20, { frameId: 4, anchorStep: 20 } as never]
]);

const iteration = (frameId: number, loopId: string, iterationNumber: number, anchorStepStart: number): LoopIterationEvidence => ({
  frameId,
  loopId,
  iteration: iterationNumber,
  context: { loopStack: [{ loopId, iteration: iterationNumber }] },
  anchorStepStart,
  anchorStepEnd: anchorStepStart + 1,
  bindings: [],
  status: "completed"
});

const controlFlow: ControlFlowInterpretation = {
  iterations: [iteration(2, "loop-2", 1, 12), iteration(4, "loop-4", 1, 22)],
  actions: [],
  loopExits: [],
  contextByStep: new Map(),
  iterationsByLoop: new Map(),
  iterationsByActivation: new Map()
};

const expressionEvidence: ExpressionEvidenceByStep = new Map([
  [30, { anchorStep: 30, frameId: 2, roots: [] }],
  [40, { anchorStep: 40, frameId: 4, roots: [] }]
]);

const mutation = (frameId: number): RuntimeMutation => ({
  kind: "variable",
  origin: "transition",
  frameId,
  variableName: "value",
  action: "changed",
  before: int(0),
  after: int(1)
});

describe("frame-evidence-index", () => {
  it("indexes existing evidence by frame without crossing frame boundaries", () => {
    const callFrames = interpretCallFrames({
      events,
      batches,
      tracingState: { status: "complete" },
      terminationReason: "normal_return"
    });
    const index = buildFrameEvidenceIndex({
      callFrames,
      events,
      decisionEvidence,
      controlFlow,
      expressionEvidence,
      mutationBatches: [
        { step: 50, frameId: 2, currentLine: 2, mutations: [mutation(2)] },
        { step: 51, frameId: 4, currentLine: 4, mutations: [mutation(4)] }
      ]
    });

    expect(index.get(2)).toEqual({
      frameId: 2,
      childFrameIds: [3],
      decisionAnchors: [10, 11],
      controlFlowIterationRefs: [{ loopId: "loop-2", iteration: 1, anchorStepStart: 12 }],
      expressionAnchors: [30],
      mutationAnchors: [50]
    });
    expect(index.get(4)).toEqual({
      frameId: 4,
      childFrameIds: [],
      decisionAnchors: [20],
      controlFlowIterationRefs: [{ loopId: "loop-4", iteration: 1, anchorStepStart: 22 }],
      expressionAnchors: [40],
      mutationAnchors: [51]
    });
    expect(index.get(3)).toEqual({
      frameId: 3,
      childFrameIds: [],
      decisionAnchors: [],
      controlFlowIterationRefs: [],
      expressionAnchors: [],
      mutationAnchors: []
    });
  });
});
