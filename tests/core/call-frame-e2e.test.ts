import { describe, expect, it } from "vitest";

import type { EntryPoint, ExecutionTerminalResult } from "../../src/shared/execution-types";
import type { CallFrameBatch, FunctionPlan } from "../../src/shared/call-frame-types";
import type { ConditionPlan, DecisionBatch } from "../../src/shared/decision-types";
import type { ControlFlowBatch, ControlFlowPlan } from "../../src/shared/control-flow-types";
import type { ExpressionBatch, ExpressionPlan } from "../../src/shared/expression-types";
import type { TraceEvent } from "../../src/shared/trace-types";
import { interpretCallFrames } from "../../src/core/call-frame-interpreter";
import { interpretTrace } from "../../src/core/trace-interpreter";
import { createPyodideRuntime } from "../../src/worker/pyodide-runtime";

const limits = {
  maxTraceSteps: 240,
  maxContainerItems: 100,
  maxNestingDepth: 8,
  maxSnapshotBytes: 100_000,
  maxSessionBytes: 1_000_000,
  maxStdoutBytes: 10_000,
  hardTimeoutMs: 2_000,
  maxObjectNodes: 200,
  maxObjectAttributes: 20,
  maxObjectDepth: 32,
  maxExpressionEvents: 20_000,
  maxExpressionBytes: 2_000_000,
  maxDecisionEvents: 20_000,
  maxDecisionBytes: 2_000_000,
  maxControlFlowEvents: 20_000,
  maxControlFlowBytes: 2_000_000,
  maxCallFrameEvents: 20_000,
  maxCallFrameBytes: 2_000_000
};

interface Capture {
  events: TraceEvent[];
  functionPlan?: FunctionPlan;
  callFrameBatches: CallFrameBatch[];
  expressionPlan?: ExpressionPlan;
  expressionBatches: ExpressionBatch[];
  conditionPlan?: ConditionPlan;
  decisionBatches: DecisionBatch[];
  controlFlowPlan?: ControlFlowPlan;
  controlFlowBatches: ControlFlowBatch[];
  terminal?: ExecutionTerminalResult;
}

const runtime = createPyodideRuntime({
  indexURL: `${process.cwd()}/node_modules/pyodide/`,
  onTraceBatch: (_sessionId, events) => currentCapture?.events.push(...events),
  onFunctionPlan: (_sessionId, plan) => { if (currentCapture) currentCapture.functionPlan = plan; },
  onCallFrameBatch: (_sessionId, batches) => currentCapture?.callFrameBatches.push(...batches),
  onExpressionPlan: (_sessionId, plan) => { if (currentCapture) currentCapture.expressionPlan = plan; },
  onExpressionBatch: (_sessionId, batches) => currentCapture?.expressionBatches.push(...batches),
  onConditionPlan: (_sessionId, plan) => { if (currentCapture) currentCapture.conditionPlan = plan; },
  onDecisionBatch: (_sessionId, batches) => currentCapture?.decisionBatches.push(...batches),
  onControlFlowPlan: (_sessionId, plan) => { if (currentCapture) currentCapture.controlFlowPlan = plan; },
  onControlFlowBatch: (_sessionId, batches) => currentCapture?.controlFlowBatches.push(...batches),
  onFinished: (result) => { if (currentCapture) currentCapture.terminal = result; }
});

let currentCapture: Capture | null = null;

async function run(
  sourceCode: string,
  rawTestcase: string,
  entrypoint: EntryPoint,
  overrides: Partial<typeof limits> = {}
): Promise<Capture> {
  const capture: Capture = {
    events: [],
    callFrameBatches: [],
    expressionBatches: [],
    decisionBatches: [],
    controlFlowBatches: []
  };
  currentCapture = capture;
  try {
    await runtime.execute({
      sessionId: `call-frame-e2e-${Math.random()}`,
      sourceCode,
      rawTestcase,
      entrypoint,
      limits: { ...limits, ...overrides }
    });
  } finally {
    currentCapture = null;
  }
  return capture;
}

function callFrameModel(capture: Capture) {
  const terminal = capture.terminal!;
  return interpretCallFrames({
    events: capture.events,
    functionPlan: capture.functionPlan ?? terminal.functionPlan,
    batches: capture.callFrameBatches.length > 0 ? capture.callFrameBatches : terminal.callFrameBatches,
    tracingState: terminal.callFrameTracing,
    terminationReason: terminal.terminationReason
  });
}

