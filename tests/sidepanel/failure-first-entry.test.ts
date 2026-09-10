import { describe, expect, it, vi } from "vitest";

import type {
  NoProgressFailureFirstSelection,
  RepeatedStateFailureFirstSelection,
  RepeatedTransitionFailureFirstSelection
} from "../../src/sidepanel/failure-first-selection";
import { createFailureFirstEntry } from "../../src/sidepanel/components/FailureFirstEntry";

const transitionSelection: RepeatedTransitionFailureFirstSelection = {
  kind: "repeated_transition",
  patternId: "transition",
  inspectIndex: 64,
  evidenceStartIndex: 52,
  evidenceEndIndex: 99,
  distanceFromTermination: 4,
  repeatCount: 12,
  periodSteps: 4,
  reason: "nearest_terminal_evidence"
};

const stateSelection: RepeatedStateFailureFirstSelection = {
  kind: "repeated_state",
  patternId: "state",
  inspectIndex: 64,
  evidenceStartIndex: 58,
  evidenceEndIndex: 64,
  distanceFromTermination: 2,
  repeatCount: 7,
  reason: "nearest_terminal_evidence"
};

const noProgressSelection: NoProgressFailureFirstSelection = {
  kind: "no_progress",
  patternId: "stalled",
  inspectIndex: 64,
  evidenceStartIndex: 58,
  evidenceEndIndex: 64,
  distanceFromTermination: 2,
  repeatCount: 7,
  revisitCount: 6,
  reason: "nearest_terminal_evidence"
};

describe("createFailureFirstEntry", () => {
  it("renders repeated-transition factual copy", () => {
    const entry = createFailureFirstEntry({
      selection: transitionSelection,
      onNavigate: vi.fn()
    });

    expect(entry.textContent).toContain("Start Here");
    expect(entry.textContent).toContain("Repeated 4-step behavior × 12");
  });

  it("renders repeated-state factual copy", () => {
    const entry = createFailureFirstEntry({
      selection: stateSelection,
      onNavigate: vi.fn()
    });

    expect(entry.textContent).toContain("Repeated observable state × 7");
  });

  it("renders no-progress factual copy", () => {
    const entry = createFailureFirstEntry({
      selection: noProgressSelection,
      onNavigate: vi.fn()
    });

    expect(entry.textContent).toContain("No observable progress across 6 revisits");
  });

  it("renders proximity and 1-based evidence range", () => {
    const entry = createFailureFirstEntry({
      selection: {
        ...stateSelection,
        evidenceStartIndex: 180,
        evidenceEndIndex: 251,
        distanceFromTermination: 4
      },
      onNavigate: vi.fn()
    });

    expect(entry.textContent).toContain(
      "Observed within 4 captured steps of execution termination."
    );
    expect(entry.textContent).toContain("Evidence: Steps 181–252");
  });

  it("does not navigate on render and emits only inspectIndex on click", () => {
    const onNavigate = vi.fn();
    const entry = createFailureFirstEntry({
      selection: { ...stateSelection, inspectIndex: 64 },
      onNavigate
    });

    expect(onNavigate).not.toHaveBeenCalled();
    const button = entry.querySelector("button")!;
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toContain("Step 65");

    button.click();

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith(64);
  });

  it("does not use diagnostic or failure-attribution wording", () => {
    const forbiddenPhrases = [
      "root cause",
      "bug location",
      "likely cause",
      "failure source",
      "problem detected",
      "suspicious loop",
      "infinite loop",
      "caused timeout",
      "caused failure",
      "likely failure"
    ];
    const entry = createFailureFirstEntry({
      selection: transitionSelection,
      onNavigate: vi.fn()
    });
    const text = entry.textContent?.toLowerCase() ?? "";

    for (const phrase of forbiddenPhrases) {
      expect(text).not.toContain(phrase);
    }
  });
});
