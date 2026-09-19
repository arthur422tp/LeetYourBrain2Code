import { describe, expect, it } from "vitest";

import { interpretTrace } from "../../src/core/trace-interpreter";
import type { EntryPoint, ExecutionTerminalResult } from "../../src/shared/execution-types";
import type { ConditionPlan, DecisionBatch } from "../../src/shared/decision-types";
import type { TraceEvent } from "../../src/shared/trace-types";
import { createPyodideRuntime } from "../../src/worker/pyodide-runtime";

const limits = {
  maxTraceSteps: 120,
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
  maxControlFlowBytes: 2_000_000,
  maxCallFrameEvents: 20_000,
  maxCallFrameBytes: 2_000_000
};

function entrypoint(methodName: string, parameterCount: number, parameterKinds: EntryPoint["parameterKinds"]): EntryPoint {
  return { className: "Solution", methodName, parameterCount, parameterKinds };
}

interface RunResult {
  terminal: ExecutionTerminalResult;
  events: TraceEvent[];
  plan: ConditionPlan;
  batches: DecisionBatch[];
  interpretation: ReturnType<typeof interpretTrace>;
}

interface ActiveRun {
  events: TraceEvent[];
  plans: ConditionPlan[];
  batches: DecisionBatch[];
  terminal?: ExecutionTerminalResult;
}

let activeRun: ActiveRun | null = null;
const sharedRuntime = createPyodideRuntime({
  indexURL: `${process.cwd()}/node_modules/pyodide/`,
  onTraceBatch: (_id, events) => activeRun?.events.push(...events),
  onConditionPlan: (_id, plan) => activeRun?.plans.push(plan),
  onDecisionBatch: (_id, batches) => activeRun?.batches.push(...batches),
  onFinished: (result) => {
    if (activeRun) activeRun.terminal = result;
  }
});

async function run(
  sessionId: string,
  sourceCode: string,
  rawTestcase: string,
  point: EntryPoint,
  overrides: Partial<typeof limits> = {}
): Promise<RunResult> {
  const capture: ActiveRun = { events: [], plans: [], batches: [] };
  activeRun = capture;
  try {
    await sharedRuntime.execute({
      sessionId,
      sourceCode,
      rawTestcase,
      entrypoint: point,
      limits: { ...limits, ...overrides }
    });
  } finally {
    activeRun = null;
  }
  const result = capture.terminal!;
  const plan = capture.plans[0] ?? result.conditionPlan!;
  const capturedBatches = capture.batches.length > 0 ? capture.batches : result.decisionBatches ?? [];
  const interpretation = interpretTrace(
    capture.events,
    result.subscriptRelations ?? [],
    undefined,
    [],
    plan,
    capturedBatches
  );
  return { terminal: result, events: capture.events, plan, batches: capturedBatches, interpretation };
}

