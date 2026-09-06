import { describe, expect, it, vi } from "vitest";

import type {
  ExecutionRequest,
  ExecutionTerminalResult
} from "../../src/shared/execution-types";
import {
  ExecutionController,
  type WorkerLike
} from "../../src/execution/execution-controller";

function request(sessionId: string, hardTimeoutMs = 1_000): ExecutionRequest {
  return {
    sessionId,
    sourceCode: "class Solution:\n    def one(self, value):\n        return value",
    rawTestcase: "1",
    entrypoint: { className: "Solution", methodName: "one", parameterCount: 1 },
    limits: {
      maxTraceSteps: 100,
      maxContainerItems: 100,
      maxNestingDepth: 8,
      maxSnapshotBytes: 10_000,
      maxSessionBytes: 100_000,
      maxStdoutBytes: 1_000,
      hardTimeoutMs
    }
  };
}

const completed: ExecutionTerminalResult = {
  status: "completed",
  terminationReason: "normal_return",
  stdout: "",
  durationMs: 1
};

class ControlledWorker implements WorkerLike {
  readonly posted: unknown[] = [];
  terminateCount = 0;
  private messageListeners: Array<(event: MessageEvent) => void> = [];
  private errorListeners: Array<(event: ErrorEvent) => void> = [];

  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "message" | "error", listener: any): void {
    if (type === "message") this.messageListeners.push(listener);
    else this.errorListeners.push(listener);
  }

  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message" | "error", listener: any): void {
    if (type === "message") {
      this.messageListeners = this.messageListeners.filter((item) => item !== listener);
    } else {
      this.errorListeners = this.errorListeners.filter((item) => item !== listener);
    }
  }

  postMessage(message: any): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(data: unknown): void {
    const event = new MessageEvent("message", { data });
    for (const listener of [...this.messageListeners]) listener(event);
  }

  emitError(message: string): void {
    const event = new ErrorEvent("error", { message });
    for (const listener of [...this.errorListeners]) listener(event);
  }
}

describe("ExecutionController", () => {
  it("reuses one ready worker across sequential executions", async () => {
    const worker = new ControlledWorker();
    const workerFactory = vi.fn(() => worker);
    const controller = new ExecutionController({ workerFactory });

    const firstPromise = controller.execute(request("one"));
    worker.emit({ type: "ready" });
    await Promise.resolve();
    expect(worker.posted).toContainEqual({ type: "execute", request: request("one") });
    worker.emit({ type: "execution_finished", sessionId: "one", result: completed });
    await expect(firstPromise).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    const secondPromise = controller.execute(request("two"));
    await Promise.resolve();
    expect(worker.posted).toContainEqual({ type: "execute", request: request("two") });
    worker.emit({ type: "execution_finished", sessionId: "two", result: completed });
    await expect(secondPromise).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    expect(workerFactory).toHaveBeenCalledTimes(1);
    expect(worker.terminateCount).toBe(0);
    controller.dispose();
    expect(worker.terminateCount).toBe(1);
  });

  it("times out a request even if the worker never becomes ready and rebuilds on the next run", async () => {
    vi.useFakeTimers();
    try {
      const workers = [new ControlledWorker(), new ControlledWorker()];
      let workerIndex = 0;
      const workerFactory = vi.fn(() => workers[workerIndex++]!);
      const controller = new ExecutionController({ workerFactory });

      const first = controller.execute(request("slow-init", 20));
      await vi.advanceTimersByTimeAsync(20);
      await expect(first).resolves.toEqual(expect.objectContaining({
        status: "timeout",
        terminationReason: "hard_timeout"
      }));
      expect(workers[0]!.terminateCount).toBe(1);

      const second = controller.execute(request("recovered"));
      workers[1]!.emit({ type: "ready" });
      await Promise.resolve();
      workers[1]!.emit({
        type: "execution_finished",
        sessionId: "recovered",
        result: completed
      });
      await expect(second).resolves.toEqual(expect.objectContaining({ status: "completed" }));
      expect(workerFactory).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuilds after an initialization worker_error", async () => {
    const workers = [new ControlledWorker(), new ControlledWorker()];
    let workerIndex = 0;
    const controller = new ExecutionController({
      workerFactory: () => workers[workerIndex++]!
    });

    const failed = controller.execute(request("init-failure"));
    workers[0]!.emit({ type: "worker_error", message: "cannot initialize" });
    await expect(failed).resolves.toEqual(expect.objectContaining({
      status: "internal_error",
      terminationReason: "worker_initialization_failed"
    }));
    expect(workers[0]!.terminateCount).toBe(1);

    const recovered = controller.execute(request("after-init-failure"));
    workers[1]!.emit({ type: "ready" });
    await Promise.resolve();
    workers[1]!.emit({
      type: "execution_finished",
      sessionId: "after-init-failure",
      result: completed
    });
    await expect(recovered).resolves.toEqual(expect.objectContaining({ status: "completed" }));
  });

  it("rebuilds after a worker error event during execution", async () => {
    const workers = [new ControlledWorker(), new ControlledWorker()];
    let workerIndex = 0;
    const controller = new ExecutionController({
      workerFactory: () => workers[workerIndex++]!
    });

    const failed = controller.execute(request("crash"));
    workers[0]!.emit({ type: "ready" });
    await Promise.resolve();
    workers[0]!.emitError("worker crashed");
    await expect(failed).resolves.toEqual(expect.objectContaining({ status: "internal_error" }));
    expect(workers[0]!.terminateCount).toBe(1);

    const recovered = controller.execute(request("after-crash"));
    workers[1]!.emit({ type: "ready" });
    await Promise.resolve();
    workers[1]!.emit({
      type: "execution_finished",
      sessionId: "after-crash",
      result: completed
    });
    await expect(recovered).resolves.toEqual(expect.objectContaining({ status: "completed" }));
  });

  it("treats malformed worker output as an unrecoverable protocol error", async () => {
    const worker = new ControlledWorker();
    const controller = new ExecutionController({ workerFactory: () => worker });

    const failed = controller.execute(request("malformed"));
    worker.emit({ type: "ready" });
    await Promise.resolve();
    worker.emit({ unexpected: true });

    await expect(failed).resolves.toEqual(expect.objectContaining({ status: "internal_error" }));
    expect(worker.terminateCount).toBe(1);
  });

  it("keeps the worker after an ordinary Python runtime exception", async () => {
    const worker = new ControlledWorker();
    const workerFactory = vi.fn(() => worker);
    const controller = new ExecutionController({ workerFactory });
    const runtimeException: ExecutionTerminalResult = {
      status: "exception",
      terminationReason: "runtime_exception",
      stdout: "",
      durationMs: 1,
      exception: {
        type: "IndexError",
        message: "list index out of range",
        line: 3,
        stack: [],
        frameId: 1
      }
    };

    const first = controller.execute(request("exception"));
    worker.emit({ type: "ready" });
    await Promise.resolve();
    worker.emit({
      type: "execution_finished",
      sessionId: "exception",
      result: runtimeException
    });
    await expect(first).resolves.toEqual(expect.objectContaining({ status: "exception" }));

    const second = controller.execute(request("after-exception"));
    await Promise.resolve();
    worker.emit({
      type: "execution_finished",
      sessionId: "after-exception",
      result: completed
    });
    await expect(second).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    expect(workerFactory).toHaveBeenCalledTimes(1);
    expect(worker.terminateCount).toBe(0);
  });
});
