import { describe, expect, it } from "vitest";

import { interpretTrace } from "../../src/core/trace-interpreter";
import type { EntryPoint, ExecutionTerminalResult } from "../../src/shared/execution-types";
import type { ControlFlowBatch, ControlFlowPlan } from "../../src/shared/control-flow-types";
import type { ConditionPlan, DecisionBatch } from "../../src/shared/decision-types";
import type { ExpressionBatch, ExpressionPlan } from "../../src/shared/expression-types";
import type { TraceEvent } from "../../src/shared/trace-types";
import { createPyodideRuntime } from "../../src/worker/pyodide-runtime";

const limits = {
  maxTraceSteps: 240,
  maxContainerItems: 100,
  maxNestingDepth: 8,
  maxSnapshotBytes: 100_000,
  maxSessionBytes: 1_000_000,
  maxStdoutBytes: 10_000,
  hardTimeoutMs: 1_000,
  maxObjectNodes: 200,
  maxObjectAttributes: 20,
  maxObjectDepth: 32,
  maxExpressionEvents: 20_000,
  maxExpressionBytes: 2_000_000,
  maxDecisionEvents: 20_000,
  maxDecisionBytes: 2_000_000,
  maxControlFlowEvents: 20_000,
  maxControlFlowBytes: 2_000_000
};

function entrypoint(methodName: string, parameterCount: number, parameterKinds: EntryPoint["parameterKinds"]): EntryPoint {
  return { className: "Solution", methodName, parameterCount, parameterKinds };
}

interface Capture {
  events: TraceEvent[];
  controlPlans: ControlFlowPlan[];
  controlBatches: ControlFlowBatch[];
  decisionPlans: ConditionPlan[];
  decisionBatches: DecisionBatch[];
  expressionPlans: ExpressionPlan[];
  expressionBatches: ExpressionBatch[];
  terminal?: ExecutionTerminalResult;
}

const runtime = createPyodideRuntime({
  indexURL: `${process.cwd()}/node_modules/pyodide/`,
  onTraceBatch: (_sessionId, events) => currentCapture?.events.push(...events),
  onControlFlowPlan: (_sessionId, plan) => currentCapture?.controlPlans.push(plan),
  onControlFlowBatch: (_sessionId, batches) => currentCapture?.controlBatches.push(...batches),
  onConditionPlan: (_sessionId, plan) => currentCapture?.decisionPlans.push(plan),
  onDecisionBatch: (_sessionId, batches) => currentCapture?.decisionBatches.push(...batches),
  onExpressionPlan: (_sessionId, plan) => currentCapture?.expressionPlans.push(plan),
  onExpressionBatch: (_sessionId, batches) => currentCapture?.expressionBatches.push(...batches),
  onFinished: (result) => { if (currentCapture) currentCapture.terminal = result; }
});

let currentCapture: Capture | null = null;

async function run(sessionId: string, sourceCode: string, rawTestcase: string, point: EntryPoint, overrides: Partial<typeof limits> = {}) {
  const capture: Capture = { events: [], controlPlans: [], controlBatches: [], decisionPlans: [], decisionBatches: [], expressionPlans: [], expressionBatches: [] };
  currentCapture = capture;
  try {
    await runtime.execute({ sessionId, sourceCode, rawTestcase, entrypoint: point, limits: { ...limits, ...overrides } });
  } finally {
    currentCapture = null;
  }
  const terminal = capture.terminal!;
  const controlPlan = capture.controlPlans[0] ?? terminal.controlFlowPlan;
  const controlBatches = capture.controlBatches.length > 0 ? capture.controlBatches : terminal.controlFlowBatches ?? [];
  const decisionPlan = capture.decisionPlans[0] ?? terminal.conditionPlan;
  const decisionBatches = capture.decisionBatches.length > 0 ? capture.decisionBatches : terminal.decisionBatches ?? [];
  const expressionPlan = capture.expressionPlans[0] ?? terminal.expressionPlan;
  const expressionBatches = capture.expressionBatches.length > 0 ? capture.expressionBatches : terminal.expressionBatches ?? [];
  const interpretation = interpretTrace(
    capture.events,
    [],
    expressionPlan,
    expressionBatches,
    decisionPlan,
    decisionBatches,
    controlPlan,
    controlBatches,
    { status: terminal.status, terminationReason: terminal.terminationReason }
  );
  return { ...capture, terminal, controlPlan, controlBatches, interpretation };
}

