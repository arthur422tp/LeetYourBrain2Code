import {
  isWorkerInboundMessage,
  type WorkerOutboundMessage
} from "../shared/worker-protocol";
import {
  createPyodideRuntime,
  type PyodideRuntime
} from "./pyodide-runtime";

export interface WorkerScopeLike {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void
  ): void;
  postMessage(message: WorkerOutboundMessage): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function installPyodideWorker(
  scope: WorkerScopeLike,
  suppliedRuntime?: PyodideRuntime
): () => void {
  let activeSessionId: string | undefined;
  let initialized = false;

  const runtime =
    suppliedRuntime ??
    createPyodideRuntime({
      onFinished: (result) => {
        if (!activeSessionId) {
          return;
        }
        scope.postMessage({
          type: "execution_finished",
          sessionId: activeSessionId,
          result
        });
      }
    });

  const initialization = (async (): Promise<void> => {
    try {
      await runtime.initialize();
      initialized = true;
      scope.postMessage({ type: "ready" });
    } catch (error) {
      scope.postMessage({ type: "worker_error", message: errorMessage(error) });
    }
  })();

  const onMessage = async (event: MessageEvent): Promise<void> => {
    if (!isWorkerInboundMessage(event.data) || !initialized) {
      return;
    }

    activeSessionId = event.data.request.sessionId;
    try {
      await runtime.execute(event.data.request);
    } catch (error) {
      scope.postMessage({
        type: "worker_error",
        sessionId: activeSessionId,
        message: errorMessage(error)
      });
    } finally {
      activeSessionId = undefined;
    }
  };

  scope.addEventListener("message", onMessage);
  void initialization;

  return () => scope.removeEventListener("message", onMessage);
}

if (typeof WorkerGlobalScope !== "undefined") {
  installPyodideWorker(self as unknown as WorkerScopeLike);
}
