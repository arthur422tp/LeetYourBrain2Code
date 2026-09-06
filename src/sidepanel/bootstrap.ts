import type { ExecutionRequest } from "../shared/execution-types";
import type { TraceSession } from "../shared/trace-types";
import type { LeetCodeSnapshot } from "../content/leetcode-adapter";
import {
  LiveExecutionScheduler,
  type LiveStatus
} from "../execution/live-execution-scheduler";
import { getTestcaseCases } from "../execution/testcase-selection";
import { ExecutionController } from "../execution/execution-controller";
import {
  createActiveTabSource,
  type ActiveTabSource,
  type ActiveTabSourceOptions
} from "./active-tab-source";
import { createTraceVisualizer, type TraceVisualizerHandle } from "./components/TraceVisualizer";
import "./styles.css";

export interface SidePanelController {
  execute(request: ExecutionRequest): Promise<TraceSession>;
  dispose?(): void;
}

export type ActiveTabSourceFactory = (
  options: ActiveTabSourceOptions
) => ActiveTabSource;

export interface SidePanelDependencies {
  controller?: SidePanelController;
  activeTabSourceFactory?: ActiveTabSourceFactory;
  liveDebounceMs?: number;
}

export interface SidePanelHandle {
  dispose(): void;
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
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection")
  ) {
    return "Unable to connect to the LeetCode page. Refresh the LeetCode tab and reopen the side panel.";
  }
  return message;
}

function hasChromeTabSource(): boolean {
  return typeof chrome !== "undefined" &&
    typeof chrome.tabs?.query === "function" &&
    typeof chrome.tabs?.get === "function" &&
    typeof chrome.tabs?.sendMessage === "function" &&
    typeof chrome.tabs?.onActivated?.addListener === "function" &&
    typeof chrome.tabs?.onUpdated?.addListener === "function" &&
    typeof chrome.runtime?.onMessage?.addListener === "function" &&
    typeof chrome.scripting?.executeScript === "function";
}

