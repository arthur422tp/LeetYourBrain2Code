import { buildCallFrameStory } from "../../core/call-frame-story";
import { buildControlFlowOutlineGroups, buildControlFlowUiModel } from "../../core/execution-story";
import { createExecutionStory, type ExecutionStoryHandle } from "./ExecutionStory";
import { interpretTraceSession } from "../../core/trace-session-interpreter";
import type { TraceInterpretation } from "../../core/trace-interpreter";
import type { VisualState } from "../../core/visual-model";
import type { TraceEvent, TraceSession } from "../../shared/trace-types";
import type { EditorTraceStatus } from "../../shared/editor-trace";
import {
  buildTraceStepIndex,
  resolveBehavioralEvidenceMap
} from "../behavioral-navigation";
import { selectFailureFirstEvidence } from "../failure-first-selection";
import { buildTraceFoldModel } from "../trace-folding";
import { createBehavioralSignals } from "./BehavioralSignals";
import {
  createBehavioralTimeline,
  type BehavioralTimelineHandle
} from "./BehavioralTimeline";
import { createFailureFirstEntry } from "./FailureFirstEntry";
import {
  createBehavioralDiff,
  type BehavioralDiffHandle
} from "./BehavioralDiff";
import type { BehavioralDiffViewModel } from "../behavioral-diff-view";
import { createDecisionEvidence, decisionBadgeText } from "./DecisionEvidence";
import { createExpressionEvidence } from "./ExpressionEvidence";
import { createMutationList, formatMutationSummary } from "./MutationList";
import {
  createTraceOutline,
  type TraceOutlineHandle
} from "./TraceOutline";
import { formatValue } from "./value-format";
import type { MatrixPathSelection } from "./matrix-path-overlay";
import {
  createVisualizer,
  updateVisualizer,
  type VisualizerHandle
} from "./visualizer-registry";

const PLAY_INTERVAL_MS = 700;

export interface TraceVisualizerHandle {
  element: HTMLElement;
  setStep(index: number): void;
  setBehavioralDiff(model: BehavioralDiffViewModel | null): void;
  setEditorSyncStatus(status: EditorTraceStatus): void;
  dispose(): void;
}

