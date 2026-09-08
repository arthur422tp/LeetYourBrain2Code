import type {
  BehavioralAnalysis,
  BehavioralPattern,
  ExecutionLocation
} from "../../core/behavioral-pattern";
import {
  nextEvidenceIndex,
  previousEvidenceIndex,
  type ResolvedBehavioralEvidence
} from "../behavioral-navigation";

export interface BehavioralSignalsOptions {
  analysis: BehavioralAnalysis;
  currentIndex: number;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  onNavigate(index: number): void;
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

function locationLabel(location: ExecutionLocation): string {
  return `${location.functionName} · line ${location.line}`;
}

function title(pattern: BehavioralPattern): string {
  switch (pattern.kind) {
    case "repeated_state":
      return `Repeated state × ${pattern.repeatCount}`;
    case "no_progress":
      return `No observable progress · ${pattern.revisitCount} revisits`;
    case "repeated_transition":
      return `Repeated transition motif × ${pattern.repeatCount}`;
  }
}

function detail(pattern: BehavioralPattern): string {
  switch (pattern.kind) {
    case "repeated_state":
      return `${locationLabel(pattern.location)} revisited the same observable state.`;
    case "no_progress":
      return `Captured state stayed exact-equal across consecutive visits to ${locationLabel(pattern.location)}.`;
    case "repeated_transition":
      return `${pattern.periodSteps}-step pattern across captured steps ${pattern.startStep}–${pattern.endStep}.`;
  }
}

function navigationButton(
  label: string,
  action: "first" | "previous" | "next" | "last",
  targetIndex: number | null,
  onNavigate: (index: number) => void,
  disabledWhenCurrent: boolean
): HTMLButtonElement {
  const button = createElement("button", "trace-viewer__behavioral-nav-button", label);
  button.type = "button";
  button.dataset.behaviorAction = action;
  button.disabled = targetIndex === null || disabledWhenCurrent;
  button.addEventListener("click", () => {
    if (targetIndex !== null) {
      onNavigate(targetIndex);
    }
  });
  return button;
}

function renderPattern(
  pattern: BehavioralPattern,
  currentIndex: number,
  evidence: ResolvedBehavioralEvidence | undefined,
  onNavigate: (index: number) => void
): HTMLDivElement {
  const row = createElement("div", "trace-viewer__behavioral-signal");
  row.dataset.patternId = pattern.patternId;
  row.dataset.patternKind = pattern.kind;

  const valid: ResolvedBehavioralEvidence = evidence ?? {
    patternId: pattern.patternId,
    evidenceSteps: [],
    evidenceIndexes: [],
    firstIndex: null,
    lastIndex: null
  };
  const previous = previousEvidenceIndex(valid, currentIndex);
  const next = nextEvidenceIndex(valid, currentIndex);

  if (valid.evidenceIndexes.includes(currentIndex)) {
    row.classList.add("is-active");
  }

  const meta = valid.evidenceIndexes.length > 0
    ? `Evidence: steps ${valid.evidenceSteps[0]}–${valid.evidenceSteps.at(-1)} · ${valid.evidenceIndexes.length} observations`
    : "Navigation unavailable for this signal.";

  const actions = createElement("div", "trace-viewer__behavioral-nav-actions");
  actions.append(
    navigationButton("First", "first", valid.firstIndex, onNavigate, currentIndex === valid.firstIndex),
    navigationButton("Previous", "previous", previous, onNavigate, false),
    navigationButton("Next", "next", next, onNavigate, false),
    navigationButton("Last", "last", valid.lastIndex, onNavigate, currentIndex === valid.lastIndex)
  );

  row.append(
    createElement("strong", "trace-viewer__behavioral-signal-title", title(pattern)),
    createElement("span", "trace-viewer__behavioral-signal-detail", detail(pattern)),
    createElement("span", "trace-viewer__behavioral-nav-meta", meta),
    actions
  );
  return row;
}

export function createBehavioralSignals(
  options: BehavioralSignalsOptions
): HTMLDivElement {
  const body = createElement("div", "trace-viewer__behavioral-signals");
  if (options.analysis.patterns.length === 0) {
    body.append(createElement(
      "div",
      "trace-viewer__empty",
      "No repeated behavioral signal in the captured trace."
    ));
    return body;
  }

  body.append(...options.analysis.patterns.map((pattern) => renderPattern(
    pattern,
    options.currentIndex,
    options.evidenceByPatternId.get(pattern.patternId),
    options.onNavigate
  )));
  return body;
}
