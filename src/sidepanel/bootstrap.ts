import type { ExecutionRequest } from "../shared/execution-types";
import type { TraceEvent, TraceSession } from "../shared/trace-types";
import { sameEditorSource } from "../shared/editor-trace";
import { createEditorTraceSync, type EditorTraceTransport } from "./editor-trace-sync";
import {
  toRunnableSnapshot,
  type LeetCodePageState,
  type LeetCodeSnapshot
} from "../content/leetcode-adapter";
import {
  LiveExecutionScheduler,
  type AcceptedLiveSession,
  type LiveStatus
} from "../execution/live-execution-scheduler";
import { compareCrossRuns } from "../core/cross-run-diff";
import { prepareCrossRun, type PreparedCrossRun } from "../core/cross-run-prepare";
import { interpretTraceSession } from "../core/trace-session-interpreter";
import { getTestcaseCases } from "../execution/testcase-selection";
import { ExecutionController } from "../execution/execution-controller";
import {
  createActiveTabSource,
  type ActiveTabSource,
  type ActiveTabState,
  type ActiveTabSourceOptions
} from "./active-tab-source";
import { createTraceVisualizer, type TraceVisualizerHandle } from "./components/TraceVisualizer";
import {
  createBaselineControls,
  type BaselineControlsHandle
} from "./components/BaselineControls";
import {
  compareRunCompatibility,
  createRunComparisonState,
  runRecordFromAcceptedSession
} from "./run-comparison-state";
import {
  buildBehavioralDiffViewModel,
  type BehavioralDiffViewModel
} from "./behavioral-diff-view";
import { createAboutPrivacy } from "./components/AboutPrivacy";
import {
  createReleaseOnboarding,
  type ReleaseOnboardingState
} from "./components/ReleaseOnboarding";
import {
  createRecoveryNotice,
  type RecoveryNoticeState
} from "./components/RecoveryNotice";
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
  editorTraceTransport?: EditorTraceTransport;
}

export interface SidePanelHandle {
  dispose(): void;
}

type SourceReadiness =
  | "waiting_for_editor"
  | "waiting_for_language"
  | "waiting_for_testcase"
  | "unsupported_language"
  | "candidate";

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

function sourceReadiness(state: LeetCodePageState): SourceReadiness {
  if (state.code === null || state.code.length === 0) return "waiting_for_editor";
  if (state.language === null || state.language.length === 0) return "waiting_for_language";
  const normalizedLanguage = state.language.trim().toLowerCase().replace(/\s+/g, "");
  if (!new Set(["python", "python3", "py"]).has(normalizedLanguage)) {
    return "unsupported_language";
  }
  if (state.testcase === null) return "waiting_for_testcase";
  return "candidate";
}

function toSupportedRunnableSnapshot(
  state: LeetCodePageState
): LeetCodeSnapshot | null {
  const snapshot = toRunnableSnapshot(state);
  if (snapshot === null) return null;

  const normalizedLanguage = snapshot.language.trim().toLowerCase().replace(/\s+/g, "");
  return new Set(["python", "python3", "py"]).has(normalizedLanguage)
    ? snapshot
    : null;
}