export interface TraceVisualizerOptions {
  interpretation?: TraceInterpretation;
  comparison?: BehavioralDiffViewModel | null;
  comparisonActions?: unknown;
  onStepChange?(event: TraceEvent | undefined): void;
  onFollowEditorChange?(follow: boolean): void;
  followEditor?: boolean;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function createPanel(
  title: string,
  className: string,
  open = true
): { panel: HTMLDetailsElement; body: HTMLDivElement } {
  const panel = createElement("details", `trace-viewer__panel ${className}`);
  panel.open = open;

  const summary = createElement("summary", "trace-viewer__panel-summary");
  summary.append(
    createElement("span", "trace-viewer__panel-title", title),
    createElement("span", "trace-viewer__panel-chevron", "⌄")
  );

  const body = createElement("div", "trace-viewer__panel-body");
  panel.append(summary, body);
  return { panel, body };
}

function behavioralDiffPanelTitle(model: BehavioralDiffViewModel | null): string {
  if (model === null) return "Behavioral Diff";
  if (model?.divergence) {
    return `Behavioral Diff · ${model.divergence.categoryLabel.toLowerCase()}`;
  }
  if (model?.compatibility.status !== "compatible") {
    if (model?.compatibility.status === "different_testcase") {
      return "Behavioral Diff · incompatible testcase";
    }
    if (model?.compatibility.status === "no_baseline") {
      return "Behavioral Diff · no baseline";
    }
    return "Behavioral Diff · comparison unavailable";
  }
  if (model?.coverageMessage) return "Behavioral Diff · comparison incomplete";
  return "Behavioral Diff · no divergence observed";
}

function renderCodePanel(sourceCode: string): {
  panel: HTMLDetailsElement;
  lines: HTMLDivElement[];
  lineLabel: HTMLSpanElement;
  decisionBadge: HTMLSpanElement;
  setCurrentLine(line: number | null | undefined): void;
} {
  const { panel, body } = createPanel("Code", "trace-viewer__code-panel");
  const header = createElement("div", "trace-viewer__code-meta");
  const language = createElement("span", undefined, "Python");
  const lineLabel = createElement("span", undefined, "No active line");
  const decisionBadge = createElement("span", "trace-viewer__decision-badge");
  decisionBadge.dataset.decisionBadge = "true";
  decisionBadge.dataset.codeEvidenceBadge = "true";
  decisionBadge.hidden = true;
  header.append(language, lineLabel, decisionBadge);

  const code = createElement("pre", "trace-viewer__code");
  const lines = sourceCode.replace(/\r\n/g, "\n").split("\n").map((sourceLine, index) => {
    const line = createElement("div", "trace-viewer__code-line");
    line.dataset.line = String(index + 1);

    const lineNumber = createElement("span", "trace-viewer__line-number", String(index + 1));
    const lineText = createElement("code", "trace-viewer__line-text", sourceLine || " ");
    line.append(lineNumber, lineText);
    code.append(line);
    return line;
  });
  body.append(header, code);
  const toggle = createElement("button", "trace-viewer__code-toggle", "Show full code");
  toggle.type = "button";
  toggle.dataset.action = "toggle-full-code";
  toggle.setAttribute("aria-expanded", "false");
  header.append(toggle);
  let fullCode = false;
  let currentLine: number | null | undefined;
  const updateExcerpt = (): void => {
    for (const line of lines) {
      const number = Number(line.dataset.line);
      line.hidden = !fullCode && (!(currentLine && currentLine > 0) || Math.abs(number - currentLine) > 1);
    }
    lineLabel.textContent = currentLine && currentLine > 0 ? `Line ${currentLine}` : "No active source line";
  };
  toggle.addEventListener("click", () => {
    fullCode = !fullCode;
    toggle.textContent = fullCode ? "Show current lines" : "Show full code";
    toggle.setAttribute("aria-expanded", String(fullCode));
    updateExcerpt();
  });
  return { panel, lines, lineLabel, decisionBadge, setCurrentLine: (line) => { currentLine = line; updateExcerpt(); } };
}

function renderEmptyState(message: string): HTMLDivElement {
  return createElement("div", "trace-viewer__empty", message);
}

function createVisualStateRenderer(): {
  body: HTMLDivElement;
  setState(state: VisualState | undefined): void;
  dispose(): void;
} {
  const body = createElement("div", "trace-viewer__visual-state-body");
  const stateMeta = createElement("div", "trace-viewer__state-meta");
  const visualsHost = createElement("div", "trace-viewer__visuals");
  body.append(stateMeta, visualsHost);

  const handles = new Map<string, VisualizerHandle>();
  const onPathSelection = (event: Event): void => {
    const detail = (event as CustomEvent<MatrixPathSelection>).detail;
    for (const handle of handles.values()) {
      if (handle.kind === "matrix" && handle.element !== event.target) {
        handle.element.dispatchEvent(new CustomEvent("matrix-path-sync", { detail }));
      }
    }
  };
  visualsHost.addEventListener("matrix-path-select", onPathSelection);
  // Runtime ranking controls visibility, but a visible visual should not jump
  // to a different vertical slot just because another visual became relevant.
  const visualOrder = new Map<string, number>();
  let nextVisualOrder = 0;

  const disposeHandles = (): void => {
    for (const handle of handles.values()) {
      handle.dispose();
    }
    handles.clear();
  };

  const setState = (state: VisualState | undefined): void => {
    if (!state) {
      disposeHandles();
      body.replaceChildren(renderEmptyState("No execution steps were captured."));
      return;
    }

    body.replaceChildren(stateMeta, visualsHost);
    stateMeta.textContent = state.currentLine === null
      ? "No source line"
      : `Line ${state.currentLine}`;

    const visuals = state.visuals;
    if (visuals.length === 0) {
      disposeHandles();
      visualsHost.replaceChildren(
        renderEmptyState("No visualizable containers for this step. See Locals below.")
      );
      return;
    }

    for (const visual of visuals) {
      if (!visualOrder.has(visual.visualId)) {
        visualOrder.set(visual.visualId, nextVisualOrder);
        nextVisualOrder += 1;
      }
    }
    const orderedVisuals = [...visuals].sort((left, right) =>
      visualOrder.get(left.visualId)! - visualOrder.get(right.visualId)!
    );

    const nextKeys = new Set<string>();
    const elements: HTMLElement[] = [];
    for (const visual of orderedVisuals) {
      const key = visual.visualId;
      nextKeys.add(key);
      const existing = handles.get(key);
      if (existing?.kind === visual.kind) {
        updateVisualizer(existing, visual);
        elements.push(existing.element);
      } else {
        existing?.dispose();
        const handle = createVisualizer(visual);
        handles.set(key, handle);
        elements.push(handle.element);
      }
    }

    for (const [key, entry] of handles) {
      if (!nextKeys.has(key)) {
        entry.dispose();
        handles.delete(key);
      }
    }
    visualsHost.replaceChildren(...elements);
  };

  return {
    body,
    setState,
    dispose() {
      visualsHost.removeEventListener("matrix-path-select", onPathSelection);
      disposeHandles();
    }
  };
}

function renderLocals(state: VisualState | undefined): HTMLDivElement {
  const body = createElement("div", "trace-viewer__locals");
  const entries = state ? Object.entries(state.locals) : [];
  if (entries.length === 0) {
    body.append(renderEmptyState("No local variables at this step."));
    return body;
  }

  const table = createElement("div", "trace-viewer__locals-table");
  for (const [name, value] of entries) {
    const row = createElement("div", "trace-viewer__local-row");
    row.dataset.localName = name;
    row.append(
      createElement("code", "trace-viewer__local-name", name),
      createElement("span", "trace-viewer__local-equals", "="),
      createElement("code", "trace-viewer__local-value", formatValue(value))
    );
    table.append(row);
  }
  body.append(table);
  return body;
}

function renderCallStack(
  state: VisualState | undefined,
  className: string,
  open = true
): HTMLDetailsElement {
  const { panel, body } = createPanel("Call Stack", className, open);
  if (!state || state.callStack.length === 0) {
    body.append(renderEmptyState("Call stack is empty."));
    return panel;
  }

  const stack = createElement("ol", "trace-viewer__call-stack");
  for (const entry of state.callStack) {
    const item = createElement("li", "trace-viewer__call-frame");
    if (entry.depth === state.callStack.length) {
      item.classList.add("is-active");
    }
    item.append(
      createElement("code", undefined, entry.functionName),
      createElement("span", "trace-viewer__call-line", entry.line === null ? "" : `line ${entry.line}`)
    );
    stack.append(item);
  }
  body.append(stack);
  return panel;
}

function renderOutput(state: VisualState | undefined, session: TraceSession): HTMLDivElement | null {
  const stdout = state?.stdout ?? session.stdout;
  const exception = state?.exception ?? (state === undefined ? session.exception : undefined);
  if (!stdout && !exception) {
    return null;
  }

  const body = createElement("div", "trace-viewer__output");
  if (stdout) {
    const stdoutBlock = createElement("div", "trace-viewer__stdout");
    stdoutBlock.append(createElement("div", "trace-viewer__subheading", "stdout"));
    stdoutBlock.append(createElement("pre", undefined, stdout));
    body.append(stdoutBlock);
  }
  if (exception) {
    const exceptionBlock = createElement("div", "trace-viewer__exception");
    exceptionBlock.append(
      createElement("div", "trace-viewer__subheading", `${exception.type}${exception.line ? ` · line ${exception.line}` : ""}`),
      createElement("p", undefined, exception.message || "Runtime exception")
    );
    body.append(exceptionBlock);
  }
  return body;
}

export { interpretTraceSession };

export function createTraceVisualizer(
  session: TraceSession,
  options: TraceVisualizerOptions = {}
): TraceVisualizerHandle {
  const interpretation = options.interpretation ?? interpretTraceSession(session);
  const traceIndex = buildTraceStepIndex(session.events.map((event) => event.step));
  const evidenceByPatternId = resolveBehavioralEvidenceMap(
    interpretation.behavioralAnalysis.patterns,
    traceIndex
  );
  const failureFirstSelection = selectFailureFirstEvidence(
    session.status,
    session.events.length,
    interpretation.behavioralAnalysis.patterns,
    evidenceByPatternId
  );
  const traceFoldModel = buildTraceFoldModel(
    session.events.length,
    interpretation.behavioralAnalysis.patterns,
    evidenceByPatternId
  );
  const root = createElement("section", "trace-viewer");
  root.id = "trace-viewer";

  const summary = createElement("div", "trace-viewer__summary");
  const summaryHeading = createElement("div", "trace-viewer__summary-heading");
  summaryHeading.append(
    createElement("h2", undefined, "Trace"),
    createElement("span", `trace-viewer__status is-${session.status}`, session.status)
  );
  const summaryDetail = createElement(
    "div",
    "trace-viewer__summary-detail",
    `${session.terminationReason.replaceAll("_", " ")} · ${session.events.length} captured steps`
  );
  summary.append(summaryHeading, summaryDetail);

  const codePanel = renderCodePanel(session.sourceCode);
  const editorContext = createElement("div", "trace-viewer__editor-context");
  editorContext.hidden = !options.onStepChange;
  const editorStatus = createElement("span", "trace-viewer__editor-status", "Connecting to LeetCode editor…");
  editorStatus.setAttribute("role", "status");
  const executionLocation = createElement("span", "trace-viewer__execution-location");
  const followEditor = createElement("button", "trace-viewer__follow-editor", "Follow line");
  followEditor.type = "button";
  followEditor.setAttribute("aria-pressed", String(options.followEditor ?? true));
  followEditor.addEventListener("click", () => {
    const follow = followEditor.getAttribute("aria-pressed") !== "true";
    followEditor.setAttribute("aria-pressed", String(follow));
    options.onFollowEditorChange?.(follow);
  });
  editorContext.append(editorStatus, executionLocation, followEditor);
  let editorSyncStatus: EditorTraceStatus | undefined;
  const setEditorSyncStatus = (status: EditorTraceStatus): void => {
    if (status === editorSyncStatus) return;
    editorSyncStatus = status;
    root.dataset.editorSync = status;
    editorStatus.textContent = status === "synced" ? "Highlighted in LeetCode"
      : status === "stale" ? "Code changed · waiting for a new run"
      : status === "cleared" ? "No active source line"
      : "Editor unavailable · showing trace code";
    codePanel.panel.open = status !== "synced";
    codePanel.panel.querySelector(".trace-viewer__panel-title")!.textContent = status === "synced" ? "Trace code" : "Code · recorded source";
  };
  const visualPanel = {
    panel: createElement("section", "trace-viewer__panel trace-viewer__visual-panel"),
    body: createElement("div", "trace-viewer__panel-body")
  };
  visualPanel.panel.setAttribute("aria-label", "Visual State");
  visualPanel.panel.append(visualPanel.body);
  const visualStateRenderer = createVisualStateRenderer();
  visualPanel.body.append(visualStateRenderer.body);
  const decisionPanel = session.conditionPlan || (session.decisionBatches?.length ?? 0) > 0
    ? createPanel("Decision Evidence", "trace-viewer__decision-panel", false)
    : null;
  const hasCallFrameSurface = interpretation.callFrames.byFrameId.size > 0 ||
    (session.callFrameTracing !== undefined && session.callFrameTracing.status !== "complete");
  const hasControlFlowSurface = !!session.controlFlowPlan ||
    (session.controlFlowBatches?.length ?? 0) > 0 ||
    (session.controlFlowTracing !== undefined && session.controlFlowTracing.status !== "complete");
  const storyTracing = session.callFrameTracing !== undefined && session.callFrameTracing.status !== "complete"
    ? session.callFrameTracing
    : session.controlFlowTracing;
  const storyPanel = hasCallFrameSurface || hasControlFlowSurface
    ? createPanel("Execution Story", "trace-viewer__execution-story-panel", false)
    : null;
  const behavioralDiffPanel = createPanel(
    "Behavioral Diff",
    "trace-viewer__behavioral-diff-panel",
    false
  );
  const expressionPanel = createPanel("Expression Evidence", "trace-viewer__expression-panel", false);
  const changesPanel = createPanel("What Changed", "trace-viewer__changes-panel", false);
  const behavioralPanel = createPanel(
    "Behavioral Signals",
    "trace-viewer__behavioral-panel",
    true
  );
  const localsPanel = createPanel("Locals", "trace-viewer__locals-panel", false);
  const advancedPanel = createPanel("Execution analysis & advanced", "trace-viewer__advanced", false);
  let callStackPanel = renderCallStack(undefined, "trace-viewer__call-stack-panel", false);
  const outputPanel = createPanel("Output", "trace-viewer__output-panel", false);
  const outputBody = outputPanel.body;
  const debugPanel = createPanel(`Debug details · ${session.events.length} raw events`, "trace-viewer__debug", false);
  const traceOutput = createElement("pre", undefined, JSON.stringify(session.events, null, 2));
  traceOutput.id = "trace-output";
  debugPanel.body.append(traceOutput);

  const stepLabel = createElement("strong", "trace-viewer__step-label", "No steps");
  const stepMeta = createElement("span", "trace-viewer__step-meta");
  const previous = createElement("button", undefined, "◀ Previous");
  previous.id = "trace-previous";
  previous.type = "button";
  const next = createElement("button", "is-primary", "Next ▶");
  next.id = "trace-next";
  next.type = "button";
  const play = createElement("button", undefined, "▶ Play");
  play.id = "trace-play";
  play.type = "button";
  const controls = createElement("nav", "trace-viewer__controls");
  controls.setAttribute("aria-label", "Trace playback");
  const stepInfo = createElement("div", "trace-viewer__step-info");
  stepInfo.append(stepLabel, stepMeta);
  controls.append(previous, play, next, stepInfo);

  const inspectorGrid = createElement("div", "trace-viewer__inspector-grid");
  inspectorGrid.append(changesPanel.panel, localsPanel.panel);
  const recentChange = createElement("div", "trace-viewer__recent-change");
  recentChange.setAttribute("aria-label", "Changes since the previous captured step");
  recentChange.hidden = true;

  let currentIndex = 0;
  let timer: number | null = null;
  let navigateDirect: (index: number) => void;
  let outlineHandle: TraceOutlineHandle | null = null;
  let timelineHandle: BehavioralTimelineHandle | null = null;
  let executionStoryHandle: ExecutionStoryHandle | null = null;
  let behavioralDiffHandle: BehavioralDiffHandle | null = null;

  const stopPlaying = (): void => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    play.textContent = "▶ Play";
    root.dataset.playing = "false";
  };

