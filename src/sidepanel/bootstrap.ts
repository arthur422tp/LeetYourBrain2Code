import type { ExecutionRequest } from "../shared/execution-types";
import type { TraceEvent, TraceSession } from "../shared/trace-types";
import { sameEditorSource } from "../shared/editor-trace";
import type { EditorTraceStatus } from "../shared/editor-trace";
import {
  createEditorTraceSync,
  isEditorReplaySafe,
  type EditorTraceTransport
} from "./editor-trace-sync";
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
import type { CrossRunDiffResult } from "../core/cross-run-diff";
import { compareCaseBehavioralDiff, type CaseBehavioralDiffResult } from "../core/case-behavioral-diff";
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
  runRecordFromAcceptedSession,
  type RunRecord
} from "./run-comparison-state";
import {
  buildBehavioralDiffViewModel,
  type BehavioralDiffViewModel
} from "./behavioral-diff-view";
import { buildCaseDivergencePresentation } from "./case-diff-presentation";
import {
  createCaseComparisonState
} from "./case-comparison-state";
import {
  createCaseComparisonControls,
  type CaseComparisonControlsHandle
} from "./components/CaseComparisonControls";
import {
  createCaseBehavioralDiff,
  type CaseBehavioralDiffHandle
} from "./components/CaseBehavioralDiff";
import { createAboutPrivacy } from "./components/AboutPrivacy";
import {
  createReleaseOnboarding,
  type ReleaseOnboardingState
} from "./components/ReleaseOnboarding";
import {
  createRecoveryNotice,
  type RecoveryNoticeState
} from "./components/RecoveryNotice";
import {
  collectDiagnosticSnapshot,
  formatDiagnosticReport,
  getDiagnosticEnvironment,
  type DiagnosticEnvironment,
  type DiagnosticRuntimeView,
  type DiagnosticSnapshot
} from "./diagnostics";
import {
  createSupportDiagnostics,
  type SupportDiagnosticsOptions
} from "./components/SupportDiagnostics";
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
  diagnosticEnvironment?: DiagnosticEnvironment;
  diagnosticCopyText?: SupportDiagnosticsOptions["copyText"];
}

export interface SidePanelHandle {
  dispose(): void;
  getDiagnosticSnapshot(): DiagnosticSnapshot;
}

type SourceReadiness =
  | "waiting_for_editor"
  | "waiting_for_language"
  | "waiting_for_testcase"
  | "unsupported_language"
  | "candidate";

type DisplayMode = "live" | "left" | "right";

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

