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
  private active = false;

  public constructor(options: ExecutionControllerOptions = {}) {
    const workerUrl =
      options.workerUrl ?? new URL(/* @vite-ignore */ "../worker/pyodide-worker.js", import.meta.url);
    this.workerFactory =
      options.workerFactory ??
      (() => new Worker(workerUrl, { type: "module" }));
  }

  public execute(request: ExecutionRequest): Promise<TraceSession> {
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

    let worker: WorkerLike;
    try {
      worker = this.workerFactory();
    } catch (error) {
      this.active = false;
      return Promise.resolve(
        collector.finish(internalErrorResult(errorMessage(error), true))
      );
    }

    return new Promise<TraceSession>((resolve) => {
      let settled = false;
      let executeSent = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.terminate();
        this.active = false;
      };

      const finish = (session: TraceSession): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(session);
      };

      const onMessage = (event: MessageEvent): void => {
        if (!isWorkerOutboundMessage(event.data)) {
          return;
        }
        const message: WorkerOutboundMessage = event.data;

        if (message.type === "ready") {
          if (!executeSent) {
            executeSent = true;
            worker.postMessage({ type: "execute", request });
          }
          return;
        }

        if (message.type === "trace_batch") {
          if (message.sessionId === request.sessionId) {
            collector.append(message.events);
          }
          return;
        }

        if (message.type === "execution_finished") {
          if (message.sessionId === request.sessionId) {
            finish(collector.finish(message.result));
          }
          return;
        }

        if (!message.sessionId || message.sessionId === request.sessionId) {
          finish(collector.finish(internalErrorResult(message.message, !executeSent)));
        }
      };

      const onError = (event: ErrorEvent): void => {
        finish(
          collector.finish(
            internalErrorResult(event.message || "Worker execution failed", !executeSent)
          )
        );
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      timeoutId = setTimeout(() => finish(collector.forceTimeout()), request.limits.hardTimeoutMs);
    });
  }
}