  const onNavigateStep = (step: number): void => {
    const index = traceIndex.stepToIndex.get(step);
    if (index !== undefined) navigateDirect(index);
  };
  const storyModelAt = (step: number, frameId: number) => buildControlFlowUiModel({
    step, frameId, sourceCode: session.sourceCode, plan: session.controlFlowPlan,
    controlFlow: interpretation.controlFlow, decisionEvidence: interpretation.decisionEvidence,
    decisionChains: interpretation.decisionChains, tracingState: session.controlFlowTracing
  });
  const callFrameStoryAt = (rawIndex: number) => buildCallFrameStory({
    callFrames: interpretation.callFrames,
    frameEvidenceIndex: interpretation.frameEvidenceIndex,
    functionPlan: session.functionPlan,
    events: session.events,
    currentRawIndex: rawIndex
  });
  const canNavigateStep = (step: number): boolean => traceIndex.stepToIndex.has(step);
  const updateExecutionStory = (
    controlFlow: ReturnType<typeof storyModelAt>,
    rawIndex: number
  ): void => {
    if (!storyPanel) return;
    const model = {
      callFrame: hasCallFrameSurface ? callFrameStoryAt(rawIndex) : undefined,
      controlFlow: hasControlFlowSurface ? controlFlow : undefined
    };
    if (!executionStoryHandle) {
      executionStoryHandle = createExecutionStory({
        model,
        onNavigateStep,
        canNavigateStep
      });
      storyPanel.body.append(executionStoryHandle.element);
      return;
    }
    executionStoryHandle.update(model);
    if (!storyPanel.body.contains(executionStoryHandle.element)) {
      storyPanel.body.append(executionStoryHandle.element);
    }
  };
  const updateEvidencePanel = (
    target: ReturnType<typeof createPanel> | null,
    title: string,
    hasEvidence: boolean,
    tracing?: { status: string }
  ): void => {
    if (!target) return;
    const incomplete = tracing && tracing.status !== "complete";
    target.panel.hidden = !hasEvidence && !incomplete;
    target.panel.querySelector(".trace-viewer__panel-title")!.textContent = `${title}${incomplete ? ` · ${tracing.status}` : ""}`;
  };