function diagnosticPageState(state: LeetCodePageState | null): string {
  if (state === null) return "unavailable";
  switch (sourceReadiness(state)) {
    case "waiting_for_editor": return "waiting_editor";
    case "waiting_for_language": return "waiting_language";
    case "waiting_for_testcase": return "waiting_testcase";
    case "unsupported_language": return "unsupported_language";
    case "candidate": return "ready";
  }
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
  let editorSyncStatus: EditorTraceStatus = "unavailable";
  let pageBridgeStatus = "unavailable";
  let latestAcceptedSession: TraceSession | null = null;
  let inspectedRun: RunRecord | null = null;
  let inspectedStep: number | null = null;
  let visualizerKind: string | null = null;
  let rawCursor: string | null = null;
  const updateEditorSyncStatus = (nextStatus: EditorTraceStatus): void => {
    editorSyncStatus = nextStatus;
    activeVisualizer?.setEditorSyncStatus(nextStatus);
  };
  const editorSync = createEditorTraceSync(updateEditorSyncStatus, dependencies.editorTraceTransport);
  const comparisonState = createRunComparisonState();
  const caseComparisonState = createCaseComparisonState();
  let baselinePrepared: PreparedCrossRun | null = null;
  let currentPrepared: PreparedCrossRun | null = null;
  let currentComparison: BehavioralDiffViewModel | null = null;
  let caseComparisonResult: CaseBehavioralDiffResult | null = null;
  let baselineControls: BaselineControlsHandle | null = null;
  let caseComparisonControls: CaseComparisonControlsHandle | null = null;
  let caseBehavioralDiff: CaseBehavioralDiffHandle | null = null;
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
  let displayMode: DisplayMode = "live";
  let collapsedInitialMirrors = false;
  let behavioralDiffPanelOpen = false;
  let sessionReportedForLatestRun = false;
  let renderedPageIdentity: {
    slug: string | null;
    sourceCode: string;
    rawTestcase: string;
  } | null = null;
  const diagnosticEnvironment = dependencies.diagnosticEnvironment ?? getDiagnosticEnvironment();

  const updateActiveComparison = (): void => {
    if (displayMode !== "live") return;
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
    if (displayMode !== "live") {
      releaseOnboarding.element.remove();
      return;
    }
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
    updateEditorSyncStatus("unavailable");
    editorEvent = undefined;
    activeVisualizer?.dispose();
    activeVisualizer = null;
    displayMode = "live";
    inspectedRun = null;
    inspectedStep = null;
    latestAcceptedSession = null;
    visualizerKind = null;
    rawCursor = null;
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
    caseComparisonState.clearForProblemChange();
    baselinePrepared = null;
    currentPrepared = null;
    currentComparison = null;
    caseComparisonResult = null;
    renderBaselineControls();
    renderCaseComparison();
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

  const caseCoverageMessage = (diff: CrossRunDiffResult | undefined): string | undefined => {
    if (!diff) return undefined;
    const messages: string[] = [];
    if (diff.stopReason === "coverage_ended") {
      messages.push("No divergence observed before comparison coverage ended.");
    } else if (
      diff.stopReason === "ambiguous_alignment" ||
      diff.stopReason === "alignment_boundary"
    ) {
      messages.push("Comparison stopped because the next evidence could not be aligned safely.");
    } else if (diff.stopReason === "unmatched_function") {
      messages.push("Comparison stopped because the next function occurrence could not be aligned safely.");
    }
    if (diff.coverage.callFrames !== "complete") {
      messages.push(`Call-frame evidence is ${diff.coverage.callFrames}.`);
    }
    if (diff.coverage.decisions !== "complete") {
      messages.push(`Decision evidence is ${diff.coverage.decisions}.`);
    }
    if (diff.coverage.expressions !== "complete") {
      messages.push(`Expression evidence is ${diff.coverage.expressions}.`);
    }
    if (diff.coverage.controlFlow !== "complete") {
      messages.push(`Control-flow evidence is ${diff.coverage.controlFlow}.`);
    }
    if (diff.coverage.mutations.status !== "complete") {
      messages.push("Mutation evidence is partial.");
    }
    if (diff.coverage.values.incomparableCount > 0) {
      messages.push(`${diff.coverage.values.incomparableCount} value comparison(s) were not comparable across runs.`);
    }
    if (diff.coverage.mutations.skippedUnstableObjectMutations > 0) {
      messages.push("Some object-owned mutations were excluded from cross-run alignment.");
    }
    return messages.length > 0 ? messages.join(" ") : undefined;
  };

  const anchorIsAuthoritative = (
    step: number | undefined,
    run: ReturnType<typeof caseComparisonState.get>["left"]
  ): boolean => step !== undefined && run !== null
    && run.session.events.some((event) => event.step === step);

  const renderCaseComparison = (): void => {
    const selection = caseComparisonState.get();
    const current = comparisonState.get().current;
    const currentCaseIndex = current?.context.selectedCaseIndex ?? null;
    const result = caseComparisonResult;
    const diff = result?.diff;
    const leftCaseIndex = result?.leftCaseIndex
      ?? selection.left?.context.selectedCaseIndex
      ?? null;
    const rightCaseIndex = result?.rightCaseIndex
      ?? selection.right?.context.selectedCaseIndex
      ?? null;
    const presentation = diff?.firstDivergence
      && result?.leftCaseIndex !== undefined
      && result.rightCaseIndex !== undefined
      ? buildCaseDivergencePresentation(
          diff.firstDivergence,
          result.leftCaseIndex,
          result.rightCaseIndex
        )
      : undefined;

    caseComparisonControls?.update({
      hasCurrent: current !== null && currentPrepared !== null,
      currentCaseIndex,
      caseAIndex: selection.left?.context.selectedCaseIndex ?? null,
      caseBIndex: selection.right?.context.selectedCaseIndex ?? null,
      ...(result ? { compatibility: result.compatibility } : {})
    });
    caseBehavioralDiff?.update({
      leftCaseIndex,
      rightCaseIndex,
      displayMode,
      ...(result ? { compatibility: result.compatibility } : {}),
      ...(presentation ? { presentation } : {}),
      ...(diff ? { coverageMessage: caseCoverageMessage(diff), stopReason: diff.stopReason } : {}),
      leftAnchorAuthoritative: anchorIsAuthoritative(diff?.firstDivergence?.baseline?.step, selection.left),
      rightAnchorAuthoritative: anchorIsAuthoritative(diff?.firstDivergence?.current?.step, selection.right)
    });
  };

  const recomputeCaseComparison = (): void => {
    const selection = caseComparisonState.get();
    if (selection.left === null || selection.right === null) {
      caseComparisonResult = null;
      renderCaseComparison();
      return;
    }
    caseComparisonResult = compareCaseBehavioralDiff(selection.left, selection.right);
    renderCaseComparison();
  };

  const selectCurrentCaseAsLeft = (): void => {
    const current = comparisonState.get().current;
    if (current === null || currentPrepared === null) return;
    caseComparisonState.selectLeft(current);
    recomputeCaseComparison();
  };

  const selectCurrentCaseAsRight = (): void => {
    const current = comparisonState.get().current;
    const selection = caseComparisonState.get();
    if (current === null || currentPrepared === null || selection.left === null) return;
    caseComparisonState.selectRight(current);
    recomputeCaseComparison();
  };

  const clearCaseComparison = (): void => {
    caseComparisonState.clear();
    caseComparisonResult = null;
    renderCaseComparison();
  };

  const isDifferentProblem = (state: LeetCodePageState): boolean => {
    if (!activeVisualizer || !renderedPageIdentity) return false;

    if (renderedPageIdentity.slug === null || state.metadata.slug === null) return false;
    return renderedPageIdentity.slug !== state.metadata.slug;
  };

  const syncEditor = (): void => {
    const tabId = ownershipState?.kind === "leetcode" ? ownershipState.tabId : null;
    if (displayMode !== "live") {
      const replayRun = inspectedRun;
      const event = replayRun !== null && inspectedStep !== null
        ? replayRun.session.events.find(candidate => candidate.step === inspectedStep)
        : undefined;
      const safe = replayRun !== null
        && currentPageState !== null
        && isEditorReplaySafe(
          replayRun.session.sourceCode,
          currentPageState.code,
          replayRun.context.problemSlug,
          currentPageState.metadata.slug
        );
      if (tabId === null || !safe || event === undefined || event.line === null || event.line < 1) {
        editorSync.update(tabId === null ? null : tabId, null);
        updateEditorSyncStatus(tabId === null ? "unavailable" : "stale");
        return;
      }
      editorSync.update(tabId, {
        sourceCode: replayRun!.session.sourceCode,
        problemSlug: replayRun!.context.problemSlug,
        line: event.line,
        follow: followEditor
      });
      return;
    }
    const sourceMatches = currentPageState?.code !== null && currentPageState?.code !== undefined
      && renderedPageIdentity !== null
      && currentPageState.language === "python"
      && currentPageState.metadata.slug === renderedPageIdentity.slug
      && sameEditorSource(currentPageState.code, renderedPageIdentity.sourceCode);
    if (tabId === null || !sourceMatches) {
      editorSync.update(null, null);
      updateEditorSyncStatus(tabId !== null && renderedPageIdentity !== null ? "stale" : "unavailable");
      return;
    }
    const line = editorEvent?.line;
    if (!line || line < 1 || line > renderedPageIdentity!.sourceCode.split("\n").length) {
      editorSync.update(tabId, null);
      updateEditorSyncStatus("cleared");
      return;
    }
    editorSync.update(tabId, {
      sourceCode: renderedPageIdentity!.sourceCode,
      problemSlug: renderedPageIdentity!.slug,
      line,
      follow: followEditor
    });
  };

  const mountLiveVisualizer = (
    session: TraceSession,
    interpretation: ReturnType<typeof interpretTraceSession>,
    sessionRecovery: RecoveryNoticeState | null = null
  ): void => {
    displayMode = "live";
    clearRecoveryNotice();
    activeVisualizer?.dispose();
    activeVisualizer = createTraceVisualizer(session, {
      interpretation,
      comparison: currentComparison,
      followEditor,
      ...(hasActiveTabSource ? {
        onStepChange: (event: TraceEvent | undefined) => {
          editorEvent = event;
          const eventIndex = event === undefined
            ? -1
            : session.events.findIndex(candidate => candidate.step === event.step);
          rawCursor = eventIndex >= 0 ? `${eventIndex}/${session.events.length}` : null;
          visualizerKind = eventIndex >= 0
            ? interpretation.visualStates[eventIndex]?.visuals[0]?.kind ?? null
            : null;
          syncEditor();
        },
        onFollowEditorChange: (follow: boolean) => { followEditor = follow; syncEditor(); }
      } : {})
    });
    if (!hasActiveTabSource) {
      const firstEvent = session.events[0];
      const firstIndex = firstEvent === undefined ? -1 : 0;
      rawCursor = firstIndex >= 0 ? `${firstIndex}/${session.events.length}` : null;
      visualizerKind = firstIndex >= 0
        ? interpretation.visualStates[firstIndex]?.visuals[0]?.kind ?? null
        : null;
    }
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
  };

  const inspectCapturedCase = (side: "left" | "right", step: number): void => {
    const selection = caseComparisonState.get();
    const run = side === "left" ? selection.left : selection.right;
    if (run === null) return;

    displayMode = side;
    inspectedRun = run;
    inspectedStep = null;
    activeVisualizer?.dispose();
    activeVisualizer = null;
    const interpretation = interpretTraceSession(run.session);
    activeVisualizer = createTraceVisualizer(run.session, {
      interpretation,
      onStepChange: (event: TraceEvent | undefined) => {
        inspectedStep = event?.step ?? null;
        syncEditor();
      },
      onFollowEditorChange: (follow: boolean) => {
        followEditor = follow;
        syncEditor();
      }
    });
    rawCursor = null;
    visualizerKind = null;
    result.replaceChildren(activeVisualizer.element);
    if (!activeVisualizer.inspectStep(step)) {
      inspectedStep = null;
    }
    syncEditor();
    renderCaseComparison();
  };

  const returnToCurrentRun = (): void => {
    if (latestAcceptedSession === null) return;
    inspectedRun = null;
    inspectedStep = null;
    mountLiveVisualizer(
      latestAcceptedSession,
      currentPrepared?.interpretation ?? interpretTraceSession(latestAcceptedSession)
    );
    renderCaseComparison();
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
  caseComparisonControls = createCaseComparisonControls({
    model: {
      hasCurrent: false,
      currentCaseIndex: null,
      caseAIndex: null,
      caseBIndex: null
    },
    onSelectLeft: selectCurrentCaseAsLeft,
    onSelectRight: selectCurrentCaseAsRight,
    onClear: clearCaseComparison
  });
  caseBehavioralDiff = createCaseBehavioralDiff({
    model: {
      leftCaseIndex: null,
      rightCaseIndex: null
    },
    onInspectLeft: (step) => inspectCapturedCase("left", step),
    onInspectRight: (step) => inspectCapturedCase("right", step),
    onReturnToCurrent: returnToCurrentRun
  });
  renderCaseComparison();

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
      latestAcceptedSession = session;
      visualizerKind = null;
      rawCursor = null;
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
      displayMode = "live";
      inspectedRun = null;
      inspectedStep = null;
      recomputeComparison();
      recomputeCaseComparison();
      renderedPageIdentity = {
        slug: accepted.input.problemSlug,
        sourceCode: accepted.input.sourceCode,
        rawTestcase: accepted.input.rawTestcase
      };
      mountLiveVisualizer(session, interpretation, sessionRecovery);
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
      pageBridgeStatus = "unavailable";
      ownershipGeneration += 1;
      clearRecoveryNotice();
      currentPageState = null;
      ownershipState = null;
      updateEditorSyncStatus("unavailable");
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
      pageBridgeStatus = state.kind === "leetcode" ? "waiting" : "unavailable";
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
      pageBridgeStatus = "ready";
      applyPageState(acceptedState);
    },
    onError: (error) => {
      if (disposed) return;
      pageBridgeStatus = "unavailable";
      status.removeAttribute("data-live-status");
      status.textContent = `Live: ${errorText(error)}`;
      showRecoveryNotice("connection");
    }
  });

  const diagnosticExecutionStatus = (): string => {
    if (schedulerStatus === "updating") return "running";
    if (schedulerStatus === "timeout") return "timeout";
    if (schedulerStatus === "runtime_error") {
      return sessionReportedForLatestRun && latestAcceptedSession !== null
        ? latestAcceptedSession.status
        : "worker_error";
    }
    if (latestAcceptedSession !== null) return latestAcceptedSession.status;
    return "idle";
  };

  const diagnosticBaseline = (): string => {
    const comparison = comparisonState.get();
    if (comparison.baseline === null) return "none";
    if (comparison.current === null) return "unavailable";
    const compatibility = compareRunCompatibility(comparison.baseline, comparison.current);
    return compatibility.status === "compatible" || compatibility.status === "same_run"
      ? "compatible"
      : "incompatible";
  };

  const getDiagnosticSnapshot = (): DiagnosticSnapshot => {
    const activeContext: DiagnosticRuntimeView["activeContext"] = !hasActiveTabSource
      ? "unavailable"
      : ownershipState?.kind === "leetcode"
        ? "leetcode"
        : ownershipState?.kind === "paused"
          ? "non_leetcode"
          : "unavailable";
    const testcaseReady = currentPageState?.testcase !== null && currentPageState?.testcase !== undefined;

    return collectDiagnosticSnapshot(
      {
        activeContext,
        problemSlug: currentPageState?.metadata.slug ?? null,
        language: currentPageState?.language ?? null,
        pageState: diagnosticPageState(currentPageState),
        activeTabOwned: !hasActiveTabSource || ownershipState === null
          ? "unavailable"
          : ownershipState.kind === "leetcode",
        pageBridge: pageBridgeStatus,
        editorSync: editorSyncStatus,
        testcaseState: testcaseReady ? "ready" : "unavailable",
        selectedCase: testcaseReady ? selectedCaseIndex + 1 : null,
        executionStatus: diagnosticExecutionStatus(),
        traceEvents: latestAcceptedSession?.events.length ?? null,
        durationMs: null,
        acceptedSnapshot: latestAcceptedSession !== null,
        visualizerKind,
        rawCursor,
        baseline: diagnosticBaseline(),
        behavioralDiff: currentComparison === null ? "unavailable" : "available"
      },
      diagnosticEnvironment,
      new Date()
    );
  };

  const supportDiagnostics = createSupportDiagnostics({
    getReport: () => formatDiagnosticReport(getDiagnosticSnapshot()),
    copyText: dependencies.diagnosticCopyText
  });

  const settings = document.createElement("details");
  settings.className = "app-settings";
  const settingsSummary = document.createElement("summary");
  settingsSummary.textContent = "Settings";
  const settingsBody = document.createElement("div");
  settingsBody.className = "app-settings__body";
  settingsBody.append(
    aboutPrivacy.element,
    supportDiagnostics.element,
    inputPanel,
    baselineControls.element,
    caseComparisonControls.element,
    caseBehavioralDiff.element
  );
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
        pageBridgeStatus = "unavailable";
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
    getDiagnosticSnapshot,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      editorSync.dispose();
      activeTabSource?.dispose();
      scheduler.dispose();
      baselineControls?.dispose();
      caseComparisonControls?.dispose();
      caseBehavioralDiff?.dispose();
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
