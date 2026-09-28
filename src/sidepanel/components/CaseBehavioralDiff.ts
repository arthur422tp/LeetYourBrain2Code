import type { ComparisonStopReason } from "../../core/cross-run-diff";
import type { CaseDivergencePresentation } from "../case-diff-presentation";
import type { ComparisonCompatibility } from "../run-comparison-state";

export interface CaseBehavioralDiffModel {
  leftCaseIndex: number | null;
  rightCaseIndex: number | null;
  compatibility?: ComparisonCompatibility;
  presentation?: CaseDivergencePresentation;
  coverageMessage?: string;
  stopReason?: ComparisonStopReason;
  leftAnchorAuthoritative?: boolean;
  rightAnchorAuthoritative?: boolean;
}

export interface CaseBehavioralDiffOptions {
  model: CaseBehavioralDiffModel;
  onInspectLeft(step: number): void;
  onInspectRight(step: number): void;
}

export interface CaseBehavioralDiffHandle {
  element: HTMLElement;
  update(model: CaseBehavioralDiffModel): void;
  dispose(): void;
}

const DISCLAIMER =
  "Differences describe captured runtime behavior. They do not identify the correct path or root cause.";

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

function caseLabel(index: number): string {
  return `Case ${index + 1}`;
}

function pairLabel(model: CaseBehavioralDiffModel): string | undefined {
  if (model.leftCaseIndex === null || model.rightCaseIndex === null) return undefined;
  return `${caseLabel(model.leftCaseIndex)} vs ${caseLabel(model.rightCaseIndex)}`;
}

function compatibilityMessage(compatibility: ComparisonCompatibility): string | undefined {
  switch (compatibility.status) {
    case "compatible":
      return undefined;
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
      return "No Case A selected. Select an accepted captured run as Case A.";
    case "no_current":
      return "No Case B selected. Run another Case and compare it with Case A.";
  }
}

function stoppedMessage(stopReason: ComparisonStopReason | undefined): string | undefined {
  switch (stopReason) {
    case "coverage_ended":
      return "No observed divergence before comparison coverage ended.";
    case "ambiguous_alignment":
    case "alignment_boundary":
    case "unmatched_function":
      return "Comparison stopped because the next evidence could not be aligned safely.";
    case undefined:
      return undefined;
  }
}

function noSideMessage(model: CaseBehavioralDiffModel): string | undefined {
  if (model.leftCaseIndex === null) return "No Case A selected. Select an accepted captured run as Case A.";
  if (model.rightCaseIndex === null) return "No Case B selected. Run another Case and compare it with Case A.";
  return undefined;
}

function appendEvidence(
  host: HTMLElement,
  side: CaseDivergencePresentation["left"],
  id: string,
  authoritative: boolean,
  onInspect: (step: number) => void,
  disposed: () => boolean
): void {
  const section = createElement("section", "case-behavioral-diff__side");
  section.append(createElement("h4", "case-behavioral-diff__side-heading", side.caseLabel));
  if (side.factualText !== undefined) {
    section.append(createElement("p", "case-behavioral-diff__side-text", `${side.caseLabel}: ${side.factualText}`));
  }
  if (side.step !== undefined) {
    section.append(createElement("span", "case-behavioral-diff__side-step", `Captured step ${side.step}`));
  }
  const inspect = createElement("button", "case-behavioral-diff__inspect", `Inspect ${side.caseLabel}`);
  inspect.id = id;
  inspect.type = "button";
  inspect.disabled = side.step === undefined || !authoritative;
  if (inspect.disabled) {
    inspect.title = "This captured anchor is not authoritative.";
  }
  inspect.addEventListener("click", () => {
    if (!disposed() && !inspect.disabled && side.step !== undefined) onInspect(side.step);
  });
  section.append(inspect);
  host.append(section);
}

export function createCaseBehavioralDiff(
  options: CaseBehavioralDiffOptions
): CaseBehavioralDiffHandle {
  const element = createElement("section", "case-behavioral-diff");
  element.setAttribute("aria-live", "polite");
  const heading = createElement("h2", "case-behavioral-diff__heading", "Case comparison");
  const body = createElement("div", "case-behavioral-diff__body");
  element.append(heading, body);

  let disposed = false;
  const isDisposed = (): boolean => disposed;

  const update = (model: CaseBehavioralDiffModel): void => {
    if (disposed) return;
    body.replaceChildren();
    const missingSide = noSideMessage(model);
    if (missingSide) {
      body.append(createElement("p", "case-behavioral-diff__message", missingSide));
      return;
    }

    const pair = pairLabel(model);
    if (pair) body.append(createElement("h3", "case-behavioral-diff__pair", pair));

    if (model.compatibility && model.compatibility.status !== "compatible") {
      body.append(createElement(
        "p",
        "case-behavioral-diff__message",
        compatibilityMessage(model.compatibility) ?? "Comparison is unavailable for this pair."
      ));
    } else if (model.presentation) {
      const card = createElement("section", "case-behavioral-diff__card");
      card.append(createElement("h3", "case-behavioral-diff__first", "First observed divergence"));
      card.append(createElement("h4", "case-behavioral-diff__title", model.presentation.title));
      if (model.presentation.detail) {
        card.append(createElement("p", "case-behavioral-diff__detail", model.presentation.detail));
      }
      const sides = createElement("div", "case-behavioral-diff__sides");
      appendEvidence(
        sides,
        model.presentation.left,
        "case-behavioral-diff-inspect-left",
        model.leftAnchorAuthoritative === true,
        options.onInspectLeft,
        isDisposed
      );
      appendEvidence(
        sides,
        model.presentation.right,
        "case-behavioral-diff-inspect-right",
        model.rightAnchorAuthoritative === true,
        options.onInspectRight,
        isDisposed
      );
      card.append(sides);
      body.append(card);
      body.append(createElement("p", "case-behavioral-diff__disclaimer", DISCLAIMER));
    } else {
      body.append(createElement(
        "p",
        "case-behavioral-diff__message",
        stoppedMessage(model.stopReason)
          ?? "No behavioral difference was found in the captured evidence."
      ));
      if (model.stopReason === undefined) {
        body.append(createElement("p", "case-behavioral-diff__disclaimer", DISCLAIMER));
      }
    }

    if (model.coverageMessage) {
      body.append(createElement("p", "case-behavioral-diff__coverage", model.coverageMessage));
    }
  };

  update(options.model);

  return {
    element,
    update,
    dispose(): void {
      disposed = true;
    }
  };
}