function interpretation(capture: Capture) {
  const terminal = capture.terminal!;
  return interpretTrace(
    capture.events,
    [],
    capture.expressionPlan ?? terminal.expressionPlan,
    capture.expressionBatches.length > 0 ? capture.expressionBatches : terminal.expressionBatches ?? [],
    capture.conditionPlan ?? terminal.conditionPlan,
    capture.decisionBatches.length > 0 ? capture.decisionBatches : terminal.decisionBatches ?? [],
    capture.controlFlowPlan ?? terminal.controlFlowPlan,
    capture.controlFlowBatches.length > 0 ? capture.controlFlowBatches : terminal.controlFlowBatches ?? [],
    { status: terminal.status, terminationReason: terminal.terminationReason },
    capture.functionPlan ?? terminal.functionPlan,
    capture.callFrameBatches.length > 0 ? capture.callFrameBatches : terminal.callFrameBatches ?? [],
    terminal.callFrameTracing
  );
}

function enterFunctionNames(capture: Capture): string[] {
  const plan = capture.functionPlan ?? capture.terminal?.functionPlan;
  const descriptors = new Map(plan?.functions.map((descriptor) => [descriptor.functionId, descriptor.qualifiedName]));
  return capture.callFrameBatches
    .flatMap((batch) => batch.updates)
    .filter((update) => update.kind === "frame_enter")
    .map((update) => descriptors.get(update.functionId ?? "") ?? "unmapped");
}

