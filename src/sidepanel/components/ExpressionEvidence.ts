import type {
  ExpressionEvidenceNode,
  ExpressionEvidenceRoot,
  ExpressionStepEvidence,
  ExpressionTracingState
} from "../../shared/expression-types";
import { formatValue } from "./value-format";

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

function selectedExpressionIds(root: ExpressionEvidenceRoot): Set<string> {
  return new Set(root.selections.flatMap((selection) => {
    if (
      selection.status !== "resolved" ||
      selection.selectedCandidateIndex === null
    ) {
      return [];
    }
    const selected = selection.candidateExprIds[selection.selectedCandidateIndex];
    return selected === undefined ? [] : [selected];
  }));
}

function renderNode(
  node: ExpressionEvidenceNode,
  selectedIds: Set<string>
): HTMLDivElement {
  const element = createElement("div", "expression-evidence__node");
  element.dataset.expressionId = node.exprId;
  if (selectedIds.has(node.exprId)) {
    element.classList.add("is-expression-selected");
    element.dataset.expressionSelected = "true";
  }

  const row = createElement("div", "expression-evidence__node-row");
  const source = createElement("code", "expression-evidence__source", node.source);
  row.append(source);
  if (node.value !== undefined) {
    row.append(createElement("code", "expression-evidence__value", ` = ${formatValue(node.value)}`));
  }
  element.append(row);

  if (node.children.length > 0) {
    const children = createElement("div", "expression-evidence__children");
    children.append(...node.children.map((child) => renderNode(child, selectedIds)));
    element.append(children);
  }
  return element;
}

function renderSelection(
  selection: ExpressionEvidenceRoot["selections"][number]
): HTMLDivElement {
  const item = createElement("div", "expression-evidence__selection");
  item.dataset.expressionSelection = selection.callExprId;
  const selected = selection.selectedCandidateIndex === null
    ? "not resolved"
    : `candidate ${selection.selectedCandidateIndex}`;
  item.append(
    createElement("code", "expression-evidence__selection-call", selection.function),
    createElement("span", "expression-evidence__selection-result", `→ ${formatValue(selection.result)}`),
    createElement("span", "expression-evidence__selection-status", `${selection.status} · ${selected}`)
  );
  return item;
}

function renderRoot(root: ExpressionEvidenceRoot): HTMLElement {
  const element = createElement("section", "expression-evidence__root");
  element.dataset.expressionRoot = root.rootId;
  element.dataset.expressionStatus = root.status;

  const heading = createElement("div", "expression-evidence__root-heading");
  const title = root.kind === "assignment" && root.target
    ? `${root.target.source} =`
    : "return";
  heading.append(
    createElement("strong", "expression-evidence__root-title", title),
    createElement("span", "expression-evidence__status", root.status)
  );
  element.append(heading);

  const selectedIds = selectedExpressionIds(root);
  element.append(renderNode(root.tree, selectedIds));
  if (root.selections.length > 0) {
    const selections = createElement("div", "expression-evidence__selections");
    selections.append(...root.selections.map(renderSelection));
    element.append(selections);
  }
  return element;
}

function renderTracingStatus(state: ExpressionTracingState): HTMLElement {
  const status = createElement("div", "expression-evidence__tracing-status");
  status.dataset.expressionTracingStatus = state.status;
  if (state.status === "truncated") {
    status.textContent = `Expression tracing truncated${state.reason ? ` · ${state.reason}` : ""}`;
  } else if (state.status === "unavailable") {
    status.textContent = `Expression tracing unavailable${state.reason ? ` · ${state.reason}` : ""}`;
  } else {
    status.textContent = "Expression tracing complete";
  }
  return status;
}

export function createExpressionEvidence(
  evidence: ExpressionStepEvidence | undefined,
  tracingState: ExpressionTracingState | undefined
): HTMLElement {
  const section = createElement("section", "trace-viewer__expression-evidence");
  if (tracingState && tracingState.status !== "complete") {
    section.append(renderTracingStatus(tracingState));
  }

  if (!evidence || evidence.roots.length === 0) {
    section.append(createElement(
      "div",
      "trace-viewer__empty expression-evidence__empty",
      "No expression evidence for this step."
    ));
    return section;
  }

  const meta = createElement(
    "div",
    "expression-evidence__meta",
    `Anchor step ${evidence.anchorStep} · frame ${evidence.frameId}`
  );
  section.append(meta, ...evidence.roots.map(renderRoot));
  return section;
}
