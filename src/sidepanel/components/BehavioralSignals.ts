import type {
  BehavioralAnalysis,
  BehavioralPattern,
  ExecutionLocation
} from "../../core/behavioral-pattern";

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

function renderPattern(pattern: BehavioralPattern, currentStep: number): HTMLDivElement {
  const row = createElement("div", "trace-viewer__behavioral-signal");
  row.dataset.patternId = pattern.patternId;
  row.dataset.patternKind = pattern.kind;
  if (pattern.evidenceSteps.includes(currentStep)) {
    row.classList.add("is-active");
  }
  row.append(
    createElement("strong", "trace-viewer__behavioral-signal-title", title(pattern)),
    createElement("span", "trace-viewer__behavioral-signal-detail", detail(pattern))
  );
  return row;
}

export function createBehavioralSignals(
  analysis: BehavioralAnalysis,
  currentStep: number
): HTMLDivElement {
  const body = createElement("div", "trace-viewer__behavioral-signals");
  if (analysis.patterns.length === 0) {
    body.append(createElement(
      "div",
      "trace-viewer__empty",
      "No repeated behavioral signal in the captured trace."
    ));
    return body;
  }

  body.append(...analysis.patterns.map((pattern) => renderPattern(pattern, currentStep)));
  return body;
}