export function renderSidePanel(
  root: HTMLElement,
  dependencies: SidePanelDependencies = {}
): SidePanelHandle {
  const controller = dependencies.controller ?? createDefaultController();
  const activeTabSourceFactory =
    dependencies.activeTabSourceFactory ??
    (hasChromeTabSource() ? ((options: ActiveTabSourceOptions) => createActiveTabSource(options)) : undefined);
  const hasActiveTabSource = activeTabSourceFactory !== undefined;

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
  status.textContent = "Live: not started";

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
  source.value = hasActiveTabSource ? "" : SAMPLE_SOURCE;

  const testcaseLabel = document.createElement("label");
  testcaseLabel.htmlFor = "testcase";
  testcaseLabel.textContent = "Testcase (read-only mirror)";

  const testcase = document.createElement("textarea");
  testcase.id = "testcase";
  testcase.rows = 4;
  testcase.readOnly = true;
  testcase.value = hasActiveTabSource ? "" : SAMPLE_TESTCASE;

  const caseLabel = document.createElement("label");
  caseLabel.htmlFor = "testcase-case";
  caseLabel.textContent = "Case to visualize";

  const caseSelector = document.createElement("select");
  caseSelector.id = "testcase-case";
  caseSelector.disabled = true;

  const runButton = document.createElement("button");
  runButton.id = "run";
  runButton.type = "button";
  runButton.textContent = "Run now";

  const actions = document.createElement("div");
  actions.className = "input-panel__actions";
  actions.append(runButton);
  inputBody.append(
    sourceLabel,
    source,
    testcaseLabel,
    testcase,
    caseLabel,
    caseSelector,
    actions
  );
  inputPanel.append(inputBody);

  const result = document.createElement("section");
  result.id = "visualization-output";
  result.className = "visualization-output";
  const placeholder = document.createElement("div");
  placeholder.className = "trace-placeholder";
  placeholder.textContent = "Waiting for a runnable Python draft…";
  result.append(placeholder);

  let activeVisualizer: TraceVisualizerHandle | null = null;
  let currentSnapshot: LeetCodeSnapshot | null = hasActiveTabSource
    ? null
    : {
        code: SAMPLE_SOURCE,
        language: "python",
        testcase: SAMPLE_TESTCASE,
        metadata: { slug: "sample", title: "Sample" }
      };
  let selectedCaseIndex = 0;
  let disposed = false;

  const refreshCaseSelector = (sourceCode: string, rawTestcase: string): void => {
    const previousIndex = Number.parseInt(caseSelector.value, 10);
    const cases = getTestcaseCases(sourceCode, rawTestcase);
    caseSelector.replaceChildren();

    cases.forEach((_testcase, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `Case ${index + 1}`;
      caseSelector.append(option);
    });

    const nextIndex = Number.isInteger(previousIndex) && previousIndex >= 0 && previousIndex < cases.length
      ? previousIndex
      : 0;
    selectedCaseIndex = nextIndex;
    caseSelector.value = String(nextIndex);
    caseSelector.disabled = cases.length <= 1;
  };

  caseSelector.addEventListener("change", () => {
    const nextIndex = Number.parseInt(caseSelector.value, 10);
    selectedCaseIndex = Number.isInteger(nextIndex) && nextIndex >= 0 ? nextIndex : 0;
    scheduleCurrent();
  });

  const scheduler = new LiveExecutionScheduler({
    runner: controller,
    createSessionId,
    debounceMs: dependencies.liveDebounceMs,
    onStatusChange: (liveStatus: LiveStatus) => {
      status.dataset.liveStatus = liveStatus;
      status.textContent = `Live: ${liveStatus}`;
    },
    onSession: (session) => {
      activeVisualizer?.dispose();
      activeVisualizer = createTraceVisualizer(session);
      result.replaceChildren(activeVisualizer.element);
    }
  });

  const scheduleCurrent = (
    options: { immediate?: boolean; force?: boolean } = {}
  ): void => {
    if (!currentSnapshot || disposed) return;
    scheduler.schedule({
      language: currentSnapshot.language,
      sourceCode: currentSnapshot.code,
      rawTestcase: currentSnapshot.testcase,
      selectedCaseIndex
    }, options);
  };

  const applySnapshot = (
    snapshot: LeetCodeSnapshot,
    options: { schedule?: boolean } = {}
  ): void => {
    if (disposed) return;
    currentSnapshot = snapshot;
    source.value = snapshot.code;
    testcase.value = snapshot.testcase;
    refreshCaseSelector(snapshot.code, snapshot.testcase);
    if (options.schedule !== false) {
      scheduleCurrent();
    }
  };

  refreshCaseSelector(source.value, testcase.value);

  const activeTabSource = activeTabSourceFactory?.({
    onOwnershipInvalidated: () => {
      if (disposed) return;
      currentSnapshot = null;
      scheduler.invalidate();
      status.dataset.liveStatus = "updating";
      status.textContent = "Live: updating";
    },
    onStateChange: (state) => {
      if (disposed) return;
      if (state.kind === "paused") {
        currentSnapshot = null;
        status.dataset.liveStatus = "paused";
        status.textContent = "Live: paused · No active LeetCode tab";
        return;
      }
      status.dataset.liveStatus = "updating";
      status.textContent = "Live: updating";
    },
    onSnapshot: ({ snapshot: acceptedSnapshot }) => {
      applySnapshot(acceptedSnapshot);
    },
    onError: (error) => {
      if (disposed) return;
      status.removeAttribute("data-live-status");
      status.textContent = `Live: ${errorText(error)}`;
    }
  });

  app.append(header, status, inputPanel, result);
  root.replaceChildren(app);

  if (activeTabSource) {
    status.textContent = "Live: syncing";
    void activeTabSource.start().catch((error: unknown) => {
      if (!disposed) {
        status.textContent = `Live: ${errorText(error)}`;
      }
    });
  }

  runButton.addEventListener("click", () => {
    const runLatest = async (): Promise<void> => {
      if (disposed) return;
      if (activeTabSource) {
        try {
          const latest = await activeTabSource.refresh();
          if (!latest || disposed) return;
          applySnapshot(latest.snapshot, { schedule: false });
        } catch (error: unknown) {
          if (!disposed) {
            status.textContent = `Live: ${errorText(error)}`;
          }
          return;
        }
      }
      scheduleCurrent({ immediate: true, force: true });
    };
    void runLatest();
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      activeTabSource?.dispose();
      scheduler.dispose();
      activeVisualizer?.dispose();
      activeVisualizer = null;
      controller.dispose?.();
    }
  };
}

if (typeof document !== "undefined") {
  const handle = renderSidePanel(document.body);
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => handle.dispose(), { once: true });
  }
}
