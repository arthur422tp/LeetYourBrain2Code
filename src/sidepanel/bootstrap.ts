import type { ExecutionRequest } from "../shared/execution-types";
import type { TraceSession } from "../shared/trace-types";
import {
  LEETCODE_CONTENT_MESSAGE_TYPES,
  validateSnapshot,
  type LeetCodeSnapshot
} from "../content/leetcode-adapter";
import { createExecutionRequest } from "../execution/execution-request";
import { ExecutionController } from "../execution/execution-controller";
import { createTraceVisualizer, type TraceVisualizerHandle } from "./components/TraceVisualizer";
import "./styles.css";

export interface SidePanelController {
  execute(request: ExecutionRequest): Promise<TraceSession>;
}

export type SnapshotSubscription = (
  listener: (snapshot: LeetCodeSnapshot) => void
) => () => void;

export interface SidePanelDependencies {
  controller?: SidePanelController;
  snapshotProvider?: () => Promise<LeetCodeSnapshot>;
  snapshotSubscription?: SnapshotSubscription;
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

function isMissingReceiverError(error: unknown): boolean {
  const message = errorText(error);
  return message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection");
}

export function createResilientSnapshotProvider(
  request: () => Promise<LeetCodeSnapshot>,
  reconnect: () => Promise<void>
): () => Promise<LeetCodeSnapshot> {
  return async () => {
    try {
      return await request();
    } catch (error: unknown) {
      if (!isMissingReceiverError(error)) {
        throw error;
      }
      await reconnect();
      return request();
    }
  };
}

function isLeetCodeUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  try {
    return new URL(url).origin === "https://leetcode.com";
  } catch {
    return false;
  }
}

function queryActiveLeetCodeTab(): Promise<chrome.tabs.Tab> {
  if (typeof chrome === "undefined" || typeof chrome.tabs?.query !== "function") {
    return Promise.reject(new Error("Chrome tab access is unavailable"));
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      const tab = tabs.find(
        (candidate) => isLeetCodeUrl(candidate.url) && candidate.id !== undefined
      );
      if (!tab) {
        reject(new Error("No active LeetCode tab was found"));
        return;
      }
      resolve(tab);
    });
  });
}

async function injectLeetCodeContentScripts(): Promise<void> {
  if (
    typeof chrome === "undefined" ||
    typeof chrome.scripting?.executeScript !== "function"
  ) {
    throw new Error("Chrome script injection is unavailable");
  }

  const tab = await queryActiveLeetCodeTab();
  const target = { tabId: tab.id! };
  await chrome.scripting.executeScript({
    target,
    files: ["page-bridge/leetcode-main-world.js"],
    world: "MAIN"
  });
  await chrome.scripting.executeScript({
    target,
    files: ["content/leetcode-adapter.js"]
  });
}

function snapshotErrorText(error: unknown): string {
  if (isMissingReceiverError(error)) {
    return "Unable to connect to the LeetCode page. Refresh the LeetCode tab and reopen the side panel.";
  }
  return errorText(error);
}

