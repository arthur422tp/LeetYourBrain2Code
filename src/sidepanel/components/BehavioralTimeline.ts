import type {
  BehavioralAnalysis,
  BehavioralPattern
} from "../../core/behavioral-pattern";
import type {
  ResolvedBehavioralEvidence,
  TraceStepIndex
} from "../behavioral-navigation";

export interface BehavioralTimelineOptions {
  analysis: BehavioralAnalysis;
  traceIndex: TraceStepIndex;
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>;
  currentIndex: number;
  onNavigate(index: number): void;
}

export interface BehavioralTimelineHandle {
  element: HTMLDivElement;
  setCurrentIndex(index: number): void;
}

const KIND_ORDER: BehavioralPattern["kind"][] = [
  "repeated_state",
  "no_progress",
  "repeated_transition"
];

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

function kindLabel(kind: BehavioralPattern["kind"]): string {
  switch (kind) {
    case "repeated_state":
      return "Repeated state";
    case "no_progress":
      return "No progress";
    case "repeated_transition":
      return "Repeated transition";
  }
}

function clampIndex(index: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(Math.trunc(index), total - 1));
}

export function createBehavioralTimeline(
  options: BehavioralTimelineOptions
): BehavioralTimelineHandle {
  const root = createElement("div", "trace-viewer__timeline");
  const total = options.traceIndex.indexToStep.length;

  if (total === 0) {
    root.append(createElement(
      "div",
      "trace-viewer__empty",
      "No execution steps were captured."
    ));
    return { element: root, setCurrentIndex: () => {} };
  }

  const header = createElement("div", "trace-viewer__timeline-header");
  header.append(createElement("strong", undefined, "Behavioral Timeline"));
  const position = createElement("span", "trace-viewer__timeline-current");
  header.append(position);

  const range = document.createElement("input");
  range.type = "range";
  range.className = "trace-viewer__timeline-range";
  range.dataset.role = "trace-range";
  range.min = "0";
  range.max = String(Math.max(total - 1, 0));
  range.step = "1";
  range.disabled = total === 1;
  range.setAttribute("aria-label", "Captured trace position");
  range.addEventListener("input", () => {
    options.onNavigate(clampIndex(Number(range.value), total));
  });

  const lanes = createElement("div", "trace-viewer__timeline-lanes");
  const activeBands: Array<{
    button: HTMLButtonElement;
    evidence: ResolvedBehavioralEvidence;
  }> = [];

  let renderedBands = 0;
  for (const kind of KIND_ORDER) {
    const valid: Array<{
      pattern: BehavioralPattern;
      evidence: ResolvedBehavioralEvidence;
    }> = [];

    for (const pattern of options.analysis.patterns) {
      if (pattern.kind !== kind) {
        continue;
      }
      const evidence = options.evidenceByPatternId.get(pattern.patternId);
      if (!evidence || evidence.firstIndex === null || evidence.lastIndex === null) {
        continue;
      }
      valid.push({ pattern, evidence });
    }

    if (valid.length === 0) {
      continue;
    }

    const lane = createElement("div", "trace-viewer__timeline-lane");
    lane.dataset.timelineKind = kind;
    lane.append(createElement("span", "trace-viewer__timeline-lane-label", kindLabel(kind)));
    const track = createElement("div", "trace-viewer__timeline-track");

    for (const { pattern, evidence } of valid) {
      const firstIndex = evidence.firstIndex!;
      const lastIndex = evidence.lastIndex!;
      const denominator = Math.max(total - 1, 1);
      const left = firstIndex / denominator * 100;
      const width = Math.max((lastIndex - firstIndex) / denominator * 100, 1.5);
      const firstStep = evidence.evidenceSteps[0]!;
      const lastStep = evidence.evidenceSteps.at(-1)!;
      const band = createElement("button", "trace-viewer__timeline-band") as HTMLButtonElement;
      band.type = "button";
      band.dataset.patternId = pattern.patternId;
      band.dataset.patternKind = pattern.kind;
      band.style.left = `${left}%`;
      band.style.width = `${Math.min(width, 100 - left)}%`;
      band.setAttribute(
        "aria-label",
        `${kindLabel(pattern.kind)} evidence span steps ${firstStep} to ${lastStep}; ${evidence.evidenceIndexes.length} evidence steps`
      );
      band.addEventListener("click", () => options.onNavigate(firstIndex));
      track.append(band);
      activeBands.push({ button: band, evidence });
      renderedBands += 1;
    }

    lane.append(track);
    lanes.append(lane);
  }

  if (renderedBands === 0) {
    lanes.append(createElement(
      "div",
      "trace-viewer__empty",
      "No repeated behavioral regions in the captured trace."
    ));
  }

  root.append(header, range, lanes);

  const setCurrentIndex = (requestedIndex: number): void => {
    const index = clampIndex(requestedIndex, total);
    range.value = String(index);
    position.textContent = `Step ${index + 1} / ${total}`;
    for (const entry of activeBands) {
      entry.button.classList.toggle(
        "is-active",
        entry.evidence.evidenceIndexes.includes(index)
      );
    }
  };

  setCurrentIndex(options.currentIndex);
  return { element: root, setCurrentIndex };
}
