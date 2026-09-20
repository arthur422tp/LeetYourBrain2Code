import {
  CALL_TREE_VISIBLE_ROW_LIMIT,
  CALL_TREE_CONTEXT_SIBLING_LIMIT,
  type CallFrameStoryModel,
  type CallFrameStoryNode
} from "../../core/call-frame-story";
import {
  compactFrameExitSuffix,
  frameExitSummary,
  frameSignature
} from "../call-frame-format";

const PATH_COMPACTION_THRESHOLD = 7;

function isExpanded(model: CallFrameStoryModel, state: TreeRenderState, frameId: number): boolean {
  return model.currentPath.includes(frameId) || (!state.userCollapsed.has(frameId) &&
    (state.userExpanded.has(frameId) || model.byFrameId.size > CALL_TREE_VISIBLE_ROW_LIMIT));
}

interface TreeRenderState {
  userExpanded: Set<number>;
  userCollapsed: Set<number>;
  visibleRowBudget: number;
}

export interface CallFrameStoryViewModel {
  model: CallFrameStoryModel;
  currentStep?: number;
}

export interface CallFrameStoryOptions {
  model: CallFrameStoryModel;
  onNavigateStep(step: number): void;
  canNavigateStep?(step: number): boolean;
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

function renderPath(
  model: CallFrameStoryModel,
  onNavigateStep: (step: number) => void,
  canNavigateStep: (step: number) => boolean
): HTMLElement {
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
    button.disabled = !canNavigateStep(node.callStep);
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

function shouldShowTree(model: CallFrameStoryModel): boolean {
  return model.byFrameId.size > 1 ||
    [...model.byFrameId.values()].some((node) => node.childFrameIds.length > 0 || node.recursion.isRecursive);
}

function renderTreeNode(
  node: CallFrameStoryNode,
  model: CallFrameStoryModel,
  state: TreeRenderState,
  onNavigateStep: (step: number) => void,
  canNavigateStep: (step: number) => boolean,
  onToggle: (frameId: number) => void,
  renderChildren = true
): HTMLLIElement {
  const item = element("li", "call-frame-story__tree-item");
  const row = element("div", "call-frame-story__tree-row");
  const currentPath = new Set(model.currentPath);
  const isCurrent = node.frameId === model.currentFrameId;
  const inCurrentPath = currentPath.has(node.frameId);
  const expanded = node.childFrameIds.length > 0 && isExpanded(model, state, node.frameId);
  setFrameAttributes(row, node, isCurrent);
  if (inCurrentPath) row.dataset.currentPath = "true";
  const exitStep = node.exit.status === "returned" || node.exit.status === "exception" || node.exit.status === "trace_ended"
    ? node.exit.step
    : undefined;
  if (exitStep !== undefined) row.dataset.exitStep = String(exitStep);
  if (isCurrent) row.setAttribute("aria-current", "step");

  const entry = element("button", "call-frame-story__tree-entry");
  entry.type = "button";
  entry.dataset.frameAction = "entry";
  entry.dataset.frameId = String(node.frameId);
  entry.dataset.callStep = String(node.callStep);
  entry.textContent = `${frameSignature(node, { preferShortName: true })} ${compactFrameExitSuffix(node.exit)}`;
  entry.setAttribute("aria-label", `Inspect frame ${node.frameId}, ${node.displayName}, call step ${node.callStep}`);
  entry.disabled = !canNavigateStep(node.callStep);
  if (entry.disabled) entry.title = 'Call step is outside the captured raw trace.';
  if (isCurrent) {
    entry.setAttribute("aria-current", "step");
    entry.dataset.currentFrame = "true";
  }
  entry.addEventListener("click", () => onNavigateStep(node.callStep));
  row.append(entry);

  if (node.recursion.isRecursive) {
    row.append(element("span", "call-frame-story__tree-recursion", `recursive · depth ${node.recursion.recursionDepth}`));
  }
  if (exitStep !== undefined) {
    const exit = element("button", "call-frame-story__tree-exit", "Inspect exit");
    exit.type = "button";
    exit.dataset.frameAction = "exit";
    exit.dataset.frameId = String(node.frameId);
    exit.dataset.exitStep = String(exitStep);
    exit.setAttribute("aria-label", `Inspect frame ${node.frameId} exit at step ${exitStep}`);
    exit.disabled = !canNavigateStep(exitStep);
    exit.addEventListener("click", (event) => {
      event.stopPropagation();
      onNavigateStep(exitStep);
    });
    row.append(exit);
  }
  const evidenceTotal = Object.values(node.evidenceCounts).reduce((sum, count) => sum + count, 0);
  if (evidenceTotal > 0 && (isCurrent || expanded)) {
    row.append(element(
      "span",
      "call-frame-story__tree-evidence",
      `${node.evidenceCounts.decisions} decisions · ${node.evidenceCounts.loopIterations} loop${node.evidenceCounts.loopIterations === 1 ? "" : "s"} · ${node.evidenceCounts.expressions} expressions · ${node.evidenceCounts.mutations} mutations`
    ));
  }
  if (node.childFrameIds.length > 0) {
    const toggle = element("button", "call-frame-story__tree-toggle", expanded ? "▾" : "▸");
    toggle.type = "button";
    toggle.dataset.frameToggle = String(node.frameId);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.disabled = inCurrentPath;
    const toggleLabel = inCurrentPath
      ? `Keep frame ${node.frameId} expanded to show the current call path`
      : `${expanded ? "Collapse" : "Expand"} frame ${node.frameId} children`;
    toggle.setAttribute("aria-label", toggleLabel);
    toggle.title = toggleLabel;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggle(node.frameId);
    });
    row.prepend(toggle);
  }
  item.append(row);

