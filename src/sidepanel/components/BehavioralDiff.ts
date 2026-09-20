import type {
  BehavioralDiffSide,
  BehavioralDiffViewModel
} from "../behavioral-diff-view";

export type { BehavioralDiffViewModel } from "../behavioral-diff-view";

export interface BehavioralDiffOptions {
  model: BehavioralDiffViewModel | null;
  onInspectCurrent(step: number): void;
}

export interface BehavioralDiffHandle {
  element: HTMLElement;
  update(model: BehavioralDiffViewModel | null): void;
  dispose(): void;
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

function appendSide(
  host: HTMLElement,
  heading: string,
  side: BehavioralDiffSide | undefined
): void {
  if (!side) return;
  const section = createElement("section", "behavioral-diff__side");
  section.append(createElement("h4", "behavioral-diff__side-heading", heading));
  section.append(createElement("p", "behavioral-diff__side-text", side.factualText));
  if (side.source) section.append(createElement("code", "behavioral-diff__side-source", side.source));
  if (side.step !== undefined) {
    section.append(createElement("span", "behavioral-diff__side-step", `Captured step ${side.step}`));
  }
  host.append(section);
}

export function createBehavioralDiff(options: BehavioralDiffOptions): BehavioralDiffHandle {
  const element = createElement("section", "behavioral-diff");
  element.setAttribute("aria-live", "polite");
  const heading = createElement("h2", "behavioral-diff__heading", "Behavioral Diff");
  const body = createElement("div", "behavioral-diff__body");
  element.append(heading, body);

  let disposed = false;
  let inspectButton: HTMLButtonElement | null = null;
  let inspectStep: number | undefined;
  const onInspect = (): void => {
    if (!disposed && inspectStep !== undefined) options.onInspectCurrent(inspectStep);
  };

  const update = (model: BehavioralDiffViewModel | null): void => {
    body.replaceChildren();
    inspectButton?.removeEventListener("click", onInspect);
    inspectButton = null;
    inspectStep = undefined;
    element.hidden = model === null;
    if (model === null) return;

    body.append(createElement("p", "behavioral-diff__summary", model.summary));
    const labels = createElement("div", "behavioral-diff__labels");
    labels.append(
      createElement("h3", "behavioral-diff__run-heading", model.baselineLabel),
      createElement("h3", "behavioral-diff__run-heading", model.currentLabel)
    );
    body.append(labels);

    if (model.sourceDiffers) {
      body.append(createElement("p", "behavioral-diff__source-note", "Source differs from baseline."));
    }

    if (model.matchedPrefix) {
      const prefix = model.matchedPrefix;
      const path = prefix.callPath.length > 0 ? ` · ${prefix.callPath.join(" → ")}` : "";
      body.append(createElement(
        "p",
        "behavioral-diff__prefix",
        `Matched before divergence · ${prefix.frames} frames · ${prefix.checkpoints} checkpoints${path}`
      ));
    }

    if (model.divergence) {
      const divergence = createElement("section", "behavioral-diff__divergence");
      divergence.append(createElement("h3", "behavioral-diff__divergence-heading", model.divergence.categoryLabel));
      if (model.divergence.locationLabel) {
        divergence.append(createElement("p", "behavioral-diff__location", model.divergence.locationLabel));
      }
      const sides = createElement("div", "behavioral-diff__sides");
      appendSide(sides, "Baseline", model.divergence.baseline);
      appendSide(sides, "Current", model.divergence.current);
      divergence.append(sides);
      if (model.divergence.currentStep !== undefined) {
        inspectStep = model.divergence.currentStep;
        inspectButton = createElement("button", "behavioral-diff__inspect", "Inspect current");
        inspectButton.id = "behavioral-diff-inspect-current";
        inspectButton.type = "button";
        inspectButton.addEventListener("click", onInspect);
        divergence.append(inspectButton);
      }
      body.append(divergence);
    }

    if (model.coverageMessage) {
      body.append(createElement("p", "behavioral-diff__coverage", model.coverageMessage));
    }
  };

  update(options.model);
  return {
    element,
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      inspectButton?.removeEventListener("click", onInspect);
    }
  };
}
