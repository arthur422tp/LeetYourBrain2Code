import { describe, expect, it } from "vitest";

import type {
  EntryPoint,
  ExecutionLimits,
  ExecutionRequest,
  ExecutionTerminalResult
} from "../../src/shared/execution-types";
import type { TraceEvent } from "../../src/shared/trace-types";
import type { ExpressionBatch, ExpressionPlan } from "../../src/shared/expression-types";
import type { ConditionPlan, DecisionBatch } from "../../src/shared/decision-types";
import type { ControlFlowBatch, ControlFlowPlan } from "../../src/shared/control-flow-types";
import {
  TraceSessionCollector,
  type TraceSessionCollectorOptions
} from "../../src/execution/trace-session-collector";
import {
  ExecutionController,
  type WorkerLike
} from "../../src/execution/execution-controller";

const limits: ExecutionLimits = {
  maxTraceSteps: 10_000,
  maxContainerItems: 100,
  maxNestingDepth: 8,
  maxSnapshotBytes: 100_000,
  maxSessionBytes: 1_000_000,
  maxStdoutBytes: 10_000,
  hardTimeoutMs: 20,
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

const entrypoint: EntryPoint = {
  className: "Solution",
  methodName: "one",
  parameterCount: 1,
  parameterKinds: ["value"]
};

const request: ExecutionRequest = {
  sessionId: "session-collector",
  sourceCode: "class Solution: ...",
  rawTestcase: "1",
  entrypoint,
  limits
};

function event(step: number): TraceEvent {
  return {
    step,
    event: "line",
    frameId: 1,
    parentFrameId: null,
    function: "one",
    line: 1,
    callDepth: 1,
    locals: { value: { type: "int", value: String(step) } },
    stdoutDelta: step === 1 ? "hello" : ""
  };
}

function terminalResult(
  overrides: Partial<ExecutionTerminalResult> = {}
): ExecutionTerminalResult {
  return {
    status: "completed",
    terminationReason: "normal_return",
    stdout: "hello",
    durationMs: 4,
    returnValue: { type: "int", value: "1" },
    ...overrides
  };
}

function createCollectorOptions(overrides: Partial<TraceSessionCollectorOptions> = {}): TraceSessionCollectorOptions {
  return {
    sessionId: request.sessionId,
    sourceCode: request.sourceCode,
    rawTestcase: request.rawTestcase,
    entrypoint,
    limits,
    ...overrides
  };
}

const expressionPlan: ExpressionPlan = {
  version: 1,
  roots: [],
  expressions: []
};

const expressionBatch: ExpressionBatch = {
  batchId: 1,
  anchorStep: 1,
  frameId: 1,
  line: 1,
  roots: []
};

const conditionPlan: ConditionPlan = {
  version: 1,
  sites: [],
  conditions: [],
  operands: [],
  chains: []
};

const decisionBatch: DecisionBatch = {
  batchId: 4,
  anchorStep: 2,
  frameId: 1,
  siteId: "d1",
  occurrence: 1,
  status: "completed",
  condition: {
    conditionId: "d1.c0",
    evaluations: [],
    conditionResults: [{ conditionId: "d1.c0", order: 1, truth: false }],
    truth: false
  },
  outcome: "branch_not_entered"
};

const controlFlowPlan: ControlFlowPlan = { version: 1, loops: [], transfers: [] };
const controlFlowBatch: ControlFlowBatch = {
  batchId: 1,
  events: [{
    eventId: 1,
    kind: "loop_exit",
    anchorStep: 2,
    frameId: 1,
    context: { loopStack: [] },
    loopId: "f1",
    loopKind: "for",
    reason: "exhausted"
  }]
};

class FakeWorker implements WorkerLike {
  readonly posted: unknown[] = [];
  terminated = false;
  private messageListeners: Array<(event: MessageEvent) => void> = [];
  private errorListeners: Array<(event: ErrorEvent) => void> = [];
  private readonly finish: boolean;

  constructor(finish: boolean) {
    this.finish = finish;
  }

  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === "message") {
      this.messageListeners.push(listener as (event: MessageEvent) => void);
      if (this.messageListeners.length === 1) {
        queueMicrotask(() => this.emit({ type: "ready" }));
      }
    } else {
      this.errorListeners.push(listener as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === "message") {
      this.messageListeners = this.messageListeners.filter((candidate) => candidate !== listener);
    } else {
      this.errorListeners = this.errorListeners.filter((candidate) => candidate !== listener);
    }
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "execute"
    ) {
      queueMicrotask(() => {
        this.emit({ type: "trace_batch", sessionId: request.sessionId, events: Array.from({ length: 50 }, (_, index) => event(index + 1)) });
        this.emit({ type: "trace_batch", sessionId: request.sessionId, events: Array.from({ length: 50 }, (_, index) => event(index + 51)) });
        if (this.finish) {
          this.emit({ type: "execution_finished", sessionId: request.sessionId, result: terminalResult() });
        }
      });
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(data: unknown): void {
    const message = new MessageEvent("message", { data });
    for (const listener of this.messageListeners) {
      void listener(message);
    }
  }
}

class PartialWorker implements WorkerLike {
  private messageListeners: Array<(event: MessageEvent) => void> = [];
  private errorListeners: Array<(event: ErrorEvent) => void> = [];
  terminated = false;

  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === "message") {
      this.messageListeners.push(listener as (event: MessageEvent) => void);
      if (this.messageListeners.length === 1) {
        queueMicrotask(() => this.emit({ type: "ready" }));
      }
    } else {
      this.errorListeners.push(listener as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === "message") {
      this.messageListeners = this.messageListeners.filter((candidate) => candidate !== listener);
    } else {
      this.errorListeners = this.errorListeners.filter((candidate) => candidate !== listener);
    }
  }

  postMessage(message: unknown): void {
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "execute"
    ) {
      queueMicrotask(() =>
        this.emit({
          type: "trace_batch",
          sessionId: request.sessionId,
          events: [event(1), event(2)]
        })
      );
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(data: unknown): void {
    const message = new MessageEvent("message", { data });
    for (const listener of this.messageListeners) {
      void listener(message);
    }
  }
}

describe("TraceSessionCollector", () => {
  it("preserves batch order and carries terminal metadata into a session", () => {
    const collector = new TraceSessionCollector(createCollectorOptions());

    collector.append([event(1), event(2)]);
    const session = collector.finish(terminalResult());

    expect(session.events.map((item) => item.step)).toEqual([1, 2]);
    expect(session.status).toBe("completed");
    expect(session.terminationReason).toBe("normal_return");
    expect(session.stdout).toBe("hello");
    expect(session.entrypoint).toEqual(entrypoint);
  });

  it("carries static subscript relations into the session", () => {
    const collector = new TraceSessionCollector(createCollectorOptions());

    const relations = [
      { scope: "Solution.one", line: 3, container: "nums", index: "i" }
    ];
    const session = collector.finish(terminalResult({ subscriptRelations: relations }));

    expect(session.subscriptRelations).toEqual(relations);
    expect(session.subscriptRelations).not.toBe(relations);
  });

  it("preserves bounded object topology captured before a timeout", () => {
    const topologyEvent: TraceEvent = {
      ...event(1),
      locals: {
        head: { type: "reference", objectId: "obj-1", className: "ListNode" }
      },
      objects: [{
        objectId: "obj-1",
        className: "ListNode",
        attributes: {
          val: { type: "int", value: "1" },
          next: { type: "none", value: null }
        }
      }],
      objectsTruncated: true
    };
    const collector = new TraceSessionCollector(createCollectorOptions());

    collector.append([topologyEvent]);
    const session = collector.finish(terminalResult({
      status: "timeout",
      terminationReason: "hard_timeout"
    }));

    expect(session.events[0]?.objects).toEqual(topologyEvent.objects);
    expect(session.events[0]?.objectsTruncated).toBe(true);
    expect(session.status).toBe("timeout");
    expect(session.terminationReason).toBe("hard_timeout");
  });

  it("preserves streamed expression evidence without duplicate batches on timeout", () => {
    const collector = new TraceSessionCollector(createCollectorOptions());

    collector.setExpressionPlan(expressionPlan);
    collector.appendExpressionBatches([expressionBatch, expressionBatch]);
    const session = collector.forceTimeout();

    expect(session.status).toBe("timeout");
    expect(session.expressionPlan).toEqual(expressionPlan);
    expect(session.expressionBatches).toEqual([expressionBatch]);
  });

  it("preserves streamed decision evidence and de-duplicates terminal copies on timeout", () => {
    const collector = new TraceSessionCollector(createCollectorOptions());

    collector.setConditionPlan(conditionPlan);
    collector.appendDecisionBatches([decisionBatch, decisionBatch]);
    const session = collector.finish(terminalResult({
      conditionPlan,
      decisionBatches: [decisionBatch]
    }));

    expect(session.conditionPlan).toEqual(conditionPlan);
    expect(session.decisionBatches).toEqual([decisionBatch]);
  });

  it("truncates decision evidence independently from the ordinary session resource limit", () => {
    const collector = new TraceSessionCollector(createCollectorOptions({
      limits: { ...limits, maxDecisionBytes: 1 }
    }));
    collector.appendDecisionBatches([decisionBatch]);
    const session = collector.finish(terminalResult());

    expect(session.decisionBatches).toBeUndefined();
    expect(session.decisionTracing).toEqual({ status: "truncated", reason: "decision_byte_limit" });
    expect(session.status).toBe("completed");
  });

  it("preserves streamed control-flow prefixes and de-duplicates terminal copies", () => {
    const collector = new TraceSessionCollector(createCollectorOptions());
    collector.setControlFlowPlan(controlFlowPlan);
    collector.appendControlFlowBatches([controlFlowBatch]);
    collector.appendControlFlowBatches([controlFlowBatch, { ...controlFlowBatch, batchId: 2 }]);
    const session = collector.finish(terminalResult({
      controlFlowPlan,
      controlFlowBatches: [controlFlowBatch]
    }));
    expect(session.controlFlowPlan).toEqual(controlFlowPlan);
    expect(session.controlFlowBatches?.map((batch) => batch.batchId)).toEqual([1, 2]);
  });

  it("truncates control-flow bytes without changing raw trace status", () => {
    const collector = new TraceSessionCollector(createCollectorOptions({
      limits: { ...limits, maxControlFlowBytes: 1 }
    }));
    collector.appendControlFlowBatches([controlFlowBatch]);
    const session = collector.finish(terminalResult());
    expect(session.controlFlowBatches).toBeUndefined();
    expect(session.controlFlowTracing).toEqual({ status: "truncated", reason: "control_flow_byte_limit" });
    expect(session.status).toBe("completed");
  });

  it("keeps streamed control-flow evidence when hard timeout closes the session", () => {
    const collector = new TraceSessionCollector(createCollectorOptions());
    collector.setControlFlowPlan(controlFlowPlan);
    collector.appendControlFlowBatches([controlFlowBatch]);
    const session = collector.forceTimeout();
    expect(session.controlFlowPlan).toEqual(controlFlowPlan);
    expect(session.controlFlowBatches).toEqual([controlFlowBatch]);
  });

  it("keeps all received batches when the controller hard-times out", async () => {
    let worker: FakeWorker | undefined;
    const controller = new ExecutionController({
      workerFactory: () => {
        worker = new FakeWorker(false);
        return worker;
      }
    });

    const session = await controller.execute(request);

    expect(worker?.terminated).toBe(true);
    expect(session.events).toHaveLength(100);
    expect(session.events[0]?.step).toBe(1);
    expect(session.events.at(-1)?.step).toBe(100);
    expect(session.status).toBe("timeout");
    expect(session.terminationReason).toBe("hard_timeout");
  });

  it("keeps a partial received batch when the controller hard-times out", async () => {
    let worker: PartialWorker | undefined;
    const controller = new ExecutionController({
      workerFactory: () => {
        worker = new PartialWorker();
        return worker;
      }
    });

    const session = await controller.execute(request);

    expect(worker?.terminated).toBe(true);
    expect(session.events.map((item) => item.step)).toEqual([1, 2]);
    expect(session.status).toBe("timeout");
    expect(session.terminationReason).toBe("hard_timeout");
  });

  it("finishes normally when the worker sends a terminal result", async () => {
    let worker: FakeWorker | undefined;
    const controller = new ExecutionController({
      workerFactory: () => {
        worker = new FakeWorker(true);
        return worker;
      }
    });

    const session = await controller.execute(request);

    expect(session.events).toHaveLength(100);
    expect(session.status).toBe("completed");
    expect(session.returnValue).toEqual({ type: "int", value: "1" });
    expect(worker?.terminated).toBe(false);
    controller.dispose();
    expect(worker?.terminated).toBe(true);
  });
});
