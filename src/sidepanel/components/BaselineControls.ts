import type { TraceSessionStatus } from "../../shared/execution-types";

export interface BaselineControlsModel {
  hasCurrent: boolean;
  hasBaseline: boolean;
  caseLabel?: string;
  baselineStatus?: TraceSessionStatus;
  sourceDiffers: boolean;
}

export interface BaselineControlsOptions {
  model: BaselineControlsModel;
  onPin(): void;
  onReplace(): void;
  onClear(): void;
}

export interface BaselineControlsHandle {
  element: HTMLElement;
  update(model: BaselineControlsModel): void;
  dispose(): void;
}

function createButton(
  id: string,
  text: string,
  className?: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.textContent = text;
  if (className) button.className = className;
  return button;
}

function statusLabel(status: TraceSessionStatus | undefined): string | undefined {
  return status?.replaceAll("_", " ");
}

export function createBaselineControls(
  options: BaselineControlsOptions
): BaselineControlsHandle {
  const element = document.createElement("section");
  element.className = "baseline-controls";
  element.setAttribute("aria-live", "polite");

  const summary = document.createElement("div");
  summary.className = "baseline-controls__summary";
  const title = document.createElement("strong");
  title.className = "baseline-controls__title";
  const metadata = document.createElement("span");
  metadata.className = "baseline-controls__metadata";
  summary.append(title, metadata);

  const actions = document.createElement("div");
  actions.className = "baseline-controls__actions";
  const pin = createButton("baseline-pin", "Pin baseline", "is-primary");
  const replace = createButton("baseline-replace", "Replace");
  const clear = createButton("baseline-clear", "Clear");
  actions.append(pin, replace, clear);
  element.append(summary, actions);

  let disposed = false;
  const onPin = (): void => {
    if (!disposed && !pin.disabled) options.onPin();
  };
  const onReplace = (): void => {
    if (!disposed && !replace.disabled) options.onReplace();
  };
  const onClear = (): void => {
    if (!disposed && !clear.disabled) options.onClear();
  };
  pin.addEventListener("click", onPin);
  replace.addEventListener("click", onReplace);
  clear.addEventListener("click", onClear);

  const update = (model: BaselineControlsModel): void => {
    const pinned = model.hasBaseline;
    element.dataset.baselineState = pinned ? "pinned" : "unPinned";
    pin.hidden = pinned;
    replace.hidden = !pinned;
    clear.hidden = !pinned;
    pin.disabled = pinned || !model.hasCurrent;
    replace.disabled = !model.hasCurrent;
    clear.disabled = !pinned;

    if (pinned) {
      title.textContent = ["Baseline pinned", model.caseLabel]
        .filter((value): value is string => Boolean(value))
        .join(" · ");
      const details = [statusLabel(model.baselineStatus)];
      if (model.sourceDiffers) details.push("Source differs from baseline");
      metadata.textContent = details.filter((value): value is string => Boolean(value)).join(" · ");
    } else {
      title.textContent = "";
      metadata.textContent = "";
    }
  };

  update(options.model);

  return {
    element,
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pin.removeEventListener("click", onPin);
      replace.removeEventListener("click", onReplace);
      clear.removeEventListener("click", onClear);
    }
  };
}
