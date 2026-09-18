import { buildControlFlowOutlineGroups, buildControlFlowUiModel } from "../../core/execution-story";
import { createExecutionStory } from "./ExecutionStory";
import { interpretTrace } from "../../core/trace-interpreter";
import type { VisualState } from "../../core/visual-model";
import type { TraceSession } from "../../shared/trace-types";
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
import { createDecisionEvidence, decisionBadgeText } from "./DecisionEvidence";
import { createExpressionEvidence } from "./ExpressionEvidence";
import { createMutationList } from "./MutationList";
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
  dispose(): void;
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

function renderCodePanel(sourceCode: string): {
  panel: HTMLDetailsElement;
  lines: HTMLDivElement[];
  lineLabel: HTMLSpanElement;
  decisionBadge: HTMLSpanElement;
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
  return { panel, lines, lineLabel, decisionBadge };
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

export function createTraceVisualizer(session: TraceSession): TraceVisualizerHandle {
  const interpretation = interpretTrace(
    session.events,
    session.subscriptRelations ?? [],
    session.expressionPlan,
    session.expressionBatches ?? [],
    session.conditionPlan,
    session.decisionBatches ?? [],
    session.controlFlowPlan,
    session.controlFlowBatches ?? [],
    { status: session.status, terminationReason: session.terminationReason }
  );
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
  const visualPanel = createPanel("Visual State", "trace-viewer__visual-panel");
  const visualStateRenderer = createVisualStateRenderer();
  visualPanel.body.append(visualStateRenderer.body);
  const decisionPanel = session.conditionPlan || (session.decisionBatches?.length ?? 0) > 0
    ? createPanel("Decision Evidence", "trace-viewer__decision-panel")
    : null;
  const storyPanel = session.controlFlowPlan || (session.controlFlowBatches?.length ?? 0) > 0 || (session.controlFlowTracing && session.controlFlowTracing.status !== "complete")
    ? createPanel("Execution Story", "trace-viewer__execution-story-panel")
    : null;
  const expressionPanel = createPanel("Expression Evidence", "trace-viewer__expression-panel");
  const changesPanel = createPanel("What Changed", "trace-viewer__changes-panel");
  const behavioralPanel = createPanel(
    "Behavioral Signals",
    "trace-viewer__behavioral-panel",
    true
  );
  const localsPanel = createPanel("Locals", "trace-viewer__locals-panel");
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
  const stepInfo = createElement("div", "trace-viewer__step-info");
  stepInfo.append(stepLabel, stepMeta);
  controls.append(previous, stepInfo, next, play);

  const inspectorGrid = createElement("div", "trace-viewer__inspector-grid");
  inspectorGrid.append(changesPanel.panel, behavioralPanel.panel, localsPanel.panel);

  let currentIndex = 0;
  let timer: number | null = null;
  let navigateDirect: (index: number) => void;
  let outlineHandle: TraceOutlineHandle | null = null;
  let timelineHandle: BehavioralTimelineHandle | null = null;

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

  const setStep = (requestedIndex: number): void => {
    if (interpretation.visualStates.length === 0) {
      storyPanel?.body.replaceChildren(createExecutionStory({model: storyModelAt(-1, -1), onNavigateStep}));
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
    codePanel.lineLabel.textContent = state?.currentLine === null || state?.currentLine === undefined
      ? "No active line"
      : `Line ${state.currentLine}`;

    const controlFlowUiModel = storyModelAt(event?.step ?? -1, event?.frameId ?? -1);
    storyPanel?.body.replaceChildren(createExecutionStory({model: controlFlowUiModel, onNavigateStep}));
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
  };

  navigateDirect = (index: number): void => {
    stopPlaying();
    setStep(index);
  };

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
  root.append(
    codePanel.panel,
    visualPanel.panel,
    ...(storyPanel ? [storyPanel.panel] : []),
    ...(decisionPanel ? [decisionPanel.panel] : []),
    expressionPanel.panel,
    inspectorGrid,
    callStackPanel,
    outputPanel.panel,
    debugPanel.panel,
    outlineHandle.element,
    timelineHandle.element,
    controls
  );
  setStep(0);

  return {
    element: root,
    setStep,
    dispose: () => {
      stopPlaying();
      visualStateRenderer.dispose();
    }
  };
}