  const setStep = (requestedIndex: number): void => {
    if (interpretation.visualStates.length === 0) {
      codePanel.setCurrentLine(undefined);
      updateEvidencePanel(storyPanel, "Execution Story", hasCallFrameSurface, storyTracing);
      updateEvidencePanel(decisionPanel, "Decision Evidence", false, session.decisionTracing);
      updateEvidencePanel(expressionPanel, "Expression Evidence", false, session.expressionTracing);
      changesPanel.panel.hidden = true;
      localsPanel.panel.hidden = true;
      updateExecutionStory(storyModelAt(-1, -1), -1);
      currentIndex = 0;
      stepLabel.textContent = "No steps";
      stepMeta.textContent = "";
      visualStateRenderer.setState(undefined);
      decisionPanel?.body.replaceChildren(createDecisionEvidence({
        evidence: undefined,
        tracingState: session.decisionTracing,
        chain: undefined,
        history: [],
        onNavigateStep: (step) => {
          const index = traceIndex.stepToIndex.get(step);
          if (index !== undefined) navigateDirect(index);
        }
      }));
      expressionPanel.body.replaceChildren(createExpressionEvidence(undefined, session.expressionTracing));
      changesPanel.body.replaceChildren(createMutationList([]));
      behavioralPanel.body.replaceChildren(createBehavioralSignals(
        {
          analysis: interpretation.behavioralAnalysis,
          currentIndex,
          evidenceByPatternId,
          onNavigate: navigateDirect
        }
      ));
      localsPanel.body.replaceChildren(renderLocals(undefined));
      const emptyCallStack = renderCallStack(undefined, "trace-viewer__call-stack-panel", callStackPanel.open);
      callStackPanel.replaceWith(emptyCallStack);
      callStackPanel = emptyCallStack;
      outputBody.replaceChildren(
        renderOutput(undefined, session) ?? renderEmptyState("No stdout or exception at this step.")
      );
      previous.disabled = true;
      next.disabled = true;
      play.disabled = true;
      executionLocation.textContent = "No captured source step";
      options.onStepChange?.(undefined);
      return;
    }

    currentIndex = Math.max(0, Math.min(requestedIndex, interpretation.visualStates.length - 1));
    const state = interpretation.visualStates[currentIndex];
    const event = session.events[currentIndex];
    stepLabel.textContent = `Step ${currentIndex + 1} / ${interpretation.visualStates.length}`;
    stepMeta.textContent = event ? `${event.event} · ${event.function}` : "";
    root.dataset.stepIndex = String(currentIndex);

    for (const line of codePanel.lines) {
      const active = state?.currentLine !== null && Number(line.dataset.line) === state?.currentLine;
      line.classList.toggle("is-active", active);
      if (active) {
        line.setAttribute("aria-current", "step");
      } else {
        line.removeAttribute("aria-current");
      }
    }
    codePanel.setCurrentLine(state?.currentLine);
    executionLocation.textContent = event && event.line !== null && event.line > 0
      ? `${event.function} · L${event.line} · ${event.event === "line" ? "before line" : event.event}`
      : "Outside recorded source";

    const controlFlowUiModel = storyModelAt(event?.step ?? -1, event?.frameId ?? -1);
    const callFrameUiModel = hasCallFrameSurface ? callFrameStoryAt(currentIndex) : undefined;
    updateExecutionStory(controlFlowUiModel, currentIndex);
    const decisionEvidence = event
      ? interpretation.decisionEvidence.get(event.step)
      : undefined;
    const decisionChain = (decisionEvidence
      ? interpretation.decisionChains.find((chain) => chain.frameId === event?.frameId && chain.branches.some((branch) =>
        branch.siteId === decisionEvidence.siteId && branch.anchorStep === decisionEvidence.anchorStep
      ))
      : undefined) ?? controlFlowUiModel.decisionChainOccurrence;
    const decisionHistory = decisionEvidence
      ? interpretation.decisionHistory.get(decisionEvidence.siteId) ?? []
      : [];
    const activation = controlFlowUiModel.currentActivation;
    const currentFrame = callFrameUiModel?.currentFrameId === undefined
      ? undefined
      : callFrameUiModel.byFrameId.get(callFrameUiModel.currentFrameId);
    const storyTitle = currentFrame
      ? `Execution Story · ${currentFrame.functionName}`
      : activation && controlFlowUiModel.currentIteration
      ? `Execution Story · ${activation.loopKind.toUpperCase()} · #${controlFlowUiModel.currentIteration.ordinal}`
      : "Execution Story";
    updateEvidencePanel(
      storyPanel,
      storyTitle,
      hasCallFrameSurface || controlFlowUiModel.storyItems.length > 0,
      storyTracing
    );
    updateEvidencePanel(decisionPanel, "Decision Evidence", !!decisionEvidence || !!decisionChain, session.decisionTracing);
    updateEvidencePanel(expressionPanel, "Expression Evidence", !!event && interpretation.expressionEvidence.has(event.step), session.expressionTracing);
    changesPanel.panel.hidden = !state?.mutations.length;
    const stepChanges = (state?.mutations ?? []).filter(mutation => mutation.origin !== "initial_snapshot");
    recentChange.hidden = stepChanges.length === 0;
    recentChange.textContent = stepChanges.slice(0, 2).map(formatMutationSummary).join(" · ");
    const committed = interpretation.controlFlow.actions.find(action => action.frameId === event?.frameId && action.status === "committed" && action.anchorStepResolved === event?.step);
    const observed = interpretation.controlFlow.actions.find(action => action.frameId === event?.frameId && action.anchorStepObserved === event?.step);
    const boundary = controlFlowUiModel.currentIteration;
    const badge = committed ? `${committed.kind} committed`
      : observed ? `${observed.kind} observed`
      : boundary?.iteration.anchorStepStart === event?.step ? `iteration #${boundary.ordinal}`
      : decisionBadgeText(decisionEvidence);
    codePanel.decisionBadge.hidden = badge === null;
    codePanel.decisionBadge.textContent = badge ?? "";

    visualStateRenderer.setState(state);
    decisionPanel?.body.replaceChildren(createDecisionEvidence({
      evidence: decisionEvidence,
      tracingState: session.decisionTracing,
      chain: decisionChain,
      history: decisionHistory,
      onNavigateStep: (step) => {
        const index = traceIndex.stepToIndex.get(step);
        if (index !== undefined) navigateDirect(index);
      }
    }));
    expressionPanel.body.replaceChildren(createExpressionEvidence(
      event ? interpretation.expressionEvidence.get(event.step) : undefined,
      session.expressionTracing
    ));
    changesPanel.body.replaceChildren(createMutationList(state?.mutations ?? []));
    behavioralPanel.body.replaceChildren(createBehavioralSignals(
      {
        analysis: interpretation.behavioralAnalysis,
        currentIndex,
        evidenceByPatternId,
        onNavigate: navigateDirect
      }
    ));
    localsPanel.body.replaceChildren(renderLocals(state));

    const updatedCallStack = renderCallStack(
      state,
      "trace-viewer__call-stack-panel",
      callStackPanel.open
    );
    callStackPanel.replaceWith(updatedCallStack);
    callStackPanel = updatedCallStack;
    outputBody.replaceChildren();
    const output = renderOutput(state, session);
    outputBody.append(output ?? renderEmptyState("No stdout or exception at this step."));

    previous.disabled = currentIndex === 0;
    next.disabled = currentIndex === interpretation.visualStates.length - 1;
    play.disabled = interpretation.visualStates.length < 2;
    outlineHandle?.setCurrentIndex(currentIndex);
    timelineHandle?.setCurrentIndex(currentIndex);
    if (currentIndex === interpretation.visualStates.length - 1) {
      stopPlaying();
    }
    options.onStepChange?.(event);
  };