  const childNodes = node.childFrameIds
    .map((frameId) => model.byFrameId.get(frameId))
    .filter((child): child is CallFrameStoryNode => child !== undefined);
  if (!renderChildren) return item;
  if (childNodes.length > 0 && expanded) {
    const list = element("ul", "call-frame-story__tree-list");
    for (const child of childNodes) {
      list.append(renderTreeNode(child, model, state, onNavigateStep, canNavigateStep, onToggle));
    }
    item.append(list);
  } else if (childNodes.length > 0) {
    item.append(element("div", "call-frame-story__tree-folded", `▶ ${childNodes.length} child call${childNodes.length === 1 ? "" : "s"}`));
  }
  return item;
}

function runtimeOrder(model: CallFrameStoryModel, state: TreeRenderState): number[] {
  const order: number[] = [];
  const visited = new Set<number>();
  const visit = (frameId: number): void => {
    if (visited.has(frameId) || !model.byFrameId.has(frameId)) return;
    visited.add(frameId);
    order.push(frameId);
    if (isExpanded(model, state, frameId)) {
      for (const childFrameId of model.byFrameId.get(frameId)!.childFrameIds) visit(childFrameId);
    }
  };
  for (const root of model.roots) visit(root);
  return order;
}

function boundedFrameIds(model: CallFrameStoryModel, budget: number, order: number[]): number[] {
  if (order.length <= budget) return order;
  const rowBudget = Math.max(1, budget - 1);
  const selected = new Set<number>();
  const add = (frameId: number): void => {
    if (selected.size < rowBudget && model.byFrameId.has(frameId)) selected.add(frameId);
  };
  if (model.currentFrameId !== undefined) add(model.currentFrameId);

  const currentPath = model.currentPath.filter((frameId) => model.byFrameId.has(frameId));
  if (currentPath.length > rowBudget) {
    const headCount = Math.max(1, Math.floor(rowBudget / 2));
    for (const frameId of currentPath.slice(0, headCount)) add(frameId);
    for (const frameId of currentPath.slice(-(rowBudget - headCount))) add(frameId);
  } else {
    for (const frameId of currentPath) add(frameId);
  }
  for (const root of model.roots) add(root);

  let siblingCount = 0;
  for (let index = 0; index < currentPath.length && siblingCount < CALL_TREE_CONTEXT_SIBLING_LIMIT; index += 1) {
    const current = model.byFrameId.get(currentPath[index]!);
    const next = currentPath[index + 1];
    for (const childFrameId of current?.childFrameIds ?? []) {
      if (childFrameId === next || siblingCount >= CALL_TREE_CONTEXT_SIBLING_LIMIT) continue;
      add(childFrameId);
      siblingCount += 1;
    }
  }
  for (const frameId of order) add(frameId);
  return order.filter((frameId) => selected.has(frameId));
}

function renderBoundedTree(
  model: CallFrameStoryModel,
  state: TreeRenderState,
  onNavigateStep: (step: number) => void,
  canNavigateStep: (step: number) => boolean,
  onToggle: (frameId: number) => void,
  onShowMore: () => void
): HTMLElement {
  const section = element("section", "call-frame-story__tree");
  section.append(element("h3", "call-frame-story__heading", "Call Tree"));
  const list = element("ul", "call-frame-story__tree-list");
  const order = runtimeOrder(model, state);
  const visibleIds = boundedFrameIds(model, state.visibleRowBudget, order);
  const parents = new Map<number, number>();
  for (const node of model.byFrameId.values()) {
    for (const child of node.childFrameIds) parents.set(child, node.frameId);
  }
  section.append(element('p', 'call-frame-story__tree-summary', 'Compact call tree · frame and parent IDs preserve the recorded hierarchy.'));
  for (const frameId of visibleIds) {
    const frame = model.byFrameId.get(frameId);
    if (frame) {
      const item = renderTreeNode(frame, model, state, onNavigateStep, canNavigateStep, onToggle, false);
      const parent = parents.get(frameId);
      item.querySelector('.call-frame-story__tree-row')!.append(element('span', 'call-frame-story__tree-context',
        `Frame ${frameId} · depth ${frame.depth}${parent === undefined ? ' · root' : ` · parent ${parent}`}`));
      list.append(item);
    }
  }
  section.append(list);
  const folded = model.byFrameId.size - order.length;
  if (folded > 0) section.append(element('div', 'call-frame-story__tree-summary', `${folded} recorded frames in collapsed branches`));
  const omitted = order.length - visibleIds.length;
  if (omitted > 0) {
    const summary = element("div", "call-frame-story__tree-summary", `+ ${omitted} additional recorded frames`);
    summary.dataset.treeSummary = "true";
    section.append(summary);
    const showMore = element("button", "call-frame-story__tree-show-more", "Show more calls");
    showMore.type = "button";
    showMore.dataset.action = "show-more";
    showMore.setAttribute("aria-label", "Show more recorded call frames");
    showMore.addEventListener("click", onShowMore);
    section.append(showMore);
  }
  return section;
}

