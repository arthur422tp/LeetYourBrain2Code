import type {
  ConditionEvidenceNode,
  DecisionChainOccurrence,
  DecisionHistoryEntry,
  DecisionStepEvidence,
  DecisionTracingState
} from "../../shared/decision-types";
import { formatValue } from "./value-format";

export interface DecisionEvidenceOptions {
  evidence: DecisionStepEvidence | undefined;
  tracingState: DecisionTracingState | undefined;
  chain: DecisionChainOccurrence | undefined;
  history: readonly DecisionHistoryEntry[];
  onNavigateStep(step: number): void;
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

function conditionKindLabel(kind: ConditionEvidenceNode["kind"]): string {
  return kind === "and" ? "AND" : kind === "or" ? "OR" : kind;
}

function conditionStatusText(node: ConditionEvidenceNode): string {
  if (node.status === "evaluated") {
    return node.truth === true ? "True" : node.truth === false ? "False" : "condition evaluated";
  }
  if (node.status === "short_circuited") {
    return `${conditionKindLabel(node.kind)} short-circuited`;
  }
  if (node.status === "not_reached") {
    return node.skipReason === "earlier_branch_selected" ? "Earlier branch selected" : "Not reached";
  }
  return "condition partial";
}

function renderConditionNode(node: ConditionEvidenceNode): HTMLDivElement {
  const element = createElement("div", "decision-evidence__condition");
  element.dataset.conditionId = node.conditionId;
  element.dataset.conditionStatus = node.status;
  if (node.truth !== undefined) element.dataset.conditionTruth = String(node.truth);

  const heading = createElement("div", "decision-evidence__condition-heading");
  heading.append(
    createElement("code", "decision-evidence__condition-source", node.source),
    createElement("span", `decision-evidence__condition-status is-${node.status}`, conditionStatusText(node))
  );
  element.append(heading);

  if (node.operands.length > 0) {
    const operands = createElement("div", "decision-evidence__operands");
    for (const operand of node.operands) {
      const row = createElement("div", "decision-evidence__operand");
      row.dataset.operandId = operand.operandId;
      row.append(
        createElement("code", "decision-evidence__operand-source", operand.source),
        createElement("code", "decision-evidence__operand-value", operand.value === undefined
          ? "not captured"
          : formatValue(operand.value))
      );
      operands.append(row);
    }
    element.append(operands);
  }

  if (node.children.length > 0) {
    const children = createElement("div", "decision-evidence__children");
    children.append(...node.children.map(renderConditionNode));
    element.append(children);
  }
  return element;
}

function renderTracingStatus(state: DecisionTracingState): HTMLElement {
  const status = createElement("div", "decision-evidence__tracing-status");
  status.dataset.decisionTracingStatus = state.status;
  status.textContent = state.status === "truncated"
    ? `Decision tracing truncated${state.reason ? ` · ${state.reason}` : ""}`
    : state.status === "unavailable"
      ? `Decision tracing unavailable${state.reason ? ` · ${state.reason}` : ""}`
      : "Decision tracing complete";
  return status;
}

function renderChain(chain: DecisionChainOccurrence): HTMLElement {
  const section = createElement("section", "decision-evidence__chain");
  section.dataset.chainId = chain.chainId;
  section.dataset.chainOccurrenceId = chain.occurrenceId;
  section.dataset.frameId = String(chain.frameId);
  section.dataset.anchorStepStart = String(chain.anchorStepStart);
  section.dataset.anchorStepEnd = String(chain.anchorStepEnd);
  section.append(createElement("h3", "decision-evidence__subheading", `Branch chain · steps ${chain.anchorStepStart}–${chain.anchorStepEnd}`));
  const rows = createElement("div", "decision-evidence__branches");
  for (const branch of chain.branches) {
    const row = createElement("div", "decision-evidence__branch");
    row.dataset.branchIndex = String(branch.branchIndex);
    row.dataset.branchKind = branch.kind;
    row.dataset.branchStatus = branch.status;
    row.append(
      createElement("span", "decision-evidence__branch-kind", branch.kind),
      createElement("span", `decision-evidence__branch-status is-${branch.status}`, branch.status === "selected"
        ? "Selected"
        : branch.status === "rejected" ? "Rejected" : "Not reached")
    );
    if (branch.anchorStep !== undefined) {
      row.append(createElement("span", "decision-evidence__branch-step", `step ${branch.anchorStep}`));
    }
    if (branch.condition) row.append(renderConditionNode(branch.condition));
    rows.append(row);
  }
  section.append(rows);
  return section;
}

function renderHistory(
  history: readonly DecisionHistoryEntry[],
  onNavigateStep: (step: number) => void
): HTMLElement | null {
  if (history.length === 0) return null;
  const section = createElement("section", "decision-evidence__history");
  section.append(createElement("h3", "decision-evidence__subheading", "While history"));
  const entries = createElement("div", "decision-evidence__history-list");
  for (const entry of history) {
    const button = createElement("button", "decision-evidence__history-entry");
    button.type = "button";
    button.dataset.anchorStep = String(entry.anchorStep);
    button.dataset.siteId = entry.siteId;
    button.append(
      createElement("span", "decision-evidence__history-occurrence", `#${entry.occurrence}`),
      createElement("span", "decision-evidence__history-outcome", entry.outcome ?? "condition partial"),
      createElement("span", "decision-evidence__history-step", `step ${entry.anchorStep}`)
    );
    button.addEventListener("click", () => onNavigateStep(entry.anchorStep));
    entries.append(button);
  }
  section.append(entries);
  return section;
}

export function decisionBadgeText(evidence: DecisionStepEvidence | undefined): string | null {
  if (!evidence || evidence.status !== "completed" || evidence.condition.truth === undefined) {
    return evidence?.status === "partial" ? "condition partial" : null;
  }
  const hasShortCircuit = evidence.condition.status === "short_circuited" ||
    evidence.condition.children.some((child) => child.status === "short_circuited");
  return `condition ${evidence.condition.truth ? "True" : "False"}${hasShortCircuit ? " · short-circuit" : ""}`;
}

export function createDecisionEvidence(options: DecisionEvidenceOptions): HTMLElement {
  const section = createElement("section", "trace-viewer__decision-panel decision-evidence");
  if (options.tracingState && options.tracingState.status !== "complete") {
    section.append(renderTracingStatus(options.tracingState));
  }

  if (options.evidence) {
    const meta = createElement(
      "div",
      "decision-evidence__meta",
      `Anchor step ${options.evidence.anchorStep} · frame ${options.evidence.frameId} · ${options.evidence.siteId} #${options.evidence.occurrence}`
    );
    if (options.evidence.outcome) {
      meta.append(createElement("span", "decision-evidence__outcome", ` · ${options.evidence.outcome}`));
    }
    section.append(meta, renderConditionNode(options.evidence.condition));
  } else {
    section.append(createElement("div", "trace-viewer__empty decision-evidence__empty", "No decision evidence for this step."));
  }

  if (options.chain) section.append(renderChain(options.chain));
  const history = renderHistory(options.history, options.onNavigateStep);
  if (history) section.append(history);
  return section;
}