  navigateDirect = (index: number): void => {
    stopPlaying();
    setStep(index);
  };

  behavioralDiffHandle = createBehavioralDiff({
    model: options.comparison ?? null,
    onInspectCurrent: onNavigateStep
  });
  behavioralDiffPanel.body.append(behavioralDiffHandle.element);
  const setBehavioralDiff = (model: BehavioralDiffViewModel | null): void => {
    behavioralDiffHandle?.update(model);
    behavioralDiffPanel.panel.hidden = model === null;
    behavioralDiffPanel.panel.querySelector(".trace-viewer__panel-title")!.textContent =
      behavioralDiffPanelTitle(model);
  };
  setBehavioralDiff(options.comparison ?? null);

  const failureFirstEntry = failureFirstSelection
    ? createFailureFirstEntry({
        selection: failureFirstSelection,
        onNavigate: navigateDirect
      })
    : null;

  outlineHandle = createTraceOutline({
    controlFlowGroups: buildControlFlowOutlineGroups(session.controlFlowPlan, interpretation.controlFlow).map(group => ({
      activationKey: group.activationKey,
      title: `${group.loopKind.toUpperCase()} · line ${group.line} · frame ${group.frameId}`,
      iterations: group.iterations.flatMap(iteration => {
        const startIndex = traceIndex.stepToIndex.get(iteration.anchorStepStart);
        const endIndex = traceIndex.stepToIndex.get(iteration.anchorStepEnd);
        return startIndex === undefined || endIndex === undefined ? [] : [{...iteration, startIndex, endIndex}];
      })
    })).filter(group => group.iterations.length > 0),
    model: traceFoldModel,
    currentIndex,
    onNavigate: navigateDirect
  });