describe("call-frame evidence end to end", () => {
  it("maps class methods and recursive helper occurrences after all instrumentation", async () => {
    const capture = await run(
      `class Solution:
    def solve(self, n):
        return self.helper(n)

    def helper(self, n):
        if n <= 0:
            return 0
        return self.helper(n - 1) + 1
`,
      "3",
      { className: "Solution", methodName: "solve", parameterCount: 1, parameterKinds: ["value"] }
    );

    expect(capture.terminal?.status).toBe("completed");
    expect(enterFunctionNames(capture)).toEqual([
      "Solution.solve",
      "Solution.helper",
      "Solution.helper",
      "Solution.helper",
      "Solution.helper"
    ]);

    const model = callFrameModel(capture);
    const frames = [...model.byFrameId.values()];
    const helperFrames = frames.filter((frame) => frame.functionName === "helper");
    expect(model.roots).toHaveLength(1);
    expect(frames.map((frame) => frame.frameId)).toHaveLength(new Set(frames.map((frame) => frame.frameId)).size);
    expect(helperFrames.map((frame) => frame.recursion.recursionDepth)).toEqual([1, 2, 3, 4]);
    expect(helperFrames.every((frame) => frame.recursion.isRecursive === (frame.recursion.recursionDepth > 1))).toBe(true);
    expect(helperFrames.map((frame) => frame.exit)).toEqual([
      expect.objectContaining({ status: "returned", value: { type: "int", value: "3" } }),
      expect.objectContaining({ status: "returned", value: { type: "int", value: "2" } }),
      expect.objectContaining({ status: "returned", value: { type: "int", value: "1" } }),
      expect.objectContaining({ status: "returned", value: { type: "int", value: "0" } })
    ]);
    expect(capture.events.map((event) => event.step)).toEqual(
      [...capture.events].map((event) => event.step).sort((left, right) => left - right)
    );
  });

  it("maps nested helpers by lexical identity instead of function name", async () => {
    const capture = await run(
      `class Solution:
    def solve(self, n):
        def helper(k):
            if k == 0:
                return 1
            return helper(k - 1)
        return helper(n)
`,
      "2",
      { className: "Solution", methodName: "solve", parameterCount: 1, parameterKinds: ["value"] }
    );

    expect(capture.terminal?.status).toBe("completed");
    expect(enterFunctionNames(capture)).toEqual([
      "Solution.solve",
      "Solution.solve.helper",
      "Solution.solve.helper",
      "Solution.solve.helper"
    ]);
  });

  it("captures binary-tree arguments and recursive subtree frames", async () => {
    const capture = await run(
      `class Solution:
    def maxDepth(self, root):
        if root is None:
            return 0
        return max(self.maxDepth(root.left), self.maxDepth(root.right)) + 1
`,
      "[3, 9, 20, null, null, 15, 7]",
      { className: "Solution", methodName: "maxDepth", parameterCount: 1, parameterKinds: ["binary_tree"] }
    );

    const model = callFrameModel(capture);
    const frames = [...model.byFrameId.values()];
    const rootFrame = model.byFrameId.get(model.roots[0]!);
    const rootArgument = rootFrame?.arguments.find((argument) => argument.name === "root");

    expect(capture.terminal?.status).toBe("completed");
    expect(capture.terminal?.returnValue).toEqual({ type: "int", value: "3" });
    expect(model.roots).toHaveLength(1);
    expect(rootFrame?.functionName).toBe("maxDepth");
    expect(rootArgument?.value).toEqual(expect.objectContaining({
      type: "reference",
      className: "TreeNode"
    }));
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((frame) => frame.functionId === rootFrame?.functionId)).toBe(true);
    expect(frames.every((frame) =>
      frame.frameId === rootFrame?.frameId || model.byFrameId.has(frame.parentFrameId!)
    )).toBe(true);
    expect(rootFrame?.childFrameIds.length).toBe(2);
  });

  it("keeps sequential same-named helpers in distinct lexical parents", async () => {
    const capture = await run(
      `def outer(value):
    def visit(item):
        return item + 1
    return visit(value)

def other(value):
    def visit(item):
        return item + 2
    return visit(value)

class Solution:
    def solve(self, value):
        return outer(value) + other(value)
`,
      "3",
      { className: "Solution", methodName: "solve", parameterCount: 1, parameterKinds: ["value"] }
    );

    expect(capture.terminal?.status).toBe("completed");
    expect(enterFunctionNames(capture)).toEqual([
      "Solution.solve",
      "outer",
      "outer.visit",
      "other",
      "other.visit"
    ]);

    const model = callFrameModel(capture);
    const outer = [...model.byFrameId.values()].find((frame) => frame.functionName === "outer");
    const other = [...model.byFrameId.values()].find((frame) => frame.functionName === "other");
    expect(outer).toBeDefined();
    expect(other).toBeDefined();
    expect(outer?.frameId).not.toBe(other?.frameId);
    expect(outer?.recursion.isRecursive).toBe(false);
    expect(other?.recursion.isRecursive).toBe(false);
    expect(model.byFrameId.get(outer!.childFrameIds[0]!)?.functionName).toBe("visit");
    expect(model.byFrameId.get(other!.childFrameIds[0]!)?.functionName).toBe("visit");
  });

  it("captures mutual recursion as a function-identity cycle", async () => {
    const capture = await run(
      `def even(value):
    if value == 0:
        return True
    return odd(value - 1)

def odd(value):
    if value == 0:
        return False
    return even(value - 1)

class Solution:
    def solve(self, value):
        return even(value)
`,
      "4",
      { className: "Solution", methodName: "solve", parameterCount: 1, parameterKinds: ["value"] }
    );

    const model = callFrameModel(capture);
    const cycle = [...model.byFrameId.values()].find(
      (frame) => frame.functionName === "even" && frame.recursion.isRecursive
    );
    const plan = capture.functionPlan ?? capture.terminal?.functionPlan;
    const namesById = new Map(plan?.functions.map((descriptor) => [descriptor.functionId, descriptor.name]));

    expect(capture.terminal?.status).toBe("completed");
    expect(cycle).toBeDefined();
    expect(cycle?.recursion.cycleFunctionIds?.map((functionId) => namesById.get(functionId))).toEqual([
      "even",
      "odd",
      "even"
    ]);
  });

  it("keeps handled exceptions as normal returns", async () => {
    const capture = await run(
      `class Solution:
    def solve(self, value):
        return self.helper(value)

    def helper(self, value):
        try:
            return 10 // value
        except ZeroDivisionError:
            return 7
`,
      "0",
      { className: "Solution", methodName: "solve", parameterCount: 1, parameterKinds: ["value"] }
    );

    const model = callFrameModel(capture);
    const helper = [...model.byFrameId.values()].find((frame) => frame.functionName === "helper");

    expect(capture.terminal?.status).toBe("completed");
    expect(capture.events.some((event) => event.event === "exception")).toBe(true);
    expect(helper?.exit).toEqual({ status: "returned", step: expect.any(Number), value: { type: "int", value: "7" } });
  });

  it("classifies propagated exceptions for every unwinding user frame", async () => {
    const capture = await run(
      `class Solution:
    def solve(self):
        return self.middle()

    def middle(self):
        return self.inner()

    def inner(self):
        raise ValueError("boom")
`,
      "",
      { className: "Solution", methodName: "solve", parameterCount: 0, parameterKinds: [] }
    );

    const model = callFrameModel(capture);
    const userFrames = [...model.byFrameId.values()];

    expect(capture.terminal?.status).toBe("exception");
    expect(capture.terminal?.exception).toEqual(expect.objectContaining({ type: "ValueError", message: "boom" }));
    expect(userFrames.map((frame) => frame.functionName)).toEqual(["solve", "middle", "inner"]);
    expect(userFrames.every((frame) =>
      frame.exit.status === "exception" && frame.exit.exception.type === "ValueError"
    )).toBe(true);
  });

  it("indexes recursive loop, decision, and expression evidence by concrete frame", async () => {
    const capture = await run(
      `class Solution:
    def solve(self, value):
        return self.visit(value)

    def visit(self, value):
        if value <= 0:
            return 0
        total = value
        for item in [value]:
            total += item
        return total + self.visit(value - 1)
`,
      "2",
      { className: "Solution", methodName: "solve", parameterCount: 1, parameterKinds: ["value"] }
    );

    const interpreted = interpretation(capture);
    const visitFrames = [...interpreted.callFrames.byFrameId.values()].filter(
      (frame) => frame.functionName === "visit"
    );
    const indexedVisitFrames = visitFrames.map((frame) => interpreted.frameEvidenceIndex.get(frame.frameId));

    expect(visitFrames.length).toBeGreaterThan(1);
    expect(interpreted.decisionEvidence.size).toBeGreaterThan(0);
    expect(interpreted.expressionEvidence.size).toBeGreaterThan(0);
    expect(interpreted.controlFlow.iterations.length).toBeGreaterThan(0);
    expect(indexedVisitFrames.every((entry) => entry !== undefined)).toBe(true);
    for (const evidence of interpreted.decisionEvidence.values()) {
      expect(interpreted.frameEvidenceIndex.get(evidence.frameId)?.decisionAnchors).toContain(evidence.anchorStep);
    }
    for (const evidence of interpreted.expressionEvidence.values()) {
      expect(interpreted.frameEvidenceIndex.get(evidence.frameId)?.expressionAnchors).toContain(evidence.anchorStep);
    }
    for (const iteration of interpreted.controlFlow.iterations) {
      expect(interpreted.frameEvidenceIndex.get(iteration.frameId)?.controlFlowIterationRefs).toEqual(
        expect.arrayContaining([expect.objectContaining({
          loopId: iteration.loopId,
          iteration: iteration.iteration,
          anchorStepStart: iteration.anchorStepStart
        })])
      );
    }
    const visitFrameIds = new Set(visitFrames.map((frame) => frame.frameId));
    for (const entry of indexedVisitFrames) {
      expect(entry?.decisionAnchors.every((step) => {
        const evidence = interpreted.decisionEvidence.get(step);
        return evidence !== undefined && visitFrameIds.has(evidence.frameId);
      })).toBe(true);
      expect(entry?.expressionAnchors.every((step) => {
        const evidence = interpreted.expressionEvidence.get(step);
        return evidence !== undefined && visitFrameIds.has(evidence.frameId);
      })).toBe(true);
    }
  });

  it("projects active frames as trace-ended at the raw trace limit", async () => {
    const capture = await run(
      `class Solution:
    def solve(self, value):
        return self.loop(value)

    def loop(self, value):
        return self.loop(value + 1)
`,
      "0",
      { className: "Solution", methodName: "solve", parameterCount: 1, parameterKinds: ["value"] },
      { maxTraceSteps: 25 }
    );

    const model = callFrameModel(capture);
    const frames = [...model.byFrameId.values()];

    expect(capture.terminal?.status).toBe("trace_limit");
    expect(model.tracingState.status).toBe("complete");
    expect(frames.some((frame) => frame.exit.status === "trace_ended")).toBe(true);
    expect(frames.some((frame) => frame.exit.status === "returned")).toBe(false);
  });

  it("truncates call-frame evidence independently while raw tracing continues", async () => {
    const capture = await run(
      `class Solution:
    def solve(self, value):
        total = 0
        for item in range(value):
            total += item
        return total
`,
      "5",
      { className: "Solution", methodName: "solve", parameterCount: 1, parameterKinds: ["value"] },
      { maxCallFrameEvents: 1 }
    );

    const model = callFrameModel(capture);

    expect(capture.terminal?.status).toBe("completed");
    expect(capture.events.length).toBeGreaterThan(1);
    expect(capture.terminal?.callFrameTracing).toEqual({
      status: "truncated",
      reason: "call_frame_event_limit"
    });
    expect(model.byFrameId.size).toBe(1);
    expect([...model.byFrameId.values()][0]?.exit.status).toBe("trace_ended");
  });
});