function recoveryStateForSession(session: TraceSession): RecoveryNoticeState | null {
  if (session.status === "internal_error") return "execution";
  if (session.status === "timeout") return "timeout";
  if (session.status === "trace_limit") return "trace_limit";
  return null;
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

  const aboutPrivacy = createAboutPrivacy();

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
  const inputControls = document.createElement("div");
  inputControls.className = "input-controls";
  inputControls.append(caseLabel, caseSelector, actions);
  inputBody.append(
    sourceLabel,
    source,
    testcaseLabel,
    testcase
  );
  inputPanel.append(inputBody);

  const result = document.createElement("section");
  result.id = "visualization-output";
  result.className = "visualization-output";
  const releaseOnboarding = createReleaseOnboarding();
  const placeholder = releaseOnboarding.element;
  result.append(placeholder);
  const recoveryNotice = createRecoveryNotice();

  let activeVisualizer: TraceVisualizerHandle | null = null;
  let editorEvent: TraceEvent | undefined;
  let followEditor = true;
  const editorSync = createEditorTraceSync(status => activeVisualizer?.setEditorSyncStatus(status), dependencies.editorTraceTransport);
  const comparisonState = createRunComparisonState();
  let baselinePrepared: PreparedCrossRun | null = null;
  let currentPrepared: PreparedCrossRun | null = null;
  let currentComparison: BehavioralDiffViewModel | null = null;
  let baselineControls: BaselineControlsHandle | null = null;
  let currentPageState: LeetCodePageState | null = hasActiveTabSource
    ? null
    : {
        code: SAMPLE_SOURCE,
        language: "python",
        testcase: SAMPLE_TESTCASE,
        metadata: { slug: "sample", title: "Sample" }
      };
  let ownershipState: ActiveTabState | null = null;
  let schedulerStatus: LiveStatus | null = null;
  let selectedCaseIndex = 0;
  let ownershipGeneration = 0;
  let disposed = false;
  let collapsedInitialMirrors = false;
  let behavioralDiffPanelOpen = false;
  let sessionReportedForLatestRun = false;
  let renderedPageIdentity: {
    slug: string | null;
    sourceCode: string;
    rawTestcase: string;
  } | null = null;

  const updateActiveComparison = (): void => {
    activeVisualizer?.setBehavioralDiff(currentComparison);
  };

  const onboardingState = (): ReleaseOnboardingState => {
    if (ownershipState?.kind === "paused" || currentPageState === null) {
      return "no_active_leetcode";
    }

    const readiness = sourceReadiness(currentPageState);
    return readiness === "candidate" ? "ready" : readiness;
  };

  const traceMatchesCurrentPage = (): boolean => {
    if (!activeVisualizer || !renderedPageIdentity || !currentPageState) return false;
    return (
      renderedPageIdentity.sourceCode === currentPageState.code &&
      renderedPageIdentity.rawTestcase === currentPageState.testcase
    );
  };

  const renderReleaseOnboarding = (): void => {
    const state = onboardingState();
    if (activeVisualizer && traceMatchesCurrentPage()) {
      releaseOnboarding.element.remove();
      return;
    }

    releaseOnboarding.update(state, { stale: activeVisualizer !== null });
    if (activeVisualizer) {
      if (!result.contains(releaseOnboarding.element)) {
        result.prepend(releaseOnboarding.element);
      }
      return;
    }

    if (!result.contains(releaseOnboarding.element)) {
      result.replaceChildren(releaseOnboarding.element);
    }
  };

  const showRecoveryNotice = (state: RecoveryNoticeState): void => {
    recoveryNotice.update(state);
    runButton.textContent = "Retry";
    if (!result.contains(recoveryNotice.element)) {
      result.prepend(recoveryNotice.element);
    }
  };

  const clearRecoveryNotice = (): void => {
    recoveryNotice.element.remove();
    runButton.textContent = "Run now";
  };

  const renderLiveStatus = (): void => {
    if (ownershipState?.kind === "paused") {
      status.dataset.liveStatus = "paused";
      status.textContent = "Live: paused · No active LeetCode tab";
      renderReleaseOnboarding();
      return;
    }

    if (!currentPageState || currentPageState.code === null) {
      status.dataset.liveStatus = "syncing";
      status.textContent = "Live: syncing";
      renderReleaseOnboarding();
      return;
    }

    const readiness = sourceReadiness(currentPageState);
    if (readiness === "waiting_for_editor" || readiness === "waiting_for_language") {
      status.dataset.liveStatus = "editing";
      status.textContent = "Live: editing";
      renderReleaseOnboarding();
      return;
    }

    if (readiness === "unsupported_language") {
      status.dataset.liveStatus = "unsupported_language";
      status.textContent = "Live: Python required";
      renderReleaseOnboarding();
      return;
    }

    if (readiness === "waiting_for_testcase") {
      status.dataset.liveStatus = "waiting_for_testcase";
      status.textContent = "Live: code synced · waiting for testcase";
      renderReleaseOnboarding();
      return;
    }

    const next = schedulerStatus ?? "updating";
    status.dataset.liveStatus = next;
    status.textContent = `Live: ${next}`;
    renderReleaseOnboarding();
  };

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

  const clearVisualization = (): void => {
    editorSync.update(null, null);
    editorEvent = undefined;
    activeVisualizer?.dispose();
    activeVisualizer = null;
    behavioralDiffPanelOpen = false;
    renderedPageIdentity = null;
    clearRecoveryNotice();
    result.replaceChildren(placeholder);
  };

  const renderBaselineControls = (): void => {
    if (baselineControls === null) return;
    const state = comparisonState.get();
    baselineControls.update({
      hasCurrent: state.current !== null && currentPrepared !== null,
      hasBaseline: state.baseline !== null && baselinePrepared !== null,
      caseLabel: state.baseline === null
        ? undefined
        : `Case ${state.baseline.context.selectedCaseIndex + 1}`,
      baselineStatus: state.baseline?.session.status,
      sourceDiffers: state.baseline !== null
        && state.current !== null
        && state.baseline.session.sourceCode !== state.current.session.sourceCode
    });
  };

  const clearComparisonForProblemChange = (): void => {
    comparisonState.clearForProblemChange();
    baselinePrepared = null;
    currentPrepared = null;
    currentComparison = null;
    renderBaselineControls();
  };

  const recomputeComparison = (): void => {
    const state = comparisonState.get();
    if (baselinePrepared === null || currentPrepared === null) {
      currentComparison = null;
      updateActiveComparison();
      renderBaselineControls();
      return;
    }
    const diffResult = compareCrossRuns(
      baselinePrepared,
      currentPrepared,
      compareRunCompatibility(state.baseline, state.current)
    );
    currentComparison = buildBehavioralDiffViewModel(
      baselinePrepared,
      currentPrepared,
      diffResult,
      {
        baselineLabel: state.baseline === null
          ? undefined
          : `Baseline · Case ${state.baseline.context.selectedCaseIndex + 1}`,
        currentLabel: state.current === null
          ? undefined
          : `Current · Case ${state.current.context.selectedCaseIndex + 1}`
      }
    );
    updateActiveComparison();
    renderBaselineControls();
  };

  const pinCurrentBaseline = (): void => {
    if (currentPrepared === null || !comparisonState.pinCurrent()) return;
    baselinePrepared = currentPrepared;
    recomputeComparison();
  };

  const replaceBaseline = (): void => {
    if (currentPrepared === null || !comparisonState.replaceBaseline()) return;
    baselinePrepared = currentPrepared;
    recomputeComparison();
  };

  const clearBaseline = (): void => {
    comparisonState.clearBaseline();
    baselinePrepared = null;
    currentComparison = null;
    updateActiveComparison();
    renderBaselineControls();
  };

  const isDifferentProblem = (state: LeetCodePageState): boolean => {
    if (!activeVisualizer || !renderedPageIdentity) return false;

    if (renderedPageIdentity.slug === null || state.metadata.slug === null) return false;
    return renderedPageIdentity.slug !== state.metadata.slug;
  };

  const syncEditor = (): void => {
    const tabId = ownershipState?.kind === "leetcode" ? ownershipState.tabId : null;
    const sourceMatches = currentPageState?.code !== null && currentPageState?.code !== undefined
      && renderedPageIdentity !== null
      && currentPageState.language === "python"
      && currentPageState.metadata.slug === renderedPageIdentity.slug
      && sameEditorSource(currentPageState.code, renderedPageIdentity.sourceCode);
    if (tabId === null || !sourceMatches) {
      editorSync.update(null, null);
      activeVisualizer?.setEditorSyncStatus(tabId !== null && renderedPageIdentity !== null ? "stale" : "unavailable");
      return;
    }
    const line = editorEvent?.line;
    if (!line || line < 1 || line > renderedPageIdentity!.sourceCode.split("\n").length) {
      editorSync.update(tabId, null);
      activeVisualizer?.setEditorSyncStatus("cleared");
      return;
    }
    editorSync.update(tabId, {
      sourceCode: renderedPageIdentity!.sourceCode,
      problemSlug: renderedPageIdentity!.slug,
      line,
      follow: followEditor
    });
  };

  baselineControls = createBaselineControls({
    model: {
      hasCurrent: false,
      hasBaseline: false,
      sourceDiffers: false
    },
    onPin: pinCurrentBaseline,
    onReplace: replaceBaseline,
    onClear: clearBaseline
  });

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
      if (liveStatus === "updating") {
        sessionReportedForLatestRun = false;
      } else if (liveStatus === "runtime_error" && !sessionReportedForLatestRun) {
        showRecoveryNotice("execution");
      }
      schedulerStatus = liveStatus;
      renderLiveStatus();
    },
    onSession: (session, accepted: AcceptedLiveSession) => {
      sessionReportedForLatestRun = true;
      const sessionRecovery = recoveryStateForSession(session);
      clearRecoveryNotice();
      if (!collapsedInitialMirrors) {
        inputPanel.open = false;
        collapsedInitialMirrors = true;
      }
      const previousBehavioralDiffPanel = activeVisualizer?.element.querySelector<HTMLDetailsElement>(
        ".trace-viewer__behavioral-diff-panel"
      );
      if (previousBehavioralDiffPanel) {
        behavioralDiffPanelOpen = previousBehavioralDiffPanel.open;
      }
      const interpretation = interpretTraceSession(session);
      currentPrepared = prepareCrossRun(session, interpretation);
      comparisonState.setCurrent(runRecordFromAcceptedSession(session, accepted));
      recomputeComparison();
      activeVisualizer?.dispose();
      activeVisualizer = null;
      renderedPageIdentity = {
        slug: accepted.input.problemSlug,
        sourceCode: accepted.input.sourceCode,
        rawTestcase: accepted.input.rawTestcase
      };
      activeVisualizer = createTraceVisualizer(session, {
        interpretation,
        comparison: currentComparison,
        followEditor,
        ...(hasActiveTabSource ? {
          onStepChange: (event: TraceEvent | undefined) => { editorEvent = event; syncEditor(); },
          onFollowEditorChange: (follow: boolean) => { followEditor = follow; syncEditor(); }
        } : {})
      });
      if (hasActiveTabSource) syncEditor();
      result.replaceChildren(activeVisualizer.element);
      const nextBehavioralDiffPanel = activeVisualizer.element.querySelector<HTMLDetailsElement>(
        ".trace-viewer__behavioral-diff-panel"
      );
      if (nextBehavioralDiffPanel) {
        nextBehavioralDiffPanel.open = behavioralDiffPanelOpen;
      }
      if (sessionRecovery !== null) {
        showRecoveryNotice(sessionRecovery);
      }
    }
  });

  const scheduleSnapshot = (
    snapshot: LeetCodeSnapshot,
    options: { immediate?: boolean; force?: boolean } = {}
  ): void => {
    scheduler.schedule({
      language: snapshot.language,
      sourceCode: snapshot.code,
      rawTestcase: snapshot.testcase,
      selectedCaseIndex,
      problemSlug: snapshot.metadata.slug,
      problemTitle: snapshot.metadata.title
    }, options);
  };

  const scheduleCurrent = (
    options: { immediate?: boolean; force?: boolean } = {}
  ): void => {
    if (!currentPageState || disposed) return;
    const snapshot = toSupportedRunnableSnapshot(currentPageState);
    if (snapshot === null) {
      scheduler.invalidate();
      renderLiveStatus();
      return;
    }
    scheduleSnapshot(snapshot, options);
  };

  const applyPageState = (
    state: LeetCodePageState,
    options: { schedule?: boolean } = {}
  ): void => {
    if (disposed) return;

    if (isDifferentProblem(state)) {
      clearVisualization();
      clearComparisonForProblemChange();
    }

    currentPageState = state;
    if (hasActiveTabSource) syncEditor();

    if (state.code !== null) {
      source.value = state.code;
    }

    if (state.testcase === null) {
      testcase.value = "";
      testcase.placeholder = "Waiting for testcase…";
      caseSelector.replaceChildren();
      caseSelector.disabled = true;
      selectedCaseIndex = 0;
      scheduler.invalidate();
      renderLiveStatus();
      return;
    }

    testcase.placeholder = "";
    testcase.value = state.testcase;
    refreshCaseSelector(state.code ?? "", state.testcase);

    const snapshot = toSupportedRunnableSnapshot(state);
    if (snapshot === null) {
      scheduler.invalidate();
      renderLiveStatus();
      return;
    }

    if (options.schedule !== false) {
      scheduleSnapshot(snapshot);
    }
    renderLiveStatus();
  };

  refreshCaseSelector(source.value, testcase.value);

  const activeTabSource = activeTabSourceFactory?.({
    onOwnershipInvalidated: () => {
      if (disposed) return;
      ownershipGeneration += 1;
      clearRecoveryNotice();
      currentPageState = null;
      ownershipState = null;
      syncEditor();
      currentComparison = null;
      updateActiveComparison();
      scheduler.invalidate();
      schedulerStatus = "updating";
      renderLiveStatus();
    },
    onStateChange: (state) => {
      if (disposed) return;
      ownershipGeneration += 1;
      ownershipState = state;
      syncEditor();
      if (state.kind === "paused") {
        currentPageState = null;
        currentComparison = null;
        updateActiveComparison();
        renderLiveStatus();
        return;
      }
      schedulerStatus = "updating";
      renderLiveStatus();
    },
    onPageState: ({ state: acceptedState }) => {
      applyPageState(acceptedState);
    },
    onError: (error) => {
      if (disposed) return;
      status.removeAttribute("data-live-status");
      status.textContent = `Live: ${errorText(error)}`;
      showRecoveryNotice("connection");
    }
  });

  const settings = document.createElement("details");
  settings.className = "app-settings";
  const settingsSummary = document.createElement("summary");
  settingsSummary.textContent = "Settings";
  const settingsBody = document.createElement("div");
  settingsBody.className = "app-settings__body";
  settingsBody.append(aboutPrivacy.element, inputPanel, baselineControls.element);
  settings.append(settingsSummary, settingsBody);
  subtitle.remove();
  header.append(status, settings);
  app.append(header, inputControls, result);
  root.replaceChildren(app);
  renderReleaseOnboarding();

  if (activeTabSource) {
    renderLiveStatus();
    void activeTabSource.start().catch((error: unknown) => {
      if (!disposed) {
        status.textContent = `Live: ${errorText(error)}`;
        showRecoveryNotice("connection");
      }
    });
  }

  runButton.addEventListener("click", () => {
    const runLatest = async (): Promise<void> => {
      if (disposed) return;
      clearRecoveryNotice();
      if (activeTabSource) {
        const refreshOwnershipGeneration = ownershipGeneration;
        try {
          const latest = await activeTabSource.refresh();
          if (!latest || disposed) return;
          applyPageState(latest.state, { schedule: false });
          const snapshot = toSupportedRunnableSnapshot(latest.state);
          if (snapshot === null) {
            scheduler.invalidate();
            renderLiveStatus();
            return;
          }
          scheduleSnapshot(snapshot, { immediate: true, force: true });
        } catch (error: unknown) {
          if (
            !disposed &&
            ownershipGeneration === refreshOwnershipGeneration &&
            status.dataset.liveStatus !== "paused"
          ) {
            status.textContent = `Live: ${errorText(error)}`;
            showRecoveryNotice("connection");
          }
          return;
        }
        return;
      }
      scheduleCurrent({ immediate: true, force: true });
    };
    void runLatest();
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      editorSync.dispose();
      activeTabSource?.dispose();
      scheduler.dispose();
      baselineControls?.dispose();
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