function createDefaultSnapshotProvider(): (() => Promise<LeetCodeSnapshot>) | undefined {
  if (typeof chrome === "undefined" || typeof chrome.runtime?.sendMessage !== "function") {
    return undefined;
  }

  const requestSnapshot = (): Promise<LeetCodeSnapshot> =>
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

  return createResilientSnapshotProvider(requestSnapshot, injectLeetCodeContentScripts);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createDefaultSnapshotSubscription(): SnapshotSubscription | undefined {
  if (
    typeof chrome === "undefined" ||
    typeof chrome.runtime?.onMessage?.addListener !== "function"
  ) {
    return undefined;
  }

  return (listener) => {
    const onMessage = (message: unknown): void => {
      if (
        !isRecord(message) ||
        message.type !== LEETCODE_CONTENT_MESSAGE_TYPES.snapshotUpdated ||
        !validateSnapshot(message.snapshot)
      ) {
        return;
      }
      listener(message.snapshot);
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  };
}

export function renderSidePanel(
  root: HTMLElement,
  dependencies: SidePanelDependencies = {}
): void {
  const controller = dependencies.controller ?? createDefaultController();
  const snapshotProvider =
    dependencies.snapshotProvider ?? createDefaultSnapshotProvider();
  const snapshotSubscription =
    dependencies.snapshotSubscription ?? createDefaultSnapshotSubscription();

  const app = document.createElement("main");
  app.className = "app-shell";

  const header = document.createElement("header");
  header.className = "app-header";
  const title = document.createElement("h1");
  title.textContent = "Visualizer";
  const subtitle = document.createElement("p");
  subtitle.textContent = "Python Execution Trace";
  header.append(title, subtitle);

  const status = document.createElement("p");
  status.id = "runtime-status";
  status.textContent = "Runtime: not started";

  const inputPanel = document.createElement("details");
  inputPanel.className = "input-panel";
  inputPanel.open = true;
  const inputSummary = document.createElement("summary");
  inputSummary.textContent = "LeetCode input · synced";
  inputPanel.append(inputSummary);

  const inputBody = document.createElement("div");
  inputBody.className = "input-panel__body";

  const sourceLabel = document.createElement("label");
  sourceLabel.htmlFor = "source-code";
  sourceLabel.textContent = "Code (read-only mirror)";

  const source = document.createElement("textarea");
  source.id = "source-code";
  source.rows = 14;
  source.readOnly = true;
  source.value = snapshotProvider ? "" : SAMPLE_SOURCE;

  const testcaseLabel = document.createElement("label");
  testcaseLabel.htmlFor = "testcase";
  testcaseLabel.textContent = "Testcase (read-only mirror)";

  const testcase = document.createElement("textarea");
  testcase.id = "testcase";
  testcase.rows = 4;
  testcase.readOnly = true;
  testcase.value = snapshotProvider ? "" : SAMPLE_TESTCASE;

  const runButton = document.createElement("button");
  runButton.id = "run";
  runButton.type = "button";
  runButton.textContent = "Visualize";

  const actions = document.createElement("div");
  actions.className = "input-panel__actions";
  actions.append(runButton);
  inputBody.append(sourceLabel, source, testcaseLabel, testcase, actions);
  inputPanel.append(inputBody);

  const result = document.createElement("section");
  result.id = "visualization-output";
  result.className = "visualization-output";
  const placeholder = document.createElement("div");
  placeholder.className = "trace-placeholder";
  placeholder.textContent = "Run Visualize to inspect the execution step by step.";
  result.append(placeholder);

  let activeVisualizer: TraceVisualizerHandle | null = null;

  let running = false;

  const applySnapshot = (snapshot: LeetCodeSnapshot): void => {
    source.value = snapshot.code;
    testcase.value = snapshot.testcase;
    status.textContent = "Runtime: ready";
  };

  snapshotSubscription?.(applySnapshot);
  if (snapshotProvider) {
    status.textContent = "Runtime: syncing";
    void snapshotProvider()
      .then(applySnapshot)
      .catch((error: unknown) => {
        status.textContent = `Runtime: ${snapshotErrorText(error)}`;
      });
  }

  runButton.addEventListener("click", () => {
    if (running) {
      return;
    }
    running = true;
    runButton.disabled = true;
    status.textContent = "Runtime: running";
    activeVisualizer?.dispose();
    activeVisualizer = null;
    result.replaceChildren();

    const renderError = (message: string): void => {
      const errorPanel = document.createElement("div");
      errorPanel.className = "trace-error";
      errorPanel.textContent = message;
      result.replaceChildren(errorPanel);
    };

    const executeCurrentSnapshot = async (): Promise<void> => {
      if (snapshotProvider) {
        status.textContent = "Runtime: syncing";
        try {
          applySnapshot(await snapshotProvider());
        } catch (error: unknown) {
          status.textContent = `Runtime: ${snapshotErrorText(error)}`;
          renderError(snapshotErrorText(error));
          return;
        }
      }

      status.textContent = "Runtime: running";
      const requestResult = createExecutionRequest({
        sessionId: createSessionId(),
        sourceCode: source.value,
        rawTestcase: testcase.value
      });

      if (!requestResult.ok) {
        status.textContent = `Runtime: ${requestResult.reason}`;
        renderError(requestResult.reason);
        return;
      }

      try {
        const session = await controller.execute(requestResult.request);
        status.textContent = `Runtime: ${session.status}`;
        activeVisualizer?.dispose();
        activeVisualizer = createTraceVisualizer(session);
        result.replaceChildren(activeVisualizer.element);
      } catch (error: unknown) {
        status.textContent = "Runtime: internal_error";
        renderError(errorText(error));
      }
    };

    void executeCurrentSnapshot()
      .finally(() => {
        running = false;
        runButton.disabled = false;
      });
  });

  app.append(header, status, inputPanel, result);
  root.replaceChildren(app);
}

if (typeof document !== "undefined") {
  renderSidePanel(document.body);
}
