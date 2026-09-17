import { describe, expect, it } from "vitest";

import type { ExecutionRequest } from "../../src/shared/execution-types";
import type {
  ExecutionTerminalResult
} from "../../src/shared/execution-types";
import type { TraceEvent } from "../../src/shared/trace-types";
import type { ExpressionBatch, ExpressionPlan } from "../../src/shared/expression-types";
import type { ConditionPlan, DecisionBatch } from "../../src/shared/decision-types";
import type {
  PyodideRuntime,
  PyodideRuntimeOptions
} from "../../src/worker/pyodide-runtime";
import {
  createWorkerRuntime,
  installPyodideWorker,
  type WorkerScopeLike
} from "../../src/worker/pyodide-worker";

const request: ExecutionRequest = {
  sessionId: "worker-session",
  sourceCode: "class Solution:\n    def one(self, value):\n        return value",
  rawTestcase: "1",
  entrypoint: {
    className: "Solution",
    methodName: "one",
    parameterCount: 1,
    parameterKinds: ["value"]
  },
  limits: {
    maxTraceSteps: 100,
    maxContainerItems: 100,
    maxNestingDepth: 8,
    maxSnapshotBytes: 10_000,
    maxSessionBytes: 100_000,
    maxStdoutBytes: 1_000,
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
  }
};

const expressionPlan: ExpressionPlan = { version: 1, roots: [], expressions: [] };
const expressionBatch: ExpressionBatch = {
  batchId: 1,
  anchorStep: 1,
  frameId: 1,
  line: 1,
  roots: []
};
const conditionPlan: ConditionPlan = { version: 1, sites: [], conditions: [], operands: [], chains: [] };
const decisionBatch: DecisionBatch = {
  batchId: 1, anchorStep: 1, frameId: 1, siteId: "d1", occurrence: 1, status: "completed",
  condition: { conditionId: "d1.c0", evaluations: [], conditionResults: [{ conditionId: "d1.c0", order: 1, truth: true }], truth: true },
  outcome: "branch_entered"
};

describe("Pyodide worker", () => {
  it("boots the runtime and forwards execute requests", async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const posted: unknown[] = [];
    const calls: ExecutionRequest[] = [];
    const runtime: PyodideRuntime = {
      initialize: async () => undefined,
      execute: async (received) => {
        calls.push(received);
      }
    };
    const scope: WorkerScopeLike = {
      addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => {
        listeners.push(listener);
      },
      removeEventListener: (_type: "message", _listener: (event: MessageEvent) => void) => undefined,
      postMessage: (message) => {
        posted.push(message);
      }
    };

    const cleanup = installPyodideWorker(scope, runtime);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await listeners[0]!(new MessageEvent("message", { data: { type: "execute", request } }));

    expect(posted).toEqual([{ type: "ready" }]);
    expect(calls).toEqual([request]);
    cleanup();
  });

  it("reports initialization failure as a worker error", async () => {
    const posted: unknown[] = [];
    const runtime: PyodideRuntime = {
      initialize: async () => {
        throw new Error("cannot initialize");
      },
      execute: async () => undefined
    };
    const scope: WorkerScopeLike = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      postMessage: (message) => {
        posted.push(message);
      }
    };

    installPyodideWorker(scope, runtime);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(posted).toEqual([{ type: "worker_error", message: "cannot initialize" }]);
  });

  it("forwards expression evidence before terminal results to the worker scope", () => {
    const posted: unknown[] = [];
    const scope: WorkerScopeLike = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      postMessage: (message) => {
        posted.push(message);
      }
    };
    let callbacks: PyodideRuntimeOptions | undefined;
    const fakeRuntime: PyodideRuntime = {
      initialize: async () => undefined,
      execute: async () => undefined
    };
    const trace: TraceEvent = {
      step: 1,
      event: "line",
      frameId: 1,
      parentFrameId: null,
      function: "one",
      line: 1,
      callDepth: 1,
      locals: {},
      stdoutDelta: ""
    };
    const result: ExecutionTerminalResult = {
      status: "completed",
      terminationReason: "normal_return",
      stdout: "",
      durationMs: 1
    };

    createWorkerRuntime(
      scope,
      (options) => {
        callbacks = options;
        return fakeRuntime;
      },
      () => "worker-session"
    );
    callbacks?.onExpressionPlan?.("worker-session", expressionPlan);
    callbacks?.onExpressionBatch?.("worker-session", [expressionBatch]);
    callbacks?.onConditionPlan?.("worker-session", conditionPlan);
    callbacks?.onDecisionBatch?.("worker-session", [decisionBatch]);
    callbacks?.onTraceBatch?.("worker-session", [trace]);
    callbacks?.onFinished?.(result);

    expect(posted).toEqual([
      { type: "expression_plan", sessionId: "worker-session", plan: expressionPlan },
      { type: "expression_batch", sessionId: "worker-session", batches: [expressionBatch] },
      { type: "condition_plan", sessionId: "worker-session", plan: conditionPlan },
      { type: "decision_batch", sessionId: "worker-session", batches: [decisionBatch] },
      { type: "trace_batch", sessionId: "worker-session", events: [trace] },
      { type: "execution_finished", sessionId: "worker-session", result }
    ]);
  });

  it("forwards multiple sequential requests through one initialized runtime", async () => {
    const listeners: Array<(event: MessageEvent) => void | Promise<void>> = [];
    const posted: unknown[] = [];
    const calls: ExecutionRequest[] = [];
    let initializeCount = 0;
    const runtime: PyodideRuntime = {
      initialize: async () => {
        initializeCount += 1;
      },
      execute: async (received) => {
        calls.push(received);
      }
    };
    const scope: WorkerScopeLike = {
      addEventListener: (_type, listener) => {
        listeners.push(listener);
      },
      removeEventListener: () => undefined,
      postMessage: (message) => {
        posted.push(message);
      }
    };

    installPyodideWorker(scope, runtime);
    await Promise.resolve();

    const first = { ...request, sessionId: "first" };
    const second = { ...request, sessionId: "second" };
    await listeners[0]!(new MessageEvent("message", {
      data: { type: "execute", request: first }
    }));
    await listeners[0]!(new MessageEvent("message", {
      data: { type: "execute", request: second }
    }));

    expect(initializeCount).toBe(1);
    expect(posted[0]).toEqual({ type: "ready" });
    expect(calls.map((item) => item.sessionId)).toEqual(["first", "second"]);
  });
});
