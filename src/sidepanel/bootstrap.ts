import type { ExecutionRequest } from "../shared/execution-types";
import type { TraceSession } from "../shared/trace-types";
import {
  LEETCODE_CONTENT_MESSAGE_TYPES,
  validateSnapshot,
  type LeetCodeSnapshot
} from "../content/leetcode-adapter";
import { createExecutionRequest } from "../execution/execution-request";
import { ExecutionController } from "../execution/execution-controller";

export interface SidePanelController {
  execute(request: ExecutionRequest): Promise<TraceSession>;
}

export interface SidePanelDependencies {
  controller?: SidePanelController;
  snapshotProvider?: () => Promise<LeetCodeSnapshot>;
}

const SAMPLE_SOURCE = `class Solution:
    def twoSum(self, numbers, target):
        for index, value in enumerate(numbers):
            for other in range(index + 1, len(numbers)):
                if value + numbers[other] == target:
                    return [index, other]
        return []
`;

const SAMPLE_TESTCASE = `[2, 7]
9`;

function createDefaultController(): SidePanelController {
  const workerUrl =
    typeof chrome !== "undefined" && typeof chrome.runtime?.getURL === "function"
      ? chrome.runtime.getURL("worker/pyodide-worker.js")
      : new URL(/* @vite-ignore */ "../worker/pyodide-worker.js", import.meta.url);

  return new ExecutionController({ workerUrl });
}

function createSessionId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return `sidepanel-${Date.now()}-${randomUuid ?? Math.random().toString(36).slice(2)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDefaultSnapshotProvider(): (() => Promise<LeetCodeSnapshot>) | undefined {
  if (typeof chrome === "undefined" || typeof chrome.runtime?.sendMessage !== "function") {
    return undefined;
  }

  return () =>
    new Promise<LeetCodeSnapshot>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: LEETCODE_CONTENT_MESSAGE_TYPES.requestSnapshot },
        (response: unknown) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }

          if (
            typeof response !== "object" ||
            response === null ||
            !("ok" in response) ||
            response.ok !== true ||
            !("snapshot" in response) ||
            !validateSnapshot(response.snapshot)
          ) {
            reject(new Error("No valid LeetCode snapshot was returned"));
            return;
          }
          resolve(response.snapshot);
        }
      );
    });
}

export function renderSidePanel(
  root: HTMLElement,
  dependencies: SidePanelDependencies = {}
): void {
  const controller = dependencies.controller ?? createDefaultController();
  const snapshotProvider =
    dependencies.snapshotProvider ?? createDefaultSnapshotProvider();

  const title = document.createElement("h1");
  title.textContent = "LeetCode Python Visualizer";

  const status = document.createElement("p");
  status.id = "runtime-status";
  status.textContent = "Runtime: not started";

  const sourceLabel = document.createElement("label");
  sourceLabel.htmlFor = "source-code";
  sourceLabel.textContent = "Code";

  const source = document.createElement("textarea");
  source.id = "source-code";
  source.rows = 14;
  source.value = SAMPLE_SOURCE;

  const testcaseLabel = document.createElement("label");
  testcaseLabel.htmlFor = "testcase";
  testcaseLabel.textContent = "Testcase (one Python literal per line)";

  const testcase = document.createElement("textarea");
  testcase.id = "testcase";
  testcase.rows = 4;
  testcase.value = SAMPLE_TESTCASE;

  const loadButton = document.createElement("button");
  loadButton.id = "load-snapshot";
  loadButton.type = "button";
  loadButton.textContent = "Load current LeetCode";

  const runButton = document.createElement("button");
  runButton.id = "run";
  runButton.type = "button";
  runButton.textContent = "Run";

  const traceLabel = document.createElement("h2");
  traceLabel.textContent = "Trace event JSON";

  const traceOutput = document.createElement("pre");
  traceOutput.id = "trace-output";
  traceOutput.textContent = "[]";

  let running = false;
  loadButton.addEventListener("click", () => {
    if (!snapshotProvider || running) {
      status.textContent = "Runtime: page adapter unavailable";
      return;
    }

    running = true;
    loadButton.disabled = true;
    status.textContent = "Runtime: loading";
    void snapshotProvider()
      .then((snapshot) => {
        source.value = snapshot.code;
        testcase.value = snapshot.testcase;
        status.textContent = "Runtime: ready";
      })
      .catch((error: unknown) => {
        status.textContent = `Runtime: ${errorText(error)}`;
      })
      .finally(() => {
        running = false;
        loadButton.disabled = false;
      });
  });

  runButton.addEventListener("click", () => {
    if (running) {
      return;
    }
    running = true;
    runButton.disabled = true;
    status.textContent = "Runtime: running";
    traceOutput.textContent = "[]";

    const requestResult = createExecutionRequest({
      sessionId: createSessionId(),
      sourceCode: source.value,
      rawTestcase: testcase.value
    });

    if (!requestResult.ok) {
      status.textContent = `Runtime: ${requestResult.reason}`;
      traceOutput.textContent = JSON.stringify({ error: requestResult.reason }, null, 2);
      running = false;
      runButton.disabled = false;
      return;
    }

    void controller
      .execute(requestResult.request)
      .then((session) => {
        status.textContent = `Runtime: ${session.status}`;
        traceOutput.textContent = JSON.stringify(session.events, null, 2);
      })
      .catch((error: unknown) => {
        status.textContent = "Runtime: internal_error";
        traceOutput.textContent = JSON.stringify({ error: errorText(error) }, null, 2);
      })
      .finally(() => {
        running = false;
        runButton.disabled = false;
      });
  });

  root.replaceChildren(
    title,
    status,
    sourceLabel,
    source,
    testcaseLabel,
    testcase,
    loadButton,
    runButton,
    traceLabel,
    traceOutput
  );
}

if (typeof document !== "undefined") {
  renderSidePanel(document.body);
}