describe("control-flow evidence end to end", () => {
  it("records for iterations, bindings, exhaustion, and committed return", async () => {
    const result = await run(
      "control-e2e-for",
      `class Solution:
    def total(self, nums):
        total = 0
        for x in nums:
            total += x
        return total
`,
      "[1, 2, 3]",
      entrypoint("total", 1, ["value"])
    );
    const events = result.controlBatches.flatMap((batch) => batch.events);
    expect(result.terminal.status).toBe("completed");
    expect(events.filter((event) => event.kind === "iteration_begin")).toHaveLength(3);
    expect(result.interpretation.controlFlow.iterations.map((item) => item.status)).toEqual(["completed", "completed", "completed"]);
    expect(result.interpretation.controlFlow.iterations.map((item) => item.bindings[0]?.value)).toEqual([
      { type: "int", value: "1" }, { type: "int", value: "2" }, { type: "int", value: "3" }
    ]);
    expect(result.interpretation.controlFlow.loopExits.some((exit) => exit.reason === "exhausted")).toBe(true);
    expect(result.interpretation.controlFlow.actions.some((action) => action.kind === "return" && action.status === "committed")).toBe(true);
  });

  it("distinguishes continued and broken iterations and preserves for-else behavior", async () => {
    const source = `class Solution:
    def scan(self, nums, limit):
        flag = 0
        for x in nums:
            if x < 0:
                continue
            if x > limit:
                break
            flag += 1
        else:
            flag = 99
        return flag
`;
    const broken = await run("control-e2e-break", source, "[-1, 2, 5]\n3", entrypoint("scan", 2, ["value", "value"]));
    expect(broken.terminal.returnValue).toEqual({ type: "int", value: "1" });
    expect(broken.interpretation.controlFlow.iterations.map((item) => item.status)).toEqual(["continued", "completed", "broke"]);
    expect(broken.interpretation.controlFlow.loopExits.some((exit) => exit.reason === "break")).toBe(true);
    expect(broken.interpretation.controlFlow.actions.filter((action) => action.kind === "break").some((action) => action.status === "committed")).toBe(true);

    const exhausted = await run("control-e2e-else", source, "[-1, 2]\n3", entrypoint("scan", 2, ["value", "value"]));
    expect(exhausted.terminal.returnValue).toEqual({ type: "int", value: "99" });
    expect(exhausted.interpretation.controlFlow.loopExits.some((exit) => exit.reason === "exhausted")).toBe(true);
  });

  it("aligns while body occurrences with condition-false exit", async () => {
    const result = await run("control-e2e-while", `class Solution:
    def count(self, n):
        left = 0
        while left < n:
            left += 1
        else:
            done = True
        return left
`, "3", entrypoint("count", 1, ["value"]));
    expect(result.terminal.returnValue).toEqual({ type: "int", value: "3" });
    expect(result.interpretation.controlFlow.iterations).toHaveLength(3);
    expect(result.interpretation.controlFlow.loopExits.some((exit) => exit.reason === "condition_false")).toBe(true);
    expect(result.decisionBatches.length).toBeGreaterThan(0);
  });

  it("captures nested loop context and per-occurrence decision chains", async () => {
    const result = await run("control-e2e-nested", `class Solution:
    def classify(self, matrix):
        total = 0
        for row in matrix:
            for value in row:
                if value < 0:
                    total += 1
                elif value == 0:
                    total += 2
                else:
                    total += 3
        return total
`, "[[1, 0], [-1, 2]]", entrypoint("classify", 1, ["value"]));
    const nested = result.interpretation.controlFlow.contextByStep;
    expect([...nested.values()].some((context) => context.loopStack.length === 2)).toBe(true);
    expect(result.interpretation.decisionChains.length).toBeGreaterThan(2);
    expect(new Set(result.interpretation.decisionChains.map((chain) => chain.context.loopStack.length))).toEqual(new Set([2]));
  });

  it("commits normal returns, preserves expression evidence, and handles finally overrides", async () => {
    const expression = await run("control-e2e-return", `class Solution:
    def find(self, nums):
        for i, value in enumerate(nums):
            return i + 1
        return
`, "[7]", entrypoint("find", 1, ["value"]));
    expect(expression.terminal.returnValue).toEqual({ type: "int", value: "1" });
    expect(expression.interpretation.controlFlow.actions.some((action) => action.kind === "return" && action.status === "committed")).toBe(true);
    expect(expression.interpretation.expressionEvidence.size).toBeGreaterThan(0);

    const bare = await run("control-e2e-bare-return", `class Solution:
    def find(self, value):
        return
`, "1", entrypoint("find", 1, ["value"]));
    expect(bare.terminal.returnValue).toEqual({ type: "none", value: null });
    expect(bare.interpretation.controlFlow.actions.some((action) => action.kind === "return" && action.status === "committed")).toBe(true);
    expect(bare.interpretation.expressionEvidence.size).toBe(0);

    const overridden = await run("control-e2e-finally", `class Solution:
    def choose(self):
        try:
            return 1
        finally:
            return 2
`, "", entrypoint("choose", 0, []));
    expect(overridden.terminal.returnValue).toEqual({ type: "int", value: "2" });
    expect(overridden.interpretation.controlFlow.actions.map((action) => action.status)).toEqual(["superseded", "committed"]);
  });

  it("keeps a trace-limit prefix and does not expose synthetic lifecycle lines", async () => {
    const source = `class Solution:
    def loop(self):
        i = 0
        while True:
            i += 1
`;
    const result = await run("control-e2e-limit", source, "", entrypoint("loop", 0, []), { maxTraceSteps: 28 });
    expect(result.terminal.status).toBe("trace_limit");
    expect(result.controlBatches.some((batch) => batch.events.some((event) => event.kind === "iteration_begin"))).toBe(true);
    expect(result.interpretation.controlFlow.iterations.some((iteration) => iteration.status === "interrupted")).toBe(true);
    expect(result.interpretation.controlFlow.loopExits.some((exit) => exit.reason === "trace_ended")).toBe(true);
    const sourceLineCount = source.split("\n").length;
    expect(result.events.every((event) => event.line === null || event.line <= sourceLineCount)).toBe(true);
  });
});
