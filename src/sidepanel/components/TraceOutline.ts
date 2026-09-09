import type {
  RepeatedTransitionFoldSegment,
  RepeatedTransitionIteration,
  TraceFoldModel,
  TracePresentationSegment
} from "../trace-folding";

export interface TraceOutlineOptions {
  model: TraceFoldModel;
  currentIndex: number;
  onNavigate(index: number): void;
}

export interface TraceOutlineHandle {
  element: HTMLDivElement;
  setCurrentIndex(index: number): void;
}

function displayRange(startIndex: number, endIndex: number): string {
  return startIndex === endIndex
    ? `Step ${startIndex + 1}`
    : `Steps ${startIndex + 1}–${endIndex + 1}`;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createTraceOutline(options: TraceOutlineOptions): TraceOutlineHandle {
  const root = createElement("div", "trace-viewer__outline");
  const header = createElement("div", "trace-viewer__outline-header", "Trace Outline");
  const segmentHost = createElement("div", "trace-viewer__outline-segments");
  root.append(header, segmentHost);
  const expandedPatternIds = new Set<string>();
  const segmentRows: Array<{ segment: TracePresentationSegment; row: HTMLDivElement }> = [];
  const iterationRows = new Map<string, Array<{
    startIndex: number;
    endIndex: number;
    row: HTMLDivElement;
  }>>();
  let currentIndex = options.currentIndex;

  if (options.model.segments.length === 0) {
    segmentHost.append(createElement("div", "trace-viewer__empty", "No execution steps were captured."));
    return { element: root, setCurrentIndex: () => {} };
  }

  const syncCurrentClasses = (index: number): void => {
    currentIndex = index;
    for (const { segment, row } of segmentRows) {
      const active = segment.startIndex <= index && index <= segment.endIndex;
      row.classList.toggle("is-active", active);
      if (active) row.setAttribute("aria-current", "step");
      else row.removeAttribute("aria-current");
    }
    for (const rows of iterationRows.values()) {
      for (const entry of rows) {
        entry.row.classList.toggle("is-active", entry.startIndex <= index && index <= entry.endIndex);
      }
    }
  };

  const renderIteration = (segment: RepeatedTransitionFoldSegment, iteration: RepeatedTransitionIteration) => {
    const row = createElement("div", "trace-viewer__outline-iteration");
    row.dataset.iteration = String(iteration.iteration);
    row.append(createElement("span", undefined, `Motif repetition ${iteration.iteration} · ${displayRange(iteration.startIndex, iteration.endIndex)}`));
    const inspect = createElement("button", "trace-viewer__outline-inspect", "Inspect") as HTMLButtonElement;
    inspect.type = "button";
    inspect.dataset.outlineAction = "inspect";
    inspect.setAttribute("aria-label", `Inspect motif repetition ${iteration.iteration} · ${displayRange(iteration.startIndex, iteration.endIndex)}`);
    inspect.addEventListener("click", () => options.onNavigate(iteration.startIndex));
    row.append(inspect);
    return { startIndex: iteration.startIndex, endIndex: iteration.endIndex, row };
  };

  for (const segment of options.model.segments) {
    const row = createElement("div", "trace-viewer__outline-segment");
    row.dataset.segmentId = segment.segmentId;
    row.dataset.segmentKind = segment.kind;
    segmentRows.push({ segment, row });
    const rowContent = createElement("div", "trace-viewer__outline-row");
    const content = createElement("div", "trace-viewer__outline-content");
    const title = segment.kind === "repeated_transition_fold"
      ? `Repeated ${segment.periodSteps}-step behavior × ${segment.repeatCount}`
      : "Captured trace steps";
    content.append(createElement("strong", "trace-viewer__outline-title", title));
    const meta = segment.kind === "repeated_transition_fold"
      ? `${displayRange(segment.startIndex, segment.endIndex)} · ${segment.endIndex - segment.startIndex + 1} captured steps`
      : displayRange(segment.startIndex, segment.endIndex);
    content.append(createElement("span", "trace-viewer__outline-meta", meta));
    rowContent.append(content);

    const inspect = createElement("button", "trace-viewer__outline-inspect", "Inspect") as HTMLButtonElement;
    inspect.type = "button";
    inspect.dataset.outlineAction = "inspect";
    inspect.setAttribute("aria-label", `Inspect ${displayRange(segment.startIndex, segment.endIndex)}`);
    inspect.addEventListener("click", () => options.onNavigate(segment.startIndex));
    rowContent.append(inspect);

    if (segment.kind === "repeated_transition_fold") {
      const toggle = createElement("button", "trace-viewer__outline-toggle", "▶") as HTMLButtonElement;
      toggle.type = "button";
      toggle.dataset.outlineAction = "toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", `Toggle motif repetitions · ${displayRange(segment.startIndex, segment.endIndex)}`);
      const iterationHost = createElement("div", "trace-viewer__outline-iterations");
      toggle.addEventListener("click", () => {
        if (expandedPatternIds.has(segment.patternId)) {
          expandedPatternIds.delete(segment.patternId);
          toggle.textContent = "▶";
          toggle.setAttribute("aria-expanded", "false");
          iterationHost.replaceChildren();
          iterationRows.delete(segment.patternId);
        } else {
          expandedPatternIds.add(segment.patternId);
          toggle.textContent = "▼";
          toggle.setAttribute("aria-expanded", "true");
          const rows = segment.iterations.map((iteration) => renderIteration(segment, iteration));
          iterationHost.replaceChildren(...rows.map((entry) => entry.row));
          iterationRows.set(segment.patternId, rows);
          syncCurrentClasses(currentIndex);
        }
      });
      rowContent.prepend(toggle);
      row.append(iterationHost);
    }
    row.prepend(rowContent);
    segmentHost.append(row);
  }

  syncCurrentClasses(currentIndex);
  return { element: root, setCurrentIndex: syncCurrentClasses };
}
