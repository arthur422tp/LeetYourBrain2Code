import type { FailureFirstSelection } from "../failure-first-selection";

export interface FailureFirstEntryOptions {
  selection: FailureFirstSelection;
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

function title(selection: FailureFirstSelection): string {
  switch (selection.kind) {
    case "repeated_transition":
      return `Repeated ${selection.periodSteps}-step behavior × ${selection.repeatCount}`;
    case "repeated_state":
      return `Repeated observable state × ${selection.repeatCount}`;
    case "no_progress":
      return `No observable progress across ${selection.revisitCount} revisits`;
  }
}

export function createFailureFirstEntry(
  options: FailureFirstEntryOptions
): HTMLDivElement {
  const entry = createElement("div", "trace-viewer__failure-first");
  const heading = createElement(
    "strong",
    "trace-viewer__failure-first-heading",
    "Start Here"
  );
  const titleElement = createElement(
    "span",
    "trace-viewer__failure-first-title",
    title(options.selection)
  );
  const detail = createElement(
    "span",
    "trace-viewer__failure-first-detail",
    `Observed within ${options.selection.distanceFromTermination} captured steps of execution termination.`
  );
  const range = createElement(
    "span",
    "trace-viewer__failure-first-range",
    `Evidence: Steps ${options.selection.evidenceStartIndex + 1}–${options.selection.evidenceEndIndex + 1}`
  );
  const button = createElement(
    "button",
    "trace-viewer__failure-first-inspect",
    "Inspect"
  );
  button.type = "button";
  button.setAttribute(
    "aria-label",
    `Inspect recommended evidence at Step ${options.selection.inspectIndex + 1}`
  );
  button.addEventListener("click", () => options.onNavigate(options.selection.inspectIndex));

  entry.append(heading, titleElement, detail, range, button);
  return entry;
}
