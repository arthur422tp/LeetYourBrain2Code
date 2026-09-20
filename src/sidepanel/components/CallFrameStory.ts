import type { CallFrameStoryModel, CallFrameStoryNode } from "../../core/call-frame-story";
import {
  frameExitSummary,
  frameSignature
} from "../call-frame-format";

const PATH_COMPACTION_THRESHOLD = 7;

export interface CallFrameStoryViewModel {
  model: CallFrameStoryModel;
  currentStep?: number;
}

export interface CallFrameStoryOptions {
  model: CallFrameStoryModel;
  onNavigateStep(step: number): void;
}

export interface CallFrameStoryHandle {
  element: HTMLElement;
  update(model: CallFrameStoryModel): void;
  dispose(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setFrameAttributes(target: HTMLElement, node: CallFrameStoryNode, current = false): void {
  target.dataset.frameId = String(node.frameId);
  if (node.functionId !== undefined) target.dataset.functionId = node.functionId;
  target.dataset.frameDepth = String(node.depth);
  target.dataset.recursionDepth = String(node.recursion.recursionDepth);
  target.dataset.frameExitStatus = node.exit.status;
  target.dataset.callStep = String(node.callStep);
  if (current) {
    target.dataset.currentFrame = "true";
    target.dataset.currentPath = "true";
  }
}

function observedLaterText(node: CallFrameStoryNode): string | undefined {
  if (node.exit.status === "active") return undefined;
  const summary = frameExitSummary(node.exit);
  if (summary.startsWith("Returned ")) return `Observed later: returned ${summary.slice("Returned ".length)}`;
  if (summary.startsWith("Raised ")) return `Observed later: raised ${summary.slice("Raised ".length)}`;
  if (summary.startsWith("Trace ended")) return `Observed later: ${summary.replace("Trace ended", "trace ended")}`;
  return undefined;
}

function currentStatusText(node: CallFrameStoryNode): string {
  switch (node.atCursor) {
    case "active": return "At this step: active";
    case "exited": return "At this step: exited";
    case "not_started": return "Not entered at this step";
    case "unknown": return "At this step: unavailable";
  }
}

function renderCurrentFrame(model: CallFrameStoryModel): HTMLElement {
  const section = element("section", "call-frame-story__current");
  const current = model.currentFrameId === undefined
    ? undefined
    : model.byFrameId.get(model.currentFrameId);
  if (!current) {
    section.append(element("h3", "call-frame-story__heading", "Current frame"));
    section.append(element("div", "trace-viewer__empty", "No call-frame evidence for this step."));
    return section;
  }

  setFrameAttributes(section, current, true);
  section.append(element("h3", "call-frame-story__heading", "Current frame"));
  section.append(element("code", "call-frame-story__signature", frameSignature(current)));
  const depthText = current.recursion.isRecursive
    ? `Frame ${current.frameId} · depth ${current.depth} · recursive depth ${current.recursion.recursionDepth}`
    : `Frame ${current.frameId} · depth ${current.depth}`;
  section.append(element("div", "call-frame-story__meta", depthText));
  if (current.recursion.isRecursive) {
    section.append(element("span", "call-frame-story__recursion", `recursive · depth ${current.recursion.recursionDepth}`));
  }
  section.append(element("div", "call-frame-story__temporal", currentStatusText(current)));
  const later = observedLaterText(current);
  if (later && current.atCursor !== "exited") {
    section.append(element("div", "call-frame-story__outcome", later));
  } else if (current.atCursor === "exited") {
    section.append(element("div", "call-frame-story__outcome", `Session outcome: ${frameExitSummary(current.exit)}`));
  }
  return section;
}

function renderPath(model: CallFrameStoryModel, onNavigateStep: (step: number) => void): HTMLElement {
  const section = element("section", "call-frame-story__path");
  section.append(element("h3", "call-frame-story__heading", "Call path"));
  const path = model.currentPath
    .map((frameId) => model.byFrameId.get(frameId))
    .filter((node): node is CallFrameStoryNode => node !== undefined);
  if (!path.length) {
    section.append(element("div", "call-frame-story__path-empty", "No current call path."));
    return section;
  }

  const content = element("div", "call-frame-story__path-content");
  const indices = path.length > PATH_COMPACTION_THRESHOLD
    ? [0, 1, path.length - 2, path.length - 1]
    : path.map((_node, index) => index);
  const uniqueIndices = [...new Set(indices)];
  uniqueIndices.forEach((index, displayIndex) => {
    if (displayIndex > 0) content.append(element("span", "call-frame-story__path-separator", "→"));
    if (displayIndex === 2 && path.length > PATH_COMPACTION_THRESHOLD) {
      content.append(element("span", "call-frame-story__path-ellipsis", `… ${path.length - 4} frames …`));
      content.append(element("span", "call-frame-story__path-separator", "→"));
    }
    const node = path[index]!;
    const button = element("button", "call-frame-story__path-segment", frameSignature(node, { preferShortName: true }));
    button.type = "button";
    button.dataset.frameId = String(node.frameId);
    button.dataset.callStep = String(node.callStep);
    button.setAttribute("aria-label", `Inspect frame ${node.frameId}, ${node.displayName}, call step ${node.callStep}`);
    if (node.frameId === model.currentFrameId) {
      button.setAttribute("aria-current", "step");
      button.dataset.currentFrame = "true";
    }
    button.addEventListener("click", () => onNavigateStep(node.callStep));
    content.append(button);
  });
  section.append(content);
  return section;
}

function render(model: CallFrameStoryModel, onNavigateStep: (step: number) => void): HTMLElement[] {
  const children: HTMLElement[] = [];
  if (model.tracingState.status !== "complete") {
    children.push(element(
      "div",
      "call-frame-story__tracing",
      `Call-frame tracing ${model.tracingState.status}${model.tracingState.reason ? ` · ${model.tracingState.reason}` : ""}`
    ));
  }
  children.push(renderCurrentFrame(model));
  children.push(renderPath(model, onNavigateStep));
  return children;
}

export function createCallFrameStory(options: CallFrameStoryOptions): CallFrameStoryHandle {
  const root = element("section", "call-frame-story");
  let disposed = false;

  const update = (model: CallFrameStoryModel): void => {
    if (disposed) return;
    root.replaceChildren(...render(model, options.onNavigateStep));
  };

  update(options.model);
  return {
    element: root,
    update,
    dispose: () => {
      disposed = true;
      root.replaceChildren();
    }
  };
}