describe("decision tracing end to end", () => {
  it("replays binary-search branches and projects nums[mid]", async () => {
    const result = await run(
      "decision-e2e-binary",
      `class Solution:
    def search(self, nums, target):
        if target == -1:
            pass
        elif target == 6:
            pass
        else:
            pass
        left, right = 0, len(nums) - 1
        while left <= right:
            mid = (left + right) // 2
            if nums[mid] < target:
                left = mid + 1
            elif nums[mid] > target:
                right = mid - 1
            else:
                return mid
        return -1
`,
      "[1, 3, 5, 7, 9]\n6",
      entrypoint("search", 2, ["value", "value"])
    );

    expect(result.terminal.status).toBe("completed");
    const whileSite = result.plan.sites.find((site) => site.kind === "while")!;
    expect(result.batches.filter((batch) => batch.siteId === whileSite.siteId).length).toBeGreaterThan(1);
    const chain = result.interpretation.decisionChains[0];
    expect(chain?.branches.map((branch) => branch.status)).toEqual([
      "rejected", "selected", "not_reached"
    ]);
    const midReference = [...result.interpretation.decisionEvidence.values()]
      .flatMap((evidence) => evidence.structureReferences)
      .find((reference) => reference.variableName === "nums");
    expect(midReference).toEqual(expect.objectContaining({ kind: "list_index", rawIndex: expect.any(Number) }));
  });

  it("records a false first child and short-circuits an unsafe second child", async () => {
    const result = await run(
      "decision-e2e-short-circuit",
      `class Solution:
    def check(self, nums, target):
        i = len(nums)
        if i < len(nums) and nums[i] == target:
            return True
        return False
`,
      "[1, 2]\n2",
      entrypoint("check", 2, ["value", "value"])
    );

    expect(result.terminal.status).toBe("completed");
    const evidence = [...result.interpretation.decisionEvidence.values()][0]!;
    expect(evidence.context).toEqual(result.batches[0]!.context ?? { loopStack: [] });
    expect(evidence.condition.children[0]?.truth).toBe(false);
    expect(evidence.condition.children[1]?.status).toBe("short_circuited");
    expect(result.terminal.exception).toBeUndefined();
  });

  it("keeps nested while histories independent by site id", async () => {
    const result = await run(
      "decision-e2e-nested-while",
      `class Solution:
    def count(self, limit):
        i = 0
        total = 0
        while i < limit:
            j = 0
            while j < 2:
                total += 1
                j += 1
            i += 1
        return total
`,
      "3",
      entrypoint("count", 1, ["value"])
    );

    const whileSites = result.plan.sites.filter((site) => site.kind === "while").map((site) => site.siteId);
    expect(whileSites).toHaveLength(2);
    for (const siteId of whileSites) {
      const history = result.interpretation.decisionHistory.get(siteId) ?? [];
      expect(history.length, siteId).toBeGreaterThan(1);
      expect(new Set(history.map((entry) => entry.siteId))).toEqual(new Set([siteId]));
    }
  });

  it("captures linked-list and grid guard facts with structural references", async () => {
    const linkedList = await run(
      "decision-e2e-linked-list",
      `class Solution:
    def length(self, node):
        count = 0
        while node is not None:
            count += 1
            node = node.next
        return count
`,
      "[1, 2]",
      entrypoint("length", 1, ["linked_list"])
    );
    const loopHistory = linkedList.interpretation.decisionHistory.get("d1") ?? [];
    expect(loopHistory.at(-1)?.truth).toBe(false);
    expect(loopHistory.at(-1)?.outcome).toBe("loop_exited");

    const grid = await run(
      "decision-e2e-grid",
      `class Solution:
    def has(self, grid, r, c):
        if grid[r][c] == 1:
            return True
        return False
`,
      "[[0, 1]]\n0\n1",
      entrypoint("has", 3, ["value", "value", "value"])
    );
    expect(grid.interpretation.decisionEvidence.size).toBeGreaterThan(0);
    expect([...grid.interpretation.decisionEvidence.values()].some((evidence) =>
      evidence.structureReferences.some((reference) => reference.kind === "matrix_cell" && reference.row === 0 && reference.column === 1)
    )).toBe(true);
  });

  it("preserves completed decision batches before a trace limit and partial exception evidence", async () => {
    const limited = await run(
      "decision-e2e-limit",
      `class Solution:
    def loop(self):
        i = 0
        while True:
            i += 1
`,
      "",
      entrypoint("loop", 0, []),
      { maxTraceSteps: 30 }
    );
    expect(limited.terminal.status).toBe("trace_limit");
    expect(limited.batches.length).toBeGreaterThan(0);

    const partial = await run(
      "decision-e2e-partial",
      `class Solution:
    def fail(self):
        if True and missing_name:
            return 1
        return 0
`,
      "",
      entrypoint("fail", 0, [])
    );
    expect(partial.terminal.status).toBe("exception");
    expect(partial.batches.at(-1)?.status).toBe("partial");
    expect(partial.batches.at(-1)?.outcome).toBeUndefined();
  });
});