function renderTree(
  model: CallFrameStoryModel,
  state: TreeRenderState,
  onNavigateStep: (step: number) => void,
  canNavigateStep: (step: number) => boolean,
  onToggle: (frameId: number) => void,
  onShowMore: () => void
): HTMLElement {
  if (model.byFrameId.size > CALL_TREE_VISIBLE_ROW_LIMIT ||
      [...model.byFrameId.values()].some(node => node.depth > PATH_COMPACTION_THRESHOLD)) {
    return renderBoundedTree(model, state, onNavigateStep, canNavigateStep, onToggle, onShowMore);
  }
  const section = element("section", "call-frame-story__tree");
  section.append(element("h3", "call-frame-story__heading", "Call Tree"));
  const list = element("ul", "call-frame-story__tree-list");
  for (const frameId of model.roots) {
    const root = model.byFrameId.get(frameId);
    if (root) list.append(renderTreeNode(root, model, state, onNavigateStep, canNavigateStep, onToggle));
  }
  section.append(list);
  return section;
}

function render(
  model: CallFrameStoryModel,
  state: TreeRenderState,
  onNavigateStep: (step: number) => void,
  canNavigateStep: (step: number) => boolean,
  onToggle: (frameId: number) => void,
  onShowMore: () => void
): HTMLElement[] {
  const children: HTMLElement[] = [];
  if (model.tracingState.status !== "complete") {
    children.push(element(
      "div",
      "call-frame-story__tracing",
      `Call-frame tracing ${model.tracingState.status}${model.tracingState.reason ? ` · ${model.tracingState.reason}` : ""}`
    ));
  }
  children.push(renderCurrentFrame(model));
  children.push(renderPath(model, onNavigateStep, canNavigateStep));
  if (shouldShowTree(model)) children.push(renderTree(model, state, onNavigateStep, canNavigateStep, onToggle, onShowMore));
  return children;
}

export function createCallFrameStory(options: CallFrameStoryOptions): CallFrameStoryHandle {
  const root = element("section", "call-frame-story");
  const state: TreeRenderState = {
    userExpanded: new Set(),
    userCollapsed: new Set(),
    visibleRowBudget: CALL_TREE_VISIBLE_ROW_LIMIT
  };
  let currentModel = options.model;
  let disposed = false;
  const canNavigateStep = options.canNavigateStep ?? (() => true);

  const renderIntoRoot = (): void => {
    if (disposed) return;
    const focused = document.activeElement;
    const focusLabel = focused && root.contains(focused) ? focused.getAttribute('aria-label') : null;
    const focusToggle = focused instanceof HTMLElement && root.contains(focused) ? focused.dataset.frameToggle : undefined;
    root.replaceChildren(...render(currentModel, state, options.onNavigateStep, canNavigateStep, (frameId) => {
      if (isExpanded(currentModel, state, frameId)) {
        state.userExpanded.delete(frameId);
        state.userCollapsed.add(frameId);
      } else {
        state.userCollapsed.delete(frameId);
        state.userExpanded.add(frameId);
      }
      renderIntoRoot();
    }, () => {
      state.visibleRowBudget += 100;
      renderIntoRoot();
    }));
    if (focusLabel) {
      const replacement = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button =>
        focusToggle !== undefined ? button.dataset.frameToggle === focusToggle :
          button.className === focused?.className && button.getAttribute('aria-label') === focusLabel);
      (replacement ?? root.querySelector<HTMLButtonElement>('.call-frame-story__tree-entry[aria-current="step"]'))?.focus({ preventScroll: true });
    }
  };

  const update = (model: CallFrameStoryModel): void => {
    if (disposed) return;
    currentModel = model;
    renderIntoRoot();
  };

  renderIntoRoot();
  return {
    element: root,
    update,
    dispose: () => {
      disposed = true;
      root.replaceChildren();
    }
  };
}
