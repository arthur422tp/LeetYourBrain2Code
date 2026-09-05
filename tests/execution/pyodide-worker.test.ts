import { describe, expect, it } from "vitest";

import type { ExecutionRequest } from "../../src/shared/execution-types";
import type { PyodideRuntime } from "../../src/worker/pyodide-runtime";
import {
  installPyodideWorker,
  type WorkerScopeLike
} from "../../src/worker/pyodide-worker";

const request: ExecutionRequest = {
  sessionId: "worker-session",
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
    hardTimeoutMs: 1_000
  }
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
});
