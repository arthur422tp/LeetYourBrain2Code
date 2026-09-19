import { describe, expect, it } from "vitest";

import type { EntryPoint, ExecutionTerminalResult } from "../../src/shared/execution-types";
import type { CallFrameBatch, FunctionPlan } from "../../src/shared/call-frame-types";
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
  functionPlan?: FunctionPlan;
  callFrameBatches: CallFrameBatch[];
  terminal?: ExecutionTerminalResult;
}

const runtime = createPyodideRuntime({
  indexURL: `${process.cwd()}/node_modules/pyodide/`,
  onFunctionPlan: (_sessionId, plan) => { if (currentCapture) currentCapture.functionPlan = plan; },
  onCallFrameBatch: (_sessionId, batches) => currentCapture?.callFrameBatches.push(...batches),
  onFinished: (result) => { if (currentCapture) currentCapture.terminal = result; }
});

let currentCapture: Capture | null = null;

async function run(sourceCode: string, rawTestcase: string, entrypoint: EntryPoint): Promise<Capture> {
  const capture: Capture = { callFrameBatches: [] };
  currentCapture = capture;
  try {
    await runtime.execute({
      sessionId: `call-frame-e2e-${Math.random()}`,
      sourceCode,
      rawTestcase,
      entrypoint,
      limits
    });
  } finally {
    currentCapture = null;
  }
  return capture;
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
  });
});