  timelineHandle = createBehavioralTimeline({
    analysis: interpretation.behavioralAnalysis,
    traceIndex,
    evidenceByPatternId,
    currentIndex,
    onNavigate: navigateDirect
  });
  // Reuse the existing raw slider and its cursor callback; only move its DOM location.
  const rawRange = timelineHandle.element.querySelector<HTMLInputElement>('[data-role="trace-range"]');
  if (rawRange) controls.append(rawRange);
  advancedPanel.body.append(behavioralPanel.panel, outlineHandle.element, timelineHandle.element, callStackPanel, debugPanel.panel);

  previous.addEventListener("click", () => setStep(currentIndex - 1));
  next.addEventListener("click", () => setStep(currentIndex + 1));
  play.addEventListener("click", () => {
    if (timer !== null) {
      stopPlaying();
      return;
    }
    if (interpretation.visualStates.length < 2) {
      return;
    }
    if (currentIndex >= interpretation.visualStates.length - 1) {
      setStep(0);
    }
    play.textContent = "Ⅱ Pause";
    root.dataset.playing = "true";
    timer = window.setInterval(() => setStep(currentIndex + 1), PLAY_INTERVAL_MS);
  });

  root.append(summary);
  if (failureFirstEntry) {
    root.append(failureFirstEntry);
  }
  const primary = createElement("div", "trace-viewer__primary");
  primary.append(
    codePanel.panel,
    visualPanel.panel
  );
  const details = createPanel("Details · variables, output & analysis", "trace-viewer__details", false);
  details.body.append(
    ...(storyPanel ? [storyPanel.panel] : []),
    behavioralDiffPanel.panel,
    ...(decisionPanel ? [decisionPanel.panel] : []),
    expressionPanel.panel,
    inspectorGrid,
    outputPanel.panel,
    advancedPanel.panel
  );
  root.append(editorContext, primary, recentChange, details.panel, controls);
  const firstSolutionLine = session.events.findIndex(event =>
    event.event === "line" && event.line !== null && event.line > 0 && event.function === session.entrypoint.methodName
  );
  setStep(Math.max(0, firstSolutionLine));

  return {
    element: root,
    setStep,
    setBehavioralDiff,
    setEditorSyncStatus,
    dispose: () => {
      stopPlaying();
      executionStoryHandle?.dispose();
      visualStateRenderer.dispose();
      behavioralDiffHandle?.dispose();
    }
  };
}
