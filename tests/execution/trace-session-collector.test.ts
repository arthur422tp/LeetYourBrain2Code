import { describe, expect, it } from "vitest";

import type {
  EntryPoint,
  ExecutionLimits,
  ExecutionRequest,
  ExecutionTerminalResult
} from "../../src/shared/execution-types";
import type { TraceEvent } from "../../src/shared/trace-types";
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
  hardTimeoutMs: 20
};

const entrypoint: EntryPoint = {
  className: "Solution",
  methodName: "one",
  parameterCount: 1
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

function terminalResult(): ExecutionTerminalResult {
  return {
    status: "completed",
    terminationReason: "normal_return",
    stdout: "hello",
    durationMs: 4,
    returnValue: { type: "int", value: "1" }
  };
}

function createCollectorOptions(): TraceSessionCollectorOptions {
  return {
    sessionId: request.sessionId,
    sourceCode: request.sourceCode,
    rawTestcase: request.rawTestcase,
    entrypoint,
    limits
  };
}

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
    const controller = new ExecutionController({
      workerFactory: () => new FakeWorker(true)
    });

    const session = await controller.execute(request);

    expect(session.events).toHaveLength(100);
    expect(session.status).toBe("completed");
    expect(session.returnValue).toEqual({ type: "int", value: "1" });
  });
});
