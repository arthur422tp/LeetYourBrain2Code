import type { ControlFlowUiModel, ExecutionStoryItem } from "../../core/execution-story";
import type { IterationStatus, LoopExitReason } from "../../shared/control-flow-types";
import { formatValue } from "./value-format";

export interface ExecutionStoryOptions {
  model: ControlFlowUiModel;
  onNavigateStep(step: number): void;
}

const outcomes: Record<IterationStatus, string> = {
  completed: "Completed normally", continued: "Continued", broke: "Broke loop",
  function_returned: "Function returned", interrupted: "Incomplete evidence"
};
const exits: Record<LoopExitReason, string> = {
  exhausted: "Loop exited · iterable exhausted", condition_false: "Loop exited · condition False",
  break: "Loop exited · break", function_return: "Loop exited · function returned",
  exception: "Loop interrupted · exception", trace_ended: "Loop evidence ended · trace ended"
};
const phases = {observed:"Observed",committed:"Committed",superseded:"Superseded",interrupted:"Confirmation unavailable"};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function itemText(item: ExecutionStoryItem): string {
  switch (item.kind) {
    case "iteration_start": return `Iteration #${item.ordinal} started${item.bindings.length ? ` · ${item.bindings.map(binding => `${binding.name} = ${formatValue(binding.value)}`).join(", ")}` : ""}`;
    case "decision": return `${item.source} → ${item.status === "true" ? "True" : item.status === "false" ? "False" : "condition partial"}${item.shortCircuited ? " · short-circuit" : ""}`;
    case "transfer": return `${item.source} · ${phases[item.phase]}${item.phase === "superseded" && item.supersededByActionId ? ` · by ${item.supersededByActionId}` : ""}`;
    case "iteration_outcome": return outcomes[item.status];
    case "loop_exit": return exits[item.reason];
    case "frame_exit": return "Function exited";
  }
}

export function createExecutionStory({model, onNavigateStep}: ExecutionStoryOptions): HTMLElement {
  const root = element("section", "execution-story");
  const tracing = model.tracingState;
  if (tracing && tracing.status !== "complete") {
    const banner=element("div","execution-story__tracing",`Control-flow tracing ${tracing.status}${tracing.reason ? ` · ${tracing.reason}` : ""}`);
    banner.dataset.controlFlowTracingStatus=tracing.status; root.append(banner);
  }
  if (model.currentActivation) {
    const activation=model.currentActivation;
    root.dataset.activationKey=activation.activationKey;
    root.append(element("h3","execution-story__context",`${activation.loopKind.toUpperCase()} · line ${activation.line}`));
    if (activation.parentContext.loopStack.length) root.append(element("div","execution-story__ancestry",activation.parentContext.loopStack.map(loop=>`${loop.loopId} · iteration #${loop.iteration}`).join(" → ")));
    if (model.currentIteration) root.append(element("div","execution-story__current",`Iteration #${model.currentIteration.ordinal}`));
  }
  if (!model.storyItems.length) root.append(element("div","trace-viewer__empty","No control-flow evidence for this step."));
  const list=element("ol","execution-story__items");
  for (const item of model.storyItems) {
    const row=element("li","execution-story__item");
    const button=element("button","execution-story__navigate",itemText(item)); button.type="button";
    button.dataset.storyKind=item.kind; button.dataset.anchorStep=String(item.anchorStep);
    if (item.kind === "transfer") {
      button.dataset.transferPhase=item.phase; button.dataset.actionId=item.actionId;
      if (item.supersededByActionId) button.dataset.supersededByActionId=item.supersededByActionId;
    }
    if (item.kind === "iteration_outcome") button.dataset.iterationStatus=item.status;
    if (item.kind === "loop_exit") button.dataset.loopExitReason=item.reason;
    if (item.kind === "decision") button.dataset.decisionStatus=item.status;
    button.addEventListener("click",()=>onNavigateStep(item.anchorStep)); row.append(button); list.append(row);
  }
  if (list.childElementCount) root.append(list);
  if (model.iterationHistory.length) {
    const history=element("section","execution-story__history"); history.append(element("h3","execution-story__heading","Iteration History"));
    for (const {ordinal,iteration} of model.iterationHistory) {
      const button=element("button","execution-story__history-entry",`#${ordinal} · ${iteration.bindings.map(binding=>`${binding.name} = ${formatValue(binding.value)}`).join(", ")} · ${outcomes[iteration.status]}`);
      button.type="button"; button.dataset.rawIteration=String(iteration.iteration); button.dataset.iterationStatus=iteration.status;
      button.dataset.anchorStep=String(iteration.anchorStepStart);
      if (ordinal===model.currentIteration?.ordinal) button.setAttribute("aria-current","step");
      button.addEventListener("click",()=>onNavigateStep(iteration.anchorStepStart)); history.append(button);
    }
    root.append(history);
  }
  return root;
}
