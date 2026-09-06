import type { ExecutionRequest, ExecutionTerminalResult } from "../shared/execution-types";
import {
  isWorkerOutboundMessage,
  type WorkerInboundMessage,
  type WorkerOutboundMessage
} from "../shared/worker-protocol";
import type { TraceSession } from "../shared/trace-types";
import {
  TraceSessionCollector,
  type TraceSessionCollectorOptions
} from "./trace-session-collector";

export interface WorkerLike {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(message: WorkerInboundMessage): void;
  terminate(): void;
}

export interface ExecutionControllerOptions {
  workerFactory?: () => WorkerLike;
  workerUrl?: string | URL;
}

interface WorkerHandle {
  worker: WorkerLike;
  ready: Promise<WorkerLike>;
  cancelReady(error: Error): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function internalErrorResult(
  message: string,
  duringInitialization = false
): ExecutionTerminalResult {
  return {
    status: "internal_error",
    terminationReason: duringInitialization
      ? "worker_initialization_failed"
      : "tracer_internal_error",
    stdout: "",
    durationMs: 0,
    exception: {
      type: "WorkerError",
      message,
      line: null,
      stack: [],
      frameId: null
    }
  };
}

export class ExecutionController {
  private readonly workerFactory: () => WorkerLike;
  private workerHandle: WorkerHandle | null = null;
  private active = false;
  private disposed = false;
  private abortActive: (() => void) | null = null;

  public constructor(options: ExecutionControllerOptions = {}) {
    const workerUrl =
      options.workerUrl ?? new URL(/* @vite-ignore */ "../worker/pyodide-worker.js", import.meta.url);
    this.workerFactory =
      options.workerFactory ??
      (() => new Worker(workerUrl, { type: "module" }));
  }

  private createWorkerHandle(): WorkerHandle {
    const worker = this.workerFactory();
    let settled = false;
    let resolveReady!: (worker: WorkerLike) => void;
    let rejectReady!: (error: Error) => void;

    const cleanup = (): void => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectReady(error);
    };

    function onMessage(event: MessageEvent): void {
      if (!isWorkerOutboundMessage(event.data)) {
        rejectOnce(new Error("Worker sent malformed initialization message"));
        return;
      }
      const message = event.data;
      if (message.type === "ready") {
        if (settled) return;
        settled = true;
        cleanup();
        resolveReady(worker);
        return;
      }
      if (message.type === "worker_error") {
        rejectOnce(new Error(message.message));
        return;
      }
      rejectOnce(new Error(`Worker sent ${message.type} before ready`));
    }

    function onError(event: ErrorEvent): void {
      rejectOnce(new Error(event.message || "Worker initialization failed"));
    }

    const ready = new Promise<WorkerLike>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    return { worker, ready, cancelReady: rejectOnce };
  }

  private ensureWorker(): Promise<WorkerLike> {
    if (this.disposed) {
      return Promise.reject(new Error("Execution controller is disposed"));
    }
    if (this.workerHandle === null) {
      try {
        this.workerHandle = this.createWorkerHandle();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return this.workerHandle.ready;
  }

  private invalidateWorker(reason: Error): void {
    const handle = this.workerHandle;
    this.workerHandle = null;
    if (!handle) return;
    handle.cancelReady(reason);
    handle.worker.terminate();
  }

  public execute(request: ExecutionRequest): Promise<TraceSession> {
    if (this.disposed) {
      return Promise.reject(new Error("Execution controller is disposed"));
    }
    if (this.active) {
      return Promise.reject(new Error("An execution is already in progress"));
    }
    this.active = true;

    const collectorOptions: TraceSessionCollectorOptions = {
      sessionId: request.sessionId,
      sourceCode: request.sourceCode,
      rawTestcase: request.rawTestcase,
      entrypoint: request.entrypoint,
      limits: request.limits
    };
    const collector = new TraceSessionCollector(collectorOptions);

    return new Promise<TraceSession>((resolve) => {
      let settled = false;
      let worker: WorkerLike | null = null;
      let onMessage: ((event: MessageEvent) => void) | null = null;
      let onError: ((event: ErrorEvent) => void) | null = null;

      const cleanupExecutionListeners = (): void => {
        if (worker && onMessage) worker.removeEventListener("message", onMessage);
        if (worker && onError) worker.removeEventListener("error", onError);
      };

      const finish = (session: TraceSession, invalidate = false): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        cleanupExecutionListeners();
        this.abortActive = null;
        this.active = false;
        if (invalidate) {
          this.invalidateWorker(new Error("Worker became unhealthy"));
        }
        resolve(session);
      };

      const fail = (message: string, duringInitialization = false): void => {
        finish(
          collector.finish(internalErrorResult(message, duringInitialization)),
          true
        );
      };

      const timeoutId = setTimeout(
        () => finish(collector.forceTimeout(), true),
        request.limits.hardTimeoutMs
      );

      this.abortActive = () => fail("Execution controller disposed");

      void this.ensureWorker()
        .then((readyWorker) => {
          if (settled) return;
          worker = readyWorker;

          onMessage = (event: MessageEvent): void => {
            if (!isWorkerOutboundMessage(event.data)) {
              fail("Worker sent malformed protocol message");
              return;
            }
            const message: WorkerOutboundMessage = event.data;

            if (message.type === "ready") return;
            if (message.type === "trace_batch") {
              if (message.sessionId === request.sessionId) {
                collector.append(message.events);
              }
              return;
            }
            if (message.type === "execution_finished") {
              if (message.sessionId === request.sessionId) {
                finish(
                  collector.finish(message.result),
                  message.result.terminationReason === "hard_timeout"
                );
              }
              return;
            }
            if (!message.sessionId || message.sessionId === request.sessionId) {
              fail(message.message);
            }
          };

          onError = (event: ErrorEvent): void => {
            fail(event.message || "Worker execution failed");
          };

          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          try {
            worker.postMessage({ type: "execute", request });
          } catch (error) {
            fail(errorMessage(error));
          }
        })
        .catch((error: unknown) => {
          if (!settled) {
            fail(errorMessage(error), true);
          }
        });
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortActive?.();
    this.invalidateWorker(new Error("Execution controller disposed"));
  }
}
