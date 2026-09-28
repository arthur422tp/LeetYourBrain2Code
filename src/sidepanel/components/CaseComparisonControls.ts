import type { ComparisonCompatibility } from "../run-comparison-state";

export interface CaseComparisonControlsModel {
  hasCurrent: boolean;
  currentCaseIndex: number | null;
  caseAIndex: number | null;
  caseBIndex: number | null;
  compatibility?: ComparisonCompatibility;
}

export interface CaseComparisonControlsOptions {
  model: CaseComparisonControlsModel;
  onSelectLeft(): void;
  onSelectRight(): void;
  onClear(): void;
}

export interface CaseComparisonControlsHandle {
  element: HTMLElement;
  update(model: CaseComparisonControlsModel): void;
  dispose(): void;
}

function caseLabel(index: number | null): string {
  return index === null ? "Not selected" : `Case ${index + 1}`;
}

function guidance(model: CaseComparisonControlsModel): string | undefined {
  if (!model.hasCurrent || model.currentCaseIndex === null) {
    return "Run the current Case and accept its captured execution first.";
  }
  if (model.caseAIndex === null) {
    return "Select the current captured run as Case A to begin a comparison.";
  }
  if (!model.compatibility) {
    return model.caseBIndex === null
      ? "Run another Case to compare it with Case A."
      : undefined;
  }

  switch (model.compatibility.status) {
    case "compatible":
      return "Cases are ready to compare.";
    case "same_case":
      return "Select a different Case before comparing.";
    case "different_source":
      return "Code changed between captures. Run both Cases again with the same code.";
    case "different_problem":
      return "Open the same problem before comparing.";
    case "missing_problem":
      return "Problem identity is unavailable for this pair.";
    case "different_entrypoint":
      return "The captured entrypoints differ. Keep the same entrypoint for both Cases.";
    case "unsupported_schema":
    case "unsupported_runtime":
      return "This captured runtime or schema is unavailable for comparison.";
    case "same_run":
      return "Select two different captured runs for comparison.";
    case "different_testcase":
      return "The captured testcase differs from the baseline comparison.";
    case "no_baseline":
      return "Select a captured run as Case A to begin a comparison.";
    case "no_current":
      return "Run and accept a current Case before comparing.";
  }
}

function createButton(id: string, text: string, className?: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.textContent = text;
  if (className) button.className = className;
  return button;
}

export function createCaseComparisonControls(
  options: CaseComparisonControlsOptions
): CaseComparisonControlsHandle {
  const element = document.createElement("section");
  element.className = "case-comparison-controls";
  element.setAttribute("aria-live", "polite");

  const heading = document.createElement("strong");
  heading.className = "case-comparison-controls__heading";
  heading.textContent = "Compare cases";

  const current = document.createElement("span");
  current.className = "case-comparison-controls__current";
  const caseA = document.createElement("span");
  caseA.className = "case-comparison-controls__case-a";
  const caseB = document.createElement("span");
  caseB.className = "case-comparison-controls__case-b";
  const summary = document.createElement("div");
  summary.className = "case-comparison-controls__summary";
  summary.append(current, caseA, caseB);

  const actions = document.createElement("div");
  actions.className = "case-comparison-controls__actions";
  const selectLeft = createButton(
    "case-comparison-select-left",
    "Use as Case A",
    "is-primary"
  );
  const selectRight = createButton(
    "case-comparison-select-right",
    "Compare current with Case A"
  );
  const clear = createButton("case-comparison-clear", "Clear");
  actions.append(selectLeft, selectRight, clear);

  const status = document.createElement("p");
  status.className = "case-comparison-controls__status";

  element.append(heading, summary, actions, status);

  let disposed = false;
  const onSelectLeft = (): void => {
    if (!disposed && !selectLeft.disabled) options.onSelectLeft();
  };
  const onSelectRight = (): void => {
    if (!disposed && !selectRight.disabled) options.onSelectRight();
  };
  const onClear = (): void => {
    if (!disposed && !clear.disabled) options.onClear();
  };
  selectLeft.addEventListener("click", onSelectLeft);
  selectRight.addEventListener("click", onSelectRight);
  clear.addEventListener("click", onClear);

  const update = (model: CaseComparisonControlsModel): void => {
    const currentLabel = model.hasCurrent && model.currentCaseIndex !== null
      ? `Current: ${caseLabel(model.currentCaseIndex)}`
      : "Current: No accepted run";
    current.textContent = currentLabel;
    caseA.textContent = `Case A: ${caseLabel(model.caseAIndex)}`;
    caseB.textContent = `Case B: ${caseLabel(model.caseBIndex)}`;
    selectLeft.disabled = !model.hasCurrent || model.currentCaseIndex === null;
    selectRight.disabled = !model.hasCurrent
      || model.currentCaseIndex === null
      || model.caseAIndex === null;
    clear.disabled = model.caseAIndex === null && model.caseBIndex === null;
    const message = guidance(model);
    status.textContent = message ?? "";
    status.hidden = message === undefined;
    element.dataset.caseComparisonState = model.compatibility?.status ?? "unselected";
  };

  update(options.model);

  return {
    element,
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      selectLeft.removeEventListener("click", onSelectLeft);
      selectRight.removeEventListener("click", onSelectRight);
      clear.removeEventListener("click", onClear);
    }
  };
}
